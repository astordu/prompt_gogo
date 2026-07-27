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
const LEFT_ARROW_KEYCODE = 123;
const BACKSPACE_KEYCODE = 51;
const CLIPBOARD_SETTLE_MS = 10;
const PASTE_SETTLE_MS = 30;
const DELETE_SETTLE_MS = 30;

const LOADING_TEXT = 'Loading\u2026'; // single ellipsis character …

/**
 * Builds the AppleScript arguments for selecting `count` characters
 * backwards (Shift + Left arrow) and then deleting the selection with
 * a single BackSpace.  This replaces the previous loop of N individual
 * backspace presses so that the Run Indicator disappears as one unit
 * instead of collapsing character-by-character.
 *
 * Exported so tests can assert the generated command.
 *
 * @param {number} count
 * @returns {string[]}
 */
function buildSelectAndDeleteArgs(count) {
  const script = [
    'tell application "System Events"',
    `  repeat ${count} times`,
    `    key code ${LEFT_ARROW_KEYCODE} using {shift down}`,
    '  end repeat',
    `  key code ${BACKSPACE_KEYCODE}`,
    'end tell',
  ].join('\n');
  return ['-e', script];
}

/**
 * Creates a Run Indicator sink.
 *
 * @param {Object} [deps] - Optional dependency injection for testing
 * @param {Object} [deps.clipboard] - Electron clipboard module
 * @param {Function} [deps.paste] - Function that performs Cmd+V paste
 * @param {Function} [deps.selectAndDelete] - Function that selects `count`
 *   characters backwards and deletes the selection in one atomic action.
 *   Receives the character count as its sole argument.
 */
function createRunIndicatorSink(deps) {
  const cb = (deps && deps.clipboard) || null;
  const paste = (deps && deps.paste) || (() => execFileSync('osascript', PASTE_ARGS));
  const selectAndDelete = (deps && deps.selectAndDelete) || ((count) => {
    execFileSync('osascript', buildSelectAndDeleteArgs(count));
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
   * Deletes `count` characters backwards from the cursor as a single
   * atomic operation (select backwards + one delete) instead of N
   * individual backspace presses.
   * @param {number} count
   */
  async function deleteBack(count) {
    selectAndDelete(count);
    await new Promise(r => setTimeout(r, DELETE_SETTLE_MS));
  }

  return { write, deleteBack };
}

module.exports = { createRunIndicatorSink, LOADING_TEXT, buildSelectAndDeleteArgs };
