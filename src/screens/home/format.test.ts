import {
  chartGeom, formatChange, formatFdv, formatPrice, hereRows, hereText, labelAnchor, niceTicks, priceScale, readoutText, shortNum, shortUsd,
  timeTicks,
} from '@/screens/home/format';

test('prices: 4 decimals under $1, 2 above, with thousands', () => {
  expect(formatPrice(0.05822)).toBe('$0.0582');
  expect(formatPrice(1234.5)).toBe('$1,234.50');
});

test('change: a sign always, real minus, 2 decimals', () => {
  expect(formatChange(-0.308)).toBe('−0.31%');
  expect(formatChange(1.5)).toBe('+1.50%');
  expect(formatChange(0)).toBe('+0.00%');
});

test('dollars, shortened', () => {
  expect(shortUsd(11487970.4)).toBe('$11.5M');
  expect(shortUsd(77713900)).toBe('$77.7M');
  expect(shortUsd(2_400_000_000)).toBe('$2.4B');
  expect(shortUsd(950)).toBe('$950');
  expect(shortUsd(12_300)).toBe('$12.3k');
  // rounding up to the next unit names that unit
  expect(shortUsd(999_950)).toBe('$1M');
  expect(shortUsd(999.7)).toBe('$1k');
  expect(shortNum(1_333_000_000, 2)).toBe('1.33B');
});

test('fdv as the site shows it, else the market cap as mc, else nothing', () => {
  expect(formatFdv({ fdv: 77713900, cap: 11503756 })).toBe('fdv $77.7M');
  expect(formatFdv({ fdv: 0, cap: 11503756 })).toBe('mc $11.5M');
  expect(formatFdv({ fdv: 0, cap: 0 })).toBeNull();
});

test('the total in the site words', () => {
  const w = { count: 18, byCountry: [], elsewhere: 0, geo: true, spots: [] };
  expect(hereText(w)).toBe('18 people');
  expect(hereText({ ...w, count: 1 })).toBe('just you');
  expect(hereText({ ...w, count: 0 })).toBe('nobody here right now');
  expect(hereText({ ...w, geo: false })).toBe('18 people · countries unavailable on this build');
});

test('rows: bars against the biggest, elsewhere without a bar', () => {
  expect(hereRows({ count: 6, byCountry: [{ cc: 'FR', n: 3 }, { cc: 'AU', n: 1 }], elsewhere: 2, geo: true, spots: [] })).toEqual([
    { cc: 'FR', name: 'France', n: 3, share: 1 },
    { cc: 'AU', name: 'Australia', n: 1, share: 1 / 3 },
    { cc: '', name: 'elsewhere', n: 2, share: null },
  ]);
});

test('rows: those here the server places nowhere make an "unknown" row with its bar, before elsewhere', () => {
  // 11 here, 5 by country, 2 elsewhere: 4 unknown, the biggest row
  expect(hereRows({ count: 11, byCountry: [{ cc: 'FR', n: 3 }, { cc: 'AU', n: 2 }], elsewhere: 2, geo: true, spots: [] })).toEqual([
    { cc: 'FR', name: 'France', n: 3, share: 3 / 4 },
    { cc: 'AU', name: 'Australia', n: 2, share: 2 / 4 },
    { cc: '', name: 'unknown', n: 4, share: 1 },
    { cc: '', name: 'elsewhere', n: 2, share: null },
  ]);
  // a count lagging behind the table: no negative row
  expect(hereRows({ count: 2, byCountry: [{ cc: 'FR', n: 3 }], elsewhere: 0, geo: true, spots: [] })).toEqual([
    { cc: 'FR', name: 'France', n: 3, share: 1 },
  ]);
});

test('countries unavailable: one "unknown" row with a full bar and the total', () => {
  expect(hereRows({ count: 18, byCountry: [], elsewhere: 0, geo: false, spots: [] })).toEqual([{ cc: '', name: 'unknown', n: 18, share: 1 }]);
  expect(hereRows({ count: 0, byCountry: [], elsewhere: 0, geo: false, spots: [] })).toEqual([]);
});

test('chart: spans the width, highest at the top, lowest at the bottom', () => {
  const g = chartGeom([[0, 1], [10, 3], [20, 2]], 200, 50)!;
  expect(g).toEqual({ points: '0,50 100,0 200,25', min: 1, max: 3 });
});

test('chart: a flat price is a line in the middle; fewer than 2 points is no chart', () => {
  expect(chartGeom([[0, 2], [10, 2]], 100, 40)).toEqual({ points: '0,20 100,20', min: 2, max: 2 });
  expect(chartGeom([[0, 2]], 100, 40)).toBeNull();
  expect(chartGeom([], 100, 40)).toBeNull();
});

test('the crosshair readout, as the site writes it', () => {
  const t = new Date(2026, 9, 27, 14, 5).getTime() / 1000;
  expect(readoutText(t, 0.0594, 1200)).toBe('27 Oct 14:05 · $0.0594 · vol $1.2k');
  expect(readoutText(t, 0.0594, 0)).toBe('27 Oct 14:05 · $0.0594 · vol $0');
  expect(readoutText(t, 0.0594, null)).toBe('27 Oct 14:05 · $0.0594');
});

test('price scale: time across, price up; the nearest point to a finger, ends included', () => {
  const s = priceScale([[0, 1], [10, 2], [20, 3]], { left: 0, right: 200, top: 0, bottom: 100 });
  expect([s.x(0), s.x(20), s.y(3), s.y(1), s.min, s.max]).toEqual([0, 200, 0, 100, 1, 3]);
  expect(s.nearestIndex(-50)).toBe(0);
  expect(s.nearestIndex(95)).toBe(1);
  expect(s.nearestIndex(999)).toBe(2);
  const two = priceScale([[0, 1], [10, 1]], { left: 0, right: 200, top: 0, bottom: 100 });
  expect(two.y(1)).toBe(50); // flat: the middle
  expect([two.nearestIndex(10), two.nearestIndex(190)]).toEqual([0, 1]);
});

test('round price ticks inside the range', () => {
  expect(niceTicks(0.0567, 0.0617, 5)).toEqual([0.057, 0.058, 0.059, 0.06, 0.061]);
  expect(niceTicks(0.0583, 0.0583, 5)).toEqual([0.0583]);
  // the step whose count is nearest to 5: on the live 7d range, 6 labels rather than 3 every 0.002 …
  expect(niceTicks(0.0564, 0.062, 5)).toEqual([0.057, 0.058, 0.059, 0.06, 0.061, 0.062]);
  // … and 4 rather than 9 every 0.0002 on the 1d range
  expect(niceTicks(0.058, 0.0596, 5)).toEqual([0.058, 0.0585, 0.059, 0.0595]);
});

test('time ticks: every 6 hours for a day, midnights for a week, weeks for a month', () => {
  const at = (y: number, m: number, d: number, h: number, mi = 0) => new Date(y, m, d, h, mi).getTime() / 1000;
  const day = at(2026, 9, 28, 13, 24);
  expect(timeTicks(day, day + 86400, 1).map((x) => x.label)).toEqual(['18:00', '00:00', '06:00', '12:00']);
  expect(timeTicks(day, day + 86400, 1)[0].t).toBe(at(2026, 9, 28, 18));
  const week = at(2026, 9, 22, 13);
  expect(timeTicks(week, week + 7 * 86400, 7).map((x) => x.label)).toEqual(['23', '24', '25', '26', '27', '28', '29']);
  const month = at(2026, 8, 29, 13);
  expect(timeTicks(month, month + 30 * 86400, 30).map((x) => x.label)).toEqual(['30 Sep', '7 Oct', '14 Oct', '21 Oct', '28 Oct']);
});

test('a time label near an edge leans inward instead of being cut', () => {
  expect(labelAnchor(2, '30 Sep', 300)).toBe('start');
  expect(labelAnchor(150, '7 Oct', 300)).toBe('middle');
  expect(labelAnchor(296, '28 Oct', 300)).toBe('end');
});
