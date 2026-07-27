'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');

const { createRunIndicatorSink, BACKSPACE_ARGS } = require('../src/run-indicator');

function createTextField(initialText, cursorPosition) {
  let beforeCursor = initialText.slice(0, cursorPosition);
  let afterCursor = initialText.slice(cursorPosition);

  return {
    paste(text) {
      beforeCursor += text;
    },
    backspace() {
      beforeCursor = beforeCursor.slice(0, -1);
    },
    forwardDelete() {
      afterCursor = afterCursor.slice(1);
    },
    text() {
      return beforeCursor + afterCursor;
    },
  };
}

describe('Run Indicator deleteBack', () => {
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
      backspace() {
        field.backspace();
      },
    });

    await sink.write('Loading\u2026');
    await sink.deleteBack('Loading\u2026'.length);

    assert.strictEqual(field.text(), '这是最重要的一个认知。后面的正文');
  });

  test('a forward-delete key would leave the indicator and remove following content', () => {
    const field = createTextField('这是最重要的一个认知。abcdefghijklmnopqrstuvwxyz', '这是最重要的一个认知。'.length);

    field.paste('Loading\u2026');
    for (let i = 0; i < 'Loading\u2026'.length; i++) {
      field.forwardDelete();
    }

    assert.strictEqual(field.text(), '这是最重要的一个认知。Loading\u2026ijklmnopqrstuvwxyz');
  });

  test('default macOS key command is Backspace, not forward Delete', () => {
    assert.deepStrictEqual(BACKSPACE_ARGS, [
      '-e',
      'tell application "System Events" to key code 51',
    ]);
  });
});
