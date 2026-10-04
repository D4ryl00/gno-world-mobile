import { isOtherChainRequest, KEY_LOST_ERROR } from '@/session/store';
import type { Grant } from '@/session/types';
import { toUgnot } from '@/utils/gnot';

export function grantFromInput(gnotPerHour: string, days: string): { grant?: Grant; error?: string } {
  try {
    const spend = toUgnot(gnotPerHour);
    if (spend <= 0) return { error: 'the hourly budget must be more than 0 GNOT' };
    const d = Number(days);
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
