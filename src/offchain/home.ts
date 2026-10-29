import type { Offchain } from './http';

/** The periods of the site's price window. */
export type PriceDays = 1 | 7 | 30;
export const PRICE_DAYS: PriceDays[] = [1, 7, 30];

/** How often to load: prices as the site's hereStatPaint, presence at the heartbeat's rhythm. */
export const PRICES_EVERY_MS = 300000;
export const WHERE_EVERY_MS = 20000;

export interface Prices {
  /** the period this reply covers */
  days: PriceDays;
  /** USD; null: the reply had no price (the site then says "no prices right now") */
  now: number | null;
  /** percent, the server's 24h figure whatever the period */
  change: number;
  /** market cap, USD */
  cap: number;
  /** fully diluted value, USD (price × supply) */
  fdv: number;
  /** total supply, GNOT */
  supply: number;
  /** [seconds, USD], ascending */
  series: [number, number][];
  /** [seconds, USD traded], one per point of series when the server has it */
  volumes: [number, number][];
}

/** An approximate place where people are (a grid of about 0.25°). */
export interface Spot {
  cc: string;
  lat: number;
  lon: number;
  n: number;
}

export interface Where {
  count: number;
  /** largest first, as the server sorts it */
  byCountry: { cc: string; n: number }[];
  /** here, but without a country */
  elsewhere: number;
  /** false: this server build cannot place people */
  geo: boolean;
  spots: Spot[];
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (r: unknown) => (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;

const points = (v: unknown): [number, number][] =>
  (Array.isArray(v) ? v : [])
    .filter((p): p is [number, number] => Array.isArray(p) && p.length >= 2 && isNum(p[0]) && isNum(p[1]))
    .map(([t, p]) => [t, p]);

export async function fetchPrices(oc: Offchain, days: PriceDays): Promise<Prices> {
  const o = obj(await oc.get<unknown>(`/api/prices?coin=gnot&days=${days}`));
  return {
    days,
    now: isNum(o.now) ? o.now : null,
    change: num(o.change),
    cap: num(o.cap),
    fdv: num(o.fdv),
    supply: num(o.supply),
    series: points(o.series),
    volumes: points(o.volumes),
  };
}

const isSpot = (c: Record<string, unknown>) =>
  typeof c.cc === 'string' && isNum(c.lat) && Math.abs(c.lat) <= 90 && isNum(c.lon) && Math.abs(c.lon) <= 180 && isNum(c.n) && c.n > 0;

export async function fetchWhere(oc: Offchain): Promise<Where> {
  const o = obj(await oc.get<unknown>('/api/where'));
  const byCountry = (Array.isArray(o.by_country) ? o.by_country : [])
    .map(obj)
    .filter((c) => typeof c.cc === 'string' && isNum(c.n))
    .map((c) => ({ cc: c.cc as string, n: c.n as number }));
  // the site reads a missing geo as "countries unavailable"
  const spots = (Array.isArray(o.spots) ? o.spots : [])
    .map(obj)
    .filter(isSpot)
    .map((c) => ({ cc: c.cc as string, lat: c.lat as number, lon: c.lon as number, n: c.n as number }));
  return { count: num(o.count), byCountry, elsewhere: num(o.elsewhere), geo: o.geo === true, spots };
}
