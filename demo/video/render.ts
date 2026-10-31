import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { loadScript } from '../lib/which.ts';

// npm run render | studio: the edit of the script DEMO names, served from its own output folder
const { out, output } = await loadScript();
const studio = process.argv[2] === 'studio';
const node = (args: string[]) => spawnSync('node', ['--experimental-strip-types', '--no-warnings', ...args], { stdio: 'inherit' });
const npx = (args: string[]) => spawnSync('npx', args, { stdio: 'inherit' });

const planned = node([join(import.meta.dirname, 'plan.ts')]);
if (planned.status !== 0) process.exit(planned.status ?? 1);
const r = studio
  ? npx(['remotion', 'studio', 'video/index.ts', `--props=${join(out, 'edl.json')}`, `--public-dir=${out}`])
  : npx(['remotion', 'render', 'video/index.ts', 'Demo', join(out, output), `--props=${join(out, 'edl.json')}`, `--public-dir=${out}`]);
process.exit(r.status ?? 1);
