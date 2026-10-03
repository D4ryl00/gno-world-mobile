# P2-M3b — the three deferred minors of P2-M3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix, on iOS and Android, the three minors deferred by P2-M3's final review (spec §9, P2-M3 « Mineurs reportés »).

**Architecture:** Three independent fixes in each app model (`ios/GnokeyMobile/Core/AppModel.swift`,
`android/app/src/main/java/land/gno/gnokey/AppViewModel.kt`) and the root views that gate the
dialogs. The rule deciding which parked request a declined switch answers is a pure static
function, unit-tested on both platforms; the two others are model state, checked by hand on the
simulator and the emulator (no UI test dependencies in either app).

**Tech Stack:** Swift / SwiftUI / XCTest (`make test.ios device=<udid>`), Kotlin / Compose / JUnit on the JVM (`make test.android`).

**Spec:** `docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` (§4, §9). Repo: `~/gnokey-mobile`, branch `feat/deeplink-tx` (PR #138).

## Global Constraints

- Both platforms behave the same; each fix lands on iOS and Android.
- No new dependency (no Compose/Robolectric/UI-test libraries).
- `network_declined` is answered only to a request that needed the switch the user declined (spec §4: declining the switch answers `network_declined`).
- A request stays pending while the wallet waits on it; nothing is answered from a state the user did not decide.

## Review Focus

1. A session request parked for the current chain, then a `sendtx` link for another chain declined → the session request is still pending and its review shows (Task 1 test: same chain → not declined).
2. A `connect` without `chainid` parked, then a declined switch → the connect is still pending (Task 1 test: empty chain → not declined).
3. A switch accepted, then the node is slow to answer → no review appears until the switch is over; a switch that fails shows its error and then the review (Task 2, manual).
4. "Create a session for this app", then Back from the builder → the next "New session" starts from the user's own entries, not the app's hints (Task 3, manual).
5. "Create a session for this app", app killed during the handoff → on relaunch the draft is the user's own (Task 3: the persisted draft is the pre-hints one).

---

### Task 1: a declined switch answers only the requests that needed it

**Files:**
- Modify: `ios/GnokeyMobile/Core/AppModel.swift` (`keepCurrentNetwork`, new static `needsSwitch`)
- Modify: `android/app/src/main/java/land/gno/gnokey/AppViewModel.kt` (`dismissPendingNetworkSwitch`, new companion `needsSwitch`)
- Test: `ios/GnokeyMobileTests/SessionFlowTests.swift`, `android/app/src/test/java/land/gno/gnokey/SessionFlowTest.kt`

**Interfaces:**
- Produces: `AppModel.needsSwitch(chainID: String, current: String) -> Bool` (iOS), `AppViewModel.needsSwitch(chainID: String, current: String): Boolean` (Android companion). True when `chainID`, trimmed, is non-empty and differs from `current`, trimmed — the same test `stageNetworkSwitch` uses to stage a switch.

- [ ] **Step 1: Write the failing tests**

iOS (`SessionFlowTests`):
```swift
    /// Declining a switch answers only the requests that asked for another
    /// chain: one for the current chain, or for none, stays pending.
    func testOnlyAnotherChainNeedsTheSwitch() {
        XCTAssertTrue(AppModel.needsSwitch(chainID: "other", current: "dev"))
        XCTAssertFalse(AppModel.needsSwitch(chainID: "dev", current: "dev"))
        XCTAssertFalse(AppModel.needsSwitch(chainID: " dev ", current: "dev"))
        XCTAssertFalse(AppModel.needsSwitch(chainID: "", current: "dev"))
    }
```
Android (`SessionFlowTest`):
```kotlin
    /** Declining a switch answers only the requests that asked for another
     *  chain: one for the current chain, or for none, stays pending. */
    @Test
    fun onlyAnotherChainNeedsTheSwitch() {
        assertTrue(AppViewModel.needsSwitch("other", "dev"))
        assertFalse(AppViewModel.needsSwitch("dev", "dev"))
        assertFalse(AppViewModel.needsSwitch(" dev ", "dev"))
        assertFalse(AppViewModel.needsSwitch("", "dev"))
    }
```

- [ ] **Step 2: Run them, expect a compile failure** (`needsSwitch` undefined): `make test.ios device=<udid>`, `make test.android`.

- [ ] **Step 3: Implement**

iOS — next to `stageNetworkSwitch`, and use it there and in `keepCurrentNetwork`:
```swift
    /// Whether a request for `chainID` needs the wallet to leave `current`: a
    /// link naming no chain, or the current one, never does.
    nonisolated static func needsSwitch(chainID: String, current: String) -> Bool {
        let requested = chainID.trimmingCharacters(in: .whitespaces)
        return !requested.isEmpty && requested != current.trimmingCharacters(in: .whitespaces)
    }
```
```swift
    func keepCurrentNetwork() {
        pendingNetworkSwitch = nil
        // The prompt may have been staged by another link (a `sendtx` for
        // another chain): a request on the current chain did not need it.
        if let request = pendingConnect, Self.needsSwitch(chainID: request.chainID, current: network.chainID) {
            pendingConnect = nil
            respondConnect(request, status: "error", code: "network_declined")
        }
        if let flow = pendingSession, Self.needsSwitch(chainID: flow.request.chainID, current: network.chainID) {
            pendingSession = nil
            respondSession(flow.request, error: "network_declined")
        }
    }
```
Android — `companion object { fun needsSwitch(chainID: String, current: String): Boolean }` with the same body, used by `stageNetworkSwitch` and guarding both branches of `dismissPendingNetworkSwitch` (`network.chainID`).

- [ ] **Step 4: Run the tests, expect PASS** on both.
- [ ] **Step 5: Commit** `fix: declining a network switch answers only the requests that needed it`.

### Task 2: a dialog parked behind an accepted switch waits for it to land

**Files:**
- Modify: `ios/GnokeyMobile/Core/AppModel.swift` (`switchNetwork(to:)`, new `switchingNetwork`), `ios/GnokeyMobile/GnokeyMobileApp.swift` (connect and session sheet gates)
- Modify: `android/app/src/main/java/land/gno/gnokey/AppViewModel.kt` (`applyPendingNetworkSwitch`, new `switchingNetwork`), `android/app/src/main/java/land/gno/gnokey/MainActivity.kt` (connect and session gates)

**Interfaces:**
- Produces: `AppModel.switchingNetwork: Bool` / `AppViewModel.switchingNetwork: Boolean` (Compose state) — true from "Switch" until `applyNetwork` returns or throws.

Why: "Switch" clears `pendingNetworkSwitch` before `applyNetwork` lands, so the review (and the connect consent) appears at once and plans against the old chain → `wrong_network` once.

- [ ] **Step 1: Implement** — iOS:
```swift
    /// True from "Switch" until the bridge is on the new network: a request
    /// parked behind the prompt is planned only once it is.
    private(set) var switchingNetwork = false

    func switchNetwork(to settings: NetworkSettings) async {
        pendingNetworkSwitch = nil
        switchingNetwork = true
        defer { switchingNetwork = false }
        do {
            _ = try await applyNetwork(settings)
        } catch { surface(error) }
    }
```
Both cleared in the same main-actor step, so no frame sees neither. In `GnokeyMobileApp.swift`, add `&& !model.switchingNetwork` to the connect sheet's and the session sheet's `get`. Note `surface` is ignored while `pendingNetworkSwitch` is set — it is nil here, so a failed switch is shown.

Android:
```kotlin
    /** True from "Switch" until the bridge is on the new network: a request
     *  parked behind the prompt is planned only once it is. */
    var switchingNetwork by mutableStateOf(false)
        private set

    fun applyPendingNetworkSwitch() = viewModelScope.launch {
        val settings = pendingNetworkSwitch ?: return@launch
        pendingNetworkSwitch = null
        switchingNetwork = true
        try {
            applyNetwork(settings)
        } catch (e: Exception) {
            surface(e)
        } finally {
            switchingNetwork = false
        }
    }
```
(`viewModelScope` runs on `Main.immediate`: both writes happen before the next frame.) In `MainActivity.kt`, add `!model.switchingNetwork` to the connect gate and the session gate.

- [ ] **Step 2: Build and run the unit tests** (`make test.ios device=<udid>`, `make test.android`): PASS, nothing else changed.
- [ ] **Step 3: Commit** `fix: a request parked behind an accepted network switch waits for it to land`.

### Task 3: an app's hints never become the user's saved draft

**Files:**
- Modify: `ios/GnokeyMobile/Core/AppModel.swift` (`createSession(forHints:)`, `cancelSessionBuild`, `pollForSession`, `saveDraft`)
- Modify: `android/app/src/main/java/land/gno/gnokey/AppViewModel.kt` (`createSessionForHints`, `cancelSessionBuild`, `pollForSession`, `saveDraft`)

**Interfaces:**
- Produces: private `draftBeforeHints: SessionDraft?` on both models; `saveDraft()` persists `draftBeforeHints ?? draft`; `endHintedBuild()` (private) puts it back and clears it.

- [ ] **Step 1: Implement** — iOS:
```swift
    /// The user's own draft while the builder holds one made from an app's
    /// hints: that one is for this session only, so it is never saved, and the
    /// next hand-made session starts from the user's entries again.
    private var draftBeforeHints: SessionDraft?

    /// Ends a build started from hints: the user's draft comes back.
    private func endHintedBuild() {
        if let saved = draftBeforeHints { draft = saved }
        draftBeforeHints = nil
    }
```
`createSession(forHints:)`: after setting the master fields, `draftBeforeHints = draft` then `draft = draft.applying(hints)`. `saveDraft()` encodes `draftBeforeHints ?? draft`. Call `endHintedBuild()` at the start of `cancelSessionBuild()` (before `activate`, which rewrites the master fields) and in `pollForSession()` once the account is recorded (the restored draft has the same master fields). Android: the same, with `draft = draft.copy(...)` and `prefs`.

- [ ] **Step 2: Build and run the unit tests**: PASS.
- [ ] **Step 3: Commit** `fix: an app's scope hints never become the saved session draft`.

### Task 4: verify on devices, push, record

- [ ] **Step 1:** iOS simulator and Android emulator against gnodev, with Bubble Rumble: (a) session request on `dev`, then a `sendtx` link for another chain, "Keep current" → session review still shown, Bubble Rumble not answered; (b) wallet on another chain, session request → "Switch" → review shows the plan, no error card; (c) identity-only `connect` with hints → "Create a session for this app" → Back → "New session": entries are the user's own.
- [ ] **Step 2:** `make test.ios device=<udid>`, `make test.android` green; push `feat/deeplink-tx` to PR #138.
- [ ] **Step 3:** Spec §9: P2-M3's three minors marked fixed; ledger and memory updated.
