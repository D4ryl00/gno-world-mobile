import type { Pool } from '@/chain/parse';

export const isLive = (p: Pool, now: number) => !p.cancelled && !p.over && !(p.bids > 0 && p.deadline > 0 && p.deadline <= now);

export function sortPools(pools: Pool[], now: number): { live: Pool[]; closed: Pool[] } {
  const live = pools.filter((p) => isLive(p, now)).sort((a, b) => b.pot - a.pot || b.version - a.version);
  const closed = pools
    .filter((p) => !isLive(p, now))
    .sort((a, b) => Number(a.cancelled) - Number(b.cancelled) || b.deadline - a.deadline || b.createdAt - a.createdAt);
  return { live, closed };
}
