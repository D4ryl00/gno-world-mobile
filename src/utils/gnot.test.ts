import { gnot, humanDuration, parseDuration, toUgnot } from '@/utils/gnot';

test('gnot formats like the site', () => {
  expect(gnot(1450000)).toBe('1.45 GNOT');
  expect(gnot(74109299)).toBe('74.109299 GNOT');
  expect(gnot(1000000)).toBe('1 GNOT');
  expect(gnot(0)).toBe('0 GNOT');
});

test('toUgnot parses up to 6 decimals', () => {
  expect(toUgnot('1.5')).toBe(1500000);
  expect(toUgnot('0.000001')).toBe(1);
  expect(toUgnot('')).toBe(0);
  expect(() => toUgnot('1.0000001')).toThrow();
  expect(() => toUgnot('abc')).toThrow();
});

test('parseDuration uses the site syntax', () => {
  expect(parseDuration('90m')).toBe(5400);
  expect(parseDuration('2.5d')).toBe(216000);
  expect(parseDuration('10s')).toBe(10);
  expect(() => parseDuration('10')).toThrow();
});

test('humanDuration keeps three units', () => {
  expect(humanDuration(34587)).toBe('9h 36m 27s');
  expect(humanDuration(93784)).toBe('1d 2h 3m');
  expect(humanDuration(0)).toBe('0s');
});
