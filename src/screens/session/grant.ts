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
