import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cacheName, wavSeconds } from './voice.ts';

test('the cache name changes with the text and with the voice, not otherwise', () => {
  const a = cacheName('chat', 'af_heart', 'hello');
  assert.match(a, /^chat-[0-9a-f]{8}\.wav$/);
  assert.equal(cacheName('chat', 'af_heart', 'hello'), a);
  assert.notEqual(cacheName('chat', 'af_heart', 'hello!'), a);
  assert.notEqual(cacheName('chat', 'am_michael', 'hello'), a);
});

test('wavSeconds reads the length from the header', () => {
  // 24 kHz, mono, 32-bit float, 48 000 bytes of data = 0.5 s
  const b = new Uint8Array(44 + 48_000);
  const v = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WAVEfmt '), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // float
  v.setUint16(22, 1, true); // channels
  v.setUint32(24, 24_000, true);
  v.setUint16(34, 32, true); // bits
  b.set(new TextEncoder().encode('data'), 36);
  v.setUint32(40, 48_000, true);
  assert.equal(wavSeconds(b), 0.5);
});
