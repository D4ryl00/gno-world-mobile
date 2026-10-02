# Bubble Rumble mobile

Play [Bubble Rumble](https://bubblerumble.net) on iOS and Android with a gno **session key**: your account
authorises this app's own key once (budget per hour, expiry, Bubble Rumble realms only), then every boop is
signed in the app. The authorisation goes through [gnokey-mobile](../gnokey-mobile) (a GnoConnect
`connect` carrying the app's key, see `gnoconnect-session.md`) or, without it, a `gnokey` command run on
your computer. Renewing is a new `connect` naming the current key in `old`; logging out is a `disconnect`.

## Requirements

- Node 22+, Xcode, Android SDK + NDK, Go (for gnonative and the e2e suite)
- `~/gnonative` on branch `feat/sign-bytes` ([gnolang/gnonative#233](https://github.com/gnolang/gnonative/pull/233): `SignBytes`, and gno on the mainnet line so transaction results carrying `bank.TransferEvent` decode), packed: `cd ~/gnonative/expo && make build && npm run build && npm pack`
- `~/gno` (gnodev and gnokey for the e2e suite)

## Run

```sh
npm install ~/gnonative/expo/gnolang-gnonative-0.1.2.tgz
npm install
npx expo run:ios      # or: npx expo run:android
```

Settings → network: gno.land mainnet (default) or a local gnodev; off-chain server: bubblerumble.net (default).

## Play against a local gnodev

```sh
npm run gnodev    # RPC on 127.0.0.1:26657; extra flags go to gnodev
```

Then Settings → Local gnodev → Save. The script builds gnodev once (into `.e2e/bin/`) from the gno revision
gnonative pins — the gno.land mainnet line, so the realms deployed there type-check — using `git archive`, without
touching your `~/gno` checkout. It loads every Bubble Rumble realm (v1–v5, `bubble`, `wbubble`) and their
dependencies from gno.land (`-remote gno.land=…`, `-paths …`), so it needs network access at start. Sign the
desktop session command with a key from `.e2e/gnohome` (e.g. `test1`, created by `npm run e2e`) or your own.

If you run gnodev by hand with local copies instead, pass absolute paths: `-C` changes gnodev's directory, so a
relative realm path loads nothing local and the realm panics on its first call ("unexpected node with location …").

## Test

```sh
npm test          # unit tests
npm run typecheck
npm run e2e       # gnodev + gnonative goserver + gnokey, end to end
```

The e2e suite builds `gnokey` and `gnodev` from `~/gno`, and the gnonative goserver against `~/gno` (using a throwaway modfile in `.e2e/`) to ensure the goserver can decode events from the node. It uses ports 46657 (node RPC) and 46660 (goserver TCP), and needs network access once to fetch the realm from gno.land.

## Layout

- `src/app` — routes (expo-router)
- `src/chain` — realm table, JSON parsing, `GameClient`, error classification
- `src/components` — UI components
- `src/game` — prices, clocks, gas and shot odds (ported from the site)
- `src/hooks` — custom React hooks
- `src/offchain` — the official server: identity, presence (and the US gate)
- `src/screens` — screens and UI layouts
- `src/session` — session keys, GnoConnect links, desktop commands, on-chain status, state machine
- `src/state` — state management
- `src/utils` — utility functions
- `e2e` — end-to-end tests
- `scripts` — build and test scripts

The `patches/` directory contains patch-package patches applied postinstall.

## Known issues

- gnonative's Go service reports a session refusal without the chain's detail, so every refusal is shown as a budget problem.
