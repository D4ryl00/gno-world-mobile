# Remaining minors (P2-M2, P2-M3b, Bubble Rumble) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every minor still open in spec §9: P2-M2's four (iOS), P2-M3b's one (iOS and Android), and Bubble Rumble's two simulator minors.

**Architecture:** Small independent fixes. gnokey-mobile (`~/gnokey-mobile`, branch `feat/deeplink-tx`, PR #138): pure helpers get unit tests (`SessionDraft.applying`, `DeepLink.responseURL`, `SessionReview.gasNote`); model/UI changes are checked by hand. Bubble Rumble (`~/bubblerumble`, `main`): `matchingPreset` is a tested pure function, the rest is screen options.

**Tech Stack:** Swift/SwiftUI/XCTest (`make test.ios device=<udid>`), Kotlin/Compose/JUnit (`make test.android`), Expo SDK 57 / Expo Router / jest (`npx jest`, `npx tsc --noEmit`, `npx expo lint`).

**Spec:** `docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` (§9: the minors, and the native contract for `wrong_network`: « résoudre le réseau — basculer, ou répondre `network_declined` — puis rappeler »).

## Global Constraints

- iOS and Android behave the same where both have the code.
- No new dependency in either repo.
- `npx expo lint` clean (zero errors, zero warnings), `npx tsc --noEmit` and jest green in `~/bubblerumble`.
- Callback answers stay valid URLs; values that were percent-encoded before still decode to the same text.

## Review Focus

1. A callback value with non-ASCII text (a `state` of "é") → percent-encoded as UTF-8, the URL still builds (Task 2 test).
2. A hinted lifetime equal to no preset (90000 s) → still shown as its own choice (Task 1 test keeps the existing case).
3. The wallet leaves the request's chain while its review is open, then the user declines the offered switch → the producer hears `network_declined` once (Task 5, manual).
4. The offered switch fails (node unreachable) → the error shows, the review comes back, and the user can still decline (Task 5, manual).
5. Settings with a custom endpoint matching no preset → no preset highlighted (Task 6 test).

---

### Task 1: iOS — a hinted lifetime equal to a preset selects the preset (P2-M2)

**Files:** Modify `ios/GnokeyMobile/Core/Models.swift` (`SessionDraft.applying`); Test `ios/GnokeyMobileTests/SessionDraftTests.swift`.

- [ ] **Step 1: failing test** (port of Android's `presetLifetimesSelectThePreset`):
```swift
    /// A hinted lifetime that is a builder preset selects the preset, rather
    /// than showing "1 day" next to "24 hours".
    func testPresetLifetimesSelectThePreset() {
        let draft = SessionDraft()
        func expires(_ s: Int64) -> String {
            draft.applying(ScopeHintsInfo(allow: [], spend: "", period: 0, expires: s)).expiresIn
        }
        XCTAssertEqual(expires(86_400), "24h")
        XCTAssertEqual(expires(604_800), "7d")
        XCTAssertEqual(expires(2_592_000), "30d")
        XCTAssertEqual(expires(90_000), "90000s")
    }
```
`testHintsPrefillTheBuilder` hints `2_592_000` and expects `"2592000s"`: change its hint to `90_000` / `"90000s"` (as Android's test does).
- [ ] **Step 2:** `make test.ios device=<udid>` → FAIL (`"86400s"` ≠ `"24h"`).
- [ ] **Step 3:** in `Models.swift`:
```swift
    /// The builder's expiry presets, by their length in seconds.
    private static let expiryPresets: [Int64: String] = [86_400: "24h", 604_800: "7d", 2_592_000: "30d"]
```
and `if hints.expires > 0 { draft.expiresIn = Self.expiryPresets[hints.expires] ?? "\(hints.expires)s" }`; doc comment gains "A lifetime that is a preset selects the preset."
- [ ] **Step 4:** tests PASS. **Step 5:** commit `fix(ios): a hinted lifetime that is a preset selects the preset`.

### Task 2: iOS — answers percent-encode only what RFC 3986 reserves (P2-M2)

**Files:** Modify `ios/GnokeyMobile/Core/DeepLink.swift` (`responseURL`); Test `ios/GnokeyMobileTests/DeepLinkTests.swift`.

Why: `.alphanumerics` encodes `_` (`invalid%5Frequest`) and leaves non-ASCII letters (`é`) unencoded.

- [ ] **Step 1: failing test:**
```swift
    /// Unreserved characters travel as they are; everything else, non-ASCII
    /// letters included, is percent-encoded as UTF-8.
    func testResponseEncodesOnlyReservedCharacters() {
        let url = DeepLink.responseURL(callback: "myapp://cb",
                                       pairs: [("code", "invalid_request"), ("expires_at", "1"), ("state", "a-b.c~é+/=")])
        XCTAssertEqual(url?.absoluteString, "myapp://cb?code=invalid_request&expires_at=1&state=a-b.c~%C3%A9%2B%2F%3D")
    }
```
- [ ] **Step 2:** FAIL (`%5F`, raw `é`).
- [ ] **Step 3:**
```swift
    /// RFC 3986's unreserved characters, ASCII only: `CharacterSet.alphanumerics`
    /// is Unicode-wide and would leave a letter like `é` unencoded.
    private static let unreserved = CharacterSet(charactersIn:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~")
```
`enc` uses `unreserved`; the doc comment says "allowing only RFC 3986's unreserved characters".
- [ ] **Step 4:** PASS (whole suite). **Step 5:** commit `fix(ios): answers percent-encode only what RFC 3986 reserves`.

### Task 3: iOS — the handoff's gas count is not grouped by locale (P2-M2)

**Files:** Modify `ios/GnokeyMobile/Core/SessionReview.swift`, `ios/GnokeyMobile/Screens/SessionHandoffView.swift:25`; Test `ios/GnokeyMobileTests/SessionReviewTests.swift`.

Why: `Text("… (\(tx.gasWanted) gas) …")` is a `LocalizedStringKey`: the `Int64` is formatted with grouping ("2 000 000").

- [ ] **Step 1: failing test:**
```swift
    /// The gas count is a protocol number, printed as gnokey prints it.
    func testGasNoteKeepsTheRawCount() {
        XCTAssertEqual(SessionReview.gasNote(fee: "1000000ugnot", wanted: 2_000_000, payer: "g1m"),
                       "Up to \(SessionReview.coins("1000000ugnot")) in gas (2000000 gas), paid by g1m.")
    }
```
- [ ] **Step 2:** FAIL (no `gasNote`).
- [ ] **Step 3:** `static func gasNote(fee: String, wanted: Int64, payer: String) -> String { "Up to \(coins(fee)) in gas (\(wanted) gas), paid by \(payer)." }`; the view shows `Text(SessionReview.gasNote(fee: tx.gasFee, wanted: tx.gasWanted, payer: flow.identity))` with its existing modifiers.
- [ ] **Step 4:** PASS. **Step 5:** commit `fix(ios): the handoff prints the gas count as gnokey does`.

### Task 4: iOS — the master balance is re-read once a session request is answered (P2-M2)

**Files:** Modify `ios/GnokeyMobile/Core/AppModel.swift` (`completeSession`).

Why: the desktop paid the fee from the master; Android's `completeSession` already calls `refreshStatus()`, iOS only `refreshAccountStates()`.

- [ ] **Step 1:** `Task { await refreshStatus(); await refreshAccountStates() }`, doc comment "The identity's balance and sessions moved, so the main screen re-reads them." (as Android).
- [ ] **Step 2:** suite PASS (no unit seam: the model needs the bridge — checked in Task 7). **Step 3:** commit `fix(ios): re-read the master balance once a session request is answered`.

### Task 5: both — a review on another chain offers the switch instead of an error (P2-M3b)

**Files:** Modify `ios/GnokeyMobile/Core/AppModel.swift` (new `offerNetworkSwitch(for:)`), `ios/GnokeyMobile/Screens/SessionRequestView.swift` (`loadPlan`, `approve`); `android/.../AppViewModel.kt` (new `offerNetworkSwitch`), `android/.../screens/SessionRequestScreen.kt` (`load`, `approve`).

**Interfaces:** Produces `AppModel.offerNetworkSwitch(for request: SessionRequestInfo) -> Bool` / `AppViewModel.offerNetworkSwitch(request: SessionRequestInfo): Boolean` — stages the switch prompt for the request's `rpc`/`chainid` (`stageNetworkSwitch`), true when a prompt is now pending.

Why: spec §9's native contract — on `wrong_network`, resolve the network (switch, or answer `network_declined`), then call again. The review showed an error card whose "Try again" kept failing. Staging the prompt hides the review (gate on `pendingNetworkSwitch`); "Switch" brings it back on the right chain and plans again (the sheet / composable is recreated, so its task re-runs); "Keep current" answers `network_declined` (Task 1 of P2-M3b: the request needs the switch).

- [ ] **Step 1:** iOS:
```swift
    /// The wallet left a parked session request's chain (another link's switch,
    /// or Settings): offer the switch back, as the request's arrival did.
    /// Declining it answers `network_declined`. True when the prompt is up.
    func offerNetworkSwitch(for request: SessionRequestInfo) -> Bool {
        stageNetworkSwitch(remote: request.rpc, chainID: request.chainID)
        return pendingNetworkSwitch != nil
    }
```
In `loadPlan`'s and `approve`'s `catch`, before the protocol-code branch: `if bridgeError.code == .wrongNetwork, model.offerNetworkSwitch(for: flow.request) { return }`. Android: same function (`stageNetworkSwitch(request.rpc, request.chainID); return pendingNetworkSwitch != null`) and `if (error.code == BridgeException.Code.WRONG_NETWORK && model.offerNetworkSwitch(flow.request)) return` in `load` and `approve` (resetting `building`).
- [ ] **Step 2:** both suites PASS. **Step 3:** commit `fix: a session review on another chain offers the switch back`.

### Task 6: Bubble Rumble — the chosen network preset is highlighted

**Files:** Modify `src/state/settings.ts` (new `matchingPreset`), `src/components/button.tsx` (`selected`), `src/screens/settings.tsx`; Test `src/state/settings.test.ts`.

- [ ] **Step 1: failing test:**
```ts
describe('matchingPreset', () => {
  it('names the preset the fields spell, ignoring surrounding spaces', () => {
    expect(matchingPreset('gnoland-1', 'https://rpc.gno.land:443')?.label).toBe('gno.land (mainnet)');
    expect(matchingPreset(' dev ', 'http://127.0.0.1:26657 ')?.label).toBe('Local gnodev');
  });
  it('is undefined for a custom network', () => {
    expect(matchingPreset('dev', 'http://10.0.2.2:26657')).toBeUndefined();
    expect(matchingPreset('test11', 'https://rpc.gno.land:443')).toBeUndefined();
  });
});
```
- [ ] **Step 2:** `npx jest src/state/settings.test.ts` → FAIL (not exported).
- [ ] **Step 3:**
```ts
/** The preset these fields spell, if any — what the settings screen highlights. */
export const matchingPreset = (chainId: string, remote: string) =>
  NETWORK_PRESETS.find((p) => p.chainId === chainId.trim() && p.remote === remote.trim());
```
`Button` gains `selected?: boolean`: `accessibilityState={{ disabled, selected }}`, style `selected && styles.selected` (`{ borderColor: colors.accent }`), text `selected && styles.selectedText` (`{ color: colors.accent }`). Settings: `const preset = matchingPreset(chainId, remote);` and `selected={preset?.chainId === p.chainId}` on each preset button.
- [ ] **Step 4:** jest, tsc, lint green. **Step 5:** commit `fix(settings): highlight the network preset the fields spell`.

### Task 7: Bubble Rumble — the pool screen's back button says "Pools"

**Files:** Modify `src/app/_layout.tsx`.

Why: iOS labels the back button with the previous screen's title; the `(tabs)` group has none, so it reads "(tabs)". Pools are opened only from the Pools tab.

- [ ] **Step 1:** `<Stack.Screen name="pool/[key]" options={{ title: 'Bubble', headerBackTitle: 'Pools' }} />`.
- [ ] **Step 2:** tsc, lint, jest green; check on the simulator. **Step 3:** commit `fix(nav): the pool screen's back button says Pools`.

### Task 8: verify, push, record

- [ ] **Step 1:** iOS simulator against gnodev: builder from a 24 h hint shows only "24 hours"; a session request answered → BR's callback has no `%5F` (read via an `https://example.com/cb` link); handoff shows "(2000000 gas)"; Status balance moves after the answer; wallet switched to chain "other" while a review is open → prompt; Keep current → BR "did not switch"; again → Switch → plan. Android emulator: the Task 5 scenario. BR: Settings preset highlighted; pool back button "Pools".
- [ ] **Step 2:** both gnokey-mobile suites green; push `feat/deeplink-tx` to PR #138. **Step 3:** spec §9, ledger, memory.
