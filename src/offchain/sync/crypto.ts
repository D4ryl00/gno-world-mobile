import { toBase64 } from '@/utils/base64url';

/** What the sync needs from cryptography: the app's backend (expo-crypto + modules/pbkdf2), or Node's in tests. */
export interface CryptoBackend {
  random(n: number): Uint8Array;
  sha256(data: Uint8Array): Promise<Uint8Array>;
  pbkdf2(password: string, salt: string, iterations: number, length: number): Promise<Uint8Array>;
  /** AES-256-GCM, 16-byte tag: iv | ciphertext | tag */
  seal(key: Uint8Array, plain: Uint8Array, iv: Uint8Array): Promise<Uint8Array>;
  /** the reverse of seal; throws when the key does not open it */
  open(key: Uint8Array, sealed: Uint8Array): Promise<Uint8Array>;
  /** why this build cannot derive a code's key ('' or absent when it can) */
  unavailable?(): string;
}

// gno.world's /pair (app-rooms.js, read 2026-10-13)
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_ROUNDS = 200_000;
export const BAD_CODE = 'a code is six letters and digits';
export const WRONG_CODE = 'that code did not open the key';

export const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const unhex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (h) => parseInt(h, 16));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Six characters, each a random byte modulo 31, as the site draws them. */
export const newCode = (c: CryptoBackend) => Array.from(c.random(6), (b) => CODE_ALPHABET[b % 31]).join('');

/** A typed code as the site reads it: upper case, only A–Z and 2–9 kept; '' when that is not six characters. */
export function normalizeCode(s: string): string {
  const t = s.toUpperCase().replace(/[^A-Z2-9]/g, '');
  return t.length === 6 ? t : '';
}

export const codeKey = (c: CryptoBackend, code: string) => c.pbkdf2(code, `bubblerumble rooms ${code}`, CODE_ROUNDS, 32);

export const syncId = async (c: CryptoBackend, key: Uint8Array) => hex(await c.sha256(key));

const sealBytes = async (c: CryptoBackend, key: Uint8Array, plain: Uint8Array) => toBase64(await c.seal(key, plain, c.random(12)));

export async function sealSyncKey(c: CryptoBackend, code: string, syncKey: Uint8Array): Promise<string> {
  return sealBytes(c, await codeKey(c, code), syncKey);
}

export async function openSyncKey(c: CryptoBackend, code: string, blob: string): Promise<Uint8Array> {
  const k = await codeKey(c, code); // a failure here (no native module) keeps its own words
  let key: Uint8Array;
  try {
    key = await c.open(k, unb64(blob));
  } catch {
    throw new Error(WRONG_CODE);
  }
  if (key.length !== 32) throw new Error(WRONG_CODE);
  return key;
}

export const sealJson = (c: CryptoBackend, key: Uint8Array, value: unknown) =>
  sealBytes(c, key, new TextEncoder().encode(JSON.stringify(value)));

export async function openJson(c: CryptoBackend, key: Uint8Array, blob: string): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await c.open(key, unb64(blob.trim()))));
}
