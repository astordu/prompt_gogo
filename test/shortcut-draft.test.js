'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ShortcutDraft, isValidShortcutFormat } = require('../src/shortcut-draft');

// ---------------------------------------------------------------------------
// In-memory adapter for testing
// ---------------------------------------------------------------------------

/**
 * Creates an in-memory adapter whose checkAvailability can be controlled
 * per-accelerator. Records all calls for assertion.
 *
 * @param {Object} [responses] — map accelerator → result status object
 */
function createMemoryAdapter(responses) {
  const map = responses || {};
  const calls = [];

  return {
    checkAvailability(accelerator, excludeId) {
      calls.push({ accelerator, excludeId, time: calls.length });
      const r = map[accelerator];
      if (r === 'resolve') {
        return Promise.resolve({ status: 'available' });
      }
      if (r === 'reject') {
        return Promise.reject(new Error('simulated'));
      }
      if (typeof r === 'object' && r !== null) {
        return Promise.resolve(r);
      }
      return Promise.resolve({ status: 'available' });
    },
    _calls: calls,
    _set(accelerator, result) {
      map[accelerator] = result;
    },
    _clear() {
      calls.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isValidShortcutFormat', () => {
  test('returns false for empty / null / undefined', () => {
    assert.strictEqual(isValidShortcutFormat(''), false);
    assert.strictEqual(isValidShortcutFormat(null), false);
    assert.strictEqual(isValidShortcutFormat(undefined), false);
  });

  test('returns false for single modifier only', () => {
    assert.strictEqual(isValidShortcutFormat('Control'), false);
    assert.strictEqual(isValidShortcutFormat('Control+Alt'), false);
  });

  test('returns false for one modifier + one key', () => {
    assert.strictEqual(isValidShortcutFormat('Control+A'), false);
  });

  test('returns true for two modifiers + one key', () => {
    assert.strictEqual(isValidShortcutFormat('Control+Alt+A'), true);
    assert.strictEqual(isValidShortcutFormat('Control+Alt+Shift+9'), true);
  });
});

describe('ShortcutDraft — session lifecycle', () => {
  test('startAdd creates a blank session', () => {
    const draft = new ShortcutDraft(createMemoryAdapter());
    draft.startAdd();
    const snap = draft.getSnapshot();
    assert.strictEqual(snap.open, true);
    assert.strictEqual(snap.id, null);
    assert.strictEqual(snap.name, '');
    assert.strictEqual(snap.accelerator, '');
    assert.strictEqual(snap.template, '');
    assert.strictEqual(snap.providerId, null);
    assert.strictEqual(snap.status, 'idle');
  });

  test('startEdit initializes from existing shortcut', () => {
    const draft = new ShortcutDraft(createMemoryAdapter());
    draft.startEdit({
      id: 'sc-1',
      name: '整理文本',
      shortcut: 'Control+Alt+9',
      template: '请整理：@select_content',
      providerId: 'prov-1',
    });
    const snap = draft.getSnapshot();
    assert.strictEqual(snap.open, true);
    assert.strictEqual(snap.id, 'sc-1');
    assert.strictEqual(snap.name, '整理文本');
    assert.strictEqual(snap.accelerator, 'Control+Alt+9');
    assert.strictEqual(snap.template, '请整理：@select_content');
    assert.strictEqual(snap.providerId, 'prov-1');
  });

  test('close resets to a closed, idle state', () => {
    const draft = new ShortcutDraft(createMemoryAdapter());
    draft.startAdd();
    draft.setName('test');
    draft.close();
    const snap = draft.getSnapshot();
    assert.strictEqual(snap.open, false);
    assert.strictEqual(snap.name, '');
    assert.strictEqual(snap.accelerator, '');
    assert.strictEqual(snap.status, 'idle');
  });

  test('field updates are ignored when session is closed', () => {
    const draft = new ShortcutDraft(createMemoryAdapter());
    draft.setName('nope');
    draft.setTemplate('nope');
    draft.setProviderId('nope');
    draft.setAccelerator('Control+Alt+A');
    const snap = draft.getSnapshot();
    assert.strictEqual(snap.open, false);
    assert.strictEqual(snap.name, '');
    assert.strictEqual(snap.status, 'idle');
  });
});

describe('ShortcutDraft — field updates and snapshot', () => {
  let draft;

  beforeEach(() => {
    draft = new ShortcutDraft(createMemoryAdapter());
    draft.startAdd();
  });

  test('setName updates snapshot name', () => {
    draft.setName('我的快捷键');
    assert.strictEqual(draft.getSnapshot().name, '我的快捷键');
  });

  test('setTemplate updates snapshot template', () => {
    draft.setTemplate('处理 @select_content');
    assert.strictEqual(draft.getSnapshot().template, '处理 @select_content');
  });

  test('setProviderId updates snapshot providerId', () => {
    draft.setProviderId('prov-2');
    assert.strictEqual(draft.getSnapshot().providerId, 'prov-2');
  });

  test('setAccelerator with invalid format shows invalid status', () => {
    draft.setAccelerator('Control');
    assert.strictEqual(draft.getSnapshot().status, 'invalid');
  });

  test('setAccelerator with empty string shows idle status', () => {
    draft.setAccelerator('');
    assert.strictEqual(draft.getSnapshot().status, 'idle');
  });
});

describe('ShortcutDraft — async availability check', () => {
  test('complete accelerator triggers checking then available', async () => {
    const adapter = createMemoryAdapter({ 'Control+Alt+A': 'resolve' });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+A');
    assert.strictEqual(draft.getSnapshot().status, 'checking');

    // Wait for microtask queue to flush
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().status, 'available');
    assert.strictEqual(adapter._calls.length, 1);
    assert.strictEqual(adapter._calls[0].accelerator, 'Control+Alt+A');
    assert.strictEqual(adapter._calls[0].excludeId, null);
  });

  test('internal-conflict status with conflictWith name', async () => {
    const adapter = createMemoryAdapter({
      'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有快捷键' },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'internal-conflict');
    assert.strictEqual(snap.conflictWith, '已有快捷键');
  });

  test('external-conflict status without conflictWith', async () => {
    const adapter = createMemoryAdapter({
      'Control+Alt+C': { status: 'external-conflict' },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+C');
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'external-conflict');
    assert.strictEqual(snap.conflictWith, null);
  });

  test('unavailable status when check throws', async () => {
    const adapter = createMemoryAdapter({ 'Control+Alt+D': 'reject' });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+D');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().status, 'unavailable');
  });

  test('excludeId is passed for edit sessions', async () => {
    const adapter = createMemoryAdapter({ 'Control+Alt+E': 'resolve' });
    const draft = new ShortcutDraft(adapter);
    draft.startEdit({
      id: 'sc-42',
      name: 'test',
      shortcut: '',
      template: '',
    });

    draft.setAccelerator('Control+Alt+E');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(adapter._calls[0].excludeId, 'sc-42');
  });
});

describe('ShortcutDraft — stale result rejection', () => {
  test('older async result does not overwrite newer input', async () => {
    // First accelerator resolves slowly, second resolves immediately.
    // Even though first completes later, it should be ignored.
    const adapter = {
      checkAvailability(accelerator, excludeId) {
        if (accelerator === 'Control+Alt+1') {
          // Slow — resolves on next macrotask
          return new Promise(resolve => {
            setTimeout(() => resolve({ status: 'internal-conflict', conflictWith: 'OLD' }), 50);
          });
        }
        return Promise.resolve({ status: 'available' });
      },
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+1');
    // Immediately overwrite with a newer accelerator
    draft.setAccelerator('Control+Alt+2');

    await new Promise(r => setTimeout(r, 100));

    // The stale result from Control+Alt+1 must NOT have overwritten
    assert.strictEqual(draft.getSnapshot().status, 'available');
    assert.strictEqual(draft.getSnapshot().accelerator, 'Control+Alt+2');
  });

  test('close invalidates all in-flight results', async () => {
    const adapter = {
      checkAvailability() {
        return new Promise(resolve => {
          setTimeout(() => resolve({ status: 'available' }), 50);
        });
      },
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+F');
    draft.close();

    await new Promise(r => setTimeout(r, 100));

    // After close, status must be idle (not 'available')
    assert.strictEqual(draft.getSnapshot().status, 'idle');
    assert.strictEqual(draft.getSnapshot().open, false);
  });

  test('starting a new session invalidates prior in-flight results', async () => {
    const adapter = {
      checkAvailability() {
        return new Promise(resolve => {
          setTimeout(() => resolve({ status: 'internal-conflict', conflictWith: 'OLD' }), 50);
        });
      },
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setAccelerator('Control+Alt+G');

    // Start a fresh session before the check completes
    draft.startAdd();

    await new Promise(r => setTimeout(r, 100));

    // New session should be idle, stale result ignored
    assert.strictEqual(draft.getSnapshot().status, 'idle');
  });
});

describe('ShortcutDraft — subscribe', () => {
  test('listeners receive snapshots on state change', () => {
    const draft = new ShortcutDraft(createMemoryAdapter());
    const snapshots = [];
    draft.subscribe(snap => snapshots.push(snap.status));

    draft.startAdd();
    draft.setName('test');
    draft.close();

    assert.ok(snapshots.includes('idle')); // from startAdd
    assert.ok(snapshots.length >= 3);
  });

  test('unsubscribe stops notifications', () => {
    const draft = new ShortcutDraft(createMemoryAdapter());
    let count = 0;
    const unsub = draft.subscribe(() => count++);

    draft.startAdd();
    const countAfterStart = count;
    unsub();
    draft.setName('test');

    assert.strictEqual(count, countAfterStart);
  });

  test('initial subscribe does not emit until next change', () => {
    const draft = new ShortcutDraft(createMemoryAdapter());
    let count = 0;
    draft.subscribe(() => count++);
    assert.strictEqual(count, 0);
  });
});

describe('ShortcutDraft — accelerator transition to invalid then valid', () => {
  test('clearing accelerator resets to idle and invalidates pending check', async () => {
    const adapter = {
      checkAvailability() {
        return new Promise(resolve => {
          setTimeout(() => resolve({ status: 'available' }), 50);
        });
      },
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+H');
    assert.strictEqual(draft.getSnapshot().status, 'checking');

    draft.setAccelerator('');
    assert.strictEqual(draft.getSnapshot().status, 'idle');

    await new Promise(r => setTimeout(r, 100));
    // Stale result should not change the status
    assert.strictEqual(draft.getSnapshot().status, 'idle');
  });

  test('transitioning from valid to invalid format shows invalid without adapter call', async () => {
    const adapter = createMemoryAdapter({ 'Control+Alt+I': 'resolve' });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+I');
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(draft.getSnapshot().status, 'available');

    adapter._clear();
    draft.setAccelerator('Control');
    assert.strictEqual(draft.getSnapshot().status, 'invalid');
    assert.strictEqual(adapter._calls.length, 0);
  });
});
