import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import script from '../script.ts';
import { buildEdl } from '../lib/fit.ts';
import { readDurations, readTerminal, readTimeline } from '../lib/files.ts';

const OUT = join(import.meta.dirname, '..', 'out');
const edl = buildEdl(
  script,
  readTimeline(join(OUT, 'capture', 'timeline.json')),
  readDurations(join(OUT, 'voice', 'durations.json')),
  readTerminal(join(OUT, 'capture', 'terminal.jsonl')),
);
mkdirSync(join(OUT, 'brand'), { recursive: true });
copyFileSync(join(import.meta.dirname, '..', '..', 'assets', 'brand', 'gno-icon.svg'), join(OUT, 'brand', 'gno-icon.svg'));
writeFileSync(join(OUT, 'edl.json'), JSON.stringify(edl, null, 2));
console.log(`edl: ${edl.scenes.length} scenes, ${(edl.durationInFrames / edl.fps).toFixed(1)} s`);
