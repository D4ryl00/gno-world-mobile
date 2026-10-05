import { findCreated, validatePoolForm } from '@/screens/create-pool/form';

const ok = { name: 'gg', window: '12h', base: '1', seed: '0.5' };

test('a valid form', () => {
  expect(validatePoolForm(ok)).toEqual({ form: { name: 'gg', window: 43200, basePrice: 1000000, seed: 500000 } });
});

test('realm bounds are checked before signing', () => {
  expect(validatePoolForm({ ...ok, name: '' }).error).toMatch(/name/);
  expect(validatePoolForm({ ...ok, name: 'x'.repeat(41) }).error).toMatch(/1-40/);
  expect(validatePoolForm({ ...ok, window: '5s' }).error).toMatch(/10s and 30d/);
  expect(validatePoolForm({ ...ok, base: '0.0001' }).error).toMatch(/0.001/);
  expect(validatePoolForm({ ...ok, window: 'soon' }).error).toMatch(/90m/);
});

test('the edges of each bound', () => {
  expect(validatePoolForm({ ...ok, seed: '0.0000001' }).error).toMatch(/6 decimals/);
  expect(validatePoolForm({ ...ok, name: 'a\u0007b' }).error).toMatch(/control/);
  expect(validatePoolForm({ ...ok, name: 'x'.repeat(40) }).form).toBeDefined();
  expect(validatePoolForm({ ...ok, window: '30d' }).form?.window).toBe(2592000);
  expect(validatePoolForm({ ...ok, window: '31d' }).error).toMatch(/10s and 30d/);
  expect(validatePoolForm({ ...ok, base: '1000000' }).form?.basePrice).toBe(1_000_000_000_000);
  expect(validatePoolForm({ ...ok, base: '1000000.000001' }).error).toMatch(/1,000,000/);
});

test('the pool just created is the newest one of that creator and name', () => {
  const p = (id: number, creator: string, name: string, version = 6) => ({ key: `v${version}-${id}`, id, creator, name, version });
  const pools = [p(3, 'g1me', 'gg'), p(9, 'g1me', 'gg'), p(12, 'g1you', 'gg'), p(11, 'g1me', 'other'), p(20, 'g1me', 'gg', 5)];
  expect(findCreated(pools as never, 'g1me', 'gg')).toBe('v6-9');
  expect(findCreated(pools as never, 'g1me', 'none')).toBeUndefined();
});
