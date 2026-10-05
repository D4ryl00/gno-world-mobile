import { line } from '@/offchain/chat/testing';
import { ago, canEdit, canWithdraw, chatTabLabel, placeholder, pollBars, rxWho, splitLinks, typingText } from '@/screens/chat/line-model';

const T = 1_790_000_000;

test('edit: yours, not a poll, under fifteen minutes', () => {
  const l = line(1, { t: T });
  expect(canEdit(l, true, T + 899)).toBe(true);
  expect(canEdit(l, true, T + 900)).toBe(false);
  expect(canEdit(l, false, T)).toBe(false);
  expect(canEdit(line(1, { t: T, poll: { q: 'q', opts: ['a'], votes: [0] } }), true, T)).toBe(false);
});

test('take back: yours, the newest line, under fifteen minutes', () => {
  const l = line(5, { t: T });
  expect(canWithdraw(l, 5, true, T + 10)).toBe(true);
  expect(canWithdraw(l, 6, true, T + 10)).toBe(false);
  expect(canWithdraw(l, 5, false, T + 10)).toBe(false);
  expect(canWithdraw(l, 5, true, T + 900)).toBe(false);
});

test('relative times', () => {
  expect(ago(T, T + 30)).toBe('now');
  expect(ago(T, T + 125)).toBe('2m');
  expect(ago(T, T + 7300)).toBe('2h');
  expect(ago(T, T + 3 * 86400)).toBe('3d');
  expect(ago(T + 50, T)).toBe('now'); // clock skew
});

test('links are cut out of the text, without trailing punctuation', () => {
  expect(splitLinks('see https://gnofly.xyz/nft, then http://a.b/c.')).toEqual([
    { text: 'see ' }, { text: 'https://gnofly.xyz/nft', url: 'https://gnofly.xyz/nft' }, { text: ', then ' },
    { text: 'http://a.b/c', url: 'http://a.b/c' }, { text: '.' },
  ]);
  expect(splitLinks('no link')).toEqual([{ text: 'no link' }]);
  expect(splitLinks('')).toEqual([]);
});

test('placeholders for what M2c will show', () => {
  expect(placeholder(line(1))).toBeNull();
  expect(placeholder(line(1, { att: { kind: 'image', url: '/x', name: 'a.png' } }))).toBe('📎 picture');
  expect(placeholder(line(1, { att: { kind: 'video', url: '/x', name: 'a.mp4' } }))).toBe('📎 video');
  expect(placeholder(line(1, { att: { kind: 'file', url: '/x', name: 'a.pdf' } }))).toBe('📎 file · a.pdf');
  expect(placeholder(line(1, { clip: '/api/chat/clip/1' }))).toBe('🎤 voice message');
});

test('typing text, as the site writes it, never about yourself', () => {
  expect(typingText([{ name: 'Ann', n: 5 }, { name: 'bob', n: 120 }, { name: 'cat', n: 300 }, { name: 'dan', n: 1 }], 'zed'))
    .toBe('Ann is typing · · bob is typing ·· · cat is typing ··· a long one');
  expect(typingText([{ name: 'Ann', n: 5 }], ' ann ')).toBe('');
  expect(typingText([], 'x')).toBe('');
});

test('poll bars', () => {
  expect(pollBars({ q: 'q', opts: ['a', 'b', 'c'], votes: [1, 3] }, 1)).toEqual({
    total: 4,
    bars: [
      { label: 'a', count: 1, pct: 25, mine: false },
      { label: 'b', count: 3, pct: 75, mine: true },
      { label: 'c', count: 0, pct: 0, mine: false },
    ],
  });
  expect(pollBars({ q: 'q', opts: ['a'], votes: [] }, undefined).bars[0].pct).toBe(0);
});

test('who reacted: the names, then "+N" past twelve', () => {
  expect(rxWho(line(1, { rxwho: { '❤️': ['ann', 'bob'] } }), '❤️')).toBe('ann, bob');
  const many = Array.from({ length: 14 }, (_, i) => `p${i}`);
  expect(rxWho(line(1, { rxwho: { '❤️': many } }), '❤️')).toBe(`${many.slice(0, 12).join(', ')} +2`);
  expect(rxWho(line(1), '❤️')).toBe('');
});

test('the Chat tab says how many lines are unread', () => {
  expect(chatTabLabel(0)).toBe('Chat');
  expect(chatTabLabel(3)).toBe('Chat, 3 unread');
  expect(chatTabLabel(150)).toBe('Chat, 99+ unread');
});
