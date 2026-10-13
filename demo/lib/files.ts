import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { Durations, TermChunk, Timeline } from './types.ts';

const load = (path: string, hint: string): unknown => {
  const name = basename(path);
  if (!existsSync(path)) throw new Error(`${name}: missing — ${hint}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`${name}: not JSON`);
  }
};

const num = (name: string, where: string, v: unknown, positive = false): number => {
  if (typeof v !== 'number' || !Number.isFinite(v) || (positive && v <= 0)) {
    throw new Error(`${name}: ${where} is not a ${positive ? 'positive ' : ''}number`);
  }
  return v;
};

export function readTimeline(path: string): Timeline {
  const name = basename(path);
  const raw = load(path, 'run npm run demo:capture') as Record<string, unknown>;
  const video = (raw?.video ?? {}) as Record<string, unknown>;
  const screen = (raw?.screen ?? {}) as Record<string, unknown>;
  for (const k of ['width', 'height', 'duration']) num(name, `video.${k}`, video[k], true);
  for (const k of ['width', 'height']) num(name, `screen.${k}`, screen[k], true);
  if (!Array.isArray(raw.marks)) throw new Error(`${name}: marks is not a list`);
  raw.marks.forEach((m: Record<string, unknown>, i: number) => {
    if (typeof m?.id !== 'string' || !m.id) throw new Error(`${name}: marks[${i}].id is not a string`);
    num(name, `marks[${i}].t`, m.t);
    if (m.box !== undefined) {
      const b = m.box as Record<string, unknown>;
      for (const k of ['x', 'y', 'w', 'h']) num(name, `marks[${i}].box.${k}`, b?.[k]);
    }
  });
  if (raw.gnoweb !== undefined && typeof raw.gnoweb !== 'string') throw new Error(`${name}: gnoweb is not a string`);
  return raw as unknown as Timeline;
}

export function readDurations(path: string): Durations {
  const name = basename(path);
  const raw = load(path, 'run npm run demo:voice') as Record<string, Record<string, unknown>>;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${name}: not an object`);
  for (const [id, d] of Object.entries(raw)) {
    if (typeof d?.file !== 'string') throw new Error(`${name}: ${id}.file is not a string`);
    num(name, `${id}.seconds`, d.seconds, true);
  }
  return raw as unknown as Durations;
}

export function readTerminal(path: string): TermChunk[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      const c = JSON.parse(l) as TermChunk;
      num(basename(path), `line ${i + 1}.t`, c.t);
      return c;
    });
}
