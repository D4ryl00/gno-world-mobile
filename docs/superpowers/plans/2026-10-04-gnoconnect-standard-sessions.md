# GnoConnect standard update: sessions through `connect` and `disconnect` (§7 step 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `~/bubblerumble/gnoconnect-session.md`, corrected by what P2 and P3 taught, into the standard `docs/resources/gnoconnect.md`: in `~/gno-external-wallets` (`feat/gnoconnect-external-wallets`, PR #5970), then carried into `~/gno-inpage-wallets` (`feat/gnoconnect-in-page-wallets`, PR #6016) by rebasing it.

**Architecture:** Documentation only. One commit in external adds the sessions section under "Launch Links" and touches the host table, `connect`, the callback URL rules and Known Implementations. Inpage (stacked on external by rebase, 60 commits) is rebased onto it; its doc conflicts are resolved, then one commit adapts the text to what only inpage has ("The `signer` pin", the in-page provider).

**Tech Stack:** Markdown; `make -C docs lint` (gno's doc linter, links included); `go build`/`go test` of gnoweb after the rebase.

**Spec:** `docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` §7 step 6, §4; the draft `gnoconnect-session.md`.

## Why external first (the spec leaves the choice to the state of the branches)

- The draft is launch-link only (`connect` and `disconnect` are launch-link hosts), which is PR #5970's subject.
- Both PRs target `master` and #6016 contains #5970: an external commit reaches inpage by the rebase the branches already use.
- Cost: external has no "The `signer` pin" section (inpage added it), so the external text points to `signer` on `sendtx`; inpage then restores the cross-reference. Inpage touches the `connect` and `sendtx` parts of the doc in 4 hunks: the rebase conflicts there.

## Corrections the implementation taught (applied while moving the text)

1. `connect` (identity) requires `chainid` in the standard; the draft's "optional, as today" was wrong → required in every mode.
2. gnokey's `-expires-at` takes a duration (`90000s`, `7d`) counted when the command runs; the desktop handoff shows `-expires-at <expires>s`, not a timestamp.
3. A wallet judges expiry and composes `ExpiresAt` against the chain's time (the latest block's, never later than its own clock); a session that would already be over when it lands is refused before the user is asked.
4. Scope hints: a hinted `expires` counts from the request's arrival (a session created for exactly that lifetime covers it, with a small slack); a session without a spend limit covers no hint (it cannot pay its gas).
5. A request refused and delivered again is answered once; a repeat of an accepted `(pubkey, state)` is dropped without an answer.
6. Callback answers: producers percent-decode names as well as values (a wallet may send `expires%5Fat`); they read the fragment for an `http(s)` callback and the query otherwise; the response-key list gains `expires_at`, `allow`, `spend`, `period`, `revoked`; `allow` repeats, so a producer's own callback MUST NOT carry `allow`.
7. Proof payload: "bytewise UTF-8" is code-point order (JavaScript's default string comparison is UTF-16 and differs above U+FFFF); control characters are C0, DEL and C1 (as Go's `unicode.IsControl`).
8. Network: declining a switch answers `network_declined` only to the requests that named that other chain; a request whose chain the wallet left meanwhile is resolved again (switch back, or `network_declined`) before it is planned.
9. Callbacks may only open while the wallet is in front (Android blocks activity starts from the background): a wallet watching the chain in the background answers when the user comes back.
10. Fees: the identity pays the whole `-gas-fee` whatever the gas used; a wallet or producer derives it from the chain's minimum gas price (`auth/gasprice`) times `-gas-wanted`, with headroom — not a fixed large fee.
11. Drop the unverifiable "gnonative before 5.0.1" example; drop the draft status banner, the verification table (it stays in the draft and the PR description) and the wallet-design open questions; keep "not covered: in-page transport, attenuated sub-sessions".
12. The example uses generic names (`gno.land/r/demo/game`, `game.example`), not a real producer.
13. Known Implementations: Gnokey Mobile lists `connect` with a key, `disconnect` and scope hints (iOS, Android); Bubble Rumble mobile as a producer holding its own session key.

## Review Focus

1. Every MUST/SHOULD of the draft survives the move, or its removal is one of the corrections above.
2. No section of external refers to a heading that does not exist there (`The signer pin` is inpage-only).
3. After the rebase, inpage's `connect` section keeps both its own changes and the sessions additions.
4. The doc linter and gnoweb's build/tests stay green on both branches.
5. Nothing is pushed without the user's go-ahead (a force-push of #6016's branch rewrites a shared history).

---

### Task 1: integrate into external
**Files:** `~/gno-external-wallets/docs/resources/gnoconnect.md`.
- [ ] `disconnect` row in the Launch Links host table; `connect`: `chainid` required in every mode, the session parameters pointer, the new error codes, `features` gains `sessions`.
- [ ] New `### Sessions: connect with a key, and disconnect` after `connect` (the draft's sections one level down), with corrections 1–12.
- [ ] Callback URL rules: response-key list, `allow` rule, decode names, read location; Known Implementations (13).
- [ ] `make -C docs lint` green. Commit `docs(gnoconnect): sessions through connect and disconnect`.

### Task 2: carry into inpage
- [ ] `git rebase` inpage onto the new external head; resolve `gnoconnect.md` conflicts keeping both sides.
- [ ] One commit: cross-references to "The `signer` pin"; in its "session limits" paragraph, point to the new section; in-page provider note (sessions are launch-link only for now).
- [ ] `make -C docs lint`; `go build ./gno.land/pkg/gnoweb/...` and its tests green.

### Task 3: record and push
- [ ] `gnoconnect-session.md` gets a banner pointing to the standard; spec §9 and §7; memory.
- [ ] Ask the user, then push external (fast-forward) and inpage (`--force-with-lease`).
