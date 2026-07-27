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
 *
 * The Run Coordinator uses dependency injection for the cancel-shortcut
 * registrar, the notification function, and the text-reader function so
 * that lifecycle logic can be fully tested without Electron or real
 * global shortcuts.
 */

const CANCEL_ACCELERATOR = 'Command+Escape';

/**
 * @typedef {Object} CancelRegistrar
 * @property {(accelerator: string, callback: () => void) => boolean} register
 * @property {(accelerator: string) => void} unregister
 */

/**
 * @typedef {Object} RunCoordinatorOptions
 * @property {CancelRegistrar} cancelRegistrar - Registers/unregisters the Cancel Shortcut
 * @property {(title: string, body: string) => void} onNotify - Sends user-visible notifications
 * @property {() => Promise<string>} readSelectedText - Reads the currently selected text
 */

class RunCoordinator {
  /**
   * @param {RunCoordinatorOptions} opts
   */
  constructor(opts) {
    this._cancelRegistrar = opts.cancelRegistrar;
    this._onNotify = opts.onNotify || (() => {});
    this._readSelectedText = opts.readSelectedText || (async () => '');
    /** @type {boolean} */
    this._active = false;
    /** @type {boolean} */
    this._cancelled = false;
    /** @type {boolean} */
    this._cancelRegistered = false;
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

  // ------------------------------------------------------------------
  // Run lifecycle
  // ------------------------------------------------------------------

  /**
   * Begin a new Run.
   *
   * If a Run is already active, rejects the new one with a notification
   * and returns false. Otherwise, immediately enters the active state
   * and registers the Cancel Shortcut.
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
   * @returns {Promise<string|null>} The selected text, or null if cancelled
   */
  async readText() {
    if (this._cancelled) return null;

    const text = await this._readSelectedText();

    if (this._cancelled) return null;

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
  }
}

module.exports = { RunCoordinator, CANCEL_ACCELERATOR };
