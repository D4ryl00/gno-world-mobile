import { createStore, type StoreApi } from 'zustand/vanilla';

import { OffchainError } from '@/offchain/http';

import type { ChatClient } from './client';
import { NO_IDENTITY, type ChatIdentity, type IdentityStore } from './identity';
import { applyOlder, applyPoll, EMPTY_VIEW, genChanged, patchLine, removeLine, upsertLine, type ChatView } from './merge';

export interface KV {
  getItem(k: string): Promise<string | null>;
  setItem(k: string, v: string): Promise<void>;
}

export type ChatPhase = 'idle' | 'loading' | 'live' | 'unreachable';

export interface ChatState extends ChatView {
  phase: ChatPhase;
  lastSeen: number;
  /** ids this app posted */
  mine: number[];
  myReactions: Record<number, string[]>;
  myVotes: Record<number, number>;
  identity: ChatIdentity;
  /** the last refused action, in words for the composer or the sheet */
  error: string;
  start(): void;
  stop(): void;
  restart(): void;
  loadOlder(): Promise<void>;
  send(body: string, re?: number): Promise<boolean>;
  edit(id: number, body: string): Promise<boolean>;
  withdraw(): Promise<boolean>;
  react(id: number, emoji: string): Promise<void>;
  vote(id: number, opt: number): Promise<void>;
  /** tells the server this client is typing n characters (0 clears it) */
  signalTyping(n: number): void;
  markSeen(): void;
  setName(name: string): Promise<void>;
  reserveName(): Promise<boolean>;
  releaseName(): Promise<boolean>;
  setAvatar(body: Blob | Uint8Array, contentType: string): Promise<boolean>;
  clearError(): void;
}

export interface ChatDeps {
  client: ChatClient;
  identity: IdentityStore;
  kv: KV;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  /** ms */
  now?: () => number;
}

export const SEEN_KEY = 'br.chat.seen';
const BACKOFF_MIN = 2000;
const BACKOFF_MAX = 60000;
const TYPING_EVERY = 3000;

const abortableSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/** The server's own words when it refused; a plain sentence when it did not answer. */
const say = (e: unknown) =>
  e instanceof OffchainError && e.status !== 0 ? e.message : 'The chat server did not answer — try again.';

export function createChatStore(d: ChatDeps): StoreApi<ChatState> & { ready: Promise<void> } {
  const sleep = d.sleep ?? abortableSleep;
  const random = d.random ?? Math.random;
  const now = d.now ?? Date.now;
  let run: AbortController | null = null;
  let olderBusy = false;
  let seenLoaded: number | null = null; // the stored last seen id; null until read
  let typingAt = 0;
  let typingN = 0;

  const store = createStore<ChatState>()((set, get) => {
    const name = () => get().identity.reservedName || get().identity.name || 'anon';

    const settleSeen = async () => {
      if (seenLoaded !== null) return;
      const raw = await d.kv.getItem(SEEN_KEY).catch(() => null);
      const newest = get().lines.at(-1)?.id ?? 0;
      // first launch: the backlog is not "unread"
      seenLoaded = raw !== null && Number(raw) > 0 ? Number(raw) : newest;
      set({ lastSeen: seenLoaded });
      if (raw === null) void d.kv.setItem(SEEN_KEY, String(seenLoaded)).catch(() => undefined);
    };

    const loop = async (signal: AbortSignal) => {
      await ready;
      let first = true;
      let backoff = BACKOFF_MIN;
      set({ phase: 'loading' });
      while (!signal.aborted) {
        const v = get();
        try {
          const r = await d.client.poll(
            first ? { since: 0, wait: 0, limit: 80, gen: null } : { since: v.since, wait: 55, limit: 200, gen: v.gen },
            { timeoutMs: first ? 20_000 : 70_000, signal },
          );
          if (signal.aborted) return;
          if (!first && genChanged(v, r)) {
            set({ ...EMPTY_VIEW });
            first = true;
            continue;
          }
          set({ ...applyPoll(first ? EMPTY_VIEW : get(), r), phase: 'live' });
          if (first) await settleSeen();
          first = false;
          backoff = BACKOFF_MIN;
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof OffchainError && (e.status === 429 || e.status === 503)) {
            await sleep(((e.retryAfter ?? 6) + random() * 6) * 1000, signal);
            continue;
          }
          set({ phase: 'unreachable' });
          await sleep(backoff, signal);
          backoff = Math.min(backoff * 2, BACKOFF_MAX);
        }
      }
    };

    const act = async (f: () => Promise<void>): Promise<boolean> => {
      try {
        await f();
        set({ error: '' });
        return true;
      } catch (e) {
        set({ error: say(e) });
        return false;
      }
    };

    return {
      ...EMPTY_VIEW,
      phase: 'idle',
      lastSeen: 0,
      mine: [],
      myReactions: {},
      myVotes: {},
      identity: NO_IDENTITY,
      error: '',
      start: () => {
        if (run) return;
        run = new AbortController();
        void loop(run.signal);
      },
      stop: () => {
        run?.abort();
        run = null;
        set({ phase: 'idle' });
      },
      restart: () => {
        get().stop();
        set({ ...EMPTY_VIEW, mine: [], myReactions: {}, myVotes: {} });
        get().start();
      },
      loadOlder: async () => {
        const oldest = get().lines[0]?.id;
        if (olderBusy || !get().more || !oldest) return;
        olderBusy = true;
        try {
          const r = await d.client.older(oldest);
          set(applyOlder(get(), r));
        } catch {
          // history is best effort: the next scroll tries again
        } finally {
          olderBusy = false;
        }
      },
      send: async (body, re) => {
        const text = body.trim();
        if (!text) return false;
        const ok = await act(async () => {
          const l = await d.client.post(name(), text, re);
          set((s) => ({ ...upsertLine(s, l), mine: [...s.mine, l.id] }));
        });
        if (ok) typingAt = typingN = 0; // the server drops the sender's typing with the line
        return ok;
      },
      edit: (id, body) =>
        act(async () => {
          const l = await d.client.edit(id, body.trim());
          set((s) => upsertLine(s, l));
        }),
      withdraw: async () => {
        const taken: { id: number | null } = { id: null };
        const ok = await act(async () => {
          taken.id = await d.client.withdraw();
        });
        if (!ok) return false;
        const id = taken.id;
        if (id === null) {
          set({ error: 'Only your newest line in the chat, under fifteen minutes old, can be taken back.' });
          return false;
        }
        set((s) => removeLine(s, id));
        return true;
      },
      react: async (id, emoji) => {
        await act(async () => {
          const r = await d.client.react(id, emoji, name());
          set((s) => {
            const had = (s.myReactions[id] ?? []).filter((e) => e !== emoji);
            return { ...patchLine(s, id, { rx: r.rx }), myReactions: { ...s.myReactions, [id]: r.mine ? [...had, emoji] : had } };
          });
        });
      },
      vote: async (id, opt) => {
        await act(async () => {
          const r = await d.client.vote(id, opt);
          set((s) => ({ ...(r.poll ? patchLine(s, id, { poll: r.poll }) : s), myVotes: { ...s.myVotes, [id]: r.mine } }));
        });
      },
      signalTyping: (n) => {
        const t = now();
        if (n === 0 && typingN === 0) return;
        if (n > 0 && t - typingAt < TYPING_EVERY) return;
        typingAt = n > 0 ? t : 0;
        typingN = n;
        void d.client.typing(name(), n).catch(() => undefined);
      },
      markSeen: () => {
        const newest = get().lines.at(-1)?.id ?? 0;
        if (newest <= get().lastSeen) return;
        seenLoaded = newest;
        set({ lastSeen: newest });
        void d.kv.setItem(SEEN_KEY, String(newest)).catch(() => undefined);
      },
      setName: async (n) => {
        if (get().identity.reservedName) return; // a reserved name is released first
        set({ identity: await d.identity.save({ name: n.trim() }) });
      },
      reserveName: () =>
        act(async () => {
          const r = await d.client.reserveName(get().identity.name.trim());
          set({ identity: await d.identity.save({ name: r.name, reservedName: r.name, nameKey: r.key }) });
        }),
      releaseName: () =>
        act(async () => {
          try {
            await d.client.releaseName();
          } catch (e) {
            if (!(e instanceof OffchainError && e.status === 404)) throw e; // the server no longer has it: nothing to release
          }
          set({ identity: await d.identity.save({ reservedName: '', nameKey: '' }) });
        }),
      setAvatar: (body, contentType) =>
        act(async () => {
          const r = await d.client.uploadAvatar(body, contentType);
          set({ identity: await d.identity.save({ av: r.id, avkey: r.key }) });
        }),
      clearError: () => set({ error: '' }),
    };
  });

  const ready = d.identity.load().then(
    (identity) => store.setState({ identity }),
    () => undefined,
  );
  return Object.assign(store, { ready });
}
