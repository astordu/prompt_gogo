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
// Tests: saveShortcut (upsert + re-register)
// ---------------------------------------------------------------------------

describe('saveShortcut — create', () => {
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
});

describe('saveShortcut — update existing', () => {
  test('updates shortcut by id and re-registers', () => {
    const shortcuts = [
      { id: '1', name: 'Old', shortcut: 'CommandOrControl+Shift+O', template: 'old' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    const updated = { id: '1', name: 'New', shortcut: 'CommandOrControl+Shift+N', template: 'new' };

    service.saveShortcut(updated);

    const stored = store.getShortcuts();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].name, 'New');
    assert.ok(!registrar._has('CommandOrControl+Shift+O'));
    assert.ok(registrar._has('CommandOrControl+Shift+N'));
  });

  test('other shortcuts remain registered after update', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
    ];
    const { service, registrar } = makeService({ shortcuts });

    service.saveShortcut({ id: '1', name: 'A2', shortcut: 'CommandOrControl+Shift+A2', template: 't1b' });

    // B should still be registered after the re-registration
    assert.ok(registrar._has('CommandOrControl+Shift+B'));
  });
});

// ---------------------------------------------------------------------------
// Tests: deleteShortcut
// ---------------------------------------------------------------------------

describe('deleteShortcut', () => {
  test('removes shortcut from store and unregisters', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
      { id: '2', name: 'B', shortcut: 'CommandOrControl+Shift+B', template: 't2' },
    ];
    const { service, registrar, store } = makeService({ shortcuts });
    service.registerAllAtStartup();

    service.deleteShortcut('1');

    const stored = store.getShortcuts();
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0].id, '2');
    assert.ok(!registrar._has('CommandOrControl+Shift+A'));
    assert.ok(registrar._has('CommandOrControl+Shift+B'));
  });

  test('deleting non-existent id is a no-op', () => {
    const shortcuts = [
      { id: '1', name: 'A', shortcut: 'CommandOrControl+Shift+A', template: 't1' },
    ];
    const { service, store } = makeService({ shortcuts });

    service.deleteShortcut('nonexistent');

    assert.strictEqual(store.getShortcuts().length, 1);
  });

  test('returns success', () => {
    const { service } = makeService({ shortcuts: [] });
    const result = service.deleteShortcut('x');
    assert.deepStrictEqual(result, { success: true });
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
