import { chatRow, CURRENT_KEY, createChatChannel } from '@/screens/channels/chat-channels';

const A = 'AAAAAAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBBBBBB';
const C = 'CCCCCCCCCCCCCCCCCCCC';
const book = { rooms: [{ id: B, name: 'mine', key: 'k', at: 9 }, { id: A, name: 'Dev chat', key: '', at: 5 }], left: {} };
const listed = [{ id: C, name: 'governance', here: 3, made: 1 }, { id: A, name: 'Dev chat', here: 2, made: 2 }];
const unread = (id: string) => ({ '': 1, [A]: 2, [C]: 7 })[id] ?? 0;

test('the row is Public, joined rooms, then listed ones not joined, with the separator', () => {
  const r = chatRow(book, listed, unread);
  expect(r.channels).toEqual([
    { id: '', name: 'Public', unread: 1 },
    { id: B, name: 'mine', keyed: true, unread: 0 },
    { id: A, name: 'Dev chat', keyed: false, unread: 2 },
    { id: C, name: 'governance' },
  ]);
  expect(r.separatorAfter).toBe(2);
});

test('no separator without listed rooms; listed null shows joined only', () => {
  expect(chatRow(book, [listed[1]], unread).separatorAfter).toBeUndefined();
  expect(chatRow(book, null, unread).channels.map((c) => c.id)).toEqual(['', B, A]);
  expect(chatRow({ rooms: [], left: {} }, listed, unread).separatorAfter).toBe(0);
});

test('current channel saved per server', async () => {
  const kv = new Map<string, string>();
  const scope = { v: 'S1' };
  const make = () => createChatChannel({ kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) }, scope: () => scope.v });
  const one = make();
  await one.ready;
  expect(one.getState().current).toBe('');
  one.getState().select(A);
  await new Promise((r) => setTimeout(r, 0));
  expect(kv.get(`${CURRENT_KEY}:S1`)).toBe(A);
  const two = make();
  await two.ready;
  expect(two.getState().current).toBe(A);
  scope.v = 'S2';
  await two.getState().reload();
  expect(two.getState().current).toBe('');
  kv.set(`${CURRENT_KEY}:S2`, 'junk');
  await two.getState().reload();
  expect(two.getState().current).toBe('');
});

test('a channel picked while the saved one is still being read stays picked', async () => {
  let answer: (v: string | null) => void = () => undefined;
  const store = createChatChannel({
    kv: { getItem: () => new Promise((r) => (answer = r)), setItem: async () => undefined },
    scope: () => 'S',
  });
  store.getState().select(B);
  answer(A);
  await store.ready;
  expect(store.getState().current).toBe(B);
});
