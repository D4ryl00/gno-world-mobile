import { readFileSync } from 'fs';
import { join } from 'path';

import { parsePool, parseRealm } from '@/chain/parse';
import { BOOSTS, gasFor } from '@/game/pricing';
import { boopQuote, checkFresh } from '@/screens/pool/boop-quote';

const fx = (n: string) => readFileSync(join(__dirname, '../../chain/__fixtures__', n), 'utf8');
const pool = parsePool(fx('v5-pool.json'), 5);
const realm = parseRealm(fx('v5-realm.json'), 5);

test('the total is the boop, the shot and the fee', () => {
  const q = boopQuote({ pool, realm, me: '', hasRef: false, boostIdx: 3, shotBps: 0 });
  expect(q.bid).toBe(pool.nextPrice * BOOSTS[3]);
  expect(q.shot).toBe(0);
  expect(q.gas).toEqual(gasFor('Bid', pool));
  expect(q.total).toBe(q.bid + q.gas.fee);
});

test('a shot adds its price when shots are on, nothing when they are paused', () => {
  const on = { ...realm, shotsOn: true, commitsFree: 5, keeperSeen: realm.now, split: { ...realm.split, liveFloor: 0 } };
  const q = boopQuote({ pool: { ...pool, liveBps: 10000 }, realm: on, me: '', hasRef: false, boostIdx: 0, shotBps: 100 });
  expect(q.pause).toBe('');
  expect(q.shot).toBeGreaterThan(0);
  expect(q.total).toBe(q.bid + q.shot + q.gas.fee);
  const off = boopQuote({ pool, realm: { ...on, shotsOn: false }, me: '', hasRef: false, boostIdx: 0, shotBps: 100 });
  expect(off.pause).toBe('shots are off');
  expect(off.shot).toBe(0);
});

test('a v4+ pool whose realm is not read yet says so instead of "not sold"', () => {
  expect(boopQuote({ pool, realm: undefined, me: '', hasRef: false, boostIdx: 0, shotBps: 100 })).toMatchObject({
    pause: 'loading shot prices…', shot: 0,
  });
});

test('before v4 there are no shots at all', () => {
  const v3 = { ...pool, version: 3 as const };
  expect(boopQuote({ pool: v3, realm, me: '', hasRef: false, boostIdx: 0, shotBps: 100 })).toMatchObject({ shot: 0 });
});

test('checkFresh: same price and still open is fine; anything else is said, with the new price', () => {
  expect(checkFresh(pool, { ...pool, pot: pool.pot + 1 })).toBeNull();
  expect(checkFresh(pool, { ...pool, nextPrice: pool.nextPrice + 1000000 })).toMatch(/now costs .* GNOT \(it was .* GNOT\)/);
  expect(checkFresh(pool, { ...pool, over: true })).toMatch(/closed/);
  expect(checkFresh(pool, { ...pool, cancelled: true })).toMatch(/cancelled/);
});
