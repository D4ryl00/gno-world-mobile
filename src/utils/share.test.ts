import { shareText, shareUrl } from '@/utils/share';

test('share links use the site format', () => {
  expect(shareUrl('v5-12', 'g1me')).toBe('https://gno.world/#rumble/v5-12&ref=g1me');
  expect(shareUrl('v5-12', '')).toBe('https://gno.world/#rumble/v5-12');
  expect(shareText('gg', 9905803, 'U')).toBe(
    'I\'m in the "gg" bubble on gno.world — 9.905803 GNOT in the pot. Every boop after mine pays me. Boop over me: U',
  );
});
