import { fetchPrices, fetchWhere } from '@/offchain/home';
import type { Offchain } from '@/offchain/http';

test('fetchPrices asks for gnot over the period and reads the reply', async () => {
  const get = jest.fn(async () => ({ coin: 'gnot', now: 0.05822, change: -0.308, cap: 11487970.4, series: [[1793183280, 0.0584], [1793183340, 0.0583]] }));
  const oc = { get } as unknown as Offchain;
  expect(await fetchPrices(oc, 7)).toEqual({
    days: 7, now: 0.05822, change: -0.308, cap: 11487970.4, fdv: 0, supply: 0, series: [[1793183280, 0.0584], [1793183340, 0.0583]], volumes: [],
  });
  expect(get).toHaveBeenCalledWith('/api/prices?coin=gnot&days=7');
});

test('a reply without a price says so (null), never $0; only finite points are kept', async () => {
  const oc = { get: jest.fn(async () => ({ now: null, series: [[1, 2], ['x', 3], [4], [5, NaN], [6, 7]] })) } as unknown as Offchain;
  expect(await fetchPrices(oc, 1)).toEqual({ days: 1, now: null, change: 0, cap: 0, fdv: 0, supply: 0, series: [[1, 2], [6, 7]], volumes: [] });
  const oc2 = { get: jest.fn(async () => 'nope') } as unknown as Offchain;
  expect(await fetchPrices(oc2, 1)).toEqual({ days: 1, now: null, change: 0, cap: 0, fdv: 0, supply: 0, series: [], volumes: [] });
});

test('fetchWhere reads count, countries, elsewhere and geo', async () => {
  const get = jest.fn(async () => ({ by_country: [{ cc: 'FR', n: 3 }, { cc: 'AU', n: 1 }], count: 18, elsewhere: 2, geo: true, pools: {}, spots: [] }));
  const oc = { get } as unknown as Offchain;
  expect(await fetchWhere(oc)).toEqual({ count: 18, byCountry: [{ cc: 'FR', n: 3 }, { cc: 'AU', n: 1 }], elsewhere: 2, geo: true, spots: [] });
  expect(get).toHaveBeenCalledWith('/api/where');
});

test('geo is true only when the server says so; bad rows are dropped', async () => {
  const oc = { get: jest.fn(async () => ({ count: 4, by_country: [{ cc: 'FR', n: 3 }, { cc: 5, n: 1 }, { cc: 'ES' }, null] })) } as unknown as Offchain;
  expect(await fetchWhere(oc)).toEqual({ count: 4, byCountry: [{ cc: 'FR', n: 3 }], elsewhere: 0, geo: false, spots: [] });
});

test('fetchPrices reads fdv, supply and the finite volume points', async () => {
  const oc = {
    get: jest.fn(async () => ({
      now: 0.0583, change: -0.02, cap: 11503756, fdv: 77713900, supply: 1333000000,
      series: [[1, 0.06], [2, 0.061]], volumes: [[1, 1112.5], [2, 'x'], [3]],
    })),
  } as unknown as Offchain;
  expect(await fetchPrices(oc, 1)).toMatchObject({ fdv: 77713900, supply: 1333000000, volumes: [[1, 1112.5]] });
});

test('fetchWhere keeps only well-formed spots', async () => {
  const spots = [
    { cc: 'FR', lat: 48.5, lon: 1.5, n: 2 },
    { cc: 'XX', lat: 95, lon: 0, n: 1 },
    { cc: 'ES', lat: 41.5, lon: 2.25, n: 0 },
    { cc: 'BR', lat: -23.5, lon: 'x', n: 1 },
    null,
  ];
  const oc = { get: jest.fn(async () => ({ count: 3, by_country: [], spots, geo: true })) } as unknown as Offchain;
  expect((await fetchWhere(oc)).spots).toEqual([{ cc: 'FR', lat: 48.5, lon: 1.5, n: 2 }]);
  const oc2 = { get: jest.fn(async () => ({ count: 3, spots: 'nope' })) } as unknown as Offchain;
  expect((await fetchWhere(oc2)).spots).toEqual([]);
});
