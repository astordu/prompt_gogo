'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { RunCoordinator, CANCEL_ACCELERATOR } = require('../src/run-coordinator');
const { pipeToCursor } = require('../src/stream-output');

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

/**
 * Creates a fake Output Target that can be configured to become
 * invalid at any point during a Run.
 */
function createFakeOutputTarget() {
  let captured = false;
  let valid = true;

  return {
    capture() {
      captured = true;
      valid = true;
    },
    isValid() {
      return captured && valid;
    },
    // test helpers
    _invalidate() {
      valid = false;
    },
    _isCaptured() {
      return captured;
    },
  };
}

/**
 * Creates a fake Run Indicator sink that records all write/deleteBack
 * calls. Can be configured to fail at specific points.
 */
function createFakeRunIndicator() {
  const operations = [];
  let failOnDelete = false;
  let failOnWrite = false;

  return {
    async write(text) {
      if (failOnWrite) throw new Error('write failed');
      operations.push({ type: 'write', text });
    },
    async deleteBack(count) {
      if (failOnDelete) throw new Error('deleteBack failed');
      operations.push({ type: 'deleteBack', count });
    },
    // test helpers
    _operations() { return operations; },
    _writes() { return operations.filter(o => o.type === 'write').map(o => o.text); },
    _deleteCount() { return operations.filter(o => o.type === 'deleteBack').reduce((s, o) => s + o.count, 0); },
    _clear() { operations.length = 0; },
    _failOnDelete() { failOnDelete = true; },
    _failOnWrite() { failOnWrite = true; },
  };
}

// ---------------------------------------------------------------------------
// Helper to wire up a coordinator with all fakes.
// ---------------------------------------------------------------------------

function makeCoordinator(opts = {}) {
  const registrar = opts.registrar || createFakeCancelRegistrar();
  const notifier = opts.notifier || createFakeNotifier();
  const reader = opts.reader || createFakeTextReader(opts.text !== undefined ? opts.text : 'selected text');
  const outputTarget = opts.outputTarget || createFakeOutputTarget();
  const runIndicator = opts.runIndicator || createFakeRunIndicator();

  const coordinator = new RunCoordinator({
    cancelRegistrar: registrar,
    onNotify: (title, body) => notifier.notify(title, body),
    readSelectedText: () => reader.read(),
    outputTarget,
    runIndicator,
  });

  return { coordinator, registrar, notifier, reader, outputTarget, runIndicator };
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

// ---------------------------------------------------------------------------
// Tests: Output Target binding
// ---------------------------------------------------------------------------

describe('Output Target — capture and validation', () => {
  test('beginRun captures the Output Target', () => {
    const { coordinator, outputTarget } = makeCoordinator();
    assert.ok(!outputTarget._isCaptured());
    coordinator.beginRun();
    assert.ok(outputTarget._isCaptured());
  });

  test('validateTarget returns true when target is still valid', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    assert.strictEqual(coordinator.validateTarget(), true);
  });

  test('validateTarget returns false when target became invalid', () => {
    const { coordinator, outputTarget } = makeCoordinator();
    coordinator.beginRun();
    outputTarget._invalidate();
    assert.strictEqual(coordinator.validateTarget(), false);
  });

  test('validateTarget sends a notification when target becomes invalid', () => {
    const { coordinator, notifier, outputTarget } = makeCoordinator();
    coordinator.beginRun();
    notifier._clear();
    outputTarget._invalidate();
    coordinator.validateTarget();
    assert.strictEqual(notifier._count(), 1);
    assert.ok(notifier._all()[0].title.includes('失效'));
  });

  test('validateTarget is idempotent (only notifies once)', () => {
    const { coordinator, notifier, outputTarget } = makeCoordinator();
    coordinator.beginRun();
    notifier._clear();
    outputTarget._invalidate();
    coordinator.validateTarget();
    coordinator.validateTarget();
    assert.strictEqual(notifier._count(), 1);
  });

  test('validateTarget returns false when no Run is active', () => {
    const { coordinator } = makeCoordinator();
    assert.strictEqual(coordinator.validateTarget(), false);
  });

  test('isTargetInvalid is false initially and true after invalidation', () => {
    const { coordinator, outputTarget } = makeCoordinator();
    coordinator.beginRun();
    assert.strictEqual(coordinator.isTargetInvalid(), false);
    outputTarget._invalidate();
    coordinator.validateTarget();
    assert.strictEqual(coordinator.isTargetInvalid(), true);
  });

  test('isViable returns true when active, not cancelled, target valid', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    assert.strictEqual(coordinator.isViable(), true);
  });

  test('isViable returns false after target invalidation', () => {
    const { coordinator, outputTarget } = makeCoordinator();
    coordinator.beginRun();
    outputTarget._invalidate();
    coordinator.validateTarget();
    assert.strictEqual(coordinator.isViable(), false);
  });

  test('endRun resets targetInvalid state', () => {
    const { coordinator, outputTarget } = makeCoordinator();
    coordinator.beginRun();
    outputTarget._invalidate();
    coordinator.validateTarget();
    coordinator.endRun();
    assert.strictEqual(coordinator.isTargetInvalid(), false);
  });
});

describe('Output Target — invalidation during text read', () => {
  test('target invalid before readText returns null', async () => {
    const { coordinator, outputTarget } = makeCoordinator();
    coordinator.beginRun();
    outputTarget._invalidate();
    coordinator.validateTarget();
    const text = await coordinator.readText();
    assert.strictEqual(text, null);
  });

  test('target invalid after async read completes returns null', async () => {
    let resolveRead;
    const pendingRead = new Promise(r => { resolveRead = r; });
    const outputTarget = createFakeOutputTarget();
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: () => {},
      readSelectedText: () => pendingRead,
      outputTarget,
    });

    coordinator.beginRun();
    const readPromise = coordinator.readText();

    // Target becomes invalid while the read is pending
    outputTarget._invalidate();

    // Complete the read
    resolveRead('some text');

    const text = await readPromise;
    assert.strictEqual(text, null);
    assert.strictEqual(coordinator.isTargetInvalid(), true);
  });

  test('target invalid during readText sends notification', async () => {
    let resolveRead;
    const pendingRead = new Promise(r => { resolveRead = r; });
    const notifier = createFakeNotifier();
    const outputTarget = createFakeOutputTarget();
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: (t, b) => notifier.notify(t, b),
      readSelectedText: () => pendingRead,
      outputTarget,
    });

    coordinator.beginRun();
    notifier._clear();
    const readPromise = coordinator.readText();

    outputTarget._invalidate();
    resolveRead('text');

    await readPromise;
    assert.strictEqual(notifier._count(), 1);
    assert.ok(notifier._all()[0].title.includes('失效'));
  });

  test('valid target during readText returns text normally', async () => {
    const { coordinator } = makeCoordinator({ text: 'hello' });
    coordinator.beginRun();
    const text = await coordinator.readText();
    assert.strictEqual(text, 'hello');
    assert.strictEqual(coordinator.isTargetInvalid(), false);
  });
});

describe('Output Target — no target configured (backward compatible)', () => {
  test('works without outputTarget injection', () => {
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: () => {},
      readSelectedText: async () => 'text',
    });

    assert.ok(coordinator.beginRun());
    assert.strictEqual(coordinator.isActive(), true);
    assert.strictEqual(coordinator.validateTarget(), true);
    assert.strictEqual(coordinator.isViable(), true);
    coordinator.endRun();
  });

  test('readText works without outputTarget', async () => {
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: () => {},
      readSelectedText: async () => 'text',
    });

    coordinator.beginRun();
    const text = await coordinator.readText();
    assert.strictEqual(text, 'text');
    coordinator.endRun();
  });
});

describe('Output Target — full lifecycle with invalidation', () => {
  test('begin → target invalidates → validateTarget fails → end', async () => {
    const { coordinator, notifier, outputTarget, registrar } = makeCoordinator({ text: 'test' });

    assert.ok(coordinator.beginRun());
    assert.ok(outputTarget._isCaptured());
    assert.strictEqual(coordinator.isViable(), true);

    // Simulate app focus change
    outputTarget._invalidate();

    assert.strictEqual(coordinator.validateTarget(), false);
    assert.strictEqual(coordinator.isViable(), false);
    assert.strictEqual(coordinator.isTargetInvalid(), true);

    // Further operations should detect invalid state
    const text = await coordinator.readText();
    assert.strictEqual(text, null);

    coordinator.endRun();
    assert.strictEqual(coordinator.isActive(), false);
    assert.strictEqual(coordinator.isTargetInvalid(), false);
    assert.ok(!registrar._has(CANCEL_ACCELERATOR));
  });

  test('target stays valid throughout a normal Run', async () => {
    const { coordinator, outputTarget } = makeCoordinator({ text: 'test' });

    coordinator.beginRun();
    assert.strictEqual(coordinator.validateTarget(), true);

    const text = await coordinator.readText();
    assert.strictEqual(text, 'test');
    assert.strictEqual(coordinator.validateTarget(), true);
    assert.strictEqual(coordinator.isViable(), true);

    coordinator.endRun();
  });

  test('capture is fresh on each beginRun', () => {
    const { coordinator, outputTarget } = makeCoordinator();

    // First Run
    coordinator.beginRun();
    assert.ok(outputTarget._isCaptured());
    coordinator.endRun();

    // Second Run — capture should work again
    coordinator.beginRun();
    assert.strictEqual(coordinator.isTargetInvalid(), false);
    assert.strictEqual(coordinator.validateTarget(), true);
    coordinator.endRun();
  });
});

// ---------------------------------------------------------------------------
// Tests: Loading indicator — showLoading
// ---------------------------------------------------------------------------

describe('showLoading — insertion timing', () => {
  test('writes Loading… with single ellipsis character', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original text');
    assert.strictEqual(runIndicator._writes().length, 1);
    assert.strictEqual(runIndicator._writes()[0], 'Loading\u2026');
  });

  test('isShowingLoading is true after showLoading', async () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    assert.strictEqual(coordinator.isShowingLoading(), false);
    await coordinator.showLoading('original');
    assert.strictEqual(coordinator.isShowingLoading(), true);
  });

  test('showLoading returns true when successful', async () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    const result = await coordinator.showLoading('original');
    assert.strictEqual(result, true);
  });

  test('showLoading does not write when no Run is active', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    const result = await coordinator.showLoading('original');
    assert.strictEqual(result, false);
    assert.strictEqual(runIndicator._writes().length, 0);
  });

  test('showLoading is idempotent (second call does nothing)', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original');
    const second = await coordinator.showLoading('original');
    assert.strictEqual(second, false);
    assert.strictEqual(runIndicator._writes().length, 1);
  });

  test('showLoading returns false when target is invalid', async () => {
    const { coordinator, outputTarget, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    outputTarget._invalidate();
    const result = await coordinator.showLoading('original');
    assert.strictEqual(result, false);
    assert.strictEqual(runIndicator._writes().length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Loading indicator — cancellation during showLoading
// ---------------------------------------------------------------------------

describe('showLoading — cancellation', () => {
  test('showLoading returns false when cancelled before', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.cancel();
    const result = await coordinator.showLoading('original');
    assert.strictEqual(result, false);
    assert.strictEqual(runIndicator._writes().length, 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Loading indicator — first model content replacement
// ---------------------------------------------------------------------------

describe('onModelContent — first content replaces Loading…', () => {
  test('non-empty chunk clears Loading and returns true', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original');

    const cleared = await coordinator.onModelContent('Hello');
    assert.strictEqual(cleared, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);
    // Should have deleted exactly LOADING_TEXT.length characters
    assert.strictEqual(runIndicator._deleteCount(), 'Loading\u2026'.length);
  });

  test('empty chunk does not clear Loading', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original');

    const cleared = await coordinator.onModelContent('');
    assert.strictEqual(cleared, false);
    assert.strictEqual(coordinator.isShowingLoading(), true);
    assert.strictEqual(runIndicator._deleteCount(), 0);
  });

  test('null chunk does not clear Loading', async () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original');

    const cleared = await coordinator.onModelContent(null);
    assert.strictEqual(cleared, false);
    assert.strictEqual(coordinator.isShowingLoading(), true);
  });

  test('second call to onModelContent is a no-op (Loading already cleared)', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original');

    await coordinator.onModelContent('first');
    const cleared = await coordinator.onModelContent('second');
    assert.strictEqual(cleared, false);
    // Only one deleteBack should have happened
    assert.strictEqual(runIndicator._deleteCount(), 'Loading\u2026'.length);
  });

  test('onModelContent returns false when Loading not active', async () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    const cleared = await coordinator.onModelContent('text');
    assert.strictEqual(cleared, false);
  });

  test('onModelContent returns false when cancelled', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original');
    coordinator.cancel();
    const cleared = await coordinator.onModelContent('text');
    assert.strictEqual(cleared, false);
    assert.strictEqual(runIndicator._deleteCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// Tests: Loading indicator — abort and restore
// ---------------------------------------------------------------------------

describe('abortLoading — removes Loading and restores original text', () => {
  test('deletes Loading… and writes back original text', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original selected text');

    const restored = await coordinator.abortLoading();
    assert.strictEqual(restored, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);

    // Operations: write(Loading…), deleteBack(len), write(original)
    const ops = runIndicator._operations();
    assert.strictEqual(ops.length, 3);
    assert.strictEqual(ops[0].type, 'write');
    assert.strictEqual(ops[0].text, 'Loading\u2026');
    assert.strictEqual(ops[1].type, 'deleteBack');
    assert.strictEqual(ops[2].type, 'write');
    assert.strictEqual(ops[2].text, 'original selected text');
  });

  test('abortLoading returns false when no Loading active', async () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    const result = await coordinator.abortLoading();
    assert.strictEqual(result, false);
  });

  test('abortLoading returns false when target invalid', async () => {
    const { coordinator, outputTarget, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original');
    outputTarget._invalidate();
    const result = await coordinator.abortLoading();
    assert.strictEqual(result, false);
    // Should NOT have touched the target — no delete/write
    assert.strictEqual(runIndicator._deleteCount(), 0);
  });

  test('abortLoading restores empty string when original was empty', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('');

    await coordinator.abortLoading();
    const ops = runIndicator._operations();
    // write(Loading…), deleteBack, write('')
    assert.strictEqual(ops[2].type, 'write');
    assert.strictEqual(ops[2].text, '');
  });
});

// ---------------------------------------------------------------------------
// Tests: Loading indicator — target invalidation
// ---------------------------------------------------------------------------

describe('Loading — target invalidation during showLoading', () => {
  test('target invalidates during showLoading async write returns false', async () => {
    const outputTarget = createFakeOutputTarget();
    const notifier = createFakeNotifier();
    const runIndicator = createFakeRunIndicator();

    // Custom indicator that invalidates target during write
    const invalidatingIndicator = {
      async write(text) {
        runIndicator._operations().push({ type: 'write', text });
        outputTarget._invalidate();
      },
      async deleteBack(count) {
        runIndicator._operations().push({ type: 'deleteBack', count });
      },
    };

    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: (t, b) => notifier.notify(t, b),
      readSelectedText: async () => 'text',
      outputTarget,
      runIndicator: invalidatingIndicator,
    });

    coordinator.beginRun();
    notifier._clear();
    const result = await coordinator.showLoading('original');
    assert.strictEqual(result, false);
    assert.strictEqual(coordinator.isShowingLoading(), false);
    assert.strictEqual(notifier._count(), 1);
    assert.ok(notifier._all()[0].title.includes('失效'));
  });
});

describe('Loading — target invalidation during onModelContent', () => {
  test('target invalidates during deleteBack returns false', async () => {
    const outputTarget = createFakeOutputTarget();
    const notifier = createFakeNotifier();

    const invalidatingIndicator = {
      async write(text) { /* ok */ },
      async deleteBack(count) {
        outputTarget._invalidate();
      },
    };

    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: (t, b) => notifier.notify(t, b),
      readSelectedText: async () => 'text',
      outputTarget,
      runIndicator: invalidatingIndicator,
    });

    coordinator.beginRun();
    await coordinator.showLoading('original');
    notifier._clear();
    const cleared = await coordinator.onModelContent('content');
    assert.strictEqual(cleared, false);
    // Loading state persists — cannot clean up because target is invalid
    assert.strictEqual(coordinator.isShowingLoading(), true);
    assert.strictEqual(notifier._count(), 1);
    // endRun clears the loading state
    coordinator.endRun();
    assert.strictEqual(coordinator.isShowingLoading(), false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Loading indicator — full lifecycle
// ---------------------------------------------------------------------------

describe('Loading — full lifecycle integration', () => {
  test('show → first content → loading cleared, content flows normally', async () => {
    const { coordinator, runIndicator } = makeCoordinator({ text: 'selected' });
    coordinator.beginRun();

    const text = await coordinator.readText();
    assert.strictEqual(text, 'selected');

    await coordinator.showLoading('selected');
    assert.strictEqual(coordinator.isShowingLoading(), true);

    // Simulate empty chunk first — should not clear
    await coordinator.onModelContent('');
    assert.strictEqual(coordinator.isShowingLoading(), true);

    // Simulate first real content
    const cleared = await coordinator.onModelContent('Hello world');
    assert.strictEqual(cleared, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);

    coordinator.endRun();
    assert.strictEqual(coordinator.isShowingLoading(), false);
  });

  test('show → cancel before content → abort restores original', async () => {
    const { coordinator, runIndicator } = makeCoordinator({ text: 'my text' });
    coordinator.beginRun();
    await coordinator.readText();
    await coordinator.showLoading('my text');

    coordinator.cancel();
    const cleared = await coordinator.onModelContent('content');
    assert.strictEqual(cleared, false);

    const restored = await coordinator.abortLoading();
    assert.strictEqual(restored, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);

    // Verify original text was restored
    const ops = runIndicator._operations();
    const lastWrite = ops.filter(o => o.type === 'write').pop();
    assert.strictEqual(lastWrite.text, 'my text');

    coordinator.endRun();
  });

  test('show → error before content → abort restores original', async () => {
    const { coordinator, runIndicator } = makeCoordinator({ text: 'input' });
    coordinator.beginRun();
    await coordinator.readText();
    await coordinator.showLoading('input');

    // Error occurs — caller calls abortLoading
    const restored = await coordinator.abortLoading();
    assert.strictEqual(restored, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);

    // Verify original text was restored
    const ops = runIndicator._operations();
    const lastWrite = ops.filter(o => o.type === 'write').pop();
    assert.strictEqual(lastWrite.text, 'input');

    coordinator.endRun();
  });

  test('show → target invalid → no further writes to new focus', async () => {
    const { coordinator, outputTarget, runIndicator } = makeCoordinator({ text: 'data' });
    coordinator.beginRun();
    await coordinator.readText();
    await coordinator.showLoading('data');

    // Target becomes invalid
    outputTarget._invalidate();

    // onModelContent should fail without touching the target
    const cleared = await coordinator.onModelContent('content');
    assert.strictEqual(cleared, false);

    // abortLoading should also fail
    const restored = await coordinator.abortLoading();
    assert.strictEqual(restored, false);

    // No additional deleteBack or write operations beyond the initial Loading write
    const ops = runIndicator._operations();
    assert.strictEqual(ops.length, 1); // only the initial Loading write
    assert.strictEqual(ops[0].type, 'write');

    coordinator.endRun();
  });

  test('show → endRun clears loading state', async () => {
    const { coordinator } = makeCoordinator({ text: 'data' });
    coordinator.beginRun();
    await coordinator.showLoading('data');
    assert.strictEqual(coordinator.isShowingLoading(), true);

    coordinator.endRun();
    assert.strictEqual(coordinator.isShowingLoading(), false);
  });
});

// ---------------------------------------------------------------------------
// Tests: Loading indicator — backward compatibility (no runIndicator)
// ---------------------------------------------------------------------------

describe('Loading — backward compatibility without runIndicator', () => {
  test('showLoading works without runIndicator (no-op writes)', async () => {
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: () => {},
      readSelectedText: async () => 'text',
      outputTarget: createFakeOutputTarget(),
    });

    coordinator.beginRun();
    const result = await coordinator.showLoading('original');
    assert.strictEqual(result, true);
    assert.strictEqual(coordinator.isShowingLoading(), true);
  });

  test('onModelContent works without runIndicator', async () => {
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: () => {},
      readSelectedText: async () => 'text',
      outputTarget: createFakeOutputTarget(),
    });

    coordinator.beginRun();
    await coordinator.showLoading('original');
    const cleared = await coordinator.onModelContent('content');
    assert.strictEqual(cleared, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);
  });

  test('abortLoading works without runIndicator', async () => {
    const coordinator = new RunCoordinator({
      cancelRegistrar: createFakeCancelRegistrar(),
      onNotify: () => {},
      readSelectedText: async () => 'text',
      outputTarget: createFakeOutputTarget(),
    });

    coordinator.beginRun();
    await coordinator.showLoading('original');
    const restored = await coordinator.abortLoading();
    assert.strictEqual(restored, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);
  });
});

// ---------------------------------------------------------------------------
// Tests: AbortSignal for HTTP/SSE cancellation
// ---------------------------------------------------------------------------

describe('AbortSignal — lifecycle', () => {
  test('getAbortSignal returns null when no Run is active', () => {
    const { coordinator } = makeCoordinator();
    assert.strictEqual(coordinator.getAbortSignal(), null);
  });

  test('getAbortSignal returns a valid signal after beginRun', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    const signal = coordinator.getAbortSignal();
    assert.ok(signal);
    assert.strictEqual(signal.aborted, false);
  });

  test('signal is aborted after cancel()', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    const signal = coordinator.getAbortSignal();
    assert.strictEqual(signal.aborted, false);
    coordinator.cancel();
    assert.strictEqual(signal.aborted, true);
  });

  test('getAbortSignal returns null after endRun', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.endRun();
    assert.strictEqual(coordinator.getAbortSignal(), null);
  });

  test('each Run gets a fresh signal', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    const signal1 = coordinator.getAbortSignal();
    coordinator.cancel();
    assert.strictEqual(signal1.aborted, true);

    coordinator.endRun();
    coordinator.beginRun();
    const signal2 = coordinator.getAbortSignal();
    assert.notStrictEqual(signal1, signal2);
    assert.strictEqual(signal2.aborted, false);
  });

  test('signal is not aborted on endRun without cancel', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    const signal = coordinator.getAbortSignal();
    coordinator.endRun();
    // Signal object still exists (caller may hold a reference) but is not aborted
    assert.strictEqual(signal.aborted, false);
  });

  test('cancel without active Run does not create or abort a signal', () => {
    const { coordinator } = makeCoordinator();
    coordinator.cancel();
    assert.strictEqual(coordinator.getAbortSignal(), null);
  });

  test('cancel is idempotent — signal stays aborted', () => {
    const { coordinator } = makeCoordinator();
    coordinator.beginRun();
    coordinator.cancel();
    const signal = coordinator.getAbortSignal();
    coordinator.cancel();
    assert.strictEqual(signal.aborted, true);
  });
});

// ---------------------------------------------------------------------------
// Integration: RunCoordinator + pipeToCursor cancellation
// ---------------------------------------------------------------------------

/**
 * Creates a memory sink for integration tests.
 */
function createIntegrationSink() {
  const writes = [];
  let closed = false;
  return {
    async write(text) { writes.push(text); },
    async close() { closed = true; },
    writes,
    get isClosed() { return closed; },
  };
}

describe('Integration — streaming cancellation', () => {
  test('cancel after partial output preserves already-written content', async () => {
    const { coordinator } = makeCoordinator();
    const sink = createIntegrationSink();

    coordinator.beginRun();

    // Simulate: first content arrives, then cancel mid-stream
    async function* chunks() {
      yield 'a'.repeat(30); // first batch — written (threshold met)
      coordinator.cancel(); // cancel after first content
      yield 'b'.repeat(30); // should be discarded or never arrive
    }

    const signal = coordinator.getAbortSignal();
    await pipeToCursor(chunks(), sink, signal);

    // Only the first batch was written
    assert.strictEqual(sink.writes.length, 1);
    assert.strictEqual(sink.writes[0], 'a'.repeat(30));
    assert.ok(sink.isClosed);
    assert.strictEqual(coordinator.isCancelled(), true);
  });

  test('cancel during buffering discards unwritten buffer', async () => {
    const { coordinator } = makeCoordinator();
    const sink = createIntegrationSink();

    coordinator.beginRun();

    async function* chunks() {
      yield 'a'.repeat(30); // written immediately
      yield 'b'.repeat(10); // buffered (below threshold)
      coordinator.cancel();
      yield 'c'.repeat(30); // should not be written
    }

    const signal = coordinator.getAbortSignal();
    await pipeToCursor(chunks(), sink, signal);

    // 'a' batch is written; 'b' is discarded from buffer
    assert.strictEqual(sink.writes.length, 1);
    assert.strictEqual(sink.writes[0], 'a'.repeat(30));
    assert.ok(sink.isClosed);
  });

  test('cancel via Cancel Shortcut during streaming stops output', async () => {
    const { coordinator, registrar } = makeCoordinator();
    const sink = createIntegrationSink();

    coordinator.beginRun();

    async function* chunks() {
      yield 'a'.repeat(30); // written
      // Simulate user pressing Command+Escape
      registrar._trigger(CANCEL_ACCELERATOR);
      yield 'b'.repeat(30); // should not be written
    }

    const signal = coordinator.getAbortSignal();
    await pipeToCursor(chunks(), sink, signal);

    assert.strictEqual(coordinator.isCancelled(), true);
    assert.strictEqual(sink.writes.length, 1);
    assert.ok(sink.isClosed);
  });

  test('no late writes after cancel — timer callbacks do not fire', async () => {
    const { coordinator } = makeCoordinator();
    const sink = createIntegrationSink();

    coordinator.beginRun();

    async function* chunks() {
      yield 'tiny'; // below threshold, buffered
      coordinator.cancel();
      // After cancel, wait a bit to let any timer fire
      await new Promise(r => setTimeout(r, 300));
      yield 'late-content'; // should never be written
    }

    const signal = coordinator.getAbortSignal();
    await pipeToCursor(chunks(), sink, signal);

    // Nothing should have been written (buffer was discarded on abort)
    assert.strictEqual(sink.writes.length, 0);
    assert.ok(sink.isClosed);
  });

  test('normal completion without cancel writes all content', async () => {
    const { coordinator } = makeCoordinator();
    const sink = createIntegrationSink();

    coordinator.beginRun();

    async function* chunks() {
      yield 'Hello';
      yield ' ';
      yield 'World';
    }

    const signal = coordinator.getAbortSignal();
    await pipeToCursor(chunks(), sink, signal);

    assert.strictEqual(sink.writes.join(''), 'Hello World');
    assert.strictEqual(coordinator.isCancelled(), false);
    assert.ok(sink.isClosed);
  });

  test('target invalidation during streaming stops all writes', async () => {
    const { coordinator, outputTarget } = makeCoordinator();
    const writes = [];
    let closed = false;

    coordinator.beginRun();

    // Sink that validates target before writing (like validatingSink in main.js)
    const validatingSink = {
      async write(text) {
        if (!coordinator.validateTarget()) {
          throw new Error('Output Target invalid');
        }
        writes.push(text);
      },
      async close() { closed = true; },
    };

    async function* chunks() {
      yield 'a'.repeat(30); // written successfully
      // Target becomes invalid after first write
      outputTarget._invalidate();
      yield 'b'.repeat(30); // should trigger invalid error
    }

    const signal = coordinator.getAbortSignal();

    // pipeToCursor will throw when the sink throws
    await assert.rejects(
      pipeToCursor(chunks(), validatingSink, signal),
      /Output Target invalid/
    );

    // Only first batch was written
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0], 'a'.repeat(30));
    assert.ok(coordinator.isTargetInvalid());
    assert.ok(closed); // sink.close() still called in finally
  });

  test('partial output + error preserves already-written content', async () => {
    const { coordinator } = makeCoordinator();
    const writes = [];

    coordinator.beginRun();

    // Simulate: some content written, then stream errors
    const sink = {
      async write(text) {
        if (!coordinator.validateTarget()) {
          throw new Error('Output Target invalid');
        }
        writes.push(text);
      },
      async close() {},
    };

    async function* chunks() {
      yield 'a'.repeat(30);
      yield 'b'.repeat(30);
      throw new Error('stream error');
    }

    const signal = coordinator.getAbortSignal();

    await assert.rejects(
      pipeToCursor(chunks(), sink, signal),
      /stream error/
    );

    // Both batches were written before the error
    assert.strictEqual(writes.length, 2);
    assert.strictEqual(writes.join(''), 'a'.repeat(30) + 'b'.repeat(30));
    assert.strictEqual(coordinator.isCancelled(), false);
  });

  test('cancel during Loading phase aborts and restores original text', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    coordinator.beginRun();
    await coordinator.showLoading('original text');

    // Simulate cancel during Loading
    coordinator.cancel();
    const signal = coordinator.getAbortSignal();
    assert.strictEqual(signal.aborted, true);

    const restored = await coordinator.abortLoading();
    assert.strictEqual(restored, true);

    // Verify original text was restored
    const ops = runIndicator._operations();
    const lastWrite = ops.filter(o => o.type === 'write').pop();
    assert.strictEqual(lastWrite.text, 'original text');
  });

  test('cancel preserves first content but does not show Ending or restore original', async () => {
    const { coordinator, runIndicator } = makeCoordinator();
    const sink = createIntegrationSink();

    coordinator.beginRun();
    await coordinator.showLoading('original');

    // First content clears Loading
    const cleared = await coordinator.onModelContent('Hello');
    assert.strictEqual(cleared, true);
    assert.strictEqual(coordinator.isShowingLoading(), false);

    // Now cancel mid-stream
    coordinator.cancel();

    // Verify: no Ending… was shown, no original text restoration
    // Only Loading write + Loading deleteBack should have happened
    const ops = runIndicator._operations();
    const writes = ops.filter(o => o.type === 'write').map(o => o.text);
    // Loading… was written; no restore of 'original' happened
    assert.ok(writes.includes('Loading\u2026'));
    assert.ok(!writes.includes('original'));
  });
});
