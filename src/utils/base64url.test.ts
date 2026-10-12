import { base64url, fromBase64url, toBase64 } from '@/utils/base64url';

test.each([[[]], [[1]], [[1, 2]], [[1, 2, 3]], [[251, 255, 191, 0, 62]]])('%j matches Node', (bytes) => {
  const b = new Uint8Array(bytes as number[]);
  expect(base64url(b)).toBe(Buffer.from(b).toString('base64url'));
});

test('fromBase64url reads what base64url writes, padding or not', () => {
  for (const n of [0, 1, 2, 3, 4, 31, 32, 33]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    expect(fromBase64url(base64url(b))).toEqual(b);
    expect(fromBase64url(Buffer.from(b).toString('base64url') + '==='.slice((n * 4) % 3))).toEqual(b);
  }
  expect(fromBase64url('_-8')).toEqual(new Uint8Array([0xff, 0xef]));
  expect(() => fromBase64url('a$b')).toThrow();
  expect(() => fromBase64url('a')).toThrow();
});

test('toBase64 is the standard alphabet with padding', () => {
  expect(toBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=');
  expect(toBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
  for (const n of [0, 1, 2, 3, 33]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 91 + 7) & 255);
    expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
  }
});
