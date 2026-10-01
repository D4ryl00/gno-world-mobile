import { bidArgs, caps, parsePoolKey, poolKey, REALMS, SESSION_ALLOW_PATHS } from '@/chain/realms';

test('realm paths and allow entries', () => {
  expect(REALMS[5]).toBe('gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble5');
  expect(REALMS[1]).toBe('gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble');
  expect(SESSION_ALLOW_PATHS).toHaveLength(7);
  expect(SESSION_ALLOW_PATHS).toContain('vm/exec:gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble');
});

test('pool keys', () => {
  expect(poolKey(5, 12)).toBe('v5-12');
  expect(parsePoolKey('v4-3')).toEqual({ version: 4, id: 3 });
  expect(parsePoolKey('v6-3')).toBeNull();
  expect(parsePoolKey('3')).toBeNull();
});

test('Bid arguments per version', () => {
  expect(bidArgs(5, 2, 'g1ref', 'FR', 100000)).toEqual(['2', 'g1ref', 'FR', '100000']);
  expect(bidArgs(3, 2, '', '', 0)).toEqual(['2', '', '', '0']);
  expect(bidArgs(2, 2, 'g1ref', 'FR', 0)).toEqual(['2', 'g1ref', 'FR']);
  expect(bidArgs(1, 6, 'g1ref', 'FR', 0)).toEqual(['6']);
});

test('capabilities', () => {
  expect(caps(5)).toEqual({ shots: true, withdraw: true, me: true, flags: true, poolJson: true });
  expect(caps(3).shots).toBe(false);
  expect(caps(2)).toEqual({ shots: false, withdraw: false, me: true, flags: true, poolJson: false });
  expect(caps(1).me).toBe(false);
});
