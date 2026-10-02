import { ugnot, type ChainApi } from '@/chain/api';
import { decodeAddress } from '@/utils/bech32';

export interface SessionStatus {
  expiresAt: number;
  spendLimit: number;
  spendUsed: number;
  spendReset: number;
  spendPeriod: number;
  allowPaths: string[];
}

/** Gnoclient reports a missing session as an unknown address; "session not found" is the fake API's text. */
const SESSION_NOT_FOUND = /\bErrUnknownAddress\b|unknown master address|session not found/i;

export async function querySession(api: ChainApi, master: string, session: string): Promise<SessionStatus | null> {
  let res;
  try {
    res = await api.querySessionAccount(decodeAddress(master), decodeAddress(session));
  } catch (e) {
    if (SESSION_NOT_FOUND.test(String((e as Error)?.message ?? e))) return null;
    throw e;
  }
  const a = res.accountInfo;
  if (!a) return null;
  return {
    expiresAt: Number(a.expiresAt), spendLimit: ugnot(a.spendLimit), spendUsed: ugnot(a.spendUsed),
    spendReset: Number(a.spendReset), spendPeriod: Number(a.spendPeriod), allowPaths: [...a.allowPaths],
  };
}

const windowOver = (s: SessionStatus, now: number) => s.spendPeriod > 0 && now >= s.spendReset + s.spendPeriod;

export const remaining = (s: SessionStatus, now: number) =>
  windowOver(s, now) ? s.spendLimit : Math.max(0, s.spendLimit - s.spendUsed);

export const resetsIn = (s: SessionStatus, now: number) =>
  s.spendPeriod > 0 && !windowOver(s, now) ? s.spendReset + s.spendPeriod - now : 0;

export const expiresSoon = (s: SessionStatus, now: number, days = 3) =>
  s.expiresAt > 0 && s.expiresAt - now <= days * 86400;

/** Does a session allow entry cover `need` (a `vm/exec:<path>` entry)? The chain's grammar: `*`, `<route>/<type>`, or
 *  `vm/exec:<path>` matching that path and everything under it. */
const covers = (entry: string, need: string): boolean => {
  if (entry === '*' || entry === need) return true;
  const [type, path] = need.split(/:(.*)/s);
  if (entry === type) return true;
  return path !== undefined && entry.startsWith(`${type}:`) && path.startsWith(`${entry.slice(type.length + 1)}/`);
};

/** The entries of `need` that the session's allowed paths do not cover. */
export const missingPaths = (s: SessionStatus, need: readonly string[]): string[] =>
  need.filter((n) => !s.allowPaths.some((e) => covers(e, n)));

export async function pollSession(
  api: ChainApi, master: string, session: string, want: 'present' | 'absent',
  opts: { intervalMs: number; signal: { aborted: boolean }; sleep?: (ms: number) => Promise<void> },
): Promise<SessionStatus | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (;;) {
    if (opts.signal.aborted) throw new Error('cancelled');
    const st = await querySession(api, master, session).catch(() => undefined); // transient errors: try again
    if (st !== undefined && (want === 'present' ? st !== null : st === null)) return st;
    await sleep(opts.intervalMs);
    if (opts.signal.aborted) throw new Error('cancelled');
  }
}
