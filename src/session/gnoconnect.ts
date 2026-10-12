import { base64url } from '@/utils/base64url';

import type { Grant } from './types';

export const WALLET_SCHEME = 'land.gno.gnokey';
export const CALLBACK_URL = 'gno.world://session-callback';
/** `connect` with `pubkey` grants (with `old`, renews in one transaction); `disconnect` revokes. */
export type SessionHost = 'connect' | 'disconnect';

const enc = encodeURIComponent;

function splitLink(link: string): { scheme: string; host: string; query: string; fragment: string } {
  const sep = link.indexOf('://');
  if (sep <= 0) throw new Error('not a link');
  const afterScheme = link.slice(sep + 3);
  const hash = afterScheme.indexOf('#');
  const noFrag = hash >= 0 ? afterScheme.slice(0, hash) : afterScheme;
  const q = noFrag.indexOf('?');
  const hostPath = q >= 0 ? noFrag.slice(0, q) : noFrag;
  return {
    scheme: link.slice(0, sep).toLowerCase(),
    host: hostPath.split('/')[0].toLowerCase(),
    query: q >= 0 ? noFrag.slice(q + 1) : '',
    fragment: hash >= 0 ? afterScheme.slice(hash + 1) : '',
  };
}

/** Strict RFC 3986 decoding: '+' stays a plus. */
function entries(qs: string): [string, string][] {
  return qs
    .split('&')
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf('=');
      const k = i >= 0 ? part.slice(0, i) : part;
      const v = i >= 0 ? part.slice(i + 1) : '';
      return [decodeURIComponent(k), decodeURIComponent(v)];
    });
}

/** Control characters as Go's unicode.IsControl sees them: C0, DEL and C1. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** Bytewise UTF-8 order, which is code-point order (UTF-16 code units disagree above U+FFFF). */
function byCodePoint(a: string, b: string): number {
  const x = Array.from(a), y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i].codePointAt(0)! - y[i].codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}

/** The proof-of-possession payload (gnoconnect-session.md, "Proof of possession"). */
export function canonicalPayload(link: string): string {
  const { host, query } = splitLink(link);
  const kvs = entries(query).filter(([k]) => k !== 'sig' && k !== 'oldsig');
  for (const [k, v] of kvs) {
    if (CONTROL.test(k + v)) throw new Error(`control character in ${k}`);
    if (k.includes('=')) throw new Error(`= in the parameter name ${k}`);
  }
  kvs.sort(([ak, av], [bk, bv]) => byCodePoint(ak, bk) || byCodePoint(av, bv));
  return ['gnoconnect-session-v1', `host=${host}`, ...kvs.map(([k, v]) => `${k}=${v}`)].join('\n');
}

export interface SessionRequest {
  host: SessionHost;
  pubkey: string;
  old?: string;
  grant?: Grant;
  allow?: string[];
  chainid: string;
  rpc?: string;
  signer?: string;
  callback: string;
  state: string;
  iat: number;
}

/** The request rules a wallet would answer `invalid_request` to (gnoconnect-session.md, "Parameters"). */
function checkRequest(r: SessionRequest): void {
  const bad = (why: string) => {
    throw new Error(`session request: ${why}`);
  };
  if (!r.state || r.state.length > 256) bad('state must be 1 to 256 characters');
  if (r.host === 'disconnect') {
    if (!r.signer) bad('a disconnect needs signer');
    if (r.old || r.grant || r.allow?.length) bad('a disconnect carries no old, allow or grant');
    return;
  }
  const allow = r.allow ?? [];
  if (allow.length < 1 || allow.length > 8) bad('a grant needs 1 to 8 allow entries');
  if (!r.grant) bad('a grant needs expires');
  const g = r.grant!;
  if (g.period < 0 || g.period > 2592000) bad('period must be 0 to 2592000 seconds');
  if (g.expires < 1 || g.expires > 126144000) bad('expires must be 1 to 126144000 seconds');
  if (r.old !== undefined) {
    if (r.old === r.pubkey) bad('old must differ from pubkey');
    if (!r.signer) bad('old needs signer');
  }
}

export function buildSessionLink(r: SessionRequest): string {
  checkRequest(r);
  const p: [string, string][] = [['pubkey', r.pubkey]];
  if (r.old) p.push(['old', r.old]);
  for (const a of r.allow ?? []) p.push(['allow', a]);
  if (r.grant) {
    p.push(['spend', `${r.grant.spendPerPeriod}ugnot`], ['period', String(r.grant.period)], ['expires', String(r.grant.expires)]);
  }
  p.push(['chainid', r.chainid]);
  if (r.rpc) p.push(['rpc', r.rpc]);
  if (r.signer) p.push(['signer', r.signer]);
  p.push(['callback', r.callback], ['state', r.state], ['iat', String(r.iat)]);
  return `${WALLET_SCHEME}://${r.host}?${p.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`;
}

/** A `connect` asking the identity to sign `challenge` (gnoconnect.md, "Proving the identity"). */
export interface ChallengeRequest {
  challenge: string;
  signer: string;
  chainid: string;
  rpc?: string;
  callback: string;
  state: string;
}

export function buildChallengeLink(r: ChallengeRequest): string {
  const p: [string, string][] = [['challenge', r.challenge], ['signer', r.signer], ['chainid', r.chainid]];
  if (r.rpc) p.push(['rpc', r.rpc]);
  p.push(['callback', r.callback], ['state', r.state]);
  return `${WALLET_SCHEME}://connect?${p.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`;
}

type Signer = (data: Uint8Array) => Promise<Uint8Array>;

export async function signLink(link: string, sign: Signer, signOld?: Signer): Promise<string> {
  const data = new TextEncoder().encode(canonicalPayload(link));
  let out = `${link}&sig=${base64url(await sign(data))}`;
  if (signOld) out += `&oldsig=${base64url(await signOld(data))}`;
  return out;
}

export interface WalletReply {
  status: 'success' | 'cancelled' | 'error';
  code: string;
  state: string;
  address: string;
  session: string;
  expiresAt: number;
  allow: string[];
  spend: string;
  period: number;
  chainid: string;
  hash: string;
  /** the address of `old`, when this transaction revoked it */
  revoked: string;
  /** the identity's gpub (with a challenge: the key that signed) */
  pubkey: string;
  /** with a challenge: the bytes signed, base64url */
  signed: string;
  /** with a challenge: 64 bytes R‖S, base64url */
  signature: string;
}

export function parseReplyEntries(es: [string, string][]): WalletReply | null {
  const last = (k: string) => {
    for (let i = es.length - 1; i >= 0; i--) if (es[i][0] === k) return es[i][1];
    return '';
  };
  const status = last('status');
  if (status !== 'success' && status !== 'cancelled' && status !== 'error') return null;
  return {
    status, code: last('code'), state: last('state'), address: last('address'), session: last('session'),
    expiresAt: Number(last('expires_at')) || 0, allow: es.filter(([k]) => k === 'allow').map(([, v]) => v),
    spend: last('spend'), period: Number(last('period')) || 0, chainid: last('chainid'), hash: last('hash'),
    revoked: last('revoked'), pubkey: last('pubkey'), signed: last('signed'), signature: last('signature'),
  };
}

export function parseReplyURL(url: string): WalletReply | null {
  try {
    // the wallet answers in the fragment for an http(s) callback, in the query otherwise
    const { scheme, query, fragment } = splitLink(url);
    const web = scheme === 'http' || scheme === 'https';
    return parseReplyEntries(entries(web ? fragment : query));
  } catch {
    return null; // attacker-controlled input: malformed escapes, not a link
  }
}

/**
 * Whether the reply grants a session to the key at `keyAddress`. A wallet that does not know `pubkey` answers an
 * identity-only `connect`: no `session`, or its own delegated key there. That answer still carries the identity.
 */
export const grantsKey = (r: WalletReply, keyAddress: string) =>
  r.status === 'success' && r.session !== '' && r.session === keyAddress;
