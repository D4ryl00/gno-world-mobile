import { shareText, shareUrl } from '@/utils/share';

test('share links use the site format', () => {
  expect(shareUrl('v5-12', 'g1me')).toBe('https://bubblerumble.net/?ref=g1me#v5-12');
  expect(shareUrl('v5-12', '')).toBe('https://bubblerumble.net/#v5-12');
  expect(shareText('gg', 9905803, 'U')).toBe(
    'I\'m in the "gg" bubble on Bubble Rumble — 9.905803 GNOT in the pot. Every boop after mine pays me. Boop over me: U',
  );
});
