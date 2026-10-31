import { readFileSync } from 'fs';
import { join } from 'path';

import { parseLine, parseOlderReply, parsePollReply } from '@/offchain/chat/parse';

const fx = (n: string) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', n), 'utf8'));

test('every field the app reads, and junk it survives', () => {
  const ls = (fx('lines.json') as unknown[]).map(parseLine);
  expect(ls[0]).toMatchObject({ id: 10, name: 'jae', cc: 'US', reserved: true, av: 'hx4b2eo2', bot: false, rx: {} });
  expect(ls[1]).toMatchObject({ bot: true, re: { id: 10, name: 'jae', body: 'hello' } });
  expect(ls[2]).toMatchObject({ att: { kind: 'image', url: '/api/chat/file/12-x.png', name: 'image.png' }, rx: { '❤️': 2 }, rxwho: { '❤️': ['a', 'b'] } });
  expect(ls[3]).toMatchObject({ clip: '/api/chat/clip/13' });
  expect(ls[4]).toMatchObject({ edited: true, pinned: true, poll: { q: 'which?', opts: ['a', 'b'], votes: [3, 0] } });
  expect(ls[5]).toBeNull();
  expect(ls[6]).toBeNull();
  expect(ls[7]).toEqual({
    id: 15, t: 0, name: '', tag: '', cc: '', body: '', rx: {}, rxwho: {}, edited: false, pinned: false,
    reserved: false, av: '', bot: false, clip: '', re: undefined, poll: undefined, att: undefined,
  });
});

test('a production first page parses without losing a line', () => {
  const raw = fx('prod-first.json');
  const r = parsePollReply(raw);
  expect(r.msgs).toHaveLength(raw.msgs.length);
  expect(r.msgs.map((l) => l.id)).toEqual([...r.msgs.map((l) => l.id)].sort((a, b) => a - b));
  expect(typeof r.next).toBe('number');
  expect(typeof r.gen).toBe('number');
  expect(r.you).toEqual({ cc: expect.any(String), tag: expect.any(String) });
});

test('a production older page parses, with its more flag', () => {
  const raw = fx('prod-older.json');
  const r = parseOlderReply(raw);
  expect(r.msgs).toHaveLength(raw.msgs.length);
  expect(r.more).toBe(raw.more === true);
});

test('missing reply fields become safe defaults', () => {
  expect(parsePollReply({})).toEqual({
    msgs: [], gone: [], upd: [], next: null, gen: null, pins: [], typing: [], here: null, you: null, roomName: null, dm: [],
  });
  expect(parsePollReply('<html>')).toEqual(parsePollReply({}));
  expect(parsePollReply({ typing: [{ name: 'a', n: 5 }, { n: 3 }, 'x'], gone: [4, 'y', -1] })).toMatchObject({
    typing: [{ name: 'a', n: 5 }], gone: [4],
  });
});

test('a poll reply reads the room name and keeps only room invitations with a valid id', () => {
  const room = 'AAAAAAAAAAAAAAAAAAAA';
  const r = parsePollReply({
    name: 'Dev chat',
    dm: [{ room, name: 'x', from: 'bob', kind: 'room', at: 5 }, { room, name: 'y', from: 'cat', kind: 'dm', at: 5 }, { room: 'bad', kind: 'room', at: 5 }],
  });
  expect(r.roomName).toBe('Dev chat');
  expect(r.dm).toEqual([{ room, name: 'x', from: 'bob', at: 5 }]);
  expect(parsePollReply({}).roomName).toBeNull();
  expect(parsePollReply({}).dm).toEqual([]);
});
