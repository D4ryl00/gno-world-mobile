# GnoConnect sessions in the browser (in-page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web dapp gets, renews and revokes its own session key through an in-page wallet with the same verbs, signed object and rules as launch links — prototyped in Adena (your fork, branch `feat/gnoconnect-in-page`), checked by a test page and a Playwright bench on gnodev, then written into the standard (#5970, #6016). Plus: `disconnect` without a key on launch links (gnokey-mobile, #138).

**Architecture:** One canonical-payload construction everywhere (Go in gnokey-mobile, TS in Bubble Rumble, now JS for the page and TS for Adena), each pinned by the same Go reference vector. Adena's request path is unchanged in shape: provider → executor (event message) → background handler (validation and proof, before any window) → `createPopup(RoutePath.ApproveGnoConnectSession)` → popup page (review, compose, sign with the identity key, broadcast, wait for the chain) → response. The test page is static; the bench drives Chromium with the built extension.

**Tech Stack:** Go + Swift/XCTest + Kotlin/JUnit (gnokey-mobile); TypeScript, React, jest, webpack, `elliptic`, WebCrypto (Adena, `packages/adena-extension`); plain ES modules + Node test runner (page); Playwright + Chromium (bench); gnodev (`npm run gnodev` in `~/bubblerumble`).

**Spec:** `docs/superpowers/specs/2026-10-04-gnoconnect-inpage-sessions-design.md`; the standard text in `~/gno-inpage-wallets/docs/resources/gnoconnect.md` ("Sessions: `connect` with a key, and `disconnect`", "The `signer` pin", "In-Page Wallets").

## Global Constraints

- Parity first: in-page fields, validation, payload, errors and results are the launch link's, except the two transport reasons in the spec (no `callback` line in the payload; the origin replaces the callback host in the review).
- Payload: `gnoconnect-session-v1`, `host=<connect|disconnect>`, then `key=value` lines sorted by key then value in code-point order; control characters (C0, DEL, C1) and `=` in names refused; in-page: numbers in decimal, `allow` one line per entry, absent fields omitted, never `callback`.
- Keys: in-page wallets accept secp256k1 (ECDSA over SHA-256, 64-byte `R‖S`, low-S) and Ed25519 (RFC 8032) proofs and session keys; `sig`/`oldsig` base64url without padding.
- `iat` window: at most 10 minutes old, at most 1 minute ahead; `(pubkey, state)` remembered 10 minutes.
- Adena: work on `feat/gnoconnect-in-page` directly; no upstream contribution; baseline `yarn test:ci` has 32 pre-existing failures in `src/migrates/**` (libsodium under jsdom) — no new failure allowed.
- Nothing is pushed without the user's go-ahead.

## Review Focus

1. A keyless `disconnect` link reaching a wallet: answered `success` without `revoked`, nothing revoked, no screen (Task 1 tests).
2. A page whose wallet ignores `pubkey` on `connect`, or `req` on `disconnect`: the page never counts a session granted or revoked unless `session` / `revoked` is its key's address (Task 7 page logic, Task 8 scenario 7).
3. A proof made for `connect` replayed as `disconnect`, or a link proof replayed in-page (it has a `callback` line): refused `invalid_proof` (Task 3 tests).
4. An Ed25519 session key created by Adena is revocable and its address is what the chain reports (Task 4 test + Task 8 scenarios 3–4 with Ed25519).
5. `disconnect(req)` whose revocation the user declines: `Rejected`, and the origin approval is withdrawn anyway (Task 5 handshake test + Task 8).

---

### Task 1: gnokey-mobile — `disconnect` without a key (#138)

**Files:** `ios/GnokeyMobile/Core/DeepLink.swift`, `ios/GnokeyMobile/Core/AppModel.swift`, `ios/GnokeyMobileTests/DeepLinkTests.swift`; `android/app/src/main/java/land/gno/gnokey/DeepLink.kt`, `AppViewModel.kt`, `android/app/src/test/java/land/gno/gnokey/DeepLinkTest.kt`.

**Interfaces:** Produces `DeepLink.isKeylessDisconnect(url)` (iOS) / `DeepLink.isKeylessDisconnect(scheme, host, params)` (Android) and `DeepLink.keylessDisconnectReply(callback, state) -> URL?` / `Uri?`.

- [ ] **Step 1 — tests:** `land.gno.gnokey://disconnect?callback=myapp%3A%2F%2Fcb&state=s` is a keyless disconnect, not a session request; with `pubkey=` it is a session request; `Disconnect` (case) too; the reply is `myapp://cb?status=success&state=s`; no callback → `nil`/`null`; an unsafe callback (`javascript:`) → `nil`/`null`.
- [ ] **Step 2 — RED** (`make test.ios device=<udid>`, `make test.android`).
- [ ] **Step 3 — implement:** `isSessionRequest` keeps `disconnect` only when `pubkey` is present; `isKeylessDisconnect` is `disconnect` without `pubkey`; the reply uses `responseURL`/`responseUri` with `[("status","success")] + state`. In each app's link router, a keyless disconnect opens its reply (if any) at once — no bridge call, no screen (the wallet keeps nothing per producer today). Comment: unauthenticated, so it may only remove state, and must ask before any on-chain revocation should the wallet ever keep some.
- [ ] **Step 4 — GREEN**; commit `feat: answer a disconnect without a key — nothing is kept per producer, so nothing to end`.

### Task 2: the page's request library

**Files:** Create `prototypes/inpage-sessions/session-request.js`, `prototypes/inpage-sessions/session-request.test.mjs`, `prototypes/inpage-sessions/package.json` (`"type": "module"`, `"test": "node --test"`).

**Interfaces:** Produces
```js
export function canonicalPayload(host, fields)            // string; fields: {pubkey, old?, allow?: string[], spend?, period?, expires?, chainid, signer?, state, iat, callback?}
export function gpubFromKey(type, raw)                      // type 'ed25519' (32 bytes) | 'secp256k1' (33 bytes compressed) → 'gpub1…'
export function addressFromKey(type, raw)                   // 'g1…' (ed25519: sha256(raw)[0:20]; secp256k1: ripemd160(sha256(raw)))
export async function signRequest(host, fields, signer)     // signer: async (bytes) => Uint8Array(64); returns {...fields, sig}
export const base64url = (bytes) => …
```
- [ ] **Step 1 — tests:** the Go reference vector (`~/bubblerumble/src/session/gnoconnect.test.ts` `GO_LINK`/`GO_PAYLOAD`) rebuilt from fields, with `callback` → identical; without `callback` → identical minus that line; code-point order (U+1F600 after U+E000); C1 control → throws; a known Ed25519 key (WebCrypto, Node 22) → `gpub1…` and `g1…` equal to what `gnokey` reports for the same key (`gnokey add … --ed25519`? if gnokey cannot import raw Ed25519, compare with tm2's Go `ed25519.PubKey.Address()` via a 10-line `go run` in the scratchpad); a secp256k1 vector from `~/bubblerumble/src/utils/bech32.test.ts`.
- [ ] **Step 2 — RED, Step 3 — implement** (bech32, ripemd160 and sha256 inline or from Node's `crypto` behind a tiny shim the page replaces with WebCrypto/`@noble/hashes` from a CDN-free vendored copy).
- [ ] **Step 4 — GREEN**; commit (in `~/bubblerumble`) `feat(prototype): the in-page session request — payload, keys, signature`.

### Task 3: Adena — parse, validate and verify a session request

**Files:** Create `packages/adena-extension/src/inject/gnoconnect/session-request.ts` and `session-request.spec.ts`.

**Interfaces:** Produces
```ts
export type SessionHost = 'connect' | 'disconnect';
export interface SessionRequestFields { pubkey: string; old?: string; allow?: string[]; spend?: string; period?: number;
  expires?: number; chainid: string; signer?: string; state: string; iat: number; sig: string; oldsig?: string }
export interface DecodedKey { type: 'ed25519' | 'secp256k1'; key: Uint8Array; address: string }
export function decodeGpub(gpub: string): DecodedKey;                         // throws invalid_request
export function canonicalPayload(host: SessionHost, f: SessionRequestFields): string;
export function validateSessionRequest(host: SessionHost, input: unknown): SessionRequestFields; // throws GnoConnectError('invalid_request')
export async function verifyProof(host: SessionHost, f: SessionRequestFields): Promise<void>;   // throws 'invalid_proof'
export function checkFreshness(iat: number, nowSec: number): void;                               // throws 'stale_request'
```
- [ ] **Step 1 — tests:** payload equals the Go vector minus `callback`; validation per the parameters table (pubkey required on `connect` with key; `old ≠ pubkey`, `old` needs `signer` and `oldsig`; 1–8 `allow` in chain grammar; `period` 0–2592000; `expires` 1–126144000; `state` ≤ 256; `disconnect` with key needs `chainid`, `signer`, `state`, `iat`, `sig`); proofs: an Ed25519 and a secp256k1 request signed in the test verify, a tampered field fails, a `connect` proof checked as `disconnect` fails, a proof signed over the launch-link payload (with its `callback` line) fails in-page; `iat` 11 minutes old / 2 minutes ahead → `stale_request`.
- [ ] **Step 2 — RED** (`npx jest --ci src/inject/gnoconnect/session-request`), **Step 3 — implement** (secp256k1 with `elliptic` on `sha256(payload)`, low-S checked; Ed25519 with `crypto.subtle.importKey('raw', key, {name:'Ed25519'}, false, ['verify'])`), **Step 4 — GREEN**; commit `feat(gnoconnect): read, validate and verify a session request`.

### Task 4: Adena — Ed25519 session keys in `MsgCreateSession` / `MsgRevokeSession`

**Files:** Modify `packages/adena-extension/src/services/transaction/message/auth/auth.ts` (`wrapSessionPubKey`, the two `createMessageOf…` builders); test `auth.spec.ts` (create if absent).

- [ ] **Step 1 — tests:** a 32-byte key wraps as `type_url: '/tm.PubKeyEd25519'` with value `0x0a 0x20 ‖ key`; a 33-byte key still wraps as `/tm.PubKeySecp256k1` (unchanged bytes); a 65-byte uncompressed key is still compressed first.
- [ ] **Step 2 — RED, Step 3 — implement:** the builders take `sessionPublicKey: DecodedKey | Uint8Array` (a bare `Uint8Array` keeps today's secp256k1 meaning, so existing callers are untouched). **Step 4 — GREEN**; then confirm on gnodev with `gnokey query auth/accounts/<test1>/session/<addr>` after Task 8's first Ed25519 grant (ledger the result). Commit `feat(session): Ed25519 session keys`.

### Task 5: Adena — provider, executor and background for `connect(opts)` and `disconnect(req?)`

**Files:** Modify `src/inject/gnoconnect/provider.ts`, `types.ts`, `errors.ts`, `response.ts`; `src/inject/executor/executor.ts` (`sessionConnect`, `sessionDisconnect`); `src/inject/message/message-handler.ts` (cases `GNOCONNECT_SESSION_CONNECT`, `GNOCONNECT_SESSION_DISCONNECT`); create `src/inject/message/methods/gno-connect-session.ts`; extend `handshake.spec.ts`.

**Interfaces:** Consumes Task 3. Produces message types `GNOCONNECT_SESSION_CONNECT` / `GNOCONNECT_SESSION_DISCONNECT` carrying `{ host, fields, origin }`; popup route `RoutePath.ApproveGnoConnectSession`; responses mapped to `UserResponse<GnoAccount & Partial<GnoSessionGrant>>` and `UserResponse<{ revoked?: string; hash?: string }>`.

- [ ] **Step 1 — tests (handshake, through the real provider and executor):** `connect({pubkey…})` with a bad proof → `Rejected` `invalid_proof` without any popup; `connect()` and `connect({allow…})` behave as today; `disconnect()` → approval withdrawn (establish removed) and the `disconnect` event fires, no popup; `disconnect({pubkey…})` declined in the popup → `Rejected`, approval withdrawn; a repeated `(pubkey, state)` within 10 minutes → ignored (no second popup); `features` contains `sessions`.
- [ ] **Step 2 — RED, Step 3 — implement:** the background handler validates (Task 3), verifies the proof, checks freshness and the replay memory, resolves network then identity (`signer`; an active session account → `signer_unavailable`), looks up the key (`getSession`): present and live → answer from the chain without popup (after the origin approval, as `connect`); expired → `session_expired`; for `connect` counts sessions (`getSessions`) → `session_limit` at 16; else `createPopup(RoutePath.ApproveGnoConnectSession, …)`. `disconnect` with key: `session_not_found` when absent. Withdraw the approval with `establishService.unEstablishBy(accountId, hostname)` after the call settles. **Step 4 — GREEN**; commit `feat(gnoconnect): connect with a key and disconnect, up to the review`.

### Task 6: Adena — the review popup and the transaction

**Files:** Create `src/pages/popup/wallet/approve-gnoconnect-session/index.tsx` (+ route registration next to `RoutePath.ApproveTransaction`); reuse `SessionDetailCard`, `NetworkFee`, `resolveSessionAdminGasInfo`, `useMasterSessions`, the signing/broadcast path of `use-revoke-session.ts`, `createMessageOfCreateSession` / `createMessageOfRevokeSession` (Task 4).

- [ ] **Step 1 — tests:** a pure `buildSessionMessages(request, onChainOld, nowSec)` (in `src/inject/gnoconnect/session-tx.ts`) → `[revoke(old) if on chain, create(pubkey, expiresAt = nowSec + expires, allow, spend, period)]`; `nowSec` is the latest block time capped by the clock; a pure `reviewModel(request)` → budget text, worst case, risky entries (`*`, bare `vm/exec`, `vm/run`, `bank/send`, `bank/multisend`), old vs new rows.
- [ ] **Step 2 — RED, Step 3 — implement** the pure parts, then the page: origin, network (chain id + endpoint), identity, allow entries with warnings, budget and worst case, expiry date, old vs new for `old`, gas; Approve → sign with the identity's key and broadcast (same path as revoke-session), wait until `getSession` shows the key (or its absence for `disconnect`), answer `GnoSessionGrant` / `{revoked, hash}`; Reject → `Rejected`. **Step 4 — GREEN**, `npx tsc --noEmit`, `npx eslint` on touched files, `yarn test:ci` (only the 32 known failures), `yarn build`; commit `feat(gnoconnect): review and grant or revoke a producer's session`.

### Task 7: the test page

**Files:** Create `prototypes/inpage-sessions/index.html`, `page.js` (uses Task 2).

- [ ] Discovery per the standard (`gno:registerWallet` / `gno:requestWallet`); key: Ed25519 via `crypto.subtle.generateKey({name:'Ed25519'}, false, ['sign'])` stored in IndexedDB (the `CryptoKey` object, never its bytes), or secp256k1 (`?key=secp256k1`, raw bytes in IndexedDB) ; buttons `grant`, `grant again`, `renew`, `disconnect with key`, `disconnect`, `plain connect`, `bad proof`, `stale`, `old=pubkey`; after each answer: show it, then read `auth/accounts/<signer>/session/<addr>` through gnodev's `abci_query` and print `on chain: yes/no, limits…`; count a grant only if `session === addressFromKey(key)`, a revocation only if `revoked` is.
- [ ] Served by `python3 -m http.server` in the folder. Commit `feat(prototype): an in-page session test page`.

### Task 8: the Playwright bench and the scenarios

**Files:** Create `prototypes/inpage-sessions/bench/package.json` (devDependency `playwright`), `bench/sessions.spec.mjs`, `bench/README.md`.

- [ ] Launch Chromium (`chromium.launchPersistentContext` with `--disable-extensions-except` / `--load-extension` = `~/adena-wallet/packages/adena-extension/dist`), onboard Adena through its UI (import `test1`'s mnemonic, password, add the custom network `dev` → `http://127.0.0.1:26657`); fallback if onboarding is not drivable: preload the extension storage (ledger the ruling).
- [ ] For `ed25519` and `secp256k1`: scenarios 1–7 of the spec §6, approving or declining Adena's popup pages as they open; assertions on the page's printed results and on the chain.
- [ ] Run against `npm run gnodev` (port 26657). Commit `test(prototype): Playwright bench for in-page sessions`.

### Task 9: the standard

**Files:** `~/gno-external-wallets/docs/resources/gnoconnect.md` (#5970), then `~/gno-inpage-wallets` rebased onto it (#6016) plus one in-page commit.

- [ ] #5970: host `disconnect` with optional `pubkey` (spec §3.1); `make lint` from `docs/` (no `gnoconnect.md` finding).
- [ ] Rebase inpage onto it (backup branch first); #6016: spec §3.2 in "In-Page Wallets" (`connect(opts)`, `disconnect(req?)`, types, rules, errors, keys: Ed25519 MUST for in-page wallets, web producers SHOULD use a non-extractable Ed25519 key), the "launch links only" note replaced, corrected by what Tasks 3–8 taught; Known Implementations: Adena (prototype, fork). Commits in both.

### Task 10: record and push

- [ ] Spec §9 of the mobile design, memory, ledger.
- [ ] Ask the user; then push gnokey-mobile (#138), `~/gno-external-wallets` (#5970), `~/gno-inpage-wallets` (#6016, `--force-with-lease`), and the Adena fork branch `feat/gnoconnect-in-page` (fork only, no upstream PR).
