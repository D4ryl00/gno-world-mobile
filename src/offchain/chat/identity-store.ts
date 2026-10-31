import { createStore, type StoreApi } from 'zustand/vanilla';

import { OffchainError } from '@/offchain/http';
import { buildChallengeLink, CALLBACK_URL, type WalletReply } from '@/session/gnoconnect';

import type { ChatClient } from './client';
import { NO_IDENTITY, type ChatIdentity, type IdentityStore } from './identity';
import { proofFromReply } from './name-proof';
import type { KV } from './store';

/** The name, reservation and picture the chat writes under: one for every room of a server. */
export interface IdentityState {
  identity: ChatIdentity;
  /** the last refused name or picture action, for the sheet */
  identityError: string;
  /** the server wants the wallet's signature and this build has no wallet to ask */
  walletSoon: boolean;
  /** a reservation waiting for the wallet's proof */
  proving: { state: string; name: string; identity: string; chainId: string } | null;
  setName(name: string): Promise<void>;
  /** reserves the field's name for the identity (the session's master); false also while the wallet signs */
  reserveName(identity: string): Promise<boolean>;
  /** the wallet's answer to the chat's challenge: false when the reply is not the chat's */
  onProofReply(r: WalletReply): Promise<boolean>;
  /** stops waiting for the wallet (the sheet's Cancel) */
  cancelProving(): void;
  releaseName(): Promise<boolean>;
  setAvatar(body: Blob | Uint8Array, contentType: string): Promise<boolean>;
  clearIdentityError(): void;
  /** reads the identity store again: a name that came in by /pair */
  reloadIdentity(): Promise<void>;
  /** another server: what is shown goes, this server's identity is read */
  restart(): void;
}

export interface IdentityDeps {
  client: ChatClient;
  identity: IdentityStore;
  kv: KV;
  /** the server: each keeps its own proof being waited for */
  scope?: () => string;
  /** the wallet, for a name the server wants proven: opens a GnoConnect link */
  wallet?: { open(url: string): Promise<void>; randomHex(n: number): string; network(): { chainId: string; remote: string } };
}

/** The proof the chat waits for: kept, since the OS may evict the app during the minutes at the computer. */
export const PROVING_KEY = 'br.chat.proving';

/** The name lines go out under. */
export const displayName = (i: ChatIdentity) => i.reservedName || i.name || 'anon';

/** The server's own words when it refused (or ours, for a reply we refused); a plain sentence when it did not answer. */
const say = (e: unknown) =>
  e instanceof OffchainError
    ? e.status !== 0 ? e.message : 'The chat server did not answer — try again.'
    : e instanceof Error ? e.message : 'The chat server did not answer — try again.';

/** The wallet's refusal of a challenge, in words for the sheet. */
const walletRefusal = (code: string) =>
  code === 'signer_unavailable'
    // the wallet answers it when its computer failed and when it does not hold the pinned identity
    ? 'The wallet could not sign as this identity: its computer could not sign (run gnokey-pair with a gnokey that has sign-data), or the wallet does not hold this identity.'
    : code === 'network_declined'
      ? 'The wallet is on another network than the app.'
      : `The wallet refused (${code || 'no reason given'}).`;

/** The stored proof being waited for; null for anything else (none, or unreadable). */
const parseProving = (raw: string | null): IdentityState['proving'] => {
  try {
    const p: unknown = raw ? JSON.parse(raw) : null;
    if (!p || typeof p !== 'object') return null;
    const { state, name, identity, chainId } = p as Record<string, unknown>;
    return [state, name, identity, chainId].every((v) => typeof v === 'string' && v)
      ? { state, name, identity, chainId } as NonNullable<IdentityState['proving']>
      : null;
  } catch {
    return null;
  }
};

export function createIdentityState(d: IdentityDeps): StoreApi<IdentityState> & { ready: Promise<void> } {
  const provingKey = () => (d.scope ? `${PROVING_KEY}:${d.scope()}` : PROVING_KEY);
  // bumped by restart(): an identity read before is another server's
  let epoch = 0;

  const store = createStore<IdentityState>()((set, get) => {
    const act = async (f: () => Promise<void>): Promise<boolean> => {
      try {
        await f();
        set({ identityError: '' });
        return true;
      } catch (e) {
        set({ identityError: say(e) });
        return false;
      }
    };

    const setProving = (proving: IdentityState['proving']) => {
      set({ proving });
      void d.kv.setItem(provingKey(), proving ? JSON.stringify(proving) : '').catch(() => undefined);
    };

    return {
      identity: NO_IDENTITY,
      identityError: '',
      walletSoon: false,
      proving: null,
      setName: async (n) => {
        if (get().identity.reservedName) return; // a reserved name is released first
        set({ identity: await d.identity.save({ name: n.trim() }) });
      },
      reserveName: async (identity) => {
        const n = get().identity.name.trim();
        set({ walletSoon: false });
        try {
          const r = await d.client.reserveName(n, identity);
          set({ identity: await d.identity.save({ name: r.name, reservedName: r.name, nameKey: r.key }), identityError: '' });
          setProving(null);
          return true;
        } catch (e) {
          // as the site: a 409 asks for the wallet's signature, whatever it says
          if (!(e instanceof OffchainError && e.status === 409)) {
            set({ identityError: say(e) });
            return false;
          }
          if (!d.wallet) {
            set({ walletSoon: true, identityError: '' });
            return false;
          }
        }
        const wallet = d.wallet;
        const launched = await act(async () => {
          const challenge = await d.client.nameChallenge();
          const state = wallet.randomHex(16);
          const { chainId, remote } = wallet.network();
          setProving({ state, name: n, identity, chainId });
          await wallet.open(buildChallengeLink({ challenge, signer: identity, chainid: chainId, rpc: remote, callback: CALLBACK_URL, state }));
        });
        if (!launched) setProving(null); // no wallet opened: nothing to wait for
        return false;
      },
      onProofReply: async (r) => {
        await ready; // a relaunched app reads what it waits for first
        const p = get().proving;
        if (!p || r.state !== p.state) return false;
        setProving(null);
        if (r.status === 'cancelled') return true;
        if (r.status === 'error') {
          set({ identityError: walletRefusal(r.code) });
          return true;
        }
        await act(async () => {
          const got = await d.client.proveName(p.name, proofFromReply(r, p.identity, p.chainId));
          set({ identity: await d.identity.save({ name: got.name, reservedName: got.name, nameKey: got.key }) });
        });
        return true;
      },
      cancelProving: () => setProving(null),
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
      clearIdentityError: () => set({ identityError: '', walletSoon: false }),
      reloadIdentity: async () => {
        const e = epoch;
        try {
          const identity = await d.identity.load();
          if (e === epoch) set({ identity });
        } catch {
          // an unreadable store keeps what the chat shows
        }
      },
      restart: () => {
        epoch++;
        // the reserved name and the avatar are per server: read what this one issued
        set({ identity: NO_IDENTITY, identityError: '', walletSoon: false });
        void get().reloadIdentity();
      },
    };
  });

  const ready = Promise.all([
    d.identity.load().then(
      (identity) => store.setState({ identity }),
      () => undefined,
    ),
    d.kv.getItem(provingKey()).then(
      (raw) => {
        const proving = parseProving(raw);
        if (proving && !store.getState().proving) store.setState({ proving });
      },
      () => undefined,
    ),
  ]).then(() => undefined);
  return Object.assign(store, { ready });
}
