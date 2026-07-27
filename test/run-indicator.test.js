'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');

const { createRunIndicatorSink, buildSelectAndDeleteArgs } = require('../src/run-indicator');

/**
 * Simulates a text field that supports paste, backspace (single char),
 * and selectAndDelete (select N chars backwards then delete the selection
 * in one atomic action).
 */
function createTextField(initialText, cursorPosition) {
  let beforeCursor = initialText.slice(0, cursorPosition);
  let afterCursor = initialText.slice(cursorPosition);
  // Track the current selection length (number of chars selected
  // backwards from the cursor).  selectAndDelete grows this, then
  // removes the selected range in one step.
  let selectionLen = 0;

  return {
    paste(text) {
      beforeCursor += text;
      selectionLen = 0;
    },
    backspace() {
      beforeCursor = beforeCursor.slice(0, -1);
      selectionLen = 0;
    },
    forwardDelete() {
      afterCursor = afterCursor.slice(1);
      selectionLen = 0;
    },
    /**
     * Atomically select `count` chars backwards and delete them.
     * The text disappears as one unit — no intermediate per-char state.
     */
    selectAndDelete(count) {
      const start = beforeCursor.length - count;
      beforeCursor = beforeCursor.slice(0, Math.max(0, start));
      selectionLen = 0;
    },
    text() {
      return beforeCursor + afterCursor;
    },
  };
}

describe('Run Indicator deleteBack (atomic select + delete)', () => {
  test('deletes indicator text before the cursor without touching following content', async () => {
    const field = createTextField('这是最重要的一个认知。后面的正文', '这是最重要的一个认知。'.length);
    const sink = createRunIndicatorSink({
      clipboard: {
        writeText(text) {
          this.text = text;
        },
      },
      paste() {
        field.paste('Loading\u2026');
      },
      selectAndDelete(count) {
        field.selectAndDelete(count);
      },
    });

    await sink.write('Loading\u2026');
    await sink.deleteBack('Loading\u2026'.length);

    assert.strictEqual(field.text(), '这是最重要的一个认知。后面的正文');
  });

  test('deleteBack calls selectAndDelete exactly once, not N times', async () => {
    let callCount = 0;
    let lastCount = 0;
    const sink = createRunIndicatorSink({
      clipboard: { writeText() {} },
      paste() {},
      selectAndDelete(count) {
        callCount++;
        lastCount = count;
      },
    });

    await sink.deleteBack(8);

    assert.strictEqual(callCount, 1, 'selectAndDelete should be called once, not per-character');
    assert.strictEqual(lastCount, 8);
  });

  test('a forward-delete key would leave the indicator and remove following content', () => {
    const field = createTextField('这是最重要的一个认知。abcdefghijklmnopqrstuvwxyz', '这是最重要的一个认知。'.length);

    field.paste('Loading\u2026');
    for (let i = 0; i < 'Loading\u2026'.length; i++) {
      field.forwardDelete();
    }

    assert.strictEqual(field.text(), '这是最重要的一个认知。Loading\u2026ijklmnopqrstuvwxyz');
  });

  test('buildSelectAndDeleteArgs produces select-backwards + single-delete AppleScript', () => {
    const args = buildSelectAndDeleteArgs(8);
    assert.strictEqual(args[0], '-e');
    const script = args[1];
    assert.ok(script.includes('repeat 8 times'), 'should repeat selection 8 times');
    assert.ok(script.includes('key code 123 using {shift down}'), 'should select backwards with Shift+Left');
    assert.ok(script.includes('key code 51'), 'should delete with one BackSpace');
  });

  test('buildSelectAndDeleteArgs count varies with input', () => {
    const a8 = buildSelectAndDeleteArgs(8);
    const a3 = buildSelectAndDeleteArgs(3);
    assert.ok(a8[1].includes('repeat 8 times'));
    assert.ok(a3[1].includes('repeat 3 times'));
  });
});
