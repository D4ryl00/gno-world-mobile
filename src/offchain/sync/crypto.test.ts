import V from './__fixtures__/vectors.json';
import {
  BAD_CODE, codeKey, hex, newCode, normalizeCode, openJson, openSyncKey, sealJson, sealSyncKey, syncId, unhex, WRONG_CODE,
  type CryptoBackend,
} from './crypto';
import { nodeCrypto } from './node-crypto';

// the backend with its randomness pinned, to reproduce the site's bytes
const fixed = (bytes: string): CryptoBackend => ({ ...nodeCrypto, random: () => unhex(bytes) });

test("the code key is the site's PBKDF2", async () => {
  expect(hex(await codeKey(nodeCrypto, V.code))).toBe(V.codeKey);
});

test("a code's blob is the site's, byte for byte, and opens back to the sync key", async () => {
  expect(await sealSyncKey(fixed(V.codeIv), V.code, unhex(V.syncKey))).toBe(V.pairBlob);
  expect(hex(await openSyncKey(nodeCrypto, V.code, V.pairBlob))).toBe(V.syncKey);
});

test('the sync id is the SHA-256 of the key, in hex', async () => {
  expect(await syncId(nodeCrypto, unhex(V.syncKey))).toBe(V.syncId);
});

test("the sealed record is the site's, byte for byte, and opens back", async () => {
  expect(await sealJson(fixed(V.payloadIv), unhex(V.syncKey), V.payload)).toBe(V.payloadBlob);
  expect(await openJson(nodeCrypto, unhex(V.syncKey), `${V.payloadBlob}\n`)).toEqual(V.payload);
});

test('another code does not open the key', async () => {
  await expect(openSyncKey(nodeCrypto, 'K7XQ2N', V.pairBlob)).rejects.toThrow(WRONG_CODE);
  await expect(openSyncKey(nodeCrypto, V.code, 'not base64 at all!')).rejects.toThrow(WRONG_CODE);
});

test('a blob that opens to anything but 32 bytes is refused', async () => {
  const short = await sealJson(nodeCrypto, await codeKey(nodeCrypto, V.code), 'x');
  await expect(openSyncKey(nodeCrypto, V.code, short)).rejects.toThrow(WRONG_CODE);
});

test('a record sealed by another key does not open', async () => {
  await expect(openJson(nodeCrypto, new Uint8Array(32), V.payloadBlob)).rejects.toThrow();
});

test('codes use the site alphabet, a byte modulo 31', () => {
  expect(newCode({ ...nodeCrypto, random: () => new Uint8Array([0, 30, 31, 62, 255, 100]) })).toBe('A9AAHH');
});

test('a typed code is read as the site reads it', () => {
  expect(normalizeCode(' k7x-q2m ')).toBe('K7XQ2M');
  expect(normalizeCode('K7XQ2')).toBe('');
  expect(normalizeCode('K7XQ2M9')).toBe('');
  expect(BAD_CODE).toBe('a code is six letters and digits');
});
