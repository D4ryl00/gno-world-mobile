import { readFileSync } from 'fs';
import { join } from 'path';

import { parseJSONLoose, parseMe, parsePool, parseRealm, parseTeams } from '@/chain/parse';

const fx = (n: string) => readFileSync(join(__dirname, '__fixtures__', n), 'utf8');

test('parseJSONLoose accepts Go strconv.Quote escapes', () => {
  expect(parseJSONLoose('"a\\x80b"')).toBe('a\u0080b');
  expect(parseJSONLoose('"\\U0001F600"')).toBe('😀');
  expect(parseJSONLoose('"\\\\x80"')).toBe('\\x80'); // an escaped backslash stays one
  expect(parseJSONLoose('"a\\vb\\ac"')).toBe('a\u000bb\u0007c');
  expect(parseJSONLoose('"\\\\v"')).toBe('\\v');
});

test('parseRealm v5', () => {
  const r = parseRealm(fx('v5-realm.json'), 5);
  expect(r.version).toBe(5);
  expect(r.now).toBe(1790860635);
  expect(r.shotsOn).toBe(true);
  expect(r.commitsFree).toBe(58);
  expect(r.split.minShot).toBe(100000);
  expect(r.pools).toHaveLength(3);
  const [p1, p2, p99] = r.pools;
  expect(p1).toMatchObject({ key: 'v5-1', name: 'first light', over: true, paid: true, nextPrice: 707107 });
  expect(p2).toMatchObject({ key: 'v5-2', bids: 22, liveBps: 8475, teams: { US: 10730502, DK: 2345208 } });
  expect(p2.history).toEqual([]);
  expect(p99.name).toContain('bad');
});

test('parsePool v5 detail', () => {
  const p = parsePool(fx('v5-pool.json'), 5);
  expect(p.history[0]).toEqual({
    n: 22, bidder: 'g1r9mekllcz0fqdt0w2lstckw9exxtvzpqy5hazp', flag: 'DK',
    price: 2345208, shot: 0, clock: 43200, pot: 74109299, at: 1790840331,
  });
  expect(p.roster[0].earned).toBe(4489534);
  expect(p.shotlog[0]).toMatchObject({ n: 3, bps: 99, resolved: true, hit: false });
});

test('parseRealm v1 fills what older versions lack', () => {
  const p = parseRealm(fx('v1-realm.json'), 1).pools[0];
  expect(p.key).toBe('v1-6');
  expect(p.life).toBe(0);
  expect(p.liveBps).toBe(10000);
  expect(p.deadline).toBe(0); // no bid yet
  expect(p.teams).toEqual({});
});

test('parseMe and parseTeams', () => {
  expect(parseMe(fx('v5-me.json'))).toMatchObject({ owed: 323186, flag: 'GB', referrer: 'g1c3wqq0ldvh5qt4tznwdyn0jzpzx26gfmc3l34s' });
  expect(parseTeams(fx('v5-teams.json')).US).toEqual({ paid: 64479008, won: 421848014, players: 7 });
});

test('garbage is a clear error', () => {
  expect(() => parseRealm('not json', 5)).toThrow(/realm v5/);
});

test('parseJSONLoose refuses an escape that is no code point', () => {
  expect(() => parseJSONLoose('"\\U00110000"')).toThrow(/not a Unicode code point/);
  expect(() => parseRealm('{"pools":[{"id":1,"name":"\\U00110000"}]}', 5)).toThrow(/unreadable answer/);
});

test('parseJSONLoose leaves malformed escapes to JSON, which refuses them', () => {
  expect(() => parseJSONLoose('"\\x4"')).toThrow(SyntaxError);
  expect(() => parseJSONLoose('"abc\\')).toThrow(SyntaxError);
});

test('one malformed pool does not poison the realm', () => {
  const r = parseRealm('{"now":1,"pools":["oops",{"id":7,"name":"ok"},{"name":"no id"}]}', 5);
  expect(r.pools.map((p) => p.key)).toEqual(['v5-7']);
});
