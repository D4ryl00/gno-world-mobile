import { countryName } from '@/utils/country';
import { COUNTRY_CODES } from '@/utils/flag';

test('every flag code has a name', () => {
  for (const cc of COUNTRY_CODES) expect(countryName(cc)).not.toBe(cc);
});

test('names are English short names; an unknown code stays as is', () => {
  expect(countryName('FR')).toBe('France');
  expect(countryName('LK')).toBe('Sri Lanka');
  expect(countryName('US')).toBe('United States');
  expect(countryName('ZZ')).toBe('ZZ');
});
