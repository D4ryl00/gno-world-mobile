import type { PriceDays, Where } from '@/offchain/home';
import { countryName } from '@/utils/country';

export function formatPrice(usd: number): string {
  const d = usd < 1 ? 4 : 2;
  return '$' + usd.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** a sign always; the site writes "-" and 1 decimal, here the real minus sign and 2 decimals */
export const formatChange = (pct: number) => `${pct < 0 ? '−' : '+'}${Math.abs(pct).toFixed(2)}%`;

const UNITS: [number, string][] = [
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
];

/** The largest unit that still reads 1 or more once rounded: 999,950 is 1M, not 1000k. */
export function shortNum(v: number, digits = 1): string {
  for (const [div, unit] of UNITS) {
    const r = Number((v / div).toFixed(digits));
    if (r >= 1) return `${r}${unit}`;
  }
  return String(Math.round(v));
}

export const shortUsd = (usd: number) => `$${shortNum(usd)}`;

/** The site's figure next to the price (priceLoad): fdv, else the market cap as "mc", else nothing. */
export function formatFdv(p: { fdv: number; cap: number }): string | null {
  return p.fdv > 0 ? `fdv ${shortUsd(p.fdv)}` : p.cap > 0 ? `mc ${shortUsd(p.cap)}` : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const dayMonth = (d: Date) => `${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** What the crosshair reads, as the site's priceReadout: a point without a volume says nothing of it. */
export function readoutText(t: number, price: number, vol: number | null): string {
  const d = new Date(t * 1000);
  return `${dayMonth(d)} ${pad(d.getHours())}:${pad(d.getMinutes())} · ${formatPrice(price)}` + (vol === null ? '' : ` · vol ${shortUsd(vol)}`);
}

/** The site's words for the total (herePaint). */
export function hereText(w: Where): string {
  const n = w.count === 0 ? 'nobody here right now' : w.count === 1 ? 'just you' : `${w.count} people`;
  return n + (w.geo ? '' : ' · countries unavailable on this build');
}

export interface HereRow {
  cc: string;
  name: string;
  n: number;
  /** 0..1 of the biggest row; null: no bar */
  share: number | null;
}

/** The site's table; empty means "nobody yet". */
export function hereRows(w: Where): HereRow[] {
  // without countries, everyone in one row rather than an empty table (decided 2026-10-29)
  if (!w.geo) return w.count > 0 ? [{ cc: '', name: 'unknown', n: w.count, share: 1 }] : [];
  const max = Math.max(1, ...w.byCountry.map((c) => c.n));
  const rows: HereRow[] = w.byCountry.map((c) => ({ cc: c.cc, name: countryName(c.cc), n: c.n, share: c.n / max }));
  if (w.elsewhere > 0) rows.push({ cc: '', name: 'elsewhere', n: w.elsewhere, share: null });
  return rows;
}

export interface ChartGeom {
  /** an SVG polyline's points */
  points: string;
  min: number;
  max: number;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function chartGeom(series: [number, number][], width: number, height: number): ChartGeom | null {
  if (series.length < 2) return null;
  const prices = series.map(([, p]) => p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const t0 = series[0][0];
  const span = series[series.length - 1][0] - t0 || 1;
  const points = series
    .map(([t, p]) => `${r1(((t - t0) / span) * width)},${r1(max === min ? height / 2 : (height * (max - p)) / (max - min))}`)
    .join(' ');
  return { points, min, max };
}

export interface Scale {
  x(t: number): number;
  y(p: number): number;
  min: number;
  max: number;
  /** the point nearest to a finger at px; past either end, that end */
  nearestIndex(px: number): number;
}

export function priceScale(series: [number, number][], box: { left: number; right: number; top: number; bottom: number }): Scale {
  const prices = series.map(([, p]) => p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const t0 = series[0][0];
  const span = series[series.length - 1][0] - t0 || 1;
  const w = box.right - box.left;
  const x = (t: number) => box.left + ((t - t0) / span) * w;
  const y = (p: number) => (max === min ? (box.top + box.bottom) / 2 : box.top + ((max - p) / (max - min)) * (box.bottom - box.top));
  const nearestIndex = (px: number) => {
    const t = t0 + ((px - box.left) / w) * span;
    let lo = 0;
    let hi = series.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (series[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    return t - series[lo][0] <= series[hi][0] - t ? lo : hi;
  };
  return { x, y, min, max, nearestIndex };
}

/** Round steps (1, 2 or 5 × 10^k) inside [min, max]: the step whose number of ticks is nearest to `count`. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const mag = 10 ** Math.floor(Math.log10((max - min) / count));
  const ticksOf = (step: number) => {
    const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
    const ticks: number[] = [];
    for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) ticks.push(Number((k * step).toFixed(digits)));
    return ticks;
  };
  // fewer ticks first, so a tie keeps the axis light
  const candidates = [10, 5, 2, 1, 0.5].map((f) => ticksOf(f * mag));
  return candidates.reduce((best, t) => (Math.abs(t.length - count) < Math.abs(best.length - count) ? t : best));
}

/** Bottom axis labels: every 6 h for 1d, each midnight for 7d, every 7th midnight for 30d (local time). */
export function timeTicks(t0: number, t1: number, days: PriceDays): { t: number; label: string }[] {
  const d = new Date(t0 * 1000);
  const ticks: { t: number; label: string }[] = [];
  if (days === 1) {
    d.setMinutes(0, 0, 0);
    d.setHours(Math.ceil((d.getTime() / 1000 < t0 ? d.getHours() + 1 : d.getHours()) / 6) * 6);
    for (; d.getTime() / 1000 <= t1; d.setHours(d.getHours() + 6)) ticks.push({ t: d.getTime() / 1000, label: `${pad(d.getHours())}:00` });
    return ticks;
  }
  d.setHours(24, 0, 0, 0); // the first midnight after t0
  for (; d.getTime() / 1000 <= t1; d.setDate(d.getDate() + (days === 7 ? 1 : 7)))
    ticks.push({ t: d.getTime() / 1000, label: days === 7 ? String(d.getDate()) : dayMonth(d) });
  return ticks;
}

/** Where a label centred on x would spill past 0 or `width` (about 6 px a character at 10 px), it leans inward. */
export function labelAnchor(x: number, label: string, width: number): 'start' | 'middle' | 'end' {
  const half = label.length * 3;
  return x < half ? 'start' : x > width - half ? 'end' : 'middle';
}
