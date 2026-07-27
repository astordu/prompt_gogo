'use strict';

/**
 * Run Indicator sink — writes and removes inline Run Indicators
 * (`Loading…`) in the Output Target via clipboard paste and
 * backspace key simulation.
 *
 * The sink uses dependency injection for clipboard and key-sending
 * so tests can verify behavior without touching the real system.
 */

const { execFileSync } = require('child_process');

const PASTE_ARGS = ['-e', 'tell application "System Events" to keystroke "v" using command down'];
const BACKSPACE_ARGS = ['-e', 'tell application "System Events" to key code 51'];
const CLIPBOARD_SETTLE_MS = 10;
const PASTE_SETTLE_MS = 30;
const BACKSPACE_SETTLE_MS = 30;

const LOADING_TEXT = 'Loading\u2026'; // single ellipsis character …

/**
 * Sends n backspace keystrokes via osascript.
 *
 * @param {number} count
 * @param {() => void} [backspaceFn] - injectable backspace sender
 */
function sendBackspaces(count, backspaceFn) {
  for (let i = 0; i < count; i++) {
    backspaceFn();
  }
}

/**
 * Creates a Run Indicator sink.
 *
 * @param {Object} [deps] - Optional dependency injection for testing
 * @param {Object} [deps.clipboard] - Electron clipboard module
 * @param {Function} [deps.paste] - Function that performs Cmd+V paste
 * @param {Function} [deps.backspace] - Function that sends one BackSpace key
 */
function createRunIndicatorSink(deps) {
  const cb = (deps && deps.clipboard) || null;
  const paste = (deps && deps.paste) || (() => execFileSync('osascript', PASTE_ARGS));
  const backspace = (deps && deps.backspace) || (() => {
    execFileSync('osascript', BACKSPACE_ARGS);
  });

  /**
   * Writes text at the current cursor position via clipboard paste.
   * @param {string} text
   */
  async function write(text) {
    if (!cb) throw new Error('clipboard is required for write');
    cb.writeText(text);
    await new Promise(r => setTimeout(r, CLIPBOARD_SETTLE_MS));
    paste();
    await new Promise(r => setTimeout(r, PASTE_SETTLE_MS));
  }

  /**
   * Deletes `count` characters backwards from the cursor.
   * @param {number} count
   */
  async function deleteBack(count) {
    sendBackspaces(count, backspace);
    await new Promise(r => setTimeout(r, BACKSPACE_SETTLE_MS));
  }

  return { write, deleteBack };
}

module.exports = { createRunIndicatorSink, LOADING_TEXT, BACKSPACE_ARGS };
