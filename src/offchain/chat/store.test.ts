import type { ChatClient, PollQuery } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import { unreadCount } from '@/offchain/chat/merge';
import { createChatStore, MARKS_KEY, SEEN_KEY, seenKeyFor } from '@/offchain/chat/store';
import { line, reply } from '@/offchain/chat/testing';
import type { ChatPollReply, RoomInvite } from '@/offchain/chat/types';
import { OffchainError } from '@/offchain/http';

// real timers: lets the loop's awaits (identity, kv, poll) settle; the stubbed sleep never waits
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Poll answers are queued; once the queue is empty a poll hangs until it is aborted. */
function harness(
  answers: (ChatPollReply | Error)[],
  opts: {
    identity?: ChatIdentity; seen?: string; kv?: Map<string, string>; scope?: string; room?: string;
    onInvites?: (dm: RoomInvite[]) => void; onPosted?: () => void;
  } = {},
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
    nameChallenge: jest.fn(),
    proveName: jest.fn(),
    releaseName: jest.fn(),
    uploadAvatar: jest.fn(),
    reportBoop: jest.fn(),
    pin: jest.fn(),
    deleteLine: jest.fn(),
  };
  const store = createChatStore({
    client: client as unknown as ChatClient,
    identity: () => ident,
    kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) },
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0.5,
    now: () => clock,
    scope: opts.scope === undefined ? undefined : () => opts.scope!,
    room: opts.room,
    onInvites: opts.onInvites,
    onPosted: opts.onPosted,
  });
  return { store, client, queries, sleeps, kv, tick: (ms: number) => (clock += ms), setIdentity: (i: ChatIdentity) => (ident = i) };
}

test('the first poll takes the recent lines, the next ones wait on the cursor', async () => {
  const h = harness([reply({ msgs: [line(1), line(2)], next: 2, gen: 4 }), reply({ msgs: [line(3)], next: 3, gen: 4 })]);
  h.store.getState().start();
  await flush();
  expect(h.queries).toMatchObject([
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
  expect(h.queries[2]).toMatchObject({ since: 0, wait: 0, limit: 80, gen: null });
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
  expect(h.kv.get(SEEN_KEY)).toBe('1:4');
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

test('a new gen forgets the lines this app posted, its reactions and its votes', async () => {
  const h = harness([reply({ msgs: [line(10)], gen: 1 }), reply({ gen: 2 }), reply({ msgs: [line(11, { tag: 'cccc' })], gen: 2 })]);
  h.client.post.mockResolvedValueOnce(line(11, { tag: 'zzzz' }));
  h.client.react.mockResolvedValueOnce({ rx: { '❤️': 1 }, mine: true });
  h.client.vote.mockResolvedValueOnce({ mine: 0, poll: undefined });
  await h.store.ready;
  await h.store.getState().send('hello');
  await h.store.getState().react(10, '❤️');
  await h.store.getState().vote(10, 0);
  expect(h.store.getState().mine).toEqual([11]);
  h.store.getState().start();
  await flush();
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([11]);
  expect(h.store.getState().mine).toEqual([]);
  expect(h.store.getState().myReactions).toEqual({});
  expect(h.store.getState().myVotes).toEqual({});
  h.store.getState().stop();
});

test('a seen mark from another gen is not trusted: the new log\'s backlog is seen', async () => {
  const kv = new Map([[SEEN_KEY, '1:2']]);
  const h = harness([reply({ msgs: [line(1), line(2), line(3), line(4), line(5)], gen: 2 })], { kv });
  h.store.getState().start();
  await flush();
  expect(h.store.getState().lastSeen).toBe(5);
  expect(kv.get(SEEN_KEY)).toBe('2:5');
  h.store.getState().stop();
});

test('a seen mark of the same gen is kept; an old plain mark is read as before', async () => {
  const kv = new Map([[SEEN_KEY, '2:3']]);
  const h = harness([reply({ msgs: [line(1), line(2), line(3), line(4), line(5)], gen: 2 })], { kv });
  h.store.getState().start();
  await flush();
  expect(h.store.getState().lastSeen).toBe(3);
  h.store.getState().stop();
  const kv2 = new Map([[SEEN_KEY, '3']]);
  const h2 = harness([reply({ msgs: [line(1), line(2), line(3), line(4), line(5)], gen: 2 })], { kv: kv2 });
  h2.store.getState().start();
  await flush();
  expect(h2.store.getState().lastSeen).toBe(3);
  expect(kv2.get(SEEN_KEY)).toBe('2:3'); // rewritten with its gen
  h2.store.getState().stop();
});

test('start after stop resumes from the cursor: the view stays', async () => {
  const answers = [reply({ msgs: [line(1), line(2)], next: 2 })];
  const h = harness(answers);
  h.store.getState().start();
  await flush();
  h.store.getState().stop();
  answers.push(reply({ msgs: [line(3)], next: 3 }));
  h.store.getState().start();
  await flush();
  expect(h.queries.at(-2)).toMatchObject({ since: 2, wait: 55, gen: 1 });
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([1, 2, 3]);
  h.store.getState().stop();
});

test('resume catches up past one page', async () => {
  const answers = [reply({ msgs: [line(1)], next: 1 })];
  const h = harness(answers);
  h.store.getState().start();
  await flush();
  h.store.getState().stop();
  const page = Array.from({ length: 200 }, (_, i) => line(i + 2));
  answers.push(reply({ msgs: page, next: 201 }), reply({ msgs: [line(202)], next: 202 }));
  h.store.getState().start();
  await flush();
  expect(h.store.getState().lines.at(-1)?.id).toBe(202);
  expect(h.store.getState().lines[0].id).toBe(1); // kept: a resume, not a reload
  h.store.getState().stop();
});

test('a resume that meets a new gen reloads and forgets', async () => {
  const answers = [reply({ msgs: [line(10)], gen: 1 })];
  const h = harness(answers);
  h.client.post.mockResolvedValueOnce(line(11));
  h.store.getState().start();
  await flush();
  await h.store.getState().send('hi');
  h.store.getState().stop();
  answers.push(reply({ gen: 2 }), reply({ msgs: [line(7)], gen: 2 }));
  h.store.getState().start();
  await flush();
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([7]);
  expect(h.store.getState().mine).toEqual([]);
  h.store.getState().stop();
});

test('own reactions and votes of this log come back after a relaunch; another gen\'s do not', async () => {
  const kv = new Map([[MARKS_KEY, JSON.stringify({ gen: 1, rx: { 5: ['❤️'] }, votes: { 7: 1 } })]]);
  const h = harness([reply({ msgs: [line(5), line(7)], gen: 1 })], { kv });
  h.store.getState().start();
  await flush();
  expect(h.store.getState().myReactions).toEqual({ 5: ['❤️'] });
  expect(h.store.getState().myVotes).toEqual({ 7: 1 });
  h.store.getState().stop();
  const h2 = harness([reply({ msgs: [line(5)], gen: 2 })], { kv: new Map(kv) });
  h2.store.getState().start();
  await flush();
  expect(h2.store.getState().myReactions).toEqual({});
  h2.store.getState().stop();
});

test('a reaction and a vote are remembered with their gen', async () => {
  const h = harness([reply({ msgs: [line(5)], gen: 1 })]);
  h.store.getState().start();
  await flush();
  h.client.react.mockResolvedValueOnce({ rx: { '🔥': 1 }, mine: true });
  await h.store.getState().react(5, '🔥');
  h.client.vote.mockResolvedValueOnce({ mine: 0, poll: undefined });
  await h.store.getState().vote(5, 0);
  expect(JSON.parse(h.kv.get(MARKS_KEY)!)).toEqual({ gen: 1, rx: { 5: ['🔥'] }, votes: { 5: 0 } });
  h.store.getState().stop();
});

test('the remembered marks keep the newest 400 lines', async () => {
  const rx: Record<number, string[]> = {};
  for (let id = 1; id <= 400; id++) rx[id] = ['👍'];
  const kv = new Map([[MARKS_KEY, JSON.stringify({ gen: 1, rx, votes: {} })]]);
  const h = harness([reply({ msgs: [line(401)], gen: 1 })], { kv });
  h.store.getState().start();
  await flush();
  h.client.react.mockResolvedValueOnce({ rx: { '👍': 1 }, mine: true });
  await h.store.getState().react(401, '👍');
  const kept = JSON.parse(h.kv.get(MARKS_KEY)!).rx;
  expect(Object.keys(kept)).toHaveLength(400);
  expect(kept[1]).toBeUndefined();
  expect(kept[401]).toEqual(['👍']);
  h.store.getState().stop();
});

test('an edit that changes nothing sends nothing', async () => {
  const h = harness([reply({ msgs: [line(5, { body: 'same' })] })]);
  h.store.getState().start();
  await flush();
  expect(await h.store.getState().edit(5, '  same ')).toBe(true);
  expect(h.client.edit).not.toHaveBeenCalled();
  h.store.getState().stop();
});

const ROOM = 'AAAAAAAAAAAAAAAAAAAA';

test('a room keeps its own seen mark and marks', async () => {
  const kv = new Map<string, string>();
  const h = harness([reply({ msgs: [line(1), line(2)], gen: 3 })], { kv, scope: 'S', room: ROOM });
  h.store.getState().start();
  await flush();
  expect(kv.get(`${SEEN_KEY}:S:${ROOM}`)).toBe('3:2');
  expect(seenKeyFor('S', ROOM)).toBe(`${SEEN_KEY}:S:${ROOM}`);
  expect(seenKeyFor('S', '')).toBe(`${SEEN_KEY}:S`);
  h.client.react.mockResolvedValueOnce({ rx: { '👍': 1 }, mine: true });
  await h.store.getState().react(2, '👍');
  expect(kv.has(`${MARKS_KEY}:S:${ROOM}`)).toBe(true);
  expect(kv.has(`${SEEN_KEY}:S`)).toBe(false);
  expect(kv.has(`${MARKS_KEY}:S`)).toBe(false);
  h.store.getState().stop();
});

test('the poll sends the current display name', async () => {
  const h = harness([reply({ next: 1 }), reply({ next: 2 })], { identity: { ...NO_IDENTITY, name: 'bob' } });
  h.store.getState().start();
  await flush();
  expect(h.queries[0].name).toBe('bob');
  h.setIdentity({ ...NO_IDENTITY, name: 'bob', reservedName: 'Bobby' });
  h.store.getState().stop();
  h.store.getState().start();
  await flush();
  expect(h.queries.at(-1)!.name).toBe('Bobby');
  h.store.getState().stop();
});

test('the poll\'s room name is kept', async () => {
  const h = harness([reply({ roomName: 'Dev chat' })], { room: ROOM });
  h.store.getState().start();
  await flush();
  expect(h.store.getState().roomName).toBe('Dev chat');
  h.store.getState().stop();
});

test('three 404 polls 20 s apart make the room gone and stop polling; a success in between resets the count', async () => {
  const nf = () => new OffchainError(404, 'no such room');
  const h = harness([nf(), nf(), reply({ next: 1 }), nf(), nf(), nf()], { room: ROOM });
  h.store.getState().start();
  await flush();
  expect(h.store.getState().gone).toBe(true);
  expect(h.store.getState().phase).toBe('idle');
  expect(h.sleeps.filter((ms) => ms === 20_000)).toHaveLength(4);
  expect(h.queries).toHaveLength(6);
});

test('Public is never gone: a 404 there is an unreachable server', async () => {
  const h = harness([new OffchainError(404, 'x'), new OffchainError(404, 'x'), new OffchainError(404, 'x')]);
  h.store.getState().start();
  await flush();
  expect(h.store.getState().gone).toBe(false);
  h.store.getState().stop();
});

test('pin replaces the pins and patches the line; deleteLine removes it; refusals set error', async () => {
  const h = harness([reply({ msgs: [line(1), line(2)] })], { room: ROOM });
  h.store.getState().start();
  await flush();
  h.client.pin.mockResolvedValueOnce({ pins: [line(2, { pinned: true })] });
  await h.store.getState().pin(2, true);
  expect(h.client.pin).toHaveBeenCalledWith(2, true);
  expect(h.store.getState().pins.map((l) => l.id)).toEqual([2]);
  expect(h.store.getState().lines.find((l) => l.id === 2)?.pinned).toBe(true);
  h.client.deleteLine.mockResolvedValueOnce(undefined);
  await h.store.getState().deleteLine(1);
  expect(h.store.getState().lines.map((l) => l.id)).toEqual([2]);
  h.client.deleteLine.mockRejectedValueOnce(new OffchainError(403, 'only the room\'s maker can do that'));
  await h.store.getState().deleteLine(2);
  expect(h.store.getState().error).toBe('only the room\'s maker can do that');
  h.store.getState().stop();
});

test('Public hands each poll\'s invitations to onInvites; a room does not', async () => {
  const dm: RoomInvite[] = [{ room: ROOM, name: 'x', from: 'bob', at: 5 }];
  const got: RoomInvite[][] = [];
  const pub = harness([reply({ dm })], { onInvites: (d) => got.push(d) });
  pub.store.getState().start();
  await flush();
  expect(got).toEqual([dm]);
  pub.store.getState().stop();
  const inRoom: RoomInvite[][] = [];
  const r = harness([reply({ dm })], { room: ROOM, onInvites: (d) => inRoom.push(d) });
  r.store.getState().start();
  await flush();
  expect(inRoom).toEqual([]);
  r.store.getState().stop();
});

test('onPosted is called after a successful send only', async () => {
  const onPosted = jest.fn();
  const h = harness([], { room: ROOM, onPosted });
  await h.store.ready;
  h.client.post.mockRejectedValueOnce(new OffchainError(403, 'no'));
  await h.store.getState().send('hi');
  expect(onPosted).not.toHaveBeenCalled();
  h.client.post.mockResolvedValueOnce(line(4));
  await h.store.getState().send('hi');
  expect(onPosted).toHaveBeenCalledTimes(1);
});

test('a loop stopped before it got going stays stopped', async () => {
  const h = harness([]);
  h.store.getState().start();
  h.store.getState().stop();
  await flush();
  expect(h.store.getState().phase).toBe('idle');
  expect(h.queries).toHaveLength(0);
});
