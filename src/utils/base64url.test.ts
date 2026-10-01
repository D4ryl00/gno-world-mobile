import { base64url } from '@/utils/base64url';

test.each([[[]], [[1]], [[1, 2]], [[1, 2, 3]], [[251, 255, 191, 0, 62]]])('%j matches Node', (bytes) => {
  const b = new Uint8Array(bytes as number[]);
  expect(base64url(b)).toBe(Buffer.from(b).toString('base64url'));
});
