import { grantFromInput } from '@/screens/session/grant';

test('grant input', () => {
  expect(grantFromInput('5', '30')).toEqual({ grant: { spendPerPeriod: 5000000, period: 3600, expires: 2592000 } });
  expect(grantFromInput('0', '30').error).toMatch(/budget/);
  expect(grantFromInput('5', '0').error).toMatch(/days/);
  expect(grantFromInput('5', '1461').error).toMatch(/1460/);
  expect(grantFromInput('x', '30').error).toBeTruthy();
});

import { activeCard } from '@/screens/session/grant';

test('which active card to show', () => {
  expect(activeCard('gnoland-1', 'gnoland-1', true)).toBe('live');
  expect(activeCard('gnoland-1', 'gnoland-1', false)).toBe('unreadable');
  expect(activeCard('dev', 'gnoland-1', true)).toBe('other-chain');
  expect(activeCard('dev', 'gnoland-1', false)).toBe('other-chain');
});

import { errorActions } from '@/screens/session/grant';
import { KEY_LOST_ERROR } from '@/session/store';

test('the error card offers to forget a session key this phone can no longer use', () => {
  expect(errorActions(KEY_LOST_ERROR, true)).toEqual({ forget: true });
  expect(errorActions(KEY_LOST_ERROR, false)).toEqual({ forget: false });
  expect(errorActions('rejected', true)).toEqual({ forget: false });
  expect(errorActions(undefined, true)).toEqual({ forget: false });
});
