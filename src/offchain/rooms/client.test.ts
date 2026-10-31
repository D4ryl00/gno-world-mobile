import { NO_IDENTITY } from '@/offchain/chat/identity';
import { OffchainError, type Offchain, type RequestOptions } from '@/offchain/http';
import { createRoomsClient } from '@/offchain/rooms/client';

const ID = 'AAAAAAAAAAAAAAAAAAAA';
const ID2 = 'BBBBBBBBBBBBBBBBBBBB';

function fakeOffchain(answer: unknown = {}, fail?: OffchainError) {
  const calls: { verb: string; path: string; body?: unknown; o?: RequestOptions }[] = [];
  const done = (c: (typeof calls)[number]) => {
    calls.push(c);
    return fail ? Promise.reject(fail) : Promise.resolve(answer as never);
  };
  const oc: Offchain = {
    get: (path, o) => done({ verb: 'GET', path, o }),
    post: (path, body, o) => done({ verb: 'POST', path, body, o }),
    patch: (path, body, o) => done({ verb: 'PATCH', path, body, o }),
    del: (path, o) => done({ verb: 'DELETE', path, o }),
    exchange: async () => {
      throw new Error('not used');
    },
  };
  return { oc, calls };
}
const me = async () => ({ ...NO_IDENTITY, name: 'ann', reservedName: 'Ann', nameKey: 'nk' });

test('make posts the name and whether it is listed, with the name key', async () => {
  const { oc, calls } = fakeOffchain({ id: ID, name: 'gnomes', key: 'k1' });
  expect(await createRoomsClient(oc, me).make('gnomes', true)).toEqual({ id: ID, name: 'gnomes', key: 'k1' });
  expect(calls[0]).toMatchObject({ verb: 'POST', path: '/api/room', body: { name: 'gnomes', public: true }, o: { headers: { 'X-Name-Key': 'nk' } } });
});

test('make without an id in the answer fails', async () => {
  const { oc } = fakeOffchain({ error: 'slow down' });
  await expect(createRoomsClient(oc, me).make('x', false)).rejects.toThrow();
});

test('info reads the room; a 404 is gone', async () => {
  const { oc, calls } = fakeOffchain({ id: ID, name: 'gnomes', public: true, here: 3, made: 100 });
  expect(await createRoomsClient(oc, me).info(ID)).toEqual({ id: ID, name: 'gnomes', listed: true, here: 3, made: 100 });
  expect(calls[0].path).toBe(`/api/room?id=${ID}`);
  const gone = fakeOffchain({}, new OffchainError(404, 'no such room'));
  expect(await createRoomsClient(gone.oc, me).info(ID)).toBe('gone');
  const down = fakeOffchain({}, new OffchainError(0, 'timed out'));
  await expect(createRoomsClient(down.oc, me).info(ID)).rejects.toThrow('timed out');
});

test('listPublic drops malformed entries and sorts by made, then id', async () => {
  const { oc, calls } = fakeOffchain({
    rooms: [
      { id: ID2, name: 'b', here: 1, made: 5 }, { id: 'bad', name: 'x' }, { id: ID, name: 'a', here: 0, made: 5 },
      { id: 'CCCCCCCCCCCCCCCCCCCC', name: 'c', here: 9, made: 1 }, 'junk',
    ],
  });
  const r = await createRoomsClient(oc, me).listPublic();
  expect(calls[0].path).toBe('/api/rooms');
  expect(r.map((x) => x.name)).toEqual(['c', 'a', 'b']);
  expect(r[0]).toEqual({ id: 'CCCCCCCCCCCCCCCCCCCC', name: 'c', here: 9, made: 1 });
});

test('setRoom renames or lists with the maker key', async () => {
  const { oc, calls } = fakeOffchain({ name: 'new' });
  const c = createRoomsClient(oc, me);
  expect(await c.setRoom(ID, 'k1', { name: 'new' })).toEqual({ name: 'new' });
  await c.setRoom(ID, 'k1', { listed: false });
  expect(calls[0]).toMatchObject({ verb: 'POST', path: `/api/room?id=${ID}`, body: { name: 'new' }, o: { headers: { 'X-Room-Key': 'k1', 'X-Name-Key': 'nk' } } });
  expect(calls[1]).toMatchObject({ body: { public: false } });
});

test('dropRoom deletes with the maker key', async () => {
  const { oc, calls } = fakeOffchain({});
  await createRoomsClient(oc, me).dropRoom(ID, 'k1');
  expect(calls[0]).toMatchObject({ verb: 'DELETE', path: `/api/room?id=${ID}`, o: { headers: { 'X-Room-Key': 'k1' } } });
});

test('invite names who invites, with the maker key', async () => {
  const { oc, calls } = fakeOffchain({ to: 'bob' });
  expect(await createRoomsClient(oc, me).invite(ID, 'k1', 'bob', 'ab12')).toEqual({ to: 'bob' });
  expect(calls[0]).toMatchObject({
    verb: 'POST', path: `/api/room/invite?room=${ID}`, body: { to: 'bob', tag: 'ab12', name: 'Ann' }, o: { headers: { 'X-Room-Key': 'k1' } },
  });
});

test('scan reads what came since a mark without waiting', async () => {
  const { oc, calls } = fakeOffchain({ msgs: [{ id: 9, t: 1, name: 'x', body: 'y' }], next: 9 });
  const r = await createRoomsClient(oc, me).scan(ID, 4);
  expect(calls[0].path).toBe(`/api/chat?since=4&wait=0&limit=200&room=${ID}`);
  expect(r.msgs[0].id).toBe(9);
});
