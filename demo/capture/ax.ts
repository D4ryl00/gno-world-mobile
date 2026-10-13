import type { Box, Match } from '../lib/types.ts';

export interface AxElement { label: string; value: string; type: string; enabled: boolean; box: Box }

const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function parseDescribeAll(json: string): AxElement[] {
  const list = JSON.parse(json) as Record<string, unknown>[];
  return list.map((e) => {
    const f = (e.frame ?? {}) as Record<string, number>;
    return {
      label: s(e.AXLabel), value: s(e.AXValue), type: s(e.type), enabled: e.enabled !== false,
      box: { x: f.x, y: f.y, w: f.width, h: f.height },
    };
  });
}

const hit = (e: AxElement, m: Match) => (typeof m === 'string' ? e.label === m || e.value === m : m.test(e.label) || m.test(e.value));

export function find(els: AxElement[], m: Match, o: { enabled?: boolean } = {}): AxElement | undefined {
  const ok = (e: AxElement) => hit(e, m) && (o.enabled === undefined || e.enabled === o.enabled);
  // a string: an exact label wins over an exact value
  if (typeof m === 'string') return els.find((e) => ok(e) && e.label === m) ?? els.find(ok);
  return els.find(ok);
}

export const centre = (b: Box): [number, number] => [b.x + b.w / 2, b.y + b.h / 2];
