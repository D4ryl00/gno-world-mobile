import { FakeChainApi } from '@/chain/fake-api';
import { createSessionKey, keybasePassword, unlockKey, type SecretStore } from '@/session/keys';

const memStore = (): SecretStore => {
  const m = new Map<string, string>();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => void m.set(k, v) };
};
const hex = (n: number) => 'ab'.repeat(n);

test('the keybase password is created once', async () => {
  const s = memStore();
  const a = await keybasePassword(s, hex);
  expect(a).toHaveLength(64);
  expect(await keybasePassword(s, () => 'other')).toBe(a);
});

test('createSessionKey makes a named key and returns bech32 strings', async () => {
  const api = new FakeChainApi();
  const k = await createSessionKey(api, memStore(), hex, () => 1790000000000);
  expect(k.keyName).toBe('br-session-1790000000000');
  expect(k.address).toMatch(/^g1[a-z0-9]{38}$/);
  expect(k.pubkey).toMatch(/^gpub1/);
});

test('unlockKey activates as a session of the master and sets the password', async () => {
  const api = new FakeChainApi();
  const store = memStore();
  const k = await createSessionKey(api, store, hex, () => 1);
  await unlockKey(api, store, k, 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5');
  const a = api.activated.get(k.keyName)!;
  expect(a.master).toHaveLength(40);
  expect(a.password).toBe(await keybasePassword(store, hex));
  await unlockKey(api, store, k);
  expect(api.activated.get(k.keyName)!.master).toBeUndefined();
});
