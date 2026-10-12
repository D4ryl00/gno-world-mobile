const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** RFC 4648 §5, no padding. */
export function base64url(b: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63] + A[n & 63];
  }
  const rem = b.length - i;
  if (rem === 1) {
    const n = b[i] << 16;
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63];
  } else if (rem === 2) {
    const n = (b[i] << 16) | (b[i + 1] << 8);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + A[(n >> 6) & 63];
  }
  return out;
}

/** RFC 4648 §5, with or without padding. */
export function fromBase64url(s: string): Uint8Array {
  const t = s.replace(/=+$/, '');
  if (/[^A-Za-z0-9_-]/.test(t) || t.length % 4 === 1) throw new Error('not base64url');
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const c of t) {
    acc = ((acc << 6) | A.indexOf(c)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

/** RFC 4648 §4: the standard alphabet, padded. */
export const toBase64 = (b: Uint8Array): string => {
  const s = base64url(b).replace(/-/g, '+').replace(/_/g, '/');
  return s + '='.repeat((4 - (s.length % 4)) % 4);
};
