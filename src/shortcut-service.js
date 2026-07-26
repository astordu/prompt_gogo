'use strict';

/**
 * Shortcut management service — the single high-level seam for the Shortcut
 * lifecycle: startup registration, triggering, saving, and deleting.
 *
 * System shortcut registrar and config store are injected dependencies so
 * tests can simulate success, rejection, and exceptions without touching
 * Electron internals.
 */

// ---------------------------------------------------------------------------
// Default registrar / store adapters (thin wrappers around Electron APIs)
// ---------------------------------------------------------------------------

/**
 * Wraps Electron's globalShortcut into the registrar interface.
 * @param {Electron.GlobalShortcut} gs
 * @returns {ShortcutRegistrar}
 */
function createElectronRegistrar(gs) {
  return {
    register(accelerator, callback) {
      return gs.register(accelerator, callback);
    },
    unregister(accelerator) {
      gs.unregister(accelerator);
    },
    unregisterAll() {
      gs.unregisterAll();
    },
    isRegistered(accelerator) {
      return gs.isRegistered(accelerator);
    },
  };
}

/**
 * Wraps electron-store into the config-store interface for shortcuts.
 * @param {{ get: Function, set: Function }} storeLike
 * @returns {ShortcutStore}
 */
function createElectronStore(storeLike) {
  return {
    getShortcuts() {
      return storeLike.get('shortcuts') || [];
    },
    setShortcuts(shortcuts) {
      storeLike.set('shortcuts', shortcuts);
    },
  };
}

// ---------------------------------------------------------------------------
// ShortcutService
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ShortcutRegistrar
 * @property {(accelerator: string, callback: () => void) => boolean} register
 * @property {(accelerator: string) => void} unregister
 * @property {() => void} unregisterAll
 * @property {(accelerator: string) => boolean} isRegistered
 */

/**
 * @typedef {Object} ShortcutStore
 * @property {() => Array} getShortcuts
 * @property {(shortcuts: Array) => void} setShortcuts
 */

/**
 * @typedef {Object} ShortcutServiceOptions
 * @property {ShortcutRegistrar} registrar
 * @property {ShortcutStore} store
 * @property {(shortcutConfig: Object) => void} [onTrigger]
 * @property {(title: string, body: string) => void} [onNotify]
 */

class ShortcutService {
  /**
   * @param {ShortcutServiceOptions} opts
   */
  constructor(opts) {
    this.registrar = opts.registrar;
    this.store = opts.store;
    this.onTrigger = opts.onTrigger || (() => {});
    this.onNotify = opts.onNotify || (() => {});
    /** @type {Map<string, Object>} accelerator → shortcutConfig */
    this._registered = new Map();
  }

  // ------------------------------------------------------------------
  // Registration
  // ------------------------------------------------------------------

  /**
   * Register all persisted shortcuts at startup.
   * Unregisters everything first (full reset), then iterates the store.
   * Calls onNotify once with a summary if any shortcuts fail.
   */
  registerAllAtStartup() {
    this.registrar.unregisterAll();
    this._registered.clear();

    const shortcuts = this.store.getShortcuts() || [];
    const failedNames = [];

    for (const sc of shortcuts) {
      const result = this._tryRegister(sc);
      if (!result.ok) {
        failedNames.push(sc.name);
      }
    }

    if (failedNames.length > 0) {
      this.onNotify(
        '快捷键注册失败',
        `以下快捷键无法注册: ${failedNames.join(', ')}。可能被其他应用占用。`
      );
    }
  }

  /**
   * Attempt to register a single shortcut config.
   * @private
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  _tryRegister(sc) {
    if (this._registered.has(sc.shortcut)) {
      return { ok: false, reason: 'duplicate' };
    }

    try {
      const ok = this.registrar.register(sc.shortcut, () => {
        this.onTrigger(sc);
      });

      if (!ok) {
        return { ok: false, reason: 'rejected' };
      }

      this._registered.set(sc.shortcut, sc);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'exception' };
    }
  }

  // ------------------------------------------------------------------
  // Availability check (dry-run, no side effects)
  // ------------------------------------------------------------------

  /**
   * Check whether a candidate accelerator is valid and currently available
   * for registration, without persisting anything or changing existing
   * registrations.
   *
   * @param {string} accelerator - Electron accelerator string (e.g. "Control+Alt+9")
   * @param {string} [excludeId] - Shortcut id being edited (its own accelerator is not a conflict)
   * @returns {{ status: 'invalid' } | { status: 'available' } | { status: 'internal-conflict', conflictWith: string } | { status: 'external-conflict' } | { status: 'unavailable' }}
   */
  checkAvailability(accelerator, excludeId) {
    // 1. Validate input: at least two modifiers + one regular key
    if (!accelerator || typeof accelerator !== 'string') {
      return { status: 'invalid' };
    }

    const parts = accelerator.split('+');
    const modifierSet = new Set(['Control', 'Command', 'CommandOrControl', 'Alt', 'Shift']);
    const modifiers = parts.filter(p => modifierSet.has(p));
    const nonModifiers = parts.filter(p => !modifierSet.has(p));

    if (modifiers.length < 2 || nonModifiers.length < 1) {
      return { status: 'invalid' };
    }

    // 2. Internal conflict: check against all persisted shortcuts except the one being edited
    const shortcuts = this.store.getShortcuts() || [];
    for (const sc of shortcuts) {
      if (excludeId && sc.id === excludeId) continue;
      if (sc.shortcut === accelerator) {
        return { status: 'internal-conflict', conflictWith: sc.name };
      }
    }

    // 3. If the accelerator is already actively registered by us (and not excluded),
    //    it's an internal conflict too. This covers session-only registrations.
    //    But if excludeId matches the owner, skip.
    if (this._registered.has(accelerator)) {
      // Check if it's registered by the excluded shortcut
      const registeredSc = this._registered.get(accelerator);
      if (!excludeId || (registeredSc && registeredSc.id !== excludeId)) {
        const name = registeredSc ? registeredSc.name : accelerator;
        return { status: 'internal-conflict', conflictWith: name };
      }
    }

    // 4. External conflict: attempt a temporary registration
    try {
      const ok = this.registrar.register(accelerator, () => {});
      if (ok) {
        // Immediately unregister — this was just a probe
        this.registrar.unregister(accelerator);
        return { status: 'available' };
      }
      return { status: 'external-conflict' };
    } catch {
      return { status: 'unavailable' };
    }
  }

  // ------------------------------------------------------------------
  // Save (atomic create or update)
  // ------------------------------------------------------------------

  /**
   * Atomically save a shortcut.
   *
   * Performs a fresh availability check first. If the check does not
   * return 'available', nothing is written and the failure reason is
   * returned so the UI can preserve the draft.
   *
   * On success, only the target shortcut is affected:
   * - Editing: the old accelerator is unregistered, the new one is
   *   registered, then config is persisted. If registration of the new
   *   accelerator fails, the old accelerator is left registered and the
   *   config is not changed.
   * - Creating: the new accelerator is registered, then config is
   *   persisted. If registration fails, nothing is written.
   *
   * Other shortcuts are never unregistered or re-registered.
   *
   * @param {Object} shortcut
   * @returns {{ success: true } | { success: false, reason: 'invalid' | 'internal-conflict' | 'external-conflict' | 'unavailable' | 'registration-failed' }}
   */
  saveShortcut(shortcut) {
    // 1. Fresh availability re-check (guard against status changes)
    const check = this.checkAvailability(shortcut.shortcut, shortcut.id);
    if (check.status !== 'available') {
      return { success: false, reason: check.status };
    }

    // 2. Find existing shortcut (if editing)
    const shortcuts = this.store.getShortcuts();
    const existingIndex = shortcuts.findIndex(s => s.id === shortcut.id);
    const existing = existingIndex >= 0 ? shortcuts[existingIndex] : null;

    // 3. For an edit with a changed accelerator: try to register the new
    //    one first. If it fails, the old one stays untouched.
    if (existing && existing.shortcut !== shortcut.shortcut) {
      const regResult = this._tryRegister(shortcut);
      if (!regResult.ok) {
        return { success: false, reason: 'registration-failed' };
      }
      // New one registered — now unregister the old one
      this._unregisterOne(existing.shortcut);
    } else if (existing && existing.shortcut === shortcut.shortcut) {
      // Same accelerator, just update the config/callback in the
      // registrar map by re-registering
      this._unregisterOne(existing.shortcut);
      const regResult = this._tryRegister(shortcut);
      if (!regResult.ok) {
        // Should not happen since we just unregistered it, but handle anyway
        return { success: false, reason: 'registration-failed' };
      }
    } else {
      // 4. New shortcut (create)
      const regResult = this._tryRegister(shortcut);
      if (!regResult.ok) {
        return { success: false, reason: 'registration-failed' };
      }
    }

    // 5. Persist to store
    const next = shortcuts.slice();
    if (existingIndex >= 0) {
      next[existingIndex] = shortcut;
    } else {
      next.push(shortcut);
    }
    this.store.setShortcuts(next);

    return { success: true };
  }

  /**
   * Unregister a single accelerator from both the registrar and the
   * internal map.
   * @private
   */
  _unregisterOne(accelerator) {
    if (this._registered.has(accelerator)) {
      try {
        this.registrar.unregister(accelerator);
      } catch {
        // Best effort — the accelerator may already be gone
      }
      this._registered.delete(accelerator);
    }
  }

  // ------------------------------------------------------------------
  // Delete (atomic)
  // ------------------------------------------------------------------

  /**
   * Atomically delete a shortcut by id.
   *
   * Only the target shortcut is unregistered. Other shortcuts are never
   * touched.
   * @param {string} id
   * @returns {{ success: true }}
   */
  deleteShortcut(id) {
    const shortcuts = this.store.getShortcuts();
    const target = shortcuts.find(s => s.id === id);

    if (target) {
      this._unregisterOne(target.shortcut);
    }

    const next = shortcuts.filter(s => s.id !== id);
    this.store.setShortcuts(next);

    return { success: true };
  }

  // ------------------------------------------------------------------
  // Query
  // ------------------------------------------------------------------

  /**
   * Get all persisted shortcuts.
   * @returns {Array}
   */
  getShortcuts() {
    return this.store.getShortcuts();
  }

  /**
   * Get the set of accelerators currently registered in this session.
   * @returns {string[]}
   */
  getRegisteredAccelerators() {
    return Array.from(this._registered.keys());
  }

  /**
   * Check whether a given accelerator is currently registered.
   * @param {string} accelerator
   * @returns {boolean}
   */
  isAcceleratorActive(accelerator) {
    return this._registered.has(accelerator);
  }

  // ------------------------------------------------------------------
  // Cleanup
  // ------------------------------------------------------------------

  /**
   * Unregister all shortcuts (call on app quit).
   */
  dispose() {
    this.registrar.unregisterAll();
    this._registered.clear();
  }
}

module.exports = {
  ShortcutService,
  createElectronRegistrar,
  createElectronStore,
};
