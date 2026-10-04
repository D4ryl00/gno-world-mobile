import type { SessionStatus } from '@/session/status';
import { isOtherChainRequest, KEY_LOST_ERROR } from '@/session/store';
import { DEFAULT_GRANT, type Grant } from '@/session/types';
import { toUgnot } from '@/utils/gnot';

export function grantFromInput(gnotPerHour: string, days: string): { grant?: Grant; error?: string } {
  try {
    const spend = toUgnot(gnotPerHour);
    if (spend <= 0) return { error: 'the hourly budget must be more than 0 GNOT' };
    const d = /^\d+$/.test(days.trim()) ? Number(days.trim()) : NaN; // "1e1" and "1.5" are not days
    if (!Number.isInteger(d) || d < 1) return { error: 'days must be a whole number, at least 1' };
    if (d > 1460) return { error: 'at most 1460 days (the chain allows about 4 years)' };
    return { grant: { spendPerPeriod: spend, period: 3600, expires: d * 86400 } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** An active session is only read, renewed or revoked on its own chain. */
export function activeCard(sessionChainId: string, currentChainId: string, hasStatus: boolean): 'live' | 'unreadable' | 'other-chain' {
  if (sessionChainId !== currentChainId) return 'other-chain';
  return hasStatus ? 'live' : 'unreadable';
}

/** The buttons the error card shows. A key this phone cannot unlock has no Back: it would return to a session that
 *  cannot sign; retrying re-reads the secure store. */
export function errorActions(error: string | undefined, hasActive: boolean): { forget: boolean; retry: boolean; back: boolean } {
  const keyLost = hasActive && error === KEY_LOST_ERROR;
  return { forget: keyLost, retry: keyLost || isOtherChainRequest(error), back: !keyLost };
}

/** The most a grant lets the app spend over its whole life: its budget, every period. */
export const worstCase = (g: Grant) => Math.ceil(g.expires / g.period) * g.spendPerPeriod;

/** A renewal's starting point: the session's hourly budget and the whole days it has left (30 with no expiry). */
export function initialGrant(st: SessionStatus | undefined, now: number): Grant | undefined {
  if (!st) return undefined;
  const days = st.expiresAt > 0 ? Math.min(1460, Math.max(1, Math.ceil((st.expiresAt - now) / 86400))) : 30;
  return { spendPerPeriod: st.spendLimit > 0 ? st.spendLimit : DEFAULT_GRANT.spendPerPeriod, period: 3600, expires: days * 86400 };
}
