import { randomBytes } from 'node:crypto';

import { createChatClient } from '../src/offchain/chat/client';
import { createIdentityStore } from '../src/offchain/chat/identity';
import { createIdentityState } from '../src/offchain/chat/identity-store';
import { createChatStore } from '../src/offchain/chat/store';
import { createOffchain } from '../src/offchain/http';
import { startFakeServer, type FakeServer } from '../scripts/fake-offchain/server';
import { newTestWallet } from './test-wallet';

let fake: FakeServer;
beforeEach(async () => {
  fake = await startFakeServer(0, { maxWait: 2 });
});
afterEach(() => fake.close());

function app(bid: string) {
  const secrets = new Map<string, string>();
  const identity = createIdentityStore({ get: async (k) => secrets.get(k) ?? null, set: async (k, v) => void secrets.set(k, v) });
  const offchain = createOffchain({ baseUrl: () => fake.url, bid: async () => bid });
  const client = createChatClient(offchain, () => identity.load());
  const kv = new Map<string, string>();
  // the links the store asks the wallet to open
  const opened: string[] = [];
  const wallet = {
    open: async (url: string) => void opened.push(url),
    randomHex: (n: number) => randomBytes(n / 2).toString('hex'),
    network: () => ({ chainId: 'dev', remote: 'http://127.0.0.1:26657' }),
  };
  const kvs = { getItem: async (k: string) => kv.get(k) ?? null, setItem: async (k: string, v: string) => void kv.set(k, v) };
  const me = createIdentityState({ client, identity, kv: kvs, wallet });
  const store = createChatStore({ client, identity: () => me.getState().identity, kv: kvs });
  return { store, me, client, identity, opened };
}

const until = async (f: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('one posts, the other sees it through the long poll; reply, edit, take back', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const bob = app('bbbbbbbbbbbbbbbb');
  await ann.me.getState().setName('ann');
  ann.store.getState().start();
  bob.store.getState().start();
  await until(() => ann.store.getState().phase === 'live' && bob.store.getState().phase === 'live');

  expect(await ann.store.getState().send('hello bob')).toBe(true);
  await until(() => bob.store.getState().lines.some((l) => l.body === 'hello bob'));
  const hello = bob.store.getState().lines.find((l) => l.body === 'hello bob')!;

  await bob.me.getState().setName('bob');
  expect(await bob.store.getState().send('hi ann', hello.id)).toBe(true);
  await until(() => ann.store.getState().lines.some((l) => l.re?.id === hello.id));

  const mine = ann.store.getState().lines.find((l) => l.body === 'hello bob')!;
  expect(await ann.store.getState().edit(mine.id, 'hello bob!')).toBe(true);
  await until(() => bob.store.getState().lines.some((l) => l.id === mine.id && l.edited && l.body === 'hello bob!'));

  expect(await ann.store.getState().withdraw()).toBe(false); // bob's line is the newest
  expect(await bob.store.getState().withdraw()).toBe(true);
  await until(() => !ann.store.getState().lines.some((l) => l.body === 'hi ann'));

  ann.store.getState().stop();
  bob.store.getState().stop();
});

test('reactions, votes and typing travel', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const bob = app('bbbbbbbbbbbbbbbb');
  await ann.me.getState().setName('ann');
  ann.store.getState().start();
  bob.store.getState().start();
  await until(() => ann.store.getState().phase === 'live' && bob.store.getState().phase === 'live');
  const poll = ann.store.getState().lines.find((l) => l.poll)!;
  const target = ann.store.getState().lines.at(-1)!;

  await ann.store.getState().react(target.id, '❤️');
  await until(() => (bob.store.getState().lines.find((l) => l.id === target.id)?.rx['❤️'] ?? 0) >= 1);
  await ann.store.getState().vote(poll.id, 1);
  expect(ann.store.getState().myVotes[poll.id]).toBe(1);
  ann.store.getState().signalTyping(12);
  await until(() => bob.store.getState().typing.some((t) => t.name === 'ann'));

  ann.store.getState().stop();
  bob.store.getState().stop();
});

test('the wallet signs the phrase, then the name is reserved and its lines carry the mark', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const w = newTestWallet();
  await Promise.all([ann.store.ready, ann.me.ready]);
  await ann.me.getState().setName('Ann');
  expect(await ann.me.getState().reserveName(w.address)).toBe(false);
  expect(ann.opened).toHaveLength(1);
  expect(await ann.me.getState().onProofReply(w.answer(ann.opened[0]))).toBe(true);
  expect(ann.me.getState().identityError).toBe('');
  expect(ann.me.getState().identity.reservedName).toBe('Ann');
  expect(await ann.store.getState().send('signed')).toBe(true);
  expect(ann.store.getState().lines.at(-1)).toMatchObject({ name: 'Ann', reserved: true });

  const bob = app('bbbbbbbbbbbbbbbb');
  await Promise.all([bob.store.ready, bob.me.ready]);
  await bob.me.getState().setName('ann');
  expect(await bob.store.getState().send('fake')).toBe(false);
  expect(bob.store.getState().error).toMatch(/reserved/);
});

test('a boop from the last 3 minutes reserves without the wallet', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await Promise.all([ann.store.ready, ann.me.ready]);
  await ann.me.getState().setName('Ann');
  await ann.client.reportBoop('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5', 1, 1, 6);
  expect(await ann.me.getState().reserveName('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')).toBe(true);
  expect(ann.opened).toHaveLength(0);
});

test('a wallet that already holds a name is told so after signing', async () => {
  const w = newTestWallet();
  const ann = app('aaaaaaaaaaaaaaaa');
  await Promise.all([ann.store.ready, ann.me.ready]);
  await ann.me.getState().setName('Ann');
  await ann.me.getState().reserveName(w.address);
  await ann.me.getState().onProofReply(w.answer(ann.opened[0]));
  const again = app('cccccccccccccccc');
  await Promise.all([again.store.ready, again.me.ready]);
  await again.me.getState().setName('Other');
  await again.me.getState().reserveName(w.address);
  expect(await again.me.getState().onProofReply(w.answer(again.opened[0]))).toBe(true);
  expect(again.me.getState().identityError).toMatch(/holds the name Ann already/);
  expect(again.me.getState().identity.reservedName).toBe('');
});

test('an avatar rides with the next line', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await Promise.all([ann.store.ready, ann.me.ready]);
  expect(await ann.me.getState().setAvatar(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg')).toBe(true);
  await ann.store.getState().send('with a face');
  expect(ann.store.getState().lines.at(-1)?.av).toBe(ann.me.getState().identity.av);
});

test('a new gen and a 429 do not break the loop', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  ann.store.getState().start();
  await until(() => ann.store.getState().phase === 'live');
  await fetch(`${fake.url}/__test/fail`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"status":429,"retryAfter":1}' });
  await fetch(`${fake.url}/__test/gen`, { method: 'POST' });
  await fetch(`${fake.url}/__test/say`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"zed","body":"after"}' });
  await until(() => ann.store.getState().lines.some((l) => l.body === 'after'), 20000);
  expect(ann.store.getState().phase).toBe('live');
  ann.store.getState().stop();
}, 30000);
