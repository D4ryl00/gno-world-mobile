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
- closes the review window as soon as its transaction leaves (5b, 5c): the page
  must still get the grant or the revocation, read from the chain by Adena.

Challenge scenarios (8–11, spec `docs/superpowers/specs/2026-10-13-adena-connect-challenge-design.md`):
the bench starts the app's fake gno.world server (`scripts/fake-offchain/server.ts`) and serves it under
`/api/` beside the page, which does what gno.world's page would do: a phrase from the server, signed
through `connect({challenge})`, the proof converted (`signBytesOf(proof.signed)`, the signature, the
compressed key from the gpub) and sent back to reserve a name.

Onboarding turns on Adena's Testnet Mode before choosing Local: upstream lists Local there only.

Variables: `ADENA_DIST` (another build), `HEADED=1` (watch it), `ONLY_KEY=ed25519`
or `secp256k1`, `DEBUG=1` (page console, window list, the extension's own logs and
its stored approvals after each action).

Headless Chromium's virtual screen is too small for the place Adena opens its
windows (left 800, top 300), and Chrome then refuses to create them (Adena then
answers `UNEXPECTED_ERROR`): the bench passes `--screen-info={0,0 1920x1080}`.
