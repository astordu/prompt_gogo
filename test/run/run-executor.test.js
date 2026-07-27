'use strict';

const { describe, test, beforeEach } = require('node:test');
const assert = require('node:assert');

const { RunCoordinator, ENDING_HOLD_MS } = require('../../src/run/run-coordinator');
const { RunExecutor } = require('../../src/run/run-executor');

// ---------------------------------------------------------------------------
// In-memory adapter fakes
// ---------------------------------------------------------------------------

/** Fake cancel registrar — registers / unregisters accelerators. */
function createFakeRegistrar() {
  const registered = new Map();
  return {
    register(accel, cb) { registered.set(accel, cb); return true; },
    unregister(accel) { registered.delete(accel); },
    _trigger(accel) { const cb = registered.get(accel); if (cb) cb(); },
    _has(accel) { return registered.has(accel); },
  };
}

/** Fake notifier — collects notifications. */
function createFakeNotifier() {
  const notes = [];
  return {
    notify(t, b) { notes.push({ title: t, body: b }); },
    _all() { return notes; },
    _titles() { return notes.map(n => n.title); },
    _clear() { notes.length = 0; },
  };
}

/** Fake output target — can be invalidated mid-run. */
function createFakeOutputTarget() {
  let captured = false;
  let valid = true;
  return {
    capture() { captured = true; valid = true; },
    isValid() { return captured && valid; },
    _invalidate() { valid = false; },
  };
}

/** Fake run indicator — records write/deleteBack calls. */
function createFakeRunIndicator() {
  const ops = [];
  return {
    async write(text) { ops.push({ type: 'write', text }); },
    async deleteBack(count) { ops.push({ type: 'deleteBack', count }); },
    _ops() { return ops; },
    _writes() { return ops.filter(o => o.type === 'write').map(o => o.text); },
    _deleteCounts() { return ops.filter(o => o.type === 'deleteBack').map(o => o.count); },
  };
}

/** Fake clipboard sink — records writes and close. */
function createFakeSink() {
  const writes = [];
  let closed = false;
  return {
    async write(text) { writes.push(text); },
    async close() { closed = true; },
    _writes() { return writes; },
    _text() { return writes.join(''); },
    _closed() { return closed; },
  };
}

/**
 * Fake model-request adapter.
 *
 * `chunks` is an array of strings to yield. `delay` inserts a microtask
 * pause between chunks so cancellation can be tested. `failWith` makes
 * the request throw immediately.
 */
function createFakeModelRequest(opts = {}) {
  const calls = [];
  return {
    async send(requestConfig, prompt, signal) {
      calls.push({ requestConfig, prompt, signal });
      if (opts.failWith) throw opts.failWith;

      const chunks = typeof opts.chunks === 'function' ? opts.chunks() : (opts.chunks || []);

      async function* gen() {
        for (const chunk of chunks) {
          if (opts.yieldDelay) { await new Promise(r => setTimeout(r, opts.yieldDelay)); }
          yield chunk;
        }
      }
      return gen();
    },
    _calls() { return calls; },
  };
}

// ---------------------------------------------------------------------------
// Helpers to assemble a full executor with memory adapters
// ---------------------------------------------------------------------------

function makeExecutor(opts = {}) {
  const registrar = opts.registrar || createFakeRegistrar();
  const notifier = opts.notifier || createFakeNotifier();
  const outputTarget = opts.outputTarget || createFakeOutputTarget();
  const runIndicator = opts.runIndicator || createFakeRunIndicator();
  const modelRequest = opts.modelRequest || createFakeModelRequest({ chunks: ['Hello ', 'world!'] });
  const providers = opts.providers !== undefined ? opts.providers : [
    { id: 'p1', type: 'deepseek', apiKey: 'key', model: 'm' },
  ];

  const coordinator = new RunCoordinator({
    cancelRegistrar: registrar,
    onNotify: (t, b) => notifier.notify(t, b),
    readSelectedText: opts.readSelectedText || (async () => 'selected text'),
    outputTarget,
    runIndicator,
    delay: opts.delay || ((ms) => new Promise(r => setTimeout(r, ms))),
  });

  const sinks = [];
  const executor = new RunExecutor({
    coordinator,
    readSelectedText: opts.readSelectedText || (async () => 'selected text'),
    findProvider: opts.findProvider || ((id) => providers.find(p => p.id === id) || null),
    sendModelRequest: (cfg, prompt, signal) => modelRequest.send(cfg, prompt, signal),
    createSink: () => { const s = createFakeSink(); sinks.push(s); return s; },
    onNotify: (t, b) => notifier.notify(t, b),
    onShowWindow: opts.onShowWindow || (() => {}),
  });

  return { executor, coordinator, registrar, notifier, outputTarget, runIndicator, modelRequest, sinks };
}

/** Standard shortcut used in most tests. */
const SHORTCUT = {
  name: 'test',
  shortcut: 'Control+Alt+9',
  template: 'Process: @select_content',
  providerId: 'p1',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RunExecutor — normal completion', () => {
  test('writes model content to the Output Target via clipboard sink', async () => {
    const { executor, sinks, notifier, runIndicator } = makeExecutor({
      modelRequest: createFakeModelRequest({ chunks: ['Hello ', 'world!'] }),
    });

    await executor.execute(SHORTCUT);

    assert.strictEqual(sinks.length, 1);
    assert.strictEqual(sinks[0]._text(), 'Hello world!');
    assert.strictEqual(sinks[0]._closed(), true);
    assert.strictEqual(notifier._all().length, 0);
  });

  test('preserves S → content → E indicator lifecycle', async () => {
    const { executor, runIndicator } = makeExecutor({
      modelRequest: createFakeModelRequest({ chunks: ['Hello ', 'world!'] }),
    });

    await executor.execute(SHORTCUT);

    // S written, then deleted back, then E written, then deleted back
    const writes = runIndicator._writes();
    assert.deepStrictEqual(writes, ['S', 'E']);
    assert.deepStrictEqual(runIndicator._deleteCounts(), [1, 1]);
  });
});

describe('RunExecutor — mutual exclusion', () => {
  test('rejects a second trigger while a Run is active', async () => {
    const modelRequest = createFakeModelRequest({
      chunks: ['Hello ', 'world!'],
      yieldDelay: 50,
    });
    const { executor, notifier, coordinator } = makeExecutor({ modelRequest });

    // Start first run but don't await — it will take time due to yieldDelay
    const run1 = executor.execute(SHORTCUT);
    // Give it a tick to enter the active state
    await new Promise(r => setTimeout(r, 5));

    assert.strictEqual(coordinator.isActive(), true);

    // Try a second trigger
    await executor.execute(SHORTCUT);

    // The second trigger should have been rejected with a notification
    const titles = notifier._titles();
    assert.ok(titles.includes('已有运行任务'));

    // Wait for the first run to finish
    await run1;

    assert.strictEqual(coordinator.isActive(), false);
  });
});

describe('RunExecutor — cancellation', () => {
  test('cancel during text read sends cancel notification', async () => {
    const { executor, registrar, notifier } = makeExecutor({
      readSelectedText: async () => {
        // Simulate user pressing cancel during read
        registrar._trigger('Command+Escape');
        await new Promise(r => setTimeout(r, 10));
        return 'text that should be ignored';
      },
    });

    await executor.execute(SHORTCUT);

    assert.ok(notifier._titles().includes('已取消'));
  });

  test('cancel during request — Loading aborted, original text restored', async () => {
    const { executor, registrar, notifier, runIndicator } = makeExecutor({
      modelRequest: createFakeModelRequest({
        chunks: () => {
          // Cancel before any chunk arrives
          registrar._trigger('Command+Escape');
          return ['ignored'];
        },
        yieldDelay: 20,
      }),
    });

    await executor.execute(SHORTCUT);

    // Loading should have been aborted (S written then deleted, original restored)
    const writes = runIndicator._writes();
    assert.ok(writes.includes('S'));
    // abortLoading deletes S and restores original text
    assert.ok(notifier._titles().includes('已取消'));
  });

  test('cancel after first model content — written content preserved', async () => {
    const registrar = createFakeRegistrar();
    const notifier = createFakeNotifier();
    const outputTarget = createFakeOutputTarget();
    const runIndicator = createFakeRunIndicator();

    const coordinator = new RunCoordinator({
      cancelRegistrar: registrar,
      onNotify: (t, b) => notifier.notify(t, b),
      readSelectedText: async () => 'selected text',
      outputTarget,
      runIndicator,
    });

    // Use a large first chunk (>= 30 chars) so pipeToCursor flushes immediately,
    // then cancel before the second chunk is consumed.
    let firstYielded = false;
    const longChunk = 'This is the first chunk of content that exceeds thirty chars.';
    const mr = createFakeModelRequest({
      chunks: [longChunk, 'second chunk that should not appear'],
    });
    const origSend = mr.send;
    mr.send = async function (cfg, prompt, signal) {
      const gen = await origSend.call(this, cfg, prompt, signal);
      async function* wrap() {
        for await (const chunk of gen) {
          yield chunk;
          if (!firstYielded) {
            firstYielded = true;
            registrar._trigger('Command+Escape');
          }
        }
      }
      return wrap();
    };

    const sinks = [];
    const executor = new RunExecutor({
      coordinator,
      readSelectedText: async () => 'selected text',
      findProvider: () => ({ id: 'p1', type: 'deepseek', apiKey: 'k', model: 'm' }),
      sendModelRequest: (cfg, p, s) => mr.send(cfg, p, s),
      createSink: () => { const s = createFakeSink(); sinks.push(s); return s; },
      onNotify: (t, b) => notifier.notify(t, b),
    });

    await executor.execute(SHORTCUT);

    // The first chunk was written (content preserved, not rolled back)
    assert.ok(sinks.length >= 1);
    assert.ok(sinks[0]._text().includes('first chunk'));
    // Second chunk should not appear
    assert.ok(!sinks[0]._text().includes('second chunk'));
    // Cancel notification sent
    assert.ok(notifier._titles().includes('已取消'));
  });

  test('Cancel Shortcut lifecycle does not leak — unregistered after Run', async () => {
    const { executor, registrar } = makeExecutor();

    await executor.execute(SHORTCUT);

    assert.strictEqual(registrar._has('Command+Escape'), false);
  });
});

describe('RunExecutor — Output Target invalid', () => {
  test('target invalid during read — no content written', async () => {
    const { executor, notifier, outputTarget, sinks } = makeExecutor({
      readSelectedText: async () => {
        outputTarget._invalidate();
        await new Promise(r => setTimeout(r, 10));
        return 'text';
      },
    });

    await executor.execute(SHORTCUT);

    assert.strictEqual(sinks.length, 0);
    assert.ok(notifier._titles().includes('输出目标已失效'));
  });
});

describe('RunExecutor — Provider errors', () => {
  test('Provider missing — notification and show window', async () => {
    const windowShown = [];
    const { executor, notifier, sinks } = makeExecutor({
      findProvider: () => null,
      onShowWindow: () => windowShown.push(true),
    });

    await executor.execute({ ...SHORTCUT, providerId: 'missing' });

    assert.strictEqual(sinks.length, 0);
    assert.ok(notifier._titles().includes('Provider 缺失'));
    assert.strictEqual(windowShown.length, 1);
  });

  test('Provider invalid — notification and show window', async () => {
    const windowShown = [];
    const { executor, notifier, sinks } = makeExecutor({
      providers: [{ id: 'p1', type: 'deepseek', apiKey: '', model: '' }],
      onShowWindow: () => windowShown.push(true),
    });

    await executor.execute(SHORTCUT);

    assert.strictEqual(sinks.length, 0);
    assert.ok(notifier._titles().includes('Provider 配置不完整'));
    assert.strictEqual(windowShown.length, 1);
  });
});

describe('RunExecutor — empty input', () => {
  test('empty selected text — notification, no model request', async () => {
    const { executor, notifier, modelRequest, sinks } = makeExecutor({
      readSelectedText: async () => '',
    });

    await executor.execute(SHORTCUT);

    assert.strictEqual(modelRequest._calls().length, 0);
    assert.strictEqual(sinks.length, 0);
    assert.ok(notifier._titles().includes('未能获取文本'));
  });

  test('whitespace-only selected text — notification', async () => {
    const { executor, notifier } = makeExecutor({
      readSelectedText: async () => '   \n  ',
    });

    await executor.execute(SHORTCUT);

    assert.ok(notifier._titles().includes('未能获取文本'));
  });
});

describe('RunExecutor — empty model content', () => {
  test('no content received — Loading aborted, error notification', async () => {
    const { executor, notifier, runIndicator } = makeExecutor({
      modelRequest: createFakeModelRequest({ chunks: [] }),
    });

    await executor.execute(SHORTCUT);

    // S was shown and then aborted (restored)
    assert.ok(notifier._titles().includes('错误'));
    assert.ok(notifier._all().some(n => n.body === '未收到任何模型内容'));
  });
});

describe('RunExecutor — model request failure', () => {
  test('HTTP 401 — mapped to API Key error notification', async () => {
    const err = new Error('Request failed with status code 401');
    err.response = { status: 401 };
    const { executor, notifier } = makeExecutor({
      modelRequest: createFakeModelRequest({ failWith: err }),
    });

    await executor.execute(SHORTCUT);

    assert.ok(notifier._titles().includes('错误'));
    assert.ok(notifier._all().some(n => n.body === 'API Key 无效，请检查您的配置'));
  });

  test('HTTP 429 — mapped to rate limit notification', async () => {
    const err = new Error('429');
    err.response = { status: 429 };
    const { executor, notifier } = makeExecutor({
      modelRequest: createFakeModelRequest({ failWith: err }),
    });

    await executor.execute(SHORTCUT);

    assert.ok(notifier._all().some(n => n.body === 'API 请求次数超限，请稍后重试'));
  });

  test('HTTP 500 — mapped to server error notification', async () => {
    const err = new Error('500');
    err.response = { status: 500 };
    const { executor, notifier } = makeExecutor({
      modelRequest: createFakeModelRequest({ failWith: err }),
    });

    await executor.execute(SHORTCUT);

    assert.ok(notifier._all().some(n => n.body === 'API 服务暂时不可用，请稍后重试'));
  });

  test('timeout — mapped to timeout notification', async () => {
    const err = new Error('timeout');
    err.code = 'ECONNABORTED';
    const { executor, notifier } = makeExecutor({
      modelRequest: createFakeModelRequest({ failWith: err }),
    });

    await executor.execute(SHORTCUT);

    assert.ok(notifier._all().some(n => n.body === '请求超时，请检查网络连接'));
  });

  test('generic error — mapped to default notification', async () => {
    const err = new Error('something broke');
    const { executor, notifier } = makeExecutor({
      modelRequest: createFakeModelRequest({ failWith: err }),
    });

    await executor.execute(SHORTCUT);

    assert.ok(notifier._all().some(n => n.body === '错误: something broke'));
  });
});

describe('RunExecutor — Ending indicator', () => {
  test('Ending indicator shown for 500ms on normal completion', async () => {
    let delayMs = null;
    const { executor, runIndicator } = makeExecutor({
      delay: (ms) => { delayMs = ms; return Promise.resolve(); },
    });

    await executor.execute(SHORTCUT);

    // Ending was written and then removed
    assert.ok(runIndicator._writes().includes('E'));
    assert.strictEqual(delayMs, ENDING_HOLD_MS);
  });
});
