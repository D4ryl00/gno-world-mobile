import { useEffect, useState } from 'react';

const ticks = new Map<number, { timer: ReturnType<typeof setInterval>; listeners: Set<() => void> }>();

/** One timer per interval, however many screens and rows tick on it; it stops with its last listener. */
export function subscribeTick(intervalMs: number, fn: () => void): () => void {
  let t = ticks.get(intervalMs);
  if (!t) {
    const listeners = new Set<() => void>();
    t = { timer: setInterval(() => listeners.forEach((l) => l()), intervalMs), listeners };
    ticks.set(intervalMs, t);
  }
  t.listeners.add(fn);
  return () => {
    const cur = ticks.get(intervalMs);
    if (!cur) return;
    cur.listeners.delete(fn);
    if (!cur.listeners.size) {
      clearInterval(cur.timer);
      ticks.delete(intervalMs);
    }
  };
}

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => subscribeTick(intervalMs, () => setNow(Math.floor(Date.now() / 1000))), [intervalMs]);
  return now;
}
