import type { ChatClient, PollQuery } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import { unreadCount } from '@/offchain/chat/merge';
import { createChatStore, SEEN_KEY } from '@/offchain/chat/store';
import { line, reply } from '@/offchain/chat/testing';
import type { ChatPollReply } from '@/offchain/chat/types';
import { OffchainError } from '@/offchain/http';

// real timers: lets the loop's awaits (identity, kv, poll) settle; the stubbed sleep never waits
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Poll answers are queued; once the queue is empty a poll hangs until it is aborted. */
function harness(
  answers: (ChatPollReply | Error)[],
  opts: { identity?: ChatIdentity; seen?: string; kv?: Map<string, string>; scope?: string } = {},
) {
  const queries: PollQuery[] = [];
  const sleeps: number[] = [];
  const kv = opts.kv ?? new Map<string, string>(opts.seen ? [[SEEN_KEY, opts.seen]] : []);
  let ident: ChatIdentity = opts.identity ?? NO_IDENTITY;
  let clock = 1_000_000;
  const client = {
    poll: jest.fn((q: PollQuery, o: { signal: AbortSignal }) => {
      queries.push(q);
      const a = answers.shift();
      if (!a) return new Promise((_r, reject) => o.signal.addEventListener('abort', () => reject(new OffchainError(0, 'aborted'))));
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    }),
    older: jest.fn(),
    post: jest.fn(),
    edit: jest.fn(),
    withdraw: jest.fn(),
    react: jest.fn(),
    vote: jest.fn(),
    typing: jest.fn(async () => undefined),
    reserveName: jest.fn(),
    releaseName: jest.fn(),
    uploadAvatar: jest.fn(),
    reportBoop: jest.fn(),
  };
  const store = createChatStore({
    client: client as unknown as ChatClient,
    identity: { load: async () => ident, save: async (p) => (ident = { ...ident, ...p }) },
    kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) },
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    now: () => clock,
    scope: opts.scope === undefined ? undefined : () => opts.scope!,
  });
  return { store, client, queries, sleeps, kv, tick: (ms: number) => (clock += ms), setIdentity: (i: ChatIdentity) => (ident = i) };
}

test('the first poll takes the recent lines, the next ones wait on the cursor', async () => {
  const h = harness([reply({ msgs: [line(1), line(2)], next: 2, gen: 4 }), reply({ msgs: [line(3)], next: 3, gen: 4 })]);
  h.store.getState().start();
  await flush();
  expect(h.queries).toEqual([
    { since: 0, wait: 0, limit: 80, gen: null },
    { since: 2, wait: 55, limit: 200, gen: 4 },
    { since: 3, wait: 55, limit: 200, gen: 4 },
  ]);
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([1, 2, 3]);
  expect(h.store.getState().phase).toBe('live');
  h.store.getState().stop();
});

test('a new gen reloads from the start', async () => {
  const h = harness([reply({ msgs: [line(5)], next: 5, gen: 1 }), reply({ msgs: [line(9)], gen: 2 }), reply({ msgs: [line(1)], next: 1, gen: 2 })]);
  h.store.getState().start();
  await flush();
  expect(h.queries[2]).toEqual({ since: 0, wait: 0, limit: 80, gen: null });
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([1]);
  h.store.getState().stop();
});

test('429 waits Retry-After plus jitter and is not "unreachable"', async () => {
  const h = harness([new OffchainError(429, 'slow down', 7), reply({ msgs: [line(1)] })]);
  h.store.getState().start();
  await flush();
  expect(h.sleeps[0]).toBe(7000 + 0.5 * 6000);
  expect(h.store.getState().phase).toBe('live');
  h.store.getState().stop();
});

test('a network error shows unreachable and backs off, doubling', async () => {
  const down = () => new OffchainError(0, 'server unreachable');
  const h = harness([down(), down(), reply({ msgs: [line(1)] })]);
  const phases: string[] = [];
  h.store.subscribe((s) => phases.push(s.phase));
  h.store.getState().start();
  await flush();
  expect(h.sleeps).toEqual([2000, 4000]);
  expect(phases).toContain('unreachable');
  expect(h.store.getState().phase).toBe('live');
  h.store.getState().stop();
});

test('stop aborts the in-flight poll and polls no more', async () => {
  const h = harness([reply({ msgs: [line(1)] })]);
  h.store.getState().start();
  await flush();
  const n = h.queries.length;
  h.store.getState().stop();
  await flush();
  expect(h.queries.length).toBe(n);
  expect(h.client.poll.mock.calls[n - 1][1].signal.aborted).toBe(true);
});

test('start twice runs one loop', async () => {
  const h = harness([reply({ msgs: [line(1)] })]);
  h.store.getState().start();
  h.store.getState().start();
  await flush();
  expect(h.queries.filter((q) => q.wait === 0)).toHaveLength(1);
  h.store.getState().stop();
});

test('restart clears the view and loads again', async () => {
  const answers = [reply({ msgs: [line(1)] })];
  const h = harness(answers);
  h.store.getState().start();
  await flush();
  answers.push(reply({ msgs: [line(50)] })); // the old loop's long poll is hanging: only the new loop takes this
  h.store.getState().restart();
  await flush();
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([50]);
  h.store.getState().stop();
});

test('the first load is not unread; later lines are, and markSeen persists', async () => {
  const h = harness([reply({ msgs: [line(1), line(2)] }), reply({ msgs: [line(3), line(4, { tag: 'aaaa' })] })]);
  h.store.getState().start();
  await flush();
  const s = h.store.getState();
  expect(s.lastSeen).toBe(2);
  expect(unreadCount(s, s.lastSeen, s.mine)).toBe(1);
  s.markSeen();
  await flush();
  expect(h.store.getState().lastSeen).toBe(4);
  expect(h.kv.get(SEEN_KEY)).toBe('4');
  h.store.getState().stop();
});

test('a remembered last seen line survives a relaunch', async () => {
  const h = harness([reply({ msgs: [line(1), line(2), line(3)] })], { seen: '1' });
  h.store.getState().start();
  await flush();
  const s = h.store.getState();
  expect(unreadCount(s, s.lastSeen, s.mine)).toBe(2);
  s.stop();
});

test('send posts under the reserved name, adds the line and marks it mine', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'old', reservedName: 'Ann', nameKey: 'k' } });
  await h.store.ready;
  h.client.post.mockResolvedValue(line(8, { body: 'hi' }));
  expect(await h.store.getState().send('  hi  ', 3)).toBe(true);
  expect(h.client.post).toHaveBeenCalledWith('Ann', 'hi', 3);
  expect(h.store.getState()).toMatchObject({ mine: [8], error: '' });
  expect(h.store.getState().lines[0].id).toBe(8);
});

test('send falls back to the free name, then anon; an empty text sends nothing', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'bob' } });
  await h.store.ready;
  h.client.post.mockResolvedValue(line(1));
  await h.store.getState().send('x');
  expect(h.client.post).toHaveBeenLastCalledWith('bob', 'x', undefined);
  expect(await h.store.getState().send('   ')).toBe(false);
  expect(h.client.post).toHaveBeenCalledTimes(1);
  const anon = harness([]);
  await anon.store.ready;
  anon.client.post.mockResolvedValue(line(1));
  await anon.store.getState().send('x');
  expect(anon.client.post).toHaveBeenLastCalledWith('anon', 'x', undefined);
});

test('a refused post keeps an error with the server\'s words', async () => {
  const h = harness([]);
  await h.store.ready;
  h.client.post.mockRejectedValue(new OffchainError(403, '"Ann" is reserved — pick another name'));
  expect(await h.store.getState().send('hi')).toBe(false);
  expect(h.store.getState().error).toBe('"Ann" is reserved — pick another name');
  h.client.post.mockRejectedValue(new OffchainError(0, 'server unreachable (timed out)'));
  await h.store.getState().send('hi');
  expect(h.store.getState().error).toBe('The chat server did not answer — try again.');
  h.store.getState().clearError();
  expect(h.store.getState().error).toBe('');
});

test('typing is sent at most every 3 s, and cleared once', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  const s = h.store.getState();
  s.signalTyping(5);
  s.signalTyping(9);
  h.tick(3000);
  s.signalTyping(12);
  s.signalTyping(0);
  s.signalTyping(0);
  expect(h.client.typing.mock.calls).toEqual([['ann', 5], ['ann', 12], ['ann', 0]]);
});

test('withdraw removes the line, or says why it could not', async () => {
  const h = harness([reply({ msgs: [line(1), line(2)] })]);
  h.store.getState().start();
  await flush();
  h.client.withdraw.mockResolvedValueOnce(2);
  expect(await h.store.getState().withdraw()).toBe(true);
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([1]);
  h.client.withdraw.mockResolvedValueOnce(null);
  expect(await h.store.getState().withdraw()).toBe(false);
  expect(h.store.getState().error).toMatch(/newest line/);
  h.store.getState().stop();
});

test('react and vote apply the server\'s answer', async () => {
  const h = harness([reply({ msgs: [line(1), line(2, { poll: { q: 'q', opts: ['a', 'b'], votes: [0, 0] } })] })], {
    identity: { ...NO_IDENTITY, name: 'ann' },
  });
  h.store.getState().start();
  await flush();
  h.client.react.mockResolvedValueOnce({ rx: { '👍': 1 }, mine: true });
  await h.store.getState().react(1, '👍');
  expect(h.client.react).toHaveBeenCalledWith(1, '👍', 'ann');
  expect(h.store.getState().lines[0].rx).toEqual({ '👍': 1 });
  expect(h.store.getState().myReactions[1]).toEqual(['👍']);
  h.client.react.mockResolvedValueOnce({ rx: {}, mine: false });
  await h.store.getState().react(1, '👍');
  expect(h.store.getState().myReactions[1]).toEqual([]);
  h.client.vote.mockResolvedValueOnce({ mine: 1, poll: { q: 'q', opts: ['a', 'b'], votes: [0, 1] } });
  await h.store.getState().vote(2, 1);
  expect(h.store.getState().lines[1].poll?.votes).toEqual([0, 1]);
  expect(h.store.getState().myVotes[2]).toBe(1);
  h.store.getState().stop();
});

test('older lines load once at a time, before the oldest held', async () => {
  const h = harness([reply({ msgs: [line(10)] })]);
  h.store.getState().start();
  await flush();
  let release: (v: unknown) => void = () => undefined;
  h.client.older.mockReturnValueOnce(new Promise((r) => (release = r)));
  const a = h.store.getState().loadOlder();
  const b = h.store.getState().loadOlder();
  release({ msgs: [line(9)], more: false });
  await Promise.all([a, b]);
  expect(h.client.older).toHaveBeenCalledTimes(1);
  expect(h.client.older).toHaveBeenCalledWith(10);
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([9, 10]);
  await h.store.getState().loadOlder();
  expect(h.client.older).toHaveBeenCalledTimes(1); // no more history
  h.store.getState().stop();
});

test('reserving saves the key; releasing clears it', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockResolvedValueOnce({ name: 'Ann', key: 'k', addr: 'g1x' });
  expect(await h.store.getState().reserveName()).toBe(true);
  expect(h.client.reserveName).toHaveBeenCalledWith('ann');
  expect(h.store.getState().identity).toMatchObject({ name: 'Ann', reservedName: 'Ann', nameKey: 'k' });
  h.client.releaseName.mockResolvedValueOnce(undefined);
  expect(await h.store.getState().releaseName()).toBe(true);
  expect(h.store.getState().identity).toMatchObject({ reservedName: '', nameKey: '' });
});

test('a release the server does not know (404) still clears the local name', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'Ann', reservedName: 'Ann', nameKey: 'k' } });
  await h.store.ready;
  h.client.releaseName.mockRejectedValueOnce(new OffchainError(404, 'no reserved name for this key'));
  expect(await h.store.getState().releaseName()).toBe(true);
  expect(h.store.getState().identity.nameKey).toBe('');
});

test('setName is refused while a name is reserved', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'Ann', reservedName: 'Ann', nameKey: 'k' } });
  await h.store.ready;
  await h.store.getState().setName('bob');
  expect(h.store.getState().identity.name).toBe('Ann');
  const free = harness([]);
  await free.store.ready;
  await free.store.getState().setName('  bob ');
  expect(free.store.getState().identity.name).toBe('bob');
});

test('an avatar upload keeps its id and key', async () => {
  const h = harness([]);
  await h.store.ready;
  h.client.uploadAvatar.mockResolvedValueOnce({ id: 'a1', key: 'ak' });
  expect(await h.store.getState().setAvatar(new Uint8Array([1]), 'image/jpeg')).toBe(true);
  expect(h.store.getState().identity).toMatchObject({ av: 'a1', avkey: 'ak' });
});

test('a last seen line beyond the newest one is stale (another server, a log reset): the newest is seen', async () => {
  const h = harness([reply({ msgs: [line(1), line(2), line(3)] }), reply({ msgs: [line(4)] })], { seen: '9068' });
  h.store.getState().start();
  await flush();
  const s = h.store.getState();
  expect(s.lastSeen).toBe(3);
  expect(unreadCount(s, s.lastSeen, s.mine)).toBe(1);
  s.stop();
});

test('each server keeps its own last seen line', async () => {
  const kv = new Map<string, string>();
  const a = harness([reply({ msgs: [line(50)] })], { kv, scope: 'https://a' });
  a.store.getState().start();
  await flush();
  a.store.getState().stop();
  const b = harness([reply({ msgs: [line(1), line(2)] })], { kv, scope: 'https://b' });
  b.store.getState().start();
  await flush();
  expect(b.store.getState().lastSeen).toBe(2);
  expect([...kv.keys()].sort()).toEqual([`${SEEN_KEY}:https://a`, `${SEEN_KEY}:https://b`]);
  b.store.getState().stop();
});

test('after a restart on another server, new lines count as unread again', async () => {
  const answers = [reply({ msgs: [line(9000)] })];
  const h = harness(answers);
  h.store.getState().start();
  await flush();
  answers.push(reply({ msgs: [line(1), line(2)] }), reply({ msgs: [line(3)] }));
  h.store.getState().restart();
  await flush();
  const s = h.store.getState();
  expect(s.lastSeen).toBe(2);
  expect(unreadCount(s, s.lastSeen, s.mine)).toBe(1);
  s.stop();
});

test('an older page that answers after a restart (another server) is dropped', async () => {
  const answers = [reply({ msgs: [line(10)] })];
  const h = harness(answers);
  h.store.getState().start();
  await flush();
  let release: (v: unknown) => void = () => undefined;
  h.client.older.mockReturnValueOnce(new Promise((r) => (release = r)));
  const pending = h.store.getState().loadOlder();
  answers.push(reply({ msgs: [line(20)] }));
  h.store.getState().restart();
  await flush();
  release({ msgs: [line(9)], more: true });
  await pending;
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([20]);
  h.store.getState().stop();
});

test('a post that answers after a restart neither adds its line nor marks that id mine', async () => {
  const answers = [reply({ msgs: [line(10)] })];
  const h = harness(answers);
  h.store.getState().start();
  await flush();
  let release: (v: unknown) => void = () => undefined;
  h.client.post.mockReturnValueOnce(new Promise((r) => (release = r)));
  const pending = h.store.getState().send('hello');
  answers.push(reply({ msgs: [line(20)] }));
  h.store.getState().restart();
  await flush();
  release(line(11, { body: 'hello' }));
  await pending;
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([20]);
  expect(h.store.getState().mine).toEqual([]);
  h.store.getState().stop();
});

test('a restart (another server) reloads the identity: a reservation made elsewhere is not shown', async () => {
  const h = harness([reply({ msgs: [line(1)] })], { identity: { ...NO_IDENTITY, name: 'ann', reservedName: 'ann', nameKey: 'k' } });
  await h.store.ready;
  expect(h.store.getState().identity.reservedName).toBe('ann');
  h.setIdentity({ ...NO_IDENTITY, name: 'ann' }); // what the identity store holds for the new server
  h.store.getState().restart();
  await flush();
  expect(h.store.getState().identity).toEqual({ ...NO_IDENTITY, name: 'ann' });
  h.store.getState().stop();
});
