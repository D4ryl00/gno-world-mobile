// The in-page GnoConnect session request: payload, keys, signature.
// Same construction as src/session/gnoconnect.ts (launch links), built from fields instead of a link:
// numbers in decimal, `allow` one line per entry, absent fields omitted, and in-page never a `callback`.
// Plain ES module with no dependency, so the static page and Node's test runner load the same file.

/** Control characters as Go's unicode.IsControl sees them: C0, DEL and C1. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Bytewise UTF-8 order, which is code-point order (UTF-16 code units disagree above U+FFFF). */
function byCodePoint(a, b) {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0) - y[i].codePointAt(0);
    if (d) return d;
  }
  return x.length - y.length;
}

/**
 * The proof-of-possession payload (gnoconnect.md, "Proof of possession"): every field but `sig` and `oldsig`,
 * those the standard does not define yet included, as on links. Pass `callback` only to build a link's payload.
 */
export function canonicalPayload(host, fields) {
  const kvs = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === 'sig' || k === 'oldsig' || v === undefined || v === null) continue;
    if (k.includes('=')) throw new Error(`= in the field name ${k}`);
    for (const one of Array.isArray(v) ? v : [v]) kvs.push([k, String(one)]);
  }
  for (const [k, v] of kvs) {
    if (CONTROL.test(k + v)) throw new Error(`control character in ${k}`);
  }
  kvs.sort(([ak, av], [bk, bv]) => byCodePoint(ak, bk) || byCodePoint(av, bv));
  return ['gnoconnect-session-v1', `host=${host}`, ...kvs.map(([k, v]) => `${k}=${v}`)].join('\n');
}

export const base64url = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Signs the payload with `signer` (and `oldSigner` for a renewal); returns the fields with `sig` (and `oldsig`). */
export async function signRequest(host, fields, signer, oldSigner) {
  const data = new TextEncoder().encode(canonicalPayload(host, fields));
  const out = { ...fields, sig: base64url(await signer(data)) };
  if (oldSigner) out.oldsig = base64url(await oldSigner(data));
  return out;
}

// --- keys

const KEY_TYPES = {
  ed25519: { size: 32, typeUrl: '/tm.PubKeyEd25519' },
  secp256k1: { size: 33, typeUrl: '/tm.PubKeySecp256k1' },
};

function checkKey(type, raw) {
  const t = KEY_TYPES[type];
  if (!t) throw new Error(`unknown key type ${type}`);
  if (raw.length !== t.size) throw new Error(`a ${type} key is ${t.size} bytes, got ${raw.length}`);
  return t;
}

/** `gpub1…`: bech32 of the amino Any { type_url, value: { key } }, as tm2's PubKeyToBech32 prints it. */
export function gpubFromKey(type, raw) {
  const t = checkKey(type, raw);
  const url = new TextEncoder().encode(t.typeUrl);
  const inner = [0x0a, raw.length, ...raw];
  return bech32Encode('gpub', [0x0a, url.length, ...url, 0x12, inner.length, ...inner]);
}

/** `g1…`: Ed25519 sha256(key)[0:20]; secp256k1 ripemd160(sha256(key)) (tm2 crypto). */
export function addressFromKey(type, raw) {
  checkKey(type, raw);
  const h = type === 'ed25519' ? sha256(raw).slice(0, 20) : ripemd160(sha256(raw));
  return bech32Encode('g', h);
}

// --- bech32 (BIP 173)

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

function polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= G[i];
  }
  return chk;
}

function bech32Encode(hrp, bytes) {
  const data = [];
  let acc = 0, bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      data.push((acc >> bits) & 31);
    }
  }
  if (bits) data.push((acc << (5 - bits)) & 31);
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...expanded, ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum = Array.from({ length: 6 }, (_, i) => (mod >> (5 * (5 - i))) & 31);
  return hrp + '1' + [...data, ...checksum].map((d) => CHARSET[d]).join('');
}

function bech32Decode(s) {
  const lower = s.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) throw new Error(`not bech32: ${s}`);
  const hrp = lower.slice(0, pos);
  const data = [...lower.slice(pos + 1)].map((c) => {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error(`not bech32: ${s}`);
    return v;
  });
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  if (polymod([...expanded, ...data]) !== 1) throw new Error(`bad checksum: ${s}`);
  const bytes = [];
  let acc = 0, bits = 0;
  for (const v of data.slice(0, -6)) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return { hrp, bytes };
}

/** The 33-byte key inside a secp256k1 `gpub1…` (the reverse of gpubFromKey). */
export function pubFromGpub(gpub) {
  const { hrp, bytes } = bech32Decode(gpub);
  const url = new TextEncoder().encode('/tm.PubKeySecp256k1');
  const prefix = [0x0a, url.length, ...url, 0x12, 35, 0x0a, 33];
  if (hrp !== 'gpub' || bytes.length !== prefix.length + 33 || prefix.some((b, i) => bytes[i] !== b)) {
    throw new Error(`not a secp256k1 gpub: ${gpub}`);
  }
  return Uint8Array.from(bytes.slice(prefix.length));
}

// --- sha256 (FIPS 180-4) and ripemd160, synchronous: WebCrypto has no ripemd160 and its digest is async.

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Pads to whole 64-byte blocks with the message length in bits, big- or little-endian. */
function pad(msg, bigEndian) {
  const len = Math.ceil((msg.length + 9) / 64) * 64;
  const out = new Uint8Array(len);
  out.set(msg);
  out[msg.length] = 0x80;
  const view = new DataView(out.buffer);
  const bits = msg.length * 8;
  if (bigEndian) {
    view.setUint32(len - 8, Math.floor(bits / 2 ** 32));
    view.setUint32(len - 4, bits >>> 0);
  } else {
    view.setUint32(len - 8, bits >>> 0, true);
    view.setUint32(len - 4, Math.floor(bits / 2 ** 32), true);
  }
  return view;
}

export function sha256(msg) {
  const view = pad(msg, true);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + 4 * i);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      [hh, g, f, e, d, c, b, a] = [g, f, e, (d + t1) >>> 0, c, b, a, (t1 + t2) >>> 0];
    }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => (h[i] = h[i] + v));
  }
  const out = new DataView(new ArrayBuffer(32));
  h.forEach((v, i) => out.setUint32(4 * i, v));
  return new Uint8Array(out.buffer);
}

const RL = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4,
  9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7, 12, 2, 10,
  14, 1, 3, 8, 11, 6, 15, 13,
];
const RR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3,
  7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1, 5, 8, 7,
  6, 2, 13, 14, 0, 3, 9, 11,
];
const SL = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6,
  7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5, 11, 6, 8,
  13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const SR = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15,
  11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5, 12, 9, 12, 5,
  14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];
const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

function f(j, x, y, z) {
  if (j < 16) return x ^ y ^ z;
  if (j < 32) return (x & y) | (~x & z);
  if (j < 48) return (x | ~y) ^ z;
  if (j < 64) return (x & z) | (y & ~z);
  return x ^ (y | ~z);
}

export function ripemd160(msg) {
  const view = pad(msg, false);
  const h = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  const x = new Uint32Array(16);
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) x[i] = view.getUint32(off + 4 * i, true);
    let [al, bl, cl, dl, el] = h;
    let [ar, br, cr, dr, er] = h;
    for (let j = 0; j < 80; j++) {
      const r = j >> 4;
      let t = (rotl((al + f(j, bl, cl, dl) + x[RL[j]] + KL[r]) | 0, SL[j]) + el) | 0;
      [al, el, dl, cl, bl] = [el, dl, rotl(cl, 10), bl, t];
      t = (rotl((ar + f(79 - j, br, cr, dr) + x[RR[j]] + KR[r]) | 0, SR[j]) + er) | 0;
      [ar, er, dr, cr, br] = [er, dr, rotl(cr, 10), br, t];
    }
    const t = (h[1] + cl + dr) | 0;
    h[1] = (h[2] + dl + er) | 0;
    h[2] = (h[3] + el + ar) | 0;
    h[3] = (h[4] + al + br) | 0;
    h[4] = (h[0] + bl + cr) | 0;
    h[0] = t;
  }
  const out = new DataView(new ArrayBuffer(20));
  h.forEach((v, i) => out.setUint32(4 * i, v, true));
  return new Uint8Array(out.buffer);
}
