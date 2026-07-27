'use strict';

/**
 * Output Target adapter for macOS.
 *
 * Captures the focused application's bundle identifier (or process
 * name) at trigger time and validates that the same application is
 * still frontmost before every write/delete/restore operation.
 *
 * Uses dependency injection so that tests can provide an in-memory
 * target without running osascript.
 */

const { execSync } = require('child_process');

/**
 * Query the current frontmost application's bundle identifier.
 *
 * @returns {string} The bundle identifier (or empty string on failure)
 */
function getFrontmostApp() {
  try {
    const result = execSync(
      `osascript -e 'tell application "System Events" to get bundle identifier of first application process whose frontmost is true'`,
      { encoding: 'utf8', timeout: 2000 }
    ).trim();
    return result;
  } catch {
    // Some apps don't have a bundle identifier — fall back to process name
    try {
      const result = execSync(
        `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
        { encoding: 'utf8', timeout: 2000 }
      ).trim();
      return result;
    } catch {
      return '';
    }
  }
}

/**
 * Creates an Output Target that captures and validates the frontmost
 * macOS application.
 *
 * @param {Object} [deps] - Optional dependency injection for testing
 * @param {() => string} [deps.getFrontmostApp] - Returns the current frontmost app identifier
 */
function createOutputTarget(deps) {
  const getApp = (deps && deps.getFrontmostApp) || getFrontmostApp;

  let capturedApp = null;

  function capture() {
    capturedApp = getApp();
  }

  function isValid() {
    if (capturedApp === null) return false;
    const currentApp = getApp();
    return currentApp === capturedApp;
  }

  return { capture, isValid };
}

module.exports = { createOutputTarget, getFrontmostApp };
