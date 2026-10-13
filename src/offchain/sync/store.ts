import { createStore, type StoreApi } from 'zustand/vanilla';

import { keyPart, type IdentityStore } from '@/offchain/chat/identity';
import { OffchainError } from '@/offchain/http';
import type { SecretStore } from '@/session/keys';

import type { SyncClient } from './client';
import { BAD_CODE, hex, newCode, normalizeCode, openJson, openSyncKey, sealJson, sealSyncKey, syncId, unhex, type CryptoBackend } from './crypto';
import { nameIn, nameOut, pairWords, type NameIssue, type NameOutcome } from './name';
import { mergeBook, type BookStore, type RoomEntry } from './rooms';

export const SYNC_KEY = 'br.sync.key';
// the site's rhythm (app-rooms.js)
export const CODE_LIFE = 600_000;
export const FAST_EVERY = 5_000;
export const FAST_FOR = 360_000;
export const SLOW_EVERY = 120_000;
export const PUSH_AFTER = 1_500;
/** the words when adopting worked but the first read did not (the site would claim the other device has no name) */
export const UNREAD = "paired — but the other device's rooms and name could not be read just now; they are read again within two minutes";

export interface SyncState {
  paired: boolean;
  /** the first 16 hex of the sync id while paired: presence counts paired devices once */
  group: string;
  /** the code this app gave, while it is good */
  code: { code: string; until: number } | null;
  /** the name's outcome worth saying, in the site's words */
  said: { issue: NameIssue; words: string } | null;
  rooms: RoomEntry[];
  /** ms of the last read or write that went through; 0 none */
  lastSync: number;
  failing: boolean;
  busy: 'offer' | 'accept' | null;
  offerError: string;
  acceptError: string;
  /** foreground: read the stored key and book, pull, run the timers */
  resume(): void;
  /** background: timers off */
  pause(): void;
  /** another off-chain server: everything from scratch */
  restart(): void;
  /** a code for another device; null when it failed (offerError says why) */
  offer(): Promise<string | null>;
  /** the sync key a typed code opens (the code is spent); null when it failed (acceptError says why) */
  open(code: string): Promise<Uint8Array | null>;
  /** adopts another device's sync key; the words to show, or null when it failed */
  use(key: Uint8Array): Promise<string | null>;
  /** this device stops syncing: the key is forgotten, the book and the name stay */
  stop(): Promise<void>;
  /** the book or the name changed here: push soon */
  changed(): void;
  clearError(): void;
}

export interface SyncDeps {
  client: SyncClient;
  crypto: CryptoBackend;
  secrets: SecretStore;
  book: BookStore;
  identity: IdentityStore;
  /** a name came in: the chat reads the identity again */
  identityChanged(): void;
  /** the off-chain server: each has its own pairing */
  scope: () => string;
}

const say = (e: unknown) =>
  e instanceof OffchainError
    ? e.status !== 0 ? e.message : 'server unreachable — try again'
    : e instanceof Error ? e.message : 'server unreachable — try again';

export function createSyncStore(d: SyncDeps): StoreApi<SyncState> {
  let key: Uint8Array | null = null;
  let id = '';
  let version = 0;
  let loaded = false;
  let active = false;
  // bumped by stop() and restart(): an answer to a request made before is about another pairing
  let epoch = 0;
  let fastUntil = 0;
  let slow: ReturnType<typeof setInterval> | undefined;
  let fast: ReturnType<typeof setInterval> | undefined;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  let lastName: NameOutcome | null = null;
  // one network exchange at a time: a pull never crosses a push
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(f: () => Promise<T>): Promise<T> => {
    const p = queue.then(f, f);
    queue = p.catch(() => undefined);
    return p;
  };
  const keyName = () => `${SYNC_KEY}.${keyPart(d.scope())}`;

  return createStore<SyncState>()((set, get) => {
    const load = async (e: number) => {
      const [h, book] = await Promise.all([d.secrets.get(keyName()), d.book.load()]);
      if (e !== epoch) return;
      if (h && /^[0-9a-f]{64}$/.test(h)) {
        const k = unhex(h);
        const kid = await syncId(d.crypto, k);
        if (e !== epoch) return;
        key = k;
        id = kid;
        set({ paired: true, group: kid.slice(0, 16) });
      }
      loaded = true;
      set({ rooms: book.rooms });
    };

    /** reads the shared record, merges the book, settles the name; false when it could not */
    const pull = async (e: number): Promise<boolean> => {
      const k = key;
      if (!k) return false;
      try {
        const r = await d.client.pull(id);
        if (e !== epoch) return false;
        if (r.blob) {
          // an epoch check after every await: the book, the identity and the server follow Settings, and a switch
          // meanwhile must not mix this record into another server's book or send its name key there
          const v = await openJson(d.crypto, k, r.blob);
          if (e !== epoch) return false;
          const rec = (v && typeof v === 'object' ? v : {}) as { rooms?: unknown; left?: unknown; name?: unknown };
          const local = await d.book.load();
          if (e !== epoch) return false;
          const book = mergeBook(local, rec);
          if (JSON.stringify(book) !== JSON.stringify(local)) {
            await d.book.save(book);
            if (e !== epoch) return false;
          }
          const id0 = await d.identity.load();
          if (e !== epoch) return false;
          const n = await nameIn(rec.name, id0, (name, key) => (e === epoch ? d.client.checkName(name, key) : Promise.resolve(null)));
          if (e !== epoch) return false;
          if (n.take) {
            await d.identity.save({ name: n.take.name, reservedName: n.take.name, nameKey: n.take.key });
            d.identityChanged();
          }
          lastName ??= n; // use() says what its first pull found, not what a retry after a 412 sees
          set({
            rooms: book.rooms,
            ...(n.issue !== 'none' && n.issue !== 'same' ? { said: { issue: n.issue, words: pairWords(n.issue, n.name, n.had) } } : {}),
          });
        }
        // only a record this key opened moves the version: one it cannot open is never written over
        version = r.version;
        set({ lastSync: Date.now(), failing: false });
        return true;
      } catch {
        if (e === epoch) set({ failing: true });
        return false;
      }
    };

    /** writes this device's book and name; on 412 reads, merges and tries again, 3 tries in all */
    const push = async (e: number) => {
      const k = key;
      if (!k) return;
      try {
        for (let i = 0; i < 3; i++) {
          const book = await d.book.load();
          const blob = await sealJson(d.crypto, k, { rooms: book.rooms, left: book.left, name: nameOut(await d.identity.load()), at: Date.now() });
          if (e !== epoch) return; // what was read belongs to this pairing's server: never send it to the next one
          const r = await d.client.push(id, version, blob);
          if (e !== epoch) return;
          if (r.ok) {
            version = r.version;
            set({ rooms: book.rooms, lastSync: Date.now(), failing: false });
            return;
          }
          if (!(await pull(e))) return;
        }
      } catch {
        if (e === epoch) set({ failing: true });
      }
    };

    const tick = () => {
      const e = epoch;
      void serial(() => pull(e));
    };
    const startSlow = () => {
      if (active && key && !slow) slow = setInterval(tick, SLOW_EVERY);
    };
    const startFast = () => {
      clearInterval(fast);
      fast = undefined;
      if (!active || Date.now() >= fastUntil) return;
      fast = setInterval(() => {
        if (Date.now() >= fastUntil) {
          clearInterval(fast);
          fast = undefined;
        } else tick();
      }, FAST_EVERY);
    };
    const stopTimers = () => {
      clearInterval(slow);
      clearInterval(fast);
      slow = fast = undefined;
    };

    /** the site's syncUse(key, true): keep the key, read, then write */
    const adopt = async (k: Uint8Array, e: number) => {
      const kid = await syncId(d.crypto, k);
      if (e !== epoch) return;
      await d.secrets.set(keyName(), hex(k));
      if (e !== epoch) return;
      key = k;
      id = kid;
      version = 0;
      set({ paired: true, group: kid.slice(0, 16) });
      const read = await pull(e);
      await push(e);
      startSlow();
      return read;
    };

    return {
      paired: false, group: '', code: null, said: null, rooms: [], lastSync: 0, failing: false, busy: null, offerError: '', acceptError: '',

      resume: () => {
        if (active) return;
        active = true;
        const e = epoch;
        void serial(async () => {
          if (!loaded) await load(e);
          if (e !== epoch) return;
          if (key) await pull(e);
          startSlow();
          startFast();
        });
      },

      pause: () => {
        active = false;
        stopTimers();
      },

      restart: () => {
        epoch++;
        key = null;
        id = '';
        version = 0;
        loaded = false;
        fastUntil = 0;
        stopTimers();
        clearTimeout(pushTimer);
        set({ paired: false, group: '', code: null, said: null, rooms: [], lastSync: 0, failing: false, busy: null, offerError: '', acceptError: '' });
        if (active) {
          active = false;
          get().resume();
        }
      },

      offer: async () => {
        if (get().busy) return null;
        const cannot = d.crypto.unavailable?.();
        if (cannot) {
          set({ offerError: cannot }); // before anything: no key made, nothing paired
          return null;
        }
        const e = epoch;
        set({ busy: 'offer', offerError: '' });
        return serial(async () => {
          try {
            if (!loaded) await load(e);
            if (e !== epoch) return null;
            if (!key) await adopt(d.crypto.random(32), e);
            else await push(e);
            const k = key;
            if (e !== epoch || !k) return null;
            for (let i = 0; i < 3; i++) {
              const code = newCode(d.crypto);
              const blob = await sealSyncKey(d.crypto, code, k);
              if (e !== epoch) return null;
              const r = await d.client.pairPost(code, blob);
              if (e !== epoch) return null;
              if (r === 'ok') {
                fastUntil = Date.now() + FAST_FOR;
                startFast();
                set({ code: { code, until: Date.now() + CODE_LIFE } });
                return code;
              }
            }
            set({ offerError: 'could not make a code' });
            return null;
          } catch (err) {
            if (e === epoch) set({ offerError: say(err) });
            return null;
          } finally {
            if (e === epoch) set({ busy: null });
          }
        });
      },

      open: async (typed) => {
        if (get().busy) return null;
        const cannot = d.crypto.unavailable?.();
        if (cannot) {
          set({ acceptError: cannot }); // before the code is fetched: a code works once
          return null;
        }
        const code = normalizeCode(typed);
        if (!code) {
          set({ acceptError: BAD_CODE });
          return null;
        }
        const e = epoch;
        set({ busy: 'accept', acceptError: '' });
        try {
          const k = await openSyncKey(d.crypto, code, await d.client.pairGet(code));
          return e === epoch ? k : null;
        } catch (err) {
          if (e === epoch) set({ acceptError: say(err) });
          return null;
        } finally {
          if (e === epoch) set({ busy: null });
        }
      },

      use: async (k) => {
        if (get().busy) return null;
        const e = epoch;
        set({ busy: 'accept', acceptError: '' });
        return serial(async () => {
          try {
            if (!loaded) await load(e);
            lastName = null;
            const read = await adopt(k, e);
            if (e !== epoch) return null;
            if (!read) {
              // a failed read is not "the other device holds no name": say it, the next pull settles it
              const words = UNREAD;
              set({ said: { issue: 'unknown', words }, code: null });
              return words;
            }
            const n = lastName ?? { issue: 'none' as const, name: '', had: '' };
            const words = pairWords(n.issue, n.name, n.had);
            set({ said: { issue: n.issue, words }, code: null });
            return words;
          } catch (err) {
            if (e === epoch) set({ acceptError: say(err) });
            return null;
          } finally {
            if (e === epoch) set({ busy: null });
          }
        });
      },

      stop: async () => {
        epoch++;
        const where = keyName();
        key = null;
        id = '';
        version = 0;
        fastUntil = 0;
        stopTimers();
        clearTimeout(pushTimer);
        set({ paired: false, group: '', code: null, said: null, failing: false, busy: null, offerError: '', acceptError: '' });
        // after whatever exchange is under way, so its key write cannot land last
        await serial(() => d.secrets.set(where, ''));
      },

      changed: () => {
        if (!key) return;
        clearTimeout(pushTimer);
        const e = epoch;
        pushTimer = setTimeout(() => void serial(() => push(e)), PUSH_AFTER);
      },

      clearError: () => set({ offerError: '', acceptError: '' }),
    };
  });
}
