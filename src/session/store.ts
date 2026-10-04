import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';

import type { ChainApi } from '@/chain/api';
import { SESSION_ALLOW_PATHS } from '@/chain/realms';
import { isAddress } from '@/utils/address';
import { decodeAddress } from '@/utils/bech32';

import { createCommand, replaceCommand, revokeCommand } from './fallback';
import { buildSessionLink, CALLBACK_URL, grantsKey, signLink, type SessionHost, type WalletReply } from './gnoconnect';
import { createSessionKey, unlockKey, type SecretStore } from './keys';
import { pollSession, querySession, type SessionStatus } from './status';
import type { ActiveSession, Grant, SessionKey } from './types';

/** restore() could not unlock the active key (e.g. the secure store lost the keybase password after a backup restore). */
export const KEY_LOST_ERROR = 'This phone can no longer use its session key. Forget it here, then get a new session.';

const OTHER_CHAIN_REQUEST = /^This request was started on \S+\. Switch back to that network/;
const otherChainRequestError = (chainId: string) =>
  `This request was started on ${chainId}. Switch back to that network to finish it, or cancel it.`;
/** The error shown while a pending request belongs to another network than the settings' one. */
export const isOtherChainRequest = (error?: string) => !!error && OTHER_CHAIN_REQUEST.test(error);

export type Phase = 'none' | 'waiting-wallet' | 'desktop' | 'waiting-chain' | 'active' | 'error';

export interface Pending {
  op: 'create' | 'replace' | 'revoke';
  state: string;
  key: SessionKey;
  old?: ActiveSession;
  grant?: Grant;
  master?: string;
  chainId: string;
  via: 'wallet' | 'desktop';
  createdAt: number;
}

export interface SessionDeps {
  api: () => ChainApi;
  secrets: SecretStore;
  storage: StateStorage;
  openURL: (url: string) => Promise<void>;
  randomHex: (bytes: number) => string;
  now: () => number;
  network: () => { chainId: string; remote: string };
  pollIntervalMs?: number;
  /** how long a renewal waits for the old session to leave the chain before saying it is still there */
  previousWaitMs?: number;
}

export interface SessionState {
  phase: Phase;
  active?: ActiveSession;
  pending?: Pending;
  status?: SessionStatus;
  command?: string;
  error?: string;
  begin(op: 'create' | 'replace', grant: Grant): Promise<void>;
  revoke(): Promise<void>;
  useDesktop(): void;
  submitMaster(master: string): Promise<void>;
  onReply(r: WalletReply): Promise<void>;
  refresh(): Promise<SessionStatus | null>;
  restore(): Promise<void>;
  cancel(): void;
  /** The wallet answered a request with an error: the request is over, the screen shows this once. */
  walletError?: { code: string; op: Pending['op'] };
  /** Returns the wallet error and clears it in one step, so only one reader ever shows it. */
  takeWalletError(): { code: string; op: Pending['op'] } | undefined;
  /** The network is about to change: stop reading the chain, keep everything else (restore() resumes). */
  pause(): void;
  /** gnonative is now on the new network: stop watching the old one and resume or pause what is pending. */
  networkChanged(): Promise<void>;
  /** Drop the session and any request from this phone only; the chain keeps the session until it expires or is revoked. */
  forget(): void;
  /** A renewal left the old session on chain (a desktop replace whose revoke failed): the screen offers to revoke it. */
  previous?: ActiveSession;
  /** Re-reads the previous session: gone → forgotten and its key deleted (true); still there → kept (false). */
  dismissPrevious(): Promise<boolean>;
}

// gnoconnect-session.md: a grant and a renewal are both a `connect` with the new key (a renewal adds `old`).
const HOST: Record<Pending['op'], SessionHost> = { create: 'connect', replace: 'connect', revoke: 'disconnect' };

export const createSessionStore = (d: SessionDeps) => {
  let poll = { aborted: false };
  let starting = false; // a begin/revoke is between its start and its send (a double tap)
  let generation = 0; // bumped by cancel() and forget(): a begin started before must not send
  const interval = d.pollIntervalMs ?? 3000;
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  // Hydration is "settled" once the first rehydrate is over, even when the storage failed (zustand's hasHydrated
  // then stays false and anything waiting on it would wait forever).
  let settled = false;
  const settledListeners = new Set<() => void>();
  const ready = {
    hasHydrated: () => settled,
    onFinishHydration: (fn: () => void) => {
      settledListeners.add(fn);
      return () => void settledListeners.delete(fn);
    },
  };

  const store = createStore<SessionState>()(
    persist(
      (set, get, api) => {
        const fail = (e: unknown): void => {
          set({ phase: 'error', error: String((e as Error)?.message ?? e) });
        };

        /** Deletes a key no session will use any more (a request that ended, a session revoked or replaced). */
        const drop = (key: SessionKey | undefined): void => {
          if (!key || get().active?.keyName === key.keyName) return; // never the key that signs
          void d.api().deleteAccount(key.keyName, undefined, true).catch(() => undefined);
        };
        /** The pending request is over: its new key is useless (a revoke's key is the active one, kept). */
        const dropPending = (p: Pending | undefined): void => {
          if (p && p.op !== 'revoke') drop(p.key);
        };

        /** After a renewal: the old session should leave the chain (same transaction from a wallet, a second one from
         *  gnokey). Its key goes once it has; if it is still there after a while, the screen offers to revoke it. */
        const watchPrevious = async (old: ActiveSession, next: SessionKey) => {
          const tries = Math.max(1, Math.round((d.previousWaitMs ?? 30000) / interval));
          for (let i = 0; i < tries; i++) {
            if (get().active?.address !== next.address) return; // forgotten, revoked or replaced meanwhile
            const st = await querySession(d.api(), old.master, old.address).catch(() => undefined);
            if (st === null) {
              drop(old);
              return;
            }
            await sleep(interval);
          }
          if (get().active?.address === next.address) set({ previous: old });
        };

        const commandFor = (p: Pending): string => {
          const ctx = d.network();
          if (p.op === 'create') return createCommand(p.key, p.grant!, SESSION_ALLOW_PATHS, ctx);
          if (p.op === 'replace') return replaceCommand(p.key, p.grant!, SESSION_ALLOW_PATHS, p.old!.pubkey, ctx);
          return revokeCommand(p.key.pubkey, ctx);
        };

        /** Check if this pending request and poll are still valid (not cancelled/superseded, still on its network). */
        const current = (p: Pending, signal: { aborted: boolean }): boolean =>
          !signal.aborted && get().pending?.state === p.state && d.network().chainId === p.chainId;

        const waitForChain = async (p: Pending, master: string) => {
          poll.aborted = true; // whatever happens next, a poll already running for this request must stop
          if (p.chainId !== d.network().chainId) {
            set({ phase: 'error', error: otherChainRequestError(p.chainId) });
            return;
          }
          poll = { aborted: false };
          const signal = poll;
          set({ phase: 'waiting-chain', pending: { ...p, master } });
          try {
            if (p.op === 'revoke') {
              await pollSession(d.api(), master, p.key.address, 'absent', { intervalMs: interval, signal });
              if (!current(p, signal)) return;
              set({ phase: 'none', active: undefined, pending: undefined, status: undefined, command: undefined });
              drop(p.key); // revoked: nothing will sign with it again
              return;
            }
            const status = await pollSession(d.api(), master, p.key.address, 'present', { intervalMs: interval, signal });
            if (!current(p, signal)) return;
            await unlockKey(d.api(), d.secrets, p.key, master);
            if (!current(p, signal)) return;
            set({
              phase: 'active', active: { ...p.key, master, chainId: p.chainId }, status: status ?? undefined,
              pending: undefined, command: undefined, error: undefined, previous: undefined,
            });
            if (p.op === 'replace' && p.old) void watchPrevious(p.old, p.key);
          } catch (e) {
            if (current(p, signal)) fail(e);
          }
        };

        /** Show the gnokey command; when the master is known (renewal, revocation, identity-only answer), watch the chain at once. */
        const desktop = (master?: string): void => {
          const p = get().pending;
          if (!p) return;
          // Check network chain before showing desktop or polling
          if (p.chainId !== d.network().chainId) {
            set({ phase: 'error', error: otherChainRequestError(p.chainId) });
            return;
          }
          const next = { ...p, via: 'desktop' as const };
          set({ pending: next, phase: 'desktop', command: commandFor(next) });
          const known = master ?? (p.op === 'create' ? undefined : get().active?.master);
          if (known) void waitForChain(next, known);
        };

        const send = async (p: Pending, link: string) => {
          poll.aborted = true; // abort any running poll before setting new pending
          set({ pending: p, phase: 'waiting-wallet', command: commandFor(p), error: undefined });
          starting = false; // the pending request now blocks a second one, even if the wallet never comes back
          try {
            await d.openURL(link);
          } catch {
            get().useDesktop();
          }
        };

        const linkFor = async (p: Pending): Promise<string> => {
          const net = d.network();
          const api = d.api();
          const link = buildSessionLink({
            host: HOST[p.op], pubkey: p.key.pubkey, old: p.op === 'replace' ? p.old!.pubkey : undefined,
            grant: p.grant, allow: p.op === 'revoke' ? undefined : SESSION_ALLOW_PATHS,
            chainid: net.chainId, rpc: net.remote, signer: p.old?.master ?? (p.op === 'revoke' ? get().active?.master : undefined),
            callback: CALLBACK_URL, state: p.state, iat: Math.floor(d.now() / 1000),
          });
          const signWith = (addr: string) => async (data: Uint8Array) =>
            (await api.signBytes(decodeAddress(addr), data)).signature;
          return signLink(link, signWith(p.key.address), p.op === 'replace' ? signWith(p.old!.address) : undefined);
        };

        return {
          phase: 'none',

          async begin(op, grant): Promise<void> {
            if (starting || get().pending) return;
            starting = true;
            const gen = generation;
            let key: SessionKey | undefined;
            try {
              const old = get().active;
              if (op === 'replace' && !old) throw new Error('no session to replace');
              key = await createSessionKey(d.api(), d.secrets, d.randomHex, d.now);
              await unlockKey(d.api(), d.secrets, key); // so it can sign the proof
              const p: Pending = {
                op, state: d.randomHex(16), key, old: op === 'replace' ? old : undefined, grant,
                chainId: d.network().chainId, via: 'wallet', createdAt: d.now(),
              };
              const link = await linkFor(p);
              if (gen !== generation) {
                drop(key); // cancelled while the request was being prepared
                return;
              }
              await send(p, link);
            } catch (e) {
              if (gen !== generation) return;
              drop(key);
              fail(e);
            } finally {
              starting = false;
            }
          },

          async revoke(): Promise<void> {
            if (starting || get().pending) return;
            starting = true;
            const gen = generation;
            try {
              const active = get().active;
              if (!active) throw new Error('no session to revoke');
              const p: Pending = {
                op: 'revoke', state: d.randomHex(16), key: active, chainId: active.chainId, via: 'wallet', createdAt: d.now(),
              };
              const link = await linkFor(p);
              if (gen !== generation) return;
              await send(p, link);
            } catch (e) {
              fail(e);
            } finally {
              starting = false;
            }
          },

          useDesktop(): void {
            desktop();
          },

          async submitMaster(master): Promise<void> {
            const p = get().pending;
            if (!p) throw new Error('nothing is waiting for an address');
            if (!isAddress(master.trim())) throw new Error('that is not a gno address (g1…, 40 characters)');
            await waitForChain(p, master.trim());
          },

          async onReply(r): Promise<void> {
            // a reply can arrive before the persisted request is read back: wait for it (or for its failure)
            if (!ready.hasHydrated()) {
              await new Promise<void>((resolve) => {
                const off = ready.onFinishHydration(() => {
                  off();
                  resolve();
                });
                if (ready.hasHydrated()) {
                  off();
                  resolve();
                }
              });
            }

            const p = get().pending;
            if (!p || r.state !== p.state) return; // not ours: forged, stale or duplicated
            if (r.status === 'cancelled') {
              poll.aborted = true;
              set({ pending: undefined, command: undefined, phase: get().active ? 'active' : 'none' });
              dropPending(p);
              return;
            }
            if (r.status === 'error') {
              // a wallet without `disconnect`, or without any account: the user can still sign on a computer
              if (r.code === 'unsupported_host' || r.code === 'no_signer') {
                desktop();
                return;
              }
              // the request is over: back to where the user was, with the answer for an alert
              set({
                pending: undefined, command: undefined, error: undefined, phase: get().active ? 'active' : 'none',
                walletError: { code: r.code, op: p.op },
              });
              dropPending(p);
              return;
            }
            // a success for this request must be about its network and, for a renewal or a revocation, its account
            if (r.chainid && r.chainid !== p.chainId) {
              fail(new Error(`The wallet answered for ${r.chainid}, but this request is for ${p.chainId}. Cancel it and try again.`));
              return;
            }
            const known = p.op === 'create' ? undefined : get().active?.master;
            if (known && r.address && r.address !== known) {
              fail(new Error(`The wallet answered for another account (${r.address}); this session belongs to ${known}. Cancel it and pick that account in the wallet.`));
              return;
            }
            const master = p.op === 'create' ? r.address : get().active?.master;
            if (!master || !isAddress(master)) {
              fail(new Error('the wallet did not say which account granted the session'));
              return;
            }
            // An identity-only `connect` answer: the wallet does not grant sessions yet, but it told us the master.
            if (p.op !== 'revoke' && !grantsKey(r, p.key.address)) {
              desktop(master);
              return;
            }
            await waitForChain(p, master);
          },

          async refresh(): Promise<SessionStatus | null> {
            const a = get().active;
            if (!a) return null;
            // Don't query if on a different chain; return null as if session is gone
            if (a.chainId !== d.network().chainId) return null;
            const st = await querySession(d.api(), a.master, a.address);
            if (st) set({ status: st });
            return st;
          },

          async restore(): Promise<void> {
            // Read pending and compute master BEFORE anything else
            const p = get().pending;
            const master = p
              ? p.master ?? p.old?.master ?? (p.op === 'revoke' ? get().active?.master : undefined)
              : undefined;

            // Handle active first: unlock the key (local, no network), then read it from its own chain.
            const a = get().active;
            if (a) {
              try {
                await unlockKey(d.api(), d.secrets, a, a.master);
              } catch {
                set({ phase: 'error', error: KEY_LOST_ERROR });
                return; // nothing this phone holds can sign; the error card offers to forget it
              }
              const keep = () => (get().pending ? get().phase : 'active');
              if (a.chainId !== d.network().chainId) {
                set({ status: undefined, phase: keep() }); // another chain: keep it, never query it here
              } else {
                const st = await querySession(d.api(), a.master, a.address).catch(() => undefined);
                if (st === null) {
                  set({ active: undefined, status: undefined, phase: get().pending ? get().phase : 'none' });
                } else {
                  // undefined: the chain did not answer; the session card says so and its refresh retries
                  set({ status: st, phase: keep() });
                }
              }
            }

            // Only then resume pending request (but re-check it wasn't cancelled/replied during active handling)
            if (p && get().pending?.state === p.state) {
              // Check network chain before resuming
              if (p.chainId !== d.network().chainId) {
                set({ phase: 'error', error: otherChainRequestError(p.chainId) });
              } else if (master) {
                void waitForChain(p, master);
              } else {
                set({ phase: p.via === 'wallet' ? 'waiting-wallet' : 'desktop', command: commandFor(p) });
              }
            }
          },

          cancel(): void {
            poll.aborted = true;
            generation++;
            const p = get().pending;
            set({ pending: undefined, command: undefined, error: undefined, phase: get().active ? 'active' : 'none' });
            dropPending(p);
          },

          takeWalletError() {
            const w = get().walletError;
            if (w) set({ walletError: undefined });
            return w;
          },

          pause(): void {
            poll.aborted = true;
          },

          async networkChanged(): Promise<void> {
            poll.aborted = true;
            await get().restore();
          },

          forget(): void {
            poll.aborted = true;
            generation++;
            const p = get().pending;
            set({
              phase: 'none', active: undefined, pending: undefined, status: undefined, command: undefined, error: undefined,
              previous: undefined,
            });
            dropPending(p);
          },

          async dismissPrevious(): Promise<boolean> {
            const old = get().previous;
            if (!old) return true;
            const st = await querySession(d.api(), old.master, old.address).catch(() => undefined);
            if (st !== null) return false; // still on chain, or the chain did not answer
            set({ previous: undefined });
            drop(old);
            return true;
          },
        };
      },
      {
        name: 'br.session',
        storage: createJSONStorage(() => d.storage),
        partialize: (s) => ({ active: s.active, pending: s.pending, previous: s.previous }),
        onRehydrateStorage: () => () => {
          settled = true;
          settledListeners.forEach((fn) => fn());
        },
        // the phase is derived from what was persisted, never stored itself
        merge: (persisted, current) => {
          const p = (persisted ?? {}) as Partial<SessionState>;
          const phase: Phase = p.pending
            ? p.pending.via === 'wallet' ? 'waiting-wallet' : 'desktop'
            : p.active ? 'active' : 'none';
          return { ...current, ...p, phase };
        },
      },
    ),
  );
  return Object.assign(store, { ready });
};
