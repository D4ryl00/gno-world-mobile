/**
 * The CSS transform-origin (0..1, one axis) that, at scale `s`, centres the view on `c` — a zoom around origin o
 * shows the source interval [o − o/s, o + (1 − o)/s]. Clamped to 0..1, which keeps the view inside the screen.
 */
export function originFor(c: number, s: number): number {
  if (s <= 1) return 0.5;
  return Math.min(1, Math.max(0, (2 * c * s - 1) / (2 * (s - 1))));
}
