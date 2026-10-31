import { createHomeChannels, HOME_KEY } from '@/screens/channels/home-channels';

const A = 'AAAAAAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBBBBBB';
const PUBLIC = { id: '', name: 'Public' };

function make(kv = new Map<string, string>(), scope = { v: 'S1' }) {
  const store = createHomeChannels({
    kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) },
    scope: () => scope.v,
  });
  return { store, kv, scope };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test('default is Public only', async () => {
  const { store } = make();
  await store.ready;
  expect(store.getState()).toMatchObject({ tabs: [PUBLIC], current: '' });
});

test('add appends and selects, no duplicates', async () => {
  const { store } = make();
  await store.ready;
  store.getState().add({ id: A, name: 'Dev chat' });
  store.getState().add({ id: B, name: 'gnomes' });
  store.getState().add({ id: A, name: 'Dev chat' });
  expect(store.getState().tabs).toEqual([PUBLIC, { id: A, name: 'Dev chat' }, { id: B, name: 'gnomes' }]);
  expect(store.getState().current).toBe(A);
  store.getState().select(B);
  expect(store.getState().current).toBe(B);
});

test('Public cannot be removed; removing the current one falls back to Public', async () => {
  const { store } = make();
  await store.ready;
  store.getState().add({ id: A, name: 'Dev chat' });
  store.getState().remove('');
  expect(store.getState().tabs[0]).toEqual(PUBLIC);
  store.getState().remove(A);
  expect(store.getState()).toMatchObject({ tabs: [PUBLIC], current: '' });
});

test('saved per server and read back', async () => {
  const { store, kv, scope } = make();
  await store.ready;
  store.getState().add({ id: A, name: 'Dev chat' });
  await flush();
  expect(JSON.parse(kv.get(`${HOME_KEY}:S1`)!)).toEqual({ tabs: [PUBLIC, { id: A, name: 'Dev chat' }], current: A });
  const again = make(kv);
  await again.store.ready;
  expect(again.store.getState().current).toBe(A);
  scope.v = 'S2';
  await store.getState().reload();
  expect(store.getState()).toMatchObject({ tabs: [PUBLIC], current: '' });
});

test('a damaged record is the default', async () => {
  const kv = new Map([[`${HOME_KEY}:S1`, '{"tabs":[{"id":"bad","name":3}],"current":"zz"']]);
  const { store } = make(kv);
  await store.ready;
  expect(store.getState()).toMatchObject({ tabs: [PUBLIC], current: '' });
  const kv2 = new Map([[`${HOME_KEY}:S1`, JSON.stringify({ tabs: [{ id: 'bad', name: 'x' }, { id: A, name: 'ok' }], current: 'bad' })]]);
  const two = make(kv2);
  await two.store.ready;
  expect(two.store.getState()).toMatchObject({ tabs: [PUBLIC, { id: A, name: 'ok' }], current: '' });
});

test('prune(null) keeps everything; prune(set) drops tabs not in it and falls back', async () => {
  const { store } = make();
  await store.ready;
  store.getState().add({ id: A, name: 'a' });
  store.getState().add({ id: B, name: 'b' });
  store.getState().prune(null);
  expect(store.getState().tabs).toHaveLength(3);
  store.getState().prune(new Set([A]));
  expect(store.getState()).toMatchObject({ tabs: [PUBLIC, { id: A, name: 'a' }], current: '' });
});
