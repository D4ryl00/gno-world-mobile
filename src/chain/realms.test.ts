import { bidArgs, caps, CURRENT_VERSION, parsePoolKey, poolKey, REALMS, SESSION_ALLOW_PATHS, VERSIONS } from '@/chain/realms';

test('realm paths and allow entries', () => {
  expect(REALMS[5]).toBe('gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble5');
  expect(REALMS[1]).toBe('gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble');
  expect(REALMS[6]).toBe('gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6');
  expect(SESSION_ALLOW_PATHS).toHaveLength(8);
  expect(SESSION_ALLOW_PATHS).toContain('vm/exec:gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6');
  expect(SESSION_ALLOW_PATHS).toContain('vm/exec:gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble');
});

test('v6 is the current realm, the others are listed newest first', () => {
  expect(CURRENT_VERSION).toBe(6);
  expect(VERSIONS).toEqual([6, 5, 4, 3, 2, 1]);
});

test('pool keys', () => {
  expect(poolKey(5, 12)).toBe('v5-12');
  expect(parsePoolKey('v4-3')).toEqual({ version: 4, id: 3 });
  expect(parsePoolKey('v6-3')).toEqual({ version: 6, id: 3 });
  expect(parsePoolKey('v7-3')).toBeNull();
  expect(parsePoolKey('3')).toBeNull();
});

test('Bid arguments per version', () => {
  expect(bidArgs(6, 2, 'g1ref', 'FR', 100000)).toEqual(['2', 'g1ref', 'FR', '100000']);
  expect(bidArgs(5, 2, 'g1ref', 'FR', 100000)).toEqual(['2', 'g1ref', 'FR', '100000']);
  expect(bidArgs(3, 2, '', '', 0)).toEqual(['2', '', '', '0']);
  expect(bidArgs(2, 2, 'g1ref', 'FR', 0)).toEqual(['2', 'g1ref', 'FR']);
  expect(bidArgs(1, 6, 'g1ref', 'FR', 0)).toEqual(['6']);
});

test('capabilities', () => {
  expect(caps(6)).toEqual({ shots: true, withdraw: true, me: true, flags: true, poolJson: true });
  expect(caps(5)).toEqual({ shots: true, withdraw: true, me: true, flags: true, poolJson: true });
  expect(caps(3).shots).toBe(false);
  expect(caps(2)).toEqual({ shots: false, withdraw: false, me: true, flags: true, poolJson: false });
  expect(caps(1).me).toBe(false);
});
