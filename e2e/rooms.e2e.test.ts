import { createOffchain } from '../src/offchain/http';
import { roomLink } from '../src/offchain/rooms/link';
import { nodeCrypto } from '../src/offchain/sync/node-crypto';
import { createChatServices } from '../src/state/chat-services';
import { startFakeServer, type FakeServer } from '../scripts/fake-offchain/server';
import { SiteBrowser } from '../scripts/fake-offchain/site-sync';

let fake: FakeServer;
type App = ReturnType<typeof createChatServices>;
const running: App[] = [];
beforeEach(async () => {
  fake = await startFakeServer(0, { maxWait: 1 });
});
afterEach(async () => {
  for (const a of running.splice(0)) {
    a.rooms.getState().pause();
    a.chat.getState().stop();
    a.sync.getState().pause();
  }
  await fake.close();
});

const until = async (f: () => boolean | Promise<boolean>, ms = 10000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};
// the 20 s between a gone room's polls, shortened
const quick = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, Math.min(ms, 50));
    signal.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true });
  });

function app(bid: string): App {
  const secrets = new Map<string, string>();
  const kv = new Map<string, string>();
  const s = createChatServices({
    offchain: createOffchain({ baseUrl: () => fake.url, bid: async () => bid }),
    secrets: { get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void secrets.set(k, v) },
    kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) },
    crypto: nodeCrypto,
    scope: () => fake.url,
    sleep: quick,
  });
  running.push(s);
  return s;
}
async function named(a: App, name: string) {
  await Promise.all([a.identityState.ready, a.chat.ready]);
  await a.identityState.getState().setName(name);
  a.chat.getState().start();
  a.rooms.getState().resume();
  await until(() => a.chat.getState().phase === 'live');
}
const room = (a: App, id: string) => a.rooms.getState().room(id);
const made = async (a: App, name: string, listed = false) => {
  const r = await a.rooms.getState().make(name, listed);
  if (!('id' in r)) throw new Error(r.error);
  return r.id;
};

test('ann makes a room, bob joins by its link, lines go both ways', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const bob = app('bbbbbbbbbbbbbbbb');
  await named(ann, 'ann');
  await named(bob, 'bob');
  const id = await made(ann, 'tea');
  ann.rooms.getState().focus(id);
  expect(await bob.rooms.getState().join(roomLink(fake.url, id))).toEqual({ id });
  expect(bob.rooms.getState().book.rooms[0]).toMatchObject({ id, name: 'tea', key: '' });
  bob.rooms.getState().focus(id);
  await until(() => room(ann, id).getState().phase === 'live' && room(bob, id).getState().phase === 'live');

  expect(await room(ann, id).getState().send('hello room')).toBe(true);
  await until(() => room(bob, id).getState().lines.some((l) => l.body === 'hello room'));
  expect(await room(bob, id).getState().send('hi ann')).toBe(true);
  await until(() => room(ann, id).getState().lines.some((l) => l.body === 'hi ann'));
  // Public never saw them
  expect(ann.chat.getState().lines.some((l) => l.body === 'hello room')).toBe(false);
});

test('ann invites bob; bob\'s Public poll brings the invitation and a banner', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const bob = app('bbbbbbbbbbbbbbbb');
  await named(ann, 'ann');
  await named(bob, 'bob');
  const id = await made(ann, 'party');
  expect(await ann.rooms.getState().invite(id, 'bob', '')).toBe('bob gets "party" on their next poll');
  await until(() => bob.rooms.getState().banner !== null);
  expect(bob.rooms.getState().banner).toEqual({ id, name: 'party', from: 'ann' });
  await until(() => bob.rooms.getState().book.rooms.some((r) => r.id === id));
  expect(await ann.rooms.getState().invite(id, 'nobody', '')).toBe('nobody spoke as nobody lately');
});

test('maker tools: rename for everyone, list then unlist, pin, delete a line, drop the room', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const bob = app('bbbbbbbbbbbbbbbb');
  await named(ann, 'ann');
  await named(bob, 'bob');
  const id = await made(ann, 'tea');
  await bob.rooms.getState().join(id);
  ann.rooms.getState().focus(id);
  bob.rooms.getState().focus(id);
  await until(() => room(ann, id).getState().phase === 'live' && room(bob, id).getState().phase === 'live');

  expect(await ann.rooms.getState().rename(id, 'green tea')).toBe('renamed to "green tea"');
  await room(bob, id).getState().send('wake');
  await until(() => room(bob, id).getState().roomName === 'green tea');
  expect(await bob.rooms.getState().rename(id, 'mine')).toMatch(/for you/);

  expect(await ann.rooms.getState().setListed(id, true)).toBe('');
  await bob.rooms.getState().refreshListed();
  expect(bob.rooms.getState().listed?.map((r) => r.id)).toEqual([id]);
  expect(await ann.rooms.getState().setListed(id, false)).toBe('');
  await bob.rooms.getState().refreshListed();
  expect(bob.rooms.getState().listed).toEqual([]);
  expect(await bob.rooms.getState().setListed(id, true)).toBe('only the room\'s maker can do that');

  await room(bob, id).getState().send('pin me');
  await until(() => room(ann, id).getState().lines.some((l) => l.body === 'pin me'));
  const line = room(ann, id).getState().lines.find((l) => l.body === 'pin me')!;
  await room(ann, id).getState().pin(line.id, true);
  await until(() => room(bob, id).getState().pins.some((l) => l.id === line.id));
  await room(ann, id).getState().deleteLine(line.id);
  await until(() => !room(bob, id).getState().lines.some((l) => l.id === line.id));

  expect(await ann.rooms.getState().drop(id)).toBe('');
  expect(ann.rooms.getState().book.rooms).toEqual([]);
  await until(() => bob.rooms.getState().goneSaid === 'mine');
});

test('bob leaves; the book has it in left', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const bob = app('bbbbbbbbbbbbbbbb');
  await named(ann, 'ann');
  await named(bob, 'bob');
  const id = await made(ann, 'tea');
  await bob.rooms.getState().join(id);
  await bob.rooms.getState().leave(id);
  expect(bob.rooms.getState().book.rooms).toEqual([]);
  expect(bob.rooms.getState().book.left[id]).toBeGreaterThan(0);
});

test('a vanished room is gone after three 404s', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await named(ann, 'ann');
  const id = await made(ann, 'quiet');
  ann.rooms.getState().focus(id);
  await until(() => room(ann, id).getState().phase === 'live');
  fake.vanish(id);
  await until(() => ann.rooms.getState().goneSaid === 'quiet');
  expect(ann.rooms.getState().book.rooms).toEqual([]);
});

test('with site-sync, a made room and a left room reach the browser by /pair', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await named(ann, 'ann');
  ann.sync.getState().resume();
  const b = new SiteBrowser(fake.url);
  const key = await ann.sync.getState().open(await b.syncOffer());
  expect(key).not.toBeNull();
  await ann.sync.getState().use(key!);

  const id = await made(ann, 'from the phone');
  await until(async () => {
    await b.syncPull();
    return b.roomsKnown().some((r) => r.id === id && r.key !== '');
  });
  await ann.rooms.getState().leave(id);
  await until(async () => {
    await b.syncPull();
    return !b.roomsKnown().some((r) => r.id === id);
  });
});

test('never more than two long-polls open', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await named(ann, 'ann');
  const ids = [await made(ann, 'one'), await made(ann, 'two'), await made(ann, 'three')];
  let most = 0;
  for (const id of [...ids, '', ids[0]]) {
    ann.rooms.getState().focus(id);
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 30));
      most = Math.max(most, fake.waiting().length);
    }
  }
  expect(most).toBeLessThanOrEqual(2);
  expect(most).toBe(2);
});
