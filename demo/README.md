# gno.world demo video

`npm run demo` (from the repository root) films gno.world and gnokey-mobile on the iOS simulator against a fresh
local chain, voices the script and renders `demo/out/gnoworld-demo.mp4`. Design:
`docs/superpowers/specs/2026-10-13-gnoworld-demo-video-design.md`.

Once, and after the app or the wallet changes: `npm run demo:build` (gnokey with sign-data, gnokey-pair, the relay's
venv, the app's Release build, gnokey-mobile).

| Command | Does |
|---|---|
| `npm run demo:stage` | the chain, gnoweb, chat server and relay, for a look by hand (Ctrl-C stops) |
| `npm run demo:capture` | films, about 12 min with the setup (`-- --until <scene>` stops early, `-- --no-setup` keeps the device as it is) |
| `npm run demo:voice` | narration (cached per line) |
| `npm run demo:render` | the edit and the MP4 (`npm --prefix demo run studio` to adjust it live) |
| `npm run demo:check` | length, voice and caption checks, contact sheets in `demo/out/review/` |

Everything to change is in `demo/script.ts` (labels as the accessibility tree reads them): scenes, narration, captions, the steps filmed, the voice. A step that
cannot find its element stops the capture and leaves a screenshot and the accessibility tree in
`demo/out/capture/fail/`. Ports 26657, 8888, 8787 and 4000 must be free.

## The beta video

`DEMO=beta` picks `demo/beta.ts` (design: `docs/superpowers/specs/2026-10-30-gnoworld-beta-video-design.md`): what's
new since the first video, then how to join the beta. It films the store build (no gnokey-mobile) on the real
gno.world and gno.land mainnet — no local stage, nothing signed — on an iPhone 18 Pro (iOS 27) simulator named
`gnoworld-beta`, and writes everything to `demo/out-beta/` (`gnoworld-beta.mp4`).

```bash
DEMO=beta npm run demo:build   # once: the Release build with EXPO_PUBLIC_WALLET=off
DEMO=beta npm run demo         # capture, voice, render, check (about 6 min)
```

The room it makes on camera ("gno devs", unlisted) is deleted after the recording (the script's `teardown`, run even
when a scene fails; check the log for `teardown:` errors). The chat on screen is live: look at the contact sheets in
`demo/out-beta/review/` before sharing the video.

Remotion is free for individuals, non-profits and companies of up to 3 employees; larger companies need a company
license (remotion.pro).

Known limits:

- The name scene waits a little over 3 minutes off camera: the server takes a boop from the last 3 minutes as proof of
  the name and would skip the challenge the scene films.
- After the name proof the chat does not take input any more (an app bug, reported), so the scene ends on the proven
  name.
- The challenge text comes from the fake chat server (`scripts/fake-offchain`), which marks it `fake:`.
