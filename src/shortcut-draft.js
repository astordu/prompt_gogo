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
 * @property {(accelerator: string, excludeId: string | null, shortcutName: string | null) => Promise<{ accelerator: string } | null>} recommendShortcut
 * @property {(shortcut: Object) => Promise<{ success: true } | { success: false, reason: 'invalid' | 'internal-conflict' | 'external-conflict' | 'unavailable' | 'registration-failed' }>} saveShortcut
 * @property {() => Promise<{ shortcuts: Array, providers?: Array }>} getConfig
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
 *   - 'missing-name' — save blocked: name is empty
 *   - 'missing-shortcut' — save blocked: accelerator is empty
 *   - 'invalid-template' — save blocked: template empty or lacks a valid variable
 *   - 'missing-provider' — save blocked: no provider selected
 *   - 'saving' — atomic save in progress
 *   - 'saved' — save succeeded; authoritative snapshot available
 *   - 'save-failure' — save failed due to registration error
 * @property {string | null} conflictWith — name of conflicting shortcut (internal-conflict only)
 * @property {string | null} recommendation — recommended accelerator available for adoption (conflict states only)
 * @property {boolean} open — whether the session is active
 * @property {boolean} saving — whether an atomic save is in progress
 * @property {string | null} saveFailureReason — reason from the last save failure, or null
 * @property {{ shortcuts: Array, providers?: Array } | null} savedSnapshot — authoritative config snapshot after a successful save
 */

const MODIFIER_SET = new Set(['Control', 'Command', 'CommandOrControl', 'Alt', 'Shift']);

/**
 * Validate that a template string contains at least one known variable.
 * Reuses the Template domain rules from template.js (dual-mode).
 * @param {string} text
 * @returns {boolean}
 * @private
 */
function _templateHasVariable(text) {
  if (typeof module !== 'undefined' && module.exports) {
    return require('./template').validateTemplate(text);
  }
  // eslint-disable-next-line no-undef
  return window.templateModule.validateTemplate(text);
}

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
    this._recommendation = null;
    this._saving = false;
    this._saveFailureReason = null;
    this._savedSnapshot = null;
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
    this._recommendation = null;
    this._saving = false;
    this._saveFailureReason = null;
    this._savedSnapshot = null;
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
    this._recommendation = null;
    this._saving = false;
    this._saveFailureReason = null;
    this._savedSnapshot = null;
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
    this._recommendation = null;
    this._saving = false;
    this._saveFailureReason = null;
    this._savedSnapshot = null;
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
    this._saveFailureReason = null;
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
    this._recommendation = null;
    this._saveFailureReason = null;

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
        this._applyCheckResult(result, gen);
      })
      .catch(() => {
        if (gen !== this._generation || !this._open) return;
        this._status = 'unavailable';
        this._conflictWith = null;
        this._recommendation = null;
        this._emit();
      });
  }

  /**
   * @param {string} template
   */
  setTemplate(template) {
    if (!this._open) return;
    this._template = template || '';
    this._saveFailureReason = null;
    this._emit();
  }

  /**
   * @param {string | null} providerId
   */
  setProviderId(providerId) {
    if (!this._open) return;
    this._providerId = providerId || null;
    this._saveFailureReason = null;
    this._emit();
  }

  /**
   * Adopt the current recommendation. Re-checks the recommended accelerator
   * before applying. Only updates the draft if the re-check returns available.
   * If the recommendation has become stale (conflict / unavailable / invalid),
   * the current draft is preserved and the status reflects the re-check result.
   */
  adoptRecommendation() {
    if (!this._open || !this._recommendation) return;

    const recommended = this._recommendation;
    const excludeId = this._id;

    // Clear recommendation immediately; re-check will determine next state
    this._recommendation = null;
    this._status = 'checking';
    const gen = ++this._generation;

    this._emit();

    this._adapter
      .checkAvailability(recommended, excludeId)
      .then(result => {
        if (gen !== this._generation || !this._open) return;

        if (result && result.status === 'available') {
          // Adopt: update the draft accelerator to the recommended one
          this._accelerator = recommended;
          this._status = 'available';
          this._conflictWith = null;
          this._recommendation = null;
          this._emit();
        } else {
          // Recommendation is no longer available — apply the re-check result
          // which may be a new conflict (triggering a new recommendation),
          // unavailable, or invalid
          this._applyCheckResult(result, gen);
        }
      })
      .catch(() => {
        if (gen !== this._generation || !this._open) return;
        this._status = 'unavailable';
        this._conflictWith = null;
        this._recommendation = null;
        this._emit();
      });
  }

  // ------------------------------------------------------------------
  // Save (atomic)
  // ------------------------------------------------------------------

  /**
   * Validate all draft fields, then call the adapter's atomic saveShortcut.
   *
   * Validation produces a distinguishable semantic status for each missing
   * or invalid field. If validation passes, the save delegates entirely to
   * adapter.saveShortcut — no independent availability pre-check.
   *
   * Duplicate submissions while a save is in progress are ignored.
   *
   * On success, reads the authoritative config snapshot via adapter.getConfig
   * and exposes it in savedSnapshot. The session is then closed.
   *
   * On failure, the draft is preserved, the session stays open, and the
   * status reflects the failure reason. The user can modify and retry.
   */
  save() {
    if (!this._open || this._saving) return;

    // Validate all fields before touching the adapter
    const validationStatus = this._validateForSave();
    if (validationStatus) {
      this._status = validationStatus;
      this._saveFailureReason = null;
      this._emit();
      return;
    }

    // Enter saving state — bump generation so stale check/recommendation
    // results can't overwrite the save outcome.
    this._saving = true;
    this._saveFailureReason = null;
    this._status = 'saving';
    const gen = ++this._generation;

    const shortcut = {
      id: this._id,
      name: this._name,
      shortcut: this._accelerator,
      template: this._template,
      providerId: this._providerId,
    };

    this._emit();

    this._adapter
      .saveShortcut(shortcut)
      .then(result => {
        if (gen !== this._generation || !this._open) return;

        if (result && result.success) {
          // Read authoritative config snapshot
          this._adapter
            .getConfig()
            .then(config => {
              if (gen !== this._generation || !this._open) return;
              this._saving = false;
              this._savedSnapshot = config;
              this._status = 'saved';
              this._open = false;
              this._emit();
            })
            .catch(() => {
              if (gen !== this._generation || !this._open) return;
              this._saving = false;
              this._status = 'saved';
              this._open = false;
              this._emit();
            });
        } else {
          // Save failed — map reason to semantic status, preserve draft
          this._saving = false;
          const reason =
            result && /** @type {{ reason?: string }} */ (result).reason
              ? /** @type {{ reason: string }} */ (result).reason
              : 'registration-failed';
          this._saveFailureReason = reason;
          this._applySaveFailureStatus(reason);
          this._emit();
        }
      })
      .catch(() => {
        if (gen !== this._generation || !this._open) return;
        this._saving = false;
        this._saveFailureReason = 'registration-failed';
        this._status = 'save-failure';
        this._emit();
      });
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
      recommendation: this._recommendation,
      open: this._open,
      saving: this._saving,
      saveFailureReason: this._saveFailureReason,
      savedSnapshot: this._savedSnapshot,
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
   * Validate all draft fields for saving.
   * Returns a semantic status string for the first failure, or null if valid.
   * @returns {string | null}
   * @private
   */
  _validateForSave() {
    if (!this._name || !this._name.trim()) return 'missing-name';
    if (!this._accelerator) return 'missing-shortcut';
    if (!isValidShortcutFormat(this._accelerator)) return 'invalid';
    if (!this._template || !this._template.trim()) return 'invalid-template';
    if (!_templateHasVariable(this._template)) return 'invalid-template';
    if (!this._providerId) return 'missing-provider';
    return null;
  }

  /**
   * Map an atomic save failure reason to a stable semantic status.
   * Clears stale conflict/recommendation data unless the failure is a conflict.
   * For conflict states, triggers a recommendation request (consistent with
   * the editing flow). The caller is responsible for emitting.
   * @param {string} reason
   * @private
   */
  _applySaveFailureStatus(reason) {
    switch (reason) {
      case 'invalid':
        this._status = 'invalid';
        this._conflictWith = null;
        this._recommendation = null;
        break;
      case 'internal-conflict':
      case 'external-conflict':
        this._status = reason;
        this._requestRecommendation(this._generation);
        break;
      case 'unavailable':
        this._status = 'unavailable';
        this._conflictWith = null;
        this._recommendation = null;
        break;
      case 'registration-failed':
      default:
        this._status = 'save-failure';
        this._conflictWith = null;
        this._recommendation = null;
        break;
    }
  }

  /**
   * Apply the result of an availability check to the current state.
   * Only called when the result is from the current generation.
   * If the result is a conflict, triggers a recommendation request.
   * @param {Object} result
   * @param {number} gen — the generation of the check that produced this result
   * @private
   */
  _applyCheckResult(result, gen) {
    if (!result || typeof result.status !== 'string') {
      this._status = 'unavailable';
      this._conflictWith = null;
      this._recommendation = null;
    } else {
      this._status = result.status;
      this._conflictWith = result.conflictWith || null;
    }

    // Request recommendation only for conflict states
    if (this._status === 'internal-conflict' || this._status === 'external-conflict') {
      this._requestRecommendation(gen);
      // Emit immediately with conflict status; recommendation arrives async
      this._emit();
    } else {
      this._recommendation = null;
      this._emit();
    }
  }

  /**
   * Request a recommendation from the adapter. Uses the same generation
   * mechanism so stale recommendations are discarded.
   * @param {number} _gen — the generation of the check that triggered this rec
   * @private
   */
  _requestRecommendation(_gen) {
    const acc = this._accelerator;
    const excludeId = this._id;
    const shortcutName = this._name || null;

    // Bump generation so the recommendation has its own token; any
    // subsequent setAccelerator / session change will bump again and
    // invalidate this pending recommendation.
    const recGen = ++this._generation;

    this._adapter
      .recommendShortcut(acc, excludeId, shortcutName)
      .then(rec => {
        if (recGen !== this._generation || !this._open) return;
        // Only apply if still in conflict state for the same accelerator
        if (this._accelerator !== acc) return;
        if (this._status !== 'internal-conflict' && this._status !== 'external-conflict') return;

        this._recommendation = rec && rec.accelerator ? rec.accelerator : null;
        this._emit();
      })
      .catch(() => {
        if (recGen !== this._generation || !this._open) return;
        this._recommendation = null;
        this._emit();
      });
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
