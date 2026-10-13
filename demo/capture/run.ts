import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';

import script from '../script.ts';
import type { Mark, Step, Timeline } from '../lib/types.ts';
import { Sim, StepFailed } from './sim.ts';
import { PORTS, Stage, STATE } from './stage.ts';
import { Computer } from './terminal.ts';
import { gnowebShot } from './web.ts';

const run = promisify(execFile);
const OUT = join(import.meta.dirname, '..', 'out', 'capture');
const APP = { bundle: 'world.gno.app', path: join(STATE, 'build/Build/Products/Release-iphonesimulator/gnoworld.app') };
const WALLET = { bundle: 'land.gno.gnokey', path: join(homedir(), 'gnokey-mobile/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/GnokeyMobile.app') };

const { values: args } = parseArgs({ options: { until: { type: 'string' }, 'no-setup': { type: 'boolean' } } });

const stage = new Stage();
const udid = await Sim.ensureDevice('gnoworld-demo');
const sim = new Sim(udid, join(OUT, 'fail'));
const marks: Mark[] = [];
let t0 = 0;
const clock = () => (Date.now() - t0) / 1000;
let gnoweb: string | undefined;

async function computerSigns() {
  const c = new Computer({
    bin: join(stage.bin, 'gnokey-pair'),
    // gnokey by name, found first on PATH: the terminal on screen shows "gnokey", not a path on this machine
    args: ['-remote', `http://127.0.0.1:${PORTS.rpc}`, '-relay', `ws://127.0.0.1:${PORTS.relay}/v1`, '-gnokey', 'gnokey',
      '-home', stage.home, '-timeout', '3m', '-linger', '20s'],
    env: { PATH: `${stage.bin}:${process.env.PATH}` },
    // before recording (setup) the output is kept apart: its times are not the video's
    clock, log: join(OUT, t0 ? 'terminal.jsonl' : 'setup-terminal.jsonl'),
  });
  await c.start();
  try {
    const code = await c.code();
    await sim.tap('Scan or type the code');
    await sim.tap('7-guitarist-revenge');
    await sim.type(code);
    await sim.tap('Connect');
    await c.expect(/Sign\? \[y\/N\] $/);
    await new Promise((r) => setTimeout(r, 1500)); // let the review be read on screen
    c.send('y\n');
    await c.expect(/Enter password/);
    c.send('\n');
    await c.done();
  } finally {
    c.kill();
  }
}

/** Stops before anything starts when a tool or a build is missing, saying what to run. */
async function preflight() {
  const missing: string[] = [];
  for (const [what, path] of [['the app build', APP.path], ['the gnokey-mobile build', WALLET.path],
    ['gnokey', join(stage.bin, 'gnokey')], ['gnokey-pair', join(stage.bin, 'gnokey-pair')]] as const) {
    if (!existsSync(path)) missing.push(`${what} (${path}) — run npm run demo:build`);
  }
  for (const tool of ['idb', 'idb_companion', 'ffmpeg', 'ffprobe', 'python3']) {
    await run('which', [tool]).catch(() => missing.push(`${tool} is not on PATH`));
  }
  const { stdout } = await run('idb_companion', ['--version']).catch(() => ({ stdout: '' }));
  const v = /(\d+)\.(\d+)\.(\d+)/.exec(stdout);
  if (v && (Number(v[1]) < 1 || (Number(v[1]) === 1 && (Number(v[2]) < 6 || (Number(v[2]) === 6 && Number(v[3]) < 4))))) {
    missing.push(`idb-companion ${v[0]} is too old: 1.6.4 or later (USER=remi brew upgrade idb-companion)`);
  }
  if (missing.length) throw new Error(`cannot capture yet:\n- ${missing.join('\n- ')}`);
}

async function play(scope: string, step: Step) {
  try {
    await act(scope, step);
  } catch (e) {
    if (step.optional && e instanceof StepFailed) return;
    if (e instanceof StepFailed) throw new StepFailed(`${scope}.${step.id}: ${e.message}`, e.dump);
    throw new Error(`${scope}.${step.id}: ${(e as Error).message}`);
  }
}

async function act(scope: string, step: Step) {
  const a = step.do;
  let box;
  if ('launch' in a) await sim.launch(a.launch === 'app' ? APP.bundle : WALLET.bundle);
  else if ('tap' in a) box = (await sim.tap(a.tap, { enabled: a.enabled, timeout: a.timeout })).box;
  else if ('tapEnd' in a) box = (await sim.tapEnd(a.tapEnd)).box;
  else if ('at' in a) await sim.tapAt(...a.at);
  else if ('waitFor' in a) box = (await sim.waitFor(a.waitFor, { timeout: a.timeout, enabled: a.enabled })).box;
  else if ('type' in a) { if (a.into) box = (await sim.tap(a.into)).box; await sim.type(a.type); }
  else if ('backspace' in a) await sim.backspace(a.backspace);
  else if ('swipe' in a) await sim.swipe(...a.swipe);
  else if ('bob' in a) await stage.bobSays(a.bob);
  else if ('computer' in a) await computerSigns();
  else if ('pause' in a) await new Promise((r) => setTimeout(r, a.pause));
  else if ('gnoweb' in a) { await gnowebShot(a.gnoweb, join(OUT, 'gnoweb.png')); gnoweb = 'capture/gnoweb.png'; }
  if (step.mark) marks.push({ id: `${scope}.${step.id}`, t: clock(), ...(box ? { box } : {}) });
}

try {
  await preflight();
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  await stage.up();
  if (!args['no-setup']) await sim.prepare([APP.path, WALLET.path]);
  await sim.connect();
  if (!args['no-setup']) for (const s of script.setup) await play('setup', s);
  await sim.launch(APP.bundle);
  t0 = await sim.startRecording(join(OUT, 'sim.mp4'));
  for (const scene of script.scenes) {
    for (const step of scene.steps ?? []) await play(scene.id, step);
    if (scene.id === args.until) break;
  }
  await sim.stopRecording();
  const { stdout } = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration',
    '-of', 'json', join(OUT, 'sim.mp4')]);
  const probe = JSON.parse(stdout);
  const timeline: Timeline = {
    video: { width: probe.streams[0].width, height: probe.streams[0].height, duration: Number(probe.format.duration) },
    screen: await sim.screenSize(), marks, ...(gnoweb ? { gnoweb } : {}),
  };
  writeFileSync(join(OUT, 'timeline.json'), JSON.stringify(timeline, null, 2));
  console.log(`capture done: ${marks.length} marks, ${timeline.video.duration.toFixed(1)} s — demo/out/capture/`);
} catch (e) {
  console.error(e instanceof StepFailed ? `capture stopped: ${e.message}\n  screenshot and tree: ${e.dump}.{png,json}` : e);
  process.exitCode = 1;
} finally {
  await sim.stopRecording().catch(() => undefined);
  await sim.disconnect();
  await stage.down();
}
