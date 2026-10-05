/** When the site reports a boop, counted from the boop (setTimeouts at 4, 9, 16, 30 and 60 s). */
export const REPORT_AT_MS: readonly number[] = [4000, 9000, 16000, 30000, 60000];

/**
 * The site's POST /api/bubble/boop after a boop: the server ties the address to this client by it, which is how a
 * name gets reserved ("one boop does it"). Best effort, never in the way of play.
 */
export async function reportBoop(d: {
  report: (addr: string, pool: number, n: number, v: number) => Promise<void>;
  readPool: () => Promise<{ history: { n: number; bidder: string; at: number }[] }>;
  addr: string;
  version: number;
  poolId: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}): Promise<boolean> {
  const start = d.now();
  for (const at of REPORT_AT_MS) {
    await d.sleep(Math.max(0, start + at - d.now()));
    try {
      const mine = (await d.readPool()).history.filter((h) => h.bidder === d.addr).sort((a, b) => b.n - a.n)[0];
      if (!mine || d.now() / 1000 - mine.at > 600) continue;
      await d.report(d.addr, d.poolId, mine.n, d.version);
      return true;
    } catch {
      // the next step tries again
    }
  }
  return false;
}
