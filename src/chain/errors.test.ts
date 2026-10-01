import { classifyError } from '@/chain/errors';

// Messages observed on gnodev (gno 83e0a40ea) in the session tests.
test.each([
  ['session spend limit would be exceeded: attempted=4900000ugnot, used=101000ugnot, limit=5000000ugnot', 'budget'],
  ['session has no spend limit (attempted 100000ugnot)', 'budget'],
  ['session expired: expires_at=1790853601, block_time=1790853612', 'expired'],
  ['unknown session', 'unknown-session'],
  ['msg vm/exec (path "gno.land/r/x") not permitted by session AllowPaths [vm/exec:gno.land/r/y]', 'not-allowed'],
  ['insufficient funds error', 'funds'],
  ['insufficient coins', 'funds'],
  ['unable to connect: ECONNREFUSED 127.0.0.1:26657', 'network'],
])('%s → %s', (msg, kind) => {
  expect(classifyError(new Error(msg)).kind).toBe(kind);
});

test('realm panics keep their human text', () => {
  const e = classifyError(new Error('... VM call panic: send at least 2397916ugnot for the bid, got 1000ugnot\n stack...'));
  expect(e.kind).toBe('realm');
  expect(e.message).toBe('send at least 2397916ugnot for the bid, got 1000ugnot');
  expect(classifyError(new Error('panic: pool is closed')).message).toBe('pool is closed');
});

test('anything else is "other" with the first line', () => {
  const e = classifyError(new Error('weird failure\nwith details'));
  expect(e.kind).toBe('other');
  expect(e.message).toBe('weird failure');
});
