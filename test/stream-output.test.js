'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');
const { pipeToCursor } = require('../src/stream-output');

function createMemorySink() {
  const writes = [];
  let closed = false;
  return {
    async write(text) { writes.push(text); },
    async close() { closed = true; },
    writes,
    get isClosed() { return closed; },
  };
}

async function* chunksFromArray(arr) {
  for (const item of arr) yield item;
}

describe('pipeToCursor — completeness', () => {
  test('concatenated output equals concatenated input', async () => {
    const sink = createMemorySink();
    const inputs = ['Hello', ' ', 'World', '!', ' This is a test.'];
    await pipeToCursor(chunksFromArray(inputs), sink);
    assert.strictEqual(sink.writes.join(''), inputs.join(''));
  });

  test('ordering preserved across many small chunks', async () => {
    const sink = createMemorySink();
    const inputs = Array.from({ length: 10 }, (_, i) => `chunk${i}#`);
    await pipeToCursor(chunksFromArray(inputs), sink);
    assert.strictEqual(sink.writes.join(''), inputs.join(''));
  });
});

describe('pipeToCursor — char threshold buffering', () => {
  test('high-frequency small chunks are merged', async () => {
    const sink = createMemorySink();
    const inputs = Array.from({ length: 100 }, () => 'x');
    await pipeToCursor(chunksFromArray(inputs), sink);
    // 100 chars / 30 threshold = 3 full batches + 1 remainder = 4 writes
    assert.ok(sink.writes.length < inputs.length,
      `write count (${sink.writes.length}) should be much less than chunk count (${inputs.length})`);
    assert.strictEqual(sink.writes.length, 4);
  });

  test('each write meets threshold except the last', async () => {
    const sink = createMemorySink();
    await pipeToCursor(chunksFromArray(Array.from({ length: 100 }, () => 'x')), sink);
    for (let i = 0; i < sink.writes.length - 1; i++) {
      assert.ok(sink.writes[i].length >= 30,
        `write[${i}] length ${sink.writes[i].length} should be >= 30`);
    }
  });
});

describe('pipeToCursor — flush on end', () => {
  test('tail content below threshold is not lost', async () => {
    const sink = createMemorySink();
    await pipeToCursor(chunksFromArray(Array.from({ length: 35 }, () => 'a')), sink);
    assert.strictEqual(sink.writes.join(''), 'a'.repeat(35));
    assert.strictEqual(sink.writes.length, 2);
    assert.strictEqual(sink.writes[0].length, 30);
    assert.strictEqual(sink.writes[1].length, 5);
  });

  test('single small chunk below threshold is flushed on end', async () => {
    const sink = createMemorySink();
    await pipeToCursor(chunksFromArray(['tiny']), sink);
    assert.strictEqual(sink.writes.length, 1);
    assert.strictEqual(sink.writes[0], 'tiny');
  });

  test('exact multiple of threshold produces no empty trailing write', async () => {
    const sink = createMemorySink();
    await pipeToCursor(chunksFromArray(Array.from({ length: 90 }, () => 'a')), sink);
    assert.strictEqual(sink.writes.length, 3);
    assert.strictEqual(sink.writes.join(''), 'a'.repeat(90));
  });
});

describe('pipeToCursor — sink lifecycle', () => {
  test('sink.close() called after stream ends', async () => {
    const sink = createMemorySink();
    await pipeToCursor(chunksFromArray(['hello']), sink);
    assert.ok(sink.isClosed);
  });

  test('sink.close() called even on empty stream', async () => {
    const sink = createMemorySink();
    await pipeToCursor(chunksFromArray([]), sink);
    assert.ok(sink.isClosed);
    assert.strictEqual(sink.writes.length, 0);
  });

  test('sink.close() called when upstream throws', async () => {
    const sink = createMemorySink();
    async function* throwingStream() {
      yield 'safe chunk';
      throw new Error('upstream failure');
    }
    await assert.rejects(pipeToCursor(throwingStream(), sink), /upstream failure/);
    assert.ok(sink.isClosed);
  });
});

describe('pipeToCursor — time window flush', () => {
  // Helper: async generator that yields items with a delay between each
  async function* chunksWithDelay(arr, delayMs) {
    for (const item of arr) {
      yield item;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  test('low-frequency chunks are flushed before char threshold', async () => {
    const sink = createMemorySink();
    // Each chunk is 5 chars — well below the 30-char threshold.
    // With 250ms delay between chunks the 200ms timer fires first each time.
    const inputs = ['aaaaa', 'bbbbb', 'ccccc'];
    await pipeToCursor(chunksWithDelay(inputs, 250), sink);
    // Every chunk should be flushed individually by the timer
    assert.strictEqual(sink.writes.join(''), inputs.join(''));
    assert.strictEqual(sink.writes.length, 3,
      `expected 3 timer-triggered writes, got ${sink.writes.length}`);
  });

  test('time-window flush preserves completeness and order', async () => {
    const sink = createMemorySink();
    const inputs = Array.from({ length: 5 }, (_, i) => `item${i}`);
    await pipeToCursor(chunksWithDelay(inputs, 250), sink);
    assert.strictEqual(sink.writes.join(''), inputs.join(''));
  });
});

describe('pipeToCursor — edge cases', () => {
  test('chunks that individually exceed threshold flush immediately', async () => {
    const sink = createMemorySink();
    const inputs = ['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)];
    await pipeToCursor(chunksFromArray(inputs), sink);
    assert.strictEqual(sink.writes.length, 3);
    assert.strictEqual(sink.writes[0], 'a'.repeat(30));
    assert.strictEqual(sink.writes[1], 'b'.repeat(30));
    assert.strictEqual(sink.writes[2], 'c'.repeat(30));
  });

  test('empty string chunks do not cause empty writes', async () => {
    const sink = createMemorySink();
    const inputs = ['', 'a'.repeat(30), '', 'b'.repeat(30), ''];
    await pipeToCursor(chunksFromArray(inputs), sink);
    // 60 chars → 2 writes of 30 each
    assert.strictEqual(sink.writes.length, 2);
    assert.strictEqual(sink.writes.join(''), 'a'.repeat(30) + 'b'.repeat(30));
  });
});
