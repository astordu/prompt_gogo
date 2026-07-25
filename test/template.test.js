'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');
const {
  parseTemplate,
  serializeTemplate,
  replaceVariables,
  validateTemplate,
} = require('../src/template');

// ---------------------------------------------------------------------------
// parseTemplate
// ---------------------------------------------------------------------------

describe('parseTemplate — plain text', () => {
  test('empty string returns empty array', () => {
    assert.deepStrictEqual(parseTemplate(''), []);
  });

  test('plain text with no variables returns single text node', () => {
    assert.deepStrictEqual(parseTemplate('hello world'), [
      { type: 'text', value: 'hello world' },
    ]);
  });
});

describe('parseTemplate — single variable', () => {
  test('lone variable returns single variable node', () => {
    assert.deepStrictEqual(parseTemplate('@select_content'), [
      { type: 'variable', value: 'select_content' },
    ]);
  });

  test('variable at start of text', () => {
    assert.deepStrictEqual(parseTemplate('@select_content hello'), [
      { type: 'variable', value: 'select_content' },
      { type: 'text', value: ' hello' },
    ]);
  });

  test('variable at end of text', () => {
    assert.deepStrictEqual(parseTemplate('hello @select_content'), [
      { type: 'text', value: 'hello ' },
      { type: 'variable', value: 'select_content' },
    ]);
  });

  test('variable in the middle of text', () => {
    assert.deepStrictEqual(parseTemplate('rewrite @select_content please'), [
      { type: 'text', value: 'rewrite ' },
      { type: 'variable', value: 'select_content' },
      { type: 'text', value: ' please' },
    ]);
  });
});

describe('parseTemplate — word-boundary rules', () => {
  test('@select_contentX (letter follows) is NOT a variable', () => {
    const nodes = parseTemplate('@select_contentX');
    assert.ok(nodes.every((n) => n.type === 'text'),
      'expected no variable node when letter follows');
  });

  test('@select_content9 (digit follows) is NOT a variable', () => {
    const nodes = parseTemplate('@select_content9');
    assert.ok(nodes.every((n) => n.type === 'text'),
      'expected no variable node when digit follows');
  });

  test('@select_content. (punctuation follows) IS a variable', () => {
    const nodes = parseTemplate('@select_content.');
    assert.deepStrictEqual(nodes, [
      { type: 'variable', value: 'select_content' },
      { type: 'text', value: '.' },
    ]);
  });

  test('@select_content.com (dot then letter) IS a variable (dot is not alphanumeric)', () => {
    // Word-boundary: @ name must not be followed by [a-zA-Z0-9].
    // ".com" starts with "." which satisfies the boundary, so the variable IS matched.
    const nodes = parseTemplate('@select_content.com');
    assert.deepStrictEqual(nodes, [
      { type: 'variable', value: 'select_content' },
      { type: 'text', value: '.com' },
    ]);
  });

  test('variable followed by space IS matched', () => {
    const nodes = parseTemplate('@select_content ');
    assert.ok(nodes.some((n) => n.type === 'variable'));
  });

  test('variable at end of string (no following char) IS matched', () => {
    const nodes = parseTemplate('x @select_content');
    assert.ok(nodes.some((n) => n.type === 'variable'));
  });
});

describe('parseTemplate — multiple variables', () => {
  test('two variables with text between them', () => {
    assert.deepStrictEqual(
      parseTemplate('@select_content and @select_content again'),
      [
        { type: 'variable', value: 'select_content' },
        { type: 'text', value: ' and ' },
        { type: 'variable', value: 'select_content' },
        { type: 'text', value: ' again' },
      ]
    );
  });

  test('two adjacent variables (no separator)', () => {
    assert.deepStrictEqual(parseTemplate('@select_content@select_content'), [
      { type: 'variable', value: 'select_content' },
      { type: 'variable', value: 'select_content' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// serializeTemplate
// ---------------------------------------------------------------------------

describe('serializeTemplate', () => {
  test('empty nodes returns empty string', () => {
    assert.strictEqual(serializeTemplate([]), '');
  });

  test('single text node', () => {
    assert.strictEqual(serializeTemplate([{ type: 'text', value: 'hello' }]), 'hello');
  });

  test('single chip node becomes @variable-name', () => {
    assert.strictEqual(
      serializeTemplate([{ type: 'variable', value: 'select_content' }]),
      '@select_content'
    );
  });

  test('mixed text and chip nodes', () => {
    assert.strictEqual(
      serializeTemplate([
        { type: 'text', value: 'rewrite ' },
        { type: 'variable', value: 'select_content' },
        { type: 'text', value: ' please' },
      ]),
      'rewrite @select_content please'
    );
  });

  test('roundtrip: parseTemplate then serializeTemplate', () => {
    const original = 'rewrite @select_content please';
    assert.strictEqual(serializeTemplate(parseTemplate(original)), original);
  });
});

// ---------------------------------------------------------------------------
// replaceVariables
// ---------------------------------------------------------------------------

describe('replaceVariables', () => {
  test('single occurrence is replaced', () => {
    assert.strictEqual(
      replaceVariables('@select_content', { select_content: 'foo' }),
      'foo'
    );
  });

  test('multiple occurrences all replaced (replaceAll semantics)', () => {
    assert.strictEqual(
      replaceVariables('@select_content and @select_content', { select_content: 'bar' }),
      'bar and bar'
    );
  });

  test('no variable in template returns template unchanged', () => {
    assert.strictEqual(replaceVariables('hello world', { select_content: 'x' }), 'hello world');
  });

  test('word-boundary: @select_contentX is not replaced', () => {
    assert.strictEqual(
      replaceVariables('@select_contentX', { select_content: 'foo' }),
      '@select_contentX'
    );
  });
});

// ---------------------------------------------------------------------------
// validateTemplate
// ---------------------------------------------------------------------------

describe('validateTemplate', () => {
  test('template with a known variable is valid', () => {
    assert.strictEqual(validateTemplate('@select_content'), true);
  });

  test('template with no variable is invalid', () => {
    assert.strictEqual(validateTemplate('hello world'), false);
  });

  test('template where @select_contentX does not count as a variable', () => {
    assert.strictEqual(validateTemplate('@select_contentX'), false);
  });

  test('template with variable embedded in text is valid', () => {
    assert.strictEqual(validateTemplate('please rewrite @select_content nicely'), true);
  });
});
