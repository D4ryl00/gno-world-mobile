import { execSync } from 'node:child_process';

import { GameClient } from '../src/chain/game-client';
import { REALMS, SESSION_ALLOW_PATHS } from '../src/chain/realms';
import { createCommand, replaceCommand, revokeCommand } from '../src/session/fallback';
import { buildSessionLink, canonicalPayload, signLink } from '../src/session/gnoconnect';
import { createSessionKey, unlockKey, type SecretStore } from '../src/session/keys';
import { pollSession, querySession, remaining } from '../src/session/status';
import type { ActiveSession } from '../src/session/types';
import { decodeAddress } from '../src/utils/bech32';

import { nodeChainApi } from './node-chain-api';

const MASTER = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5'; // test1
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set — run through npm run e2e`);
  return v;
};
const ctx = {
  chainId: 'dev', remote: env('E2E_RPC'), keyName: 'test1',
  extraFlags: ['-home', env('E2E_HOME'), '-insecure-password-stdin'],
};
const desktop = (cmd: string) =>
  cmd.split(' && ').forEach((c) => execSync(`printf '\\n' | ${c.replace(/^gnokey /, `${env('E2E_GNOKEY')} `)}`, { stdio: 'pipe' }));

const mem = new Map<string, string>();
const secrets: SecretStore = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v) };
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
const grant = { spendPerPeriod: 5_000_000, period: 3600, expires: 30 * 86400 };
const fast = { intervalMs: 500, signal: { aborted: false } };

const api = nodeChainApi(env('E2E_GOSERVER'));
const game = new GameClient(api, () => 'dev');
let session: ActiveSession;

beforeAll(async () => {
  await api.setRemote(env('E2E_RPC'));
  await api.setChainID('dev');
});

test('the session key signs a proof of possession', async () => {
  const key = await createSessionKey(api, secrets, hex, () => Date.now());
  await unlockKey(api, secrets, key);
  const link = buildSessionLink({ host: 'connect', pubkey: key.pubkey, allow: SESSION_ALLOW_PATHS, grant, chainid: 'dev', callback: 'bubblerumble://session-callback', state: 's', iat: 1 });
  const signed = await signLink(link, async (d) => (await api.signBytes(decodeAddress(key.address), d)).signature);
  expect(canonicalPayload(signed)).toBe(canonicalPayload(link));
  expect(signed).toMatch(/&sig=[A-Za-z0-9_-]{86}$/); // 64 bytes
});

test('desktop fallback: create the session, then play with it', async () => {
  const key = await createSessionKey(api, secrets, hex, () => Date.now());
  desktop(createCommand(key, grant, SESSION_ALLOW_PATHS, ctx));
  const st = await pollSession(api, MASTER, key.address, 'present', fast);
  expect(st?.spendLimit).toBe(5_000_000);
  expect(st?.allowPaths).toEqual(SESSION_ALLOW_PATHS);
  await unlockKey(api, secrets, key, MASTER);
  session = { ...key, master: MASTER, chainId: 'dev' };

  await game.createPool(session, { name: 'e2e', window: 600, basePrice: 1_000_000, life: 0, seed: 0 });
  const pools = (await game.realm(5)).pools;
  const mine = pools.find((p) => p.name === 'e2e' && p.creator === MASTER)!;
  expect(mine).toBeDefined();

  await game.bid(session, mine, { ref: '', flag: 'FR', boost: 1, shot: 0 });
  const after = await game.pool(5, mine.id);
  expect(after.bids).toBe(1);
  expect(after.lastBidder).toBe(MASTER); // the realm sees the identity, not the session key
  expect(after.flag).toBe('FR');

  const used = await querySession(api, MASTER, key.address);
  expect(remaining(used!, Math.floor(Date.now() / 1000))).toBeLessThan(5_000_000 - 1_000_000);
});

test('the budget is enforced by the chain and classified', async () => {
  const p = (await game.realm(5)).pools.find((x) => x.name === 'e2e')!;
  await expect(game.bid(session, p, { ref: '', flag: '', boost: 10, shot: 0 })).rejects.toMatchObject({ kind: 'budget' });
});

test('replace via the desktop fallback, then revoke', async () => {
  const next = await createSessionKey(api, secrets, hex, () => Date.now());
  desktop(replaceCommand(next, { ...grant, spendPerPeriod: 2_000_000 }, SESSION_ALLOW_PATHS, session.pubkey, ctx));
  expect((await pollSession(api, MASTER, next.address, 'present', fast))?.spendLimit).toBe(2_000_000);
  await pollSession(api, MASTER, session.address, 'absent', fast);

  desktop(revokeCommand(next.pubkey, ctx));
  expect(await pollSession(api, MASTER, next.address, 'absent', fast)).toBeNull();
});

test('reading other versions does not need a session', async () => {
  await expect(api.render(REALMS[5], 'teams')).resolves.toBeDefined();
});
