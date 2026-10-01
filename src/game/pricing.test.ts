import { BOOSTS, clockFor, gasFor, price } from '@/game/pricing';

test('price matches the realm (base·√(n+1), ceil)', () => {
  expect(price(500000, 22)).toBe(2397916); // pool v5-2 nextPrice
  expect(price(500000, 1)).toBe(707107); // pool v5-1 nextPrice
  expect(price(1000000, 0)).toBe(1000000);
});

test('clockFor matches ClockFor', () => {
  const p = 2397916;
  expect(clockFor(43200, p, p)).toBe(43200);
  expect(clockFor(43200, p, p * BOOSTS[1])).toBe(21600);
  expect(clockFor(43200, p, p * BOOSTS[3])).toBe(4320);
  expect(clockFor(43200, p, p * 20)).toBe(4320); // never under window/10
  expect(clockFor(600, 1000, 10000)).toBe(300); // never under 5 minutes
});

test('gasFor is the site table', () => {
  expect(gasFor('Bid', { bids: 22, shots: 3 })).toEqual({ wanted: 39600000, fee: 39600 });
  expect(gasFor('Bid', { bids: 1000, shots: 100 })).toEqual({ wanted: 100000000, fee: 100000 });
  expect(gasFor('CreatePool')).toEqual({ wanted: 30000000, fee: 30000 });
  expect(gasFor('Withdraw')).toEqual({ wanted: 30000000, fee: 30000 });
});
