# gno.world beta video Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `DEMO=beta npm run demo` films the store build (no wallet) on the real gno.world and renders
`demo/out-beta/gnoworld-beta.mp4`: what's new since 13 October, then how to join the beta and what comes next.

**Architecture:** the `demo/` pipeline stays as it is. One module picks the script and its output folder from `DEMO`;
`Script` gains optional fields (target, device, app build, teardown, check bounds, output name) whose defaults are the
first demo's; the capture skips the local stage for a `production` target; a new `drag` action holds then slides.

**Tech Stack:** Node 22 (`--experimental-strip-types`, `node --test`), idb / simctl, kokoro-js, Remotion 4.

**Spec:** `docs/superpowers/specs/2026-10-30-gnoworld-beta-video-design.md`

## Global Constraints

- `npm run demo` without `DEMO` keeps reading `demo/script.ts` and writing `demo/out/` (first demo unchanged).
- `DEMO=beta` → `demo/beta.ts`, outputs in `demo/out-beta/`, MP4 `gnoworld-beta.mp4`, `demo:check` range 60–110 s.
- The beta app is the Release simulator build with `EXPO_PUBLIC_WALLET=off`, in `demo/.state/build-nowallet`.
- Device for the beta: iPhone 18 Pro, `com.apple.CoreSimulator.SimRuntime.iOS-27-0`, named `gnoworld-beta`.
- No app code changes. Server https://gno.world, network gno.land mainnet (the app's defaults: no Settings step).
- Room filmed: `gno devs`, unlisted; deleted by the teardown after the recording.
- Narration says "remi at berty dot tech"; the card shows `remi@berty.tech`.
- Commits signed off (`git commit -s`), on branch `demo/beta-video`.

## Review Focus

- A scene fails after the room was made → the teardown still deletes the room (test: teardown runs on failure).
- `DEMO` set to an unknown name → clear error naming the expected file, before anything boots (test in Task 1).
- Live chat shows something unfit on camera → re-capture (manual check of the contact sheets, Task 4).
- Home data slow to load on a cold launch → setup waits for the price before recording (`waitFor` in the setup).
- Voice cache: the beta's scene ids `title` / `end` must not collide with the first demo's cache (separate `out-beta/voice/`).

---

### Task 1: Script selection and Script defaults

**Files:**
- Create: `demo/lib/which.ts`, `demo/lib/which.test.ts`, `demo/video/render.ts`
- Modify: `demo/lib/types.ts` (Script fields), `demo/capture/run.ts`, `demo/voice/voice.ts`, `demo/video/plan.ts`,
  `demo/check/check.ts` (bounds and output name from the script), `demo/package.json` (`render`, `studio` via
  `video/render.ts`), `demo/check/check.test.ts`

**Interfaces:**
- Produces: `pick(name: string | undefined): { name: string; file: string; out: string }` (pure: `undefined` or
  `'script'` → `script.ts` / `out`; else `<name>.ts` / `out-<name>`; throws `no demo script demo/<name>.ts` when the
  file is missing); `loadScript(): Promise<{ script: Script; out: string }>` (absolute `out`);
  `defaults(s: Script): Required<Pick<Script, 'target' | 'device' | 'app' | 'teardown' | 'check' | 'output'>>`.
- `Script` new optional fields: `target?: 'local' | 'production'`, `device?: { name: string; type: string; runtime: string }`,
  `app?: string` (relative to `demo/.state`), `teardown?: Step[]`, `check?: { min: number; max: number }`, `output?: string`.
  Defaults: `'local'`, `{ name: 'gnoworld-demo', type: '…iPhone-17-Pro', runtime: '…iOS-26-5' }`,
  `'build/Build/Products/Release-iphonesimulator/gnoworld.app'`, `[]`, `{ min: 90, max: 135 }`, `'gnoworld-demo.mp4'`.
- `checkEdl(edl, durations, range = { min: 90, max: 135 })`.

- [ ] **Step 1: Tests** — `pick(undefined)` → `{ name: 'script', file: …/script.ts, out: …/out }`; `pick('beta')` with
  `beta.ts` present → `out-beta`; `pick('nope')` throws /demo\/nope\.ts/; `defaults({voice, setup:[], scenes:[]})`
  equals the defaults above; `checkEdl` with `{min:60,max:110}` flags 50 s and accepts 75 s.
- [ ] **Step 2:** run `npm --prefix demo test` → the new tests fail.
- [ ] **Step 3:** implement; every entry point imports `loadScript()` instead of `../script.ts` and the hard-coded
  `out`; `video/render.ts` runs `plan` then `remotion render video/index.ts Demo <out>/<output> --props=<out>/edl.json
  --public-dir=<out>` (and `studio` likewise).
- [ ] **Step 4:** `npm --prefix demo test` and `npm --prefix demo run typecheck` pass; `npm run demo:render` +
  `npm run demo:check` on the first demo's existing capture still pass.
- [ ] **Step 5:** commit `feat(demo): pick the script with DEMO; a script names its target, device, build and bounds`.

### Task 2: Production target, teardown, drag, no-wallet build

**Files:**
- Modify: `demo/capture/run.ts`, `demo/capture/sim.ts` (`ensureDevice(name, type, runtime)`, `drag`),
  `demo/lib/types.ts` (`{ drag: [x1, y1, x2, y2]; hold?: number }` action), `demo/tools/build.sh`
- Test: `demo/capture/sim.test.ts`

**Interfaces:**
- Consumes: `loadScript`, `defaults` (Task 1).
- Produces: `Sim.drag(x1, y1, x2, y2, holdMs = 700)`; `production` capture = no `Stage`, no wallet install, preflight
  checks only the app build + idb/ffmpeg tools; `teardown` steps run after `stopRecording`, in `finally` too when
  recording had started, each failure logged, never replacing the capture's own error.

- [ ] **Step 1: Test** — with a fake `idb` (the existing `companionCmd`-style injection, or a stubbed `run`), `drag`
  issues a hold (zero-distance swipe of `holdMs`) then the slide; teardown order covered by a small pure helper
  `runAll(steps, play): Promise<string[]>` returning the errors.
- [ ] **Step 2:** run, fail. **Step 3:** implement. `build.sh`: when `DEMO=beta`, only the app, with
  `EXPO_PUBLIC_WALLET=off` exported, `-derivedDataPath "$S/build-nowallet"`.
- [ ] **Step 4:** tests + typecheck pass; `DEMO=beta npm run demo:build` leaves
  `demo/.state/build-nowallet/Build/Products/Release-iphonesimulator/gnoworld.app`; `grep -c 'Coming soon'` on its
  `main.jsbundle` ≥ 1.
- [ ] **Step 5:** commit `feat(demo): a production target, a teardown, a held drag; the no-wallet build`.

### Task 3: The beta script

**Files:** Create `demo/beta.ts`; fixtures of the trees read in `demo/capture/fixtures/beta-*.json`.

- [ ] **Step 1:** boot the `gnoworld-beta` device with the build, walk the scenes by hand with
  `idb ui describe-all`, save the trees as fixtures, note the labels (Home cards, full-screen close, ＋, `Make a room`,
  the share sheet's close, room menu, `Get a session from a computer`, `Run this on your computer`).
- [ ] **Step 2:** write `beta.ts`: `target: 'production'`, `device`, `app: 'build-nowallet/…/gnoworld.app'`,
  `check: { min: 60, max: 110 }`, `output: 'gnoworld-beta.mp4'`, `voice: 'af_heart'`; setup = wait for the price on
  Home; scenes and narration as spec §3 (ids `title home rooms session join next`); teardown = open the room's menu,
  `Delete room`, confirm.
- [ ] **Step 3:** `DEMO=beta npm run demo:capture` succeeds; `out-beta/capture/timeline.json` has every mark; the
  room is gone (teardown log line).
- [ ] **Step 4:** commit `feat(demo): the beta video's script`.

### Task 4: Voice, render, review

- [ ] **Step 1:** `DEMO=beta npm run demo:voice`, `demo:render`, `demo:check` → `demo:check ok`.
- [ ] **Step 2:** review the contact sheets and a still per scene: labels quoted match the screen, no unfit chat line,
  zooms frame the right element, captions readable; fix in `beta.ts` / `video/`, re-render.
- [ ] **Step 3:** README: a "Beta video" section (`DEMO=beta npm run demo:build`, `DEMO=beta npm run demo`); lint and
  typecheck of the app (`npx expo lint`, `npx tsc --noEmit`) clean.
- [ ] **Step 4:** commit `feat(demo): the beta video renders; README`.
