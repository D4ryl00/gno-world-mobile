import { isAddress, shortAddr } from '@/utils/address';

const A = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';

test('isAddress takes a lower-case g1 address of 40 characters', () => {
  expect(isAddress(A)).toBe(true);
  expect(isAddress(A.toUpperCase())).toBe(false);
  expect(isAddress(A.slice(0, 39))).toBe(false);
  expect(isAddress('')).toBe(false);
});

test('shortAddr keeps the head and the tail', () => {
  expect(shortAddr(A)).toBe('g1jg8mtu…sqf5');
  expect(shortAddr('g1short')).toBe('g1short');
  expect(shortAddr('')).toBe('');
});
