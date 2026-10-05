import type { Offchain } from '@/offchain/http';
import { isPlayBlocked, NOPLAY_TEXT, sendPresence } from '@/offchain/presence';

test('the gate is US only, and the text is the site text', () => {
  expect(isPlayBlocked('US')).toBe(true);
  expect(isPlayBlocked('us')).toBe(false);
  expect(isPlayBlocked(' US')).toBe(false);
  expect(isPlayBlocked('US ')).toBe(false);
  expect(isPlayBlocked('FR')).toBe(false);
  expect(isPlayBlocked('')).toBe(false);
  expect(NOPLAY_TEXT).toBe('Due to US regulations, play is not offered to visitors from the United States.');
});

test('sendPresence posts the page id and reads the country', async () => {
  const post = jest.fn(async () => ({ you: 'FR', count: 18, lat: 48.75, lon: 2.25 })) as unknown as Offchain['post'];
  const oc = { get: jest.fn(), post } as unknown as Offchain;
  expect(await sendPresence(oc, 'p 1')).toEqual({ you: 'FR', count: 18 });
  expect(oc.post).toHaveBeenCalledWith('/presence?id=p%201');
});

test('a malformed reply means "unknown country", which never gates', async () => {
  const post = jest.fn(async () => 'nope') as unknown as Offchain['post'];
  const oc = { get: jest.fn(), post } as unknown as Offchain;
  expect(await sendPresence(oc, 'p')).toEqual({ you: '', count: 0 });
});

test('a reply with no you field or you: null never gates', async () => {
  const post1 = jest.fn(async () => ({ count: 5 })) as unknown as Offchain['post'];
  const oc1 = { get: jest.fn(), post: post1 } as unknown as Offchain;
  expect(await sendPresence(oc1, 'p')).toEqual({ you: '', count: 5 });

  const post2 = jest.fn(async () => ({ you: null, count: 10 })) as unknown as Offchain['post'];
  const oc2 = { get: jest.fn(), post: post2 } as unknown as Offchain;
  expect(await sendPresence(oc2, 'p')).toEqual({ you: '', count: 10 });
});
