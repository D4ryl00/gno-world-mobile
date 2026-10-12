import type { WalletReply } from '@/session/gnoconnect';
import { fromBase64url, toBase64 } from '@/utils/base64url';
import { decodePubKey } from '@/utils/bech32';

/** What gno.world's POST /api/name takes as a proof (the site's walletProve). */
export interface NameProof {
  /** the signed document, as the site's signBytesOf writes it: sorted, no spaces, <>& escaped */
  doc: string;
  /** base64 */
  sig: string;
  /** base64 of the 33-byte compressed key */
  pub: string;
  addr: string;
}

/**
 * A gpub's bytes before a secp256k1 key: a protobuf Any, field 1 the type URL "/tm.PubKeySecp256k1", field 2 the key
 * message (its field 1, 33 bytes). Read from `gnokey list` (test1), 2026-10-12.
 */
const SECP_PREFIX = [0x0a, 0x13, ...Array.from('/tm.PubKeySecp256k1', (c) => c.charCodeAt(0)), 0x12, 0x23, 0x0a, 0x21];

/**
 * A wallet's `connect` reply to a challenge, as gno.world takes it. The wallet signed canonical bytes
 * (std.SignDataPayload), which are exactly the `doc` the site sends.
 */
export function proofFromReply(r: WalletReply, identity: string): NameProof {
  if (!r.signed || !r.signature || !r.pubkey) {
    throw new Error('Your wallet cannot prove the account. Boop from this app, then reserve within 3 minutes.');
  }
  if (r.address !== identity) throw new Error(`Your wallet proved ${r.address}, not ${identity}: choose that account in the wallet.`);
  const any = decodePubKey(r.pubkey);
  if (any.length !== SECP_PREFIX.length + 33 || SECP_PREFIX.some((b, i) => any[i] !== b)) {
    throw new Error('Your wallet answered with an unknown kind of key.');
  }
  return {
    doc: new TextDecoder().decode(fromBase64url(r.signed)),
    sig: toBase64(fromBase64url(r.signature)),
    pub: toBase64(any.slice(SECP_PREFIX.length)),
    addr: identity,
  };
}
