import { createBookStore, EMPTY_BOOK, mergeBook, type Book, type RoomEntry } from './rooms';
import { nodeCrypto } from './node-crypto';

const id = (n: number) => `room${String(n).padStart(16, '0')}`; // 20 characters
const room = (n: number, p: Partial<RoomEntry> = {}): RoomEntry => ({ id: id(n), name: `r${n}`, key: '', at: 1000 + n, ...p });
const book = (rooms: RoomEntry[], left: Record<string, number> = {}): Book => ({ rooms, left });

test('rooms are joined by id; the newer at gives the name; a key on either side is kept', () => {
  const local = book([room(1, { name: 'old', at: 5, key: '' }), room(2, { key: 'k2' })]);
  const got = mergeBook(local, { rooms: [room(1, { name: 'new', at: 9, key: 'k1' }), room(3)] });
  // newest first: r3 (1003), r2 (1002), r1 (9)
  expect(got.rooms).toEqual([room(3), room(2, { key: 'k2' }), room(1, { name: 'new', at: 9, key: 'k1' })]);
});

test('an older incoming entry changes nothing but a missing key', () => {
  const got = mergeBook(book([room(1, { name: 'mine', at: 9 })]), { rooms: [room(1, { name: 'theirs', at: 5, key: 'k' })] });
  expect(got.rooms).toEqual([room(1, { name: 'mine', at: 9, key: 'k' })]);
});

test('left keeps the latest of both sides; a room left after its at goes, one left at its at stays', () => {
  const got = mergeBook(book([room(1, { at: 10 }), room(2, { at: 10 })], { [id(1)]: 3 }), {
    rooms: [], left: { [id(1)]: 11, [id(2)]: 10, 'not a room': 99 },
  });
  expect(got.left).toEqual({ [id(1)]: 11, [id(2)]: 10 });
  expect(got.rooms.map((r) => r.id)).toEqual([id(2)]);
});

test('bad entries are dropped; a missing name is "private room"; names stop at 40; the irc mark stays', () => {
  const got = mergeBook(EMPTY_BOOK, {
    rooms: [null, 'x', { id: 'short' }, { id: id(1), at: 'soon' }, { id: id(2), name: 'n'.repeat(50), key: 7, at: 2, irc: true }],
  });
  expect(got.rooms).toEqual([
    { id: id(2), name: 'n'.repeat(40), key: '7', at: 2, irc: true },
    { id: id(1), name: 'private room', key: '', at: 0 },
  ]);
});

test('200 rooms with a key and 30 without are kept, the newest', () => {
  const keyed = Array.from({ length: 205 }, (_, i) => room(i, { key: 'k' }));
  const plain = Array.from({ length: 35 }, (_, i) => room(1000 + i));
  const got = mergeBook(EMPTY_BOOK, { rooms: [...keyed, ...plain] });
  expect(got.rooms.filter((r) => r.key)).toHaveLength(200);
  expect(got.rooms.filter((r) => !r.key)).toHaveLength(30);
  expect(got.rooms.some((r) => r.id === id(0))).toBe(false); // the oldest keyed one went
});

function stores() {
  const kv = new Map<string, string>();
  const secrets = new Map<string, string>();
  let scope = 'https://gno.world';
  const make = () => createBookStore({
    kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) },
    secrets: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void secrets.set(k, v) },
    crypto: nodeCrypto,
    scope: () => scope,
  });
  return { kv, secrets, make, setScope: (s: string) => (scope = s) };
}

test('the book comes back as saved, sealed (no key in clear), and per server', async () => {
  const s = stores();
  const b = s.make();
  await b.save(book([room(1, { key: 'secret-maker-key' })], { [id(9)]: 5 }));
  expect([...s.kv.values()].join()).not.toContain('secret-maker-key');
  expect(await b.load()).toEqual(book([room(1, { key: 'secret-maker-key' })], { [id(9)]: 5 }));
  s.setScope('http://127.0.0.1:8787');
  expect(await b.load()).toEqual(EMPTY_BOOK);
});

test('an unreadable book, or a lost lock key, is an empty book', async () => {
  const s = stores();
  const b = s.make();
  await b.save(book([room(1)]));
  const [where] = [...s.kv.keys()];
  s.kv.set(where, 'garbage');
  expect(await b.load()).toEqual(EMPTY_BOOK);
  await b.save(book([room(1)]));
  s.secrets.delete('br.rooms.lock');
  expect(await b.load()).toEqual(EMPTY_BOOK);
});

test('two first saves at once make one lock key', async () => {
  const s = stores();
  const b = s.make();
  await Promise.all([b.save(book([room(1)])), b.save(book([room(2)]))]);
  expect((await b.load()).rooms).toHaveLength(1); // the last save, readable with the one key
});
