'use strict';

const { clipboard } = require('electron');
const { execFileSync } = require('child_process');

const PASTE_ARGS = ['-e', 'tell application "System Events" to keystroke "v" using command down'];
const CLIPBOARD_SETTLE_MS = 10;
const PASTE_SETTLE_MS = 30;

/**
 * Creates a clipboard-based sink that writes text by overwriting the
 * system clipboard and simulating Cmd+V paste.
 *
 * Conditional clipboard restore: on close(), the original clipboard
 * value is restored ONLY if the current clipboard still equals the
 * last value this sink wrote. If the user copied new content during
 * the Run, that new content is preserved.
 *
 * @param {Object} [deps] - Optional dependency injection for testing
 * @param {Object} [deps.clipboard] - Electron clipboard module
 * @param {Function} [deps.paste] - Function that performs the paste keystroke
 */
function createClipboardSink(deps) {
  const cb = (deps && deps.clipboard) || clipboard;
  const paste = (deps && deps.paste) || (() => execFileSync('osascript', PASTE_ARGS));

  let savedClipboard = null;
  let lastWritten = null;

  async function write(text) {
    if (savedClipboard === null) {
      savedClipboard = cb.readText();
    }
    lastWritten = text;
    cb.writeText(text);
    await new Promise(r => setTimeout(r, CLIPBOARD_SETTLE_MS));
    paste();
    await new Promise(r => setTimeout(r, PASTE_SETTLE_MS));
  }

  async function close() {
    if (savedClipboard !== null) {
      await new Promise(r => setTimeout(r, PASTE_SETTLE_MS));
      // Conditional restore: only restore if the user hasn't copied
      // something new during the Run
      if (cb.readText() === lastWritten) {
        cb.writeText(savedClipboard);
      }
    }
  }

  return { write, close };
}

module.exports = { createClipboardSink };
