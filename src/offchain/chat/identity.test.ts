import { createIdentityStore, NO_IDENTITY } from '@/offchain/chat/identity';

const memory = () => {
  const m = new Map<string, string>();
  return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v) };
};

test('an empty store is no identity', async () => {
  expect(await createIdentityStore(memory()).load()).toEqual(NO_IDENTITY);
});

test('saved fields come back, under the documented keys', async () => {
  const s = memory();
  const ids = createIdentityStore(s);
  expect(await ids.save({ name: 'ann', nameKey: 'k', reservedName: 'ann' })).toMatchObject({ name: 'ann', nameKey: 'k' });
  await ids.save({ av: 'a1', avkey: 'ak' });
  expect(await createIdentityStore(s).load()).toEqual({ name: 'ann', nameKey: 'k', reservedName: 'ann', av: 'a1', avkey: 'ak' });
  expect([...s.m.keys()].sort()).toEqual(['br.chat.av', 'br.chat.avkey', 'br.chat.name', 'br.chat.namekey', 'br.chat.reserved']);
});

test('clearing a field stores an empty string', async () => {
  const s = memory();
  const ids = createIdentityStore(s);
  await ids.save({ nameKey: 'k', reservedName: 'ann' });
  expect(await ids.save({ nameKey: '', reservedName: '' })).toMatchObject({ nameKey: '', reservedName: '' });
});
