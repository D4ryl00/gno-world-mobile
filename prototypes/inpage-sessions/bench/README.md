# In-page sessions bench

Playwright drives Chromium with the built Adena extension (`~/adena-wallet`,
branch `feat/gnoconnect-in-page`) through the scenarios of
`docs/superpowers/specs/2026-10-04-gnoconnect-inpage-sessions-design.md` §6,
for an Ed25519 and a secp256k1 session key, against a local gnodev.

```sh
cd ~/adena-wallet/packages/adena-extension && yarn build   # dist/ is what gets loaded
cd ~/bubblerumble && npm run gnodev                         # chain `dev` on 127.0.0.1:26657
cd ~/bubblerumble/prototypes/inpage-sessions/bench
npm install && npx playwright install chromium               # once
npm test
```

What it does:

- starts a fresh Chromium profile with the extension, and onboards Adena through
  its own screens: import `test1`'s mnemonic, set a password, select `Local`;
- serves the test page (`..`) on `localhost` and runs its actions through
  `window.runAction`, answering each Adena window as it opens (Connect, Approve,
  Reject) and asserting how many opened;
- reads the session back from the chain (`auth/accounts/<test1>/session/<addr>`).

Variables: `ADENA_DIST` (another build), `HEADED=1` (watch it), `ONLY_KEY=ed25519`
or `secp256k1`, `DEBUG=1` (page console, window list, the extension's own logs and
its stored approvals after each action).

Headless Chromium's virtual screen is too small for the place Adena opens its
windows (left 800, top 300), and Chrome then refuses to create them: the bench
passes `--screen-info={0,0 1920x1080}`.
