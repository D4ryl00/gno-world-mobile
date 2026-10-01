import { isPlayBlocked, NOPLAY_TEXT, sendPresence } from '@/offchain/presence';

test('the gate is US only, and the text is the site text', () => {
  expect(isPlayBlocked('US')).toBe(true);
  expect(isPlayBlocked('FR')).toBe(false);
  expect(isPlayBlocked('')).toBe(false);
  expect(NOPLAY_TEXT).toBe('Due to US regulations, play is not offered to visitors from the United States.');
});

test('sendPresence posts the page id and reads the country', async () => {
  const oc = { get: jest.fn(), post: jest.fn(async () => ({ you: 'FR', count: 18, lat: 48.75, lon: 2.25 })) } as any;
  expect(await sendPresence(oc, 'p 1')).toEqual({ you: 'FR', count: 18 });
  expect(oc.post).toHaveBeenCalledWith('/presence?id=p%201');
});

test('a malformed reply means "unknown country", which never gates', async () => {
  const oc = { get: jest.fn(), post: jest.fn(async () => 'nope') } as any;
  expect(await sendPresence(oc, 'p')).toEqual({ you: '', count: 0 });
});
