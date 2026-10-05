import {
  applyOlder, applyPoll, EMPTY_VIEW, genChanged, isMine, MAX_LINES, patchLine, removeLine, unreadCount, upsertLine,
} from '@/offchain/chat/merge';
import { line, reply } from '@/offchain/chat/testing';

const ids = (v: { lines: { id: number }[] }) => v.lines.map((l) => l.id);

test('new lines are added in id order and move the cursor', () => {
  const v = applyPoll(EMPTY_VIEW, reply({ msgs: [line(3), line(1)], next: 7, gen: 2, here: 9 }));
  expect(ids(v)).toEqual([1, 3]);
  expect(v).toMatchObject({ since: 7, gen: 2, here: 9, you: { tag: 'aaaa' } });
  expect(applyPoll(v, reply({ msgs: [line(9)], next: null })).since).toBe(9);
});

test('a repeated line replaces the held one', () => {
  const v = applyPoll(EMPTY_VIEW, reply({ msgs: [line(1, { body: 'a' })] }));
  expect(applyPoll(v, reply({ msgs: [line(1, { body: 'b' })] })).lines[0].body).toBe('b');
});

test('upd replaces held lines and never inserts one the app does not hold', () => {
  const v = applyPoll(EMPTY_VIEW, reply({ msgs: [line(5), line(6)] }));
  const w = applyPoll(v, reply({ upd: [line(5, { edited: true, body: 'x' }), line(2, { body: 'old' })] }));
  expect(ids(w)).toEqual([5, 6]);
  expect(w.lines[0]).toMatchObject({ edited: true, body: 'x' });
});

test('gone lines leave', () => {
  const v = applyPoll(EMPTY_VIEW, reply({ msgs: [line(1), line(2)] }));
  expect(ids(applyPoll(v, reply({ gone: [1] })))).toEqual([2]);
});

test('pins, typing and you follow each reply; here and you are kept when absent', () => {
  const v = applyPoll(EMPTY_VIEW, reply({ pins: [line(1, { pinned: true })], typing: [{ name: 'a', n: 3 }] }));
  const w = applyPoll(v, reply({ pins: [], typing: [], here: null, you: null }));
  expect(w).toMatchObject({ pins: [], typing: [], here: 3, you: { tag: 'aaaa' } });
});

test('the window keeps the newest MAX_LINES and then says older history exists', () => {
  const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => line(i + 1));
  const v = applyPoll({ ...EMPTY_VIEW, more: false }, reply({ msgs: many }));
  expect(v.lines).toHaveLength(MAX_LINES);
  expect(v.lines[0].id).toBe(6);
  expect(v.more).toBe(true);
});

test('a gen change is noticed only between two known gens', () => {
  expect(genChanged({ ...EMPTY_VIEW, gen: 2 }, reply({ gen: 3 }))).toBe(true);
  expect(genChanged({ ...EMPTY_VIEW, gen: 2 }, reply({ gen: 2 }))).toBe(false);
  expect(genChanged({ ...EMPTY_VIEW, gen: null }, reply({ gen: 3 }))).toBe(false);
  expect(genChanged({ ...EMPTY_VIEW, gen: 2 }, reply({ gen: null }))).toBe(false);
});

test('older lines go before, and an empty page ends the history', () => {
  const v = applyPoll(EMPTY_VIEW, reply({ msgs: [line(10)] }));
  const w = applyOlder(v, { msgs: [line(8), line(9)], more: true });
  expect(ids(w)).toEqual([8, 9, 10]);
  expect(w.more).toBe(true);
  expect(applyOlder(w, { msgs: [], more: true }).more).toBe(false);
  expect(applyOlder(w, { msgs: [line(7)], more: false }).more).toBe(false);
});

test('upsert, remove and patch keep other state', () => {
  const v = { ...applyPoll(EMPTY_VIEW, reply({ msgs: [line(1), line(2)] })), extra: 'kept' };
  expect(ids(upsertLine(v, line(3)))).toEqual([1, 2, 3]);
  expect(upsertLine(v, line(3)).extra).toBe('kept');
  expect(ids(removeLine(v, 1))).toEqual([2]);
  expect(patchLine(v, 2, { rx: { '👍': 1 } }).lines[1].rx).toEqual({ '👍': 1 });
  expect(patchLine(v, 99, { body: 'x' }).lines).toBe(v.lines);
});

test('mine: the server tag or a line the app posted', () => {
  const you = { cc: 'FR', tag: 'aaaa' };
  expect(isMine(line(1, { tag: 'aaaa' }), you, [])).toBe(true);
  expect(isMine(line(1), you, [1])).toBe(true);
  expect(isMine(line(1), you, [])).toBe(false);
  expect(isMine(line(1, { tag: '' }), { cc: '', tag: '' }, [])).toBe(false);
});

test('unread counts other people\'s lines after the last seen one', () => {
  const lines = [line(1), line(2), line(3, { tag: 'aaaa' }), line(4)];
  expect(unreadCount({ lines, you: { cc: '', tag: 'aaaa' } }, 1, [4])).toBe(1);
  expect(unreadCount({ lines, you: null }, 4, [])).toBe(0);
});

test('history scrolled back to survives the next polls, even past MAX_LINES', () => {
  const recent = Array.from({ length: 80 }, (_, i) => line(MAX_LINES + 100 + i));
  let v = applyPoll(EMPTY_VIEW, reply({ msgs: recent }));
  for (let p = 0; p < 6; p++) {
    const oldest = v.lines[0].id;
    v = applyOlder(v, { msgs: Array.from({ length: 100 }, (_, i) => line(oldest - 100 + i)), more: true });
  }
  const held = v.lines.length;
  expect(held).toBeGreaterThan(MAX_LINES);
  v = applyPoll(v, reply({ msgs: [line(10_000)] }));
  expect(v.lines).toHaveLength(held + 1);
  expect(v.lines[0].id).toBe(MAX_LINES + 100 - 600);
});
