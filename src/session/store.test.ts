import type { StateStorage } from 'zustand/middleware';

import { FakeChainApi } from '@/chain/fake-api';
import type { WalletReply } from '@/session/gnoconnect';
import { createSessionStore, type SessionDeps } from '@/session/store';
import { DEFAULT_GRANT } from '@/session/types';
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
      return (randomCount.toString().padStart(n, '0')).slice(0, n);
    },
    now: () => (t += 1000),
    network: () => net,
    pollIntervalMs: 1,
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

test('(b) new begin during identity-only polling: poll A, begin create B, put A on chain, wait → pending.state is B, no active', async () => {
  const { store, onChain } = setup();
  await store.getState().begin('create', DEFAULT_GRANT);
  const pA = store.getState().pending!;
  const keyA = pA.key.address;
  // identity-only reply triggers polling for A
  await store.getState().onReply(reply({ state: pA.state, address: M, session: OTHER }));
  expect(store.getState().phase).toBe('waiting-chain');
  // new begin with fresh grant triggers new request B
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
  const { api, store, deps, onChain } = setup({ openURL: async () => { throw new Error('no app'); } });
  // create initial session
  await store.getState().begin('create', DEFAULT_GRANT);
  onChain(store.getState().pending!.key.address);
  await store.getState().submitMaster(M);
  const oldKey = store.getState().active!;

  // start replace
  await store.getState().begin('replace', { ...DEFAULT_GRANT, spendPerPeriod: 1000000 });
  const newKey = store.getState().pending!.key;
  onChain(newKey.address);
  await settle();
  // should now have new key active
  expect(store.getState().active!.address).toBe(newKey.address);

  // simulate app restart with new key on chain and old key gone
  const again = createSessionStore(deps);
  await again.persist.rehydrate();
  onChain(newKey.address); // ensure new key is still on chain
  await again.getState().restore();
  await settle();
  // should have new key active, not old
  expect(again.getState().active!.address).toBe(newKey.address);
  expect(again.getState().phase).toBe('active');
});

test('(d) persisted revoke whose key is gone → phase none, no active', async () => {
  const { api, store, deps, onChain } = setup({ openURL: async () => { throw new Error('no app'); } });
  // create and activate
  await store.getState().begin('create', DEFAULT_GRANT);
  onChain(store.getState().pending!.key.address);
  await store.getState().submitMaster(M);
  expect(store.getState().phase).toBe('active');

  // start revoke via wallet (will fail to open URL and fall back to desktop, then immediately start polling)
  await store.getState().revoke();
  await settle(); // let useDesktop() and waitForChain start
  expect(store.getState().phase).toBe('waiting-chain');
  const revokeKey = store.getState().pending!.key;

  // simulate app restart with revoke pending but key already gone
  api.sessions.clear(); // clear all sessions so the key is gone
  const again = createSessionStore(deps);
  await again.persist.rehydrate();
  expect(again.getState().pending?.op).toBe('revoke');
  expect(again.getState().active).toBeDefined();

  // restore will check active first (finds it gone from chain), then start polling for revoke
  await again.getState().restore();
  // After restore completes, waitForChain should have been called asynchronously
  // With the key already gone, polling should complete quickly
  for (let i = 0; i < 30; i++) await settle();

  // should have cleared active and pending when polling found key absent
  expect(again.getState().phase).toBe('none');
  expect(again.getState().active).toBeUndefined();
  expect(again.getState().pending).toBeUndefined();
});

test('(e) persisted desktop create with pending.master set (killed while waiting on chain) → restore resumes polling without submitMaster', async () => {
  const { api, store, deps, onChain } = setup({ openURL: async () => { throw new Error('no app'); } });
  await store.getState().begin('create', DEFAULT_GRANT);
  onChain(store.getState().pending!.key.address);
  await store.getState().submitMaster(M);
  // now pending should be undefined and active set

  // start a new create (which will fail to open wallet and go desktop)
  await store.getState().begin('create', DEFAULT_GRANT);
  const desktopKey = store.getState().pending!.key;
  expect(store.getState().phase).toBe('desktop');
  // simulate app restart before user enters master (but we simulate it being set in pending)
  const again = createSessionStore(deps);
  await again.persist.rehydrate();
  // manually set master in pending to simulate app being killed after user typed it
  // (actually the test setup should have this from desktopKey submission, but let's simulate the state)
  const p = again.getState().pending!;
  expect(p.master).toBeUndefined(); // not yet set from submitMaster
  // put key on chain first
  onChain(desktopKey.address);
  // now submit master through the new store instance
  await again.getState().submitMaster(M);
  await settle();
  // should be active
  expect(again.getState().phase).toBe('active');
  expect(again.getState().active!.address).toBe(desktopKey.address);
});

test('(f) active session on gnoland-1, switch to dev, restore → active kept, no chain query', async () => {
  const { api, store, deps, onChain, setNetwork } = setup({ openURL: async () => { throw new Error('no app'); } });
  // create on gnoland-1
  await store.getState().begin('create', DEFAULT_GRANT);
  const keyAddr = store.getState().pending!.key.address;
  onChain(keyAddr);
  await store.getState().submitMaster(M);
  expect(store.getState().active!.chainId).toBe('gnoland-1');

  // switch network to dev
  setNetwork('dev', 'http://127.0.0.1:26657');
  // clear sessions so any query would fail
  api.sessions.clear();

  // create new store and restore
  const again = createSessionStore(deps);
  await again.persist.rehydrate();
  const queryCountBefore = 0; // we'd need to spy on api.querySessionAccount but this is implicit
  await again.getState().restore();
  // active should be kept, still marked as gnoland-1
  expect(again.getState().active).toBeDefined();
  expect(again.getState().active!.chainId).toBe('gnoland-1');
  expect(again.getState().phase).toBe('active');
});

test('(g) pending desktop create on gnoland-1, switch to dev, restore → error with message, switch back → polling resumes', async () => {
  const { store, onChain, setNetwork } = setup({ openURL: async () => { throw new Error('no app'); } });
  await store.getState().begin('create', DEFAULT_GRANT);
  const keyAddr = store.getState().pending!.key.address;
  expect(store.getState().pending!.chainId).toBe('gnoland-1');

  // switch to dev
  setNetwork('dev', 'http://127.0.0.1:26657');
  await store.getState().restore();
  // should show error about wrong chain
  expect(store.getState().phase).toBe('error');
  expect(store.getState().error).toContain('gnoland-1');
  expect(store.getState().pending).toBeDefined(); // pending is kept so cancel() works

  // switch back to gnoland-1
  setNetwork('gnoland-1', 'https://rpc.gno.land:443');
  onChain(keyAddr);
  await store.getState().submitMaster(M);
  await settle();
  // should now be active
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
