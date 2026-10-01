export const MIN_CLOCK = 300;
export const MAX_BOOST = 10;
export const BOOSTS = [1, 2, 4, 10] as const;
export const BOOST_LABELS = ['100%', '50%', '25%', '10%'] as const;

/** The Nth boop's price: Price(base, bids) = ceil(base·√(bids+1)). */
export const price = (base: number, bids: number) => Math.ceil(base * Math.sqrt(bids + 1));

/** ClockFor: the window divided by the multiple paid, within [max(window/10, 5 min), window]. */
export function clockFor(window: number, priceU: number, sent: number): number {
  let c = Math.trunc((window * priceU) / sent);
  if (c < Math.trunc(window / MAX_BOOST)) c = Math.trunc(window / MAX_BOOST);
  if (c < MIN_CLOCK) c = MIN_CLOCK;
  if (c > window) c = window;
  return c;
}

const POOL_FUNCS = new Set(['Bid', 'Claim', 'Cancel']);

/** The site's gas table; fee in ugnot. */
export function gasFor(func: string, pool?: { bids: number; shots: number }) {
  if (pool && POOL_FUNCS.has(func)) {
    const wanted = Math.min(1e8, 3e7 + 3e5 * pool.bids + 1e6 * pool.shots);
    return { wanted, fee: wanted / 1000 };
  }
  return { wanted: 3e7, fee: 3e4 };
}
