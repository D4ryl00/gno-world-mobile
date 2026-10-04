import { readFileSync } from 'fs';
import { join } from 'path';

import { FakeChainApi } from '@/chain/fake-api';
import { GameClient } from '@/chain/game-client';
import { parsePool } from '@/chain/parse';
import { REALMS } from '@/chain/realms';
import type { ActiveSession } from '@/session/types';

const fx = (n: string) => readFileSync(join(__dirname, '__fixtures__', n), 'utf8');
const session: ActiveSession = {
  keyName: 'br-session-1', address: 'g1jyh59tr2t4yjmwajjax9mye369gkkujv7tegkk',
  pubkey: 'gpub1x', master: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5', chainId: 'gnoland-1',
};

test('allPools merges every version and survives one failing realm', async () => {
  const api = new FakeChainApi();
  api.renders.set(`${REALMS[5]}:json`, fx('v5-realm.json'));
  api.renders.set(`${REALMS[1]}:json`, fx('v1-realm.json'));
  const g = new GameClient(api, () => 'gnoland-1');
  const r = await g.allPools();
  expect(r.pools.map((p) => p.key)).toEqual(['v5-1', 'v5-2', 'v5-99', 'v1-6']);
  expect(r.failed.sort()).toEqual([2, 3, 4]);
});

test('bid sends price × boost + shot with the right args, gas and signer', async () => {
  const api = new FakeChainApi();
  const g = new GameClient(api, () => 'gnoland-1');
  const pool = parsePool(fx('v5-pool.json'), 5);
  const res = await g.bid(session, pool, { ref: 'g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr', flag: 'FR', boost: 2, shot: 100000 });
  expect(res).toEqual({ hash: 'abcd', height: 7 });
  const c = api.calls[0];
  expect(c.pkg).toBe(REALMS[5]);
  expect(c.fnc).toBe('Bid');
  expect(c.args).toEqual(['2', 'g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr', 'FR', '100000']);
  expect(c.send).toEqual([{ denom: 'ugnot', amount: BigInt(2397916 * 2 + 100000) }]);
  expect(c.gasFee).toBe('39600ugnot');
  expect(c.gasWanted).toBe(39600000n);
  expect(c.signerHex).toHaveLength(40);
});

test('a session from another chain is refused before anything is signed', async () => {
  const api = new FakeChainApi();
  const g = new GameClient(api, () => 'dev');
  const pool = parsePool(fx('v5-pool.json'), 5);
  await expect(g.claim(session, pool)).rejects.toMatchObject({
    kind: 'wrong-chain',
    message: 'Your session is for gnoland-1. Switch back to it in Settings, or get a session for dev from the Session tab.',
  });
  expect(api.calls).toHaveLength(0);
});

test('chain errors are classified', async () => {
  const api = new FakeChainApi();
  api.failNextCall = new Error('session expired: expires_at=1, block_time=2');
  const g = new GameClient(api, () => 'gnoland-1');
  await expect(g.withdraw(session, 5)).rejects.toMatchObject({ kind: 'expired' });
});

test('withdraw is refused on versions without Withdraw', async () => {
  const g = new GameClient(new FakeChainApi(), () => 'gnoland-1');
  await expect(g.withdraw(session, 2)).rejects.toThrow(/no Withdraw/);
});

test('createPool sends the seed and the arguments in realm order', async () => {
  const api = new FakeChainApi();
  await new GameClient(api, () => 'gnoland-1').createPool(session, { name: 'x', window: 600, basePrice: 1000, life: 0, seed: 5000 });
  expect(api.calls[0]).toMatchObject({ pkg: REALMS[5], fnc: 'CreatePool', args: ['x', '600', '1000', '0'] });
  expect(api.calls[0].send).toEqual([{ denom: 'ugnot', amount: 5000n }]);
});

test('every transaction refuses a session from another chain', async () => {
  const api = new FakeChainApi();
  const g = new GameClient(api, () => 'dev');
  const pool = parsePool(fx('v5-pool.json'), 5);
  await expect(g.bid(session, pool, { ref: '', flag: '', boost: 1, shot: 0 })).rejects.toMatchObject({ kind: 'wrong-chain' });
  await expect(g.createPool(session, { name: 'x', window: 600, basePrice: 1000, life: 0, seed: 0 })).rejects.toMatchObject({ kind: 'wrong-chain' });
  await expect(g.withdraw(session, 5)).rejects.toMatchObject({ kind: 'wrong-chain' });
  expect(api.calls).toHaveLength(0);
});

test('a pool a v1 realm does not list is a classified error', async () => {
  const api = new FakeChainApi();
  api.renders.set(`${REALMS[1]}:json`, '{"now":1,"pools":[]}');
  await expect(new GameClient(api, () => 'gnoland-1').pool(1, 9)).rejects.toMatchObject({ name: 'ChainError', kind: 'other' });
});

test('a transaction whose stream ends without a result has an unknown outcome', async () => {
  const api = new FakeChainApi();
  api.emptyNextCall = true;
  await expect(new GameClient(api, () => 'gnoland-1').withdraw(session, 5)).rejects.toMatchObject({ kind: 'unknown-outcome' });
});
