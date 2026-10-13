import { readFileSync } from 'fs';
import { join } from 'path';

import { proofFromReply } from '../src/offchain/chat/name-proof';
import { parsePollReply } from '../src/offchain/chat/parse';
import { buildChallengeLink } from '../src/session/gnoconnect';
import { startFakeServer, type FakeServer } from '../scripts/fake-offchain/server';
import { newTestWallet } from './test-wallet';

let fake: FakeServer;
let clock = 1_791_000_000;
beforeEach(async () => {
  fake = await startFakeServer(0, { now: () => clock, maxWait: 1 });
});
afterEach(() => fake.close());

const call = async (path: string, init: { method?: string; bid?: string; key?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'X-Bid': init.bid ?? 'aaaaaaaaaaaaaaaa' };
  if (init.key) headers['X-Name-Key'] = init.key;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(fake.url + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
};
const ME = 'aaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbb';

test('the first page has the seeded lines: a pin, a poll, the bot', async () => {
  const r = parsePollReply((await call('/api/chat?since=0&wait=0&limit=80')).json);
  expect(r.msgs.length).toBeGreaterThanOrEqual(4);
  expect(r.pins.length).toBeGreaterThanOrEqual(1);
  expect(r.msgs.some((l) => l.poll)).toBe(true);
  expect(r.msgs.some((l) => l.bot)).toBe(true);
  expect(r.you?.tag).toMatch(/^[0-9a-f]{4}$/);
});

test('a long poll answers as soon as someone posts', async () => {
  const first = (await call('/api/chat?since=0&wait=0&limit=80')).json;
  const waiting = call(`/api/chat?since=${first.next}&wait=30&limit=200`, { bid: OTHER });
  await call('/api/chat', { method: 'POST', body: { name: 'ann', body: 'hello' } });
  const r = parsePollReply((await waiting).json);
  expect(r.msgs.map((l) => l.body)).toEqual(['hello']);
});

test('a quiet long poll ends at maxWait with nothing', async () => {
  const first = (await call('/api/chat?since=0&wait=0&limit=80')).json;
  const r = parsePollReply((await call(`/api/chat?since=${first.next}&wait=55&limit=200`)).json);
  expect(r.msgs).toEqual([]);
});

test('edit: your own line under fifteen minutes only', async () => {
  const { json } = await call('/api/chat', { method: 'POST', body: { name: 'ann', body: 'a' } });
  const id = json.msg.id;
  expect((await call(`/api/chat?id=${id}`, { method: 'PATCH', bid: OTHER, body: { body: 'x' } })).status).toBe(403);
  const ok = await call(`/api/chat?id=${id}`, { method: 'PATCH', body: { body: 'b' } });
  expect(ok.json.msg).toMatchObject({ body: 'b', ed: true });
  clock += 901;
  expect((await call(`/api/chat?id=${id}`, { method: 'PATCH', body: { body: 'c' } })).status).toBe(403);
});

test('an edit reaches a waiting poll as upd', async () => {
  const { json } = await call('/api/chat', { method: 'POST', body: { name: 'ann', body: 'a' } });
  const next = (await call('/api/chat?since=0&wait=0&limit=80')).json.next;
  const waiting = call(`/api/chat?since=${next}&wait=30&limit=200`, { bid: OTHER });
  await call(`/api/chat?id=${json.msg.id}`, { method: 'PATCH', body: { body: 'b' } });
  expect(parsePollReply((await waiting).json).upd.map((l) => l.body)).toEqual(['b']);
});

test('withdraw: only the newest line, yours, under fifteen minutes', async () => {
  await call('/api/chat', { method: 'POST', body: { name: 'ann', body: 'mine' } });
  await call('/api/chat', { method: 'POST', bid: OTHER, body: { name: 'bob', body: 'theirs' } });
  expect((await call('/api/chat/withdraw', { method: 'POST' })).json.deleted).toBe(0);
  const { json } = await call('/api/chat', { method: 'POST', body: { name: 'ann', body: 'again' } });
  const next = (await call('/api/chat?since=0&wait=0&limit=80')).json.next;
  expect((await call('/api/chat/withdraw', { method: 'POST' })).json.deleted).toBe(json.msg.id);
  expect(parsePollReply((await call(`/api/chat?since=${next - 1}&wait=0&limit=200`)).json).gone).toContain(json.msg.id);
});

test('reactions toggle per client, from the site\'s set only', async () => {
  const { json } = await call('/api/chat', { method: 'POST', body: { name: 'ann', body: 'a' } });
  const id = json.msg.id;
  expect((await call('/api/chat/react', { method: 'POST', body: { id, emoji: '👍', name: 'ann' } })).json).toEqual({ rx: { '👍': 1 }, mine: true });
  expect((await call('/api/chat/react', { method: 'POST', bid: OTHER, body: { id, emoji: '👍', name: 'bob' } })).json.rx).toEqual({ '👍': 2 });
  expect((await call('/api/chat/react', { method: 'POST', body: { id, emoji: '👍', name: 'ann' } })).json).toEqual({ rx: { '👍': 1 }, mine: false });
  expect((await call('/api/chat/react', { method: 'POST', body: { id, emoji: '🦄', name: 'ann' } })).status).toBe(400);
});

test('a vote counts once per client and can move', async () => {
  const first = parsePollReply((await call('/api/chat?since=0&wait=0&limit=80')).json);
  const poll = first.msgs.find((l) => l.poll)!;
  const a = await call('/api/chat/vote', { method: 'POST', body: { id: poll.id, opt: 0 } });
  const b = await call('/api/chat/vote', { method: 'POST', body: { id: poll.id, opt: 1 } });
  expect(a.json.mine).toBe(0);
  expect(b.json).toMatchObject({ mine: 1 });
  expect(b.json.poll.votes.reduce((x: number, y: number) => x + y, 0)).toBe(poll.poll!.votes.reduce((x, y) => x + y, 0) + 1);
});

test('typing shows to others, not to the typist, and n = 0 clears it', async () => {
  await call('/api/chat/typing', { method: 'POST', body: { name: 'ann', n: 9 } });
  expect(parsePollReply((await call('/api/chat?since=0&wait=0&limit=1', { bid: OTHER })).json).typing).toEqual([{ name: 'ann', n: 9 }]);
  expect(parsePollReply((await call('/api/chat?since=0&wait=0&limit=1')).json).typing).toEqual([]);
  await call('/api/chat/typing', { method: 'POST', body: { name: 'ann', n: 0 } });
  expect(parsePollReply((await call('/api/chat?since=0&wait=0&limit=1', { bid: OTHER })).json).typing).toEqual([]);
});

test('a name is reserved after a boop report, and guards its lines', async () => {
  const addr = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
  expect((await call('/api/name', { method: 'POST', body: { name: 'Ann', addr } })).status).toBe(409);
  expect((await call('/api/bubble/boop', { method: 'POST', body: { addr, pool: 1, n: 3, v: 6 } })).status).toBe(200);
  const r = await call('/api/name', { method: 'POST', body: { name: 'Ann', addr } });
  expect(r.json).toMatchObject({ name: 'Ann', addr });
  expect(r.json.key).toMatch(/^[0-9a-f]{32}$/); // as production's, 2026-10-12
  expect((await call('/api/chat', { method: 'POST', bid: OTHER, body: { name: 'ann', body: 'x' } })).status).toBe(403);
  const mine = await call('/api/chat', { method: 'POST', key: r.json.key, body: { name: 'Ann', body: 'y' } });
  expect(mine.json.msg).toMatchObject({ name: 'Ann', v: true });
  expect((await call('/api/name?name=ann')).json).toMatchObject({ name: 'Ann', reserved: true });
  expect((await call('/api/name', { method: 'POST', body: { name: 'Other', addr } })).json.error).toMatch(/holds the name Ann already/);
  expect((await call('/api/name', { method: 'DELETE', key: r.json.key })).status).toBe(200);
  expect((await call('/api/name', { method: 'DELETE', key: r.json.key })).status).toBe(404);
});

test('a boop older than 3 minutes no longer proves the wallet', async () => {
  const addr = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
  await call('/api/bubble/boop', { method: 'POST', body: { addr, pool: 1, n: 3, v: 6 } });
  clock += 181;
  expect((await call('/api/name', { method: 'POST', body: { name: 'Ann', addr } })).status).toBe(409);
});

test('the challenge is a phrase, as production answers it', async () => {
  const { status, json } = await call('/api/name/challenge');
  expect(status).toBe(200);
  expect(Object.keys(json)).toEqual(['words']);
  expect(typeof json.words).toBe('string');
});

test('a proof by another key, or of a phrase never handed out, is refused', async () => {
  const w = newTestWallet();
  const other = newTestWallet();
  const { json } = await call('/api/name/challenge');
  const link = (words: string) => buildChallengeLink({ challenge: words, signer: w.address, chainid: 'dev', callback: 'x://cb', state: 's' });
  const proofOf = (wallet: ReturnType<typeof newTestWallet>, words: string) => {
    const r = wallet.answer(link(words));
    return proofFromReply({ ...r, address: w.address }, w.address, 'dev');
  };
  const byOther = await call('/api/name', { method: 'POST', body: { name: 'Ann', ...proofOf(other, json.words) } });
  expect(byOther.status).toBe(409);
  expect(byOther.json.error).toMatch(/does not prove this wallet/);
  const unknown = await call('/api/name', { method: 'POST', body: { name: 'Ann', ...proofOf(w, 'a phrase nobody gave') } });
  expect(unknown.json.error).toMatch(/not one this box handed out/);
  const ok = await call('/api/name', { method: 'POST', body: { name: 'Ann', ...proofOf(w, json.words) } });
  expect(ok.status).toBe(200);
  // a phrase is good once
  const replay = await call('/api/name', { method: 'POST', body: { name: 'Bob', ...proofOf(newTestWallet(), json.words) } });
  expect(replay.status).toBe(409);
});

test('an avatar uploads, serves, and rides with a line', async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const up = await fetch(fake.url + '/api/avatar', { method: 'POST', headers: { 'X-Bid': ME, 'Content-Type': 'image/jpeg' }, body: bytes });
  const { id, key } = (await up.json()) as { id: string; key: string };
  const img = await fetch(`${fake.url}/api/avatar/${id}.jpg`);
  expect(new Uint8Array(await img.arrayBuffer())).toEqual(bytes);
  const line = await call('/api/chat', { method: 'POST', body: { name: 'ann', body: 'x', av: id, avkey: key } });
  expect(line.json.msg.av).toBe(id);
  const forged = await call('/api/chat', { method: 'POST', bid: OTHER, body: { name: 'bob', body: 'x', av: id, avkey: 'wrong' } });
  expect(forged.json.msg.av).toBeUndefined();
});

test('test routes: someone else speaks, gen moves, a 429 with Retry-After', async () => {
  await call('/__test/say', { method: 'POST', body: { name: 'zed', body: 'hi all' } });
  const first = parsePollReply((await call('/api/chat?since=0&wait=0&limit=80')).json);
  expect(first.msgs.at(-1)).toMatchObject({ name: 'zed', body: 'hi all' });
  await call('/__test/gen', { method: 'POST' });
  expect(parsePollReply((await call('/api/chat?since=0&wait=0&limit=1')).json).gen).toBe(first.gen! + 1);
  await call('/__test/fail', { method: 'POST', body: { status: 429, retryAfter: 3 } });
  const res = await fetch(fake.url + '/api/chat?since=0&wait=0&limit=1', { headers: { 'X-Bid': ME } });
  expect(res.status).toBe(429);
  expect(res.headers.get('Retry-After')).toBe('3');
});

test('fidelity: same reply keys and line field types as production', async () => {
  const prod = JSON.parse(readFileSync(join(__dirname, '../src/offchain/chat/__fixtures__/prod-first.json'), 'utf8'));
  const mine = (await call('/api/chat?since=0&wait=0&limit=80')).json;
  const kind = (x: unknown) => (Array.isArray(x) ? 'array' : x === null ? 'null' : typeof x);
  for (const k of ['msgs', 'next', 'gen', 'here', 'you', 'pins', 'now']) {
    expect([k, kind(mine[k])]).toEqual([k, kind(prod[k])]);
  }
  const prodTypes = new Map<string, string>();
  for (const l of prod.msgs) for (const [k, v] of Object.entries(l)) prodTypes.set(k, kind(v));
  for (const l of mine.msgs)
    for (const [k, v] of Object.entries(l)) if (prodTypes.has(k)) expect([k, kind(v)]).toEqual([k, prodTypes.get(k)]);
});

test('a restarted fake server is a new log (another gen)', async () => {
  const genOf = async (url: string) =>
    (await (await fetch(`${url}/api/chat?since=0&wait=0`, { headers: { 'X-Bid': 'aaaaaaaaaaaaaaaa' } })).json()).gen;
  const a = await startFakeServer(0);
  const first = await genOf(a.url);
  await a.close();
  await new Promise((r) => setTimeout(r, 5));
  const b = await startFakeServer(0);
  expect(await genOf(b.url)).not.toBe(first);
  await b.close();
});
