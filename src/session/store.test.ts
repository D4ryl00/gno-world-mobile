import type { StateStorage } from 'zustand/middleware';

import { FakeChainApi } from '@/chain/fake-api';
import type { WalletReply } from '@/session/gnoconnect';
import { createSessionKey } from '@/session/keys';
import { createSessionStore, type Pending, type SessionDeps } from '@/session/store';
import { DEFAULT_GRANT, type ActiveSession } from '@/session/types';
import { bytesToHex, decodeAddress } from '@/utils/bech32';

const M = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
const OTHER = 'g1jyh59tr2t4yjmwajjax9mye369gkkujv7tegkk';

const reply = (over: Partial<WalletReply>): WalletReply => ({
  status: 'success', code: '', state: '', address: '', session: '', expiresAt: 0, allow: [], spend: '', period: 0,
  chainid: '', hash: '', revoked: '', ...over,
});
const settle = () => new Promise((r) => setTimeout(r, 20));

function setup(over: Partial<SessionDeps> = {}) {
  const api = new FakeChainApi();
  const mem = new Map<string, string>();
  const storage: StateStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  const secretsMap = new Map<string, string>();
  const opened: string[] = [];
  let t = 1790000000000;
  let net = { chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' };
  let randomCount = 0;
  const deps: SessionDeps = {
    api: () => api,
    secrets: { get: async (k) => secretsMap.get(k) ?? null, set: async (k, v) => void secretsMap.set(k, v) },
    storage,
    openURL: async (u) => void opened.push(u),
    randomHex: (n) => {
      randomCount++;
      return randomCount.toString().padStart(2 * n, '0'); // n bytes → 2n hex characters, as the real one
    },
    now: () => (t += 1000),
    network: () => net,
    pollIntervalMs: 1,
    previousWaitMs: 10,
    ...over,
  };
  const store = createSessionStore(deps);
  const onChain = (sessionAddr: string) =>
    api.sessions.set(`${bytesToHex(decodeAddress(M))}/${bytesToHex(decodeAddress(sessionAddr))}`, {
      expiresAt: 2000000000n, spendLimit: [{ denom: 'ugnot', amount: 5000000n }], spendPeriod: 3600n,
      spendUsed: [], spendReset: 0n, allowPaths: ['bank/send'],
    });
  /** create a session through the wallet and return its key */
  const activate = async () => {
    await store.getState().begin('create', DEFAULT_GRANT);
    const p = store.getState().pending!;
    onChain(p.key.address);
    await store.getState().onReply(reply({ state: p.state, address: M, session: p.key.address, chainid: 'gnoland-1' }));
    return p.key;
  };
  return { api, store, opened, onChain, activate, mem, deps, setNetwork: (c: string, r: string) => { net = { chainId: c, remote: r }; } };
}

test('create via gnokey-mobile: a signed connect with the key, reply accepted, session activated', async () => {
  const { api, store, opened, activate } = setup();
  const key = await activate();
  expect(opened[0]).toMatch(/^land\.gno\.gnokey:\/\/connect\?pubkey=gpub1/);
  expect(opened[0]).toMatch(/&sig=/);
  expect(opened[0]).not.toMatch(/[?&](old|signer)=/);
  expect(store.getState().phase).toBe('active');
  expect(store.getState().active).toMatchObject({ master: M, chainId: 'gnoland-1', address: key.address });
  expect(api.activated.get(key.keyName)!.master).toBe(bytesToHex(decodeAddress(M)));
});

test('a reply with a foreign state is ignored', async () => {
  const { store } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  await store.getState().onReply(reply({ state: 'forged', address: M }));
  expect(store.getState().phase).toBe('waiting-wallet');
  expect(store.getState().active).toBeUndefined();
});

test('an identity-only connect answer leads to the desktop command with the master already known', async () => {
  const { store, onChain } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  const p = store.getState().pending!;
  // today's gnokey-mobile: success, the identity, and its own delegated key (or nothing) as session
  await store.getState().onReply(reply({ state: p.state, address: M, session: OTHER }));
  expect(store.getState().active).toBeUndefined();
  expect(store.getState().phase).toBe('waiting-chain');
  expect(store.getState().pending).toMatchObject({ via: 'desktop', master: M });
  expect(store.getState().command).toMatch(/^gnokey maketx session create -pubkey gpub1/);
  onChain(p.key.address);
  await settle();
  expect(store.getState().phase).toBe('active');
  expect(store.getState().active!.address).toBe(p.key.address);
});

test('no wallet installed: falls back to the desktop command; master typed by the user', async () => {
  const { store, onChain } = setup({ openURL: async () => { throw new Error('no app'); } });
  await store.getState().begin('create', DEFAULT_GRANT);
  expect(store.getState().phase).toBe('desktop');
  expect(store.getState().command).toMatch(/^gnokey maketx session create -pubkey gpub1/);
  await expect(store.getState().submitMaster('nope')).rejects.toThrow(/g1/);
  onChain(store.getState().pending!.key.address);
  await store.getState().submitMaster(M);
  expect(store.getState().phase).toBe('active');
});

test('a pending request survives a restart and resumes', async () => {
  const { store, deps, onChain } = setup({ openURL: async () => { throw new Error('no app'); } });
  await store.getState().begin('create', DEFAULT_GRANT);
  const pending = store.getState().pending!;
  const again = createSessionStore(deps); // same storage = relaunch
  await again.persist.rehydrate();
  expect(again.getState().pending).toEqual(pending);
  expect(again.getState().phase).toBe('desktop');
  onChain(pending.key.address);
  await again.getState().submitMaster(M);
  expect(again.getState().phase).toBe('active');
});

test('renew via the wallet: one connect with the new key, old, signer and both proofs', async () => {
  const { store, opened, onChain, activate } = setup();
  const first = await activate();
  await store.getState().begin('replace', { ...DEFAULT_GRANT, spendPerPeriod: 1000000 });
  const p = store.getState().pending!;
  expect(opened[1]).toMatch(/^land\.gno\.gnokey:\/\/connect\?pubkey=gpub1/);
  expect(opened[1]).toContain(`old=${first.pubkey}`);
  expect(opened[1]).toContain(`signer=${M}`);
  expect(opened[1]).toMatch(/&sig=[^&]+&oldsig=[^&]+$/);
  onChain(p.key.address);
  await store.getState().onReply(reply({ state: p.state, address: M, session: p.key.address, revoked: first.address }));
  expect(store.getState().phase).toBe('active');
  expect(store.getState().active!.address).toBe(p.key.address);
});

test('revoke via the wallet is a disconnect; a wallet without it (unsupported_host) gets the desktop command', async () => {
  const { api, store, opened, activate } = setup();
  const key = await activate();
  await store.getState().revoke();
  expect(opened[1]).toMatch(new RegExp(`^land\\.gno\\.gnokey://disconnect\\?pubkey=${key.pubkey}&`));
  expect(opened[1]).toContain(`signer=${M}`);
  await store.getState().onReply(reply({ status: 'error', code: 'unsupported_host', state: store.getState().pending!.state }));
  expect(store.getState().command).toMatch(/^gnokey maketx session revoke -pubkey /);
  expect(store.getState().pending!.via).toBe('desktop');
  api.sessions.clear();
  await settle();
  expect(store.getState().phase).toBe('none');
  expect(store.getState().active).toBeUndefined();
});

test('replace and revoke through the desktop fallback', async () => {
  const { api, store, onChain } = setup({ openURL: async () => { throw new Error('no app'); } });
  await store.getState().begin('create', DEFAULT_GRANT);
  onChain(store.getState().pending!.key.address);
  await store.getState().submitMaster(M);
  const first = store.getState().active!;

  await store.getState().begin('replace', { ...DEFAULT_GRANT, spendPerPeriod: 1000000 });
  expect(store.getState().command).toMatch(/session create .* && gnokey maketx session revoke -pubkey /);
  const next = store.getState().pending!.key;
  onChain(next.address);
  await settle();
  expect(store.getState().active!.address).toBe(next.address);
  expect(store.getState().active!.address).not.toBe(first.address);

  await store.getState().revoke();
  expect(store.getState().command).toMatch(/session revoke -pubkey /);
  api.sessions.clear();
  await settle();
  expect(store.getState().phase).toBe('none');
  expect(store.getState().active).toBeUndefined();
});

test('restore re-unlocks the active key on launch, and forgets it when it is gone from chain', async () => {
  const { api, store, deps, onChain } = setup({ openURL: async () => { throw new Error('no app'); } });
  await store.getState().begin('create', DEFAULT_GRANT);
  const key = store.getState().pending!.key;
  onChain(key.address);
  await store.getState().submitMaster(M);
  api.activated.clear();
  const again = createSessionStore(deps);
  await again.persist.rehydrate();
  await again.getState().restore();
  expect(api.activated.get(key.keyName)?.master).toBe(bytesToHex(decodeAddress(M)));
  api.sessions.clear();
  await again.getState().restore();
  expect(again.getState().phase).toBe('none');
});

test('cancel drops the pending request', async () => {
  const { store } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  store.getState().cancel();
  expect(store.getState().pending).toBeUndefined();
  expect(store.getState().phase).toBe('none');
});

test('(a) cancel during identity-only polling: polling for A, cancel, put A on chain, wait → phase none, no active', async () => {
  const { store, onChain } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  const p = store.getState().pending!;
  // identity-only reply triggers polling
  await store.getState().onReply(reply({ state: p.state, address: M, session: OTHER }));
  expect(store.getState().phase).toBe('waiting-chain');
  // cancel the pending request
  store.getState().cancel();
  expect(store.getState().pending).toBeUndefined();
  // put the key on chain and wait for polling to query
  onChain(p.key.address);
  await settle();
  // should stay cancelled: no active session, phase remains none
  expect(store.getState().phase).toBe('none');
  expect(store.getState().active).toBeUndefined();
});

test('(b) new begin during identity-only polling: poll A, begin create B (ignored while A is pending, then after cancelling A), put A on chain, wait → pending.state is B, no active', async () => {
  const { store, onChain } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  const pA = store.getState().pending!;
  const keyA = pA.key.address;
  // identity-only reply triggers polling for A
  await store.getState().onReply(reply({ state: pA.state, address: M, session: OTHER }));
  expect(store.getState().phase).toBe('waiting-chain');
  // a begin while A is pending does nothing (a double tap); once A is cancelled, a new begin starts request B
  await store.getState().begin('create', DEFAULT_GRANT);
  expect(store.getState().pending!.state).toBe(pA.state);
  store.getState().cancel();
  await store.getState().begin('create', DEFAULT_GRANT);
  const pB = store.getState().pending!;
  expect(pB.state).not.toBe(pA.state);
  // put key A on chain (from old polling)
  onChain(keyA);
  await settle();
  // should not activate A: pending is still B, no active, phase depends on B's state
  expect(store.getState().pending!.state).toBe(pB.state);
  expect(store.getState().active).toBeUndefined();
});

test('(c) persisted replace whose new key is on chain and old key gone → active is new key, phase active', async () => {
  const { api, mem, deps, onChain } = setup();

  // Create session keys for old and new
  const oldKey = await createSessionKey(api, deps.secrets, deps.randomHex, deps.now);
  const newKey = await createSessionKey(api, deps.secrets, deps.randomHex, deps.now);

  // Setup: new key on chain, old key gone
  onChain(newKey.address);
  const oldActive: ActiveSession = { ...oldKey, master: M, chainId: 'gnoland-1' };
  const replacePending: Pending = {
    op: 'replace', key: newKey, old: oldActive, grant: DEFAULT_GRANT, master: M,
    chainId: 'gnoland-1', via: 'desktop', createdAt: deps.now(), state: 'replace-state-1',
  };

  // Write persisted state directly
  const persisted = { state: { active: oldActive, pending: replacePending }, version: 0 };
  mem.set('br.session', JSON.stringify(persisted));

  // Create store from persisted state and restore
  const store = createSessionStore(deps);
  await store.persist.rehydrate();
  await store.getState().restore();
  await settle();

  // Should have new key active, phase active
  expect(store.getState().active!.address).toBe(newKey.address);
  expect(store.getState().phase).toBe('active');
  expect(store.getState().pending).toBeUndefined();
});

test('(d) persisted revoke whose key is gone → phase none, no active', async () => {
  const { mem, deps } = setup();

  // Create session key for revoke
  const key = await createSessionKey(deps.api(), deps.secrets, deps.randomHex, deps.now);

  // Setup: key is absent (not on chain)
  const activeSession: ActiveSession = { ...key, master: M, chainId: 'gnoland-1' };
  const revokePending: Pending = {
    op: 'revoke', key: key, master: M, chainId: 'gnoland-1', via: 'wallet',
    createdAt: deps.now(), state: 'revoke-state-1',
  };

  // Write persisted state directly
  const persisted = { state: { active: activeSession, pending: revokePending }, version: 0 };
  mem.set('br.session', JSON.stringify(persisted));

  // Create store from persisted state and restore
  const store = createSessionStore(deps);
  await store.persist.rehydrate();
  await store.getState().restore();
  // Settle many times for polling to complete
  for (let i = 0; i < 50; i++) await settle();

  // Should have cleared everything, phase none
  expect(store.getState().phase).toBe('none');
  expect(store.getState().active).toBeUndefined();
  expect(store.getState().pending).toBeUndefined();
});

test('(e) persisted desktop create with pending.master set (killed while waiting on chain) → restore resumes polling without submitMaster', async () => {
  const { mem, deps, onChain } = setup();

  // Create session key for desktop create
  const key = await createSessionKey(deps.api(), deps.secrets, deps.randomHex, deps.now);

  // Setup: key not on chain yet, but master was already typed by user
  onChain(key.address); // put key on chain for this test
  const desktopPending: Pending = {
    op: 'create', key: key, grant: DEFAULT_GRANT, master: M, chainId: 'gnoland-1',
    via: 'desktop', createdAt: deps.now(), state: 'desktop-state-1',
  };

  // Write persisted state (no active, just pending with master set)
  const persisted = { state: { pending: desktopPending }, version: 0 };
  mem.set('br.session', JSON.stringify(persisted));

  // Create store from persisted state and restore
  const store = createSessionStore(deps);
  await store.persist.rehydrate();
  expect(store.getState().phase).toBe('desktop');
  // restore should start polling for the key
  await store.getState().restore();
  for (let i = 0; i < 20; i++) await settle();

  // Should be active now that key is on chain
  expect(store.getState().phase).toBe('active');
  expect(store.getState().active!.address).toBe(key.address);
});

test('(f) active session on gnoland-1, switch to dev, restore → active kept, no chain query', async () => {
  const { api, mem, deps, onChain, setNetwork } = setup();

  // Create session key
  const key = await createSessionKey(deps.api(), deps.secrets, deps.randomHex, deps.now);

  // Setup: active session on gnoland-1
  onChain(key.address);
  const activeSession: ActiveSession = { ...key, master: M, chainId: 'gnoland-1' };
  const persisted = { state: { active: activeSession }, version: 0 };
  mem.set('br.session', JSON.stringify(persisted));

  // Switch network to dev and clear sessions
  setNetwork('dev', 'http://127.0.0.1:26657');
  api.sessions.clear(); // any query would fail now

  // Create store from persisted state and restore on dev network
  const store = createSessionStore(deps);
  await store.persist.rehydrate();
  await store.getState().restore();

  // Active should be kept even on different chain
  expect(store.getState().active).toBeDefined();
  expect(store.getState().active!.chainId).toBe('gnoland-1');
  expect(store.getState().phase).toBe('active');
});

test('(g) pending desktop create on gnoland-1, switch to dev, restore → error with message, switch back → polling resumes', async () => {
  const { mem, deps, onChain, setNetwork } = setup();

  // Create session key for desktop create on gnoland-1
  const key = await createSessionKey(deps.api(), deps.secrets, deps.randomHex, deps.now);

  const desktopPending: Pending = {
    op: 'create', key: key, grant: DEFAULT_GRANT, master: M, chainId: 'gnoland-1',
    via: 'desktop', createdAt: deps.now(), state: 'desktop-state-g',
  };

  // Write persisted state (desktop create on gnoland-1, with master)
  const persisted = { state: { pending: desktopPending }, version: 0 };
  mem.set('br.session', JSON.stringify(persisted));

  // Create store and switch to dev
  const store = createSessionStore(deps);
  await store.persist.rehydrate();
  setNetwork('dev', 'http://127.0.0.1:26657');

  // restore on wrong network should error
  await store.getState().restore();
  expect(store.getState().phase).toBe('error');
  expect(store.getState().error).toBe('This request was started on gnoland-1. Switch back to that network to finish it, or cancel it.');
  expect(store.getState().pending).toBeDefined();

  // Switch back to gnoland-1 and put key on chain
  setNetwork('gnoland-1', 'https://rpc.gno.land:443');
  onChain(key.address);

  // restore again on correct network should resume polling
  await store.getState().restore();
  for (let i = 0; i < 20; i++) await settle();

  // Should now be active
  expect(store.getState().phase).toBe('active');
});

test('(h) wallet reply before hydration is waited for → session becomes active', async () => {
  const api = new FakeChainApi();
  const mem = new Map<string, string>();
  const storage: StateStorage = {
    getItem: async (k) => {
      await new Promise((r) => setTimeout(r, 5));
      return mem.get(k) ?? null;
    },
    setItem: (k, v) => void mem.set(k, v),
    removeItem: (k) => void mem.delete(k),
  };
  const secretsMap = new Map<string, string>();
  let t = 1790000000000;
  const deps: SessionDeps = {
    api: () => api,
    secrets: { get: async (k) => secretsMap.get(k) ?? null, set: async (k, v) => void secretsMap.set(k, v) },
    storage,
    openURL: async () => { throw new Error('no app'); },
    randomHex: (n) => 'cd'.repeat(n),
    now: () => (t += 1000),
    network: () => ({ chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' }),
    pollIntervalMs: 1,
  };

  // create store with pending state
  const store1 = createSessionStore(deps);
  await store1.getState().begin('create', DEFAULT_GRANT);
  const pending = store1.getState().pending!;
  const keyAddr = pending.key.address;
  // don't await rehydrate, just let it start

  // immediately create new store (simulating callback arriving before hydration)
  const store2 = createSessionStore(deps);
  api.sessions.set(`${bytesToHex(decodeAddress(M))}/${bytesToHex(decodeAddress(keyAddr))}`, {
    expiresAt: 2000000000n, spendLimit: [{ denom: 'ugnot', amount: 5000000n }], spendPeriod: 3600n,
    spendUsed: [], spendReset: 0n, allowPaths: ['bank/send'],
  });
  // immediately send reply (might arrive before hydration)
  await store2.getState().onReply(reply({ state: pending.state, address: M, session: keyAddr, chainid: 'gnoland-1' }));
  // let hydration and polling settle
  await settle();
  await settle();
  // should have picked up the session and activated it
  expect(store2.getState().phase).toBe('active');
  expect(store2.getState().active!.address).toBe(keyAddr);
});

/** A persisted active session on gnoland-1, made with the setup's secrets (so its password exists). */
async function persistedActive(s: ReturnType<typeof setup>) {
  const key = await createSessionKey(s.api, s.deps.secrets, s.deps.randomHex, s.deps.now);
  s.onChain(key.address);
  const active: ActiveSession = { ...key, master: M, chainId: 'gnoland-1' };
  s.mem.set('br.session', JSON.stringify({ state: { active }, version: 0 }));
  return active;
}

test('restore unlocks the key first: a transient query error keeps the session, without status or error phase', async () => {
  const s = setup();
  const active = await persistedActive(s);
  s.api.querySessionAccount = async () => { throw new Error('dial tcp: i/o timeout'); };
  const store = createSessionStore(s.deps);
  await store.persist.rehydrate();
  await store.getState().restore();
  expect(s.api.activated.get(active.keyName)?.master).toBe(bytesToHex(decodeAddress(M)));
  expect(s.api.activated.get(active.keyName)?.password).toBeDefined();
  expect(store.getState().phase).toBe('active');
  expect(store.getState().active).toEqual(active);
  expect(store.getState().status).toBeUndefined();
  expect(store.getState().error).toBeUndefined();
});

test('restore: a key this phone can no longer unlock is an error that keeps the session, and forget() drops it', async () => {
  const s = setup();
  const active = await persistedActive(s);
  // a backup restore: the secure store lost the keybase password
  const store = createSessionStore({ ...s.deps, secrets: { get: async () => null, set: async () => undefined } });
  await store.persist.rehydrate();
  await store.getState().restore();
  expect(store.getState().phase).toBe('error');
  expect(store.getState().error).toBe(
    'This phone can no longer use its session key. Forget it here, then get a new session.',
  );
  expect(store.getState().active).toEqual(active);

  store.getState().forget();
  expect(store.getState()).toMatchObject({
    phase: 'none', active: undefined, pending: undefined, status: undefined, command: undefined, error: undefined,
  });
});

test('forget() aborts a running poll and clears everything', async () => {
  const { store, onChain, activate } = setup();
  await activate();
  await store.getState().revoke();
  const p = store.getState().pending!;
  await store.getState().onReply(reply({ status: 'error', code: 'unsupported_host', state: p.state }));
  expect(store.getState().phase).toBe('waiting-chain');
  store.getState().forget();
  expect(store.getState()).toMatchObject({
    phase: 'none', active: undefined, pending: undefined, status: undefined, command: undefined, error: undefined,
  });
  onChain(p.key.address);
  await settle();
  expect(store.getState().phase).toBe('none');
});

test('a network switch during a revoke poll does not clear the session; networkChanged pauses and resumes the request', async () => {
  const s = setup();
  const { api, store, setNetwork, deps } = s;
  // sessions live on gnoland-1 only: on dev every key is absent
  const onGnoland = api.querySessionAccount.bind(api);
  api.querySessionAccount = async (m, k) => {
    if (deps.network().chainId !== 'gnoland-1') throw new Error('session not found');
    return onGnoland(m, k);
  };
  const key = await s.activate();
  await store.getState().revoke();
  const p = store.getState().pending!;
  void store.getState().onReply(reply({ state: p.state, address: M, chainid: 'gnoland-1' })); // resolves when the poll ends
  await settle();
  expect(store.getState().phase).toBe('waiting-chain');

  setNetwork('dev', 'http://127.0.0.1:26657');
  await settle();
  expect(store.getState().active?.address).toBe(key.address);
  expect(store.getState().pending?.state).toBe(p.state);

  await store.getState().networkChanged();
  expect(store.getState().phase).toBe('error');
  expect(store.getState().error).toBe('This request was started on gnoland-1. Switch back to that network to finish it, or cancel it.');
  expect(store.getState().active?.address).toBe(key.address);

  setNetwork('gnoland-1', 'https://rpc.gno.land:443');
  await store.getState().networkChanged();
  await settle();
  expect(store.getState().phase).toBe('waiting-chain');
  expect(store.getState().active?.address).toBe(key.address);
  api.sessions.clear(); // the revoke lands on gnoland-1
  await settle();
  expect(store.getState().phase).toBe('none');
  expect(store.getState().active).toBeUndefined();
  expect(store.getState().pending).toBeUndefined();
});

test('a session on another network does not block getting one for the current network; the new one replaces it', async () => {
  const { store, onChain, setNetwork, activate } = setup();
  await activate();
  setNetwork('dev', 'http://127.0.0.1:26657');
  await store.getState().networkChanged();
  await store.getState().begin('create', DEFAULT_GRANT);
  const p = store.getState().pending!;
  expect(p.chainId).toBe('dev');
  onChain(p.key.address);
  await store.getState().onReply(reply({ state: p.state, address: M, session: p.key.address, chainid: 'dev' }));
  expect(store.getState().phase).toBe('active');
  expect(store.getState().active).toMatchObject({ chainId: 'dev', address: p.key.address });
});

test('a double tap on "Get a session" creates one key and opens one link', async () => {
  const { api, store, opened } = setup();
  await Promise.all([store.getState().begin('create', DEFAULT_GRANT), store.getState().begin('create', DEFAULT_GRANT)]);
  expect(api.keys.size).toBe(1);
  expect(opened).toHaveLength(1);
});

test('a double tap on Revoke opens one link', async () => {
  const { store, opened, activate } = setup();
  await activate();
  await Promise.all([store.getState().revoke(), store.getState().revoke()]);
  expect(opened).toHaveLength(2); // the grant, then one revoke
});

test('pause() stops the running poll without dropping the request; restore() resumes it', async () => {
  const { store, onChain } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  const p = store.getState().pending!;
  await store.getState().onReply(reply({ state: p.state, address: M, session: OTHER }));
  expect(store.getState().phase).toBe('waiting-chain');
  store.getState().pause();
  onChain(p.key.address);
  await settle();
  expect(store.getState().active).toBeUndefined(); // the paused poll did not act
  expect(store.getState().pending?.state).toBe(p.state); // the request is kept
  await store.getState().restore();
  await settle();
  expect(store.getState().active?.address).toBe(p.key.address);
});

test('a wallet with no account (no_signer) leads to the desktop command, where the user gives the address', async () => {
  const { store } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  const p = store.getState().pending!;
  await store.getState().onReply(reply({ status: 'error', code: 'no_signer', state: p.state }));
  expect(store.getState().phase).toBe('desktop');
  expect(store.getState().pending).toMatchObject({ state: p.state, via: 'desktop' });
  expect(store.getState().command).toMatch(/^gnokey maketx session create -pubkey gpub1/);
});

test('a wallet error ends the request and returns to the form, keeping the code for an alert', async () => {
  const { store } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  const p = store.getState().pending!;
  await store.getState().onReply(reply({ status: 'error', code: 'network_declined', state: p.state }));
  expect(store.getState().phase).toBe('none');
  expect(store.getState().pending).toBeUndefined();
  expect(store.getState().error).toBeUndefined();
  expect(store.getState().walletError).toEqual({ code: 'network_declined', op: 'create' });
  // taken once: a second reader (React StrictMode re-running the effect, a second mounted screen) gets nothing
  expect(store.getState().takeWalletError()).toEqual({ code: 'network_declined', op: 'create' });
  expect(store.getState().takeWalletError()).toBeUndefined();
  expect(store.getState().walletError).toBeUndefined();
});

test('a wallet error on a revoke keeps the active session on screen', async () => {
  const { store, activate } = setup();
  await activate();
  await store.getState().revoke();
  const p = store.getState().pending!;
  await store.getState().onReply(reply({ status: 'error', code: 'signer_unavailable', state: p.state }));
  expect(store.getState().phase).toBe('active');
  expect(store.getState().active).toBeDefined();
  expect(store.getState().walletError).toEqual({ code: 'signer_unavailable', op: 'revoke' });
});

// --- P3-M1's deferred minors

test('(a) a cancelled, refused or failed request deletes its key; the active key is never deleted', async () => {
  const { api, store, activate } = setup();
  const active = await activate();
  await store.getState().begin('replace', DEFAULT_GRANT);
  const k1 = store.getState().pending!.key;
  store.getState().cancel();
  await settle();
  expect(api.deleted).toContain(k1.keyName);

  await store.getState().begin('replace', DEFAULT_GRANT);
  const p2 = store.getState().pending!;
  await store.getState().onReply(reply({ status: 'error', code: 'rejected', state: p2.state }));
  await settle();
  expect(api.deleted).toContain(p2.key.keyName);

  await store.getState().revoke(); // the pending key of a revoke is the active key
  store.getState().cancel();
  await settle();
  expect(api.deleted).not.toContain(active.keyName);
});

test('(a) a begin that fails after making its key deletes it', async () => {
  const { api, store } = setup();
  api.signBytes = async () => {
    throw new Error('signing failed');
  };
  await store.getState().begin('create', DEFAULT_GRANT);
  await settle();
  expect(store.getState().phase).toBe('error');
  expect(api.deleted).toHaveLength(1);
});

test('(b) an answer from another account or chain is an error, not an endless wait', async () => {
  const { store, activate } = setup();
  await activate();
  await store.getState().begin('replace', DEFAULT_GRANT);
  let p = store.getState().pending!;
  await store.getState().onReply(reply({ state: p.state, address: OTHER, session: p.key.address }));
  expect(store.getState().phase).toBe('error');
  expect(store.getState().error).toMatch(/another account/);

  store.getState().cancel();
  await store.getState().begin('replace', DEFAULT_GRANT);
  p = store.getState().pending!;
  await store.getState().onReply(reply({ state: p.state, address: M, session: p.key.address, chainid: 'dev' }));
  expect(store.getState().phase).toBe('error');
  expect(store.getState().error).toMatch(/dev/);
});

test('(c) cancel while begin is still preparing: nothing is opened, nothing is pending', async () => {
  const { store, opened, api } = setup();
  const started = store.getState().begin('create', DEFAULT_GRANT);
  store.getState().cancel();
  await started;
  await settle();
  expect(opened).toHaveLength(0);
  expect(store.getState().pending).toBeUndefined();
  expect(api.deleted).toHaveLength(1);
});

test('(c) a wallet that never comes back does not block a new request after cancel', async () => {
  const opened: string[] = [];
  const { store } = setup({ openURL: (u) => { opened.push(u); return new Promise<void>(() => undefined); } });
  void store.getState().begin('create', DEFAULT_GRANT);
  await settle();
  expect(opened).toHaveLength(1);
  store.getState().cancel();
  void store.getState().begin('create', DEFAULT_GRANT);
  await settle();
  expect(opened).toHaveLength(2);
});

test('(d) a request answered on the wrong network stops the poll already running for it', async () => {
  const { store, onChain, setNetwork } = setup({ openURL: async () => { throw new Error('no app'); } });
  await store.getState().begin('create', DEFAULT_GRANT);
  const p = store.getState().pending!;
  void store.getState().submitMaster(M); // polling on gnoland-1 (resolves only once the poll ends)
  await settle();
  setNetwork('dev', 'http://127.0.0.1:26657');
  await store.getState().submitMaster(M); // refused: another network
  expect(store.getState().phase).toBe('error');
  setNetwork('gnoland-1', 'https://rpc.gno.land:443');
  onChain(p.key.address);
  await settle();
  expect(store.getState().phase).toBe('error'); // the first poll did not wake up and activate behind the error
});

test('(e) restore does not resume a request cancelled while it was unlocking the active key', async () => {
  const s = setup();
  await persistedActive(s);
  const { store, api } = s;
  await store.persist.rehydrate();
  const pendingKey = await createSessionKey(api, s.deps.secrets, s.deps.randomHex, s.deps.now);
  store.setState({
    pending: { op: 'create', state: 'st', key: pendingKey, master: M, chainId: 'gnoland-1', via: 'desktop', createdAt: 1 },
  });
  const activateAccount = api.activateAccount.bind(api);
  api.activateAccount = async (...a) => {
    store.getState().cancel();
    return activateAccount(...a);
  };
  await store.getState().restore();
  s.onChain(pendingKey.address);
  await settle();
  expect(store.getState().pending).toBeUndefined();
  expect(store.getState().active!.address).not.toBe(pendingKey.address);
});

test('(f) a renewal that left the old session on chain says so; one that revoked it drops its key', async () => {
  const { api, store, activate, onChain } = setup();
  const first = await activate();
  await store.getState().begin('replace', DEFAULT_GRANT);
  const p = store.getState().pending!;
  onChain(p.key.address);
  await store.getState().onReply(reply({ state: p.state, address: M, session: p.key.address }));
  await settle();
  expect(store.getState().previous?.address).toBe(first.address);

  api.sessions.delete(`${bytesToHex(decodeAddress(M))}/${bytesToHex(decodeAddress(first.address))}`);
  expect(await store.getState().dismissPrevious()).toBe(true);
  expect(store.getState().previous).toBeUndefined();
  expect(api.deleted).toContain(first.keyName);
});

test('(g) a session storage that cannot be read still lets restore and replies run', async () => {
  const { store } = setup({
    storage: { getItem: () => { throw new Error('disk'); }, setItem: () => undefined, removeItem: () => undefined },
  });
  await settle();
  expect(store.ready.hasHydrated()).toBe(true);
  const r = await Promise.race([
    store.getState().onReply(reply({ state: 'x' })).then(() => 'done'),
    new Promise((res) => setTimeout(() => res('hung'), 200)),
  ]);
  expect(r).toBe('done');
});
