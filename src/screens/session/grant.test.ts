import { grantFromInput } from '@/screens/session/grant';

test('grant input', () => {
  expect(grantFromInput('5', '30')).toEqual({ grant: { spendPerPeriod: 5000000, period: 3600, expires: 2592000 } });
  expect(grantFromInput('0', '30').error).toMatch(/budget/);
  expect(grantFromInput('5', '0').error).toMatch(/days/);
  expect(grantFromInput('5', '1461').error).toMatch(/1460/);
  expect(grantFromInput('x', '30').error).toBeTruthy();
});
