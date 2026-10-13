import { keyPart } from '@/offchain/chat/identity';
import type { KV } from '@/offchain/chat/store';
import type { SecretStore } from '@/session/keys';

import { hex, openJson, sealJson, unhex, type CryptoBackend } from './crypto';

/** One room this app knows, as the site's br.rooms entries: key is the maker's key ('' when not the maker). */
export interface RoomEntry {
  id: string;
  name: string;
  key: string;
  at: number;
  irc?: true;
}

/** The rooms book: the rooms known, and when rooms were left (id → ms). */
export interface Book {
  rooms: RoomEntry[];
  left: Record<string, number>;
}

export const ROOM_ID = /^[A-Za-z0-9_-]{20}$/;
export const KEYED_MAX = 200;
export const PLAIN_MAX = 30;
export const BOOK_KEY = 'br.rooms';
export const LOCK_KEY = 'br.rooms.lock';
export const EMPTY_BOOK: Book = { rooms: [], left: {} };

/** The site's roomsSave caps: the first 200 rooms with a key and the first 30 without. */
export function capRooms(rooms: RoomEntry[]): RoomEntry[] {
  let keyed = 0;
  let plain = 0;
  return rooms.filter((r) => (r.key ? ++keyed <= KEYED_MAX : ++plain <= PLAIN_MAX));
}

/** The site's syncMerge: local entries first, then the incoming ones; anything malformed is dropped. */
export function mergeBook(local: Book, incoming: { rooms?: unknown; left?: unknown }): Book {
  const left = { ...local.left };
  if (incoming.left && typeof incoming.left === 'object') {
    for (const [id, t] of Object.entries(incoming.left as Record<string, unknown>)) {
      if (ROOM_ID.test(id)) left[id] = Math.max(left[id] || 0, Number(t) || 0);
    }
  }
  const byId = new Map<string, RoomEntry>();
  for (const raw of [...local.rooms, ...(Array.isArray(incoming.rooms) ? incoming.rooms : [])]) {
    const e = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (typeof e.id !== 'string' || !ROOM_ID.test(e.id)) continue;
    const at = Number(e.at) || 0;
    const had = byId.get(e.id);
    if (had) {
      if (at > had.at) {
        had.at = at;
        had.name = String(e.name || had.name).slice(0, 40);
      }
      if (!had.key && e.key) had.key = String(e.key);
    } else {
      byId.set(e.id, {
        id: e.id, name: String(e.name || 'private room').slice(0, 40), key: String(e.key || ''), at,
        ...(e.irc === true ? { irc: true as const } : {}),
      });
    }
  }
  const rooms = [...byId.values()].filter((r) => !(left[r.id] > r.at)).sort((a, b) => b.at - a.at);
  return { rooms: capRooms(rooms), left };
}

export interface BookStore {
  load(): Promise<Book>;
  save(b: Book): Promise<void>;
}

/**
 * The book of the current off-chain server, sealed in AsyncStorage by a local key kept in SecureStore: room keys open
 * private rooms, and the book outgrows what SecureStore promises to hold. Unreadable means empty.
 */
export function createBookStore(d: { kv: KV; secrets: SecretStore; crypto: CryptoBackend; scope: () => string }): BookStore {
  const at = () => `${BOOK_KEY}.${keyPart(d.scope())}`;
  const readLock = async () => {
    const h = await d.secrets.get(LOCK_KEY);
    return h && /^[0-9a-f]{64}$/.test(h) ? unhex(h) : null;
  };
  let making: Promise<Uint8Array> | null = null;
  const lockForSave = () =>
    (making ??= (async () => {
      const have = await readLock();
      if (have) return have;
      const k = d.crypto.random(32);
      await d.secrets.set(LOCK_KEY, hex(k));
      return k;
    })().catch((e) => {
      making = null;
      throw e;
    }));
  return {
    load: async () => {
      try {
        const [raw, lock] = await Promise.all([d.kv.getItem(at()), readLock()]);
        if (!raw || !lock) return EMPTY_BOOK;
        const v = await openJson(d.crypto, lock, raw);
        return mergeBook(EMPTY_BOOK, v && typeof v === 'object' ? v : {});
      } catch {
        return EMPTY_BOOK;
      }
    },
    save: async (b) => {
      const lock = await lockForSave();
      await d.kv.setItem(at(), await sealJson(d.crypto, lock, { rooms: capRooms(b.rooms), left: b.left }));
    },
  };
}
