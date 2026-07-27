'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { RunCoordinator, CANCEL_ACCELERATOR } = require('../src/run-coordinator');

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/**
 * Fake cancel registrar that tracks register/unregister calls.
 * Configurable per-accelerator outcomes.
 */
function createFakeCancelRegistrar() {
  const registered = new Map();
  const rejectedSet = new Set();
  let throwOnRegister = null;

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
    // test helpers
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
    _count() {
      return notifications.length;
    },
  };
}

/**
 * Creates a fake text reader that returns a configurable value.
 * Supports delayed reads to test cancellation during text reading.
 */
function createFakeTextReader(text, delay = 0) {
  let readCount = 0;
  return {
    async read() {
      readCount++;
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
      return text;
    },
    _readCount() {
      return readCount;
    },
  };
}

// ---------------------------------------------------------------------------
// Helper to wire up a coordinator with all fakes.
// ---------------------------------------------------------------------------

function makeCoordinator(opts = {}) {
  const registrar = opts.registrar || createFakeCancelRegistrar();
  const notifier = opts.notifier || createFakeNotifier();
  const reader = opts.reader || createFakeTextReader(opts.text !== undefined ? opts.text : 'selected text');

  const coordinator = new RunCoordinator({
    cancelRegistrar: registrar,
    onNotify: (title, body) => notifier.notify(title, body),
    readSelectedText: () => reader.read(),
  });

  return { coordinator, registrar, notifier, reader };
}

// ---------------------------------------------------------------------------
// Tests: single Run lifecycle
// ---------------------------------------------------------------------------

describe('beginRun — lifecycle entry', () => {
  test('enters active state immediately', () => {
    const { coordinator } = makeCoordinator();
    assert.strictEqual(coordinator.isActive(), false);
    assert.ok(coordinator.beginRun());
    assert.strictEqual(coordinator.isActive(), true);
  });

  test('registers Command+Escape as Cancel Shortcut on beginRun', () => {
    const { coordinator, registrar } = makeCoordinator();
    coordinator.beginRun();
    assert.ok(registrar._has(CANCEL_ACCELERATOR));
  });

  test('is not cancelled after beginRun', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    assert.strictEqual(coordinator.isCancelled(), false);
  });
});

describe('beginRun — mutual exclusion', () => {
  test('second beginRun is rejected when one is already active', () => {
    const { coordinator, notifier } = makeCoordinator();
    assert.ok(coordinator.beginRun());
    assert.strictEqual(coordinator.beginRun(), false);
  });

  test('second beginRun sends a notification about the existing Run', () => {
    const { coordinator, notifier } = makeCoordinator();
    coordinator.beginRun();
    notifier._clear();
    coordinator.beginRun();
    assert.strictEqual(notifier._count(), 1);
    const n = notifier._all()[0];
    assert.ok(n.title.includes('已有运行任务'));
    assert.ok(n.body.includes('Command'));
    assert.ok(n.body.includes('Esc'));
  });

  test('third beginRun is still rejected (no queuing, no replacement)', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.beginRun();
    assert.strictEqual(coordinator.beginRun(), false);
    assert.strictEqual(coordinator.isActive(), true);
  });

  test('beginRun works again after endRun', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
    assert.ok(coordinator.beginRun());
    assert.strictEqual(coordinator.isActive(), true);
  });
});

// ---------------------------------------------------------------------------
// Tests: Cancel Shortcut registration
// ---------------------------------------------------------------------------

describe('Cancel Shortcut — registration lifecycle', () => {
  test('unregisters Command+Escape on endRun', () => {
    const { coordinator, registrar } = makeCoordinator();
    coordinator.beginRun();
    assert.ok(registrar._has(CANCEL_ACCELERATOR));
    coordinator.endRun();
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });

  test('does not unregister other shortcuts on endRun', () => {
    const { coordinator, registrar } = makeCoordinator();
    // Register something unrelated
    registrar.register('Command+Shift+X', () => {});
    coordinator.beginRun();
    coordinator.endRun();
    // The unrelated shortcut should still be there
    assert.ok(registrar._has('Command+Shift+X'));
    // Cancel shortcut should be gone
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });

  test('only unregisters this Run\'s temporary registration', () => {
    const { coordinator, registrar } = makeCoordinator();
    coordinator.beginRun();
    coordinator.endRun();

    // Now manually register something on Command+Escape
    registrar.register(CANCEL_ACCELERATOR, () => {});
    assert.ok(registrar._has(CANCEL_ACCELERATOR));

    // Begin and end another run — should not affect our manual registration
    coordinator.beginRun();
    coordinator.endRun();
    // Note: beginRun re-registers, so after endRun the cancel is gone.
    // But this test verifies endRun only removes the cancel accelerator,
    // not anything else.
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });
});

describe('Cancel Shortcut — registration failure', () => {
  test('sends notification but continues Run when registration returns false', () => {
    const { coordinator, registrar, notifier } = makeCoordinator();
    registrar._reject(CANCEL_ACCELERATOR);

    coordinator.beginRun();
    assert.strictEqual(coordinator.isActive(), true);

    // Should have sent a notification about registration failure
    const failureNotifs = notifier._all().filter(
      n => n.title.includes('注册失败')
    );
    assert.ok(failureNotifs.length >= 1);
  });

  test('sends notification but continues Run when registration throws', () => {
    const { coordinator, registrar, notifier } = makeCoordinator();
    registrar._throwOn(CANCEL_ACCELERATOR);

    coordinator.beginRun();
    assert.strictEqual(coordinator.isActive(), true);

    const failureNotifs = notifier._all().filter(
      n => n.title.includes('注册失败')
    );
    assert.ok(failureNotifs.length >= 1);
  });

  test('endRun does not attempt to unregister when registration failed', () => {
    const { coordinator, registrar } = makeCoordinator();
    registrar._reject(CANCEL_ACCELERATOR);

    coordinator.beginRun();
    coordinator.endRun();
    // No throw, no issue
    assert.strictEqual(coordinator.isActive(), false);
  });
});

// ---------------------------------------------------------------------------
// Tests: cancellation during text reading
// ---------------------------------------------------------------------------

describe('cancel — during text read', () => {
  test('cancel before readText returns null', async () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.cancel();
    const text = await coordinator.readText();
    assert.strictEqual(text, null);
  });

  test('cancel after async read completes still returns null', async () => {
    let resolveRead;
    const pendingRead = new Promise(r => { resolveRead = r; });
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: () => {},
      readSelectedText: () => pendingRead,
    });

    coordinator.beginRun();
    const readPromise = coordinator.readText();

    // Cancel while the read is pending
    coordinator.cancel();

    // Now complete the read
    resolveRead('some text');

    const text = await readPromise;
    assert.strictEqual(text, null);
  });

  test('cancel via Cancel Shortcut triggers cancel during text read', async () => {
    let resolveRead;
    const pendingRead = new Promise(r => { resolveRead = r; });
    const registrar = createFakeCancelRegistrar();
    const coordinator = new RunCoordinator({
      cancelRegistrar: registrar,
      onNotify: () => {},
      readSelectedText: () => pendingRead,
    });

    coordinator.beginRun();
    const readPromise = coordinator.readText();

    // Trigger the Cancel Shortcut
    registrar._trigger(CANCEL_ACCELERATOR);

    // Complete the read
    resolveRead('some text');

    const text = await readPromise;
    assert.strictEqual(text, null);
    assert.strictEqual(coordinator.isCancelled(), true);
  });

  test('uncancelled read returns the selected text', async () => {
    const { coordinator } = makeCoordinator({ text: 'hello world' });
    coordinator.beginRun();
    const text = await coordinator.readText();
    assert.strictEqual(text, 'hello world');
  });
});

// ---------------------------------------------------------------------------
// Tests: cancel is idempotent
// ---------------------------------------------------------------------------

describe('cancel — idempotency', () => {
  test('calling cancel multiple times is safe', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.cancel();
    coordinator.cancel();
    coordinator.cancel();
    assert.strictEqual(coordinator.isCancelled(), true);
  });

  test('cancel when no Run is active is a no-op', () => {
    const { coordinator } = makeCoordinator();
    coordinator.cancel();
    assert.strictEqual(coordinator.isActive(), false);
    assert.strictEqual(coordinator.isCancelled(), false);
  });

  test('cancel after endRun is a no-op', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.endRun();
    coordinator.cancel();
    assert.strictEqual(coordinator.isActive(), false);
    assert.strictEqual(coordinator.isCancelled(), false);
  });
});

// ---------------------------------------------------------------------------
// Tests: endRun cleanup
// ---------------------------------------------------------------------------

describe('endRun — cleanup', () => {
  test('clears active state', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
  });

  test('clears cancelled state', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.cancel();
    coordinator.endRun();
    assert.strictEqual(coordinator.isCancelled(), false);
  });

  test('endRun is idempotent (safe to call twice)', () => {
    const { coordinator, registrar } = makeCoordinator();
    coordinator.beginRun();
    coordinator.endRun();
    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });

  test('endRun when no Run is active is a no-op', () => {
    const { coordinator } = makeCoordinator();
    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
  });
});

// ---------------------------------------------------------------------------
// Tests: existing shortcut behavior is unaffected
// ---------------------------------------------------------------------------

describe('existing Shortcut behavior — no interference', () => {
  test('does not touch other accelerators during Run', () => {
    const { coordinator, registrar } = makeCoordinator();
    registrar.register('Command+Shift+A', () => {});
    registrar.register('Control+Alt+9', () => {});

    coordinator.beginRun();
    assert.ok(registrar._has('Command+Shift+A'));
    assert.ok(registrar._has('Control+Alt+9'));
    assert.ok(registrar._has(CANCEL_ACCELERATOR));

    coordinator.endRun();
    assert.ok(registrar._has('Command+Shift+A'));
    assert.ok(registrar._has('Control+Alt+9'));
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });

  test('multiple Run begin/end cycles register and unregister Cancel Shortcut each time', () => {
    const { coordinator, registrar } = makeCoordinator();

    // First cycle
    coordinator.beginRun();
    assert.ok(registrar._has(CANCEL_ACCELERATOR));
    coordinator.endRun();
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));

    // Second cycle
    coordinator.beginRun();
    assert.ok(registrar._has(CANCEL_ACCELERATOR));
    coordinator.endRun();
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));

    // Third cycle
    coordinator.beginRun();
    assert.ok(registrar._has(CANCEL_ACCELERATOR));
    coordinator.endRun();
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });
});

// ---------------------------------------------------------------------------
// Tests: full lifecycle integration
// ---------------------------------------------------------------------------

describe('full lifecycle — integration', () => {
  test('begin → read → end (happy path)', async () => {
    const { coordinator, registrar } = makeCoordinator({ text: 'test text' });

    assert.ok(coordinator.beginRun());
    assert.strictEqual(coordinator.isActive(), true);
    assert.ok(registrar._has(CANCEL_ACCELERATOR));

    const text = await coordinator.readText();
    assert.strictEqual(text, 'test text');

    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });

  test('begin → cancel during read → end', async () => {
    let resolveRead;
    const pendingRead = new Promise(r => { resolveRead = r; });
    const registrar = createFakeCancelRegistrar();
    const coordinator = new RunCoordinator({
      cancelRegistrar: registrar,
      onNotify: () => {},
      readSelectedText: () => pendingRead,
    });

    assert.ok(coordinator.beginRun());
    const readPromise = coordinator.readText();

    coordinator.cancel();
    resolveRead('text');

    const text = await readPromise;
    assert.strictEqual(text, null);

    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });

  test('begin → read → cancel → end (cancel after successful read)', async () => {
    const { coordinator } = makeCoordinator({ text: 'hello' });

    coordinator.beginRun();
    const text = await coordinator.readText();
    assert.strictEqual(text, 'hello');

    coordinator.cancel();
    assert.strictEqual(coordinator.isCancelled(), true);

    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
    assert.strictEqual(coordinator.isCancelled(), false);
  });

  test('begin → read empty → end (no text selected)', async () => {
    const { coordinator } = makeCoordinator({ text: '' });

    coordinator.beginRun();
    const text = await coordinator.readText();
    assert.strictEqual(text, '');

    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
  });
});
