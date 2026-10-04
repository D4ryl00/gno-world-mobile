export const UGNOT_PER_GNOT = 1_000_000;

/** 1450000 → "1.45 GNOT" (the site's format). */
export function gnot(ugnot: number): string {
  const n = Math.trunc(Number(ugnot));
  const a = Math.abs(n);
  const whole = Math.floor(a / UGNOT_PER_GNOT);
  const frac = String(a % UGNOT_PER_GNOT).padStart(6, '0').replace(/0+$/, '');
  return `${n < 0 ? '-' : ''}${frac ? `${whole}.${frac}` : whole} GNOT`;
}

/** "1.5" → 1500000. Throws on more than 6 decimals or anything not a number. */
export function toUgnot(input: string): number {
  const s = String(input).trim();
  if (!s) return 0;
  const m = /^(\d*)(?:\.(\d{0,6}))?$/.exec(s);
  if (!m || (!m[1] && !m[2])) throw new Error('amount must be a number with up to 6 decimals');
  const n = Number((m[1] || '0') + (m[2] || '').padEnd(6, '0'));
  if (!Number.isSafeInteger(n)) throw new Error('amount too large');
  return n;
}

const UNIT = { s: 1, m: 60, h: 3600, d: 86400 } as const;

/** "90m" → 5400, "2.5d" → 216000: the site's window syntax. */
export function parseDuration(input: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([smhd])$/.exec(String(input).trim().toLowerCase());
  if (!m) throw new Error('a number and s, m, h or d — 90m, 3h, 2.5d');
  return Math.round(parseFloat(m[1]) * UNIT[m[2] as keyof typeof UNIT]);
}

/** 34587 → "9h 36m 27s": at most three units, from the first non-zero one. */
export function humanDuration(seconds: number): string {
  let s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts: [number, string][] = [[d, 'd'], [h, 'h'], [m, 'm'], [s, 's']];
  const first = parts.findIndex(([v]) => v > 0);
  if (first === -1) return '0s';
  return parts.slice(first, first + 3).map(([v, u]) => `${v}${u}`).join(' ');
}
