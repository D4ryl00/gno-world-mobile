import { openJson, sealJson, unhex } from './crypto';
import { FAST_EVERY, FAST_FOR, PUSH_AFTER } from './store';
import { fastCrypto, memorySync, pauseAll, syncApp, until } from './testing';

const ROOM = (n: number, key = '') => ({ id: `room${String(n).padStart(16, '0')}`, name: `r${n}`, key, at: 1000 + n });
const KEY = 'a'.repeat(32);

afterEach(() => {
  pauseAll();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function paired() {
  const server = memorySync();
  const a = syncApp(server);
  const b = syncApp(server);
  a.store.getState().resume();
  b.store.getState().resume();
  const code = (await a.store.getState().offer())!;
  const key = (await b.store.getState().open(code))!;
  await b.store.getState().use(key);
  return { server, a, b, code };
}

test('a first code makes a sync key, writes the record, posts the code', async () => {
  const server = memorySync();
  const a = syncApp(server);
  a.store.getState().resume();
  const code = await a.store.getState().offer();
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  expect(server.calls).toEqual(['pull', 'push', `pair ${code}`]);
  expect(server.records.size).toBe(1);
  const s = a.store.getState();
  expect(s).toMatchObject({ paired: true, busy: null, offerError: '', code: { code } });
  expect(s.group).toMatch(/^[0-9a-f]{16}$/);
  expect([...a.secrets.keys()]).toContain('br.sync.key.http_3a_2f_2ffake'); // keyPart('http://fake')
});

test('the other side takes the code: same record, rooms both ways, the name comes along', async () => {
  const server = memorySync();
  const a = syncApp(server);
  const b = syncApp(server);
  server.names.set('remi', KEY);
  await a.identity.save({ name: 'remi', reservedName: 'remi', nameKey: KEY });
  await a.book.save({ rooms: [ROOM(1, 'maker')], left: {} });
  await b.book.save({ rooms: [ROOM(2)], left: {} });
  a.store.getState().resume();
  b.store.getState().resume();
  const code = (await a.store.getState().offer())!;
  const key = await b.store.getState().open(code);
  expect(key).toHaveLength(32);
  expect(await b.store.getState().use(key!)).toBe('paired — your chat rooms are the same on both devices, and the name remi is yours here too ✓');
  expect(await b.identity.load()).toMatchObject({ name: 'remi', reservedName: 'remi', nameKey: KEY });
  expect(b.reloads()).toBe(1);
  expect(b.store.getState().rooms.map((r) => [r.id, r.key])).toEqual([[ROOM(2).id, ''], [ROOM(1).id, 'maker']]);
  expect(b.store.getState().group).toBe(a.store.getState().group);
  expect(b.store.getState().code).toBeNull();
});

test('a code works once; a bad one says why; nothing is paired', async () => {
  const { b, code } = await paired();
  await expect(b.store.getState().open(code)).resolves.toBeNull();
  expect(b.store.getState().acceptError).toBe('no such code — it may have been used, or it is older than ten minutes');
  expect(await b.store.getState().open('abc')).toBeNull();
  expect(b.store.getState().acceptError).toBe('a code is six letters and digits');
});

test("a blob the code does not open is refused", async () => {
  const server = memorySync();
  const b = syncApp(server);
  server.codes.set('K7XQ2M', await sealJson(fastCrypto, new Uint8Array(32), 'x'));
  expect(await b.store.getState().open('K7XQ2M')).toBeNull();
  expect(b.store.getState().acceptError).toBe('that code did not open the key');
});

test('a code in use: another is drawn; three in use: could not make a code', async () => {
  const server = memorySync();
  const a = syncApp(server);
  const taken = jest.spyOn(server.client, 'pairPost').mockResolvedValueOnce('taken');
  expect(await a.store.getState().offer()).not.toBeNull();
  expect(taken).toHaveBeenCalledTimes(2);
  taken.mockResolvedValue('taken');
  expect(await a.store.getState().offer()).toBeNull();
  expect(a.store.getState().offerError).toBe('could not make a code');
});

test('tapped twice: one offer', async () => {
  const server = memorySync();
  const a = syncApp(server);
  const [one, two] = await Promise.all([a.store.getState().offer(), a.store.getState().offer()]);
  expect([one, two].filter(Boolean)).toHaveLength(1);
  expect(server.calls.filter((c) => c.startsWith('pair'))).toHaveLength(1);
});

test('a changed book is pushed 1.5 s later; another device wrote meanwhile: read, merge, write again', async () => {
  const { server, a, b } = await paired();
  jest.useFakeTimers();
  await b.book.save({ rooms: [ROOM(5)], left: {} });
  b.store.getState().changed();
  await jest.advanceTimersByTimeAsync(PUSH_AFTER);
  // a writes without knowing b's version: 412, then a reads b's room and writes both
  await a.book.save({ rooms: [...(await a.book.load()).rooms, ROOM(6)], left: {} });
  server.calls.length = 0;
  a.store.getState().changed();
  await jest.advanceTimersByTimeAsync(PUSH_AFTER);
  expect(server.calls).toEqual(['push', 'pull', 'push']);
  const [rec] = [...server.records.values()];
  const key = unhex([...a.secrets.entries()].find(([k]) => k.startsWith('br.sync.key'))![1]);
  const got = (await openJson(fastCrypto, key, rec.blob)) as { rooms: { id: string }[] };
  expect(got.rooms.map((r) => r.id)).toEqual(expect.arrayContaining([ROOM(5).id, ROOM(6).id]));
});

test('a record the key cannot open: failing, and never overwritten', async () => {
  const { server, a } = await paired();
  const [id] = [...server.records.keys()];
  server.records.set(id, { v: 9, blob: await sealJson(fastCrypto, new Uint8Array(32), { rooms: [] }) });
  jest.useFakeTimers();
  a.store.getState().changed();
  await jest.advanceTimersByTimeAsync(PUSH_AFTER);
  expect(a.store.getState().failing).toBe(true);
  // the next change must not write over it either (the version it could not read is not taken as known)
  a.store.getState().changed();
  await jest.advanceTimersByTimeAsync(PUSH_AFTER);
  expect(server.records.get(id)!.v).toBe(9);
});

test('stop forgets the key; later changes go nowhere; the book stays', async () => {
  const { server, a } = await paired();
  await a.store.getState().stop();
  expect(a.store.getState()).toMatchObject({ paired: false, group: '', code: null });
  expect([...a.secrets.entries()].find(([k]) => k.startsWith('br.sync.key'))![1]).toBe('');
  server.calls.length = 0;
  jest.useFakeTimers();
  a.store.getState().changed();
  await jest.advanceTimersByTimeAsync(PUSH_AFTER * 2);
  expect(server.calls).toEqual([]);
});

test('the server changed in Settings while an offer was out: the late answer leaves the new server alone', async () => {
  const server = memorySync();
  const a = syncApp(server);
  let release: (() => void) | undefined;
  jest.spyOn(server.client, 'pairPost').mockImplementationOnce(() => new Promise((r) => (release = () => r('ok'))));
  const offered = a.store.getState().offer();
  await until(() => release !== undefined);
  a.setScope('http://other');
  a.store.getState().restart();
  release!();
  expect(await offered).toBeNull();
  expect(a.store.getState()).toMatchObject({ paired: false, code: null, busy: null });
});

test('after a code, pulls every 5 s for 6 min; back from the background inside the window, they go on', async () => {
  jest.useFakeTimers();
  const server = memorySync();
  const a = syncApp(server);
  a.store.getState().resume();
  await a.store.getState().offer();
  server.calls.length = 0;
  await jest.advanceTimersByTimeAsync(FAST_EVERY * 3);
  expect(server.calls.filter((c) => c === 'pull')).toHaveLength(3);
  a.store.getState().pause();
  server.calls.length = 0;
  await jest.advanceTimersByTimeAsync(FAST_EVERY * 3);
  expect(server.calls).toEqual([]);
  a.store.getState().resume();
  await jest.advanceTimersByTimeAsync(FAST_EVERY * 2);
  expect(server.calls.filter((c) => c === 'pull')).toHaveLength(3); // the resume's own pull, then two fast ones
  await jest.advanceTimersByTimeAsync(FAST_FOR);
  server.calls.length = 0;
  await jest.advanceTimersByTimeAsync(FAST_EVERY * 3);
  expect(server.calls).toEqual([]); // the window is over; the next pull is the 2-minute one
});

test('a resume reads the stored key and the book, and pulls', async () => {
  const { server, b } = await paired();
  const again = syncApp(server);
  for (const [k, v] of b.secrets) await again.secrets.set(k, v);
  await again.book.save(await b.book.load());
  again.store.getState().resume();
  await until(() => again.store.getState().lastSync > 0);
  expect(again.store.getState().paired).toBe(true);
  expect(again.store.getState().rooms).toEqual(b.store.getState().rooms);
});

test('without the native module, the code cannot be made and the error says so', async () => {
  const server = memorySync();
  const a = syncApp(server);
  jest.spyOn(fastCrypto, 'pbkdf2').mockRejectedValueOnce(new Error('this build cannot pair — update the app'));
  expect(await a.store.getState().offer()).toBeNull();
  expect(a.store.getState().offerError).toBe('this build cannot pair — update the app');
});
