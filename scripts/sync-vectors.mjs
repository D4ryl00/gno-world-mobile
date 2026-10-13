// The site's /pair crypto (app-rooms.js, 2026-10-13: syncCodeKey, syncOffer's blob, syncUse's id, syncSeal) run with
// WebCrypto on fixed inputs. node scripts/sync-vectors.mjs > src/offchain/sync/__fixtures__/vectors.json
import { webcrypto as crypto } from 'node:crypto';

const enc = new TextEncoder();
const hexOf = (t) => [...t].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64 = (t) => Buffer.from(t).toString('base64');

const code = 'K7XQ2M';
const syncKey = new Uint8Array(32).map((_, i) => i * 7 + 1);
const codeIv = new Uint8Array(12).map((_, i) => 0xa0 + i);
const payloadIv = new Uint8Array(12).map((_, i) => 0x10 + i);
const payload = {
  rooms: [{ id: 'AbCdEfGhIjKlMnOpQrSt', name: 'tea ☕', key: 'k'.repeat(24), at: 1791000000000 }],
  left: { zzzzzzzzzzzzzzzzzzz1: 1791000000001 },
  name: { name: 'remi', key: '0123456789abcdef0123456789abcdef' },
  at: 1791000000002,
};

const base = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
const params = { name: 'PBKDF2', salt: enc.encode('bubblerumble rooms ' + code), iterations: 2e5, hash: 'SHA-256' };
const codeKey = await crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const codeKeyBits = new Uint8Array(await crypto.subtle.deriveBits(params, base, 256));
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: codeIv }, codeKey, syncKey));
const sk = await crypto.subtle.importKey('raw', syncKey, 'AES-GCM', false, ['encrypt', 'decrypt']);
const pct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: payloadIv }, sk, enc.encode(JSON.stringify(payload))));

console.log(JSON.stringify({
  code,
  syncKey: hexOf(syncKey),
  codeKey: hexOf(codeKeyBits),
  codeIv: hexOf(codeIv),
  pairBlob: b64(new Uint8Array([...codeIv, ...ct])),
  syncId: hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', syncKey))),
  payloadIv: hexOf(payloadIv),
  payload,
  payloadBlob: b64(new Uint8Array([...payloadIv, ...pct])),
}, null, 2));
