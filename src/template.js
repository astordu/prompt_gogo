'use strict';

// Variable registry — architecture supports multiple variables; currently one.
const VARIABLES = [
  { name: 'select_content', description: '插入当前选中的文本' },
];

const VARIABLE_NAMES = VARIABLES.map((v) => v.name);

// Matches @<varname> NOT followed by [a-zA-Z0-9] (word-boundary rule).
// Sorted by length desc so longer names win over prefixes (future-proofing).
const VARIABLE_PATTERN = new RegExp(
  '(@(?:' +
    VARIABLE_NAMES.slice().sort((a, b) => b.length - a.length).join('|') +
  ')(?![a-zA-Z0-9]))',
  'g'
);

/**
 * Parse a template string into an array of nodes.
 * Each node is either { type: 'text', value: string }
 * or { type: 'variable', value: string } (value = variable name without @).
 */
function parseTemplate(text) {
  if (!text) return [];

  const nodes = [];
  let lastIndex = 0;
  const re = new RegExp(VARIABLE_PATTERN.source, 'g');
  let match;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    // match[1] is the full @name capture; strip the leading '@'
    nodes.push({ type: 'variable', value: match[1].slice(1) });
    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push({ type: 'text', value: text.slice(lastIndex) });
  }

  return nodes;
}

/**
 * Serialize an array of nodes (text + variable) back to a plain text string.
 * Variable nodes emit @<name>.
 */
function serializeTemplate(nodes) {
  return nodes
    .map((n) => (n.type === 'variable' ? `@${n.value}` : n.value))
    .join('');
}

/**
 * Replace all occurrences of known variables in a template string.
 * values is a plain object mapping variable name → replacement string.
 * Obeys the same word-boundary rule as parseTemplate.
 */
function replaceVariables(text, values) {
  const re = new RegExp(VARIABLE_PATTERN.source, 'g');
  return text.replace(re, (_, token) => {
    const name = token.slice(1); // strip '@'
    return Object.prototype.hasOwnProperty.call(values, name) ? values[name] : token;
  });
}

/**
 * Return true if the template contains at least one known variable.
 */
function validateTemplate(text) {
  const re = new RegExp(VARIABLE_PATTERN.source, 'g');
  return re.test(text);
}

// Support both CommonJS (main process) and browser <script> tag (renderer).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseTemplate, serializeTemplate, replaceVariables, validateTemplate, VARIABLES };
} else {
  // eslint-disable-next-line no-undef
  window.templateModule = { parseTemplate, serializeTemplate, replaceVariables, validateTemplate, VARIABLES };
}
