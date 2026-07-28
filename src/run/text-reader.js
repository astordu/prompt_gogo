'use strict';

/**
 * Selected-text reader for macOS.
 *
 * Tries the Accessibility API (AXSelectedText) first, falling back to
 * a Cmd+C clipboard copy when the focused element exposes no
 * selection attribute.
 *
 * Uses dependency injection so tests can provide fake implementations.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Read the selected text via the Accessibility API.
 *
 * @param {(script: string) => string} runScript - executes an AppleScript string
 * @returns {string} the selected text, or '' on failure
 */
function readViaAccessibility(runScript) {
  const scriptPath = path.join(os.tmpdir(), 'get-selected-text.scpt');

  const appleScriptContent = `tell application "System Events"
  set frontApp to first application process whose frontmost is true
  tell frontApp
    try
      if exists (attribute "AXFocusedUIElement") then
        set focusedElement to value of attribute "AXFocusedUIElement"
        if exists (attribute "AXSelectedText" of focusedElement) then
          return value of attribute "AXSelectedText" of focusedElement
        else
          return "ERROR:No AXSelectedText attribute"
        end if
      else
        return "ERROR:No focused element"
      end if
    on error errMsg
      return "ERROR:" & errMsg
    end try
  end tell
end tell`;

  try {
    fs.writeFileSync(scriptPath, appleScriptContent, 'utf8');
    const result = runScript(`osascript "${scriptPath}"`);
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // ignore
    }
    if (result && !result.startsWith('ERROR:') && result.trim() !== '') {
      return result;
    }
  } catch {
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // ignore
    }
  }
  return '';
}

/**
 * Create a selected-text reader.
 *
 * @param {Object} deps
 * @param {Object} deps.clipboard - Electron clipboard module (readText)
 * @param {(script: string) => string} [deps.runScript] - runs a shell command synchronously, returns stdout string
 * @param {(ms: number) => Promise<void>} [deps.delay] - async delay (ms)
 */
function createTextReader({ clipboard, runScript, delay }) {
  const exec = runScript || ((cmd) => execSync(cmd, { encoding: 'utf8', timeout: 2000 }).trim());
  const wait = delay || ((ms) => new Promise(r => setTimeout(r, ms)));

  async function readSelectedText() {
    const text = readViaAccessibility(exec);
    if (text) return text;
    return await fallbackToClipboard();
  }

  async function fallbackToClipboard() {
    try {
      exec(`osascript -e 'tell application "System Events" to keystroke "c" using command down'`);
      await wait(500);
      const selectedText = clipboard.readText();
      if (selectedText && selectedText.trim() !== '') {
        return selectedText;
      }
      return '';
    } catch {
      return '';
    }
  }

  return { readSelectedText };
}

module.exports = { createTextReader };
