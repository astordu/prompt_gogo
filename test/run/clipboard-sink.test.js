'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');

/**
 * Tests for the conditional clipboard restore behavior.
 *
 * The clipboard sink saves the original clipboard on first write,
 * and restores it on close ONLY if the user hasn't copied something
 * new during the Run.
 *
 * These tests use an in-memory fake clipboard and fake paste function
 * to avoid touching the real system clipboard.
 */

function createFakeClipboard() {
  let text = '';
  return {
    readText() { return text; },
    writeText(value) { text = value; },
    _set(value) { text = value; },
    _get() { return text; },
  };
}

describe('clipboard-sink — conditional restore', () => {
  test('restores original clipboard on close when user did not copy', async () => {
    const { createClipboardSink } = require('../../src/run/clipboard-sink');
    const clipboard = createFakeClipboard();
    clipboard._set('user-original');

    const sink = createClipboardSink({ clipboard, paste: () => {} });

    await sink.write('AI output 1');
    await sink.write('AI output 2');
    await sink.close();

    // Clipboard should be restored to the original value
    assert.strictEqual(clipboard._get(), 'user-original');
  });

  test('preserves user\'s new clipboard content when user copied during Run', async () => {
    const { createClipboardSink } = require('../../src/run/clipboard-sink');
    const clipboard = createFakeClipboard();
    clipboard._set('user-original');

    const sink = createClipboardSink({ clipboard, paste: () => {} });

    await sink.write('AI output');

    // Simulate user copying new content (overwrites the clipboard)
    clipboard._set('user-copied-new');

    await sink.close();

    // User's new content should be preserved, not overwritten
    assert.strictEqual(clipboard._get(), 'user-copied-new');
  });

  test('does not restore if clipboard differs from last written', async () => {
    const { createClipboardSink } = require('../../src/run/clipboard-sink');
    const clipboard = createFakeClipboard();
    clipboard._set('original');

    const sink = createClipboardSink({ clipboard, paste: () => {} });

    await sink.write('AI text');

    // User copies something completely different
    clipboard._set('totally-different');

    await sink.close();

    assert.strictEqual(clipboard._get(), 'totally-different');
  });

  test('close with no writes is a no-op', async () => {
    const { createClipboardSink } = require('../../src/run/clipboard-sink');
    const clipboard = createFakeClipboard();
    clipboard._set('user-data');

    const sink = createClipboardSink({ clipboard, paste: () => {} });
    await sink.close();

    // Nothing was written, so nothing should be restored
    assert.strictEqual(clipboard._get(), 'user-data');
  });

  test('multiple writes track the last written value for conditional restore', async () => {
    const { createClipboardSink } = require('../../src/run/clipboard-sink');
    const clipboard = createFakeClipboard();
    clipboard._set('original');

    const sink = createClipboardSink({ clipboard, paste: () => {} });

    await sink.write('first');
    await sink.write('second');
    await sink.write('third');

    // Clipboard now equals 'third' (the last written value)
    // User did NOT copy anything, so restore should happen
    await sink.close();
    assert.strictEqual(clipboard._get(), 'original');
  });

  test('restore happens even when last written equals original (edge case)', async () => {
    const { createClipboardSink } = require('../../src/run/clipboard-sink');
    const clipboard = createFakeClipboard();
    clipboard._set('same-value');

    const sink = createClipboardSink({ clipboard, paste: () => {} });

    await sink.write('same-value');
    await sink.close();

    // The lastWritten is 'same-value' and clipboard still equals 'same-value'
    // So restore should write 'same-value' (which is a no-op effectively)
    assert.strictEqual(clipboard._get(), 'same-value');
  });
});
