'use strict';

/**
 * Server-Sent Events text stream parser.
 *
 * Parses an HTTP response stream (Node Readable) emitting `data: …`
 * lines in OpenAI chat-completion SSE format, yielding the
 * `delta.content` string from each event.
 */

const DONE = Symbol('done');

/**
 * @param {import('stream').Readable} responseStream
 * @returns {AsyncGenerator<string>}
 */
async function* sseTextStream(responseStream) {
  let leftover = '';
  for await (const chunk of responseStream) {
    const lines = (leftover + chunk.toString()).split('\n');
    leftover = lines.pop();
    for (const line of lines) {
      const result = parseSSELine(line);
      if (result === DONE) return;
      if (result !== null) yield result;
    }
  }
  if (leftover) {
    const result = parseSSELine(leftover);
    if (result === DONE) return;
    if (result !== null) yield result;
  }
}

/**
 * Parse a single SSE line.
 *
 * @param {string} line
 * @returns {string | null | Symbol} content string, null to skip, or DONE to stop
 */
function parseSSELine(line) {
  if (!line.startsWith('data: ')) return null;
  const data = line.slice(6).trim();
  if (data === '[DONE]') return DONE;
  try {
    const parsed = JSON.parse(data);
    const content = parsed.choices?.[0]?.delta?.content;
    return content || null;
  } catch {
    return null;
  }
}

module.exports = { sseTextStream };
