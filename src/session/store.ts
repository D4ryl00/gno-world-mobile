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
}

// gnoconnect-session.md: a grant and a renewal are both a `connect` with the new key (a renewal adds `old`).
const HOST: Record<Pending['op'], SessionHost> = { create: 'connect', replace: 'connect', revoke: 'disconnect' };

export const createSessionStore = (d: SessionDeps) => {
  let poll = { aborted: false };
  const interval = d.pollIntervalMs ?? 3000;

  return createStore<SessionState>()(
    persist(
      (set, get, api) => {
        const fail = (e: unknown): void => {
          set({ phase: 'error', error: String((e as Error)?.message ?? e) });
        };

        const commandFor = (p: Pending): string => {
          const ctx = d.network();
          if (p.op === 'create') return createCommand(p.key, p.grant!, SESSION_ALLOW_PATHS, ctx);
          if (p.op === 'replace') return replaceCommand(p.key, p.grant!, SESSION_ALLOW_PATHS, p.old!.pubkey, ctx);
          return revokeCommand(p.key.pubkey, ctx);
        };

        /** Check if this pending request and poll are still valid (not cancelled/superseded). */
        const current = (p: Pending, signal: { aborted: boolean }): boolean =>
          !signal.aborted && get().pending?.state === p.state;

        const waitForChain = async (p: Pending, master: string) => {
          // Check network chain before polling
          if (p.chainId !== d.network().chainId) {
            set({
              phase: 'error',
              error: `This request was started on ${p.chainId}. Switch back to that network to finish it, or cancel it.`,
            });
            return;
          }

          poll.aborted = true;
          poll = { aborted: false };
          const signal = poll;
          set({ phase: 'waiting-chain', pending: { ...p, master } });
          try {
            if (p.op === 'revoke') {
              await pollSession(d.api(), master, p.key.address, 'absent', { intervalMs: interval, signal });
              if (!current(p, signal)) return;
              set({ phase: 'none', active: undefined, pending: undefined, status: undefined, command: undefined });
              return;
            }
            const status = await pollSession(d.api(), master, p.key.address, 'present', { intervalMs: interval, signal });
            if (!current(p, signal)) return;
            await unlockKey(d.api(), d.secrets, p.key, master);
            if (!current(p, signal)) return;
            set({
              phase: 'active', active: { ...p.key, master, chainId: p.chainId }, status: status ?? undefined,
              pending: undefined, command: undefined, error: undefined,
            });
          } catch (e) {
            if (!signal.aborted) fail(e);
          }
        };

        /** Show the gnokey command; when the master is known (renewal, revocation, identity-only answer), watch the chain at once. */
        const desktop = (master?: string): void => {
          const p = get().pending;
          if (!p) return;
          // Check network chain before showing desktop or polling
          if (p.chainId !== d.network().chainId) {
            set({
              phase: 'error',
              error: `This request was started on ${p.chainId}. Switch back to that network to finish it, or cancel it.`,
            });
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
            try {
              const old = get().active;
              if (op === 'replace' && !old) throw new Error('no session to replace');
              const key = await createSessionKey(d.api(), d.secrets, d.randomHex, d.now);
              await unlockKey(d.api(), d.secrets, key); // so it can sign the proof
              const p: Pending = {
                op, state: d.randomHex(16), key, old: op === 'replace' ? old : undefined, grant,
                chainId: d.network().chainId, via: 'wallet', createdAt: d.now(),
              };
              await send(p, await linkFor(p));
            } catch (e) {
              fail(e);
            }
          },

          async revoke(): Promise<void> {
            try {
              const active = get().active;
              if (!active) throw new Error('no session to revoke');
              const p: Pending = {
                op: 'revoke', state: d.randomHex(16), key: active, chainId: active.chainId, via: 'wallet', createdAt: d.now(),
              };
              await send(p, await linkFor(p));
            } catch (e) {
              fail(e);
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
            // Wait for hydration in case reply arrives before state is restored
            while (!(api.persist as any).hasHydrated?.()) {
              await new Promise<void>((resolve) => setTimeout(resolve, 1));
            }

            const p = get().pending;
            if (!p || r.state !== p.state) return; // not ours: forged, stale or duplicated
            if (r.status === 'cancelled') {
              poll.aborted = true;
              set({ pending: undefined, command: undefined, phase: get().active ? 'active' : 'none' });
              return;
            }
            if (r.status === 'error') {
              if (r.code === 'unsupported_host') {
                desktop(); // a wallet without `disconnect`
                return;
              }
              set({ phase: 'error', error: r.code || 'the wallet reported an error' });
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

            // Handle active first (query + unlock, or clear if gone)
            const a = get().active;
            if (a) {
              try {
                // If on a different chain, keep active but don't query
                if (a.chainId !== d.network().chainId) {
                  await unlockKey(d.api(), d.secrets, a, a.master);
                  set({ status: undefined, phase: get().pending ? get().phase : 'active' });
                } else {
                  const st = await querySession(d.api(), a.master, a.address);
                  if (!st) {
                    set({ active: undefined, status: undefined, phase: get().pending ? get().phase : 'none' });
                  } else {
                    await unlockKey(d.api(), d.secrets, a, a.master);
                    set({ status: st, phase: get().pending ? get().phase : 'active' });
                  }
                }
              } catch (e) {
                fail(e);
              }
            }

            // Only then resume pending request
            if (p) {
              // Check network chain before resuming
              if (p.chainId !== d.network().chainId) {
                set({
                  phase: 'error',
                  error: `This request was started on ${p.chainId}. Switch back to that network to finish it, or cancel it.`,
                });
              } else if (master) {
                void waitForChain(p, master);
              } else {
                set({ phase: p.via === 'wallet' ? 'waiting-wallet' : 'desktop', command: commandFor(p) });
              }
            }
          },

          cancel(): void {
            poll.aborted = true;
            set({ pending: undefined, command: undefined, error: undefined, phase: get().active ? 'active' : 'none' });
          },
        };
      },
      {
        name: 'br.session',
        storage: createJSONStorage(() => d.storage),
        partialize: (s) => ({ active: s.active, pending: s.pending }),
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
};
