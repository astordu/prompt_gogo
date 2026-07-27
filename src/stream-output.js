'use strict';

const CHAR_THRESHOLD = 30;
const TIME_WINDOW_MS = 200;

/**
 * Pipes chunks from an async iterator to a sink with buffered writes.
 *
 * When an AbortSignal is provided and becomes aborted, the pipeline
 * stops immediately: the current buffer is discarded (not flushed),
 * and sink.close() is still called in the finally block.
 *
 * @param {AsyncIterable<string>} chunks
 * @param {{ write: (text: string) => Promise<void>, close: () => Promise<void> }} sink
 * @param {AbortSignal} [signal] - Optional signal to cancel the pipeline
 */
async function pipeToCursor(chunks, sink, signal) {
  let buffer = '';
  let timer = null;
  // Resolves when the time window fires; replaced on each arm.
  let timerResolve = null;

  function armTimer() {
    clearTimeout(timer);
    return new Promise((resolve) => {
      timerResolve = resolve;
      timer = setTimeout(() => resolve('timeout'), TIME_WINDOW_MS);
    });
  }

  function cancelTimer() {
    clearTimeout(timer);
    timer = null;
    if (timerResolve) {
      timerResolve('cancel');
      timerResolve = null;
    }
  }

  async function flush() {
    if (buffer.length > 0) {
      const text = buffer;
      buffer = '';
      await sink.write(text);
    }
    cancelTimer();
  }

  // Set up abort detection
  let abortResolve = null;
  const abortPromise = new Promise((resolve) => {
    abortResolve = resolve;
  });
  function onAbort() {
    if (abortResolve) abortResolve('abort');
  }
  if (signal) {
    if (signal.aborted) {
      // Already aborted before start — just close and return
      await sink.close();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const iterator = chunks[Symbol.asyncIterator]();
    let timerPromise = null;

    while (true) {
      if (timerPromise === null) {
        timerPromise = armTimer();
      }

      const nextPromise = iterator.next();
      const result = await Promise.race([nextPromise, timerPromise, abortPromise]);

      // Check for abort — discard buffer and stop
      if (result === 'abort') {
        buffer = '';
        break;
      }

      if (result === 'timeout' || result === 'cancel') {
        // Timer fired before next chunk — flush current buffer
        if (buffer.length > 0) {
          await sink.write(buffer);
          buffer = '';
        }
        timerPromise = null;
        // Still need the chunk result; await it without racing
        const chunkResult = await nextPromise;
        if (chunkResult.done) break;
        buffer += chunkResult.value;
        if (buffer.length >= CHAR_THRESHOLD) {
          await flush();
        }
      } else {
        // Got a chunk result first
        if (result.done) break;
        buffer += result.value;
        if (buffer.length >= CHAR_THRESHOLD) {
          await flush();
          timerPromise = null;
        }
      }
    }

    // Flush remaining buffer (only if not aborted — abort breaks before this)
    if (buffer.length > 0) {
      await sink.write(buffer);
      buffer = '';
    }
  } finally {
    cancelTimer();
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
    await sink.close();
  }
}

module.exports = { pipeToCursor };
