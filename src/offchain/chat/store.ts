import { createStore, type StoreApi } from 'zustand/vanilla';

import { OffchainError } from '@/offchain/http';
import { buildChallengeLink, CALLBACK_URL, type WalletReply } from '@/session/gnoconnect';

import type { ChatClient } from './client';
import { NO_IDENTITY, type ChatIdentity, type IdentityStore } from './identity';
import { proofFromReply } from './name-proof';
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
  /** the last refused name or picture action, for the sheet */
  identityError: string;
  /** a reservation waiting for the wallet's proof */
  proving: { state: string; name: string; identity: string } | null;
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
  /** reserves the field's name for the identity (the session's master); false also while the wallet signs */
  reserveName(identity: string): Promise<boolean>;
  /** the wallet's answer to the chat's challenge: false when the reply is not the chat's */
  onProofReply(r: WalletReply): Promise<boolean>;
  /** stops waiting for the wallet (the sheet's Cancel) */
  cancelProving(): void;
  releaseName(): Promise<boolean>;
  setAvatar(body: Blob | Uint8Array, contentType: string): Promise<boolean>;
  clearError(): void;
  clearIdentityError(): void;
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
  /** the wallet, for a name the server wants proven: opens a GnoConnect link */
  wallet?: { open(url: string): Promise<void>; randomHex(n: number): string; network(): { chainId: string; remote: string } };
}

export const SEEN_KEY = 'br.chat.seen';
export const MARKS_KEY = 'br.chat.marks';
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

/** The wallet's refusal of a challenge, in words for the sheet. */
const walletRefusal = (code: string) =>
  code === 'signer_unavailable'
    ? 'Your computer could not sign: run gnokey-pair with a gnokey that has sign-data, then try again.'
    : code === 'network_declined'
      ? 'The wallet is on another network than the app.'
      : `The wallet refused (${code || 'no reason given'}).`;

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
  const marksKey = () => (d.scope ? `${MARKS_KEY}:${d.scope()}` : MARKS_KEY);
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
          if (first) {
            await settleSeen();
            await loadMarks();
          }
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

    const act = async (f: () => Promise<void>, field: 'error' | 'identityError' = 'error'): Promise<boolean> => {
      try {
        await f();
        set({ [field]: '' } as Partial<ChatState>);
        return true;
      } catch (e) {
        set({ [field]: say(e) } as Partial<ChatState>);
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
      identityError: '',
      proving: null,
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
      setName: async (n) => {
        if (get().identity.reservedName) return; // a reserved name is released first
        set({ identity: await d.identity.save({ name: n.trim() }) });
      },
      reserveName: async (identity) => {
        const n = get().identity.name.trim();
        try {
          const r = await d.client.reserveName(n, identity);
          set({ identity: await d.identity.save({ name: r.name, reservedName: r.name, nameKey: r.key }), identityError: '', proving: null });
          return true;
        } catch (e) {
          // as the site: a 409 asks for the wallet's signature, whatever it says
          if (!(e instanceof OffchainError && e.status === 409) || !d.wallet) {
            set({ identityError: say(e) });
            return false;
          }
        }
        const wallet = d.wallet;
        const launched = await act(async () => {
          const challenge = await d.client.nameChallenge();
          const state = wallet.randomHex(16);
          const { chainId, remote } = wallet.network();
          set({ proving: { state, name: n, identity } });
          await wallet.open(buildChallengeLink({ challenge, signer: identity, chainid: chainId, rpc: remote, callback: CALLBACK_URL, state }));
        }, 'identityError');
        if (!launched) set({ proving: null }); // no wallet opened: nothing to wait for
        return false;
      },
      onProofReply: async (r) => {
        const p = get().proving;
        if (!p || r.state !== p.state) return false;
        set({ proving: null });
        if (r.status === 'cancelled') return true;
        if (r.status === 'error') {
          set({ identityError: walletRefusal(r.code) });
          return true;
        }
        await act(async () => {
          const got = await d.client.proveName(p.name, proofFromReply(r, p.identity));
          set({ identity: await d.identity.save({ name: got.name, reservedName: got.name, nameKey: got.key }) });
        }, 'identityError');
        return true;
      },
      cancelProving: () => set({ proving: null }),
      releaseName: () =>
        act(async () => {
          try {
            await d.client.releaseName();
          } catch (e) {
            if (!(e instanceof OffchainError && e.status === 404)) throw e; // the server no longer has it: nothing to release
          }
          set({ identity: await d.identity.save({ reservedName: '', nameKey: '' }) });
        }, 'identityError'),
      setAvatar: (body, contentType) =>
        act(async () => {
          const r = await d.client.uploadAvatar(body, contentType);
          set({ identity: await d.identity.save({ av: r.id, avkey: r.key }) });
        }, 'identityError'),
      clearError: () => set({ error: '' }),
      clearIdentityError: () => set({ identityError: '' }),
    };
  });

  const ready = d.identity.load().then(
    (identity) => store.setState({ identity }),
    () => undefined,
  );
  return Object.assign(store, { ready });
}
