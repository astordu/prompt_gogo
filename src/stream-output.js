'use strict';

const CHAR_THRESHOLD = 30;

async function pipeToCursor(chunks, sink) {
  let buffer = '';
  try {
    for await (const chunk of chunks) {
      buffer += chunk;
      if (buffer.length >= CHAR_THRESHOLD) {
        await sink.write(buffer);
        buffer = '';
      }
    }
    if (buffer.length > 0) {
      await sink.write(buffer);
    }
  } finally {
    await sink.close();
  }
}

module.exports = { pipeToCursor };
