import { activeCard, errorActions, grantFromInput, initialGrant, worstCase } from '@/screens/session/grant';
import { KEY_LOST_ERROR } from '@/session/store';

test('grant input', () => {
  expect(grantFromInput('5', '30')).toEqual({ grant: { spendPerPeriod: 5000000, period: 3600, expires: 2592000 } });
  expect(grantFromInput('0', '30').error).toMatch(/budget/);
  expect(grantFromInput('5', '0').error).toMatch(/days/);
  expect(grantFromInput('5', '1461').error).toMatch(/1460/);
  expect(grantFromInput('x', '30').error).toBeTruthy();
});

test('which active card to show', () => {
  expect(activeCard('gnoland-1', 'gnoland-1', true)).toBe('live');
  expect(activeCard('gnoland-1', 'gnoland-1', false)).toBe('unreadable');
  expect(activeCard('dev', 'gnoland-1', true)).toBe('other-chain');
  expect(activeCard('dev', 'gnoland-1', false)).toBe('other-chain');
});

test('the error card offers to forget a session key this phone can no longer use', () => {
  expect(errorActions(KEY_LOST_ERROR, true).forget).toBe(true);
  expect(errorActions(KEY_LOST_ERROR, false).forget).toBe(false);
  expect(errorActions('rejected', true)).toEqual({ forget: false, retry: false, back: true });
  expect(errorActions(undefined, true)).toEqual({ forget: false, retry: false, back: true });
  // a key this phone cannot unlock: no Back to a session that cannot sign
  expect(errorActions(KEY_LOST_ERROR, true)).toEqual({ forget: true, retry: true, back: false });
});

test('the error card offers a retry for a request started on another network', () => {
  const err = 'This request was started on gnoland-1. Switch back to that network to finish it, or cancel it.';
  expect(errorActions(err, false)).toEqual({ forget: false, retry: true, back: true });
  expect(errorActions(KEY_LOST_ERROR, true)).toEqual({ forget: true, retry: true, back: false });
});

test('days are whole digits: no exponent, no decimals', () => {
  expect(grantFromInput('5', '1e1').error).toMatch(/whole number/);
  expect(grantFromInput('5', '1.5').error).toMatch(/whole number/);
  expect(grantFromInput('5', ' 7 ').grant?.expires).toBe(7 * 86400);
  expect(grantFromInput('5', '1460').grant?.expires).toBe(1460 * 86400);
  expect(grantFromInput('1.5', '1').grant?.spendPerPeriod).toBe(1_500_000);
});

test('worstCase is the budget of every hour of the lifetime', () => {
  expect(worstCase({ spendPerPeriod: 5_000_000, period: 3600, expires: 30 * 86400 })).toBe(3_600_000_000);
});

test('a renewal starts from the current grant: its hourly budget and the days it has left', () => {
  const st = { expiresAt: 1000 + 10 * 86400 + 5, spendLimit: 2_000_000, spendUsed: 0, spendReset: 0, spendPeriod: 3600, allowPaths: [] };
  expect(initialGrant(st, 1000)).toEqual({ spendPerPeriod: 2_000_000, period: 3600, expires: 11 * 86400 });
  expect(initialGrant({ ...st, expiresAt: 0 }, 1000)).toEqual({ spendPerPeriod: 2_000_000, period: 3600, expires: 30 * 86400 });
  expect(initialGrant(undefined, 1000)).toBeUndefined();
});
