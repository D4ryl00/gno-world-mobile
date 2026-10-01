import { bech32 } from 'bech32';

const LIMIT = 1023;

function decode(s: string, prefix: string): Uint8Array {
  const d = bech32.decode(s, LIMIT);
  if (d.prefix !== prefix) throw new Error(`expected a ${prefix}1… string, got ${d.prefix}1…`);
  return new Uint8Array(bech32.fromWords(d.words));
}
const encode = (prefix: string, b: Uint8Array) => bech32.encode(prefix, bech32.toWords(b), LIMIT);

export const decodeAddress = (s: string) => decode(s, 'g');
export const encodeAddress = (b: Uint8Array) => encode('g', b);
export const decodePubKey = (s: string) => decode(s, 'gpub');
export const encodePubKey = (b: Uint8Array) => encode('gpub', b);

export const bytesToHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
