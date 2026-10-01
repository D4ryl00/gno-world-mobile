import { base64url } from '@/utils/base64url';

import type { Grant } from './types';

export const WALLET_SCHEME = 'land.gno.gnokey';
export const CALLBACK_URL = 'bubblerumble://session-callback';
/** `connect` with `pubkey` grants (with `old`, renews in one transaction); `disconnect` revokes. */
export type SessionHost = 'connect' | 'disconnect';

const enc = encodeURIComponent;

function splitLink(link: string): { host: string; query: string; fragment: string } {
  const afterScheme = link.slice(link.indexOf('://') + 3);
  const hash = afterScheme.indexOf('#');
  const noFrag = hash >= 0 ? afterScheme.slice(0, hash) : afterScheme;
  const q = noFrag.indexOf('?');
  const hostPath = q >= 0 ? noFrag.slice(0, q) : noFrag;
  return {
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

/** The proof-of-possession payload (gnoconnect-session.md, "Proof of possession"). */
export function canonicalPayload(link: string): string {
  const { host, query } = splitLink(link);
  const kvs = entries(query).filter(([k]) => k !== 'sig' && k !== 'oldsig');
  for (const [k, v] of kvs) if (/[\u0000-\u001f\u007f]/.test(k + v)) throw new Error(`control character in ${k}`);
  kvs.sort(([ak, av], [bk, bv]) => (ak !== bk ? (ak < bk ? -1 : 1) : av < bv ? -1 : av > bv ? 1 : 0));
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

export function buildSessionLink(r: SessionRequest): string {
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
    revoked: last('revoked'),
  };
}

export function parseReplyURL(url: string): WalletReply | null {
  try {
    const { query, fragment } = splitLink(url);
    return parseReplyEntries([...entries(query), ...entries(fragment)]);
  } catch (e) {
    if (e instanceof URIError) return null;
    throw e;
  }
}

/**
 * Whether the reply grants a session to the key at `keyAddress`. A wallet that does not know `pubkey` answers an
 * identity-only `connect`: no `session`, or its own delegated key there. That answer still carries the identity.
 */
export const grantsKey = (r: WalletReply, keyAddress: string) =>
  r.status === 'success' && r.session !== '' && r.session === keyAddress;
