import { createIdentityStore } from '../src/offchain/chat/identity';
import { createOffchain } from '../src/offchain/http';
import { sendPresence } from '../src/offchain/presence';
import { createSyncClient } from '../src/offchain/sync/client';
import { nodeCrypto } from '../src/offchain/sync/node-crypto';
import { createBookStore } from '../src/offchain/sync/rooms';
import { createSyncStore } from '../src/offchain/sync/store';
import { startFakeServer, type FakeServer } from '../scripts/fake-offchain/server';
import { SiteBrowser } from '../scripts/fake-offchain/site-sync';

let fake: FakeServer;
const apps: { sync: ReturnType<typeof createSyncStore> }[] = [];
beforeEach(async () => {
  fake = await startFakeServer(0, { maxWait: 1 });
});
afterEach(async () => {
  for (const a of apps.splice(0)) a.sync.getState().pause();
  await fake.close();
});

const ADDR = 'g1' + 'q'.repeat(38);
const KEY_REMI = 'a'.repeat(32);
const KEY_ANN = 'b'.repeat(32);
const ROOM_A = 'AAAAAAAAAAAAAAAAAAA1';
const ROOM_B = 'BBBBBBBBBBBBBBBBBBB2';
const ROOM_C = 'CCCCCCCCCCCCCCCCCCC3';

const reserve = (name: string, key: string) =>
  fetch(`${fake.url}/__test/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, key, addr: ADDR }) });

const until = async (f: () => boolean | Promise<boolean>, ms = 15000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

function app() {
  const secrets = new Map<string, string>();
  const kv = new Map<string, string>();
  const sec = { get: async (k: string) => secrets.get(k) ?? null, set: async (k: string, v: string) => void secrets.set(k, v) };
  const scope = () => fake.url;
  const identity = createIdentityStore(sec, scope);
  const book = createBookStore({ kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) }, secrets: sec, crypto: nodeCrypto, scope });
  const offchain = createOffchain({ baseUrl: scope, bid: async () => 'cccccccccccccccc' });
  const sync = createSyncStore({ client: createSyncClient(offchain), crypto: nodeCrypto, secrets: sec, book, identity, identityChanged: () => undefined, scope });
  const a = { sync, identity, book };
  apps.push(a);
  sync.getState().resume();
  return a;
}
const accept = async (a: ReturnType<typeof app>, code: string) => {
  const k = await a.sync.getState().open(code);
  if (!k) throw new Error(a.sync.getState().acceptError);
  return a.sync.getState().use(k);
};

test('the browser gives the code, the app takes it: rooms with their keys and the name come along, and go back', async () => {
  const b = new SiteBrowser(fake.url);
  await reserve('remi', KEY_REMI);
  b.reserve('remi', KEY_REMI);
  b.roomRemember({ id: ROOM_A, name: 'tea', key: 'maker-a' });
  b.roomRemember({ id: ROOM_B, name: 'lobby', key: '' });
  const code = await b.syncOffer();

  const a = app();
  expect(await accept(a, code)).toBe('paired — your chat rooms are the same on both devices, and the name remi is yours here too ✓');
  expect(await a.identity.load()).toMatchObject({ name: 'remi', reservedName: 'remi', nameKey: KEY_REMI });
  expect(a.sync.getState().rooms.map((r) => [r.id, r.name, r.key]).sort()).toEqual([[ROOM_A, 'tea', 'maker-a'], [ROOM_B, 'lobby', '']]);

  await b.syncPull();
  expect(b.roomsKnown().map((r) => r.id).sort()).toEqual([ROOM_A, ROOM_B]);
  expect(b.roomsKnown().find((r) => r.id === ROOM_A)!.key).toBe('maker-a');
});

test('the app gives the code, the browser takes it: the app name and room arrive there', async () => {
  const a = app();
  await reserve('ann', KEY_ANN);
  await a.identity.save({ name: 'ann', reservedName: 'ann', nameKey: KEY_ANN });
  await a.book.save({ rooms: [{ id: ROOM_C, name: 'from the app', key: 'maker-c', at: Date.now() }], left: {} });
  const code = (await a.sync.getState().offer())!;

  const b = new SiteBrowser(fake.url);
  expect(await b.syncAccept(code)).toBe('paired — your chat rooms are the same on both devices, and the name ann is yours here too ✓');
  expect(b.chatReservedName()).toBe('ann');
  expect(b.roomsKnown()).toEqual([expect.objectContaining({ id: ROOM_C, name: 'from the app', key: 'maker-c' })]);

  // the browser adds a room; the app's fast pulls bring it
  b.roomRemember({ id: ROOM_A, name: 'tea', key: '' });
  await b.syncPush();
  await until(() => a.sync.getState().rooms.some((r) => r.id === ROOM_A));
});

test('kept: the app keeps the name it holds; refused: a stale key does not come along', async () => {
  await reserve('remi', KEY_REMI);
  await reserve('ann', KEY_ANN);
  const a = app();
  await a.identity.save({ name: 'ann', reservedName: 'ann', nameKey: KEY_ANN });
  const b = new SiteBrowser(fake.url);
  b.reserve('remi', KEY_REMI);
  expect(await accept(a, await b.syncOffer())).toBe("paired — your chat rooms are the same on both devices. This device keeps its own name ann; the other device's name remi stays there");
  expect((await a.identity.load()).reservedName).toBe('ann');

  const c = app();
  const stale = new SiteBrowser(fake.url);
  stale.reserve('remi', 'c'.repeat(32));
  expect(await accept(c, await stale.syncOffer())).toMatch(/but the name remi did NOT come along/);
  expect((await c.identity.load()).reservedName).toBe('');
});

test('a room left in the browser leaves the app', async () => {
  const b = new SiteBrowser(fake.url);
  b.roomRemember({ id: ROOM_A, name: 'tea', key: '' });
  b.roomRemember({ id: ROOM_B, name: 'lobby', key: '' });
  const a = app();
  await accept(a, await b.syncOffer());
  expect(a.sync.getState().rooms).toHaveLength(2);
  await new Promise((r) => setTimeout(r, 5)); // left must be later than the room's at
  b.roomForget(ROOM_A);
  await b.syncPush();
  a.sync.getState().pause();
  a.sync.getState().resume(); // back in the foreground: a pull
  await until(() => a.sync.getState().rooms.length === 1);
  expect(a.sync.getState().rooms[0].id).toBe(ROOM_B);
});

test('both write at once: the second gets 412, reads, merges, and nothing is lost', async () => {
  const b = new SiteBrowser(fake.url);
  const a = app();
  await accept(a, await b.syncOffer());
  b.roomRemember({ id: ROOM_A, name: 'tea', key: '' });
  await b.syncPush();
  await a.book.save({ rooms: [...(await a.book.load()).rooms, { id: ROOM_C, name: 'app room', key: '', at: Date.now() }], left: {} });
  a.sync.getState().changed();
  await until(async () => {
    await b.syncPull();
    return b.roomsKnown().some((r) => r.id === ROOM_C);
  });
  expect(b.roomsKnown().map((r) => r.id).sort()).toEqual([ROOM_A, ROOM_C]);
});

test('a code works once', async () => {
  const b = new SiteBrowser(fake.url);
  const code = await b.syncOffer();
  await accept(app(), code);
  const late = app();
  expect(await late.sync.getState().open(code)).toBeNull();
  expect(late.sync.getState().acceptError).toBe('no such code — it may have been used, or it is older than ten minutes');
});

test('presence: a paired app sends its group', async () => {
  const b = new SiteBrowser(fake.url);
  const a = app();
  await accept(a, await b.syncOffer());
  await sendPresence(createOffchain({ baseUrl: () => fake.url, bid: async () => 'cccccccccccccccc' }), 'p1', a.sync.getState().group);
  const groups = (await (await fetch(`${fake.url}/__test/presence`)).json()).groups;
  expect(groups).toEqual([b.SYNC.id!.slice(0, 16)]);
});
