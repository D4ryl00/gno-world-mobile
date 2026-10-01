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
  const deps: SessionDeps = {
    api: () => api,
    secrets: { get: async (k) => secretsMap.get(k) ?? null, set: async (k, v) => void secretsMap.set(k, v) },
    storage,
    openURL: async (u) => void opened.push(u),
    randomHex: (n) => 'cd'.repeat(n),
    now: () => (t += 1000),
    network: () => ({ chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' }),
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
  return { api, store, opened, onChain, activate, mem, deps };
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
