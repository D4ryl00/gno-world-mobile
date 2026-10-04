import { COUNTRY_CODES, flagEmoji, isFlag } from '@/utils/flag';

test('country list is ISO 3166-1 alpha-2', () => {
  expect(COUNTRY_CODES).toHaveLength(249);
  expect(new Set(COUNTRY_CODES).size).toBe(249);
  expect(COUNTRY_CODES).toContain('FR');
  for (const cc of ['US', 'JP', 'BR', 'ZA']) expect(COUNTRY_CODES).toContain(cc);
  for (const cc of COUNTRY_CODES) expect(cc).toMatch(/^[A-Z]{2}$/);
});

test('flag helpers', () => {
  expect(flagEmoji('FR')).toBe('🇫🇷');
  expect(flagEmoji('')).toBe('');
  expect(isFlag('dk')).toBe(false);
  expect(isFlag('DK')).toBe(true);
});
