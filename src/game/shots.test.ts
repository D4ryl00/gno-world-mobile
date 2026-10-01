import { oddsBps, shotFor, shotPause, takeFor, type ShotInputs } from '@/game/shots';

const base: ShotInputs = {
  version: 5,
  pot: 1_000_000,
  bids: 2,
  liveBps: 10000,
  roster: [{ addr: 'me', paid: 500_000 }],
  me: 'me',
  hasRef: false,
  revealTip: 20_000,
  minShot: 100_000,
};

test('takeFor with nobody else on the roster is the whole pot after the bid', () => {
  // 1e6 + 50% of 1e6 + 10% ref share (no ref) − tip
  expect(takeFor(base, 1_000_000, 0)).toBe(1_580_000);
});

test('takeFor discounts the slide owed to the others', () => {
  const p: ShotInputs = { ...base, pot: 2_000_000, liveBps: 5000, roster: [{ addr: 'x', paid: 1_000_000 }], hasRef: true };
  expect(takeFor(p, 1_000_000, 0)).toBe(2_077_000);
});

test('oddsBps is 0.8 of fair, capped at 1%', () => {
  expect(oddsBps(base, 1_000_000, 30_000)).toBe(49);
  expect(oddsBps(base, 1_000_000, 100_000)).toBe(100);
  expect(oddsBps(base, 1_000_000, 0)).toBe(0);
});

test('shotFor never goes under the realm minimum', () => {
  expect(shotFor(base, 25, 1_000_000)).toBe(100_000);
});

test('shotPause mirrors the site messages', () => {
  const info = { shotsOn: true, commitsFree: 5, keeperSeen: 1000, keeperFresh: 300, liveFloor: 2500, now: 1100 };
  expect(shotPause(base, info)).toBe('');
  expect(shotPause(base, { ...info, shotsOn: false })).toBe('shots are off');
  expect(shotPause(base, { ...info, commitsFree: 0 })).toMatch(/no commitments left/);
  expect(shotPause(base, { ...info, now: 2000 })).toMatch(/keeper has not been seen/);
  expect(shotPause({ ...base, liveBps: 2000 }, info)).toMatch(/slid under a quarter/);
  expect(shotPause({ ...base, version: 3 }, info)).toBe('');
});
