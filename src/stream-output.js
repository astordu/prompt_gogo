'use strict';

const CHAR_THRESHOLD = 30;
const TIME_WINDOW_MS = 200;

async function pipeToCursor(chunks, sink) {
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

  try {
    const iterator = chunks[Symbol.asyncIterator]();
    let timerPromise = null;

    while (true) {
      if (timerPromise === null) {
        timerPromise = armTimer();
      }

      const nextPromise = iterator.next();
      const result = await Promise.race([nextPromise, timerPromise]);

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

    // Flush remaining buffer
    if (buffer.length > 0) {
      await sink.write(buffer);
      buffer = '';
    }
  } finally {
    cancelTimer();
    await sink.close();
  }
}

module.exports = { pipeToCursor };
