// Test helpers for the sync: a server in memory with the site's rules, and an app around a store.
import { createIdentityStore } from '@/offchain/chat/identity';
import { OffchainError } from '@/offchain/http';

import type { SyncClient } from './client';
import type { CryptoBackend } from './crypto';
import { nodeCrypto } from './node-crypto';
import { createBookStore } from './rooms';
import { createSyncStore } from './store';

/** One PBKDF2 round: both sides of a test use it, so codes still open, fast. */
export const fastCrypto: CryptoBackend = { ...nodeCrypto, pbkdf2: (p, s, _i, l) => nodeCrypto.pbkdf2(p, s, 1, l) };

export function memorySync() {
  const codes = new Map<string, string>();
  const records = new Map<string, { v: number; blob: string }>();
  const names = new Map<string, string>(); // lower-cased name → key
  const calls: string[] = [];
  const client: SyncClient = {
    pairPost: async (code, blob) => {
      calls.push(`pair ${code}`);
      if (codes.has(code)) return 'taken';
      codes.set(code, blob);
      return 'ok';
    },
    pairGet: async (code) => {
      calls.push(`get ${code}`);
      const blob = codes.get(code);
      if (!blob) throw new OffchainError(404, 'no such code — it may have been used, or it is older than ten minutes');
      codes.delete(code);
      return blob;
    },
    pull: async (id) => {
      calls.push('pull');
      const r = records.get(id);
      return r ? { version: r.v, blob: r.blob } : { version: 0, blob: null };
    },
    push: async (id, version, blob) => {
      calls.push('push');
      if ((records.get(id)?.v ?? 0) !== version) return { ok: false };
      records.set(id, { v: version + 1, blob });
      return { ok: true, version: version + 1 };
    },
    checkName: async (name, key) => names.get(name.toLowerCase()) === key,
  };
  return { client, codes, records, names, calls };
}

export function syncApp(server: ReturnType<typeof memorySync>, scope = 'http://fake', crypto: CryptoBackend = fastCrypto) {
  const secrets = new Map<string, string>();
  const kv = new Map<string, string>();
  const sec = { get: async (k: string) => secrets.get(k) ?? null, set: async (k: string, v: string) => void secrets.set(k, v) };
  let where = scope;
  const identity = createIdentityStore(sec, () => where);
  const book = createBookStore({
    kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) },
    secrets: sec, crypto, scope: () => where,
  });
  let reloads = 0;
  const store = createSyncStore({
    client: server.client, crypto, secrets: sec, book, identity, identityChanged: () => void reloads++, scope: () => where,
  });
  live.push(store);
  return { store, identity, book, secrets, reloads: () => reloads, setScope: (s: string) => (where = s) };
}

const live: ReturnType<typeof createSyncStore>[] = [];
/** stops every test app's timers (afterEach), so no interval outlives its test */
export const pauseAll = () => {
  for (const s of live.splice(0)) s.getState().pause();
};

export const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
};
