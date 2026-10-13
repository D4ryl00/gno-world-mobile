import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Buffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';

import { addressFromKey, base64url, canonicalPayload, gpubFromKey, pubFromGpub, signRequest } from './session-request.js';

const hex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));
const text = (b) => new TextDecoder().decode(b);

// The vector the Go reference implementation produced (src/session/gnoconnect.test.ts, GO_LINK / GO_PAYLOAD).
const GPUB = 'gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pqwy7ynrtu4aum2869uhjarjtsuer63evxrrm3d4sa3w6mkyzefv8yhklkkx';
const GO_FIELDS = {
  pubkey: GPUB, allow: ['vm/exec:gno.land/r/foo', 'bank/send'], spend: '5000000ugnot', period: 3600, expires: 2592000,
  chainid: 'dev', callback: 'https://example.com/cb?x=1', state: 'ab+c=', iat: 1790841600,
};
const GO_PAYLOAD = [
  'gnoconnect-session-v1',
  'host=connect',
  'allow=bank/send',
  'allow=vm/exec:gno.land/r/foo',
  'callback=https://example.com/cb?x=1',
  'chainid=dev',
  'expires=2592000',
  'iat=1790841600',
  'period=3600',
  `pubkey=${GPUB}`,
  'spend=5000000ugnot',
  'state=ab+c=',
].join('\n');

test('the Go vector, rebuilt from fields', () => {
  assert.equal(canonicalPayload('connect', GO_FIELDS), GO_PAYLOAD);
});

test('in-page: the same payload without the callback line', () => {
  const { callback, ...inpage } = GO_FIELDS;
  void callback;
  assert.equal(canonicalPayload('connect', inpage), GO_PAYLOAD.replace('callback=https://example.com/cb?x=1\n', ''));
});

test('sig and oldsig are never signed; absent fields are omitted', () => {
  const p = canonicalPayload('disconnect', { pubkey: 'gpub1x', chainid: 'dev', signer: 'g1me', state: 's', iat: 1, sig: 'AA', oldsig: 'BB', old: undefined });
  assert.equal(p, ['gnoconnect-session-v1', 'host=disconnect', 'chainid=dev', 'iat=1', 'pubkey=gpub1x', 'signer=g1me', 'state=s'].join('\n'));
});

test('values sort in code-point order (U+1F600 after U+E000)', () => {
  const p = canonicalPayload('connect', { pubkey: 'k', allow: ['\u{1F600}', ''], chainid: 'dev', state: 's', iat: 1 });
  assert.ok(p.indexOf('allow=') < p.indexOf('allow=\u{1F600}'));
});

test('a control character (C1 included) is refused', () => {
  assert.throws(() => canonicalPayload('connect', { pubkey: 'k', chainid: 'dev', state: 'a\u0085b', iat: 1 }), /control/);
  assert.throws(() => canonicalPayload('connect', { pubkey: 'k', chainid: 'dev', state: 'a\nb', iat: 1 }), /control/);
});

// tm2's Go (crypto/ed25519 from the seed 01..20, PubKeyToBech32, Address) — scratchpad edvec, 2026-10-05.
const ED_SEED = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const ED_PUB = '79b5562e8fe654f94078b112e8a98ba7901f853ae695bed7e0e3910bad049664';
const ED_GPUB = 'gpub1pggj7ard9eg82cjtv4u52epjx56nzwgjyg9zq7d42chglej5l9q83vgjaz5chfusr7zn4e54hmt7pcu3pwksf9ny6h7lpd';
const ED_ADDR = 'g1vkmqvu7kakyyhuqu9s3zmq4d5p6q72dvjtaurv';
const ED_SIG = 'akw1Lvay-a4mD5fs7Z9vyc7tA6p845onCOMz2KKsJwsvFsqMJRyrk7ElPR_xnn3W8i-ZypHHYr-sGaC6nyWSCA'; // over "gnoconnect-session-v1\nhost=connect"

async function edKey() {
  const pkcs8 = new Uint8Array([...hex('302e020100300506032b657004220420'), ...ED_SEED]);
  const priv = await webcrypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, true, ['sign']);
  const jwk = await webcrypto.subtle.exportKey('jwk', priv);
  return { priv, raw: Buffer.from(jwk.x, 'base64url') };
}

test('an Ed25519 key: gpub and address as tm2 reports them', async () => {
  const { raw } = await edKey();
  assert.equal(Buffer.from(raw).toString('hex'), ED_PUB);
  assert.equal(gpubFromKey('ed25519', raw), ED_GPUB);
  assert.equal(addressFromKey('ed25519', raw), ED_ADDR);
});

// test1 from gno's integration tests (src/utils/bech32.test.ts).
const SECP_PUB = '03e16136db171e32df489935941f056e22f89863e3739d0ab7cd49ec42839c9db2';
const SECP_GPUB = 'gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq0skzdkmzu0r9h6gny6eg8c9dc303xrrudee6z4he4y7cs5rnjwmyf40yaj';
const SECP_ADDR = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';

test('a secp256k1 key: gpub and address of test1', () => {
  assert.equal(gpubFromKey('secp256k1', hex(SECP_PUB)), SECP_GPUB);
  assert.equal(addressFromKey('secp256k1', hex(SECP_PUB)), SECP_ADDR);
});

test('wrong key sizes are refused', () => {
  assert.throws(() => gpubFromKey('ed25519', new Uint8Array(33)));
  assert.throws(() => gpubFromKey('secp256k1', new Uint8Array(32)));
});

test('signRequest signs the payload and appends sig (and oldsig) in base64url', async () => {
  const fields = { pubkey: 'k', old: 'o', allow: ['bank/send'], expires: 60, chainid: 'dev', signer: 'g1me', state: 's', iat: 1 };
  const seen = [];
  const out = await signRequest('connect', fields, async (b) => { seen.push(text(b)); return new Uint8Array([251, 255]); },
    async (b) => { seen.push(text(b)); return new Uint8Array([0]); });
  assert.deepEqual(seen, [canonicalPayload('connect', fields), canonicalPayload('connect', fields)]);
  assert.deepEqual(out, { ...fields, sig: '-_8', oldsig: 'AA' });
});

test('an Ed25519 WebCrypto signature equals the Go one', async () => {
  const { priv } = await edKey();
  const sig = await webcrypto.subtle.sign('Ed25519', priv, new TextEncoder().encode('gnoconnect-session-v1\nhost=connect'));
  assert.equal(base64url(new Uint8Array(sig)), ED_SIG);
});

test('the inline hashes agree with Node across block boundaries', async () => {
  const { createHash } = await import('node:crypto');
  const { sha256, ripemd160 } = await import('./session-request.js');
  for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 200]) {
    const m = Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) & 255);
    assert.equal(Buffer.from(sha256(m)).toString('hex'), createHash('sha256').update(m).digest('hex'), `sha256 ${n}`);
    assert.equal(Buffer.from(ripemd160(m)).toString('hex'), createHash('ripemd160').update(m).digest('hex'), `ripemd160 ${n}`);
  }
});

test('a field the standard does not define yet is signed too, as on links', () => {
  const p = canonicalPayload('disconnect', { pubkey: 'k', chainid: 'dev', signer: 'g1me', state: 's', iat: 1, zzz: 'later', sig: 'AA' });
  assert.ok(p.endsWith('\nzzz=later'));
});

test('pubFromGpub reads back the key gpubFromKey wrapped', () => {
  const raw = Uint8Array.from(Buffer.from('A+FhNtsXHjLfSJk1lB8FbiL4mGPjc50Kt81J7EKDnJ2y', 'base64'));
  assert.deepEqual(pubFromGpub(gpubFromKey('secp256k1', raw)), raw);
  assert.throws(() => pubFromGpub('gpub1qqqqqq'));
});
