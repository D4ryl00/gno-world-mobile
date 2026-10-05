import { avatarUrl, createChatClient, REACTIONS } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import type { Offchain, RequestOptions } from '@/offchain/http';

function fakeOffchain(answer: unknown = {}) {
  const calls: { verb: string; path: string; body?: unknown; o?: RequestOptions }[] = [];
  const oc: Offchain = {
    get: async (path, o) => (calls.push({ verb: 'GET', path, o }), answer as never),
    post: async (path, body, o) => (calls.push({ verb: 'POST', path, body, o }), answer as never),
    patch: async (path, body, o) => (calls.push({ verb: 'PATCH', path, body, o }), answer as never),
    del: async (path, o) => (calls.push({ verb: 'DELETE', path, o }), answer as never),
  };
  return { oc, calls };
}
const reserved: ChatIdentity = { name: 'ann', nameKey: 'nk', reservedName: 'ann', av: 'a1', avkey: 'ak' };
const lineWire = { id: 7, t: 1, name: 'ann', tag: 'aaaa', body: 'hi' };

test('the reactions are the site\'s', () => {
  expect(REACTIONS).toEqual(['👍', '🔥', '❤️', '😂', '🤔', '🤝', '👎']);
});

test('poll builds the site\'s query and passes timeout and signal', async () => {
  const { oc, calls } = fakeOffchain({ msgs: [lineWire], next: 7, gen: 2 });
  const c = createChatClient(oc, async () => NO_IDENTITY);
  const signal = new AbortController().signal;
  const r = await c.poll({ since: 5, wait: 55, limit: 200, gen: 2 }, { timeoutMs: 70000, signal });
  expect(calls[0]).toMatchObject({ verb: 'GET', path: '/api/chat?since=5&wait=55&limit=200&gen=2', o: { timeoutMs: 70000, signal } });
  expect(r.msgs[0].id).toBe(7);
  await c.poll({ since: 0, wait: 0, limit: 80, gen: null }, { timeoutMs: 20000, signal });
  expect(calls[1].path).toBe('/api/chat?since=0&wait=0&limit=80');
});

test('older asks before an id', async () => {
  const { oc, calls } = fakeOffchain({ msgs: [lineWire], more: true });
  expect((await createChatClient(oc, async () => NO_IDENTITY).older(100)).more).toBe(true);
  expect(calls[0].path).toBe('/api/chat?before=100&limit=100');
});

test('post sends the name, the reply and the avatar, with the name key', async () => {
  const { oc, calls } = fakeOffchain({ msg: lineWire });
  const l = await createChatClient(oc, async () => reserved).post('ann', 'hi', 3);
  expect(l.id).toBe(7);
  expect(calls[0]).toMatchObject({
    verb: 'POST', path: '/api/chat', body: { name: 'ann', body: 'hi', re: 3, av: 'a1', avkey: 'ak' },
    o: { headers: { 'X-Name-Key': 'nk' } },
  });
});

test('post without a reply, an avatar or a key sends none of them', async () => {
  const { oc, calls } = fakeOffchain({ msg: lineWire });
  await createChatClient(oc, async () => NO_IDENTITY).post('anon', 'hi');
  expect(calls[0].body).toEqual({ name: 'anon', body: 'hi' });
  expect(calls[0].o?.headers).toEqual({});
});

test('post without a line in the answer is an error', async () => {
  const { oc } = fakeOffchain({});
  await expect(createChatClient(oc, async () => NO_IDENTITY).post('a', 'b')).rejects.toMatchObject({ status: 0 });
});

test('edit, withdraw, react, vote, typing', async () => {
  const run = async (answer: unknown, f: (c: ReturnType<typeof createChatClient>) => Promise<unknown>) => {
    const { oc, calls } = fakeOffchain(answer);
    const out = await f(createChatClient(oc, async () => reserved));
    return { out, call: calls[0] };
  };
  let r = await run({ msg: lineWire }, (c) => c.edit(7, 'new'));
  expect(r.call).toMatchObject({ verb: 'PATCH', path: '/api/chat?id=7', body: { body: 'new' }, o: { headers: { 'X-Name-Key': 'nk' } } });
  r = await run({ deleted: 7 }, (c) => c.withdraw());
  expect(r).toMatchObject({ out: 7, call: { verb: 'POST', path: '/api/chat/withdraw' } });
  expect((await run({ deleted: 0 }, (c) => c.withdraw())).out).toBeNull();
  r = await run({ rx: { '👍': 2 }, mine: true }, (c) => c.react(7, '👍', 'ann'));
  expect(r).toMatchObject({ out: { rx: { '👍': 2 }, mine: true }, call: { path: '/api/chat/react', body: { id: 7, emoji: '👍', name: 'ann' } } });
  r = await run({ mine: 1, poll: { q: 'q', opts: ['a', 'b'], votes: [0, 1] } }, (c) => c.vote(7, 1));
  expect(r).toMatchObject({ out: { mine: 1, poll: { votes: [0, 1] } }, call: { path: '/api/chat/vote', body: { id: 7, opt: 1 } } });
  r = await run({}, (c) => c.typing('ann', 12));
  expect(r.call).toMatchObject({ path: '/api/chat/typing', body: { name: 'ann', n: 12 } });
});

test('name, avatar and boop report', async () => {
  const { oc, calls } = fakeOffchain({ name: 'Ann', key: 'k64', addr: 'g1x', id: 'av1' });
  const c = createChatClient(oc, async () => reserved);
  expect(await c.reserveName('ann')).toEqual({ name: 'Ann', key: 'k64', addr: 'g1x' });
  await c.releaseName();
  const bytes = new Uint8Array([1]);
  await c.uploadAvatar(bytes, 'image/jpeg');
  await c.reportBoop('g1x', 12, 3, 6);
  expect(calls.map((x) => `${x.verb} ${x.path}`)).toEqual(['POST /api/name', 'DELETE /api/name', 'POST /api/avatar', 'POST /api/bubble/boop']);
  expect(calls[0].body).toEqual({ name: 'ann' });
  expect(calls[2].o).toMatchObject({ raw: { body: bytes, contentType: 'image/jpeg' }, headers: { 'X-Name-Key': 'nk' } });
  expect(calls[3].body).toEqual({ addr: 'g1x', pool: 12, n: 3, v: 6 });
});

test('a reservation answer without a key is an error', async () => {
  const { oc } = fakeOffchain({ name: 'ann' });
  await expect(createChatClient(oc, async () => NO_IDENTITY).reserveName('ann')).rejects.toBeTruthy();
});

test('avatar URLs follow the server', () => {
  expect(avatarUrl('https://bubblerumble.net/', 'hx4b')).toBe('https://bubblerumble.net/api/avatar/hx4b.jpg');
});
