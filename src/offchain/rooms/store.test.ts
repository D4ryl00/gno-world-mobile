import type { ChatClient, PollQuery } from '@/offchain/chat/client';
import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createChatStore, seenKeyFor } from '@/offchain/chat/store';
import { line, reply } from '@/offchain/chat/testing';
import type { ChatPollReply } from '@/offchain/chat/types';
import { OffchainError } from '@/offchain/http';
import type { ListedRoom, RoomsClient } from '@/offchain/rooms/client';
import { createRoomsStore, NOT_A_LINK, NOT_JOINED, NO_ANSWER } from '@/offchain/rooms/store';
import { EMPTY_BOOK, type Book, type BookStore } from '@/offchain/sync/rooms';

const id = (n: number) => `room${String(n).padStart(16, '0')}`; // 20 characters
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

/** A room's chat client whose poll waits until aborted, or answers what `answers[room]` holds. */
function chatClient(room: string, polls: Record<string, PollQuery[]>, answers: Record<string, (ChatPollReply | Error)[]>) {
  return {
    poll: jest.fn((q: PollQuery, o: { signal: AbortSignal }) => {
      (polls[room] ??= []).push(q);
      const a = answers[room]?.shift();
      if (!a) return new Promise((_r, reject) => o.signal.addEventListener('abort', () => reject(new OffchainError(0, 'aborted'))));
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a);
    }),
    post: jest.fn(async () => line(50)),
    typing: jest.fn(async () => undefined),
  } as unknown as ChatClient;
}

function harness(o: { book?: Book; listed?: ListedRoom[] } = {}) {
  let held: Book = o.book ?? EMPTY_BOOK;
  const book: BookStore = { load: async () => held, save: async (b) => void (held = b), update: async (f) => (held = f(held)) };
  const kv = new Map<string, string>();
  const kvs = { getItem: async (k: string) => kv.get(k) ?? null, setItem: async (k: string, v: string) => void kv.set(k, v) };
  const polls: Record<string, PollQuery[]> = {};
  const answers: Record<string, (ChatPollReply | Error)[]> = {};
  let clock = 10_000_000;
  const client = {
    make: jest.fn(),
    info: jest.fn(),
    listPublic: jest.fn(async () => o.listed ?? []),
    setRoom: jest.fn(async () => ({})),
    dropRoom: jest.fn(async () => undefined),
    invite: jest.fn(),
    scan: jest.fn(),
  };
  const made: string[] = [];
  const syncChanged = jest.fn();
  const timers: (() => void)[] = [];
  const publicStore = createChatStore({ client: chatClient('', polls, answers), identity: () => NO_IDENTITY, kv: kvs, scope: () => 'S' });
  const rooms = createRoomsStore({
    client: client as unknown as RoomsClient, book, publicStore, kv: kvs, scope: () => 'S',
    makeRoomStore: (room, onPosted) => {
      made.push(room);
      return createChatStore({
        client: chatClient(room, polls, answers), identity: () => NO_IDENTITY, kv: kvs, scope: () => 'S', room, onPosted,
        sleep: async () => undefined,
      });
    },
    syncChanged,
    now: () => clock,
    setInterval: ((f: () => void) => (timers.push(f), timers.length)) as unknown as typeof setInterval,
    clearInterval: ((n: number) => void (timers[n - 1] = () => undefined)) as unknown as typeof clearInterval,
  });
  return {
    rooms, client, book: () => held, bookStore: book, kv, polls, answers, made, syncChanged, timers, publicStore,
    tick: (ms: number) => (clock += ms), now: () => clock,
  };
}
const entry = (n: number, p: Partial<Book['rooms'][number]> = {}) => ({ id: id(n), name: `r${n}`, key: '', at: 1000 + n, ...p });
const phase = (h: ReturnType<typeof harness>, room: string) => h.rooms.getState().room(room).getState().phase;

test('focus starts one room loop and stops the previous; focus(\'\') stops it; blur only stops the focused one', async () => {
  const h = harness();
  h.rooms.getState().resume();
  h.rooms.getState().focus(id(1));
  await flush();
  expect(phase(h, id(1))).toBe('loading');
  h.rooms.getState().focus(id(2));
  await flush();
  expect(phase(h, id(1))).toBe('idle');
  expect(phase(h, id(2))).toBe('loading');
  h.rooms.getState().blur(id(1));
  expect(phase(h, id(2))).toBe('loading');
  h.rooms.getState().focus('');
  expect(phase(h, id(2))).toBe('idle');
  expect(h.rooms.getState().focused).toBe('');
  h.rooms.getState().focus(id(3));
  h.rooms.getState().blur(id(3));
  expect(phase(h, id(3))).toBe('idle');
  expect(h.rooms.getState().room('')).toBe(h.publicStore);
});

test('while paused, focus waits for resume', async () => {
  const h = harness();
  h.rooms.getState().focus(id(1));
  expect(phase(h, id(1))).toBe('idle');
  h.rooms.getState().resume();
  await flush();
  expect(phase(h, id(1))).toBe('loading');
  h.rooms.getState().pause();
  expect(phase(h, id(1))).toBe('idle');
});

test('room() alone never drops a store (screens call it while rendering); a focus keeps 8, never the focused one, and counts the drop', async () => {
  const h = harness();
  h.rooms.getState().resume();
  h.rooms.getState().focus(id(0));
  const first = h.rooms.getState().room(id(0));
  for (let n = 1; n <= 8; n++) h.rooms.getState().room(id(n));
  expect(h.rooms.getState().dropped).toBe(0);
  h.rooms.getState().focus(id(1)); // nine stores: the least recently opened one goes
  expect(h.rooms.getState().dropped).toBe(1);
  expect(h.rooms.getState().room(id(0))).not.toBe(first);
  expect(h.made.filter((m) => m === id(1))).toHaveLength(1);
});

test('join: a link is remembered and returned', async () => {
  const h = harness();
  h.client.info.mockResolvedValueOnce({ id: id(1), name: 'gnomes', listed: true, here: 2, made: 1 });
  expect(await h.rooms.getState().join(`https://gno.world/#r/${id(1)}&ref=g1x`)).toEqual({ id: id(1) });
  expect(h.book().rooms[0]).toMatchObject({ id: id(1), name: 'gnomes', key: '' });
  expect(h.rooms.getState().book.rooms[0].id).toBe(id(1));
  expect(h.syncChanged).toHaveBeenCalled();
});

test('join: gone forgets the room and says the site\'s message; a network error says the box did not answer; junk is not a link', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  h.client.info.mockResolvedValueOnce('gone');
  expect(await h.rooms.getState().join(id(1))).toEqual({ error: 'no such room — the link may be wrong, or the room was quiet for a month and is gone' });
  expect(h.book().rooms).toEqual([]);
  h.client.info.mockRejectedValueOnce(new OffchainError(0, 'timed out'));
  expect(await h.rooms.getState().join(id(2))).toEqual({ error: NO_ANSWER });
  expect(NO_ANSWER).toBe('the box did not answer about that room — try again in a moment');
  expect(await h.rooms.getState().join('hello')).toEqual({ error: NOT_A_LINK });
  expect(NOT_A_LINK).toBe('that is not a room link');
});

test('make remembers the room with its key and calls syncChanged', async () => {
  const h = harness();
  h.client.make.mockResolvedValueOnce({ id: id(1), name: 'gnomes', key: 'k1' });
  expect(await h.rooms.getState().make('gnomes', true)).toEqual({ id: id(1) });
  expect(h.client.make).toHaveBeenCalledWith('gnomes', true);
  expect(h.rooms.getState().keyOf(id(1))).toBe('k1');
  expect(h.syncChanged).toHaveBeenCalled();
  h.client.make.mockRejectedValueOnce(new OffchainError(429, 'slow down — one room a minute'));
  expect(await h.rooms.getState().make('again', false)).toEqual({ error: 'slow down — one room a minute' });
});

test('leave stops and drops the store and writes left', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  h.rooms.getState().resume();
  await flush();
  h.rooms.getState().focus(id(1));
  const s = h.rooms.getState().room(id(1));
  await h.rooms.getState().leave(id(1));
  expect(s.getState().phase).toBe('idle');
  expect(h.rooms.getState().focused).toBe('');
  expect(h.book().rooms).toEqual([]);
  expect(h.book().left[id(1)]).toBe(h.now());
  expect(h.rooms.getState().room(id(1))).not.toBe(s);
});

test('rename with the key renames for everyone; without it only the label changes and the words say so', async () => {
  const h = harness({ book: { rooms: [entry(1, { key: 'k1' }), entry(2)], left: {} } });
  await h.rooms.getState().reloadBook();
  h.client.setRoom.mockResolvedValueOnce({ name: 'New' });
  expect(await h.rooms.getState().rename(id(1), 'New')).toBe('renamed to "New"');
  expect(h.client.setRoom).toHaveBeenCalledWith(id(1), 'k1', { name: 'New' });
  expect(h.book().rooms.find((r) => r.id === id(1))?.name).toBe('New');
  expect(await h.rooms.getState().rename(id(2), 'Mine')).toBe(
    'renamed to "Mine" for you (the room\'s maker or the owner renames it for everyone)',
  );
  expect(h.client.setRoom).toHaveBeenCalledTimes(1);
  expect(h.book().rooms.find((r) => r.id === id(2))?.name).toBe('Mine');
});

test('setListed, drop and invite use the key and return the server\'s words on refusal; drop leaves', async () => {
  const h = harness({ book: { rooms: [entry(1, { key: 'k1', name: 'gnomes' })], left: {} } });
  await h.rooms.getState().reloadBook();
  expect(await h.rooms.getState().setListed(id(1), true)).toBe('');
  expect(h.client.setRoom).toHaveBeenCalledWith(id(1), 'k1', { listed: true });
  h.client.setRoom.mockRejectedValueOnce(new OffchainError(403, 'that key does not open this room'));
  expect(await h.rooms.getState().setListed(id(1), false)).toBe('that key does not open this room');
  h.client.invite.mockResolvedValueOnce({ to: 'bob' });
  expect(await h.rooms.getState().invite(id(1), 'bob', '')).toBe('bob gets "gnomes" on their next poll');
  expect(h.client.invite).toHaveBeenCalledWith(id(1), 'k1', 'bob', '');
  h.client.invite.mockRejectedValueOnce(new OffchainError(404, 'nobody spoke as bob lately'));
  expect(await h.rooms.getState().invite(id(1), 'bob', '')).toBe('nobody spoke as bob lately');
  expect(await h.rooms.getState().drop(id(1))).toBe('');
  expect(h.client.dropRoom).toHaveBeenCalledWith(id(1), 'k1');
  expect(h.book().rooms).toEqual([]);
});

test('onInvites remembers the room; under an hour and unseen it sets invited and banner; older or already seen does not', async () => {
  const h = harness();
  const at = Math.floor(h.now() / 1000) - 60;
  h.rooms.getState().onInvites([{ room: id(1), name: 'party', from: 'bob', at }]);
  await flush();
  expect(h.book().rooms[0]).toMatchObject({ id: id(1), name: 'party' });
  expect(h.rooms.getState().invited).toEqual({ [id(1)]: 'bob' });
  expect(h.rooms.getState().banner).toEqual({ id: id(1), name: 'party', from: 'bob' });
  h.rooms.getState().dismissBanner();
  h.rooms.getState().onInvites([{ room: id(1), name: 'party', from: 'bob', at }]);
  await flush();
  expect(h.rooms.getState().banner).toBeNull();
  h.rooms.getState().onInvites([{ room: id(2), name: 'old', from: 'cat', at: at - 7200 }]);
  await flush();
  expect(h.book().rooms.map((r) => r.id)).toContain(id(2));
  expect(h.rooms.getState().invited[id(2)]).toBeUndefined();
  expect(h.rooms.getState().banner).toBeNull();
});

test('an invitation to a room left since is not taken back', async () => {
  const g = harness({ book: { rooms: [], left: { [id(1)]: 10_000_000 } } });
  const at = Math.floor(g.now() / 1000) - 60;
  await g.rooms.getState().reloadBook();
  g.rooms.getState().onInvites([{ room: id(1), name: 'party', from: 'bob', at }]);
  await flush();
  expect(g.book().rooms).toEqual([]);
  expect(g.rooms.getState().banner).toBeNull();
});

test('open clears the room\'s invitation and unread count, and leaves the long-poll to the screens', async () => {
  const h = harness();
  h.rooms.setState({ invited: { [id(1)]: 'bob' }, unread: { [id(1)]: 4 } });
  h.rooms.getState().open(id(1));
  expect(h.rooms.getState().focused).toBe('');
  expect(h.rooms.getState().invited).toEqual({});
  expect(h.rooms.getState().unreadOf(id(1))).toBe(0);
});

test('a second screen claiming the room keeps it polling when the first lets go', async () => {
  const h = harness();
  h.rooms.getState().resume();
  // the full screen mounts and claims before the card under it loses the focus
  h.rooms.getState().focus(id(1));
  h.rooms.getState().focus(id(1));
  h.rooms.getState().blur(id(1));
  await flush();
  expect(h.rooms.getState().focused).toBe(id(1));
  expect(phase(h, id(1))).toBe('loading');
  h.rooms.getState().blur(id(1));
  expect(phase(h, id(1))).toBe('idle');
  expect(h.rooms.getState().focused).toBe('');
});

test('leaving a room keeps what was read: its count is the live one, not the scan\'s from before', async () => {
  const h = harness();
  h.rooms.getState().resume();
  h.rooms.setState({ unread: { [id(1)]: 5 } });
  h.rooms.getState().focus(id(1));
  const s = h.rooms.getState().room(id(1));
  s.setState({ lines: [line(1), line(2)], lastSeen: 2 });
  h.rooms.getState().focus(id(2));
  expect(h.rooms.getState().unreadOf(id(1))).toBe(0);
  h.rooms.setState({ unread: { [id(2)]: 3 } });
  h.rooms.getState().room(id(2)).setState({ lines: [line(7)], lastSeen: 7 });
  h.rooms.getState().blur(id(2));
  expect(h.rooms.getState().unreadOf(id(2))).toBe(0);
});

test('scanAll counts lines past the mark that are not mine, skips the focused room, marks 404 rooms gone without forgetting', async () => {
  const h = harness({ book: { rooms: [entry(1), entry(2), entry(3)], left: {} } });
  await h.rooms.getState().reloadBook();
  h.kv.set(seenKeyFor('S', id(1)), '7:10');
  h.kv.set(seenKeyFor('S', id(3)), '20');
  h.rooms.getState().focus(id(2));
  h.client.scan.mockImplementation(async (room: string) => {
    if (room === id(3)) throw new OffchainError(404, 'no such room');
    return reply({ msgs: [line(11), line(12, { tag: 'aaaa' }), line(13)], next: 13, you: { cc: 'FR', tag: 'aaaa' } });
  });
  await h.rooms.getState().scanAll();
  expect(h.client.scan.mock.calls.map((c) => c[0])).toEqual([id(1), id(3)]);
  expect(h.client.scan).toHaveBeenCalledWith(id(1), 10);
  expect(h.rooms.getState().unreadOf(id(1))).toBe(2);
  expect(h.rooms.getState().gone[id(3)]).toBe(true);
  expect(h.book().rooms.map((r) => r.id)).toContain(id(3));
});

test('scanAll without a mark counts 0 and keeps the reply\'s next as the mark', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  await h.rooms.getState().reloadBook();
  h.client.scan.mockResolvedValue(reply({ msgs: [line(30)], next: 30, gen: 4 }));
  await h.rooms.getState().scanAll();
  expect(h.client.scan).toHaveBeenCalledWith(id(1), 0);
  expect(h.rooms.getState().unreadOf(id(1))).toBe(0);
  expect(h.kv.get(seenKeyFor('S', id(1)))).toBe('4:30');
});

test('a room store that goes gone is forgotten and its name is said once', async () => {
  const h = harness({ book: { rooms: [entry(1, { name: 'quiet' })], left: {} } });
  await h.rooms.getState().reloadBook();
  const nf = () => new OffchainError(404, 'no such room');
  h.answers[id(1)] = [nf(), nf(), nf()];
  h.rooms.getState().resume();
  h.rooms.getState().focus(id(1));
  await flush();
  expect(h.rooms.getState().goneSaid).toBe('quiet');
  expect(h.book().rooms).toEqual([]);
  expect(h.rooms.getState().focused).toBe('');
  h.rooms.getState().dismissGone();
  expect(h.rooms.getState().goneSaid).toBeNull();
});

test('a first line in a room not joined joins it, under its listed name', async () => {
  const h = harness({ listed: [{ id: id(5), name: 'governance', here: 3, made: 1 }] });
  await h.rooms.getState().refreshListed();
  await h.rooms.getState().room(id(5)).getState().send('hello');
  await flush();
  expect(h.book().rooms[0]).toMatchObject({ id: id(5), name: 'governance' });
  const at = h.book().rooms[0].at;
  h.tick(1000);
  await h.rooms.getState().room(id(5)).getState().send('again');
  await flush();
  expect(h.book().rooms[0].at).toBe(at); // already joined: not remembered again
});

test('poke runs at most once per 10 s; resume runs it every 120 s; pause stops it', async () => {
  const h = harness();
  h.rooms.getState().poke();
  h.rooms.getState().poke();
  await flush();
  expect(h.client.listPublic).toHaveBeenCalledTimes(1);
  h.tick(10_000);
  h.rooms.getState().poke();
  await flush();
  expect(h.client.listPublic).toHaveBeenCalledTimes(2);
  h.rooms.getState().resume();
  await flush();
  expect(h.timers).toHaveLength(1);
  h.timers[0]();
  await flush();
  const after = h.client.listPublic.mock.calls.length;
  h.rooms.getState().pause();
  h.timers[0]();
  await flush();
  expect(h.client.listPublic).toHaveBeenCalledTimes(after);
});

test('refreshListed keeps the last list on failure and sets listedError', async () => {
  const h = harness({ listed: [{ id: id(1), name: 'a', here: 0, made: 1 }] });
  await h.rooms.getState().refreshListed();
  expect(h.rooms.getState().listed).toHaveLength(1);
  h.client.listPublic.mockRejectedValueOnce(new OffchainError(0, 'down'));
  await h.rooms.getState().refreshListed();
  expect(h.rooms.getState().listed).toHaveLength(1);
  expect(h.rooms.getState().listedError).toBe(true);
});

test('restart drops room stores, reads the new server\'s book, and ignores answers from before', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  h.rooms.getState().resume();
  await flush();
  h.rooms.getState().focus(id(1));
  const s = h.rooms.getState().room(id(1));
  let answer: (v: unknown) => void = () => undefined;
  h.client.info.mockReturnValueOnce(new Promise((r) => (answer = r)));
  const joining = h.rooms.getState().join(id(2));
  h.rooms.getState().restart();
  expect(s.getState().phase).toBe('idle');
  expect(h.rooms.getState()).toMatchObject({ focused: '', listed: null, unread: {}, banner: null });
  answer({ id: id(2), name: 'late', listed: false, here: 0, made: 0 });
  await joining;
  await flush();
  expect(h.book().rooms.map((r) => r.id)).toEqual([id(1)]);
  expect(h.rooms.getState().room(id(1))).not.toBe(s);
});

test('reloadBook: a room left elsewhere closes its store', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  h.rooms.getState().resume();
  await flush();
  h.rooms.getState().focus(id(1));
  const s = h.rooms.getState().room(id(1));
  // the paired device left it: /pair rewrote the book
  const g = h.book();
  g.rooms = [];
  g.left = { [id(1)]: h.now() };
  await h.rooms.getState().reloadBook();
  expect(s.getState().phase).toBe('idle');
  expect(h.rooms.getState().focused).toBe('');
});

test('roomInfo asks the server; a failure is null', async () => {
  const h = harness();
  h.client.info.mockResolvedValueOnce({ id: id(1), name: 'a', listed: true, here: 1, made: 1 });
  expect(await h.rooms.getState().roomInfo(id(1))).toMatchObject({ listed: true });
  h.client.info.mockRejectedValueOnce(new OffchainError(0, 'down'));
  expect(await h.rooms.getState().roomInfo(id(1))).toBeNull();
});

test('a later scan that reaches the room takes its gone mark away', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  await h.rooms.getState().reloadBook();
  h.kv.set(seenKeyFor('S', id(1)), '3');
  h.client.scan.mockRejectedValueOnce(new OffchainError(404, 'no such room'));
  await h.rooms.getState().scanAll();
  expect(h.rooms.getState().gone[id(1)]).toBe(true);
  h.client.scan.mockResolvedValueOnce(reply({ msgs: [], next: 3 }));
  await h.rooms.getState().scanAll();
  expect(h.rooms.getState().gone[id(1)]).toBeUndefined();
});

test('join of a room already in the book leaves the book as it is: no reorder, no /pair push', async () => {
  const h = harness({ book: { rooms: [entry(2), entry(1)], left: {} } });
  await h.rooms.getState().reloadBook();
  h.client.info.mockResolvedValueOnce({ id: id(1), name: 'r1', listed: false, here: 1, made: 1 });
  expect(await h.rooms.getState().join(id(1))).toEqual({ id: id(1) });
  expect(h.book().rooms.map((r) => r.id)).toEqual([id(2), id(1)]);
  expect(h.syncChanged).not.toHaveBeenCalled();
});

test('leave and rename on a room not in the book write nothing there', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  await h.rooms.getState().reloadBook();
  await h.rooms.getState().leave(id(5));
  expect(h.book()).toEqual({ rooms: [entry(1)], left: {} });
  expect(await h.rooms.getState().rename(id(5), 'mine')).toBe(NOT_JOINED);
  expect(h.book()).toEqual({ rooms: [entry(1)], left: {} });
  expect(h.syncChanged).not.toHaveBeenCalled();
});

test('make keeps the new room and its key when the book cannot be written, and writes it with the next change', async () => {
  const h = harness();
  const fail = jest.spyOn(h.bookStore, 'update').mockRejectedValueOnce(new Error('disk full'));
  h.client.make.mockResolvedValueOnce({ id: id(1), name: 'gnomes', key: 'k1' });
  expect(await h.rooms.getState().make('gnomes', false)).toEqual({ id: id(1) });
  expect(h.rooms.getState().keyOf(id(1))).toBe('k1');
  expect(h.rooms.getState().book.rooms.map((r) => r.id)).toEqual([id(1)]);
  fail.mockRestore();
  h.client.info.mockResolvedValueOnce({ id: id(2), name: 'other', listed: false, here: 1, made: 1 });
  await h.rooms.getState().join(id(2));
  expect(h.book().rooms.find((r) => r.id === id(1))?.key).toBe('k1');
  await h.rooms.getState().reloadBook();
  expect(h.rooms.getState().keyOf(id(1))).toBe('k1');
});

test('bookRead: false until this server\'s book is read, false again after a restart', async () => {
  const h = harness({ book: { rooms: [entry(1)], left: {} } });
  expect(h.rooms.getState().bookRead).toBe(false);
  await h.rooms.getState().reloadBook();
  expect(h.rooms.getState().bookRead).toBe(true);
  h.rooms.getState().restart();
  expect(h.rooms.getState().bookRead).toBe(false);
});
