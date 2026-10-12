// A wallet whose identity key is here, for the e2e tests: it answers a challenge link as gnokey-mobile does once the
// computer has signed (std.SignDataPayload's document, the identity's gpub, base64url fields).
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { bech32 } from 'bech32';

import type { WalletReply } from '../src/session/gnoconnect';
import { base64url } from '../src/utils/base64url';

const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

export function newTestWallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url');
  const y = Buffer.from(jwk.y!, 'base64url');
  const pub = Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), x]);
  const address = bech32.encode('g', bech32.toWords(createHash('ripemd160').update(createHash('sha256').update(pub).digest()).digest()));
  // a gpub is a protobuf Any: "/tm.PubKeySecp256k1", then the 33-byte key (as `gnokey list` prints it)
  const anyPrefix = Buffer.concat([Buffer.from([0x0a, 0x13]), Buffer.from('/tm.PubKeySecp256k1'), Buffer.from([0x12, 0x23, 0x0a, 0x21])]);
  const gpub = bech32.encode('gpub', bech32.toWords(Buffer.concat([anyPrefix, pub])), 1023);

  const answer = (link: string): WalletReply => {
    const q = new URL(link.replace('land.gno.gnokey://', 'https://x/')).searchParams;
    // keys in sorted order; base64 and bech32 need no escaping
    const doc = JSON.stringify({
      account_number: '0', chain_id: q.get('chainid'), fee: { amount: [], gas: '0' }, memo: '',
      msgs: [{ type: 'sign/MsgSignData', value: { data: Buffer.from(q.get('challenge')!, 'utf8').toString('base64'), signer: address } }],
      sequence: '0',
    });
    const raw = sign('sha256', Buffer.from(doc), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    let s = BigInt('0x' + raw.subarray(32).toString('hex'));
    if (s > N / 2n) s = N - s; // low-S, as tm2 signs
    const sig = Buffer.concat([raw.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]);
    return {
      status: 'success', code: '', state: q.get('state')!, address, session: '', expiresAt: 0, allow: [], spend: '',
      period: 0, chainid: q.get('chainid')!, hash: '', revoked: '', pubkey: gpub,
      signed: base64url(Buffer.from(doc)), signature: base64url(sig),
    };
  };
  return { address, answer };
}
