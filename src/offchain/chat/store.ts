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
  /** the server the chat talks to: each keeps its own last seen line */
  scope?: () => string;
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

/** The stored seen mark: "<gen>:<id>"; a plain number (older builds) has no gen. */
const parseSeen = (raw: string | null): { gen: number | null; id: number } => {
  const m = raw ? /^(\d+):(\d+)$/.exec(raw) : null;
  return m ? { gen: Number(m[1]), id: Number(m[2]) } : { gen: null, id: Number(raw ?? 0) || 0 };
};

export function createChatStore(d: ChatDeps): StoreApi<ChatState> & { ready: Promise<void> } {
  const sleep = d.sleep ?? abortableSleep;
  const random = d.random ?? Math.random;
  const now = d.now ?? Date.now;
  let run: AbortController | null = null;
  let olderBusy = false;
  let seenLoaded: number | null = null; // the stored last seen id; null until read
  const seenKey = () => (d.scope ? `${SEEN_KEY}:${d.scope()}` : SEEN_KEY);
  let typingAt = 0;
  let typingN = 0;
  // bumped when the view is replaced (restart, a new gen): an answer to a request made before is about another view
  let epoch = 0;

  const store = createStore<ChatState>()((set, get) => {
    const name = () => get().identity.reservedName || get().identity.name || 'anon';

    const seenValue = (id: number) => (get().gen === null ? String(id) : `${get().gen}:${id}`);

    const settleSeen = async () => {
      if (seenLoaded !== null) return;
      const raw = parseSeen(await d.kv.getItem(seenKey()).catch(() => null));
      const newest = get().lines.at(-1)?.id ?? 0;
      // first launch: the backlog is not "unread"; a mark of another log (gen), or beyond the newest line, is stale
      const valid = (raw.gen === null || raw.gen === get().gen) && raw.id > 0 && raw.id <= newest;
      seenLoaded = valid ? raw.id : newest;
      set({ lastSeen: seenLoaded });
      if (!valid || raw.gen === null) void d.kv.setItem(seenKey(), seenValue(seenLoaded)).catch(() => undefined);
    };

    const loop = async (signal: AbortSignal, resume: boolean) => {
      await ready;
      let first = !resume; // a resume long-polls from the cursor it holds; a new gen still reloads (below)
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
            epoch++;
            // another log: its ids are not the ones this app posted, reacted to or voted on
            set({ ...EMPTY_VIEW, mine: [], myReactions: {}, myVotes: {} });
            first = true;
            seenLoaded = null;
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
        const v = get();
        void loop(run.signal, v.gen !== null && v.lines.length > 0);
      },
      stop: () => {
        run?.abort();
        run = null;
        set({ phase: 'idle' });
      },
      restart: () => {
        get().stop();
        seenLoaded = null; // another server, or the same one anew: read its mark again
        epoch++;
        set({ ...EMPTY_VIEW, mine: [], myReactions: {}, myVotes: {} });
        // the reserved name and the avatar are per server: read what this one issued
        const e = epoch;
        void d.identity.load().then((identity) => {
          if (e === epoch) set({ identity });
        }, () => undefined);
        get().start();
      },
      loadOlder: async () => {
        const oldest = get().lines[0]?.id;
        if (olderBusy || !get().more || !oldest) return;
        olderBusy = true;
        const e = epoch;
        try {
          const r = await d.client.older(oldest);
          if (e === epoch) set(applyOlder(get(), r));
        } catch {
          // history is best effort: the next scroll tries again
        } finally {
          olderBusy = false;
        }
      },
      send: async (body, re) => {
        const text = body.trim();
        if (!text) return false;
        const e = epoch;
        const ok = await act(async () => {
          const l = await d.client.post(name(), text, re);
          if (e === epoch) set((s) => ({ ...upsertLine(s, l), mine: [...s.mine, l.id] }));
        });
        if (ok) typingAt = typingN = 0; // the server drops the sender's typing with the line
        return ok;
      },
      edit: (id, body) => {
        const e = epoch;
        return act(async () => {
          const l = await d.client.edit(id, body.trim());
          if (e === epoch) set((s) => upsertLine(s, l));
        });
      },
      withdraw: async () => {
        const e = epoch;
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
        if (e === epoch) set((s) => removeLine(s, id));
        return true;
      },
      react: async (id, emoji) => {
        const e = epoch;
        await act(async () => {
          const r = await d.client.react(id, emoji, name());
          if (e !== epoch) return;
          set((s) => {
            const had = (s.myReactions[id] ?? []).filter((e) => e !== emoji);
            return { ...patchLine(s, id, { rx: r.rx }), myReactions: { ...s.myReactions, [id]: r.mine ? [...had, emoji] : had } };
          });
        });
      },
      vote: async (id, opt) => {
        const e = epoch;
        await act(async () => {
          const r = await d.client.vote(id, opt);
          if (e !== epoch) return;
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
        void d.kv.setItem(seenKey(), seenValue(newest)).catch(() => undefined);
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
