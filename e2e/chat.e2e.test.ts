import { randomBytes } from 'node:crypto';

import { createChatClient } from '../src/offchain/chat/client';
import { createIdentityStore } from '../src/offchain/chat/identity';
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
  const store = createChatStore({
    client, identity, kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) }, wallet,
  });
  return { store, client, identity, opened };
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
  await ann.store.getState().setName('ann');
  ann.store.getState().start();
  bob.store.getState().start();
  await until(() => ann.store.getState().phase === 'live' && bob.store.getState().phase === 'live');

  expect(await ann.store.getState().send('hello bob')).toBe(true);
  await until(() => bob.store.getState().lines.some((l) => l.body === 'hello bob'));
  const hello = bob.store.getState().lines.find((l) => l.body === 'hello bob')!;

  await bob.store.getState().setName('bob');
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
  await ann.store.getState().setName('ann');
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
  await ann.store.ready;
  await ann.store.getState().setName('Ann');
  expect(await ann.store.getState().reserveName(w.address)).toBe(false);
  expect(ann.opened).toHaveLength(1);
  expect(await ann.store.getState().onProofReply(w.answer(ann.opened[0]))).toBe(true);
  expect(ann.store.getState().identityError).toBe('');
  expect(ann.store.getState().identity.reservedName).toBe('Ann');
  expect(await ann.store.getState().send('signed')).toBe(true);
  expect(ann.store.getState().lines.at(-1)).toMatchObject({ name: 'Ann', reserved: true });

  const bob = app('bbbbbbbbbbbbbbbb');
  await bob.store.ready;
  await bob.store.getState().setName('ann');
  expect(await bob.store.getState().send('fake')).toBe(false);
  expect(bob.store.getState().error).toMatch(/reserved/);
});

test('a boop from the last 3 minutes reserves without the wallet', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await ann.store.ready;
  await ann.store.getState().setName('Ann');
  await ann.client.reportBoop('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5', 1, 1, 6);
  expect(await ann.store.getState().reserveName('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')).toBe(true);
  expect(ann.opened).toHaveLength(0);
});

test('a wallet that already holds a name is told so after signing', async () => {
  const w = newTestWallet();
  const ann = app('aaaaaaaaaaaaaaaa');
  await ann.store.ready;
  await ann.store.getState().setName('Ann');
  await ann.store.getState().reserveName(w.address);
  await ann.store.getState().onProofReply(w.answer(ann.opened[0]));
  const again = app('cccccccccccccccc');
  await again.store.ready;
  await again.store.getState().setName('Other');
  await again.store.getState().reserveName(w.address);
  expect(await again.store.getState().onProofReply(w.answer(again.opened[0]))).toBe(true);
  expect(again.store.getState().identityError).toMatch(/holds the name Ann already/);
  expect(again.store.getState().identity.reservedName).toBe('');
});

test('an avatar rides with the next line', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await ann.store.ready;
  expect(await ann.store.getState().setAvatar(new Uint8Array([0xff, 0xd8, 0xff]), 'image/jpeg')).toBe(true);
  await ann.store.getState().send('with a face');
  expect(ann.store.getState().lines.at(-1)?.av).toBe(ann.store.getState().identity.av);
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
