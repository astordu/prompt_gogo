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
  // Save (create or update) — preserves existing behavior
  // ------------------------------------------------------------------

  /**
   * Save a shortcut (upsert by id).
   * Currently does a full re-registration to match existing behavior.
   * Future issues (#22) will make this atomic.
   * @param {Object} shortcut
   * @returns {{ success: true }}
   */
  saveShortcut(shortcut) {
    const shortcuts = this.store.getShortcuts();
    const index = shortcuts.findIndex(s => s.id === shortcut.id);

    if (index >= 0) {
      shortcuts[index] = shortcut;
    } else {
      shortcuts.push(shortcut);
    }

    this.store.setShortcuts(shortcuts);
    this.registerAllAtStartup();
    return { success: true };
  }

  // ------------------------------------------------------------------
  // Delete
  // ------------------------------------------------------------------

  /**
   * Delete a shortcut by id.
   * Currently does a full re-registration to match existing behavior.
   * Future issues (#22) will make this atomic.
   * @param {string} id
   * @returns {{ success: true }}
   */
  deleteShortcut(id) {
    const shortcuts = this.store.getShortcuts().filter(s => s.id !== id);
    this.store.setShortcuts(shortcuts);
    this.registerAllAtStartup();
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
