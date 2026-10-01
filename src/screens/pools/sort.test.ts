import type { Pool } from '@/chain/parse';
import { sortPools } from '@/screens/pools/sort';

const p = (o: Partial<Pool>): Pool => ({
  key: 'v5-1', version: 5, id: 1, name: '', creator: '', window: 0, life: 0, basePrice: 0, seed: 0, pot: 0, bids: 0,
  nextPrice: 0, lastBidder: '', lastBidAt: 0, firstBidAt: 0, deadline: 0, lastDay: 0, liveBps: 10000, clock: 0,
  createdAt: 0, over: false, popped: false, paid: false, cancelled: false, bidders: 0, shots: 0, misses: 0, pending: 0,
  flag: '', teams: {}, creatorPaid: 0, divPaid: 0, refPaid: 0, treasuryPaid: 0, winnerPaid: 0, teamPaid: 0, sharedPaid: 0,
  history: [], roster: [], shotlog: [], ...o,
});

test('live pools first, biggest pot first, newest versions first on ties; cancelled never live', () => {
  const r = sortPools(
    [
      p({ key: 'a', pot: 10, deadline: 2000, bids: 1 }),
      p({ key: 'b', pot: 50, deadline: 2000, bids: 1, version: 4 }),
      p({ key: 'c', pot: 50, deadline: 2000, bids: 1, version: 5 }),
      p({ key: 'd', pot: 99, over: true, createdAt: 5 }),
      p({ key: 'e', pot: 999, cancelled: true }),
      p({ key: 'f', pot: 1, bids: 0 }), // never booped: open
      p({ key: 'g', pot: 70, deadline: 900, bids: 2 }), // deadline passed, realm not yet told
    ],
    1000,
  );
  expect(r.live.map((x) => x.key)).toEqual(['c', 'b', 'a', 'f']);
  expect(r.closed.map((x) => x.key)).toEqual(['g', 'd', 'e']);
});
