import { reportBoop, REPORT_AT_MS } from '@/offchain/chat/boop-report';

const ME = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';

function harness(histories: { n: number; bidder: string; at: number }[][], report = jest.fn(async () => undefined)) {
  let clock = 1_790_000_000_000;
  const sleeps: number[] = [];
  return {
    report, sleeps,
    run: () => reportBoop({
      report, addr: ME, version: 6, poolId: 12,
      readPool: async () => ({ history: histories.shift() ?? [] }),
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    }),
    at: () => clock / 1000,
  };
}

test('it reports the newest boop of this address, as the site does', async () => {
  const t = 1_790_000_000;
  const h = harness([[{ n: 3, bidder: ME, at: t }, { n: 5, bidder: ME, at: t + 2 }, { n: 6, bidder: 'g1other', at: t + 3 }]]);
  expect(await h.run()).toBe(true);
  expect(h.report).toHaveBeenCalledWith(ME, 12, 5, 6);
  expect(h.sleeps).toEqual([REPORT_AT_MS[0]]);
});

test('it reads again until the boop shows, on the site\'s schedule', async () => {
  const t = 1_790_000_010;
  const h = harness([[], [], [{ n: 1, bidder: ME, at: t }]]);
  expect(await h.run()).toBe(true);
  expect(h.sleeps).toEqual([4000, 5000, 7000]);
});

test('a boop older than ten minutes is not reported', async () => {
  const h = harness(Array(5).fill([{ n: 1, bidder: ME, at: 1_789_000_000 }]));
  expect(await h.run()).toBe(false);
  expect(h.report).not.toHaveBeenCalled();
});

test('a refused report is tried again at the next step, then given up', async () => {
  const report = jest.fn().mockRejectedValueOnce(new Error('400')).mockResolvedValueOnce(undefined);
  const t = 1_790_000_000;
  const h = harness([[{ n: 1, bidder: ME, at: t }], [{ n: 1, bidder: ME, at: t }]], report);
  expect(await h.run()).toBe(true);
  expect(report).toHaveBeenCalledTimes(2);
  const never = harness(Array(5).fill([]));
  expect(await never.run()).toBe(false);
  expect(never.sleeps).toHaveLength(REPORT_AT_MS.length);
});
