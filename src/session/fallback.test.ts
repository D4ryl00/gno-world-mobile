import { createCommand, expiresArg, replaceCommand, revokeCommand } from '@/session/fallback';

const key = { keyName: 'k', address: 'g1s', pubkey: 'gpub1new' };
const grant = { spendPerPeriod: 5000000, period: 3600, expires: 2592000 };
const ctx = { chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' };

test('expiresArg', () => {
  expect(expiresArg(2592000)).toBe('30d');
  expect(expiresArg(90)).toBe('90s');
});

test('create command', () => {
  expect(createCommand(key, grant, ['vm/exec:gno.land/r/a', 'vm/exec:gno.land/r/b'], ctx)).toBe(
    'gnokey maketx session create -pubkey gpub1new -expires-at 30d ' +
      '-allow-paths vm/exec:gno.land/r/a -allow-paths vm/exec:gno.land/r/b ' +
      '-spend-limit 5000000ugnot -spend-period 3600 ' +
      '-gas-fee 1000000ugnot -gas-wanted 2000000 -broadcast -chainid gnoland-1 -remote https://rpc.gno.land:443 YOUR_KEY',
  );
});

test('revoke, replace (create first, then revoke) and extra flags', () => {
  expect(revokeCommand('gpub1old', { ...ctx, keyName: 'test1', extraFlags: ['-home', '/tmp/h'] })).toBe(
    'gnokey maketx session revoke -pubkey gpub1old -gas-fee 1000000ugnot -gas-wanted 2000000 -broadcast ' +
      '-chainid gnoland-1 -remote https://rpc.gno.land:443 -home /tmp/h test1',
  );
  const r = replaceCommand(key, grant, ['bank/send'], 'gpub1old', ctx);
  expect(r.indexOf('session create')).toBeLessThan(r.indexOf('session revoke'));
  expect(r).toContain(' && ');
});

test('shell metacharacters are quoted', () => {
  expect(revokeCommand('gpub1x', { ...ctx, keyName: "my key's" })).toMatch(/'my key'\\''s'$/);
});
