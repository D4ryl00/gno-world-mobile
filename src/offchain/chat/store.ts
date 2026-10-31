import { createStore, type StoreApi } from 'zustand/vanilla';

import { OffchainError } from '@/offchain/http';

import type { ChatClient } from './client';
import type { ChatIdentity } from './identity';
import { displayName } from './identity-store';
import { applyOlder, applyPoll, EMPTY_VIEW, genChanged, patchLine, removeLine, upsertLine, type ChatView } from './merge';
import type { RoomInvite } from './types';

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
  /** the last refused action, in words for the composer */
  error: string;
  /** the room's name as its poll gives it; '' for Public or until known */
  roomName: string;
  /** three polls in a row found no such room: it is gone and the loop stopped */
  gone: boolean;
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
  /** the room's maker pins or unpins a line */
  pin(id: number, on: boolean): Promise<void>;
  /** the room's maker removes a line */
  deleteLine(id: number): Promise<void>;
  clearError(): void;
}

export interface ChatDeps {
  client: ChatClient;
  /** the identity lines go out under, read when writing (the identity store's) */
  identity: () => ChatIdentity;
  kv: KV;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  /** ms */
  now?: () => number;
  /** the server the chat talks to: each keeps its own last seen line */
  scope?: () => string;
  /** the room this log is; '' (the default) is Public */
  room?: string;
  /** the Public poll's invitations to rooms */
  onInvites?(dm: RoomInvite[]): void;
  /** a line of this app's went out */
  onPosted?(): void;
}

export const SEEN_KEY = 'br.chat.seen';
export const MARKS_KEY = 'br.chat.marks';
/** A room is gone after this many polls in a row answer 404, this far apart (the site's numbers). */
const GONE_AFTER = 3;
const GONE_RETRY = 20_000;

/** Where a log's last seen line is kept: Public keeps the key it always had. */
export const seenKeyFor = (scope: string | undefined, room = '') =>
  `${scope === undefined ? SEEN_KEY : `${SEEN_KEY}:${scope}`}${room ? `:${room}` : ''}`;
/** As the site's br.rx: the newest 400 lines' marks are kept. */
const MARKS_MAX = 400;

const newest = <T>(m: Record<number, T>): Record<number, T> =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [Number(k), v] as const).sort((a, b) => b[0] - a[0]).slice(0, MARKS_MAX));
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

/** The server's own words when it refused (or ours, for a reply we refused); a plain sentence when it did not answer. */
const say = (e: unknown) =>
  e instanceof OffchainError
    ? e.status !== 0 ? e.message : 'The chat server did not answer — try again.'
    : e instanceof Error ? e.message : 'The chat server did not answer — try again.';

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
  const room = d.room ?? '';
  const seenKey = () => seenKeyFor(d.scope?.(), room);
  const marksKey = () => `${d.scope ? `${MARKS_KEY}:${d.scope()}` : MARKS_KEY}${room ? `:${room}` : ''}`;
  let typingAt = 0;
  let typingN = 0;
  // bumped when the view is replaced (restart, a new gen): an answer to a request made before is about another view
  let epoch = 0;

  const store = createStore<ChatState>()((set, get) => {
    const name = () => displayName(d.identity());

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

    // own reactions and votes, per server and log: the site keeps its reactions the same way (br.rx)
    const loadMarks = async () => {
      const raw = await d.kv.getItem(marksKey()).catch(() => null);
      try {
        const m = raw ? (JSON.parse(raw) as { gen?: unknown; rx?: Record<string, string[]>; votes?: Record<string, number> }) : null;
        if (m && m.gen === get().gen) set({ myReactions: newest(m.rx ?? {}), myVotes: newest(m.votes ?? {}) });
      } catch {
        // a damaged record is forgotten
      }
    };
    const saveMarks = () => {
      const { gen, myReactions, myVotes } = get();
      if (gen === null) return;
      const value = JSON.stringify({ gen, rx: newest(myReactions), votes: newest(myVotes) });
      void d.kv.setItem(marksKey(), value).catch(() => undefined);
    };

    const loop = async (signal: AbortSignal, resume: boolean) => {
      await ready;
      if (signal.aborted) return; // stopped in the same tick it was started
      let first = !resume; // a resume long-polls from the cursor it holds; a new gen still reloads (below)
      let backoff = BACKOFF_MIN;
      let misses = 0; // 404s in a row: a room quiet for a month is gone
      set({ phase: 'loading' });
      while (!signal.aborted) {
        const v = get();
        const who = displayName(d.identity()).slice(0, 96);
        try {
          const r = await d.client.poll(
            first ? { since: 0, wait: 0, limit: 80, gen: null, name: who } : { since: v.since, wait: 55, limit: 200, gen: v.gen, name: who },
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
          set({ ...applyPoll(first ? EMPTY_VIEW : get(), r), phase: 'live', ...(r.roomName ? { roomName: r.roomName } : {}) });
          if (!room && r.dm.length) d.onInvites?.(r.dm);
          if (first) {
            await settleSeen();
            await loadMarks();
          }
          first = false;
          backoff = BACKOFF_MIN;
          misses = 0;
        } catch (e) {
          if (signal.aborted) return;
          if (room && e instanceof OffchainError && e.status === 404) {
            if (++misses >= GONE_AFTER) {
              set({ gone: true, phase: 'idle' });
              return;
            }
            await sleep(GONE_RETRY, signal);
            continue;
          }
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
      error: '',
      roomName: '',
      gone: false,
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
        if (ok) {
          typingAt = typingN = 0; // the server drops the sender's typing with the line
          d.onPosted?.();
        }
        return ok;
      },
      edit: (id, body) => {
        const text = body.trim();
        // nothing changed: no request, and the line is not marked edited
        if (get().lines.find((l) => l.id === id)?.body === text) return Promise.resolve(true);
        const e = epoch;
        return act(async () => {
          const l = await d.client.edit(id, text);
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
          saveMarks();
        });
      },
      vote: async (id, opt) => {
        const e = epoch;
        await act(async () => {
          const r = await d.client.vote(id, opt);
          if (e !== epoch) return;
          set((s) => ({ ...(r.poll ? patchLine(s, id, { poll: r.poll }) : s), myVotes: { ...s.myVotes, [id]: r.mine } }));
          saveMarks();
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
      pin: async (id, on) => {
        const e = epoch;
        await act(async () => {
          const r = await d.client.pin(id, on);
          if (e === epoch) set((s) => ({ ...patchLine(s, id, { pinned: on }), pins: r.pins }));
        });
      },
      deleteLine: async (id) => {
        const e = epoch;
        await act(async () => {
          await d.client.deleteLine(id);
          if (e === epoch) set((s) => removeLine(s, id));
        });
      },
      clearError: () => set({ error: '' }),
    };
  });

  // kept for callers that wait for the store: nothing is read at creation any more
  const ready = Promise.resolve();
  return Object.assign(store, { ready });
}
