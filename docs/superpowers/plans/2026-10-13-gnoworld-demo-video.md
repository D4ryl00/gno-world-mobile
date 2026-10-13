# gno.world Demo Video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run demo` films gno.world and gnokey-mobile on the iOS simulator against a fresh local chain, voices a script with Kokoro, and renders a ~2 min 1080p video with Remotion.

**Architecture:** `demo/` is its own npm package inside `~/bubblerumble`, invisible to the app's Metro, jest, tsc and eslint. A capture program drives the simulator with idb, gnokey-pair through a pty and the fake chat server through HTTP, while `simctl` records the screen; every step leaves a mark (time + accessibility box) in `timeline.json`. Pure functions turn the script, the marks and the voice durations into an edit decision list (`edl.json`) that a Remotion composition renders.

**Tech Stack:** Node 22 (`--experimental-strip-types`, `node --test`), TypeScript, Remotion 4.0.535 (+ `@remotion/cli`, `@remotion/google-fonts`), React 19.2.3, kokoro-js 1.2.1, Playwright (gnoweb shot), Python 3 stdlib (pty helper), idb (fb-idb 1.5.2 + idb-companion ≥ 1.6.4), `xcrun simctl`, ffmpeg/ffprobe, gnodev (gnonative's gno revision), gnokey with `sign-data` and gnokey-pair (`~/gno-gnokey-pair` `feat/gnokey-pair`), the magic-wormhole mailbox server (gnokey-pair's `.venv`).

**Spec:** `docs/superpowers/specs/2026-10-13-gnoworld-demo-video-design.md`

## Global Constraints

- Output: `demo/out/gnoworld-demo.mp4`, 1920×1080, 30 fps, H.264 + AAC, total length between 1 min 45 s and 2 min 15 s.
- English narration and captions; audience: gno developers.
- iOS simulator only: a dedicated device named `gnoworld-demo` (iPhone 17 Pro, iOS 26.5 runtime), erased at the start of every capture. Never touch other simulators.
- No code is added to the app (`src/`) or to gnokey-mobile for the demo. A behaviour that looks wrong on camera is reported to the user as an app bug, not worked around.
- gnokey-mobile is never edited and never names a dapp (memory: wallet-dapp-agnostic).
- Simulator rules: never send Return (`idb ui key 40`); ≥ 0.3 s between key events; tap a field before typing; iOS may ask "Open in …?" for a custom-scheme link — tap "Open".
- Ports: gnodev RPC `127.0.0.1:26657` (the app's "Local gnodev" preset), gnoweb `127.0.0.1:8888`, fake chat server `127.0.0.1:8787`, relay `127.0.0.1:4000`. A port already in use stops the capture with a message naming it.
- Colours: background `#06090e`, accent green `#3ddc84`, beard white `#f2fff7`; logo from `assets/brand/gno-icon.svg`.
- No music.
- The app's own checks stay green after every task: `npx expo lint` (zero errors and warnings), `npx tsc --noEmit`, `npx jest`.
- Node 22.8 with `--experimental-strip-types`: no `import.meta.main` (use `process.argv[1] === fileURLToPath(import.meta.url)`), no constructor parameter properties, no enums; `import type` for types.
- Commit after every task; messages in the repo's style (`feat(demo): …`, `docs: …`).

## Review Focus

- **A label that changed in the app or the wallet** — the capture must stop at that step, name it, and leave a screenshot and the accessibility tree in `demo/out/capture/fail/`, never film on (Task 4 `waitFor` timeout test; Task 7 failure path).
- **A leftover process from an aborted run** (gnodev, fake server, relay, companion, recordVideo still listening) — the next run must say which port is taken instead of filming against a stale chain (Task 5 port test).
- **A voice line longer than its footage, or footage much longer than its line** — the edit must hold or speed up (max ×4, then lengthen the scene), never cut the voice (Task 2 tests).
- **Missing or damaged `timeline.json` / `durations.json` / a scene whose marks are absent** — `demo:render` must fail with the file and the missing mark named (Task 1 and Task 2 tests).
- **gnokey-pair asking something unexpected** (a `[y/N]` about the node, a Ledger, a failure) — the terminal driver must fail with the last lines of output rather than hang (Task 6 unexpected-prompt test).

---

## File Structure

```
metro.config.js                     NEW  Expo default config + resolver.blockList for /demo/
tsconfig.json                       MOD  "exclude": ["node_modules", "demo"]
eslint.config.js                    MOD  ignores += "demo/*"
package.json                        MOD  jest.testPathIgnorePatterns += "/demo/"; scripts demo, demo:*
.gitignore                          MOD  demo/node_modules, demo/out, demo/.state
scripts/gnodev.sh                   MOD  GNODEV_WEB=1 drops -no-web (gnoweb on :8888)
demo/package.json                   NEW  the demo's dependencies and scripts
demo/tsconfig.json                  NEW
demo/remotion.config.ts             NEW  public dir = out/
demo/script.ts                      NEW  scenes, narration, captions, setup + scene steps (the single source)
demo/lib/types.ts                   NEW  Script, Scene, Step, Timeline, Durations, Edl types
demo/lib/files.ts (+ .test.ts)      NEW  readTimeline, readDurations: validated reads
demo/lib/fit.ts (+ .test.ts)        NEW  buildEdl(): cuts, speed, hold, zoom keyframes, captions
demo/tools/build.sh                 NEW  npm run demo:build: gnokey, gnokey-pair, relay venv, app Release, gnokey-mobile
demo/capture/ax.ts (+ .test.ts)     NEW  parse idb describe-all, match labels, centres
demo/capture/sim.ts                 NEW  Sim: idb + simctl commands, waitFor, recording
demo/capture/stage.ts (+ .test.ts)  NEW  chain, gnoweb, fake server, relay, keys, Bob's pool; teardown
demo/capture/pty-run.py             NEW  runs a program in a pty: timestamped output on stdout, input from stdin
demo/capture/terminal.ts (+ .test.ts) NEW  Computer: gnokey-pair driven through pty-run.py
demo/capture/web.ts                 NEW  gnoweb screenshot with Playwright
demo/capture/run.ts                 NEW  main: setup, record, play steps, write out/capture/*
demo/capture/fixtures/*.json        NEW  real describe-all trees (tests + label reference)
demo/voice/voice.ts (+ .test.ts)    NEW  kokoro-js lines with a cache, durations.json
demo/video/index.ts, Root.tsx, Demo.tsx, scenes.tsx, parts.tsx   NEW  the composition
demo/video/plan.ts                  NEW  writes out/edl.json from script + timeline + durations
demo/check/check.ts (+ .test.ts)    NEW  post-render checks and contact sheets
```

Times: every `t` in `timeline.json` and `terminal.jsonl` is seconds since the first frame of `out/capture/sim.mp4`.

---

### Task 1: Scaffold `demo/` and keep the app blind to it

**Files:**
- Create: `metro.config.js`, `demo/package.json`, `demo/tsconfig.json`, `demo/remotion.config.ts`, `demo/lib/types.ts`, `demo/lib/files.ts`, `demo/lib/files.test.ts`
- Modify: `tsconfig.json`, `eslint.config.js`, `package.json`, `.gitignore`

**Interfaces:**
- Produces (in `demo/lib/types.ts`): `Box`, `Mark`, `Timeline`, `TermChunk`, `Durations`, `Step`, `Action`, `Scene`, `Script`, `Edl`, `EdlScene`, `ZoomKey`, `CaptionCue` — exactly as written below.
- Produces (in `demo/lib/files.ts`): `readTimeline(path: string): Timeline`, `readDurations(path: string): Durations`, `readTerminal(path: string): TermChunk[]` — throw `Error` whose message starts with the file name.

- [ ] **Step 1: Ignore `demo/` in the app's tools**

`metro.config.js`:

```js
// The demo video tool (demo/) has its own node_modules (Remotion, React for the renderer): Metro must not crawl it.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const demo = /[/\\]demo[/\\].*/;
const block = config.resolver.blockList;
config.resolver.blockList = Array.isArray(block) ? [...block, demo] : block ? [block, demo] : [demo];

module.exports = config;
```

`tsconfig.json`: add after `"include": [...]`:

```json
  "exclude": ["node_modules", "demo"]
```

`eslint.config.js`: `ignores: ["dist/*", "prototypes/*/vendor/*", "demo/*"],`

`package.json`: `"testPathIgnorePatterns": ["/node_modules/", "/e2e/", "/\\.e2e/", "/demo/"]`, and add scripts:

```json
    "demo": "npm --prefix demo run all",
    "demo:build": "bash demo/tools/build.sh",
    "demo:capture": "npm --prefix demo run capture --",
    "demo:voice": "npm --prefix demo run voice",
    "demo:render": "npm --prefix demo run render",
    "demo:check": "npm --prefix demo run check"
```

`.gitignore`: append

```
# demo video tool
demo/node_modules/
demo/out/
demo/.state/
```

- [ ] **Step 2: The demo package**

`demo/package.json`:

```json
{
  "name": "gnoworld-demo",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --experimental-strip-types --no-warnings --test 'lib/*.test.ts' 'capture/*.test.ts' 'voice/*.test.ts' 'check/*.test.ts'",
    "typecheck": "tsc --noEmit",
    "capture": "node --experimental-strip-types --no-warnings capture/run.ts",
    "voice": "node --experimental-strip-types --no-warnings voice/voice.ts",
    "plan": "node --experimental-strip-types --no-warnings video/plan.ts",
    "render": "npm run plan && remotion render video/index.ts Demo out/gnoworld-demo.mp4 --props=out/edl.json",
    "studio": "npm run plan && remotion studio video/index.ts --props=out/edl.json",
    "check": "node --experimental-strip-types --no-warnings check/check.ts",
    "all": "npm run capture && npm run voice && npm run render && npm run check"
  },
  "dependencies": {
    "@remotion/cli": "4.0.535",
    "@remotion/google-fonts": "4.0.535",
    "kokoro-js": "1.2.1",
    "playwright": "1.56.1",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "remotion": "4.0.535"
  },
  "devDependencies": {
    "@types/node": "22.10.2",
    "@types/react": "19.2.2",
    "typescript": "~6.0.3"
  }
}
```

(Before `npm install`, run `npm view playwright version` and `npm view @types/react@19 version`; if the pinned versions above do not exist, pin the newest existing ones instead and say so in the commit message.)

`demo/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "out"]
}
```

`demo/remotion.config.ts`:

```ts
import { Config } from '@remotion/cli/config';

// capture/, voice/ and brand/ files are served from out/ (staticFile('capture/sim.mp4'), …)
Config.setPublicDir('./out');
Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
```

Run: `cd demo && npm install`
Expected: installs without errors; `demo/node_modules` exists and is ignored by git (`git status` does not list it).

- [ ] **Step 3: The shared types**

`demo/lib/types.ts`:

```ts
/** A rectangle in iOS points (the simulator's accessibility frames). */
export interface Box { x: number; y: number; w: number; h: number }

/** One step of the capture: when it happened in sim.mp4 (s) and the element it acted on or waited for. */
export interface Mark { id: string; t: number; box?: Box }

export interface Timeline {
  /** sim.mp4 size in pixels and the screen size in points (pixels = points × scale) */
  video: { width: number; height: number; duration: number };
  screen: { width: number; height: number };
  marks: Mark[];
  /** the gnoweb shot, relative to out/, when one was taken */
  gnoweb?: string;
}

/** A piece of gnokey-pair's terminal output, t in sim.mp4 seconds. */
export interface TermChunk { t: number; text: string }

/** Narration per scene: the wav (relative to out/) and its length in seconds. */
export type Durations = Record<string, { file: string; seconds: number }>;

export type Match = string | RegExp;

export type Action =
  | { tap: Match; enabled?: boolean; timeout?: number }
  | { type: string; into: Match }
  | { clear: Match; count: number }
  | { waitFor: Match; timeout?: number; enabled?: boolean }
  | { swipe: [number, number, number, number] }
  | { launch: 'app' | 'wallet' }
  | { bob: string }
  | { computer: 'sign' }
  | { pause: number }
  | { gnoweb: string };

/** A step; `mark: true` records it in the timeline as `<scene>.<id>`. */
export interface Step { id: string; do: Action; mark?: boolean }

export type Show = 'card' | 'phone' | 'phone+terminal' | 'browser';

export interface Scene {
  id: string;
  show: Show;
  /** the narration, or none */
  voice?: string;
  /** shown one after the other over the scene */
  captions: string[];
  /** for 'card' */
  card?: { title: string; sub?: string; lines?: string[] };
  /** for phone scenes: the steps filmed; the clip runs from the first mark to the last */
  steps?: Step[];
  /** step ids whose box the camera zooms to when they happen */
  zoomOn?: string[];
}

export interface Script { voice: string; setup: Step[]; scenes: Scene[] }

/** Camera state from frame `f` (scene-relative) on: scale ≥ 1, centre in 0..1 of the phone screen. */
export interface ZoomKey { f: number; scale: number; cx: number; cy: number }

export interface CaptionCue { text: string; from: number; duration: number }

export interface EdlScene {
  id: string;
  show: Show;
  /** composition frames */
  from: number;
  duration: number;
  card?: Scene['card'];
  /** for phone scenes: the source clip in sim.mp4 */
  clip?: { start: number; end: number; rate: number; holdFrames: number };
  zoom: ZoomKey[];
  captions: CaptionCue[];
  voice?: { src: string; from: number };
  /** terminal output for this scene, t already mapped to scene frames */
  terminal?: { f: number; text: string }[];
  gnoweb?: string;
}

// a type, not an interface: Remotion's props must be assignable to Record<string, unknown>
export type Edl = {
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  video: Timeline['video'];
  screen: Timeline['screen'];
  scenes: EdlScene[];
};
```

- [ ] **Step 4: Write the failing tests for the file readers**

`demo/lib/files.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readDurations, readTerminal, readTimeline } from './files.ts';

const dir = mkdtempSync(join(tmpdir(), 'demo-files-'));
const put = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

const timeline = {
  video: { width: 1206, height: 2622, duration: 120.5 },
  screen: { width: 402, height: 874 },
  marks: [{ id: 'connect.open', t: 3.2, box: { x: 10, y: 20, w: 100, h: 44 } }, { id: 'connect.back', t: 9 }],
};

test('readTimeline returns a valid timeline', () => {
  assert.deepEqual(readTimeline(put('t.json', JSON.stringify(timeline))), timeline);
});

test('readTimeline names the file when it is missing', () => {
  assert.throws(() => readTimeline(join(dir, 'nope.json')), /nope\.json: missing — run npm run demo:capture/);
});

test('readTimeline names the file and the field when a mark is malformed', () => {
  const bad = { ...timeline, marks: [{ id: 'x', t: 'soon' }] };
  assert.throws(() => readTimeline(put('bad.json', JSON.stringify(bad))), /bad\.json: marks\[0\]\.t is not a number/);
});

test('readTimeline rejects broken JSON with the file name', () => {
  assert.throws(() => readTimeline(put('broken.json', '{')), /broken\.json: not JSON/);
});

test('readDurations returns the narration lengths', () => {
  const d = { intro: { file: 'voice/intro-1a2b3c4d.wav', seconds: 3.4 } };
  assert.deepEqual(readDurations(put('d.json', JSON.stringify(d))), d);
});

test('readDurations rejects a non-positive length', () => {
  assert.throws(() => readDurations(put('d0.json', JSON.stringify({ intro: { file: 'a.wav', seconds: 0 } }))), /d0\.json: intro\.seconds/);
});

test('readTerminal reads JSON lines and skips blank ones', () => {
  const p = put('term.jsonl', '{"t":1.5,"text":"Waiting"}\n\n{"t":2,"text":"Done."}\n');
  assert.deepEqual(readTerminal(p), [{ t: 1.5, text: 'Waiting' }, { t: 2, text: 'Done.' }]);
});

test('readTerminal returns nothing when the file does not exist', () => {
  assert.deepEqual(readTerminal(join(dir, 'none.jsonl')), []);
});
```

- [ ] **Step 5: Run the tests to see them fail**

Run: `cd demo && npm test`
Expected: FAIL — `Cannot find module '…/lib/files.ts'`.

- [ ] **Step 6: Implement the readers**

`demo/lib/files.ts`:

```ts
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
```

- [ ] **Step 7: Run the tests and the checks**

Run: `cd demo && npm test && npx tsc --noEmit`
Expected: 8 tests PASS; tsc prints nothing.

Run (repo root): `npx expo lint && npx tsc --noEmit && npx jest 2>&1 | tail -5`
Expected: lint clean, tsc clean, jest passes with the same count as before this task (no test from `demo/` collected).

- [ ] **Step 8: Commit**

```bash
git add metro.config.js tsconfig.json eslint.config.js package.json package-lock.json .gitignore demo/package.json demo/package-lock.json demo/tsconfig.json demo/remotion.config.ts demo/lib
git commit -m "feat(demo): scaffold the demo video tool, invisible to the app's tools"
```

---

### Task 2: The edit — `lib/fit.ts`

**Files:**
- Create: `demo/lib/fit.ts`, `demo/lib/fit.test.ts`

**Interfaces:**
- Consumes: types from Task 1.
- Produces: `buildEdl(script: Script, timeline: Timeline, durations: Durations, terminal: TermChunk[]): Edl`; constants `FPS = 30`, `WIDTH = 1920`, `HEIGHT = 1080`, `MAX_RATE = 4`; helper `zoomFor(box: Box, screen: {width: number; height: number}): {scale: number; cx: number; cy: number}`.

Rules (from the spec §6):
- A card scene lasts `max(voice + 1 s, 4 s)`.
- A phone scene's clip runs from its first mark − 0.3 s to its last mark + 0.8 s (clamped to the video). Its target length is `max(voice + 0.6 s, 3 s)`. If the clip is longer, it plays faster, at most ×4; if still longer, the scene lengthens to `clip / 4`. If the clip is shorter, it plays at ×1 and its last frame is held for the rest.
- Voice starts 6 frames into its scene.
- Captions share the scene equally, in order.
- Zoom: one key per `zoomOn` step that has a box, at the frame where the step happens; scale = `clamp(min(0.55·W/w, 0.35·H/h), 1, 2.2)` with `W, H` the screen in points; the centre is clamped so the zoomed view stays inside the screen. A first key at frame 0 has scale 1, centre 0.5.
- A 'browser' scene lasts `max(voice + 1 s, 4 s)` and carries `timeline.gnoweb`.
- 'phone+terminal' scenes carry the terminal chunks whose `t` falls inside the clip, mapped to scene frames.
- A scene that names a mark missing from the timeline throws `scene <id>: no mark <scene>.<step> in timeline.json — capture again`.

- [ ] **Step 1: Write the failing tests**

`demo/lib/fit.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildEdl, FPS, MAX_RATE, zoomFor } from './fit.ts';
import type { Script, Timeline } from './types.ts';

const screen = { width: 402, height: 874 };
const timeline = (marks: Timeline['marks']): Timeline => ({ video: { width: 1206, height: 2622, duration: 300 }, screen, marks });
const phone = (id: string, steps: string[], extra: Partial<Script['scenes'][number]> = {}): Script['scenes'][number] => ({
  id, show: 'phone', captions: ['one', 'two'], voice: 'words', steps: steps.map((s) => ({ id: s, do: { pause: 0 }, mark: true })), ...extra,
});
const script = (scenes: Script['scenes']): Script => ({ voice: 'af_heart', setup: [], scenes });

test('a card lasts its voice plus a second, at least four seconds', () => {
  const s = script([{ id: 'title', show: 'card', captions: [], voice: 'hi', card: { title: 'gno.world' } }]);
  const e = buildEdl(s, timeline([]), { title: { file: 'voice/title.wav', seconds: 5 } }, []);
  assert.equal(e.scenes[0].duration, 6 * FPS);
  const short = buildEdl(s, timeline([]), { title: { file: 'voice/title.wav', seconds: 1 } }, []);
  assert.equal(short.scenes[0].duration, 4 * FPS);
});

test('a long clip plays faster to fit the voice', () => {
  const s = script([phone('connect', ['a', 'b'])]);
  // clip: 10 - 0.3 .. 30 + 0.8 = 20.9 s; target: 6 + 0.6 = 6.6 s → rate ≈ 3.17
  const e = buildEdl(s, timeline([{ id: 'connect.a', t: 10 }, { id: 'connect.b', t: 30 }]), { connect: { file: 'v.wav', seconds: 6 } }, []);
  const c = e.scenes[0].clip!;
  assert.equal(c.start, 9.7);
  assert.equal(c.end, 30.8);
  assert.ok(Math.abs(c.rate - 21.1 / 6.6) < 1e-9);
  assert.equal(c.holdFrames, 0);
  assert.equal(e.scenes[0].duration, Math.round(6.6 * FPS));
});

test('a clip too long even at the top speed lengthens the scene', () => {
  const s = script([phone('play', ['a', 'b'])]);
  const e = buildEdl(s, timeline([{ id: 'play.a', t: 0.3 }, { id: 'play.b', t: 80 }]), { play: { file: 'v.wav', seconds: 3 } }, []);
  assert.equal(e.scenes[0].clip!.rate, MAX_RATE);
  assert.equal(e.scenes[0].duration, Math.round((80.8 / MAX_RATE) * FPS));
});

test('a short clip plays at normal speed and holds its last frame', () => {
  const s = script([phone('chat', ['a'])]);
  const e = buildEdl(s, timeline([{ id: 'chat.a', t: 5 }]), { chat: { file: 'v.wav', seconds: 8 } }, []);
  const c = e.scenes[0].clip!;
  assert.equal(c.rate, 1);
  assert.equal(e.scenes[0].duration, Math.round(8.6 * FPS));
  assert.equal(c.holdFrames, e.scenes[0].duration - Math.round((c.end - c.start) * FPS));
});

test('scenes follow each other and the voice starts six frames in', () => {
  const s = script([
    { id: 'title', show: 'card', captions: [], voice: 'hi', card: { title: 'x' } },
    phone('chat', ['a']),
  ]);
  const e = buildEdl(s, timeline([{ id: 'chat.a', t: 5 }]), { title: { file: 't.wav', seconds: 3 }, chat: { file: 'c.wav', seconds: 3 } }, []);
  assert.equal(e.scenes[1].from, e.scenes[0].duration);
  assert.deepEqual(e.scenes[1].voice, { src: 'c.wav', from: 6 });
  assert.equal(e.durationInFrames, e.scenes[0].duration + e.scenes[1].duration);
});

test('captions share the scene in order', () => {
  const s = script([phone('chat', ['a'])]);
  const e = buildEdl(s, timeline([{ id: 'chat.a', t: 5 }]), { chat: { file: 'c.wav', seconds: 5.4 } }, []);
  const [a, b] = e.scenes[0].captions;
  assert.equal(a.text, 'one');
  assert.equal(a.from, 0);
  assert.equal(b.from, a.duration);
  assert.equal(a.duration + b.duration, e.scenes[0].duration);
});

test('a missing mark names the scene and the mark', () => {
  const s = script([phone('connect', ['a', 'b'])]);
  assert.throws(() => buildEdl(s, timeline([{ id: 'connect.a', t: 1 }]), { connect: { file: 'v.wav', seconds: 3 } }, []),
    /scene connect: no mark connect\.b in timeline\.json — capture again/);
});

test('zoom fits a small button, never below 1 or above 2.2, and stays inside the screen', () => {
  const corner = zoomFor({ x: 0, y: 0, w: 40, h: 30 }, screen);
  assert.equal(corner.scale, 2.2);
  // the view is 1/2.2 of the screen wide: its centre cannot be nearer the edge than half of that
  assert.ok(Math.abs(corner.cx - 0.5 / 2.2) < 1e-9);
  assert.ok(Math.abs(corner.cy - 0.5 / 2.2) < 1e-9);
  const wide = zoomFor({ x: 0, y: 300, w: 402, h: 400 }, screen);
  assert.equal(wide.scale, 1);
  assert.equal(wide.cx, 0.5);
});

test('zoom keys land on the frame where their step happens', () => {
  const s = script([phone('connect', ['a', 'b'], { zoomOn: ['b'] })]);
  const e = buildEdl(s, timeline([{ id: 'connect.a', t: 10 }, { id: 'connect.b', t: 12, box: { x: 100, y: 700, w: 200, h: 50 } }]),
    { connect: { file: 'v.wav', seconds: 10 } }, []);
  const [first, second] = e.scenes[0].zoom;
  assert.deepEqual(first, { f: 0, scale: 1, cx: 0.5, cy: 0.5 });
  // clip starts at 9.7 and plays at 1×: 12 s is (12 - 9.7) s into the scene
  assert.equal(second.f, Math.round(2.3 * FPS));
  assert.ok(second.scale > 1);
});

test('terminal output inside the clip is mapped to scene frames', () => {
  const s = script([phone('connect', ['a', 'b'], { show: 'phone+terminal' })]);
  const e = buildEdl(s, timeline([{ id: 'connect.a', t: 10 }, { id: 'connect.b', t: 14 }]), { connect: { file: 'v.wav', seconds: 10 } },
    [{ t: 5, text: 'before' }, { t: 11, text: 'Sign? [y/N] ' }, { t: 40, text: 'after' }]);
  assert.deepEqual(e.scenes[0].terminal, [{ f: Math.round(1.3 * FPS), text: 'Sign? [y/N] ' }]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd demo && npm test`
Expected: FAIL — cannot find `./fit.ts`.

- [ ] **Step 3: Implement**

`demo/lib/fit.ts`:

```ts
import type { Box, CaptionCue, Durations, Edl, EdlScene, Script, TermChunk, Timeline, ZoomKey } from './types.ts';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const MAX_RATE = 4;
const PRE = 0.3;
const POST = 0.8;
const VOICE_DELAY = 6; // frames

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The camera that frames `box` on a screen of `screen` points. */
export function zoomFor(box: Box, screen: { width: number; height: number }) {
  const scale = clamp(Math.min((0.55 * screen.width) / box.w, (0.35 * screen.height) / box.h), 1, 2.2);
  const half = 0.5 / scale;
  return {
    scale,
    cx: clamp((box.x + box.w / 2) / screen.width, half, 1 - half),
    cy: clamp((box.y + box.h / 2) / screen.height, half, 1 - half),
  };
}

const captionsOver = (texts: string[], duration: number): CaptionCue[] => {
  const each = Math.floor(duration / Math.max(texts.length, 1));
  return texts.map((text, i) => ({ text, from: i * each, duration: i === texts.length - 1 ? duration - i * each : each }));
};

export function buildEdl(script: Script, timeline: Timeline, durations: Durations, terminal: TermChunk[]): Edl {
  const marks = new Map(timeline.marks.map((m) => [m.id, m]));
  const scenes: EdlScene[] = [];
  let from = 0;
  for (const s of script.scenes) {
    const voice = s.voice ? durations[s.id] : undefined;
    if (s.voice && !voice) throw new Error(`scene ${s.id}: no narration in durations.json — run npm run demo:voice`);
    const voiceS = voice?.seconds ?? 0;
    let duration: number;
    let clip: EdlScene['clip'];
    let zoom: ZoomKey[] = [{ f: 0, scale: 1, cx: 0.5, cy: 0.5 }];
    let term: EdlScene['terminal'];
    if (s.show === 'phone' || s.show === 'phone+terminal') {
      const ids = (s.steps ?? []).filter((st) => st.mark).map((st) => `${s.id}.${st.id}`);
      const own = ids.map((id) => {
        const m = marks.get(id);
        if (!m) throw new Error(`scene ${s.id}: no mark ${id} in timeline.json — capture again`);
        return m;
      });
      if (!own.length) throw new Error(`scene ${s.id}: a phone scene needs at least one marked step`);
      const start = Math.max(0, Math.round((own[0].t - PRE) * 1000) / 1000);
      const end = Math.min(timeline.video.duration, Math.round((own[own.length - 1].t + POST) * 1000) / 1000);
      const raw = end - start;
      const target = Math.max(voiceS + 0.6, 3);
      const rate = raw > target ? Math.min(raw / target, MAX_RATE) : 1;
      const played = raw / rate;
      const total = Math.max(target, played);
      duration = Math.round(total * FPS);
      clip = { start, end, rate, holdFrames: Math.max(0, duration - Math.round(played * FPS)) };
      const toFrame = (t: number) => Math.round(((t - start) / rate) * FPS);
      for (const z of s.zoomOn ?? []) {
        const m = marks.get(`${s.id}.${z}`);
        if (m?.box) zoom.push({ f: toFrame(m.t), ...zoomFor(m.box, timeline.screen) });
      }
      zoom = zoom.sort((a, b) => a.f - b.f);
      if (s.show === 'phone+terminal') {
        term = terminal.filter((c) => c.t >= start && c.t <= end).map((c) => ({ f: toFrame(c.t), text: c.text }));
      }
    } else {
      duration = Math.round(Math.max(voiceS + 1, 4) * FPS);
    }
    scenes.push({
      id: s.id, show: s.show, from, duration, card: s.card, clip, zoom,
      captions: captionsOver(s.captions, duration),
      voice: voice ? { src: voice.file, from: VOICE_DELAY } : undefined,
      terminal: term,
      gnoweb: s.show === 'browser' ? timeline.gnoweb : undefined,
    });
    from += duration;
  }
  return { fps: FPS, width: WIDTH, height: HEIGHT, durationInFrames: from, video: timeline.video, screen: timeline.screen, scenes };
}
```

- [ ] **Step 4: Run the tests**

Run: `cd demo && npm test && npx tsc --noEmit`
Expected: all tests PASS (8 from Task 1 + 10 here); tsc silent.

- [ ] **Step 5: Commit**

```bash
git add demo/lib/fit.ts demo/lib/fit.test.ts
git commit -m "feat(demo): the edit — cuts, speed, hold, zoom and captions from the timeline"
```

---

### Task 3: The toolchain — `npm run demo:build` and gnoweb in gnodev

**Files:**
- Create: `demo/tools/build.sh`
- Modify: `scripts/gnodev.sh`

**Interfaces:**
- Produces: binaries in `demo/.state/bin/`: `gnokey` (with `sign-data`), `gnokey-pair`; the relay command `~/gno-gnokey-pair/contribs/gnokey-pair/.venv/bin/twist`; app bundle `demo/.state/build/Build/Products/Release-iphonesimulator/gnoworld.app`; wallet bundle `~/gnokey-mobile/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/GnokeyMobile.app`.
- Produces: `GNODEV_WEB=1 bash scripts/gnodev.sh` runs gnodev with gnoweb on `127.0.0.1:8888`.

- [ ] **Step 1: gnoweb on demand in `scripts/gnodev.sh`**

Replace the final `exec` block with:

```bash
# -C: run from devchain so no other workspace is picked up; -no-examples: everything comes from devchain/
# GNODEV_WEB=1 keeps gnoweb (127.0.0.1:8888), for the demo video's realm shot.
WEB=(-no-web)
[ "${GNODEV_WEB:-}" = 1 ] && WEB=()
mkdir -p "$E/gnohome"
exec "$BIN" local -C "$ROOT/devchain" -home "$E/gnohome" "${WEB[@]}" -no-watch -empty-blocks \
  -no-examples -extra-root "$ROOT/devchain" "$@"
```

Run: `GNOROOT=$PWD/.e2e/gnoroot-5cdbc25fcde0 GNODEV_WEB=1 bash scripts/gnodev.sh -node-rpc-listener 127.0.0.1:46658 -web-listener 127.0.0.1:48888 > /tmp/gd.log 2>&1 & sleep 25; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:48888/; kill %1`
Expected: `200`. (If gnodev rejects `-web-listener`, run `.e2e/bin/gnodev-5cdbc25fcde0 local -h 2>&1 | grep -i web` and use the flag it lists; write the flag name it uses into the comment above.)

- [ ] **Step 2: The build script**

`demo/tools/build.sh`:

```bash
#!/usr/bin/env bash
# npm run demo:build — everything the capture needs, built once (re-run after the app or the wallet changes):
# gnokey with sign-data and gnokey-pair (from ~/gno-gnokey-pair, feat/gnokey-pair, rebased on feat/gnokey-sign-data),
# the relay's venv, the app's Release build for the simulator, gnokey-mobile's simulator build.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
S=$ROOT/demo/.state
PAIR=${GNO_PAIR:-$HOME/gno-gnokey-pair}
WALLET=${GNOKEY_MOBILE:-$HOME/gnokey-mobile}
mkdir -p "$S/bin"

echo "• gnokey (sign-data) and gnokey-pair from $PAIR ($(git -C "$PAIR" branch --show-current))"
(cd "$PAIR" && go build -o "$S/bin/gnokey" ./gno.land/cmd/gnokey)
(cd "$PAIR/contribs/gnokey-pair" && go build -o "$S/bin/gnokey-pair" .)
"$S/bin/gnokey" sign-data -h 2>&1 | grep -q 'sign-data \[flags\]' || { echo "this gnokey has no sign-data" >&2; exit 1; }

echo "• relay venv"
[ -x "$PAIR/contribs/gnokey-pair/.venv/bin/twist" ] || make -C "$PAIR/contribs/gnokey-pair" test-deps

echo "• gno.world Release build for the simulator"
(cd "$ROOT" && npx expo prebuild --platform ios --no-install >/dev/null && cd ios && pod install >/dev/null)
xcodebuild -workspace "$ROOT/ios/gnoworld.xcworkspace" -scheme gnoworld -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$S/build" build -quiet

echo "• gnokey-mobile simulator build"
(cd "$WALLET/ios" && xcodebuild -project GnokeyMobile.xcodeproj -scheme GnokeyMobile -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build/DerivedData build -quiet)

ls -d "$S/build/Build/Products/Release-iphonesimulator/gnoworld.app" \
  "$WALLET/ios/build/DerivedData/Build/Products/Debug-iphonesimulator/GnokeyMobile.app"
echo "done"
```

(If `ios/` already exists and is current, `expo prebuild` is a no-op. If gnokey-mobile's xcodeproj is generated by XcodeGen (`ios/project.yml`), run `cd ~/gnokey-mobile && make run.ios device=<any booted udid>` once instead, as the memory says, and keep only its build products: replace the gnokey-mobile block with that command in the script and say so in the commit.)

- [ ] **Step 3: Run it**

Run: `chmod +x demo/tools/build.sh && npm run demo:build`
Expected: ends with the two `.app` paths and `done`; `demo/.state/bin/gnokey-pair -h` prints its flags (`-remote`, `-relay`, `-gnokey`, `-home`, `-timeout`, `-linger`, `-manual`).

- [ ] **Step 4: Commit**

```bash
git add scripts/gnodev.sh demo/tools/build.sh
git commit -m "feat(demo): npm run demo:build, and gnoweb on demand in gnodev.sh"
```

---

### Task 4: Driving the simulator — `capture/ax.ts` and `capture/sim.ts`

**Files:**
- Create: `demo/capture/ax.ts`, `demo/capture/ax.test.ts`, `demo/capture/sim.ts`, `demo/capture/fixtures/springboard.json`

**Interfaces:**
- Produces (`ax.ts`): `interface AxElement { label: string; value: string; type: string; enabled: boolean; box: Box }`; `parseDescribeAll(json: string): AxElement[]`; `find(els: AxElement[], m: Match, o?: { enabled?: boolean }): AxElement | undefined` (a string matches the label exactly, then the value exactly; a RegExp is tested on the label, then the value); `centre(b: Box): [number, number]`.
- Produces (`sim.ts`): `class Sim` with `static ensureDevice(name: string): Promise<string>` (udid), `constructor(udid: string)`, `prepare(apps: string[]): Promise<void>` (erase, boot, status bar, install), `connect(): Promise<void>` / `disconnect()` (idb companion), `describe(): Promise<AxElement[]>`, `tap(m: Match, o?: {enabled?: boolean; timeout?: number}): Promise<AxElement>`, `type(text: string): Promise<void>`, `backspace(n: number): Promise<void>`, `swipe(x1, y1, x2, y2): Promise<void>`, `waitFor(m: Match, o?: {timeout?: number; enabled?: boolean}): Promise<AxElement>`, `launch(bundle: string): Promise<void>`, `screenshot(file: string): Promise<void>`, `startRecording(file: string): Promise<number>` (resolves with the wall-clock ms of the first frame), `stopRecording(): Promise<void>`, `screenSize(): Promise<{width: number; height: number}>`; `class StepFailed extends Error` (carries `step` and `dump` paths).

- [ ] **Step 1: Capture a real accessibility tree as the fixture**

```bash
U=$(xcrun simctl list devices available -j | node -e "const d=JSON.parse(require('fs').readFileSync(0)).devices;for(const k in d)for(const x of d[k])if(x.name==='iPhone 17 Pro'&&k.includes('26-5'))console.log(x.udid)" | head -1)
xcrun simctl boot $U 2>/dev/null; xcrun simctl bootstatus $U -b
idb_companion --udid $U --grpc-port 10882 > /tmp/idbc.log 2>&1 & sleep 3; idb connect localhost 10882
idb ui describe-all --udid $U > demo/capture/fixtures/springboard.json
idb disconnect localhost 10882; kill %1
head -c 600 demo/capture/fixtures/springboard.json
```

Expected: a JSON array whose elements carry `AXLabel`, `AXValue`, `type`, `enabled` and `frame` (`x`, `y`, `width`, `height`). If the keys differ, use the real keys in `parseDescribeAll` below and in the test.

- [ ] **Step 2: Write the failing tests**

`demo/capture/ax.test.ts`:

```ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { centre, find, parseDescribeAll } from './ax.ts';

const raw = JSON.stringify([
  { AXLabel: 'Session', AXValue: null, type: 'Button', enabled: true, frame: { x: 200, y: 800, width: 80, height: 49 } },
  { AXLabel: null, AXValue: 'http://127.0.0.1:8787', type: 'TextField', enabled: true, frame: { x: 16, y: 300, width: 370, height: 44 } },
  { AXLabel: 'boop 0.10 GNOT', AXValue: null, type: 'Button', enabled: false, frame: { x: 16, y: 600, width: 370, height: 50 } },
  { AXLabel: 'boop 0.10 GNOT', AXValue: null, type: 'Button', enabled: true, frame: { x: 16, y: 700, width: 370, height: 50 } },
]);

test('parses labels, values, types, state and boxes', () => {
  const [s, f] = parseDescribeAll(raw);
  assert.deepEqual(s, { label: 'Session', value: '', type: 'Button', enabled: true, box: { x: 200, y: 800, w: 80, h: 49 } });
  assert.equal(f.label, '');
  assert.equal(f.value, 'http://127.0.0.1:8787');
});

test('a string matches a label exactly, then a value', () => {
  const els = parseDescribeAll(raw);
  assert.equal(find(els, 'Session')?.type, 'Button');
  assert.equal(find(els, 'Sess'), undefined);
  assert.equal(find(els, 'http://127.0.0.1:8787')?.type, 'TextField');
});

test('a RegExp matches a label or a value; enabled picks the live one', () => {
  const els = parseDescribeAll(raw);
  assert.equal(find(els, /^boop /)?.enabled, false);
  assert.equal(find(els, /^boop /, { enabled: true })?.box.y, 700);
  assert.equal(find(els, /8787/)?.type, 'TextField');
});

test('centre is the middle of the box', () => {
  assert.deepEqual(centre({ x: 10, y: 20, w: 100, h: 40 }), [60, 40]);
});

test('the real springboard tree parses', () => {
  const els = parseDescribeAll(readFileSync(new URL('./fixtures/springboard.json', import.meta.url), 'utf8'));
  assert.ok(els.length > 0);
  assert.ok(els.every((e) => Number.isFinite(e.box.w)));
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `cd demo && npm test`
Expected: FAIL — cannot find `./ax.ts`.

- [ ] **Step 4: Implement `ax.ts`**

```ts
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
```

- [ ] **Step 5: Implement `sim.ts`**

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { Match } from '../lib/types.ts';
import { centre, find, parseDescribeAll, type AxElement } from './ax.ts';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEY_GAP = 300; // ms between key events (memory: faster makes iOS SIGQUIT the app)
const RUNTIME = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5';
const DEVICE_TYPE = 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro';

export class StepFailed extends Error {
  readonly dump: string;
  constructor(message: string, dump: string) {
    super(message);
    this.dump = dump;
  }
}

export class Sim {
  private companion: ChildProcess | null = null;
  private recorder: ChildProcess | null = null;
  private port = 10882;
  readonly udid: string;
  private failDir: string;
  constructor(udid: string, failDir = 'out/capture/fail') {
    this.udid = udid;
    this.failDir = failDir;
  }

  /** The udid of the device `name`, created on the iPhone 17 Pro / iOS 26.5 runtime when absent. */
  static async ensureDevice(name: string): Promise<string> {
    const { stdout } = await run('xcrun', ['simctl', 'list', 'devices', '-j']);
    const devices = JSON.parse(stdout).devices as Record<string, { name: string; udid: string }[]>;
    const have = devices[RUNTIME]?.find((d) => d.name === name);
    if (have) return have.udid;
    const made = await run('xcrun', ['simctl', 'create', name, DEVICE_TYPE, RUNTIME]);
    return made.stdout.trim();
  }

  private simctl = (...args: string[]) => run('xcrun', ['simctl', ...args]);
  private idb = (...args: string[]) => run('idb', [...args, '--udid', this.udid]);

  /** Erases the device, boots it, freezes the status bar at 9:41 and installs `apps`. */
  async prepare(apps: string[]) {
    await this.simctl('shutdown', this.udid).catch(() => undefined);
    await this.simctl('erase', this.udid);
    await this.simctl('boot', this.udid);
    await this.simctl('bootstatus', this.udid, '-b');
    await this.simctl('status_bar', this.udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active',
      '--wifiBars', '3', '--cellularMode', 'active', '--cellularBars', '4', '--batteryState', 'charged', '--batteryLevel', '100');
    for (const app of apps) await this.simctl('install', this.udid, app);
  }

  async connect() {
    this.companion = spawn('idb_companion', ['--udid', this.udid, '--grpc-port', String(this.port)], { stdio: 'ignore' });
    await sleep(3000);
    await run('idb', ['connect', 'localhost', String(this.port)]);
  }

  async disconnect() {
    await run('idb', ['disconnect', 'localhost', String(this.port)]).catch(() => undefined);
    this.companion?.kill();
    this.companion = null;
  }

  async describe(): Promise<AxElement[]> {
    const { stdout } = await this.idb('ui', 'describe-all');
    return parseDescribeAll(stdout);
  }

  async waitFor(m: Match, o: { timeout?: number; enabled?: boolean } = {}): Promise<AxElement> {
    const until = Date.now() + (o.timeout ?? 20_000);
    let last: AxElement[] = [];
    while (Date.now() < until) {
      last = await this.describe().catch(() => last);
      const e = find(last, m, { enabled: o.enabled });
      if (e) return e;
      await sleep(400);
    }
    throw new StepFailed(`no element matching ${String(m)} within ${o.timeout ?? 20_000} ms`, await this.dump(String(m), last));
  }

  async tap(m: Match, o: { timeout?: number; enabled?: boolean } = {}): Promise<AxElement> {
    const e = await this.waitFor(m, { enabled: true, ...o });
    const [x, y] = centre(e.box);
    await this.idb('ui', 'tap', String(Math.round(x)), String(Math.round(y)));
    await sleep(KEY_GAP);
    return e;
  }

  async type(text: string) {
    await this.idb('ui', 'text', text);
    await sleep(KEY_GAP);
  }

  async backspace(n: number) {
    for (let i = 0; i < n; i++) {
      await this.idb('ui', 'key', '42');
      await sleep(KEY_GAP);
    }
  }

  async swipe(x1: number, y1: number, x2: number, y2: number) {
    await this.idb('ui', 'swipe', String(x1), String(y1), String(x2), String(y2), '--duration', '0.4');
    await sleep(KEY_GAP);
  }

  async launch(bundle: string) {
    await this.simctl('launch', this.udid, bundle);
    await sleep(1500);
  }

  async screenshot(file: string) {
    await this.idb('screenshot', file);
  }

  async screenSize() {
    const els = await this.describe();
    const app = els.find((e) => e.type === 'Application') ?? els[0];
    return { width: app.box.w, height: app.box.h };
  }

  /** Starts recording; resolves with Date.now() at the first frame ("Recording started" on stderr). */
  startRecording(file: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const p = spawn('xcrun', ['simctl', 'io', this.udid, 'recordVideo', '--codec=h264', '--force', file]);
      this.recorder = p;
      let said = '';
      p.stderr.on('data', (d: Buffer) => {
        said += d.toString();
        if (said.includes('Recording started')) resolve(Date.now());
      });
      p.on('exit', (code) => reject(new Error(`recordVideo stopped (${code}): ${said.trim()}`)));
    });
  }

  async stopRecording() {
    const p = this.recorder;
    if (!p) return;
    this.recorder = null;
    await new Promise<void>((resolve) => {
      p.removeAllListeners('exit');
      p.on('exit', () => resolve());
      p.kill('SIGINT'); // recordVideo finishes the file on SIGINT
    });
  }

  private async dump(what: string, els: AxElement[]): Promise<string> {
    mkdirSync(this.failDir, { recursive: true });
    const base = join(this.failDir, `${Date.now()}`);
    writeFileSync(`${base}.json`, JSON.stringify({ waitingFor: what, elements: els }, null, 2));
    await this.screenshot(`${base}.png`).catch(() => undefined);
    return base;
  }
}
```

- [ ] **Step 6: Run the tests and try the driver once**

Run: `cd demo && npm test && npx tsc --noEmit`
Expected: PASS (ax tests included); tsc silent.

Run a smoke check of `Sim` against the booted device of Step 1 (not the demo device yet):

```bash
cd demo && node --experimental-strip-types --no-warnings -e "
import('./capture/sim.ts').then(async ({ Sim }) => {
  const s = new Sim(process.argv[1]); await s.connect();
  console.log(await s.screenSize()); await s.disconnect();
})" $U
```

Expected: `{ width: 402, height: 874 }` (iPhone 17 Pro in points).

- [ ] **Step 7: Commit**

```bash
git add demo/capture/ax.ts demo/capture/ax.test.ts demo/capture/sim.ts demo/capture/fixtures/springboard.json
git commit -m "feat(demo): drive the simulator — accessibility matching, idb and simctl"
```

---

### Task 5: The stage — chain, gnoweb, chat server, relay, keys, Bob's pool

**Files:**
- Create: `demo/capture/stage.ts`, `demo/capture/stage.test.ts`

**Interfaces:**
- Consumes: Task 3 binaries.
- Produces: `PORTS = { rpc: 26657, web: 8888, chat: 8787, relay: 4000 }`; `ALICE = { name: 'alice', mnemonic: <test1 seed>, address: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5' }`; `BOB = { name: 'bob', mnemonic: string }`; `REALM = 'gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6'`; `POOL_NAME = 'Friday pot'`; `busyPorts(ports: number[]): Promise<number[]>`; `class Stage { up(): Promise<void>; down(): Promise<void>; gnokey(args: string[], key: string): Promise<string>; bobSays(body: string): Promise<void>; readonly home: string; readonly bin: string }`.

- [ ] **Step 1: Write the failing test (ports)**

`demo/capture/stage.test.ts`:

```ts
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';

import { busyPorts } from './stage.ts';

test('busyPorts names the ports something already listens on', async () => {
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = (srv.address() as { port: number }).port;
  assert.deepEqual(await busyPorts([port, 1]), [port]);
  srv.close();
});
```

Run: `cd demo && npm test` — Expected: FAIL (no `stage.ts`).

- [ ] **Step 2: Implement `stage.ts`**

```ts
import { spawn, type ChildProcess } from 'node:child_process';
import { execFile } from 'node:child_process';
import { mkdirSync, openSync, rmSync } from 'node:fs';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const ROOT = resolve(import.meta.dirname, '..', '..');
export const STATE = join(ROOT, 'demo', '.state');
export const PORTS = { rpc: 26657, web: 8888, chat: 8787, relay: 4000 } as const;
export const CHAIN_ID = 'dev';
export const REALM = 'gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6';
export const POOL_NAME = 'Friday pot';
// gnodev funds test1 at genesis: Alice is test1
export const ALICE = {
  name: 'alice',
  address: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5',
  mnemonic: 'source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast',
};
export const BOB = {
  name: 'bob',
  mnemonic: 'useful guitar throw awful brisk prize horse arm trap pause sword sugar rely tunnel enjoy shrug tooth cliff rabbit ticket cruel lonely fame resemble',
};
const RELAY_BIN = join(homedir(), 'gno-gnokey-pair/contribs/gnokey-pair/.venv/bin/twist');
const GNOROOT = join(ROOT, '.e2e/gnoroot-5cdbc25fcde0');

export async function busyPorts(ports: number[]): Promise<number[]> {
  const taken = await Promise.all(ports.map((p) => new Promise<boolean>((res) => {
    const c = createConnection({ port: p, host: '127.0.0.1' });
    c.once('connect', () => { c.destroy(); res(true); });
    c.once('error', () => res(false));
  })));
  return ports.filter((_, i) => taken[i]);
}

const until = async (what: string, ok: () => Promise<boolean>, ms = 120_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok().catch(() => false)) return;
    await sleep(1000);
  }
  throw new Error(`${what} did not come up within ${ms / 1000} s (logs in demo/.state/logs/)`);
};
const httpOk = (url: string) => async () => (await fetch(url)).status < 500;

export class Stage {
  readonly home = join(STATE, 'gnohome');
  readonly bin = join(STATE, 'bin');
  private procs: ChildProcess[] = [];

  private start(name: string, cmd: string, args: string[], env: Record<string, string> = {}) {
    mkdirSync(join(STATE, 'logs'), { recursive: true });
    const log = openSync(join(STATE, 'logs', `${name}.log`), 'w');
    const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', log, log], detached: true });
    this.procs.push(p);
  }

  /** gnokey list: no key, no password */
  async list(): Promise<string> {
    const { stdout } = await run(join(this.bin, 'gnokey'), ['list', '-home', this.home]);
    return stdout;
  }

  async gnokey(args: string[], key: string): Promise<string> {
    const p = spawn(join(this.bin, 'gnokey'), [...args, '-home', this.home, '-insecure-password-stdin', key]);
    p.stdin.end('\n');
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const code = await new Promise<number | null>((r) => p.on('exit', r));
    if (code !== 0) throw new Error(`gnokey ${args.slice(0, 3).join(' ')} failed:\n${out}`);
    return out;
  }

  private tx = (args: string[], key: string) =>
    this.gnokey(['maketx', ...args, '-gas-fee', '1000000ugnot', '-gas-wanted', '50000000', '-broadcast', '-chainid', CHAIN_ID,
      '-remote', `127.0.0.1:${PORTS.rpc}`], key);

  async up() {
    const busy = await busyPorts(Object.values(PORTS));
    if (busy.length) throw new Error(`port${busy.length > 1 ? 's' : ''} ${busy.join(', ')} already in use — stop what listens there (a previous run, npm run gnodev, npm run fake-offchain) and try again`);
    rmSync(this.home, { recursive: true, force: true });
    mkdirSync(this.home, { recursive: true });
    for (const k of [ALICE, BOB]) {
      const p = spawn(join(this.bin, 'gnokey'), ['add', k.name, '-recover', '-insecure-password-stdin', '-home', this.home]);
      p.stdin.end(`${k.mnemonic}\n\n\n`);
      await new Promise((r) => p.on('exit', r));
    }
    this.start('gnodev', 'bash', ['scripts/gnodev.sh'], { GNODEV_WEB: '1', GNOROOT });
    this.start('chat', 'node', ['--experimental-strip-types', '--no-warnings', 'scripts/fake-offchain/main.mjs'], { PORT: String(PORTS.chat) });
    this.start('relay', RELAY_BIN, ['wormhole-mailbox', '--port', `tcp:${PORTS.relay}`, '--channel-db', join(STATE, 'relay.sqlite')]);
    await until('gnodev', httpOk(`http://127.0.0.1:${PORTS.rpc}/status`));
    await until('gnoweb', httpOk(`http://127.0.0.1:${PORTS.web}/`));
    await until('the chat server', httpOk(`http://127.0.0.1:${PORTS.chat}/api/chat?since=0&wait=0&limit=1`));
    await until('the relay', async () => (await busyPorts([PORTS.relay])).length === 1);
    const bob = (await this.list()).match(/bob \(local\) - addr: (g1\w+)/)?.[1];
    if (!bob) throw new Error('bob is not in the demo keybase');
    await this.tx(['send', '-send', '1000000000ugnot', '-to', bob], ALICE.name);
    await this.tx(['call', '-pkgpath', REALM, '-func', 'CreatePool', '-args', POOL_NAME, '-args', '3600', '-args', '100000',
      '-send', '50000000ugnot'], BOB.name);
  }

  async bobSays(body: string) {
    const r = await fetch(`http://127.0.0.1:${PORTS.chat}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: BOB.name, body }),
    });
    if (!r.ok) throw new Error(`Bob could not post (${r.status}): ${await r.text()}`);
  }

  async down() {
    for (const p of this.procs) {
      try { process.kill(-p.pid!, 'SIGTERM'); } catch { /* already gone */ }
    }
    this.procs = [];
  }
}

// npm run demo:stage — bring the stage up for a manual look, Ctrl-C to stop
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = new Stage();
  process.on('SIGINT', () => void s.down().then(() => process.exit(0)));
  await s.up().catch(async (e) => { console.error(String(e.message ?? e)); await s.down(); process.exit(1); });
  console.log(`stage up: rpc :${PORTS.rpc}, gnoweb :${PORTS.web}, chat :${PORTS.chat}, relay :${PORTS.relay} — Ctrl-C to stop`);
}
```

Add to `demo/package.json` scripts: `"stage": "node --experimental-strip-types --no-warnings capture/stage.ts"`, and to the root `package.json`: `"demo:stage": "npm --prefix demo run stage"`.

- [ ] **Step 3: Run the test, then the stage**

Run: `cd demo && npm test`
Expected: PASS.

Run: `npm run demo:stage` (in one terminal), then in another:

```bash
curl -s http://127.0.0.1:26657/status | head -c 200; echo
curl -s -o /dev/null -w 'gnoweb %{http_code}\n' http://127.0.0.1:8888/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6
curl -s 'http://127.0.0.1:8787/api/chat?since=0&wait=0&limit=5' | head -c 200; echo
```

Expected: a status JSON; `gnoweb 200` and the realm page lists "Friday pot" (open it in a browser or `curl … | grep -c 'Friday pot'` ≥ 1); the chat answers JSON. Ctrl-C the stage; then `npm run demo:stage` again must start cleanly (nothing left behind). Starting it twice at once must fail on the second with `ports 26657, 8888, 8787, 4000 already in use — …`.

- [ ] **Step 4: Commit**

```bash
git add demo/capture/stage.ts demo/capture/stage.test.ts demo/package.json package.json
git commit -m "feat(demo): the stage — gnodev with gnoweb, chat server, relay, Alice, Bob and his pool"
```

---

### Task 6: The computer — gnokey-pair in a pty

**Files:**
- Create: `demo/capture/pty-run.py`, `demo/capture/terminal.ts`, `demo/capture/terminal.test.ts`, `demo/capture/fixtures/fake-pair.sh`

**Interfaces:**
- Produces: `class Computer` — `constructor(o: { bin: string; args: string[]; clock: () => number; log: string; env?: Record<string, string> })` (`clock` returns sim.mp4 seconds; `log` is the `terminal.jsonl` path, appended to); `start(): Promise<void>`; `code(timeoutMs?: number): Promise<string>` (the pairing code); `expect(re: RegExp, timeoutMs?: number): Promise<string>`; `send(text: string): void`; `done(timeoutMs?: number): Promise<void>` (waits for `Done.`; rejects on `Failed:` / `Cancelled.` / exit with the last 20 lines); `kill(): void`.

pty-run protocol: `python3 -I pty-run.py <program> [args…]` — stdout: one JSON line per output chunk `{"text": "…"}`; stdin: each line received is written to the program's terminal as is (with its `\n`); exits with the program's code, printing `{"exit": <code>}` last.

- [ ] **Step 1: The pty helper**

`demo/capture/pty-run.py`:

```python
"""Runs a program in a pseudo-terminal (gnokey reads its password from the terminal).

stdout: one JSON object per chunk of the program's output, {"text": ...}, then {"exit": code}.
stdin: every line received is typed into the program's terminal.
"""
import json
import os
import pty
import select
import sys


def main() -> int:
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp(sys.argv[1], sys.argv[1:])
    out = sys.stdout
    stdin = sys.stdin.fileno()
    while True:
        ready, _, _ = select.select([fd] + ([stdin] if stdin >= 0 else []), [], [])
        if fd in ready:
            try:
                data = os.read(fd, 4096)
            except OSError:
                break
            if not data:
                break
            out.write(json.dumps({"text": data.decode("utf-8", "replace")}) + "\n")
            out.flush()
        if stdin in ready:
            line = os.read(stdin, 4096)
            if not line:
                stdin = -1  # closed: stop watching it
                continue
            os.write(fd, line)
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    out.write(json.dumps({"exit": code}) + "\n")
    out.flush()
    return code


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: A fake gnokey-pair for the tests**

`demo/capture/fixtures/fake-pair.sh` (mode 755):

```bash
#!/usr/bin/env bash
# Prints what gnokey-pair prints, asks what it asks. FAKE_PAIR=unexpected asks something else first.
printf 'Signing with gnokey (gnokey v0)\n\nOn your phone, choose "Send to my computer" and scan this code, or type it:\n\n    █▀▀▀▀▀█ ▄▀ █▀▀▀▀▀█\n    █ ███ █ ▀▄ █ ███ █\n    7-guitarist-revenge\n\nWaiting for the phone (3m0s)...\n'
sleep 0.2
printf 'Connected. Check words: apple banana (your phone shows the same)\n\n1. Create session  gpub1… (g1…)\n\n'
if [ "${FAKE_PAIR:-}" = unexpected ]; then printf 'No -remote given. Use the node the phone suggests for dev, http://x? [y/N] '; read -r a; exit 3; fi
printf 'Sign? [y/N] '
read -r a
[ "$a" = y ] || { printf '\nCancelled.\n'; exit 1; }
printf 'Enter password to decrypt key\n'
read -rs p
printf 'Simulating the signed transaction...\nBroadcasting...\nIncluded in block 12, hash ABC\n\nDone.\n'
```

- [ ] **Step 3: Write the failing tests**

`demo/capture/terminal.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Computer } from './terminal.ts';

const fake = new URL('./fixtures/fake-pair.sh', import.meta.url).pathname;
const log = () => join(mkdtempSync(join(tmpdir(), 'term-')), 'terminal.jsonl');

test('reads the code, answers the review and the password, and logs with the clock', async () => {
  const file = log();
  let t = 10;
  const c = new Computer({ bin: fake, args: [], clock: () => (t += 0.5), log: file });
  await c.start();
  assert.equal(await c.code(), '7-guitarist-revenge');
  await c.expect(/Sign\? \[y\/N\] $/);
  c.send('y\n');
  await c.expect(/Enter password/);
  c.send('\n');
  await c.done();
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.every((l) => typeof l.t === 'number' && l.t > 10));
  assert.match(lines.map((l) => l.text).join(''), /Included in block 12/);
});

test('an unexpected question fails with the last lines instead of hanging', async () => {
  const c = new Computer({ bin: fake, args: [], clock: () => 0, log: log(), env: { FAKE_PAIR: 'unexpected' } });
  await c.start();
  await c.code();
  await assert.rejects(c.expect(/Sign\? \[y\/N\] $/, 3000), /gnokey-pair asked something else[\s\S]*No -remote given/);
  c.kill();
});
```

Run: `cd demo && npm test` — Expected: FAIL (no `terminal.ts`).

- [ ] **Step 4: Implement `terminal.ts`**

```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const HELPER = new URL('./pty-run.py', import.meta.url).pathname;
const tail = (s: string) => s.split('\n').slice(-20).join('\n');

export class Computer {
  private p: ChildProcessWithoutNullStreams | null = null;
  private out = '';
  private exited: number | null = null;
  private waiters: (() => void)[] = [];
  private o: { bin: string; args: string[]; clock: () => number; log: string; env?: Record<string, string> };

  constructor(o: { bin: string; args: string[]; clock: () => number; log: string; env?: Record<string, string> }) {
    this.o = o;
  }

  async start() {
    this.p = spawn('python3', ['-I', HELPER, this.o.bin, ...this.o.args], { env: { ...process.env, ...this.o.env } });
    let buf = '';
    this.p.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, i)) as { text?: string; exit?: number };
        buf = buf.slice(i + 1);
        if (msg.text !== undefined) {
          this.out += msg.text;
          appendFileSync(this.o.log, JSON.stringify({ t: this.o.clock(), text: msg.text }) + '\n');
        }
        if (msg.exit !== undefined) this.exited = msg.exit;
        for (const w of this.waiters.splice(0)) w();
      }
    });
  }

  private wait(test: () => string | null, what: string, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`gnokey-pair asked something else (waiting for ${what}):\n${tail(this.out)}`)), timeoutMs);
      const check = () => {
        const hit = test();
        if (hit !== null) { clearTimeout(timer); return resolve(hit); }
        if (this.exited !== null) { clearTimeout(timer); return reject(new Error(`gnokey-pair exited (${this.exited}) while waiting for ${what}:\n${tail(this.out)}`)); }
        this.waiters.push(check);
      };
      check();
    });
  }

  /** The code to type in the wallet: the magic-wormhole code ("7-guitarist-revenge") after "or type it:", not a QR line. */
  code(timeoutMs = 30_000) {
    return this.wait(() => this.out.match(/or type it:[\s\S]*?\n {4}(\d+(?:-[a-z]+)+)\r?\n/)?.[1] ?? null, 'the pairing code', timeoutMs);
  }

  /** Waits for `re` in the output that follows the last match of an earlier expect. */
  expect(re: RegExp, timeoutMs = 120_000) {
    const from = this.out.length;
    return this.wait(() => {
      const m = this.out.slice(Math.max(0, from - 200)).match(re);
      return m ? m[0] : null;
    }, String(re), timeoutMs);
  }

  send(text: string) {
    this.p?.stdin.write(text);
  }

  async done(timeoutMs = 120_000) {
    // a pty ends lines with \r\n
    const r = await this.wait(() => (/\nDone\.\r?\n/.test(this.out) ? 'done' : /\n(Failed:[^\r\n]*|Cancelled\.)\r?\n/.exec(this.out)?.[1] ?? null), 'Done.', timeoutMs);
    if (r !== 'done') throw new Error(`gnokey-pair: ${r}\n${tail(this.out)}`);
  }

  kill() {
    this.p?.kill();
  }
}
```

(`expect` looks back 200 characters so a prompt printed just before the call is not missed; a prompt is matched once per `expect` call because each call starts from the output at that time minus that margin — keep prompts distinct in the scenes.)

- [ ] **Step 5: Run the tests**

Run: `cd demo && npm test && npx tsc --noEmit`
Expected: PASS; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add demo/capture/pty-run.py demo/capture/terminal.ts demo/capture/terminal.test.ts demo/capture/fixtures/fake-pair.sh
git commit -m "feat(demo): drive gnokey-pair through a pty, timestamped on the video's clock"
```

---

### Task 7: The capture — setup, recording, scenes 1–3

**Files:**
- Create: `demo/script.ts`, `demo/capture/run.ts`, `demo/capture/web.ts`, `demo/capture/fixtures/<screen>.json` (one per new screen met)

**Interfaces:**
- Consumes: `Sim`, `StepFailed` (Task 4), `Stage`, `PORTS`, `ALICE`, `REALM` (Task 5), `Computer` (Task 6), types (Task 1).
- Produces: `out/capture/sim.mp4`, `out/capture/timeline.json`, `out/capture/terminal.jsonl`, `out/capture/gnoweb.png`; CLI `npm run demo:capture -- [--until <scene>] [--no-setup]`; `SCRIPT` default export of `demo/script.ts`.

The labels below come from the sources (app: `src/screens/**`; wallet: `~/gnokey-mobile/ios/GnokeyMobile/Screens/*.swift`). Step 1 checks each against the real screen; fix `script.ts` where the real tree differs, and keep the tree as a fixture.

- [ ] **Step 1: Walk the flow by hand and record the real trees**

With `npm run demo:stage` running and the `gnoworld-demo` device prepared (`node -e` with `Sim.ensureDevice('gnoworld-demo')`, then `prepare([app, wallet])`, `connect()`), walk this sequence with `idb ui describe-all` / `idb ui tap` and save each screen's tree as `demo/capture/fixtures/<screen>.json`:

1. Wallet first launch → onboarding (`Gnokey Mobile`, `Create Session Key`) → its Settings (gear) → "Send to my computer" relay field → `ws://127.0.0.1:4000/v1` → network `http://127.0.0.1:26657`, chain `dev` → how Alice's identity (`g1jg8m…qf5`) is entered.
2. App → Settings tab → `Local gnodev` → `Server URL` → `http://127.0.0.1:8787` → `Save`.
3. App → Chat tab → the name chip (`you`) → field `name` → `alice` → `Save name` → `Done`.
4. App → Session tab → `Get a session from gnokey-mobile` → iOS "Open in …?" → `Open` → wallet `Sign in` → `Create a session for this app` → `Authorize on Computer` → `Scan or type the code` → field `7-guitarist-revenge` → `Connect` (with `gnokey-pair` running in a terminal: `demo/.state/bin/gnokey-pair -remote http://127.0.0.1:26657 -relay ws://127.0.0.1:4000/v1 -gnokey demo/.state/bin/gnokey -home demo/.state/gnohome -linger 20s`) → terminal `Sign? [y/N]` → `y` → `Enter password` → Enter → `Done.` → back in the app, `Session active`.
5. App → Pools → `Friday pot` → `boop …` (three times, waiting for the button to be enabled again).

**Check point (spec §5):** at step 4, does gnokey-pair sign and broadcast with the `gnokey` built from `~/gno-gnokey-pair` against gnodev at gnonative's revision? If it fails (amino or signature error from the node), stop and report to the user with the terminal output — do not switch to `-manual` without their go-ahead.

**Check point:** open `http://127.0.0.1:8888/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6` — note the path that shows the pool with Alice's boops (the realm's `Render`), for the `gnoweb` step.

- [ ] **Step 2: The script**

`demo/script.ts` — setup and scenes 0–3 now (scenes 4–7 are added in Task 8); replace any label Step 1 found different:

```ts
import type { Script } from './lib/types.ts';

const APP_SERVER = 'http://127.0.0.1:8787';

const script: Script = {
  voice: 'af_heart',
  // off camera, before recording
  setup: [
    { id: 'wallet', do: { launch: 'wallet' } },
    { id: 'wallet-start', do: { tap: 'Create Session Key' } },
    // INSERT HERE one step per action of Step 1, item 1, in the order performed (relay ws://127.0.0.1:4000/v1,
    // network dev / http://127.0.0.1:26657, Alice's identity g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5), with the
    // labels of the recorded trees; a control without a label is tapped by `swipe` with the same start and end point.
    { id: 'app', do: { launch: 'app' } },
    { id: 'settings', do: { tap: 'Settings' } },
    { id: 'local', do: { tap: 'Local gnodev' } },
    { id: 'server', do: { clear: 'Server URL', count: 22 } },
    { id: 'server-type', do: { type: APP_SERVER, into: 'Server URL' } },
    { id: 'save', do: { tap: 'Save' } },
    { id: 'chat', do: { tap: /^Chat/ } },
    { id: 'me', do: { tap: 'you' } },
    { id: 'name', do: { type: 'alice', into: 'name' } },
    { id: 'save-name', do: { tap: 'Save name' } },
    { id: 'done', do: { tap: 'Done' } },
  ],
  scenes: [
    {
      id: 'title', show: 'card', captions: [],
      voice: 'A gno dapp and a mobile wallet, talking over GnoConnect.',
      card: { title: 'gno.world', sub: '+ gnokey-mobile' },
    },
    {
      id: 'chat', show: 'phone', captions: ['Off-chain chat, on-chain game'],
      voice: 'gno.world is a game on gno.land, with its own chat.',
      steps: [
        { id: 'open', do: { waitFor: /^Chat/ }, mark: true },
        { id: 'bob', do: { bob: "new pool's up — 50 GNOT pot, you in?" } },
        { id: 'bob-seen', do: { waitFor: /new pool's up/ }, mark: true },
        { id: 'reply', do: { type: 'on my way', into: /say something|message/i } },
        { id: 'send', do: { tap: 'send' }, mark: true },
        { id: 'sent', do: { waitFor: 'on my way' }, mark: true },
      ],
      zoomOn: ['bob-seen', 'sent'],
    },
    {
      id: 'connect', show: 'phone+terminal',
      captions: ['connect — a link, no SDK', 'A session key: scoped, capped, expiring'],
      voice: 'The app opens the wallet with a plain launch link. The wallet asks the computer, where the master key lives, to grant a session key: one realm, a spending cap, an expiry.',
      steps: [
        { id: 'tab', do: { tap: 'Session' }, mark: true },
        { id: 'ask', do: { tap: 'Get a session from gnokey-mobile' }, mark: true },
        { id: 'open-wallet', do: { tap: 'Open', timeout: 8000 } },
        { id: 'wallet', do: { waitFor: 'Create a session for this app' }, mark: true },
        { id: 'create', do: { tap: 'Create a session for this app' } },
        { id: 'review', do: { waitFor: 'Authorize on Computer' }, mark: true },
        { id: 'authorize', do: { tap: 'Authorize on Computer' }, mark: true },
        { id: 'sign', do: { computer: 'sign' }, mark: true },
        { id: 'active', do: { waitFor: 'Session active', timeout: 60_000 }, mark: true },
      ],
      zoomOn: ['review', 'active'],
    },
    {
      id: 'play', show: 'phone',
      captions: ['Signed by the session key', 'Real txs on a local gno chain'],
      voice: 'Every move is a real transaction, signed by the session key. No popup, no wallet hop.',
      steps: [
        { id: 'pools', do: { tap: 'Pools' }, mark: true },
        { id: 'pool', do: { tap: /Friday pot/ }, mark: true },
        { id: 'boop1', do: { tap: /^boop /, enabled: true }, mark: true },
        { id: 'boop2', do: { tap: /^boop /, enabled: true, timeout: 30_000 }, mark: true },
        { id: 'boop3', do: { tap: /^boop /, enabled: true, timeout: 30_000 }, mark: true },
        { id: 'settled', do: { waitFor: /^boop /, enabled: true, timeout: 30_000 }, mark: true },
        { id: 'web', do: { gnoweb: '/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble6' } },
      ],
      zoomOn: ['boop1'],
    },
    { id: 'chain', show: 'browser', captions: ['Real txs on a local gno chain'] },
  ],
};

export default script;
```

- [ ] **Step 3: The gnoweb shot**

`demo/capture/web.ts`:

```ts
import { chromium } from 'playwright';

import { PORTS } from './stage.ts';

/** A 1280×800 shot of a gnoweb page on the local chain, at 2× for a sharp zoom. */
export async function gnowebShot(path: string, file: string) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await page.goto(`http://127.0.0.1:${PORTS.web}${path}`, { waitUntil: 'networkidle' });
    await page.screenshot({ path: file });
  } finally {
    await browser.close();
  }
}
```

Run once: `cd demo && npx playwright install chromium` (no-op when present).

- [ ] **Step 4: The capture program**

`demo/capture/run.ts`:

```ts
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
    args: ['-remote', `http://127.0.0.1:${PORTS.rpc}`, '-relay', `ws://127.0.0.1:${PORTS.relay}/v1`, '-gnokey', join(stage.bin, 'gnokey'),
      '-home', stage.home, '-timeout', '3m', '-linger', '20s'],
    clock, log: join(OUT, 'terminal.jsonl'),
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
    if (e instanceof StepFailed) throw new StepFailed(`${scope}.${step.id}: ${e.message}`, e.dump);
    throw new Error(`${scope}.${step.id}: ${(e as Error).message}`);
  }
}

async function act(scope: string, step: Step) {
  const a = step.do;
  let box;
  if ('launch' in a) await sim.launch(a.launch === 'app' ? APP.bundle : WALLET.bundle);
  else if ('tap' in a) box = (await sim.tap(a.tap, { enabled: a.enabled, timeout: a.timeout })).box;
  else if ('waitFor' in a) box = (await sim.waitFor(a.waitFor, { timeout: a.timeout, enabled: a.enabled })).box;
  else if ('type' in a) { box = (await sim.tap(a.into)).box; await sim.type(a.type); }
  else if ('clear' in a) { await sim.tap(a.clear); await sim.backspace(a.count); }
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
```

- [ ] **Step 5: Capture scenes 1–3**

Run: `npm run demo:capture -- --until chain`
Expected: `capture done: N marks …`; `demo/out/capture/sim.mp4` plays the chat, the session grant with the wallet and back, the three boops; `timeline.json` holds every marked step of `chat`, `connect`, `play`; `terminal.jsonl` holds the gnokey-pair run with `Included in block`; `gnoweb.png` shows the realm page with the pool.

Look at frames: `ffmpeg -v error -i demo/out/capture/sim.mp4 -vf fps=1/3,scale=300:-1,tile=6x4 /tmp/cap.png` and read `/tmp/cap.png`: the status bar reads 9:41 with a full battery, no dev overlay is visible.

A failing step must end with `capture stopped: <scene>.<step>: no element matching …` and the files in `out/capture/fail/`; check that by temporarily renaming one label in `script.ts`, then restore it.

- [ ] **Step 6: Commit**

```bash
git add demo/script.ts demo/capture/run.ts demo/capture/web.ts demo/capture/fixtures
git commit -m "feat(demo): capture the chat, the session grant through the computer and the boops"
```

---

### Task 8: The capture — scenes 4–7 (name proof, revoke, end card)

**Files:**
- Modify: `demo/script.ts`
- Create: `demo/capture/fixtures/<screen>.json` for the new screens

**Interfaces:**
- Consumes: Task 7's `run.ts` and step kinds; `computer: 'sign'` serves the challenge too (`gnokey sign-data` asks the same `Sign? [y/N]` and `Enter password to decrypt key`).

- [ ] **Step 1: Walk the new screens by hand and record the trees**

1. App → Chat → `alice` chip → `Reserve this name` → `Open` → wallet `Prove your identity` → `Text to sign` card → `Scan or type the code` → (gnokey-pair) → back in the app: the chip reads `alice ✓`.
2. App → Session → `Revoke` → alert `Revoke` → `Open` → wallet `Revoke on Computer` → (gnokey-pair) → back in the app: `Play from this phone`.
3. App → Pools → `Friday pot` → what the pool screen offers without a session.

**Check point (spec §5):** after the revocation, what does the pool screen do when Alice tries to boop? Expected by the scene: it asks for a session again (a prompt or the Session tab). If it shows an error that makes no sense to a user, or lets her tap `boop` and fails silently, stop and report it to the user as an app bug — do not film around it.

- [ ] **Step 2: Add the scenes**

Append to `scenes` in `demo/script.ts` (labels as Step 1 found them):

```ts
    {
      id: 'bob2', show: 'phone', captions: [],
      steps: [
        { id: 'chat', do: { tap: /^Chat/ }, mark: true },
        { id: 'bob', do: { bob: "nice! who are you? anyone can be 'anon'" } },
        { id: 'seen', do: { waitFor: /who are you/ }, mark: true },
      ],
      zoomOn: ['seen'],
    },
    {
      id: 'name', show: 'phone+terminal',
      captions: ['connect + challenge', 'The master key stays on the computer'],
      voice: 'To prove who she is, the app sends a challenge. The master key signs it on her computer — it never touches the phone.',
      steps: [
        { id: 'me', do: { tap: 'alice' }, mark: true },
        { id: 'reserve', do: { tap: 'Reserve this name' }, mark: true },
        { id: 'open-wallet', do: { tap: 'Open', timeout: 8000 } },
        { id: 'challenge', do: { waitFor: 'Text to sign' }, mark: true },
        { id: 'sign', do: { computer: 'sign' }, mark: true },
        { id: 'proved', do: { waitFor: /alice ✓/, timeout: 60_000 }, mark: true },
        { id: 'done', do: { tap: 'Done' } },
        { id: 'line', do: { type: 'alice, for real', into: /say something|message/i } },
        { id: 'send', do: { tap: 'send' } },
        { id: 'sent', do: { waitFor: 'alice, for real' }, mark: true },
      ],
      zoomOn: ['challenge', 'proved', 'sent'],
    },
    {
      id: 'revoke', show: 'phone+terminal',
      captions: ['Revoke any time'],
      voice: "Revoking is the account's call: the computer signs it, and the dapp has to ask again.",
      steps: [
        { id: 'tab', do: { tap: 'Session' }, mark: true },
        { id: 'revoke', do: { tap: 'Revoke' }, mark: true },
        { id: 'confirm', do: { tap: 'Revoke' } },
        { id: 'open-wallet', do: { tap: 'Open', timeout: 8000 } },
        { id: 'wallet', do: { waitFor: 'Revoke on Computer' }, mark: true },
        { id: 'go', do: { tap: 'Revoke on Computer' } },
        { id: 'sign', do: { computer: 'sign' }, mark: true },
        { id: 'gone', do: { waitFor: 'Play from this phone', timeout: 60_000 }, mark: true },
        { id: 'pools', do: { tap: 'Pools' } },
        { id: 'pool', do: { tap: /Friday pot/ }, mark: true },
        // INSERT HERE the steps of Step 1, item 3: the boop attempt and the screen that asks for a session, each
        // marked, the last one in `zoomOn`
      ],
      zoomOn: ['wallet', 'gone'],
    },
    {
      id: 'end', show: 'card', captions: [],
      voice: 'GnoConnect: one standard, any wallet.',
      card: {
        title: 'GnoConnect',
        sub: 'draft standard · gnokey-mobile · gnokey sign-data',
        lines: ['gnolang/gno #5970 · #6016 · #6322', 'Filmed on a local test chain'],
      },
    },
```

- [ ] **Step 3: Full capture**

Run: `npm run demo:capture`
Expected: `capture done`; every marked step of every phone scene is in `timeline.json`; `terminal.jsonl` holds three gnokey-pair runs (session, challenge, revoke), each ending with `Done.`; the contact sheet (as in Task 7) shows `alice ✓` and `Play from this phone`.

Run it a second time without changing anything.
Expected: it succeeds again (fresh chain, erased device): the capture is repeatable.

- [ ] **Step 4: Commit**

```bash
git add demo/script.ts demo/capture/fixtures
git commit -m "feat(demo): capture the name proof and the revocation"
```

---

### Task 9: The voice — kokoro-js

**Files:**
- Create: `demo/voice/voice.ts`, `demo/voice/voice.test.ts`

**Interfaces:**
- Consumes: `script.voice`, each scene's `voice` text.
- Produces: `out/voice/<scene>-<hash8>.wav`, `out/voice/durations.json` (`Durations`); exported pure helpers `cacheName(scene: string, voice: string, text: string): string` and `wavSeconds(bytes: Uint8Array): number`.

- [ ] **Step 1: Write the failing tests**

`demo/voice/voice.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cacheName, wavSeconds } from './voice.ts';

test('the cache name changes with the text and with the voice, not otherwise', () => {
  const a = cacheName('chat', 'af_heart', 'hello');
  assert.match(a, /^chat-[0-9a-f]{8}\.wav$/);
  assert.equal(cacheName('chat', 'af_heart', 'hello'), a);
  assert.notEqual(cacheName('chat', 'af_heart', 'hello!'), a);
  assert.notEqual(cacheName('chat', 'am_michael', 'hello'), a);
});

test('wavSeconds reads the length from the header', () => {
  // 24 kHz, mono, 32-bit float, 48 000 bytes of data = 0.5 s
  const b = new Uint8Array(44 + 48_000);
  const v = new DataView(b.buffer);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WAVEfmt '), 8);
  v.setUint32(16, 16, true);
  v.setUint16(20, 3, true); // float
  v.setUint16(22, 1, true); // channels
  v.setUint32(24, 24_000, true);
  v.setUint16(34, 32, true); // bits
  b.set(new TextEncoder().encode('data'), 36);
  v.setUint32(40, 48_000, true);
  assert.equal(wavSeconds(b), 0.5);
});
```

Run: `cd demo && npm test` — Expected: FAIL (no `voice.ts`).

- [ ] **Step 2: Implement**

`demo/voice/voice.ts`:

```ts
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Durations } from '../lib/types.ts';

export const cacheName = (scene: string, voice: string, text: string) =>
  `${scene}-${createHash('sha256').update(`${voice}\n${text}`).digest('hex').slice(0, 8)}.wav`;

/** Length of a PCM/float WAV from its fmt and data chunks. */
export function wavSeconds(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let rate = 0, channels = 0, bits = 0;
  for (let i = 12; i + 8 <= bytes.length;) {
    const id = new TextDecoder().decode(bytes.subarray(i, i + 4));
    const size = v.getUint32(i + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(i + 10, true);
      rate = v.getUint32(i + 12, true);
      bits = v.getUint16(i + 22, true);
    } else if (id === 'data') {
      return size / (rate * channels * (bits / 8));
    }
    i += 8 + size + (size % 2);
  }
  throw new Error('not a WAV with fmt and data chunks');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: script } = await import('../script.ts');
  const out = join(import.meta.dirname, '..', 'out', 'voice');
  mkdirSync(out, { recursive: true });
  const { KokoroTTS } = await import('kokoro-js');
  let tts: Awaited<ReturnType<typeof KokoroTTS.from_pretrained>> | null = null;
  const durations: Durations = {};
  for (const s of script.scenes) {
    if (!s.voice) continue;
    const name = cacheName(s.id, script.voice, s.voice);
    const file = join(out, name);
    if (!existsSync(file)) {
      tts ??= await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
      const audio = await tts.generate(s.voice, { voice: script.voice as never });
      await audio.save(file);
      console.log(`voiced ${s.id}`);
    }
    durations[s.id] = { file: `voice/${name}`, seconds: wavSeconds(readFileSync(file)) };
  }
  writeFileSync(join(out, 'durations.json'), JSON.stringify(durations, null, 2));
  console.log(`durations: ${Object.entries(durations).map(([k, d]) => `${k} ${d.seconds.toFixed(1)} s`).join(', ')}`);
}
```

- [ ] **Step 3: Run the tests, then voice the script**

Run: `cd demo && npm test && npx tsc --noEmit`
Expected: PASS.

Run: `npm run demo:voice`
Expected: first run downloads the model (~90 MB, once) and prints `voiced <scene>` for title, chat, connect, play, name, revoke, end, then the durations; a second run prints only the durations (cache).

- [ ] **Step 4: Choose the voice with the user**

Generate the `connect` line with three voices for the user to listen to:

```bash
cd demo && for v in af_heart am_michael bf_emma; do node --experimental-strip-types --no-warnings -e "
const { KokoroTTS } = await import('kokoro-js');
const t = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', { dtype: 'q8', device: 'cpu' });
await (await t.generate(process.argv[1], { voice: process.argv[2] })).save('out/voice/sample-' + process.argv[2] + '.wav');
" "The wallet asks the computer, where the master key lives, to grant a session key." $v; done; open out/voice
```

Ask the user which one; set `voice` in `demo/script.ts` to it and run `npm run demo:voice` again.

- [ ] **Step 5: Commit**

```bash
git add demo/voice demo/script.ts
git commit -m "feat(demo): narration with kokoro-js, cached per line"
```

---

### Task 10: The video — Remotion composition and render

**Files:**
- Create: `demo/video/index.ts`, `demo/video/Root.tsx`, `demo/video/Demo.tsx`, `demo/video/scenes.tsx`, `demo/video/parts.tsx`, `demo/video/plan.ts`

**Interfaces:**
- Consumes: `buildEdl`, `FPS`, `WIDTH`, `HEIGHT` (Task 2), `readTimeline`, `readDurations`, `readTerminal` (Task 1), `script.ts`.
- Produces: `out/edl.json`, `out/brand/gno-icon.svg`, `out/gnoworld-demo.mp4`; composition id `Demo` taking `Edl` as props.

- [ ] **Step 1: The plan writer**

`demo/video/plan.ts`:

```ts
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
```

- [ ] **Step 2: Root and composition**

`demo/video/index.ts`:

```ts
import { registerRoot } from 'remotion';

import { Root } from './Root.tsx';

registerRoot(Root);
```

`demo/video/Root.tsx`:

```tsx
import { Composition } from 'remotion';

import type { Edl } from '../lib/types.ts';
import { Demo } from './Demo.tsx';

const EMPTY: Edl = { fps: 30, width: 1920, height: 1080, durationInFrames: 30, video: { width: 1206, height: 2622, duration: 1 }, screen: { width: 402, height: 874 }, scenes: [] };

export const Root = () => (
  <Composition
    id="Demo"
    component={Demo}
    defaultProps={EMPTY}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={30}
    calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames, fps: props.fps, width: props.width, height: props.height })}
  />
);
```

`demo/video/Demo.tsx`:

```tsx
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';

import type { Edl } from '../lib/types.ts';
import { C, font } from './parts.tsx';
import { SceneView } from './scenes.tsx';

export const Demo = (edl: Edl) => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: font }}>
    {edl.scenes.map((s) => (
      <Sequence key={s.id} from={s.from} durationInFrames={s.duration} name={s.id}>
        <SceneView scene={s} edl={edl} />
        {s.voice ? (
          <Sequence from={s.voice.from}>
            <Audio src={staticFile(s.voice.src)} />
          </Sequence>
        ) : null}
      </Sequence>
    ))}
  </AbsoluteFill>
);
```

- [ ] **Step 3: The parts**

`demo/video/parts.tsx`:

```tsx
import { loadFont } from '@remotion/google-fonts/Inter';
import type { ReactNode } from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import type { CaptionCue, ZoomKey } from '../lib/types.ts';

export const { fontFamily: font } = loadFont();
export const C = { bg: '#06090e', panel: '#0d141c', green: '#3ddc84', white: '#f2fff7', muted: '#8a9aa8', line: '#1c2834' };

/** The camera: eases from one key to the next over 12 frames. */
export function zoomAt(keys: ZoomKey[], f: number) {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].f <= f) i++;
  const cur = keys[i];
  const prev = keys[Math.max(0, i - 1)];
  const k = i === 0 ? 1 : interpolate(f, [cur.f, cur.f + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const mix = (a: number, b: number) => a + (b - a) * k;
  return { scale: mix(prev.scale, cur.scale), cx: mix(prev.cx, cur.cx), cy: mix(prev.cy, cur.cy) };
}

/** An iPhone-shaped frame holding `children` (the screen, at its own aspect ratio), height in px. */
export const PhoneFrame = ({ height, aspect, children }: { height: number; aspect: number; children: ReactNode }) => {
  const width = height * aspect;
  return (
    <div style={{ width: width + 28, height: height + 28, borderRadius: 64, background: '#1b1f24', padding: 14, boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}>
      <div style={{ width, height, borderRadius: 52, overflow: 'hidden', position: 'relative', background: '#000' }}>{children}</div>
    </div>
  );
};

export const Captions = ({ cues }: { cues: CaptionCue[] }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cue = cues.find((c) => f >= c.from && f < c.from + c.duration);
  if (!cue) return null;
  const pop = spring({ frame: f - cue.from, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 56 }}>
      <div style={{
        maxWidth: 1100, padding: '18px 34px', borderRadius: 18, background: 'rgba(13,20,28,.92)', border: `2px solid ${C.green}`,
        color: C.white, fontSize: 40, fontWeight: 700, textAlign: 'center', opacity: pop, transform: `translateY(${(1 - pop) * 20}px)`,
      }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

export const Terminal = ({ lines }: { lines: { f: number; text: string }[] }) => {
  const f = useCurrentFrame();
  const text = lines.filter((l) => l.f <= f).map((l) => l.text).join('').replace(/\r/g, '');
  // gnokey-pair's QR (block characters) is for a camera, not for the video
  const shown = text.split('\n').filter((l) => !/[█▀▄]/.test(l)).slice(-22).join('\n');
  return (
    <div style={{ width: 760, height: 620, borderRadius: 16, background: '#0b0f14', border: `1px solid ${C.line}`, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.5)' }}>
      <div style={{ height: 40, background: '#151b22', display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
        <div style={{ color: C.muted, fontSize: 18, marginLeft: 16 }}>gnokey-pair — your computer</div>
      </div>
      <pre style={{ margin: 0, padding: 20, color: C.white, fontSize: 19, lineHeight: 1.35, fontFamily: 'Menlo, monospace', whiteSpace: 'pre-wrap' }}>{shown}</pre>
    </div>
  );
};

export const Logo = ({ size }: { size: number }) => <Img src={staticFile('brand/gno-icon.svg')} style={{ width: size, height: size }} />;
```

- [ ] **Step 4: The scenes**

`demo/video/scenes.tsx`:

```tsx
import { AbsoluteFill, Freeze, Img, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import type { Edl, EdlScene } from '../lib/types.ts';
import { C, Captions, Logo, PhoneFrame, Terminal, zoomAt } from './parts.tsx';

const Screen = ({ scene, edl }: { scene: EdlScene; edl: Edl }) => {
  const f = useCurrentFrame();
  const c = scene.clip!;
  const z = zoomAt(scene.zoom, f);
  const played = scene.duration - c.holdFrames;
  const video = (
    <OffthreadVideo src={staticFile('capture/sim.mp4')} trimBefore={Math.round(c.start * edl.fps)} playbackRate={c.rate} muted
      style={{ width: '100%', height: '100%' }} />
  );
  return (
    <div style={{ width: '100%', height: '100%', transform: `scale(${z.scale})`, transformOrigin: `${z.cx * 100}% ${z.cy * 100}%` }}>
      <Sequence durationInFrames={played}>{video}</Sequence>
      {c.holdFrames > 0 ? (
        <Sequence from={played}>
          <Freeze frame={played - 1}>{video}</Freeze>
        </Sequence>
      ) : null}
    </div>
  );
};

const PhoneScene = ({ scene, edl }: { scene: EdlScene; edl: Edl }) => {
  const aspect = edl.video.width / edl.video.height;
  const withTerminal = scene.show === 'phone+terminal';
  return (
    <AbsoluteFill style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 80 }}>
      <PhoneFrame height={940} aspect={aspect}><Screen scene={scene} edl={edl} /></PhoneFrame>
      {withTerminal ? <Terminal lines={scene.terminal ?? []} /> : null}
    </AbsoluteFill>
  );
};

const Card = ({ scene }: { scene: EdlScene }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f, fps, config: { damping: 200 } });
  const card = scene.card!;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 28, opacity: k }}>
      <Logo size={180} />
      <div style={{ color: C.white, fontSize: 96, fontWeight: 800, letterSpacing: -2 }}>{card.title}</div>
      {card.sub ? <div style={{ color: C.green, fontSize: 48, fontWeight: 700 }}>{card.sub}</div> : null}
      {(card.lines ?? []).map((l) => <div key={l} style={{ color: C.muted, fontSize: 32 }}>{l}</div>)}
    </AbsoluteFill>
  );
};

const Browser = ({ scene }: { scene: EdlScene }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
    <div style={{ width: 1280, borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.line}`, boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}>
      <div style={{ height: 46, background: '#151b22', display: 'flex', alignItems: 'center', paddingLeft: 20, color: C.muted, fontSize: 20 }}>
        127.0.0.1:8888 — gnoweb, local chain
      </div>
      {scene.gnoweb ? <Img src={staticFile(scene.gnoweb)} style={{ width: 1280, display: 'block' }} /> : null}
    </div>
  </AbsoluteFill>
);

export const SceneView = ({ scene, edl }: { scene: EdlScene; edl: Edl }) => (
  <AbsoluteFill>
    {scene.show === 'card' ? <Card scene={scene} /> : scene.show === 'browser' ? <Browser scene={scene} /> : <PhoneScene scene={scene} edl={edl} />}
    <Captions cues={scene.captions} />
  </AbsoluteFill>
);
```

- [ ] **Step 5: Check one still against the source before rendering everything**

Run: `cd demo && npm run plan && npx remotion still video/index.ts Demo out/still-connect.png --props=out/edl.json --frame=<connect.from + 30>` (take `from` from `out/edl.json`).
Then extract the source frame it should show: `ffmpeg -v error -ss <clip.start + 30/30*rate> -i out/capture/sim.mp4 -frames:v 1 out/src-connect.png`.
Read both PNGs. Expected: the phone in the still shows the same screen as the source frame (same moment of the flow). If they differ, `trimBefore` is not in source frames with `playbackRate`: change `trimBefore` to `Math.round(c.start * edl.fps / c.rate)` and check again.

- [ ] **Step 6: Render**

Run: `npm run demo:render`
Expected: `out/gnoworld-demo.mp4`; `ffprobe -v error -show_entries stream=width,height,codec_name -of compact out/gnoworld-demo.mp4` gives h264 1920×1080 and aac.

Run: `cd demo && npx tsc --noEmit` — Expected: silent.

- [ ] **Step 7: Commit**

```bash
git add demo/video
git commit -m "feat(demo): the Remotion composition — phone, terminal, gnoweb, cards, captions, narration"
```

---

### Task 11: Checks, review and documentation

**Files:**
- Create: `demo/check/check.ts`, `demo/check/check.test.ts`, `demo/README.md`
- Modify: `docs/superpowers/specs/2026-10-13-gnoworld-demo-video-design.md` (a "Statut" line)

**Interfaces:**
- Consumes: `out/edl.json` (`Edl`), `out/voice/durations.json`, `out/gnoworld-demo.mp4`.
- Produces: `checkEdl(edl: Edl, durations: Durations): string[]` (problems, empty when fine); `out/review/sheet-NN.png`.

- [ ] **Step 1: Write the failing tests**

`demo/check/check.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Edl } from '../lib/types.ts';
import { checkEdl } from './check.ts';

const edl = (scenes: Edl['scenes'], total = 3600): Edl => ({
  fps: 30, width: 1920, height: 1080, durationInFrames: total, video: { width: 1206, height: 2622, duration: 200 },
  screen: { width: 402, height: 874 }, scenes,
});
const scene = (id: string, duration: number, captions: string[] = []) => ({
  id, show: 'card' as const, from: 0, duration, zoom: [], voice: { src: `voice/${id}.wav`, from: 6 },
  captions: captions.map((text) => ({ text, from: 0, duration })),
});

test('a fine edit has no problem', () => {
  assert.deepEqual(checkEdl(edl([scene('a', 300)]), { a: { file: 'voice/a.wav', seconds: 5 } }), []);
});

test('the total must be between 1 min 45 and 2 min 15', () => {
  assert.match(checkEdl(edl([scene('a', 300)], 30 * 60), { a: { file: 'x', seconds: 5 } })[0], /total 60\.0 s/);
});

test('a voice longer than its scene is reported', () => {
  assert.match(checkEdl(edl([scene('a', 100)]), { a: { file: 'x', seconds: 5 } })[0], /scene a: the voice .* runs past/);
});

test('a caption too long for one line pair is reported', () => {
  const long = 'x'.repeat(70);
  assert.match(checkEdl(edl([scene('a', 300, [long])]), { a: { file: 'x', seconds: 5 } })[0], /scene a: caption .* 70 characters/);
});
```

Run: `cd demo && npm test` — Expected: FAIL (no `check.ts`).

- [ ] **Step 2: Implement**

`demo/check/check.ts`:

```ts
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { readDurations } from '../lib/files.ts';
import type { Durations, Edl } from '../lib/types.ts';

const MIN_S = 105;
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
```

- [ ] **Step 3: Run the tests and the check**

Run: `cd demo && npm test && npx tsc --noEmit && cd .. && npm run demo:check`
Expected: tests PASS; `demo:check ok — <105–135> s; contact sheets in demo/out/review/`. If it reports problems, fix the script (narration too long → shorten the line; total out of range → adjust lines), re-run `demo:voice`, `demo:render`, `demo:check`.

- [ ] **Step 4: Claude's review passes**

1. **Script:** read `demo/script.ts` against the spec §4 and the code: every claim is true of the app, the wallet and gnokey-pair as filmed (no claim that the phone holds the master key; "a link, no SDK" holds for GnoConnect launch links); fix wording.
2. **Design:** render stills of one frame per scene (`npx remotion still … --frame=<from + duration/2>`), read them: text readable, phone not cropped, terminal not overlapping the captions, zoom on the right element, colours as in the constraints.
3. **Render:** read every `out/review/sheet-*.png`; watch for black frames, a frozen frame where action is expected, a caption on a wrong scene, the QR in the terminal.

Fix and re-render until all three passes are clean; note each fix in the commit message.

- [ ] **Step 5: README and spec status**

`demo/README.md`:

```markdown
# gno.world demo video

`npm run demo` (from the repository root) films gno.world and gnokey-mobile on the iOS simulator against a fresh
local chain, voices the script and renders `demo/out/gnoworld-demo.mp4`. Design:
`docs/superpowers/specs/2026-10-13-gnoworld-demo-video-design.md`.

Once, and after the app or the wallet changes: `npm run demo:build` (gnokey with sign-data, gnokey-pair, the relay's
venv, the app's Release build, gnokey-mobile).

| Command | Does |
|---|---|
| `npm run demo:stage` | the chain, gnoweb, chat server and relay, for a look by hand (Ctrl-C stops) |
| `npm run demo:capture` | films (`-- --until <scene>` stops early, `-- --no-setup` keeps the device as it is) |
| `npm run demo:voice` | narration (cached per line) |
| `npm run demo:render` | the edit and the MP4 (`npm --prefix demo run studio` to adjust it live) |
| `npm run demo:check` | length, voice and caption checks, contact sheets in `demo/out/review/` |

Everything to change is in `demo/script.ts`: scenes, narration, captions, the steps filmed, the voice. A step that
cannot find its element stops the capture and leaves a screenshot and the accessibility tree in
`demo/out/capture/fail/`. Ports 26657, 8888, 8787 and 4000 must be free.

Remotion is free for individuals, non-profits and companies of up to 3 employees; larger companies need a company
license (remotion.pro).
```

In the spec, under the title, add: `**Statut :** livré le <date> (\`<first>\`..\`<last>\`), rendu de <durée> s vérifié par demo:check et relu.`

- [ ] **Step 6: Final checks and commit**

Run: `npx expo lint && npx tsc --noEmit && npx jest 2>&1 | tail -3 && (cd demo && npm test && npx tsc --noEmit)`
Expected: all clean.

```bash
git add demo/check demo/README.md docs/superpowers/specs/2026-10-13-gnoworld-demo-video-design.md
git commit -m "feat(demo): post-render checks, contact sheets, README"
```
