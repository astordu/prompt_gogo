'use strict';

const { clipboard } = require('electron');
const { execFileSync } = require('child_process');

const PASTE_ARGS = ['-e', 'tell application "System Events" to keystroke "v" using command down'];
const CLIPBOARD_SETTLE_MS = 10;
const PASTE_SETTLE_MS = 30;

function createClipboardSink() {
  let savedClipboard = null;

  async function write(text) {
    if (savedClipboard === null) {
      savedClipboard = clipboard.readText();
    }
    clipboard.writeText(text);
    await new Promise(r => setTimeout(r, CLIPBOARD_SETTLE_MS));
    execFileSync('osascript', PASTE_ARGS);
    await new Promise(r => setTimeout(r, PASTE_SETTLE_MS));
  }

  async function close() {
    if (savedClipboard !== null) {
      await new Promise(r => setTimeout(r, PASTE_SETTLE_MS));
      clipboard.writeText(savedClipboard);
    }
  }

  return { write, close };
}

module.exports = { createClipboardSink };
