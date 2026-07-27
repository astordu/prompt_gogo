'use strict';

/**
 * Run Coordinator — the single high-level orchestration seam for a Run
 * lifecycle.
 *
 * Responsibilities:
 * - Establish a single active Run immediately when a Shortcut fires.
 * - Enforce mutual exclusion: at most one active Run at a time.
 * - Temporarily register and unregister the Cancel Shortcut
 *   (Command+Escape) for the duration of the active Run.
 * - Provide cancellation: calling cancel() or pressing the Cancel
 *   Shortcut aborts the current Run.
 * - Bind the Run to the Output Target captured at trigger time. All
 *   subsequent writes, deletes and restores are validated against this
 *   original target. When the target becomes invalid (app focus or
 *   edit position changed), the Run is safely cancelled.
 *
 * The Run Coordinator uses dependency injection for the cancel-shortcut
 * registrar, the notification function, the text-reader function and
 * the Output Target adapter so that lifecycle logic can be fully tested
 * without Electron or real global shortcuts.
 */

const CANCEL_ACCELERATOR = 'Command+Escape';

const LOADING_TEXT = 'S';
const ENDING_TEXT = 'E';
const ENDING_HOLD_MS = 500;

/**
 * @typedef {Object} CancelRegistrar
 * @property {(accelerator: string, callback: () => void) => boolean} register
 * @property {(accelerator: string) => void} unregister
 */

/**
 * @typedef {Object} OutputTargetAdapter
 * @property {() => void} capture - Capture the current Output Target identity (app + edit position)
 * @property {() => boolean} isValid - Whether the original Output Target is still the focused element
 */

/**
 * @typedef {Object} RunIndicatorSink
 * @property {(text: string) => Promise<void>} write - Pastes text at cursor position
 * @property {(count: number) => Promise<void>} deleteBack - Deletes n characters backwards
 */

/**
 * @typedef {Object} RunCoordinatorOptions
 * @property {CancelRegistrar} cancelRegistrar - Registers/unregisters the Cancel Shortcut
 * @property {(title: string, body: string) => void} onNotify - Sends user-visible notifications
 * @property {() => Promise<string>} readSelectedText - Reads the currently selected text
 * @property {OutputTargetAdapter} [outputTarget] - Captures and validates the Output Target
 * @property {RunIndicatorSink} [runIndicator] - Writes/removes inline Run Indicators
 */

class RunCoordinator {
  /**
   * @param {RunCoordinatorOptions} opts
   */
  constructor(opts) {
    this._cancelRegistrar = opts.cancelRegistrar;
    this._onNotify = opts.onNotify || (() => {});
    this._readSelectedText = opts.readSelectedText || (async () => '');
    this._outputTarget = opts.outputTarget || null;
    this._runIndicator = opts.runIndicator || null;
    /** @type {boolean} */
    this._active = false;
    /** @type {boolean} */
    this._cancelled = false;
    /** @type {boolean} */
    this._cancelRegistered = false;
    /** @type {boolean} */
    this._targetInvalid = false;
    /** @type {boolean} */
    this._loadingActive = false;
    /** @type {string|null} */
    this._loadingOriginalText = null;
    /** @type {AbortController|null} */
    this._abortController = null;
    /** @type {boolean} */
    this._endingActive = false;
    /**
     * Injectable delay function (defaults to setTimeout-based promise).
     * Tests pass a fake clock to control the exact 500ms hold.
     * @type {(ms: number) => Promise<void>}
     */
    this._delay = opts.delay || ((ms) => new Promise(r => setTimeout(r, ms)));
    /** @type {boolean} */
    this._hasModelContent = false;
  }

  // ------------------------------------------------------------------
  // Public queries
  // ------------------------------------------------------------------

  /**
   * Whether a Run is currently active (covers the full lifecycle from
   * trigger to final cleanup).
   * @returns {boolean}
   */
  isActive() {
    return this._active;
  }

  /**
   * Whether the current Run has been cancelled.
   * @returns {boolean}
   */
  isCancelled() {
    return this._cancelled;
  }

  /**
   * Whether the Output Target became invalid during the Run.
   * @returns {boolean}
   */
  isTargetInvalid() {
    return this._targetInvalid;
  }

  /**
   * Whether the Run is still viable (active, not cancelled, target valid).
   * @returns {boolean}
   */
  isViable() {
    return this._active && !this._cancelled && !this._targetInvalid;
  }

  /**
   * Whether the Loading indicator is currently displayed.
   * @returns {boolean}
   */
  isShowingLoading() {
    return this._loadingActive;
  }

  /**
   * Returns the AbortSignal for the current Run, or null if no Run
   * is active. The signal is aborted when cancel() is called, allowing
   * HTTP requests and streaming pipelines to stop promptly.
   * @returns {AbortSignal|null}
   */
  getAbortSignal() {
    return this._abortController ? this._abortController.signal : null;
  }

  /**
   * Whether the Ending indicator is currently displayed.
   * @returns {boolean}
   */
  isShowingEnding() {
    return this._endingActive;
  }

  /**
   * Whether any non-empty model content has been received during this Run.
   * @returns {boolean}
   */
  hasModelContent() {
    return this._hasModelContent;
  }

  // ------------------------------------------------------------------
  // Run lifecycle
  // ------------------------------------------------------------------

  /**
   * Begin a new Run.
   *
   * If a Run is already active, rejects the new one with a notification
   * and returns false. Otherwise, immediately enters the active state,
   * captures the Output Target, and registers the Cancel Shortcut.
   *
   * @returns {boolean} true if the Run was started, false if rejected
   */
  beginRun() {
    if (this._active) {
      this._onNotify('已有运行任务', '已有运行任务，按 Command + Esc 取消后再试');
      return false;
    }

    this._active = true;
    this._cancelled = false;
    this._targetInvalid = false;
    this._abortController = new AbortController();

    // Capture the Output Target identity at trigger time
    if (this._outputTarget) {
      this._outputTarget.capture();
    }

    // Attempt to register the Cancel Shortcut
    try {
      const ok = this._cancelRegistrar.register(CANCEL_ACCELERATOR, () => {
        this.cancel();
      });
      if (ok) {
        this._cancelRegistered = true;
      } else {
        // Registration failed — notify but continue the Run
        this._onNotify('取消快捷键注册失败', '本次无法使用 Command + Esc 取消，但任务继续执行');
      }
    } catch {
      this._onNotify('取消快捷键注册失败', '本次无法使用 Command + Esc 取消，但任务继续执行');
    }

    return true;
  }

  /**
   * Read the selected text as part of the active Run.
   *
   * Checks for cancellation before and after the async read. If
   * cancelled, returns null to signal that the Run should abort.
   *
   * @returns {Promise<string|null>} The selected text, or null if cancelled/target invalid
   */
  async readText() {
    if (this._cancelled) return null;
    if (this._targetInvalid) return null;

    const text = await this._readSelectedText();

    if (this._cancelled) return null;
    if (this._checkTargetInvalidated()) return null;

    return text;
  }

  /**
   * Cancel the current Run.
   *
   * Sets the cancelled flag so that the Run handler can detect it and
   * abort gracefully. The actual cleanup (unregister Cancel Shortcut,
   * clear active state) is done by endRun().
   */
  cancel() {
    if (!this._active || this._cancelled) return;
    this._cancelled = true;
    if (this._abortController) {
      this._abortController.abort();
    }
  }

  // ------------------------------------------------------------------
  // Loading indicator lifecycle
  // ------------------------------------------------------------------

  /**
   * Show the `S` indicator, replacing the original selected
   * text. Called after the selected text has been safely captured
   * and provider/request configuration validation has passed — just
   * before the HTTP request is sent.
   *
   * Validates the Output Target first. If invalid, does nothing and
   * returns false.
   *
   * @param {string} originalText - The originally selected text (for later restore)
   * @returns {Promise<boolean>} true if Loading was shown, false if target invalid
   */
  async showLoading(originalText) {
    if (!this._active || this._loadingActive) return false;
    if (this._cancelled) return false;
    if (!this.validateTarget()) return false;

    this._loadingOriginalText = originalText;

    if (this._runIndicator) {
      await this._runIndicator.write(LOADING_TEXT);
    }

    // Re-check target and cancellation after the async write
    if (this._cancelled) {
      this._loadingActive = false;
      return false;
    }
    if (this._checkTargetInvalidated()) {
      this._loadingActive = false;
      return false;
    }

    this._loadingActive = true;
    return true;
  }

  /**
   * Handle an incoming model content chunk during the Loading phase.
   *
   * If the Loading indicator is active and the chunk is non-empty,
   * the indicator is removed first. Empty chunks do not trigger
   * removal.
   *
   * @param {string} chunk - The model content chunk
   * @returns {Promise<boolean>} true if Loading was cleared by this chunk, false otherwise
   */
  async onModelContent(chunk) {
    if (!this._loadingActive) return false;
    if (!chunk) return false; // empty content doesn't end Loading
    if (this._cancelled) return false;

    // Track that we've received non-empty model content
    this._hasModelContent = true;

    // Remove Loading indicator before writing the real content
    if (!this.validateTarget()) return false;

    if (this._runIndicator) {
      await this._runIndicator.deleteBack(LOADING_TEXT.length);
    }

    if (this._cancelled) return false;
    if (this._checkTargetInvalidated()) return false;

    this._loadingActive = false;
    return true;
  }

  /**
   * Abort the Loading phase: remove the `S` indicator and
   * restore the original selected text. Called when an error or
   * cancellation occurs before the first model content.
   *
   * If the Output Target has become invalid, does NOT touch the new
   * focus — only notifies.
   *
   * @returns {Promise<boolean>} true if restored, false if target invalid or no Loading active
   */
  async abortLoading() {
    if (!this._loadingActive) return false;
    if (!this.validateTarget()) return false;

    if (this._runIndicator) {
      // Delete Loading indicator
      await this._runIndicator.deleteBack(LOADING_TEXT.length);
      // Restore original text
      if (this._loadingOriginalText !== null) {
        await this._runIndicator.write(this._loadingOriginalText);
      }
    }

    this._loadingActive = false;
    return true;
  }

  // ------------------------------------------------------------------
  // Ending indicator lifecycle
  // ------------------------------------------------------------------

  /**
   * Show the `E` indicator after normal stream completion.
   *
   * Writes `E` after the last model content, then holds for
   * exactly 500ms before removing it. The Run remains active during
   * the hold period.
   *
   * Pre-conditions:
   * - The Run is active and not cancelled.
   * - The stream completed normally (not an error).
   * - Non-empty model content was received (`_hasModelContent`).
   * - The Output Target is still valid.
   *
   * If cancelled during the 500ms hold, the `E` is removed
   * immediately and the Run completes as successful (no cancel
   * notification).
   *
   * @returns {Promise<boolean>} true if Ending was shown and held
   *   for the full duration (or cancelled during hold), false if
   *   pre-conditions were not met.
   */
  async showEnding() {
    if (!this._active) return false;
    if (this._cancelled) return false;
    if (!this._hasModelContent) return false;
    if (!this.validateTarget()) return false;

    // Write Ending indicator
    if (this._runIndicator) {
      await this._runIndicator.write(ENDING_TEXT);
    }

    // Re-check after async write
    if (this._cancelled) {
      // Cancelled during write — remove Ending immediately (if target valid)
      if (this.validateTarget() && this._runIndicator) {
        await this._runIndicator.deleteBack(ENDING_TEXT.length);
      }
      return false;
    }
    if (this._checkTargetInvalidated()) {
      // Target invalid — Ending may be in the old target; can't clean up
      this._endingActive = false;
      return false;
    }

    this._endingActive = true;

    // Hold for 500ms — cancellation or target invalidity can interrupt
    await this._delay(ENDING_HOLD_MS);

    // If cancelled during the hold, remove Ending immediately and
    // treat as successful completion (no cancel notification).
    if (this._cancelled) {
      if (this.validateTarget() && this._runIndicator) {
        await this._runIndicator.deleteBack(ENDING_TEXT.length);
      }
      this._endingActive = false;
      return true;
    }

    // Normal completion: remove Ending after the hold
    if (!this.validateTarget()) {
      // Target became invalid during the hold — can't clean up
      this._endingActive = false;
      return false;
    }

    if (this._runIndicator) {
      await this._runIndicator.deleteBack(ENDING_TEXT.length);
    }

    this._endingActive = false;
    return true;
  }

  /**
   * Check if the Output Target is still valid. If it has become
   * invalid, mark the Run as target-invalid and send a notification.
   *
   * Should be called before every write, delete, or restore operation
   * against the Output Target.
   *
   * @returns {boolean} true if the target is still valid, false if invalid
   */
  validateTarget() {
    if (!this._active || this._targetInvalid) return false;
    if (!this._outputTarget) return true;

    if (!this._outputTarget.isValid()) {
      this._targetInvalid = true;
      this._onNotify(
        '输出目标已失效',
        '原始位置可能残留运行提示或部分结果，请手动检查'
      );
      return false;
    }

    return true;
  }

  /**
   * End the current Run and clean up.
   *
   * Unregisters the Cancel Shortcut (only this Run's temporary
   * registration), clears the active state, and resets the cancelled
   * flag. Safe to call multiple times.
   */
  endRun() {
    if (!this._active) return;

    // Unregister the Cancel Shortcut only if we registered it
    if (this._cancelRegistered) {
      try {
        this._cancelRegistrar.unregister(CANCEL_ACCELERATOR);
      } catch {
        // Best effort — the accelerator may already be gone
      }
      this._cancelRegistered = false;
    }

    this._active = false;
    this._cancelled = false;
    this._targetInvalid = false;
    this._loadingActive = false;
    this._loadingOriginalText = null;
    this._abortController = null;
    this._endingActive = false;
    this._hasModelContent = false;
  }

  // ------------------------------------------------------------------
  // Internal helpers
  // ------------------------------------------------------------------

  /**
   * Checks whether the target has become invalid after an async boundary.
   * @private
   * @returns {boolean} true if the target was invalidated (false if still valid or no target)
   */
  _checkTargetInvalidated() {
    if (!this._outputTarget) return false;
    if (this._targetInvalid) return true;
    if (!this._outputTarget.isValid()) {
      this._targetInvalid = true;
      this._onNotify(
        '输出目标已失效',
        '原始位置可能残留运行提示或部分结果，请手动检查'
      );
      return true;
    }
    return false;
  }
}

module.exports = { RunCoordinator, CANCEL_ACCELERATOR, LOADING_TEXT, ENDING_TEXT, ENDING_HOLD_MS };
