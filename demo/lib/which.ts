import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Script } from './types.ts';

export const DEMO_DIR = resolve(import.meta.dirname, '..');

/** The script `DEMO` names and its output folder: none (or `script`) is the first demo, script.ts and out/. */
export function pick(name: string | undefined, dir = DEMO_DIR): { name: string; file: string; out: string } {
  const n = name || 'script';
  const file = join(dir, `${n}.ts`);
  if (!existsSync(file)) throw new Error(`no demo script demo/${n}.ts (DEMO=${n})`);
  return { name: n, file, out: join(dir, n === 'script' ? 'out' : `out-${n}`) };
}

/** What a script leaves out is the first demo's: a local chain, the iOS 26.5 iPhone 17 Pro, 90–135 s. */
export function defaults(s: Script) {
  return {
    target: s.target ?? 'local',
    device: s.device ?? {
      name: 'gnoworld-demo',
      type: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro',
      runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5',
    },
    app: s.app ?? 'build/Build/Products/Release-iphonesimulator/gnoworld.app',
    teardown: s.teardown ?? [],
    check: s.check ?? { min: 90, max: 135 },
    output: s.output ?? 'gnoworld-demo.mp4',
  } satisfies Required<Pick<Script, 'target' | 'device' | 'app' | 'teardown' | 'check' | 'output'>>;
}

/** The script `DEMO` names, its settings with their defaults, and its output folder. */
export async function loadScript() {
  const p = pick(process.env.DEMO);
  const { default: script } = (await import(p.file)) as { default: Script };
  return { script, ...defaults(script), out: p.out, name: p.name };
}
