'use strict';

// ---------------------------------------------------------------------------
// Shortcut Draft — a DOM-free workflow module for one add/edit session.
//
// Owns draft fields (name, accelerator, template, providerId), an async
// operation generation for stale-result rejection, and a stable semantic
// state machine driven by an injected adapter.
//
// Dual-mode: works in Node (CommonJS) and in browser <script> (global).
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DraftAdapter
 * @property {(accelerator: string, excludeId: string | null) => Promise<{ status: string, conflictWith?: string }>} checkAvailability
 *
 * The seam the module depends on. The production adapter bridges to
 * ShortcutService via Electron IPC; the test adapter is in-memory.
 */

// ---------------------------------------------------------------------------
// Semantic statuses the module emits (stable — no DOM text or styles)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} DraftSnapshot
 * @property {string | null} id
 * @property {string} name
 * @property {string} accelerator
 * @property {string} template
 * @property {string | null} providerId
 * @property {string} status
 *   One of:
 *   - 'idle' — no accelerator or not yet checked
 *   - 'checking' — async availability check in flight
 *   - 'invalid' — incomplete shortcut (fewer than 2 modifiers + 1 regular key)
 *   - 'available' — accelerator passed availability check
 *   - 'internal-conflict' — conflict with another shortcut in this app
 *   - 'external-conflict' — conflict with OS / other app
 *   - 'unavailable' — check could not be completed
 * @property {string | null} conflictWith — name of conflicting shortcut (internal-conflict only)
 * @property {boolean} open — whether the session is active
 */

const MODIFIER_SET = new Set(['Control', 'Command', 'CommandOrControl', 'Alt', 'Shift']);

/**
 * Check if an accelerator meets the minimum format requirements:
 * at least two modifiers + one regular key.
 */
function isValidShortcutFormat(accelerator) {
  if (!accelerator || typeof accelerator !== 'string') return false;
  const parts = accelerator.split('+');
  const modifiers = parts.filter(p => MODIFIER_SET.has(p));
  const nonModifiers = parts.filter(p => !MODIFIER_SET.has(p));
  return modifiers.length >= 2 && nonModifiers.length >= 1;
}

class ShortcutDraft {
  /**
   * @param {DraftAdapter} adapter
   */
  constructor(adapter) {
    this._adapter = adapter;
    this._open = false;
    this._id = null;
    this._name = '';
    this._accelerator = '';
    this._template = '';
    this._providerId = null;
    this._status = 'idle';
    this._conflictWith = null;
    this._generation = 0;
    /** @type {Array<(snapshot: DraftSnapshot) => void>} */
    this._listeners = [];
  }

  // ------------------------------------------------------------------
  // Session lifecycle
  // ------------------------------------------------------------------

  /**
   * Start a new blank add session.
   */
  startAdd() {
    this._open = true;
    this._id = null;
    this._name = '';
    this._accelerator = '';
    this._template = '';
    this._providerId = null;
    this._status = 'idle';
    this._conflictWith = null;
    this._generation++;
    this._emit();
  }

  /**
   * Start an edit session initialized from an existing shortcut.
   * @param {{ id: string, name: string, shortcut: string, template: string, providerId?: string }} shortcut
   */
  startEdit(shortcut) {
    this._open = true;
    this._id = shortcut.id;
    this._name = shortcut.name || '';
    this._accelerator = shortcut.shortcut || '';
    this._template = shortcut.template || '';
    this._providerId = shortcut.providerId || null;
    this._status = 'idle';
    this._conflictWith = null;
    this._generation++;
    this._emit();
  }

  /**
   * Close the session. All in-flight results become stale.
   */
  close() {
    this._open = false;
    this._id = null;
    this._name = '';
    this._accelerator = '';
    this._template = '';
    this._providerId = null;
    this._status = 'idle';
    this._conflictWith = null;
    this._generation++;
    this._emit();
  }

  // ------------------------------------------------------------------
  // Field updates
  // ------------------------------------------------------------------

  /**
   * @param {string} name
   */
  setName(name) {
    if (!this._open) return;
    this._name = name || '';
    this._emit();
  }

  /**
   * Update the accelerator. If the new value is a complete, valid combo,
   * triggers an async availability check. Stale results from prior checks
   * are ignored.
   * @param {string} accelerator
   */
  setAccelerator(accelerator) {
    if (!this._open) return;
    this._accelerator = accelerator || '';
    this._conflictWith = null;

    // Invalid or incomplete format — no adapter call needed
    if (!isValidShortcutFormat(this._accelerator)) {
      this._status = this._accelerator ? 'invalid' : 'idle';
      this._generation++;
      this._emit();
      return;
    }

    // Start a new async check
    this._status = 'checking';
    const gen = ++this._generation;
    const acc = this._accelerator;
    const excludeId = this._id;

    this._emit();

    this._adapter
      .checkAvailability(acc, excludeId)
      .then(result => {
        if (gen !== this._generation || !this._open) return;
        this._applyCheckResult(result);
      })
      .catch(() => {
        if (gen !== this._generation || !this._open) return;
        this._status = 'unavailable';
        this._conflictWith = null;
        this._emit();
      });
  }

  /**
   * @param {string} template
   */
  setTemplate(template) {
    if (!this._open) return;
    this._template = template || '';
    this._emit();
  }

  /**
   * @param {string | null} providerId
   */
  setProviderId(providerId) {
    if (!this._open) return;
    this._providerId = providerId || null;
    this._emit();
  }

  // ------------------------------------------------------------------
  // Query
  // ------------------------------------------------------------------

  /**
   * Returns a stable semantic snapshot of the current draft state.
   * @returns {DraftSnapshot}
   */
  getSnapshot() {
    return {
      id: this._id,
      name: this._name,
      accelerator: this._accelerator,
      template: this._template,
      providerId: this._providerId,
      status: this._status,
      conflictWith: this._conflictWith,
      open: this._open,
    };
  }

  /**
   * Subscribe to snapshot changes.
   * @param {(snapshot: DraftSnapshot) => void} listener
   * @returns {() => void} unsubscribe function
   */
  subscribe(listener) {
    this._listeners.push(listener);
    return () => {
      const idx = this._listeners.indexOf(listener);
      if (idx >= 0) this._listeners.splice(idx, 1);
    };
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  /**
   * Apply the result of an availability check to the current state.
   * Only called when the result is from the current generation.
   * @private
   */
  _applyCheckResult(result) {
    if (!result || typeof result.status !== 'string') {
      this._status = 'unavailable';
      this._conflictWith = null;
    } else {
      this._status = result.status;
      this._conflictWith = result.conflictWith || null;
    }
    this._emit();
  }

  /**
   * @private
   */
  _emit() {
    const snapshot = this.getSnapshot();
    for (const listener of this._listeners) {
      listener(snapshot);
    }
  }
}

// ---------------------------------------------------------------------------
// Dual-mode export
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ShortcutDraft, isValidShortcutFormat };
} else {
  // eslint-disable-next-line no-undef
  window.shortcutDraftModule = { ShortcutDraft, isValidShortcutFormat };
}
