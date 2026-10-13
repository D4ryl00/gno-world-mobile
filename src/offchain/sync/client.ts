import { OffchainError, type Offchain, type TextReply } from '@/offchain/http';

export interface SyncClient {
  /** 'taken': the code is in use, draw another */
  pairPost(code: string, blob: string): Promise<'ok' | 'taken'>;
  /** the code's blob (a code works once) */
  pairGet(code: string): Promise<string>;
  /** the shared record and its version; nothing yet is version 0 */
  pull(id: string): Promise<{ version: number; blob: string | null }>;
  /** ok: false when another device wrote since `version` (412) */
  push(id: string, version: number, blob: string): Promise<{ ok: true; version: number } | { ok: false }>;
  /** whether the key holds the name; null when the server could not say */
  checkName(name: string, key: string): Promise<boolean | null>;
}

const NO_CACHE = { 'Cache-Control': 'no-store' };

const parsed = (r: TextReply): Record<string, unknown> => {
  try {
    const v: unknown = JSON.parse(r.text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

const fail = (r: TextReply, what: string): never => {
  const e = parsed(r).error;
  throw new OffchainError(r.status, typeof e === 'string' && e ? e : `${what} (${r.status})`);
};

const versionOf = (etag: string): number | null => {
  const n = Number(etag.replace(/^W\//, '').replace(/"/g, ''));
  return etag && Number.isFinite(n) && n > 0 ? n : null;
};

const ok = (r: TextReply) => r.status >= 200 && r.status < 300;

export function createSyncClient(oc: Offchain): SyncClient {
  return {
    pairPost: async (code, blob) => {
      const r = await oc.exchange('POST', '/api/sync/pair', { json: { code, blob } });
      if (r.status === 409) return 'taken';
      return ok(r) ? 'ok' : fail(r, 'could not make a code');
    },
    pairGet: async (code) => {
      const r = await oc.exchange('GET', `/api/sync/pair/${encodeURIComponent(code)}`, { headers: NO_CACHE });
      if (r.status !== 200) fail(r, 'no such code');
      const blob = parsed(r).blob;
      if (typeof blob !== 'string' || !blob) throw new OffchainError(r.status, 'no such code');
      return blob;
    },
    pull: async (id) => {
      const r = await oc.exchange('GET', `/api/sync/${id}`, { headers: NO_CACHE });
      if (r.status === 404) return { version: 0, blob: null };
      if (r.status !== 200) fail(r, 'sync read failed');
      return { version: versionOf(r.etag) ?? 0, blob: r.text.trim() };
    },
    push: async (id, version, blob) => {
      const r = await oc.exchange('PUT', `/api/sync/${id}`, { text: blob, headers: { 'If-Match': String(version) } });
      if (r.status === 412) return { ok: false };
      if (!ok(r)) fail(r, 'sync write failed');
      return { ok: true, version: versionOf(r.etag) ?? version + 1 };
    },
    checkName: async (name, key) => {
      try {
        const r = await oc.exchange('GET', `/api/name?name=${encodeURIComponent(name)}`, { headers: { 'X-Name-Key': key, ...NO_CACHE } });
        if (r.status !== 200) return null;
        const v: unknown = JSON.parse(r.text);
        return !!v && typeof v === 'object' && (v as { mine?: unknown }).mine === true;
      } catch {
        return null;
      }
    },
  };
}
