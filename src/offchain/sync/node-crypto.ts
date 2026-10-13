// Node's crypto behind the sync's interface: for jest and the e2e only (the app uses expo-crypto.ts).
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, createHash, pbkdf2, randomBytes } from 'node:crypto';

import type { CryptoBackend } from './crypto';

export const nodeCrypto: CryptoBackend = {
  random: (n) => new Uint8Array(randomBytes(n)),
  sha256: async (data) => new Uint8Array(createHash('sha256').update(data).digest()),
  pbkdf2: (password, salt, iterations, length) =>
    new Promise((resolve, reject) =>
      pbkdf2(password, salt, iterations, length, 'sha256', (e, k) => (e ? reject(e) : resolve(new Uint8Array(k))))),
  seal: async (key, plain, iv) => {
    const c = createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(plain), c.final()]);
    return new Uint8Array(Buffer.concat([iv, ct, c.getAuthTag()]));
  },
  open: async (key, sealed) => {
    if (sealed.length < 28) throw new Error('too short');
    const d = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
    d.setAuthTag(sealed.subarray(sealed.length - 16));
    return new Uint8Array(Buffer.concat([d.update(sealed.subarray(12, sealed.length - 16)), d.final()]));
  },
};
