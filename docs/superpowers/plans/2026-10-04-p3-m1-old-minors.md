# P3-M1's deferred minors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the 46 minors deferred in the P3-M1 ledger (`.superpowers/sdd/2026-10-01-p3-m1-game-loop/progress.md`): fix those that still apply, record the rest as rulings.

**Architecture:** Bubble Rumble only (`~/bubblerumble`, `main`). Pure logic first, each with jest tests (game math, parser, errors, links, fallback, stores); screens get small pure helpers where the logic is money or state (`boopQuote`, `grantFromInput`), the rest is checked on the iOS simulator.

**Tech Stack:** Expo SDK 57, Expo Router, zustand, jest (`npx jest`), `npx tsc --noEmit`, `npx expo lint`, e2e on gnodev (`npm run e2e`).

**Spec:** `docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` (§5 the dapp, §9), protocol `gnoconnect-session.md`.

## Global Constraints

- `npx expo lint` zero errors and zero warnings; `npx tsc --noEmit` and jest green after every task.
- Never sign an amount the user did not see; never answer or act on a wallet reply that is not for the pending request.
- Dependencies through `npx expo install` (dev ones with `-- --save-dev`).
- Texts the user reads stay sentences in the app's voice (lowercase action labels on the pool screen, as now).

## Triage (no code change — rulings)

| Ledger item | Ruling |
|---|---|
| T1 app.json `reactCompiler`/`typedRoutes` kept | Keep: the brief asked for them; lint/jest are clean with them. |
| T2 tarball dependency outside the repo | Keep until gnonative PR #233 is released to npm; then a version range. |
| T2 hand-made patch index hashes; smoke screen " / " | Harmless for patch-package; the smoke screen is gone. |
| T4 `b14022d` alone fails typecheck | History; HEAD typechecks. |
| T5 `setupFilesAfterEnv` vs `setupFiles` | Equivalent for `jest.mock`. |
| T9 narrowed grant becomes active silently | Already fixed: the active card warns on `missingPaths` and shows the granted budget/expiry. |
| T11 heartbeat double interval / starts when not active | Already fixed (`start()` stops first; starts only when `active`). |
| T13 `canCancel` ignores caps | All five realms have `Cancel` (checked in `devchain/`). |
| T13 shot steps 25/50/100 bps hard-coded | They mirror the site's choices, not a realm constant. |
| T13 `useMemo` deps | Fixed by the lint pass (`0fa78eb`). |
| T16 package.json reformat noise | History. |
| Final: unknown-outcome regex also matches a pre-broadcast decode error | gnonative streams every error the same way; no reliable signal. The screen reloads after each transaction, which shows the truth. |

## Review Focus

1. A boop whose price moved since the screen loaded → nothing is signed; the new price is shown (Task 11 test on `checkFresh`).
2. A wallet reply for the pending `state` but another account or chain → the request fails with a clear error, no endless "waiting for the chain" (Task 8 test).
3. A cancelled or refused request → its session key is deleted from the keybase; the active key never is (Task 8 test).
4. Session store storage that throws on read → `restore()` and `onReply()` still run (Task 8 test).
5. A desktop renewal whose revoke failed → the app says the previous session is still live and shows the command to revoke it (Task 8 test).

---

### Task 1: dependencies and template leftovers
**Files:** `package.json`, `package-lock.json`, `.gitignore`, `assets/images/*`.
- [ ] Move `jest`, `jest-expo`, `@types/jest`, `@types/node` to devDependencies: `npx expo install jest jest-expo @types/jest @types/node -- --save-dev` (check `git diff package.json`: same versions, moved).
- [ ] Remove the stray `example` line from `.gitignore`; `git rm` the unused template images (`expo-badge*.png`, `expo-logo.png`, `logo-glow.png`, `react-logo*.png`, `tutorial-web.png`, `tabIcons/`) — none is referenced (`grep` in `src`, `app.json`).
- [ ] jest, tsc, lint green. Commit `chore: dev dependencies where they belong; template leftovers removed`.

### Task 2: game math and its gaps
**Files:** `src/game/pricing.ts`, `src/game/shots.ts`, `src/utils/gnot.ts`; tests `src/game/*.test.ts`, `src/utils/gnot.test.ts`, new `src/utils/address.test.ts`, `src/utils/flag.test.ts`.
- [ ] Tests first: `clockFor(3600, 1000, 0)` and `(…, -5)` → `3600` (no boost); `shotPause` with `liveFloor: 4000` → "…slid under 40% …", with 2500 → "…under a quarter…"; `toUgnot('9007199254.740993')` throws "too large"; `gnot(-1500000)` → `-1.5 GNOT`; `shotFor` v3 = `ceil(bps·min(pot,1e7)/8000)`; `takeFor` with `bids: 0` adds 30 % of the bid; `gasFor('Bid')` without a pool → `{3e7, 3e4}`; `isAddress`/`shortAddr` cases (valid, upper case, 39 chars, empty); `COUNTRY_CODES` contains `FR`, `US`, `JP` and every entry matches `/^[A-Z]{2}$/`.
- [ ] `clockFor`: `if (sent <= 0) return window;`. `shotPause`: `const floor = info.liveFloor || 2500; … slid under ${floor === 2500 ? 'a quarter' : `${floor / 100}%`}`. `toUgnot`: `if (!Number.isSafeInteger(n)) throw new Error('amount too large')`.
- [ ] RED then GREEN; commit `fix(game): guard clockFor, name the live floor, refuse unsafe amounts; tests for the gaps`.

### Task 3: parser
**Files:** `src/chain/parse.ts`, `src/chain/parse.test.ts`.
- [ ] Tests: `\U00110000` → throws "unreadable answer"; `\x4` (malformed) and a trailing backslash → JSON error, not a crash in the loop; a realm answer with one pool `"oops"` and one valid → only the valid pool.
- [ ] `\U` above `0x10FFFF` throws `Error('escape \\U… is not a Unicode code point')`; `parseRealm` keeps pools whose `id` is a number (`arr(o.pools).filter((p) => typeof p.id === 'number')`).
- [ ] Commit `fix(parse): refuse an impossible \\U escape; one malformed pool no longer poisons the list`.

### Task 4: chain client and error classes
**Files:** `src/chain/errors.ts`, `src/chain/game-client.ts`; tests.
- [ ] Tests: a message "pool is closed (connection timed out)" → `realm`; `bid`, `createPool`, `withdraw` on a session for another chain → `wrong-chain` (the claim case exists); `pool()` v1 missing id → `ChainError` kind `other`; an empty result stream → `ChainError` kind `unknown-outcome`.
- [ ] `classifyError`: session/funds/unknown-outcome rules, then `REALM_TEXT`, then the network rule. `pool()` throws `new ChainError('other', 'no pool v… on this network')`. `exec`: `if (!last) throw new ChainError('unknown-outcome', 'the node returned no result for the transaction')`.
- [ ] Commit `fix(chain): realm text beats a network word; missing pools and empty results are classified`.

### Task 5: settings store and screen
**Files:** `src/state/settings.ts`, `src/screens/settings.tsx`; test `src/state/settings.test.ts`.
- [ ] Tests: `setNetwork('', 'http://x')` and `setNetwork('dev', 'nope')` leave the network unchanged; a store persisted to memory storage and recreated on it reads the same network, flag and ref (round trip).
- [ ] `setNetwork` returns early unless `chainId.trim()` and `validateRemote(remote) === null`. Settings screen: when the saved values change and the form is not dirty, the fields follow (`useEffect` on `s.chainId/s.remote/s.offchainUrl`); the warning reads "…it does not sign on {saved}" for the saved network and "…once saved, it will not sign on {draft}" for a draft.
- [ ] Commit `fix(settings): the store refuses an empty network; the form follows saved changes`.

### Task 6: GnoConnect links
**Files:** `src/session/gnoconnect.ts`; test `src/session/gnoconnect.test.ts`.
- [ ] Tests: canonical order by code point (`'\u{1F600}'` after `''`); a C1 control (`\u0085`) and DEL in a key → throws; `parseReplyURL('bubblerumble://session-callback?status=success&state=a#status=error')` → `success` (query only for a custom scheme), the https form reads the fragment; `splitLink('nope')` path → `buildSessionLink`/`canonicalPayload` throw "not a link"; `buildSessionLink` throws on `old === pubkey`, 0 or 9 `allow` on a grant, `state` > 256, `signer` with `disconnect`… (only what the protocol says); `signLink` with `signOld` → the link ends with `&sig=<a>&oldsig=<b>` exactly; a 64-byte signature round-trips through `base64url`.
- [ ] Implement each; protocol limits copied from `gnoconnect-session.md`.
- [ ] Commit `fix(gnoconnect): code-point order, C1 controls, replies read where the wallet writes, links within the protocol's limits`.

### Task 7: desktop fallback and polling
**Files:** `src/session/fallback.ts`, `src/session/status.ts`; tests.
- [ ] Tests: `createCommand` without overrides contains `-gas-fee 10000ugnot -gas-wanted 2000000`; `ctx.gasFee`/`ctx.gasWanted` override them; `pollSession` with a malformed master rejects at once.
- [ ] `CommandContext` gains `gasFee?`/`gasWanted?`; defaults `10000ugnot` / `2000000` (mainnet: 1 ugnot per 1000 gas — 5× headroom; the old `1000000ugnot` paid 1 GNOT per command). `pollSession` decodes both addresses before its loop.
- [ ] Commit `fix(session): the desktop command pays a sane fee; polling refuses a malformed address`.

### Task 8: session store
**Files:** `src/session/store.ts`, `src/chain/api.ts` (`deleteAccount`), `src/chain/fake-api.ts`, `src/screens/session/grant.ts`, `src/screens/session/index.tsx`; tests `src/session/store.test.ts`, `src/screens/session/*.test.ts`.
- [ ] Tests (each RED first): (a) cancel, wallet error and a failed `begin` delete the pending key (`deleteAccount` called with its name), never the active one; (b) a reply whose `address` differs from the known master (replace/revoke) or whose `chainid` differs → phase `error` with a sentence; (c) `cancel()` while `begin()` awaits → no link opened, no pending; a second `begin` right after the first's `send` started is ignored; `starting` released once pending is set even if `openURL` never settles; (d) `waitForChain` on another chain aborts the running poll first; test `randomHex` stub returns `2n` hex chars; (e) `restore()` ignores a pending that was replaced during its awaits (direct test); (f) after a replace, the old session still on chain → `previous` set, and the session screen offers its revoke command; (g) storage whose `getItem` throws → `onReply` and `restore` still run; (h) `errorActions(KEY_LOST_ERROR, true)` → forget and retry, no back.
- [ ] Implement: `ChainApi.deleteAccount(nameOrBech32, password, skipPassword)`; a private `drop(key)` after cancel / wallet error / failure (`skipPassword: true`, errors ignored); `onReply` compares `r.address` (when present, non-create) and `r.chainid` (when present) with the pending; a generation counter bumped by `cancel()`/`forget()`, checked before `send`; `starting = false` right after `set({ pending })`; abort the poll before the chain check; `previous?: ActiveSession` persisted, set by `waitForChain` for `replace` when `querySession(old)` is not null, cleared by `dismissPrevious()`; hydration settled flag from `onRehydrateStorage` (`ready.hasHydrated/onFinishHydration`), used by `onReply` and by `app-services`.
- [ ] Commit `fix(session): drop abandoned keys, check who answered, cancel means cancel, survive a broken storage, say when the old session lingers`.

### Task 9: off-chain client
**Files:** `src/offchain/http.ts`; test `src/offchain/http.test.ts`.
- [ ] Tests: two concurrent `browserId` calls on an empty store → same id, one write; a `bid()` that never resolves → `OffchainError(0, …timed out…)` after `timeoutMs`.
- [ ] `browserId` memoised per store while in flight (as `keybasePassword`); `request` races `d.bid()` with the abort signal.
- [ ] Commit `fix(offchain): one browser id on first launch; the timeout covers it`.

### Task 10: pools list
**Files:** `src/hooks/use-now.ts`, `src/screens/pools/index.tsx`.
- [ ] `useNow` shares one ticker per interval across all users (module-level map interval → listeners, started on first subscriber, stopped on last). Pools screen uses `useNow(1000)` (a closed pool leaves Live within a second; one timer for all rows).
- [ ] Footer: `teams` `null` on failure → "Teams could not be loaded."; empty sections show "No live pools." / "No closed pools yet."; before the first answer "Loading pools…".
- [ ] Commit `fix(pools): one clock for every countdown; empty, loading and failed states say so`.

### Task 11: pool screen
**Files:** `src/screens/pool/index.tsx`, `boop-panel.tsx`, `sections.tsx`, new `boop-quote.ts` + test, `src/app/pool/[key].tsx`.
- [ ] `boopQuote(pool, realm, me, hasRef, boostIdx, shotBps)` → `{ bid, shot, odds, gas, clock, total, pause }` (moved from `BoopPanel`), tested (v3 no shots, v5 with/without realm, boost 10, total = bid + shot + fee). `checkFresh(shown, fresh)` → `null` or a sentence when `nextPrice`, `over` or `cancelled` changed, tested.
- [ ] Before a boop: fetch the pool, `checkFresh`; on a change, show the new pool and the sentence, sign nothing.
- [ ] Pre-flight in the live card: session on another chain → "Your session is for X. Switch back in Settings, or get a session for Y →" (link to `/session`) instead of the panel; budget left (`remaining(status)`) below the boop total → a warning with the refill time.
- [ ] Realm kept on a transient failure (`.catch(() => previous)`); v4+ without realm info → "loading shot prices…"; poll errors on their own line, cleared by the next good load; the flag follows `defaultFlag` until the user edits it; flags ignored on pools without flags (button and choice); "revealed a few blocks after your boop"; remove unused `SectionGap`; the route renders `<PoolScreen key={key} …>` so another pool starts clean.
- [ ] Commit `fix(pool): never sign a stale price; say before tapping when the session cannot pay or is elsewhere; steadier shot info`.

### Task 12: create screen
**Files:** `src/screens/create-pool/index.tsx`, `form.ts`, `form.test.ts`.
- [ ] Tests: seed with 7 decimals → error; name with `\u0007` → error; window `30d` ok, `31d` error; base `1000000` ok, `1000000.000001` error.
- [ ] Functional setter (`setV((prev) => …)`); `createTxRunner` instead of the hand-made in-flight ref; after success find the new pool (v5, creator = session master, same name, highest id) and `router.replace('/pool/<key>')`, else back to the list; leaving uses `router.canGoBack() ? router.back() : router.replace('/')`.
- [ ] Commit `fix(create): one transaction at a time via the runner; land on the new pool; never strand a deep link`.

### Task 13: session screen
**Files:** `src/screens/session/grant.ts`, `grant-form.tsx`, `earnings.tsx`, `index.tsx`; test `grant.test.ts`.
- [ ] Tests: days `1e1`, `1.5`, `0`, `1461` → errors; `1460` ok; the worst case of 5 GNOT/h over 30 days = 3600 GNOT (`worstCase(grant)`).
- [ ] Days must match `/^\d+$/`; the form prints `grant.expires / 86400` and `worstCase`; renew starts from the current session (`initial` from `status`: `spendLimit`, remaining days rounded up); earnings list versions that failed to load ("Could not load v4 earnings."); Revoke asks for confirmation (`Alert.alert` with Cancel / Revoke).
- [ ] Commit `fix(session-screen): strict days, renew from the current grant, failed earnings shown, revoke confirmed`.

### Task 14: e2e harness
**Files:** `scripts/e2e.sh`, `e2e/session-game.e2e.test.ts`.
- [ ] Refuse to start when 46657/46660 are taken (`lsof -iTCP:<port> -sTCP:LISTEN`) or another run holds `$E/e2e.lock` (`mkdir` lock, removed by the trap); `go mod tidy` output to `$E/gomod.log`, printed on failure; the budget test also checks `remaining(status) < price` after the refusal.
- [ ] `npm run e2e` green. Commit `fix(e2e): refuse busy ports and concurrent runs; keep go mod errors; corroborate the budget refusal`.

### Task 15: verify, record
- [ ] iOS simulator against gnodev: pool screen (stale price refused, other-chain CTA, budget warning), create → lands on the new pool, session renew from current grant, revoke confirmation, settings form follows a preset change.
- [ ] Spec §9 (P3-M1 minors settled), ledgers, memory.
