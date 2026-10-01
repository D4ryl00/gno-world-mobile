import { validatePoolForm } from '@/screens/create-pool/form';

const ok = { name: 'gg', window: '12h', base: '1', life: '', seed: '0.5' };

test('a valid form', () => {
  expect(validatePoolForm(ok)).toEqual({ form: { name: 'gg', window: 43200, basePrice: 1000000, life: 0, seed: 500000 } });
  expect(validatePoolForm({ ...ok, life: '3d' }).form?.life).toBe(259200);
});

test('realm bounds are checked before signing', () => {
  expect(validatePoolForm({ ...ok, name: '' }).error).toMatch(/name/);
  expect(validatePoolForm({ ...ok, name: 'x'.repeat(41) }).error).toMatch(/1-40/);
  expect(validatePoolForm({ ...ok, window: '5s' }).error).toMatch(/10s and 30d/);
  expect(validatePoolForm({ ...ok, base: '0.0001' }).error).toMatch(/0.001/);
  expect(validatePoolForm({ ...ok, life: '30m' }).error).toMatch(/1h and 30d/);
  expect(validatePoolForm({ ...ok, window: '2d', life: '1d' }).error).toMatch(/at least the window/);
  expect(validatePoolForm({ ...ok, window: 'soon' }).error).toMatch(/90m/);
});
