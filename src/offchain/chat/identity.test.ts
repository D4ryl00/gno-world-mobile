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

test('with a scope, the reserved name, its key and the avatar belong to one server; the free name to all', async () => {
  const s = memory();
  let server = 'https://gno.world';
  const ids = createIdentityStore(s, () => server);
  await ids.save({ name: 'ann', nameKey: 'k', reservedName: 'ann', av: 'a1', avkey: 'ak' });
  server = 'http://127.0.0.1:8787';
  expect(await ids.load()).toEqual({ ...NO_IDENTITY, name: 'ann' });
  server = 'https://gno.world';
  expect(await ids.load()).toEqual({ name: 'ann', nameKey: 'k', reservedName: 'ann', av: 'a1', avkey: 'ak' });
  // SecureStore takes only letters, digits, ".", "-" and "_" in a key
  for (const k of s.m.keys()) expect(k).toMatch(/^[A-Za-z0-9._-]+$/);
});

test('a save lands under the server it was made for, even if the server changes during the writes', async () => {
  const m = new Map<string, string>();
  let scope = 'http://a';
  const ids = createIdentityStore({ get: async (k) => m.get(k) ?? null, set: async (k, v) => void (await Promise.resolve(), m.set(k, v)) }, () => scope);
  const saving = ids.save({ reservedName: 'remi', nameKey: 'k' });
  scope = 'http://b';
  await saving;
  expect([...m.keys()].every((k) => k.endsWith('.http_3a_2f_2fa'))).toBe(true);
});
