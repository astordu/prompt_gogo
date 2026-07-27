'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');
const { ShortcutDraft, isValidShortcutFormat } = require('../src/shortcut-draft');

// ---------------------------------------------------------------------------
// In-memory adapter for testing
// ---------------------------------------------------------------------------

/**
 * Creates an in-memory adapter whose checkAvailability, recommendShortcut,
 * saveShortcut and getConfig can be controlled. Records all calls for assertion.
 *
 * @param {Object} [responses] — map accelerator → result status object
 * @param {Object} [recommendations] — map accelerator → { accelerator } | null
 * @param {Object} [opts] — { saveResult: Object, config: Object }
 */
function createMemoryAdapter(responses, recommendations, opts) {
  const map = responses || {};
  const recMap = recommendations || {};
  const options = opts || {};
  const calls = [];
  const recCalls = [];
  const saveCalls = [];
  const configCalls = [];
  let saveResult = options.saveResult || { success: true };
  let configData = options.config || { shortcuts: [], providers: [] };

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
    recommendShortcut(accelerator, excludeId, shortcutName) {
      recCalls.push({ accelerator, excludeId, shortcutName, time: recCalls.length });
      const r = recMap[accelerator];
      if (r === 'reject') {
        return Promise.reject(new Error('simulated'));
      }
      if (typeof r === 'object' || r === null) {
        return Promise.resolve(r);
      }
      return Promise.resolve({ accelerator: 'Control+Alt+R' });
    },
    saveShortcut(shortcut) {
      saveCalls.push({ ...shortcut });
      if (saveResult === 'reject') {
        return Promise.reject(new Error('simulated'));
      }
      return Promise.resolve(saveResult);
    },
    getConfig() {
      configCalls.push({ time: configCalls.length });
      if (configData === 'reject') {
        return Promise.reject(new Error('simulated'));
      }
      return Promise.resolve(configData);
    },
    _calls: calls,
    _recCalls: recCalls,
    _saveCalls: saveCalls,
    _configCalls: configCalls,
    _set(accelerator, result) {
      map[accelerator] = result;
    },
    _setRec(accelerator, result) {
      recMap[accelerator] = result;
    },
    _setSaveResult(result) {
      saveResult = result;
    },
    _setConfig(data) {
      configData = data;
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

// ---------------------------------------------------------------------------
// Recommendation — display, adopt, stale, invalidation
// ---------------------------------------------------------------------------

describe('ShortcutDraft — recommendation display', () => {
  test('internal-conflict triggers recommendation request', async () => {
    const adapter = createMemoryAdapter(
      { 'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' } },
      { 'Control+Alt+B': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'internal-conflict');
    assert.strictEqual(snap.recommendation, 'Control+Alt+Z');
    assert.strictEqual(adapter._recCalls.length, 1);
    assert.strictEqual(adapter._recCalls[0].accelerator, 'Control+Alt+B');
  });

  test('external-conflict triggers recommendation request', async () => {
    const adapter = createMemoryAdapter(
      { 'Control+Alt+C': { status: 'external-conflict' } },
      { 'Control+Alt+C': { accelerator: 'Control+Alt+Y' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+C');
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'external-conflict');
    assert.strictEqual(snap.recommendation, 'Control+Alt+Y');
  });

  test('invalid shortcut does not trigger recommendation', async () => {
    const adapter = createMemoryAdapter({}, { 'Control': { accelerator: 'Control+Alt+Z' } });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(adapter._recCalls.length, 0);
    assert.strictEqual(draft.getSnapshot().recommendation, null);
  });

  test('unavailable check does not trigger recommendation', async () => {
    const adapter = createMemoryAdapter(
      { 'Control+Alt+D': 'reject' },
      { 'Control+Alt+D': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+D');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(adapter._recCalls.length, 0);
    assert.strictEqual(draft.getSnapshot().recommendation, null);
  });

  test('recommendation is null when adapter returns null', async () => {
    const adapter = createMemoryAdapter(
      { 'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' } },
      { 'Control+Alt+B': null }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().recommendation, null);
  });

  test('recommendation does not auto-apply to draft accelerator', async () => {
    const adapter = createMemoryAdapter(
      { 'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' } },
      { 'Control+Alt+B': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    // Draft accelerator must remain unchanged
    assert.strictEqual(draft.getSnapshot().accelerator, 'Control+Alt+B');
  });

  test('shortcutName is passed to recommendation', async () => {
    const adapter = createMemoryAdapter(
      { 'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' } },
      { 'Control+Alt+B': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('整理文本');

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(adapter._recCalls[0].shortcutName, '整理文本');
  });
});

describe('ShortcutDraft — adopt recommendation', () => {
  test('adopt with available re-check updates draft', async () => {
    const adapter = createMemoryAdapter(
      {
        'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' },
        'Control+Alt+Z': 'resolve',
      },
      { 'Control+Alt+B': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().recommendation, 'Control+Alt+Z');

    draft.adoptRecommendation();
    assert.strictEqual(draft.getSnapshot().status, 'checking');

    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'available');
    assert.strictEqual(snap.accelerator, 'Control+Alt+Z');
    assert.strictEqual(snap.recommendation, null);
  });

  test('adopt when recommendation has become conflict does not update draft', async () => {
    const adapter = createMemoryAdapter(
      {
        'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' },
        'Control+Alt+Z': { status: 'internal-conflict', conflictWith: '新冲突' },
      },
      {
        'Control+Alt+B': { accelerator: 'Control+Alt+Z' },
        'Control+Alt+Z': { accelerator: 'Control+Alt+X' },
      }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    // Original draft accelerator
    assert.strictEqual(draft.getSnapshot().accelerator, 'Control+Alt+B');

    draft.adoptRecommendation();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    // Draft accelerator should NOT have been updated
    assert.strictEqual(snap.accelerator, 'Control+Alt+B');
    // Status should reflect the new conflict
    assert.strictEqual(snap.status, 'internal-conflict');
  });

  test('adopt when recommendation has become unavailable', async () => {
    const adapter = createMemoryAdapter(
      {
        'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' },
        'Control+Alt+Z': 'reject',
      },
      { 'Control+Alt+B': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    draft.adoptRecommendation();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'unavailable');
    assert.strictEqual(snap.accelerator, 'Control+Alt+B');
  });

  test('adopt when no recommendation is a no-op', async () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    // Should not throw
    draft.adoptRecommendation();
    assert.strictEqual(draft.getSnapshot().status, 'idle');
  });

  test('adopt when session closed is a no-op', async () => {
    const adapter = createMemoryAdapter(
      {
        'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' },
        'Control+Alt+Z': 'resolve',
      },
      { 'Control+Alt+B': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    draft.close();
    draft.adoptRecommendation();

    assert.strictEqual(draft.getSnapshot().open, false);
    assert.strictEqual(draft.getSnapshot().status, 'idle');
  });
});

describe('ShortcutDraft — recommendation stale invalidation', () => {
  test('stale recommendation does not overwrite newer state', async () => {
    // First accelerator conflicts (triggers slow recommendation),
    // second accelerator is available (fast check)
    const adapter = {
      checkAvailability(accelerator) {
        if (accelerator === 'Control+Alt+1') {
          return Promise.resolve({ status: 'internal-conflict', conflictWith: 'OLD' });
        }
        return Promise.resolve({ status: 'available' });
      },
      recommendShortcut(accelerator) {
        if (accelerator === 'Control+Alt+1') {
          return new Promise(resolve => {
            setTimeout(() => resolve({ accelerator: 'Control+Alt+Z' }), 50);
          });
        }
        return Promise.resolve(null);
      },
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+1');
    // Immediately switch to a new accelerator
    draft.setAccelerator('Control+Alt+2');

    await new Promise(r => setTimeout(r, 100));

    // The stale recommendation from Control+Alt+1 must NOT appear
    assert.strictEqual(draft.getSnapshot().recommendation, null);
    assert.strictEqual(draft.getSnapshot().status, 'available');
    assert.strictEqual(draft.getSnapshot().accelerator, 'Control+Alt+2');
  });

  test('close invalidates pending recommendation', async () => {
    const adapter = {
      checkAvailability() {
        return Promise.resolve({ status: 'internal-conflict', conflictWith: 'X' });
      },
      recommendShortcut() {
        return new Promise(resolve => {
          setTimeout(() => resolve({ accelerator: 'Control+Alt+Z' }), 50);
        });
      },
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    draft.close();

    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(draft.getSnapshot().open, false);
    assert.strictEqual(draft.getSnapshot().recommendation, null);
  });

  test('new session invalidates pending recommendation', async () => {
    const adapter = {
      checkAvailability() {
        return Promise.resolve({ status: 'internal-conflict', conflictWith: 'X' });
      },
      recommendShortcut() {
        return new Promise(resolve => {
          setTimeout(() => resolve({ accelerator: 'Control+Alt+Z' }), 50);
        });
      },
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    draft.startAdd();

    await new Promise(r => setTimeout(r, 100));

    assert.strictEqual(draft.getSnapshot().status, 'idle');
    assert.strictEqual(draft.getSnapshot().recommendation, null);
  });

  test('recommendation request failure leaves recommendation null', async () => {
    const adapter = createMemoryAdapter(
      { 'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' } },
      { 'Control+Alt+B': 'reject' }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().status, 'internal-conflict');
    assert.strictEqual(draft.getSnapshot().recommendation, null);
  });

  test('recommendation in snapshot is cleared on available status', async () => {
    const adapter = createMemoryAdapter(
      {
        'Control+Alt+B': { status: 'internal-conflict', conflictWith: '已有' },
        'Control+Alt+A': 'resolve',
      },
      { 'Control+Alt+B': { accelerator: 'Control+Alt+Z' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();

    draft.setAccelerator('Control+Alt+B');
    await new Promise(r => setTimeout(r, 0));
    assert.ok(draft.getSnapshot().recommendation !== null);

    // Switch to an available accelerator
    draft.setAccelerator('Control+Alt+A');
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().status, 'available');
    assert.strictEqual(draft.getSnapshot().recommendation, null);
  });
});

// ---------------------------------------------------------------------------
// Save — validation
// ---------------------------------------------------------------------------

describe('ShortcutDraft — save validation', () => {
  test('missing name prevents save and returns missing-name', () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');
    // name left empty

    draft.save();

    assert.strictEqual(draft.getSnapshot().status, 'missing-name');
    assert.strictEqual(adapter._saveCalls.length, 0);
  });

  test('missing shortcut prevents save and returns missing-shortcut', () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');
    // accelerator left empty

    draft.save();

    assert.strictEqual(draft.getSnapshot().status, 'missing-shortcut');
    assert.strictEqual(adapter._saveCalls.length, 0);
  });

  test('invalid shortcut format prevents save and returns invalid', () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control'); // invalid format
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();

    assert.strictEqual(draft.getSnapshot().status, 'invalid');
    assert.strictEqual(adapter._saveCalls.length, 0);
  });

  test('template without variable prevents save and returns invalid-template', () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('没有变量的模板');
    draft.setProviderId('prov-1');

    draft.save();

    assert.strictEqual(draft.getSnapshot().status, 'invalid-template');
    assert.strictEqual(adapter._saveCalls.length, 0);
  });

  test('empty template prevents save and returns invalid-template', () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setProviderId('prov-1');
    // template left empty

    draft.save();

    assert.strictEqual(draft.getSnapshot().status, 'invalid-template');
    assert.strictEqual(adapter._saveCalls.length, 0);
  });

  test('missing provider prevents save and returns missing-provider', () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    // provider left null

    draft.save();

    assert.strictEqual(draft.getSnapshot().status, 'missing-provider');
    assert.strictEqual(adapter._saveCalls.length, 0);
  });

  test('save when session is closed is a no-op', () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    // session not started
    draft.save();
    assert.strictEqual(adapter._saveCalls.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Save — success
// ---------------------------------------------------------------------------

describe('ShortcutDraft — save success', () => {
  test('successful save reads authoritative config and closes session', async () => {
    const adapter = createMemoryAdapter({}, {}, {
      saveResult: { success: true },
      config: {
        shortcuts: [{ id: 'sc-1', name: '测试', shortcut: 'Control+Alt+A', inactive: false }],
        providers: [{ id: 'prov-1', name: 'OpenAI' }],
      },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    assert.strictEqual(draft.getSnapshot().status, 'saving');
    assert.strictEqual(draft.getSnapshot().saving, true);

    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'saved');
    assert.strictEqual(snap.saving, false);
    assert.strictEqual(snap.open, false);
    assert.ok(snap.savedSnapshot !== null);
    assert.strictEqual(snap.savedSnapshot.shortcuts.length, 1);
    assert.strictEqual(snap.savedSnapshot.shortcuts[0].name, '测试');
    assert.strictEqual(adapter._saveCalls.length, 1);
    assert.strictEqual(adapter._configCalls.length, 1);
  });

  test('save passes shortcut object with all fields', async () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('整理');
    draft.setAccelerator('Control+Alt+9');
    draft.setTemplate('请整理：@select_content');
    draft.setProviderId('prov-2');

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(adapter._saveCalls[0].name, '整理');
    assert.strictEqual(adapter._saveCalls[0].shortcut, 'Control+Alt+9');
    assert.strictEqual(adapter._saveCalls[0].template, '请整理：@select_content');
    assert.strictEqual(adapter._saveCalls[0].providerId, 'prov-2');
  });

  test('save in edit mode passes existing id', async () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startEdit({
      id: 'sc-42',
      name: '原有',
      shortcut: 'Control+Alt+8',
      template: '处理 @select_content',
      providerId: 'prov-1',
    });

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(adapter._saveCalls[0].id, 'sc-42');
  });

  test('save does not perform an independent availability check', async () => {
    const adapter = createMemoryAdapter();
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    // Wait for the setAccelerator check to complete, then clear call log
    await new Promise(r => setTimeout(r, 0));
    adapter._clear();

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    // save() should not call checkAvailability — only saveShortcut + getConfig
    assert.strictEqual(adapter._calls.length, 0);
    assert.strictEqual(adapter._saveCalls.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Save — duplicate submission prevention
// ---------------------------------------------------------------------------

describe('ShortcutDraft — save duplicate prevention', () => {
  test('duplicate save calls during saving are ignored', async () => {
    let resolveSave;
    const adapter = {
      checkAvailability: () => Promise.resolve({ status: 'available' }),
      recommendShortcut: () => Promise.resolve(null),
      saveShortcut: () => new Promise(resolve => { resolveSave = resolve; }),
      getConfig: () => Promise.resolve({ shortcuts: [], providers: [] }),
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    assert.strictEqual(draft.getSnapshot().saving, true);

    // Attempt duplicate save — should be ignored
    draft.save();

    assert.strictEqual(draft.getSnapshot().saving, true);

    // Resolve the first save
    resolveSave({ success: true });
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().status, 'saved');
  });
});

// ---------------------------------------------------------------------------
// Save — failure mapping
// ---------------------------------------------------------------------------

describe('ShortcutDraft — save failure', () => {
  test('save failure with invalid reason preserves draft', async () => {
    const adapter = createMemoryAdapter({}, {}, {
      saveResult: { success: false, reason: 'invalid' },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'invalid');
    assert.strictEqual(snap.saveFailureReason, 'invalid');
    // Draft is preserved
    assert.strictEqual(snap.open, true);
    assert.strictEqual(snap.name, '测试');
    assert.strictEqual(snap.accelerator, 'Control+Alt+A');
    assert.strictEqual(snap.saving, false);
  });

  test('save failure with internal-conflict preserves draft', async () => {
    const adapter = createMemoryAdapter(
      {},
      { 'Control+Alt+A': { accelerator: 'Control+Alt+Z' } },
      { saveResult: { success: false, reason: 'internal-conflict' } }
    );
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'internal-conflict');
    assert.strictEqual(snap.saveFailureReason, 'internal-conflict');
    assert.strictEqual(snap.open, true);
    assert.strictEqual(snap.name, '测试');
  });

  test('save failure with external-conflict preserves draft', async () => {
    const adapter = createMemoryAdapter({}, {}, {
      saveResult: { success: false, reason: 'external-conflict' },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'external-conflict');
    assert.strictEqual(snap.saveFailureReason, 'external-conflict');
    assert.strictEqual(snap.open, true);
  });

  test('save failure with unavailable preserves draft', async () => {
    const adapter = createMemoryAdapter({}, {}, {
      saveResult: { success: false, reason: 'unavailable' },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'unavailable');
    assert.strictEqual(snap.saveFailureReason, 'unavailable');
    assert.strictEqual(snap.open, true);
  });

  test('save failure with registration-failed returns save-failure status', async () => {
    const adapter = createMemoryAdapter({}, {}, {
      saveResult: { success: false, reason: 'registration-failed' },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'save-failure');
    assert.strictEqual(snap.saveFailureReason, 'registration-failed');
    assert.strictEqual(snap.open, true);
    assert.strictEqual(snap.name, '测试');
  });

  test('save adapter rejection maps to save-failure', async () => {
    const adapter = createMemoryAdapter({}, {}, {
      saveResult: 'reject',
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    await new Promise(r => setTimeout(r, 0));

    const snap = draft.getSnapshot();
    assert.strictEqual(snap.status, 'save-failure');
    assert.strictEqual(snap.saveFailureReason, 'registration-failed');
    assert.strictEqual(snap.open, true);
  });

  test('failed save can be retried after modifying fields', async () => {
    const adapter = createMemoryAdapter({}, {}, {
      saveResult: { success: false, reason: 'registration-failed' },
    });
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(draft.getSnapshot().status, 'save-failure');

    // Modify a field to clear failure, then retry
    adapter._setSaveResult({ success: true });
    adapter._setConfig({ shortcuts: [], providers: [] });
    draft.setName('测试改');
    draft.save();
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().status, 'saved');
  });
});

// ---------------------------------------------------------------------------
// Save — stale result rejection
// ---------------------------------------------------------------------------

describe('ShortcutDraft — save stale rejection', () => {
  test('close invalidates in-flight save result', async () => {
    let resolveSave;
    const adapter = {
      checkAvailability: () => Promise.resolve({ status: 'available' }),
      recommendShortcut: () => Promise.resolve(null),
      saveShortcut: () => new Promise(resolve => { resolveSave = resolve; }),
      getConfig: () => Promise.resolve({ shortcuts: [], providers: [] }),
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    draft.close();

    // Now resolve the save — should be ignored
    resolveSave({ success: true });
    await new Promise(r => setTimeout(r, 0));

    assert.strictEqual(draft.getSnapshot().status, 'idle');
    assert.strictEqual(draft.getSnapshot().open, false);
    assert.strictEqual(draft.getSnapshot().savedSnapshot, null);
  });

  test('new session invalidates in-flight save result', async () => {
    let resolveSave;
    const adapter = {
      checkAvailability: () => Promise.resolve({ status: 'available' }),
      recommendShortcut: () => Promise.resolve(null),
      saveShortcut: () => new Promise(resolve => { resolveSave = resolve; }),
      getConfig: () => Promise.resolve({ shortcuts: [], providers: [] }),
    };
    const draft = new ShortcutDraft(adapter);
    draft.startAdd();
    draft.setName('测试');
    draft.setAccelerator('Control+Alt+A');
    draft.setTemplate('处理 @select_content');
    draft.setProviderId('prov-1');

    draft.save();
    draft.startAdd();

    resolveSave({ success: true });
    await new Promise(r => setTimeout(r, 0));

    // New session should be idle, save result ignored
    assert.strictEqual(draft.getSnapshot().status, 'idle');
    assert.strictEqual(draft.getSnapshot().savedSnapshot, null);
  });
});
