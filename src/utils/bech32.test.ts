import { decodeAddress, decodePubKey, encodeAddress, encodePubKey, bytesToHex } from '@/utils/bech32';

// test1 from gno's integration tests (gnokey list)
const ADDR = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
const GPUB = 'gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq0skzdkmzu0r9h6gny6eg8c9dc303xrrudee6z4he4y7cs5rnjwmyf40yaj';

test('addresses round-trip and are 20 bytes', () => {
  const b = decodeAddress(ADDR);
  expect(b).toHaveLength(20);
  expect(encodeAddress(b)).toBe(ADDR);
});

test('gpub public keys round-trip', () => {
  expect(encodePubKey(decodePubKey(GPUB))).toBe(GPUB);
});

test('decodeAddress rejects other prefixes', () => {
  expect(() => decodeAddress(GPUB)).toThrow();
});

test('hex', () => {
  expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
});
