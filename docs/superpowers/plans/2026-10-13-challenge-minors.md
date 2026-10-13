# Challenge minors (GnoConnect challenge + Adena) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the 16 minors deferred by the final reviews of the GnoConnect challenge work and of Adena's `connect({challenge})` (ledgers `.superpowers/sdd/2026-10-12-gnoconnect-challenge/` and `.superpowers/sdd/2026-10-13-adena-connect-challenge/`), plus the app's misleading `signer_unavailable` text noted there.

**Architecture:** Small fixes in four repos, each with a test that fails first: gnokey-mobile (iOS, Android), Adena's in-page provider, the app, the in-page bench. No new feature, no protocol change.

**Tech Stack:** Swift/XCTest (`make test.ios device=<udid>`), Kotlin/JUnit (`make test.android`), TypeScript/Jest (Adena `npx jest src/inject`, app `npm test`), Playwright bench (`prototypes/inpage-sessions/bench`).

**Spec:** `docs/superpowers/specs/2026-10-12-gnoconnect-challenge-design.md` (§6: no paired computer, or the user gives up → `cancelled`; a computer that does not announce `data` or fails → `signer_unavailable`), `docs/superpowers/specs/2026-10-13-adena-connect-challenge-design.md`; the standards `~/gno-external-wallets/docs/resources/gnoconnect.md` (#5970) and `~/gno-inpage-wallets/docs/resources/gnoconnect.md` (#6016: "Only a genuine failure rejects the promise").

## Global Constraints

- Repos and branches: `~/gnokey-mobile` `feat/send-to-computer`, `~/adena-wallet` `feat/gnoconnect-in-page`, `~/bubblerumble` `main`. All pushed branches stay local until the user says to push.
- The wallet is dapp-agnostic: no dapp name in gnokey-mobile or Adena code, tests or comments (`exampledapp://`, `example.com`).
- Every fix has a test that fails first, except where a ruling says why not (view-only changes, code no JVM test can reach).
- Done = each repo's suites green, lint/tsc clean where the repo has them.

## Triage

| # | Minor (ledger) | Repo | Fix | Test |
|---|---|---|---|---|
| C1 | iOS swipe-to-dismiss of the consent sheet answers `cancelled` after a computer failure | gnokey-mobile iOS | the consent view publishes its decline code to `AppModel.connectDeclineCode`; the sheet's swipe calls `dismissConnect()` = `cancelConnect(code: connectDeclineCode)` | XCTest on `dismissConnect` through an `openURL` seam |
| C2 | `declineCode` maps every failure to `signer_unavailable`, wider than §6 | gnokey-mobile iOS+Android | `failed(code)`: `pair_unsupported`, `pair_no_offline`, `pair_lost` → `signer_unavailable` (the computer was reached and could not or did not sign); `pair_code`, `pair_wrong_code`, `network`, anything else (no computer reached) → `cancelled` | declineCode tests on both platforms |
| — | the app's `signer_unavailable` text gives one cause only | app | name both causes: the computer could not sign (gnokey-pair + gnokey with sign-data), or the wallet does not hold the identity | store test on the words |
| C3 | iOS keeps one parked link; a failed `start()` never answers it | gnokey-mobile iOS | `parkedLinks: [URL]`, replayed in order; a failed `start()` answers each parked link `signer_unavailable` (the wallet cannot sign: it did not start) | XCTest: two parked links kept; failed start answers them (seam) |
| C4 | the I3 test checks the parking, not the replay by `start()` | gnokey-mobile iOS | test `start()` replaying a parked connect (if the bridge initialises under XCTest; else ruling) | XCTest |
| C5 | Android cold-launch pinned connect races the startup `activate` | gnokey-mobile Android | `activate` keeps its session read only if the account is still the selected one | ruling: AppViewModel needs an Application, not in JVM tests — emulator check |
| C6 | I1 wiring (`handleConnect`/`approveConnect`) untested beyond the pure rules | gnokey-mobile iOS | XCTest: a pinned connect the wallet does not hold is answered `signer_unavailable` with no sheet; `approveConnect(proof:)` for another identity is refused | XCTest via the seam (Android: same ruling as C5) |
| C7 | in-page doc: pin latitude vs "never a session key"; `proof.signed` is an object | gno-inpage-wallets | already written by #6016 `93521c302` (after that review): "With a `challenge` there is no such latitude…", "In the browser `proof.signed` is the document as an object; the producer rebuilds the canonical bytes…" | ruling, no change |
| C8 | the I4 test covers the first open only | app | test the param cleared and a second proof opening the sheet again | jest |
| A1 | "a Ledger account" in the no-key message and test name | Adena | "the wallet answered without a key or signature" | spec name/message |
| A2 | a non-string `signer` crashes (`.toLowerCase`) | Adena | `signer` not a string → `invalid_request` before any window | spec |
| A3 | pin compared case-insensitively on the challenge path, exactly in `assertSigner` | Adena | `assertSigner` compares as addresses (case-insensitive), as the challenge path and gnokey-mobile do | spec on `sendTx` with an upper-case pin |
| A4 | an empty account address resolves `Rejected no_signer` where the standard throws | Adena | `connectWithChallenge` rethrows `no_signer` (a genuine failure rejects the promise) | spec |
| A5 | gpub test round-trips instead of pinning test1's gpub | Adena | pin `gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq0skzdkmzu0r9h6gny6eg8c9dc303xrrudee6z4he4y7cs5rnjwmyf40yaj` | spec (mutation check) |
| A6 | a lone UTF-16 surrogate passes validation | Adena | `invalid_request` for an unpaired surrogate | spec |
| A7 | bench test 9 does not assert which window opened | bubblerumble bench | `run` records the windows' routes; test 9 asserts `approve-sign-arbitrary` | bench run |
| A8 | fork comments in `session-request.spec.ts` name the dapp | Adena | neutral wording | grep |

## Tasks

- [ ] **Task 1 — app (C8, signer_unavailable words), commit on `main`.**
- [ ] **Task 2 — Adena (A1–A6, A8), commit on `feat/gnoconnect-in-page`; `npx jest src/inject`, eslint on touched files.**
- [ ] **Task 3 — bench (A7), commit on `main`; full bench against gnodev + the fake server.**
- [ ] **Task 4 — gnokey-mobile iOS (C1–C4, C6), Android (C2, C5); `make test.ios`, `make test.android`; one commit per platform concern.**
- [ ] **Task 5 — device checks where a ruling replaced a test (C5 on the emulator; C1 swipe on the simulator if a computer failure can be produced), ledger, §9, memory.**
