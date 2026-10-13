import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { readDurations } from '../lib/files.ts';
import type { Durations, Edl } from '../lib/types.ts';

const MIN_S = 90;
const MAX_S = 135;
const CAPTION_MAX = 64; // two lines of the 40 px pill at 1100 px

export function checkEdl(edl: Edl, durations: Durations): string[] {
  const problems: string[] = [];
  const total = edl.durationInFrames / edl.fps;
  if (total < MIN_S || total > MAX_S) problems.push(`total ${total.toFixed(1)} s is outside ${MIN_S}–${MAX_S} s`);
  for (const s of edl.scenes) {
    const d = durations[s.id];
    if (s.voice && d && s.voice.from + Math.ceil(d.seconds * edl.fps) > s.duration) {
      problems.push(`scene ${s.id}: the voice (${d.seconds.toFixed(1)} s) runs past the scene (${(s.duration / edl.fps).toFixed(1)} s)`);
    }
    for (const c of s.captions) {
      if (c.text.length > CAPTION_MAX) problems.push(`scene ${s.id}: caption "${c.text.slice(0, 20)}…" has ${c.text.length} characters (max ${CAPTION_MAX})`);
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const run = promisify(execFile);
  const out = join(import.meta.dirname, '..', 'out');
  const edl = JSON.parse(readFileSync(join(out, 'edl.json'), 'utf8')) as Edl;
  const problems = checkEdl(edl, readDurations(join(out, 'voice', 'durations.json')));
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', join(out, 'gnoworld-demo.mp4')]);
  const real = Number(stdout.trim());
  if (Math.abs(real - edl.durationInFrames / edl.fps) > 0.5) problems.push(`the render lasts ${real.toFixed(1)} s, the edit ${(edl.durationInFrames / edl.fps).toFixed(1)} s`);
  mkdirSync(join(out, 'review'), { recursive: true });
  await run('ffmpeg', ['-v', 'error', '-y', '-i', join(out, 'gnoworld-demo.mp4'), '-vf', 'fps=1/2,scale=480:-1,tile=4x4', join(out, 'review', 'sheet-%02d.png')]);
  if (problems.length) {
    console.error(`demo:check found ${problems.length} problem(s):\n- ${problems.join('\n- ')}`);
    process.exitCode = 1;
  } else {
    console.log(`demo:check ok — ${real.toFixed(1)} s; contact sheets in demo/out/review/`);
  }
}
