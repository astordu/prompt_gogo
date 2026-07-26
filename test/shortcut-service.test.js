'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ShortcutService } = require('../src/shortcut-service');

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Fake registrar that tracks register/unregister calls.
 * configurable per-accelerator outcomes.
 */
function createFakeRegistrar() {
  const registered = new Map(); // accelerator → callback
  const rejectedSet = new Set(); // accelerators that should fail to register
  let throwOnRegister = null; // accelerator that throws on register

  return {
    register(accelerator, callback) {
      if (throwOnRegister === accelerator) {
        throw new Error('Registrar crashed for ' + accelerator);
      }
      if (rejectedSet.has(accelerator)) {
        return false;
      }
      registered.set(accelerator, callback);
      return true;
    },
    unregister(accelerator) {
      registered.delete(accelerator);
    },
    unregisterAll() {
      registered.clear();
    },
    isRegistered(accelerator) {
      return registered.has(accelerator);
    },
    // --- test helpers ---
    _trigger(accelerator) {
      const cb = registered.get(accelerator);
      if (cb) cb();
    },
    _has(accelerator) {
      return registered.has(accelerator);
    },
    _size() {
      return registered.size;
    },
    _reject(accelerator) {
      rejectedSet.add(accelerator);
    },
    _throwOn(accelerator) {
      throwOnRegister = accelerator;
    },
  };
}

/**
 * In-memory store mimicking electron-store for shortcuts.
 */
function createFakeStore(shortcuts) {
  let data = shortcuts ? shortcuts.slice() : [];
  return {
    getShortcuts() {
      return data.slice();
    },
    setShortcuts(next) {
      data = next.slice();
    },
  };
}

/**
 * Collects notifications for assertion.
 */
function createFakeNotifier() {
  const notifications = [];
  return {
    notify(title, body) {
      notifications.push({ title, body });
    },
    _all() {
      return notifications;
    },
    _clear() {
      notifications.length = 0;
    },
  };
}

/**
 * Collects triggers for assertion.
 */
function createFakeTriggerHandler() {
  const triggers = [];
  return {
    handle(sc) {
      triggers.push(sc);
    },
    _all() {
      return triggers;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper to wire up a service with all fakes.
// ---------------------------------------------------------------------------

function makeService(opts = {}) {
  const registrar = opts.registrar || createFakeRegistrar();
  const store = opts.store || createFakeStore(opts.shortcuts);
  const notifier = opts.notifier || createFakeNotifier();
  const triggerHandler = opts.triggerHandler || createFakeTriggerHandler();

  const service = new ShortcutService({
    registrar,
    store,
    onTrigger: (sc) => triggerHandler.handle(sc),
    onNotify: (title, body) => notifier.notify(title, body),
  });

  return { service, registrar, store, notifier, triggerHandler };
}

// ---------------------------------------------------------------------------
// Tests: startup registration
// ---------------------------------------------------------------------------

describe('registerAllAtStartup — happy path', () => {
  test('registers all shortcuts from store', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    assert.strictEqual(registrar._size(), 2);
    assert.ok(registrar._has('CommandOrControl+Shift+A'));
    assert.ok(registrar._has('CommandOrControl+Shift+B'));
  });

  test('clears existing registrations before re-registering', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });

    // Pre-register something that should be gone after registerAllAtStartup
    registrar.register('Alt+F4', () => {});
    assert.strictEqual(registrar._size(), 1);

    service.registerAllAtStartup();
    assert.strictEqual(registrar._size(), 1);
    assert.ok(!registrar._has('Alt+F4'));
    assert.ok(registrar._has('CommandOrControl+Shift+A'));
  });

  test('handles empty shortcuts array', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    service.registerAllAtStartup();
    assert.strictEqual(registrar._size(), 0);
  });

  test('handles store with no shortcuts key (undefined)', () => {
    const store = createFakeStore(undefined);
    // simulate electron-store returning undefined
    store.getShortcuts = () => undefined;
    const { service, registrar } = makeService({ store });
    // should not throw
    service.registerAllAtStartup();
    assert.strictEqual(registrar._size(), 0);
  });
});

describe('registerAllAtStartup — partial failures', () => {
  test('one failing shortcut does not block others', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
      { id: '3', name: 'C', shortcut: 'CommandOrControl+Shift+C', template: 't3' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    registrar._reject('CommandOrControl+Shift+B');

    service.registerAllAtStartup();

    assert.strictEqual(registrar._size(), 2);
    assert.ok(registrar._has('CommandOrControl+Shift+A'));
    assert.ok(!registrar._has('CommandOrControl+Shift+B'));
    assert.ok(registrar._has('CommandOrControl+Shift+C'));
  });

  test('sends a summary notification when shortcuts fail', () => {
    const shortcuts = [
      { id: '1', name: 'OK', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'BadOne', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
    ];
    const { service, registrar, notifier } = makeService({ shortcuts });
    registrar._reject('CommandOrControl+Shift+B');

    service.registerAllAtStartup();

    const notes = notifier._all();
    assert.strictEqual(notes.length, 1);
    assert.ok(notes[0].body.includes('BadOne'));
  });

  test('does not send notification when all succeed', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service, notifier } = makeService({ shortcuts });
    service.registerAllAtStartup();
    assert.strictEqual(notifier._all().length, 0);
  });

  test('registrar exception during one shortcut does not crash the loop', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
    ];
    const { service, registrar, notifier } = makeService({ shortcuts });
    registrar._throwOn('CommandOrControl+Shift+B');

    // Should not throw
    service.registerAllAtStartup();

    // First shortcut still registered
    assert.ok(registrar._has('CommandOrControl+Shift+A'));
    // Notification about the failed one
    assert.strictEqual(notifier._all().length, 1);
    assert.ok(notifier._all()[0].body.includes('B'));
  });

  test('internal duplicate accelerators: second is dropped, first kept', () => {
    const shortcuts = [
      { id: '1', name: 'First', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'Second', shortcut: 'CommandOrControl+Shift+A', template: 't2' },
    ];
    const { service, registrar, notifier } = makeService({ shortcuts });
    service.registerAllAtStartup();

    assert.strictEqual(registrar._size(), 1);
    assert.ok(registrar._has('CommandOrControl+Shift+A'));
    assert.strictEqual(notifier._all().length, 1);
    assert.ok(notifier._all()[0].body.includes('Second'));
  });
});

// ---------------------------------------------------------------------------
// Tests: triggering
// ---------------------------------------------------------------------------

describe('triggering shortcuts', () => {
  test('onTrigger is called with the shortcut config when registrar fires', () => {
    const shortcuts = [
      { id: '1', name: 'Test', shortcut: 'CommandOrControl+Shift+T', template: 'hello @select_content' },
    ];
    const { service, registrar, triggerHandler } = makeService({ shortcuts });
    service.registerAllAtStartup();

    registrar._trigger('CommandOrControl+Shift+T');

    assert.strictEqual(triggerHandler._all().length, 1);
    assert.strictEqual(triggerHandler._all()[0].id, '1');
    assert.strictEqual(triggerHandler._all()[0].name, 'Test');
  });

  test('multiple shortcuts trigger independently', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
    ];
    const { service, registrar, triggerHandler } = makeService({ shortcuts });
    service.registerAllAtStartup();

    registrar._trigger('CommandOrControl+Shift+B');
    registrar._trigger('CommandOrControl+Shift+A');

    assert.strictEqual(triggerHandler._all().length, 2);
    assert.strictEqual(triggerHandler._all()[0].name, 'B');
    assert.strictEqual(triggerHandler._all()[1].name, 'A');
  });
});

// ---------------------------------------------------------------------------
// Tests: saveShortcut (atomic create)
// ---------------------------------------------------------------------------

describe('saveShortcut — create (atomic)', () => {
  test('adds new shortcut to store and registers it', () => {
    const { service, registrar, store } = makeService({ shortcuts: [] });
    const sc = { id: '10', name: 'New', shortcut: 'CommandOrControl+Shift+N', template: 't' };

    const result = service.saveShortcut(sc);

    assert.deepStrictEqual(result, { success: true });
    const stored = store.getShortcuts();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].id, '10');
    assert.ok(registrar._has('CommandOrControl+Shift+N'));
  });

  test('write succeeds only after registration succeeds', () => {
    const { service, registrar, store } = makeService({ shortcuts: [] });
    registrar._reject('CommandOrControl+Shift+N');

    const result = service.saveShortcut({ id: '10', name: 'New', shortcut: 'CommandOrControl+Shift+N', template: 't' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'external-conflict');
    // Config must not be written
    assert.strictEqual(store.getShortcuts().length, 0);
  });

  test('create with invalid accelerator does not write config', () => {
    const { service, store } = makeService({ shortcuts: [] });
    const result = service.saveShortcut({ id: '10', name: 'Bad', shortcut: 'Control+9', template: 't' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'invalid');
    assert.strictEqual(store.getShortcuts().length, 0);
  });

  test('other shortcuts are never unregistered during create', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.saveShortcut({ id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' });

    // Original shortcut must still be registered
    assert.ok(registrar._has('Control+Alt+A'));
    assert.ok(registrar._has('Control+Alt+B'));
  });
});

// ---------------------------------------------------------------------------
// Tests: saveShortcut (atomic update)
// ---------------------------------------------------------------------------

describe('saveShortcut — update (atomic)', () => {
  test('updates shortcut and atomically replaces accelerator', () => {
    const shortcuts = [
      { id: '1', name: 'Old', shortcut: 'Control+Alt+O', template: 'old' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();
    const updated = { id: '1', name: 'New', shortcut: 'Control+Alt+N', template: 'new' };

    service.saveShortcut(updated);

    const stored = store.getShortcuts();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].name, 'New');
    assert.ok(!registrar._has('Control+Alt+O'));
    assert.ok(registrar._has('Control+Alt+N'));
  });

  test('other shortcuts remain registered after update', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.saveShortcut({ id: '1', name: 'A2', shortcut: 'Control+Alt+C', template: 't1b' });

    // B should still be registered — never touched
    assert.ok(registrar._has('Control+Alt+B'));
    // Old A unregistered, new C registered
    assert.ok(!registrar._has('Control+Alt+A'));
    assert.ok(registrar._has('Control+Alt+C'));
  });

  test('edit conflict detected before save: old shortcut still registered', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    // Try to edit #1 to use #2's accelerator
    const result = service.saveShortcut({ id: '1', name: 'A-edited', shortcut: 'Control+Alt+B', template: 't1' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'internal-conflict');
    // Old config unchanged
    const stored = store.getShortcuts();
    assert.strictEqual(stored[0].name, 'A');
    // Both originals still registered
    assert.ok(registrar._has('Control+Alt+A'));
    assert.ok(registrar._has('Control+Alt+B'));
  });

  test('edit registration fails: old accelerator stays registered, config unchanged', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    // Make the new accelerator fail to register after availability check passes.
    // The availability check does a probe register+unregister. If the probe
    // succeeds but the actual register fails, that's the race condition.
    // We simulate this by rejecting only after the probe.
    let probeDone = false;
    const origRegister = registrar.register.bind(registrar);
    registrar.register = function(accelerator, callback) {
      if (accelerator === 'Control+Alt+C' && probeDone) {
        return false;
      }
      return origRegister(accelerator, callback);
    };
    // Wrap checkAvailability so it sets probeDone after
    const origCheck = service.checkAvailability.bind(service);
    service.checkAvailability = function(...args) {
      const result = origCheck(...args);
      probeDone = true;
      return result;
    };

    const result = service.saveShortcut({ id: '1', name: 'A-edited', shortcut: 'Control+Alt+C', template: 't1b' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'registration-failed');
    // Old config unchanged
    assert.strictEqual(store.getShortcuts()[0].shortcut, 'Control+Alt+A');
    // Old accelerator still registered
    assert.ok(registrar._has('Control+Alt+A'));
  });

  test('save status changed to unavailable: old shortcut still registered', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    // Make the registrar throw on the new accelerator
    registrar._throwOn('Control+Alt+C');

    const result = service.saveShortcut({ id: '1', name: 'A-edited', shortcut: 'Control+Alt+C', template: 't1b' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'unavailable');
    // Old config unchanged
    assert.strictEqual(store.getShortcuts()[0].shortcut, 'Control+Alt+A');
    // Old accelerator still registered
    assert.ok(registrar._has('Control+Alt+A'));
  });

  test('updating same accelerator (different name/template) keeps registration', () => {
    const shortcuts = [
      { id: '1', name: 'Old', shortcut: 'Control+Alt+A', template: 'old' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.saveShortcut({ id: '1', name: 'New Name', shortcut: 'Control+Alt+A', template: 'new template' });

    // Same accelerator still registered
    assert.ok(registrar._has('Control+Alt+A'));
    // Config updated
    const stored = store.getShortcuts();
    assert.strictEqual(stored[0].name, 'New Name');
    assert.strictEqual(stored[0].template, 'new template');
  });
});

// ---------------------------------------------------------------------------
// Tests: deleteShortcut (atomic)
// ---------------------------------------------------------------------------

describe('deleteShortcut (atomic)', () => {
  test('removes shortcut from store and unregisters only target', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.deleteShortcut('1');

    const stored = store.getShortcuts();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].id, '2');
    assert.ok(!registrar._has('Control+Alt+A'));
    assert.ok(registrar._has('Control+Alt+B'));
  });

  test('deleting non-existent id is a no-op', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
    ];
    const { service, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.deleteShortcut('nonexistent');

    assert.strictEqual(store.getShortcuts().length, 1);
  });

  test('returns success', () => {
    const { service } = makeService({ shortcuts: [] });
    const result = service.deleteShortcut('x');
    assert.deepStrictEqual(result, { success: true });
  });

  test('other shortcuts are never unregistered or re-registered', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' },
      { id: '3', name: 'C', shortcut: 'Control+Alt+C', template: 't3' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.deleteShortcut('2');

    // A and C untouched
    assert.ok(registrar._has('Control+Alt+A'));
    assert.ok(registrar._has('Control+Alt+C'));
    // B gone
    assert.ok(!registrar._has('Control+Alt+B'));
  });
});

// ---------------------------------------------------------------------------
// Tests: atomic behavior — unrelated shortcuts never touched
// ---------------------------------------------------------------------------

describe('atomic operations — no unregister-all strategy', () => {
  test('saveShortcut does not call unregisterAll', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    let unregisterAllCalled = false;
    const origUnregisterAll = registrar.unregisterAll;
    registrar.unregisterAll = () => { unregisterAllCalled = true; };

    service.saveShortcut({ id: '3', name: 'C', shortcut: 'Control+Alt+C', template: 't3' });

    assert.ok(!unregisterAllCalled, 'unregisterAll must not be called during save');
  });

  test('deleteShortcut does not call unregisterAll', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    let unregisterAllCalled = false;
    const origUnregisterAll = registrar.unregisterAll;
    registrar.unregisterAll = () => { unregisterAllCalled = true; };

    service.deleteShortcut('1');

    assert.ok(!unregisterAllCalled, 'unregisterAll must not be called during delete');
  });

  test('saveShortcut with conflict does not touch any registration', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'Control+Alt+B', template: 't2' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    let unregisterCalled = false;
    const origUnregister = registrar.unregister;
    registrar.unregister = () => { unregisterCalled = true; };

    // Save with conflicting accelerator
    service.saveShortcut({ id: '3', name: 'C', shortcut: 'Control+Alt+A', template: 't3' });

    assert.ok(!unregisterCalled, 'unregister must not be called on failed save');
  });
});

// ---------------------------------------------------------------------------
// Tests: legacy single-modifier compatibility
// ---------------------------------------------------------------------------

describe('legacy single-modifier shortcut compatibility', () => {
  test('single-modifier shortcut registered at startup still works', () => {
    const shortcuts = [
      { id: '1', name: 'Legacy', shortcut: 'Control+9', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();
    // Should be registered since startup registration doesn't validate
    assert.ok(registrar._has('Control+9'));
  });

  test('editing a legacy shortcut and saving must pass new validation rules', () => {
    const shortcuts = [
      { id: '1', name: 'Legacy', shortcut: 'Control+9', template: 't1' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    // Try to save with a single-modifier shortcut
    const result = service.saveShortcut({ id: '1', name: 'Legacy-edited', shortcut: 'Control+8', template: 't1b' });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.reason, 'invalid');
    // Old shortcut config unchanged
    assert.strictEqual(store.getShortcuts()[0].shortcut, 'Control+9');
    // Old shortcut still registered
    assert.ok(registrar._has('Control+9'));
  });
});

// ---------------------------------------------------------------------------
// Tests: getShortcuts / isAcceleratorActive
// ---------------------------------------------------------------------------

describe('getShortcuts', () => {
  test('returns current shortcuts from store', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service } = makeService({ shortcuts });
    const result = service.getShortcuts();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, '1');
  });

  test('returns a copy, not a reference to the store array', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service, store } = makeService({ shortcuts });
    const a = service.getShortcuts();
    const b = service.getShortcuts();
    assert.notStrictEqual(a, b);
  });
});

describe('getRegisteredAccelerators', () => {
  test('returns currently registered accelerators', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
    ];
    const { service } = makeService({ shortcuts });
    service.registerAllAtStartup();

    const accels = service.getRegisteredAccelerators();
    assert.strictEqual(accels.length, 2);
    assert.ok(accels.includes('CommandOrControl+Shift+A'));
    assert.ok(accels.includes('CommandOrControl+Shift+B'));
  });
});

describe('isAcceleratorActive', () => {
  test('true for registered accelerator', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service } = makeService({ shortcuts });
    service.registerAllAtStartup();
    assert.ok(service.isAcceleratorActive('CommandOrControl+Shift+A'));
  });

  test('false for unregistered accelerator', () => {
    const { service } = makeService({ shortcuts: [] });
    assert.ok(!service.isAcceleratorActive('CommandOrControl+Shift+Z'));
  });
});

// ---------------------------------------------------------------------------
// Tests: dispose
// ---------------------------------------------------------------------------

describe('dispose', () => {
  test('unregisters everything and clears internal state', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.dispose();

    assert.strictEqual(registrar._size(), 0);
    assert.strictEqual(service.getRegisteredAccelerators().length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: checkAvailability
// ---------------------------------------------------------------------------

describe('checkAvailability — validation', () => {
  test('returns invalid for fewer than two modifiers', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    const result = service.checkAvailability('Control+9');
    assert.strictEqual(result.status, 'invalid');
    // Must not call registrar for invalid input
    assert.strictEqual(registrar._size(), 0);
  });

  test('returns invalid for modifiers only (no regular key)', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    const result = service.checkAvailability('Control+Shift');
    assert.strictEqual(result.status, 'invalid');
    assert.strictEqual(registrar._size(), 0);
  });

  test('returns invalid for empty string', () => {
    const { service } = makeService({ shortcuts: [] });
    const result = service.checkAvailability('');
    assert.strictEqual(result.status, 'invalid');
  });

  test('returns invalid for null/undefined', () => {
    const { service } = makeService({ shortcuts: [] });
    assert.strictEqual(service.checkAvailability(null).status, 'invalid');
    assert.strictEqual(service.checkAvailability(undefined).status, 'invalid');
  });

  test('does not call system registrar for invalid input', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    service.checkAvailability('Control+9');
    // Registrar should have zero entries since no probe was attempted
    assert.strictEqual(registrar._size(), 0);
  });
});

describe('checkAvailability — available', () => {
  test('returns available for a valid, unoccupied combo', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    const result = service.checkAvailability('Control+Alt+9');
    assert.strictEqual(result.status, 'available');
    // Probe must not leave a lingering registration
    assert.strictEqual(registrar._size(), 0);
  });

  test('does not change persisted configuration', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service, store } = makeService({ shortcuts });
    service.checkAvailability('Control+Alt+8');
    const stored = store.getShortcuts();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].shortcut, 'Control+Alt+9');
  });

  test('does not unregister existing shortcuts', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();
    assert.ok(registrar._has('Control+Alt+9'));

    service.checkAvailability('Control+Alt+8');

    // The existing shortcut must still be registered
    assert.ok(registrar._has('Control+Alt+9'));
  });
});

describe('checkAvailability — internal conflict', () => {
  test('returns internal-conflict when matching another persisted shortcut', () => {
    const shortcuts = [
      { id: '1', name: '整理文本', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service } = makeService({ shortcuts });
    const result = service.checkAvailability('Control+Alt+9');
    assert.strictEqual(result.status, 'internal-conflict');
    assert.strictEqual(result.conflictWith, '整理文本');
  });

  test('editing a shortcut does not conflict with itself', () => {
    const shortcuts = [
      { id: '1', name: '整理文本', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service } = makeService({ shortcuts });
    const result = service.checkAvailability('Control+Alt+9', '1');
    assert.strictEqual(result.status, 'available');
  });

  test('internal conflict reports the correct shortcut name', () => {
    const shortcuts = [
      { id: '1', name: '翻译', shortcut: 'Control+Alt+0', template: 't1' },
      { id: '2', name: '总结', shortcut: 'Control+Alt+9', template: 't2' },
    ];
    const { service } = makeService({ shortcuts });
    const result = service.checkAvailability('Control+Alt+9');
    assert.strictEqual(result.status, 'internal-conflict');
    assert.strictEqual(result.conflictWith, '总结');
  });
});

describe('checkAvailability — external conflict', () => {
  test('returns external-conflict when registrar rejects the combo', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');
    const result = service.checkAvailability('Control+Alt+9');
    assert.strictEqual(result.status, 'external-conflict');
    // Must not include a fabricated occupant name
    assert.ok(!result.conflictWith);
  });

  test('does not include specific occupant name', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Command+Shift+A');
    const result = service.checkAvailability('Command+Shift+A');
    assert.strictEqual(result.status, 'external-conflict');
    assert.strictEqual(result.conflictWith, undefined);
  });
});

describe('checkAvailability — unavailable', () => {
  test('returns unavailable when registrar throws', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._throwOn('Control+Alt+9');
    const result = service.checkAvailability('Control+Alt+9');
    assert.strictEqual(result.status, 'unavailable');
  });

  test('does not return a recommendation when unavailable', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._throwOn('Control+Alt+9');
    const result = service.checkAvailability('Control+Alt+9');
    assert.strictEqual(result.status, 'unavailable');
    assert.strictEqual(result.recommendation, undefined);
  });
});

describe('checkAvailability — no side effects', () => {
  test('does not write to configuration store', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service, store } = makeService({ shortcuts });
    service.checkAvailability('Control+Alt+8');
    assert.strictEqual(store.getShortcuts().length, 1);
  });

  test('does not change current registration state', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();
    const beforeCount = registrar._size();

    service.checkAvailability('Control+Alt+8');

    assert.strictEqual(registrar._size(), beforeCount);
  });
});

// ---------------------------------------------------------------------------
// Tests: behavior is externally unchanged (regression)
// ---------------------------------------------------------------------------

describe('regression: existing behavior preserved', () => {
  test('save-then-trigger works end-to-end', () => {
    const { service, registrar, triggerHandler } = makeService({ shortcuts: [] });

    service.saveShortcut({
      id: '42',
      name: 'Test',
      shortcut: 'CommandOrControl+Shift+X',
      template: 'hello @select_content',
    });

    registrar._trigger('CommandOrControl+Shift+X');
    assert.strictEqual(triggerHandler._all().length, 1);
    assert.strictEqual(triggerHandler._all()[0].id, '42');
  });

  test('delete-then-trigger does not fire', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service, registrar, triggerHandler } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.deleteShortcut('1');
    // After deletion the accelerator should not be registered
    assert.ok(!registrar._has('CommandOrControl+Shift+A'));

    // Trying to trigger should do nothing (callback was removed)
    // The fake registrar's _trigger is a no-op if not registered
    registrar._trigger('CommandOrControl+Shift+A');
    assert.strictEqual(triggerHandler._all().length, 0);
  });

  test('default shortcuts register and trigger correctly', () => {
    // Simulate the two default shortcuts from the app
    const shortcuts = [
      { id: '1', name: '整理文本内容', shortcut: 'Control+Alt+9', template: '整理...', providerId: 'p1' },
      { id: '2', name: '翻译成英文', shortcut: 'Control+Alt+0', template: '翻译...', providerId: 'p1' },
    ];
    const { service, registrar, triggerHandler } = makeService({ shortcuts });
    service.registerAllAtStartup();

    assert.strictEqual(registrar._size(), 2);

    registrar._trigger('Control+Alt+9');
    assert.strictEqual(triggerHandler._all().length, 1);
    assert.strictEqual(triggerHandler._all()[0].name, '整理文本内容');

    registrar._trigger('Control+Alt+0');
    assert.strictEqual(triggerHandler._all().length, 2);
    assert.strictEqual(triggerHandler._all()[1].name, '翻译成英文');
  });
});

// ---------------------------------------------------------------------------
// Tests: recommendShortcut
// ---------------------------------------------------------------------------

describe('recommendShortcut — basic behavior', () => {
  test('returns null for null/undefined accelerator', () => {
    const { service } = makeService({ shortcuts: [] });
    assert.strictEqual(service.recommendShortcut(null), null);
    assert.strictEqual(service.recommendShortcut(undefined), null);
  });

  test('returns null for empty string', () => {
    const { service } = makeService({ shortcuts: [] });
    assert.strictEqual(service.recommendShortcut(''), null);
  });

  test('returns an available candidate when draft conflicts externally', () => {
    // Draft is Control+Alt+9, but it's rejected by the registrar
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');

    const result = service.recommendShortcut('Control+Alt+9');
    assert.ok(result);
    assert.ok(result.accelerator);
    // First candidate after the original is Control+Alt+Shift+9
    assert.strictEqual(result.accelerator, 'Control+Alt+Shift+9');
  });

  test('returned candidate is actually available (passes check)', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');

    const result = service.recommendShortcut('Control+Alt+9');
    assert.ok(result);
    const check = service.checkAvailability(result.accelerator);
    assert.strictEqual(check.status, 'available');
  });

  test('recommendation does not persist any configuration', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service, store } = makeService({ shortcuts });
    service.registerAllAtStartup();
    const before = store.getShortcuts();

    service.recommendShortcut('Control+Alt+9');

    const after = store.getShortcuts();
    assert.deepStrictEqual(after, before);
  });

  test('recommendation does not change registration state', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+A', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();
    const beforeSize = registrar._size();

    service.recommendShortcut('Command+Shift+Z');

    assert.strictEqual(registrar._size(), beforeSize);
  });
});

describe('recommendShortcut — candidate order', () => {
  test('keeps original main key, adds modifiers in fixed order', () => {
    // Draft: Command+Shift+A (externally conflicted)
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Command+Shift+A');

    const result = service.recommendShortcut('Command+Shift+A');
    assert.ok(result);
    // First candidate: Control+Alt+A (preserve main key, use preferred modifiers)
    assert.strictEqual(result.accelerator, 'Control+Alt+A');
  });

  test('tries Control+Alt+Shift+<key> after Control+Alt+<key>', () => {
    // Both Control+Alt+A and Control+Alt+Shift+A should be tried.
    // Make Control+Alt+A externally conflicted so we get the Shift variant.
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Command+Shift+A');
    registrar._reject('Control+Alt+A');

    const result = service.recommendShortcut('Command+Shift+A');
    assert.ok(result);
    assert.strictEqual(result.accelerator, 'Control+Alt+Shift+A');
  });

  test('tries nearby digits after same-key candidates', () => {
    // Draft: Control+Alt+9, all Control+Alt+9 variants taken
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');
    registrar._reject('Control+Alt+Shift+9');
    // Nearby digit candidates: Control+Alt+8, Control+Alt+Shift+8, etc.
    // 9 + (-1) = 8
    const result = service.recommendShortcut('Control+Alt+9');
    assert.ok(result);
    // Control+Alt+8 should be the next after the same-key Shift variant
    assert.strictEqual(result.accelerator, 'Control+Alt+8');
  });

  test('falls through to fixed pool when same-key and nearby fail', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    // Reject everything with main key 5
    registrar._reject('Control+Alt+5');
    registrar._reject('Control+Alt+Shift+5');
    // Reject nearby digits (4, 6, 3, 7)
    registrar._reject('Control+Alt+4');
    registrar._reject('Control+Alt+Shift+4');
    registrar._reject('Control+Alt+6');
    registrar._reject('Control+Alt+Shift+6');
    registrar._reject('Control+Alt+3');
    registrar._reject('Control+Alt+Shift+3');
    registrar._reject('Control+Alt+7');
    registrar._reject('Control+Alt+Shift+7');

    const result = service.recommendShortcut('Control+Alt+5');
    assert.ok(result);
    // Fixed pool starts with Control+Alt+0
    assert.strictEqual(result.accelerator, 'Control+Alt+0');
  });
});

describe('recommendShortcut — special candidate for 整理文本内容', () => {
  test('first candidate is Control+Alt+Shift+9 for 整理文本内容', () => {
    // Draft conflicts externally
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');

    const result = service.recommendShortcut('Control+Alt+9', undefined, '整理文本内容');
    assert.ok(result);
    assert.strictEqual(result.accelerator, 'Control+Alt+Shift+9');
  });

  test('special candidate only shown when actually available', () => {
    // Make Control+Alt+Shift+9 unavailable too
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');
    registrar._reject('Control+Alt+Shift+9');

    const result = service.recommendShortcut('Control+Alt+9', undefined, '整理文本内容');
    assert.ok(result);
    // Falls through to Control+Alt+9 nearby: Control+Alt+8
    assert.strictEqual(result.accelerator, 'Control+Alt+8');
  });

  test('special candidate not used for non-matching shortcut name', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');

    const result = service.recommendShortcut('Control+Alt+9', undefined, '翻译');
    assert.ok(result);
    // For non-matching name, first candidate is Control+Alt+Shift+9 (same key + Shift)
    assert.strictEqual(result.accelerator, 'Control+Alt+Shift+9');
  });
});

describe('recommendShortcut — exclusion and conflict skipping', () => {
  test('excludes the shortcut being edited from internal conflict', () => {
    // Shortcut #1 has Control+Alt+Z. We're editing #1 to a new combo that
    // conflicts externally. The recommendation should be able to use
    // Control+Alt+Z since #1 is excluded.
    const shortcuts = [
      { id: '1', name: 'MyShortcut', shortcut: 'Control+Alt+Z', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });
    service.registerAllAtStartup();

    // Draft is Command+Shift+X (externally conflicted)
    registrar._reject('Command+Shift+X');

    const result = service.recommendShortcut('Command+Shift+X', '1');
    assert.ok(result);
    // Control+Alt+X should be first candidate (preserving main key X)
    assert.strictEqual(result.accelerator, 'Control+Alt+X');
  });

  test('skips internal-conflict candidates', () => {
    const shortcuts = [
      { id: '1', name: 'Occupied', shortcut: 'Control+Alt+Z', template: 't1' },
    ];
    const { service, registrar } = makeService({ shortcuts });

    // Draft is Command+Shift+Z
    registrar._reject('Command+Shift+Z');

    const result = service.recommendShortcut('Command+Shift+Z');
    assert.ok(result);
    // Control+Alt+Z is internally occupied, so skip to Control+Alt+Shift+Z
    assert.strictEqual(result.accelerator, 'Control+Alt+Shift+Z');
  });

  test('skips external-conflict candidates', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Command+Shift+Z');
    registrar._reject('Control+Alt+Z');

    const result = service.recommendShortcut('Command+Shift+Z');
    assert.ok(result);
    assert.strictEqual(result.accelerator, 'Control+Alt+Shift+Z');
  });

  test('recommendation does not include the draft accelerator itself', () => {
    // Even if the draft accelerator is available, it should not be returned
    // as a recommendation (we need an alternative)
    const { service } = makeService({ shortcuts: [] });

    const result = service.recommendShortcut('Control+Alt+P');
    assert.ok(result);
    assert.notStrictEqual(result.accelerator, 'Control+Alt+P');
  });
});

describe('recommendShortcut — stability', () => {
  test('same draft and same occupation state produce same recommendation', () => {
    const { service: s1, registrar: r1 } = makeService({ shortcuts: [] });
    const { service: s2, registrar: r2 } = makeService({ shortcuts: [] });

    r1._reject('Control+Alt+9');
    r2._reject('Control+Alt+9');

    const r1Result = s1.recommendShortcut('Control+Alt+9');
    const r2Result = s2.recommendShortcut('Control+Alt+9');

    assert.deepStrictEqual(r1Result, r2Result);
  });

  test('repeated calls produce stable results', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Control+Alt+9');

    const r1 = service.recommendShortcut('Control+Alt+9');
    const r2 = service.recommendShortcut('Control+Alt+9');
    const r3 = service.recommendShortcut('Control+Alt+9');

    assert.deepStrictEqual(r1, r2);
    assert.deepStrictEqual(r2, r3);
  });
});

describe('recommendShortcut — no candidates available', () => {
  test('returns null when all candidates fail', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    // Reject a wide range of candidates
    for (let i = 0; i <= 9; i++) {
      registrar._reject(`Control+Alt+${i}`);
      registrar._reject(`Control+Alt+Shift+${i}`);
    }

    const result = service.recommendShortcut('Control+Alt+9');
    // Should find a letter candidate since those aren't rejected
    assert.ok(result);
    assert.ok(result.accelerator.includes('Control+Alt+'));
  });

  test('returns null when registrar is completely broken', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    // Make the registrar throw on everything
    const origRegister = registrar.register;
    registrar.register = function() {
      throw new Error('Registrar broken');
    };

    const result = service.recommendShortcut('Control+Alt+9');
    assert.strictEqual(result, null);

    // Restore for cleanup
    registrar.register = origRegister;
  });
});

describe('recommendShortcut — does not write to store', () => {
  test('no side effects on config store', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'Control+Alt+9', template: 't1' },
    ];
    const { service, store } = makeService({ shortcuts });
    const before = JSON.stringify(store.getShortcuts());

    service.recommendShortcut('Command+Shift+Z');

    const after = JSON.stringify(store.getShortcuts());
    assert.strictEqual(before, after);
  });
});

describe('recommendShortcut — letter main keys', () => {
  test('preserves letter main key with added modifiers', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    registrar._reject('Command+Shift+T');

    const result = service.recommendShortcut('Command+Shift+T');
    assert.ok(result);
    assert.strictEqual(result.accelerator, 'Control+Alt+T');
  });

  test('tries nearby letters', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    // Draft: Control+Alt+D, reject all D variants
    registrar._reject('Control+Alt+D');
    registrar._reject('Control+Alt+Shift+D');
    // Nearby: C, E, B, F
    registrar._reject('Control+Alt+C');
    registrar._reject('Control+Alt+Shift+C');
    registrar._reject('Control+Alt+E');
    registrar._reject('Control+Alt+Shift+E');

    const result = service.recommendShortcut('Control+Alt+D');
    assert.ok(result);
    // Should try B next
    assert.strictEqual(result.accelerator, 'Control+Alt+B');
  });
});

describe('recommendShortcut — original has Command', () => {
  test('generates Command-inclusive candidates when original had Command', () => {
    const { service, registrar } = makeService({ shortcuts: [] });
    // Reject Control+Alt+T and Control+Alt+Shift+T to get to Command candidates
    registrar._reject('Command+Shift+T');
    registrar._reject('Control+Alt+T');
    registrar._reject('Control+Alt+Shift+T');

    const result = service.recommendShortcut('Command+Shift+T');
    assert.ok(result);
    // Next should be Command+Alt+T
    assert.strictEqual(result.accelerator, 'Command+Alt+T');
  });
});
