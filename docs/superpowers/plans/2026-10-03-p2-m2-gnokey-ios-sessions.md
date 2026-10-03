# P2-M2 — gnokey-mobile iOS: session requests (`connect` with a key, `disconnect`, scope hints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The iOS app of gnokey-mobile answers GnoConnect session requests end to end. It routes `connect` with `pubkey` and `disconnect` to a review that follows the spec's Review section, lets the user narrow (never widen) a grant, hands the transaction to the desktop with the existing command block, watches the chain, and answers the producer's callback. An identity-only `connect` lists `sessions` in its features and checks its scope hints against the selected session, offering to create one that covers them.

**Architecture:** All protocol work stays in the Go bridge (P2-M1, P2-M1b): `AcceptSessionRequest`, `PlanSessionRequest`, `BuildSessionTx`, `PollSessionOutcome`, `ParseScopeHints`, `SessionCoversHints`. Swift adds four things:
- typed mirrors and a JSON codec (`SessionModels.swift`);
- pure review helpers — budget text, worst case, risky entries, narrowing choices, widenings (`SessionReview.swift`);
- one flow state in `AppModel` (`pendingSession`), from acceptance to the answer;
- two screens in one sheet: `SessionRequestView` (review) and `SessionHandoffView` (command and polling).

Pure logic is unit-tested with XCTest. Screens and routing are checked by a manual round trip on the iOS simulator against Bubble Rumble and gnodev.

**Tech Stack:** Swift 5.9, SwiftUI + Observation, iOS 17 deployment target, XCTest; GnoCore.xcframework built by `make build.ios` from `mobile/` (gomobile); xcodegen (`ios/project.yml`).

**Spec:**
- `~/bubblerumble/docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` §4: the iOS and Android part, and §9 for the native contract of the internal codes.
- `~/bubblerumble/gnoconnect-session.md`: Parameters, `connect` with a key, Renewal and rotation, `disconnect`, Obtaining the identity's signature, Review, Callback results, Wallet housekeeping, `connect` features, `connect` without a key: scope hints.

## Global Constraints

- **Repository and build:**
  - Work in `~/gnokey-mobile`, branch `feat/deeplink-tx` (PR #138), committing on top of `a8ce2d9`. No new branch, no push until the user asks.
  - No new dependency: no SPM package, no new Go module.
  - `ios/GnokeyMobile.xcodeproj` is generated from `ios/project.yml` by xcodegen. Never edit the pbxproj. New files under `ios/GnokeyMobile/` and `ios/GnokeyMobileTests/` are picked up by regeneration, which `make test.ios` runs first.
  - Tests run on the iOS 26.5 simulator: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`. On iOS 26.2 UIKit kills the app when the software keyboard renders.
  - GnoCore.xcframework comes from `make build.ios`, which needs about 10 minutes after a Go change. Rebuild it whenever `core/` or `mobile/` changed since the last build.
- **Answering the callback:**
  - Every answer goes through `DeepLink.responseURL(callback:pairs:)`, which handles the query vs fragment placement and refuses an unsafe callback.
  - An error answer is `status=error&code=<code>&state=<state>`.
  - A success answer is the bridge's reply (`ReplyJSON`) as is: it already carries `state` last.
  - A cancel is `status=cancelled&state=<state>`.
- **Codes answered verbatim:**
  - from the bridge: `invalid_request`, `invalid_proof`, `stale_request`, `signer_unavailable`, `session_expired`, `session_not_found`, `session_limit`;
  - from the app: `no_signer` (no identity held), `network_declined` (switch refused), `cancelled` (status).
- **Codes never answered:**
  - `replayed`: drop the copy.
  - `already_done`: keep polling; the next poll reports Done.
  - `wrong_network`: resolve the network, then call again.
  - `invalid_spec`: the user's input; show it inline.
  - `network`, `internal`: show it; the user retries.
- **Bridge call order:** `BuildSessionTx` only after a successful `PlanSessionRequest` for the same request and identity.
- **Consent rules:**
  - The user may narrow a grant, never widen it. The bridge's `CheckNarrowing` refuses a wider grant at build time with `invalid_spec`.
  - Without `spend`, the review says the session cannot spend anything, not even its fees.
  - A live session is never offered for revocation; housekeeping lists only `plan.expired`.
  - `features` of an identity-only `connect` is `sendtx,signtx,sessions`.
- **Commits:** follow the repo: `feat(ios): …`, `test(ios): …`, `build: …`; no attribution trailer.

## Review Focus

- The same session link delivered twice (cold launch plus `onOpenURL`, a double tap) opens one review and is answered once (pinned in Task 8, step 3).
- A request pinned to an identity the wallet does not hold is answered `signer_unavailable`, never reviewed under another identity (pinned in Task 4's `SessionFlowTests`, and Task 8, step 6).
- Declining the network switch for a session request answers `network_declined`; accepting it plans on the new chain (pinned in Task 8, step 5).
- The app sent to the background during the desktop handoff resumes polling and answers once the chain shows the result. A Stale document is replaced by a fresh command (pinned in Task 8, steps 4 and 7).
- A `disconnect` whose callback is absent still revokes and closes without opening anything (pinned in Task 8, step 8).

---

## File Structure

- `Makefile` — modify: `test.ios` target (Task 0).
- `ios/GnokeyMobile/Core/BridgeError.swift` — modify: the session codes, `protocolCode` (Task 1).
- `ios/GnokeyMobile/Core/SessionModels.swift` — create: `SessionRequestInfo`, `ChainSession`, `SessionPlanInfo`, `SessionGrantDraft`, `SessionTxInfo`, `SessionOutcomeInfo`, `ScopeHintsInfo`, `SessionFlow`, `SessionCodec` (Task 2).
- `ios/GnokeyMobile/Core/BridgeClient.swift` — modify: the six session calls (Task 2).
- `ios/GnokeyMobile/Core/SessionReview.swift` — create: pure review helpers (Task 3).
- `ios/GnokeyMobile/Core/DeepLink.swift` — modify: `disconnectHost`, `isSessionRequest`, `callbackTrust`, `ConnectRequest.hints` (Tasks 4, 7).
- `ios/GnokeyMobile/Core/AppModel.swift` — modify: the session flow (Task 4), hints (Task 7).
- `ios/GnokeyMobile/Core/Models.swift` — modify: `SessionDraft.applying(_:)` (Task 7).
- `ios/GnokeyMobile/Screens/SessionRequestView.swift` — create (Task 5).
- `ios/GnokeyMobile/Screens/SessionHandoffView.swift` — create (Task 6).
- `ios/GnokeyMobile/GnokeyMobileApp.swift` — modify: the session sheet (Task 5).
- `ios/GnokeyMobile/Screens/ConnectConsentView.swift` — modify: `callbackTrust` (Task 4), hints card (Task 7).
- `ios/GnokeyMobile/Screens/PermissionBuilderView.swift` — modify: requested expiry/period choices (Task 7).
- Tests: `ios/GnokeyMobileTests/BridgeErrorTests.swift`, `SessionCodecTests.swift`, `SessionReviewTests.swift`, `SessionFlowTests.swift`, `SessionDraftTests.swift`; `DeepLinkTests.swift` (modify).

---

### Task 0: Baseline and a `test.ios` target

**Files:**
- Modify: `Makefile`

**Interfaces:**
- Produces: `make test.ios device=<udid>` — regenerates the Xcode project, then runs the unit tests on that simulator.

- [ ] **Step 1: Build the framework from the current bridge**

Run: `cd ~/gnokey-mobile && git status -sb | head -1 && make build.ios`
Expected: `## feat/deeplink-tx...origin/feat/deeplink-tx`, then the build ends with `flattened …/ios-arm64/GnoCore.framework` (exit 0).

- [ ] **Step 2: Add the target**

In `Makefile`, after the `install.ios` block (after its `.PHONY: install.ios` line), add:

```make
# Unit tests on one simulator. Regenerates the project first, since a new
# source file is only picked up by xcodegen. device= is required — an id is
# simplest (see: make list-devices); use an iOS 26.5 simulator, since on 26.2
# UIKit kills the app when the software keyboard renders.
test.ios: $(gnocore_xcframework)
	@[ -n "$(device)" ] || { echo "device= is required (see: make list-devices)"; exit 1; }
	@command -v xcodegen >/dev/null \
		|| { echo "xcodegen not installed: brew install xcodegen"; exit 1; }
	cd ios && xcodegen generate --spec project.yml --quiet
	xcodebuild test -quiet -project $(ios_project) -scheme GnokeyMobile \
		-destination "id=$(device)" -derivedDataPath $(ios_derived)
.PHONY: test.ios
```

- [ ] **Step 3: Run the existing tests**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0. The existing `DeepLinkTests` pass; `-quiet` prints only warnings and failures.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "build: make test.ios runs the iOS unit tests on one simulator"
```

---

### Task 1: The session codes in `BridgeError`

**Files:**
- Modify: `ios/GnokeyMobile/Core/BridgeError.swift`
- Test: `ios/GnokeyMobileTests/BridgeErrorTests.swift`

**Interfaces:**
- Produces: `BridgeError.Code` cases `invalidRequest`, `invalidProof`, `staleRequest`, `signerUnavailable`, `sessionExpired`, `sessionNotFound`, `sessionLimit`, `replayed`, `alreadyDone`, `wrongNetwork`; `var protocolCode: String?` — the code to answer the callback with, or nil when the app must not answer it.

- [ ] **Step 1: Write the failing test**

`ios/GnokeyMobileTests/BridgeErrorTests.swift`:

```swift
import XCTest
@testable import GnokeyMobile

final class BridgeErrorTests: XCTestCase {
    private func error(_ message: String) -> BridgeError {
        BridgeError(NSError(domain: "GnoCore", code: 1, userInfo: [NSLocalizedDescriptionKey: message]))
    }

    /// The GnoConnect codes the bridge raises are what the producer is told.
    func testProtocolCodesAreAnsweredVerbatim() {
        for code in ["invalid_request", "invalid_proof", "stale_request", "signer_unavailable",
                     "session_expired", "session_not_found", "session_limit"] {
            XCTAssertEqual(error("[\(code)] some detail").protocolCode, code)
        }
    }

    /// The wallet's own codes are acted on, never answered.
    func testWalletCodesAreNeverAnswered() {
        for code in ["replayed", "already_done", "wrong_network", "invalid_spec", "network", "internal"] {
            XCTAssertNil(error("[\(code)] some detail").protocolCode, code)
        }
        XCTAssertEqual(error("[replayed] x").code, .replayed)
        XCTAssertEqual(error("[already_done] x").code, .alreadyDone)
        XCTAssertEqual(error("[wrong_network] x").code, .wrongNetwork)
        XCTAssertEqual(error("[session_limit] g1… has 16 sessions").message, "g1… has 16 sessions")
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: FAIL — the test target does not compile: `value of type 'BridgeError' has no member 'protocolCode'` and `type 'BridgeError.Code' has no member 'replayed'`.

- [ ] **Step 3: Add the codes**

In `BridgeError.swift`, add these cases after `case internalError = "internal"`:

```swift
        // GnoConnect session requests (gnoconnect-session.md, Callback results).
        case invalidRequest = "invalid_request"
        case invalidProof = "invalid_proof"
        case staleRequest = "stale_request"
        case signerUnavailable = "signer_unavailable"
        case sessionExpired = "session_expired"
        case sessionNotFound = "session_not_found"
        case sessionLimit = "session_limit"
        // The bridge's internal codes: acted on, never answered (spec §9).
        case replayed = "replayed"
        case alreadyDone = "already_done"
        case wrongNetwork = "wrong_network"
```

In `shortTitle`, add before `case .internalError, .unknown:`:

```swift
        case .invalidRequest, .invalidProof, .staleRequest: return "Invalid Request"
        case .signerUnavailable: return "Identity Not Held"
        case .sessionExpired: return "Session Expired"
        case .sessionNotFound: return "Session Not Found"
        case .sessionLimit: return "Too Many Sessions"
        case .replayed: return "Already Handled"
        case .alreadyDone: return "Already Done"
        case .wrongNetwork: return "Wrong Network"
```

and after `shortTitle`:

```swift
    /// The code a session request is answered with (`status=error&code=…`),
    /// verbatim from the bridge — or nil for the wallet's own codes, which are
    /// acted on and never answered: `replayed` (drop the copy), `already_done`
    /// (keep polling), `wrong_network` (resolve the network first), and input,
    /// network or internal failures, which the user sees and retries.
    var protocolCode: String? {
        switch code {
        case .invalidRequest, .invalidProof, .staleRequest, .signerUnavailable,
             .sessionExpired, .sessionNotFound, .sessionLimit:
            return code.rawValue
        default:
            return nil
        }
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ios/GnokeyMobile/Core/BridgeError.swift ios/GnokeyMobileTests/BridgeErrorTests.swift
git commit -m "feat(ios): the session request codes, and which of them the producer hears"
```

---

### Task 2: Session models, their codec, and the bridge calls

**Files:**
- Create: `ios/GnokeyMobile/Core/SessionModels.swift`
- Modify: `ios/GnokeyMobile/Core/BridgeClient.swift`
- Test: `ios/GnokeyMobileTests/SessionCodecTests.swift`

**Interfaces:**
- Consumes (GnoCore, generated by gomobile from `mobile/sessions.go`):
  - Types: `GnoMobileSessionRequest` (`url`, …), `GnoMobileSessionPlan` (`identity`, `sessionAddress`, `alreadyGranted`, `replyJSON`, `hasOld`, `oldOnChain`, `oldJSON`, `targetJSON`, `expiredJSON`, `mustRevoke`), `GnoMobileSessionGrant` (`allowJSON`, `spend`, `period`, `expires`), `GnoMobileSessionTx` (`command`, `document`, `signsDocument`, `revokesJSON`, `gasWanted`, `gasFee`, `accountNumber`, `sequence`), `GnoMobileSessionOutcome` (`done`, `stale`, `replyJSON`), `GnoMobileScopeHints` (`present`, `allowJSON`, `spend`, `period`, `expires`).
  - Bridge methods:
    - `acceptSessionRequest(_:)`
    - `planSessionRequest(_:identity:)`
    - `buildSessionTx(_:identity:grant:revokeExpiredJSON:masterKeyName:)`
    - `pollSessionOutcome(_:identity:tx:)`
    - `parseScopeHints(_:)`
    - `sessionCoversHints(_:sessionAddress:hints:ret0_:)` (`ret0_` is an `UnsafeMutablePointer<ObjCBool>`)
- Produces: the Swift types below and these `BridgeClient` methods:
  - `acceptSessionRequest(url:) -> SessionRequestInfo`
  - `planSessionRequest(_:identity:) -> SessionPlanInfo`
  - `buildSessionTx(_:identity:grant:revokeExpired:masterKeyName:) -> SessionTxInfo`
  - `pollSessionOutcome(_:identity:tx:) -> SessionOutcomeInfo`
  - `parseScopeHints(url:) -> ScopeHintsInfo?`
  - `sessionCoversHints(masterAddress:sessionAddress:hints:) -> Bool`

- [ ] **Step 1: Write the failing test**

`ios/GnokeyMobileTests/SessionCodecTests.swift`:

```swift
import XCTest
@testable import GnokeyMobile

final class SessionCodecTests: XCTestCase {
    /// A reply crosses the bridge as `[key, value]` pairs in callback order;
    /// `allow` repeats, so a dictionary would lose entries.
    func testReplyPairsKeepCallbackOrder() {
        let pairs = SessionCodec.pairs(#"[["status","success"],["allow","a"],["allow","b"],["state","s"]]"#)
        XCTAssertEqual(pairs, [["status", "success"], ["allow", "a"], ["allow", "b"], ["state", "s"]])
        XCTAssertEqual(SessionCodec.values("allow", in: pairs), ["a", "b"])
        XCTAssertEqual(SessionCodec.value("state", in: pairs), "s")
        XCTAssertNil(SessionCodec.value("revoked", in: pairs))
        XCTAssertEqual(SessionCodec.tuples(pairs).map(\.0), ["status", "allow", "allow", "state"])
    }

    func testEmptyFieldsDecodeToNothing() {
        XCTAssertEqual(SessionCodec.pairs(""), [])
        XCTAssertNil(SessionCodec.session(""))
        XCTAssertEqual(SessionCodec.sessions("[]"), [])
        XCTAssertEqual(SessionCodec.strings(""), [])
    }

    /// The shape `mobile/sessions.go` writes (`sessionJSON`).
    func testSessionsAsTheBridgeWritesThem() {
        let json = #"[{"address":"g1x","pubKey":"gpub1x","expiresAt":1,"allowPaths":["bank/send"],"spendLimit":"1ugnot","spendPeriod":60}]"#
        XCTAssertEqual(SessionCodec.sessions(json), [
            ChainSession(address: "g1x", pubKey: "gpub1x", expiresAt: 1, allowPaths: ["bank/send"],
                         spendLimit: "1ugnot", spendPeriod: 60),
        ])
        XCTAssertEqual(SessionCodec.json(["a", "b"]), #"["a","b"]"#)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: FAIL — `cannot find 'SessionCodec' in scope`.

- [ ] **Step 3: Write the models**

`ios/GnokeyMobile/Core/SessionModels.swift`:

```swift
import Foundation

/// A verified GnoConnect session request — a `connect` naming the producer's
/// key, or a `disconnect` — as `BridgeClient.acceptSessionRequest` returns it.
/// The fields are for display: every later bridge call reads the request from
/// `url` again, so nothing held here can change what the producer signed.
struct SessionRequestInfo: Equatable {
    var url: String
    var host: String
    var pubKey: String
    var old: String
    var allow: [String]
    var spend: String
    var period: Int64
    var expires: Int64
    var chainID: String
    var rpc: String
    var signer: String
    var callback: String
    var state: String

    var isDisconnect: Bool { host == DeepLink.disconnectHost }
}

/// One session of the identity as the chain stores it (`sessionJSON` in the bridge).
struct ChainSession: Codable, Equatable, Identifiable {
    var address: String
    var pubKey: String
    var expiresAt: Int64
    var allowPaths: [String]
    var spendLimit: String
    var spendPeriod: Int64

    var id: String { address }
    var expiryDate: Date? { expiresAt > 0 ? Date(timeIntervalSince1970: TimeInterval(expiresAt)) : nil }
}

/// What a request does on chain, decided before the user is asked anything
/// (see `core.SessionPlan`).
struct SessionPlanInfo: Equatable {
    var identity: String
    var sessionAddress: String
    /// The key is already a live session: approving answers `reply`, no transaction.
    var alreadyGranted: Bool
    var reply: [[String]]
    var hasOld: Bool
    var oldOnChain: Bool
    var old: ChainSession?
    var target: ChainSession?
    /// Expired sessions the transaction may revoke; `mustRevoke` of them must go.
    var expired: [ChainSession]
    var mustRevoke: Int
}

/// The grant the user approved: the request's, or narrower.
struct SessionGrantDraft: Equatable {
    var allow: [String] = []
    var spend: String = ""
    var period: Int64 = 0
    var expires: Int64 = 0
}

/// The desktop command for a request's transaction (see `core.SessionTx`).
struct SessionTxInfo: Equatable {
    var command: String
    var document: String
    var signsDocument: Bool
    var revokes: [String]
    var gasWanted: Int64
    var gasFee: String
    var accountNumber: Int64
    var sequence: Int64
}

/// One look at the chain while the desktop signs.
struct SessionOutcomeInfo: Equatable {
    var done: Bool
    var stale: Bool
    var reply: [[String]]
}

/// What an identity-only `connect` says the producer will send through the wallet.
struct ScopeHintsInfo: Equatable {
    var allow: [String]
    var spend: String
    var period: Int64
    var expires: Int64
}

/// A session request in progress, from acceptance to the answer.
struct SessionFlow: Equatable {
    var request: SessionRequestInfo
    /// The identity that grants or revokes, and its key name in desktop gnokey.
    var identity: String
    var masterKeyName: String
    /// Set once the user approved: the command shown, and what rebuilds it.
    var tx: SessionTxInfo?
    var grant = SessionGrantDraft()
    var revokeExpired: [String] = []
}

/// The JSON fields of the bridge's session types.
enum SessionCodec {
    /// A callback reply as `[key, value]` pairs in callback order; empty for "".
    static func pairs(_ json: String) -> [[String]] { decode([[String]].self, json) ?? [] }

    static func strings(_ json: String) -> [String] { decode([String].self, json) ?? [] }

    static func session(_ json: String) -> ChainSession? { decode(ChainSession.self, json) }

    static func sessions(_ json: String) -> [ChainSession] { decode([ChainSession].self, json) ?? [] }

    static func json(_ items: [String]) -> String {
        guard let data = try? JSONEncoder().encode(items) else { return "[]" }
        return String(data: data, encoding: .utf8) ?? "[]"
    }

    /// The pairs `DeepLink.responseURL` takes.
    static func tuples(_ pairs: [[String]]) -> [(String, String)] {
        pairs.compactMap { $0.count == 2 ? ($0[0], $0[1]) : nil }
    }

    static func value(_ key: String, in pairs: [[String]]) -> String? {
        pairs.first { $0.count == 2 && $0[0] == key }?[1]
    }

    static func values(_ key: String, in pairs: [[String]]) -> [String] {
        pairs.filter { $0.count == 2 && $0[0] == key }.map { $0[1] }
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ json: String) -> T? {
        guard !json.isEmpty else { return nil }
        return try? JSONDecoder().decode(type, from: Data(json.utf8))
    }
}
```

- [ ] **Step 4: Add the bridge calls**

In `BridgeClient.swift`, before `// MARK: - helpers`, add:

```swift
    // MARK: - GnoConnect sessions

    /// Verifies a session link: shape, proof of possession, iat window, replay.
    func acceptSessionRequest(url: String) throws -> SessionRequestInfo {
        do {
            let r = try requireBridge().acceptSessionRequest(url)
            return SessionRequestInfo(url: r.url, host: r.host, pubKey: r.pubKey, old: r.old,
                                      allow: SessionCodec.strings(r.allowJSON), spend: r.spend,
                                      period: r.period, expires: r.expires, chainID: r.chainID,
                                      rpc: r.rpc, signer: r.signer, callback: r.callback, state: r.state)
        } catch { throw BridgeError(error) }
    }

    func planSessionRequest(_ request: SessionRequestInfo, identity: String) throws -> SessionPlanInfo {
        do {
            let p = try requireBridge().planSessionRequest(sessionRequest(request), identity: identity)
            return SessionPlanInfo(identity: p.identity, sessionAddress: p.sessionAddress,
                                   alreadyGranted: p.alreadyGranted, reply: SessionCodec.pairs(p.replyJSON),
                                   hasOld: p.hasOld, oldOnChain: p.oldOnChain,
                                   old: SessionCodec.session(p.oldJSON), target: SessionCodec.session(p.targetJSON),
                                   expired: SessionCodec.sessions(p.expiredJSON), mustRevoke: Int(p.mustRevoke))
        } catch { throw BridgeError(error) }
    }

    /// Only after a successful `planSessionRequest` for the same request and
    /// identity: that is what makes `already_done` on a disconnect a success.
    func buildSessionTx(_ request: SessionRequestInfo, identity: String, grant: SessionGrantDraft,
                        revokeExpired: [String], masterKeyName: String) throws -> SessionTxInfo {
        let g = GnoMobileSessionGrant()
        g.allowJSON = SessionCodec.json(grant.allow)
        g.spend = grant.spend
        g.period = grant.period
        g.expires = grant.expires
        do {
            let tx = try requireBridge().buildSessionTx(sessionRequest(request), identity: identity, grant: g,
                                                        revokeExpiredJSON: SessionCodec.json(revokeExpired),
                                                        masterKeyName: masterKeyName)
            return SessionTxInfo(command: tx.command, document: tx.document, signsDocument: tx.signsDocument,
                                 revokes: SessionCodec.strings(tx.revokesJSON), gasWanted: tx.gasWanted,
                                 gasFee: tx.gasFee, accountNumber: tx.accountNumber, sequence: tx.sequence)
        } catch { throw BridgeError(error) }
    }

    func pollSessionOutcome(_ request: SessionRequestInfo, identity: String,
                            tx: SessionTxInfo) throws -> SessionOutcomeInfo {
        let t = GnoMobileSessionTx()
        t.command = tx.command
        t.document = tx.document
        t.signsDocument = tx.signsDocument
        t.revokesJSON = SessionCodec.json(tx.revokes)
        t.gasWanted = tx.gasWanted
        t.gasFee = tx.gasFee
        t.accountNumber = tx.accountNumber
        t.sequence = tx.sequence
        do {
            let o = try requireBridge().pollSessionOutcome(sessionRequest(request), identity: identity, tx: t)
            return SessionOutcomeInfo(done: o.done, stale: o.stale, reply: SessionCodec.pairs(o.replyJSON))
        } catch { throw BridgeError(error) }
    }

    /// The scope hints of an identity-only `connect`; nil when it carries none.
    func parseScopeHints(url: String) throws -> ScopeHintsInfo? {
        do {
            let h = try requireBridge().parseScopeHints(url)
            guard h.present else { return nil }
            return ScopeHintsInfo(allow: SessionCodec.strings(h.allowJSON), spend: h.spend,
                                  period: h.period, expires: h.expires)
        } catch { throw BridgeError(error) }
    }

    func sessionCoversHints(masterAddress: String, sessionAddress: String,
                            hints: ScopeHintsInfo) throws -> Bool {
        let h = GnoMobileScopeHints()
        h.present = true
        h.allowJSON = SessionCodec.json(hints.allow)
        h.spend = hints.spend
        h.period = hints.period
        h.expires = hints.expires
        var covered: ObjCBool = false
        do {
            try requireBridge().sessionCoversHints(masterAddress, sessionAddress: sessionAddress,
                                                   hints: h, ret0_: &covered)
        } catch { throw BridgeError(error) }
        return covered.boolValue
    }
```

and in `// MARK: - helpers`:

```swift
    /// The bridge reads a request from its URL alone; the other fields are
    /// display copies and are not sent back.
    private func sessionRequest(_ request: SessionRequestInfo) -> GnoMobileSessionRequest {
        let r = GnoMobileSessionRequest()
        r.url = request.url
        return r
    }
```

If the Swift names gomobile generated differ from these (the header is `ios/GnoCoreKit/GnoCore.xcframework/ios-arm64/GnoCore.framework/Headers/GnoMobile.objc.h`), use the header's and ledger the difference.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0 (the app target compiles with the new bridge calls, and `SessionCodecTests` pass).

- [ ] **Step 6: Commit**

```bash
git add ios/GnokeyMobile/Core/SessionModels.swift ios/GnokeyMobile/Core/BridgeClient.swift ios/GnokeyMobileTests/SessionCodecTests.swift
git commit -m "feat(ios): session request models and the bridge calls behind them"
```

---

### Task 3: Review helpers

**Files:**
- Create: `ios/GnokeyMobile/Core/SessionReview.swift`
- Test: `ios/GnokeyMobileTests/SessionReviewTests.swift`

**Interfaces:**
- Consumes: `ChainSession`, `SessionGrantDraft` (Task 2).
- Produces:
  - `enum SessionReview` with:
    - `risk(of:) -> String?`
    - `budget(spend:period:) -> String?`
    - `worstCase(spend:period:lifetime:) -> String?`
    - `coins(_:times:) -> String`
    - `duration(_:singular:) -> String`
    - `periodLabel(_:) -> String`
    - `lifetimeChoices(requested:) -> [Int64]`
    - `periodChoices(requested:) -> [Int64]`
    - `widenings(old:new:now:) -> [Widening]`
  - `enum Widening: Equatable { case longerLife, higherLimit, fasterReset, newEntries([String]) }`.

- [ ] **Step 1: Write the failing test**

`ios/GnokeyMobileTests/SessionReviewTests.swift`:

```swift
import XCTest
@testable import GnokeyMobile

final class SessionReviewTests: XCTestCase {
    /// gnoconnect-session.md, Review: "5 GNOT per hour" and "at most 3,600 GNOT over 30 days".
    func testTheSpecExample() {
        XCTAssertEqual(SessionReview.budget(spend: "5000000ugnot", period: 3600), "5 GNOT per hour")
        XCTAssertEqual(SessionReview.worstCase(spend: "5000000ugnot", period: 3600, lifetime: 2_592_000),
                       "at most 3,600 GNOT over 30 days")
    }

    func testALifetimeCap() {
        XCTAssertEqual(SessionReview.budget(spend: "1500000ugnot", period: 0), "1.5 GNOT in total")
        XCTAssertEqual(SessionReview.worstCase(spend: "1500000ugnot", period: 0, lifetime: 86_400),
                       "at most 1.5 GNOT over 1 day")
        XCTAssertNil(SessionReview.budget(spend: "", period: 3600))
        XCTAssertNil(SessionReview.worstCase(spend: "", period: 3600, lifetime: 86_400))
    }

    /// A window that has started counts whole: 25 hours with a daily period is two windows.
    func testAPartialWindowCounts() {
        XCTAssertEqual(SessionReview.worstCase(spend: "1000000ugnot", period: 86_400, lifetime: 90_000),
                       "at most 2 GNOT over 25 hours")
    }

    func testOtherDenominationsStayRaw() {
        XCTAssertEqual(SessionReview.coins("12foo,3000000ugnot"), "12 foo + 3 GNOT")
        XCTAssertEqual(SessionReview.coins("1ugnot"), "0.000001 GNOT")
    }

    func testDurations() {
        XCTAssertEqual(SessionReview.duration(3600), "1 hour")
        XCTAssertEqual(SessionReview.duration(3600, singular: true), "hour")
        XCTAssertEqual(SessionReview.duration(7200), "2 hours")
        XCTAssertEqual(SessionReview.duration(604_800), "1 week")
        XCTAssertEqual(SessionReview.duration(2_592_000), "30 days")
        XCTAssertEqual(SessionReview.duration(90), "90 seconds")
        XCTAssertEqual(SessionReview.periodLabel(0), "Lifetime")
        XCTAssertEqual(SessionReview.periodLabel(86_400), "Per day")
    }

    /// gnoconnect-session.md, Review: `*`, a bare `vm/exec`, `vm/run`, `bank/send` and `bank/multisend`.
    func testRiskyEntries() {
        for entry in ["*", "vm/exec", "vm/run", "bank/send", "bank/multisend"] {
            XCTAssertNotNil(SessionReview.risk(of: entry), entry)
        }
        XCTAssertNil(SessionReview.risk(of: "vm/exec:gno.land/r/demo/a"))
    }

    /// The choices offered never widen the request.
    func testChoicesNeverWiden() {
        XCTAssertEqual(SessionReview.lifetimeChoices(requested: 2_592_000), [2_592_000, 604_800, 86_400, 3_600])
        XCTAssertEqual(SessionReview.lifetimeChoices(requested: 600), [600])
        XCTAssertEqual(SessionReview.periodChoices(requested: 3600), [3600, 86_400, 604_800, 2_592_000, 0])
        XCTAssertEqual(SessionReview.periodChoices(requested: 0), [0])
    }

    func testWidenings() {
        let now = Date(timeIntervalSince1970: 1_790_841_600)
        let old = ChainSession(address: "g1o", pubKey: "gpub1o", expiresAt: 1_790_841_600 + 86_400,
                               allowPaths: ["bank/send"], spendLimit: "1000000ugnot", spendPeriod: 86_400)
        let same = SessionGrantDraft(allow: ["bank/send"], spend: "1000000ugnot", period: 86_400, expires: 86_400)
        XCTAssertEqual(SessionReview.widenings(old: old, new: same, now: now), [])

        let wider = SessionGrantDraft(allow: ["bank/send", "vm/run"], spend: "2000000ugnot", period: 3_600,
                                      expires: 172_800)
        XCTAssertEqual(SessionReview.widenings(old: old, new: wider, now: now),
                       [.longerLife, .higherLimit, .fasterReset, .newEntries(["vm/run"])])

        var capped = old
        capped.spendPeriod = 0 // a lifetime cap becoming a resetting budget resets more often
        XCTAssertEqual(SessionReview.widenings(old: capped, new: same, now: now), [.fasterReset])
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: FAIL — `cannot find 'SessionReview' in scope`.

- [ ] **Step 3: Write the helpers**

`ios/GnokeyMobile/Core/SessionReview.swift`:

```swift
import Foundation

/// What a session grant widens over the session it replaces (gnoconnect-session.md,
/// Renewal and rotation: "highlight any widening").
enum Widening: Equatable {
    case longerLife
    case higherLimit
    case fasterReset
    case newEntries([String])
}

/// The words the session review uses, kept out of the views so they are tested
/// (gnoconnect-session.md, Review).
enum SessionReview {
    /// Why an allow entry needs a second look: it reaches arbitrary code or
    /// moves funds directly. Nil for a path-scoped entry.
    static func risk(of entry: String) -> String? {
        switch entry {
        case "*": return "Anything this identity can do, including moving its coins."
        case "vm/exec": return "Calls to any realm."
        case "vm/run": return "Runs arbitrary code as this identity."
        case "bank/send", "bank/multisend": return "Sends coins directly."
        default: return nil
        }
    }

    /// "5 GNOT per hour", or "5 GNOT in total" for a lifetime cap; nil without spending.
    static func budget(spend: String, period: Int64) -> String? {
        guard !spend.isEmpty else { return nil }
        return period == 0 ? "\(coins(spend)) in total" : "\(coins(spend)) per \(duration(period, singular: true))"
    }

    /// The most the session can spend over its life, since the period resets for
    /// as long as it lives: "at most 3,600 GNOT over 30 days".
    static func worstCase(spend: String, period: Int64, lifetime: Int64) -> String? {
        guard !spend.isEmpty, lifetime > 0 else { return nil }
        let windows = period == 0 ? 1 : (lifetime + period - 1) / period
        return "at most \(coins(spend, times: windows)) over \(duration(lifetime))"
    }

    /// Coins in plain terms: ugnot as GNOT, other denominations as they are.
    static func coins(_ coins: String, times: Int64 = 1) -> String {
        coins.split(separator: ",").map { coin(String($0), times: times) }.joined(separator: " + ")
    }

    /// "1 hour", "30 days"; with `singular`, a single unit drops its count ("hour").
    static func duration(_ seconds: Int64, singular: Bool = false) -> String {
        let units: [(String, Int64)] = [("week", 604_800), ("day", 86_400), ("hour", 3_600),
                                        ("minute", 60), ("second", 1)]
        let (name, size) = units.first { seconds >= $0.1 && seconds % $0.1 == 0 } ?? ("second", 1)
        let n = seconds / size
        if n == 1 { return singular ? name : "1 \(name)" }
        return "\(n) \(name)s"
    }

    static func periodLabel(_ period: Int64) -> String {
        period == 0 ? "Lifetime" : "Per \(duration(period, singular: true))"
    }

    /// Lifetimes the user may pick: the requested one, then shorter presets.
    static func lifetimeChoices(requested: Int64) -> [Int64] {
        [requested] + [604_800, 86_400, 3_600].filter { $0 < requested }
    }

    /// Periods the user may pick: the requested one, longer presets, then a
    /// lifetime cap (0), which never resets and so is the narrowest.
    static func periodChoices(requested: Int64) -> [Int64] {
        guard requested != 0 else { return [0] }
        return [requested] + [86_400, 604_800, 2_592_000].filter { $0 > requested } + [0]
    }

    /// What `new` grants beyond `old`, in the order the review lists them.
    static func widenings(old: ChainSession, new grant: SessionGrantDraft, now: Date) -> [Widening] {
        var out: [Widening] = []
        let newEnd = Int64(now.timeIntervalSince1970) + grant.expires
        if old.expiresAt != 0 && newEnd > old.expiresAt { out.append(.longerLife) }
        if exceeds(grant.spend, old.spendLimit) { out.append(.higherLimit) }
        if !grant.spend.isEmpty && grant.period != 0 && (old.spendPeriod == 0 || grant.period < old.spendPeriod) {
            out.append(.fasterReset)
        }
        let added = grant.allow.filter { !old.allowPaths.contains($0) }
        if !added.isEmpty { out.append(.newEntries(added)) }
        return out
    }

    // MARK: - coins

    private static func coin(_ coin: String, times: Int64) -> String {
        guard let (amount, denom) = parse(coin) else { return coin }
        let total = amount * Decimal(times)
        if denom == "ugnot" { return "\(number(total / 1_000_000)) GNOT" }
        return "\(number(total)) \(denom)"
    }

    private static func parse(_ coin: String) -> (Decimal, String)? {
        let trimmed = coin.trimmingCharacters(in: .whitespaces)
        guard let split = trimmed.firstIndex(where: { !$0.isNumber }), split != trimmed.startIndex,
              let amount = Decimal(string: String(trimmed[..<split])) else { return nil }
        return (amount, String(trimmed[split...]))
    }

    /// Whether `new` allows more of some denomination than `old`.
    private static func exceeds(_ new: String, _ old: String) -> Bool {
        let had = Dictionary(old.split(separator: ",").compactMap { parse(String($0)) }.map { ($0.1, $0.0) },
                             uniquingKeysWith: +)
        return new.split(separator: ",").compactMap { parse(String($0)) }.contains { amount, denom in
            amount > (had[denom] ?? 0)
        }
    }

    private static func number(_ value: Decimal) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.usesGroupingSeparator = true
        f.groupingSeparator = ","
        f.groupingSize = 3
        f.decimalSeparator = "."
        f.maximumFractionDigits = 6
        return f.string(from: value as NSDecimalNumber) ?? "\(value)"
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add ios/GnokeyMobile/Core/SessionReview.swift ios/GnokeyMobileTests/SessionReviewTests.swift
git commit -m "feat(ios): the session review's words — budget, worst case, risky entries, widenings"
```

---

### Task 4: Routing and the session flow in `AppModel`

**Files:**
- Modify: `ios/GnokeyMobile/Core/DeepLink.swift`, `ios/GnokeyMobile/Core/AppModel.swift`, `ios/GnokeyMobile/Screens/ConnectConsentView.swift`
- Test: `ios/GnokeyMobileTests/DeepLinkTests.swift`, `ios/GnokeyMobileTests/SessionFlowTests.swift`

**Interfaces:**
- Consumes: `BridgeClient` session calls, `SessionFlow`, `SessionCodec` (Task 2); `BridgeError.protocolCode` (Task 1).
- Produces:
  - In `DeepLink`: `disconnectHost`, `isSessionRequest(_:)`, `callbackTrust(_:)`.
  - In `AppModel`:
    - types: `struct Identity: Equatable { address, masterKeyName }`;
    - helpers: `nonisolated static func identities(of:) -> [Identity]`, `nonisolated static func identity(forSigner:among:preferring:) -> Identity?`, `var identities: [Identity]`;
    - flow state and calls: `var pendingSession: SessionFlow?`, `handleSessionRequest(_:)`, `selectIdentity(_:)`, `startHandoff(tx:grant:revokeExpired:masterKeyName:)`, `updateSessionTx(_:)`, `completeSession(reply:)`, `failSession(code:)`, `cancelSession()`.

Decisions this task fixes:
- **A session request needs an identity the app already holds.** A wallet with no account answers `no_signer` (spec, `connect` with a key, step 1). A pin the app does not hold answers `signer_unavailable`. The pin is matched case-insensitively, since bech32 may be upper case.
- **One session request at a time.** A second one arriving while one is pending is answered `cancelled` at once: the producer may retry.
- **A link that arrives before the bridge is up** (a cold launch) is parked and handled at the end of `start()`.
- **An unsafe callback.** A `connect` with a key whose callback is unsafe is dropped, like an unsafe identity-only `connect`. So is a `disconnect` whose callback is present but unsafe.

- [ ] **Step 1: Write the failing tests**

Append to `ios/GnokeyMobileTests/DeepLinkTests.swift`, before its final `}`:

```swift
    // MARK: - session requests

    func testSessionRequestsAreRecognised() {
        XCTAssertTrue(DeepLink.isSessionRequest(URL(string: "land.gno.gnokey://connect?pubkey=gpub1x&callback=app%3A%2F%2Fcb")!))
        XCTAssertTrue(DeepLink.isSessionRequest(URL(string: "land.gno.gnokey://Disconnect?pubkey=gpub1x")!))
        // Scope hints without a key are still an identity-only sign-in.
        XCTAssertFalse(DeepLink.isSessionRequest(URL(string: "land.gno.gnokey://connect?allow=bank%2Fsend&callback=app%3A%2F%2Fcb")!))
        XCTAssertFalse(DeepLink.isSessionRequest(URL(string: "land.gno.gnokey://sendtx?pubkey=gpub1x")!))
        XCTAssertFalse(DeepLink.isSessionRequest(URL(string: "other://connect?pubkey=gpub1x")!))
    }
```

`ios/GnokeyMobileTests/SessionFlowTests.swift`:

```swift
import XCTest
@testable import GnokeyMobile

final class SessionFlowTests: XCTestCase {
    private func account(_ key: String, master: String, keyName: String) -> Account {
        Account(sessionKeyName: key, sessionAddress: "g1s\(key)", sessionPubKey: "gpub1\(key)",
                masterAddress: master, masterKeyName: keyName)
    }

    /// Several accounts may share one master: the identities are the distinct
    /// masters, each with the first key name the app knows for it.
    func testIdentitiesAreTheDistinctMasters() {
        let ids = AppModel.identities(of: [account("a", master: "g1m1", keyName: ""),
                                           account("b", master: "g1m1", keyName: "main"),
                                           account("c", master: "g1m2", keyName: "other")])
        XCTAssertEqual(ids, [AppModel.Identity(address: "g1m1", masterKeyName: "main"),
                             AppModel.Identity(address: "g1m2", masterKeyName: "other")])
    }

    func testThePinDecides() {
        let ids = [AppModel.Identity(address: "g1m1", masterKeyName: "a"),
                   AppModel.Identity(address: "g1m2", masterKeyName: "b")]
        // bech32 may come in upper case.
        XCTAssertEqual(AppModel.identity(forSigner: "G1M2", among: ids, preferring: "g1m1")?.address, "g1m2")
        // A pin the wallet does not hold: nobody else signs in its place.
        XCTAssertNil(AppModel.identity(forSigner: "g1other", among: ids, preferring: "g1m1"))
        XCTAssertEqual(AppModel.identity(forSigner: "", among: ids, preferring: "g1m2")?.address, "g1m2")
        XCTAssertEqual(AppModel.identity(forSigner: "", among: ids, preferring: nil)?.address, "g1m1")
        XCTAssertNil(AppModel.identity(forSigner: "", among: [], preferring: nil))
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: FAIL — `type 'DeepLink' has no member 'isSessionRequest'`, `type 'AppModel' has no member 'identities'`.

- [ ] **Step 3: Routing helpers in `DeepLink`**

In `DeepLink.swift`, after `static let connectHost = "connect"`:

```swift
    static let disconnectHost = "disconnect"

    /// A GnoConnect session request: `disconnect`, or a `connect` naming the
    /// producer's key (`pubkey`). A `connect` without one stays a sign-in, hints
    /// or not.
    static func isSessionRequest(_ url: URL) -> Bool {
        guard url.scheme == scheme, let host = host(of: url) else { return false }
        if host == disconnectHost { return true }
        guard host == connectHost,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else { return false }
        return items.contains { $0.name == "pubkey" }
    }
```

and after `callbackOrigin(_:)`:

```swift
    /// How far a callback identifies the requester: an `https` host is a
    /// verifiable anchor, a custom scheme is claimable by any app.
    static func callbackTrust(_ callback: String) -> String {
        URLComponents(string: callback)?.scheme?.lowercased() == "https"
            ? "Verified web address."
            : "Custom app link — the app's identity cannot be verified. Only approve if you started this."
    }
```

In `ConnectConsentView.swift`, replace the body of `callbackTrust` with:

```swift
    private var callbackTrust: String { DeepLink.callbackTrust(request.callback) }
```

(delete the old multi-line computed property it replaces).

- [ ] **Step 4: The flow in `AppModel`**

In `AppModel.swift`, after `var pendingNetworkSwitch: NetworkSettings?`:

```swift
    /// A GnoConnect session request (`connect` with a key, `disconnect`) from
    /// acceptance to the answer, presented as one sheet: review, then the
    /// desktop handoff.
    var pendingSession: SessionFlow?
    /// A session link that arrived before the bridge was up; handled by `start()`.
    private var parkedSessionURL: URL?
    private var bridgeReady = false

    /// A master identity the app can act for, with its key name in desktop gnokey.
    struct Identity: Equatable {
        var address: String
        var masterKeyName: String
    }

    var identities: [Identity] { Self.identities(of: accounts) }

    /// The distinct masters among `accounts`, in account order, each with the
    /// first non-empty key name recorded for it.
    nonisolated static func identities(of accounts: [Account]) -> [Identity] {
        var out: [Identity] = []
        for account in accounts where !account.masterAddress.isEmpty {
            if let i = out.firstIndex(where: { $0.address == account.masterAddress }) {
                if out[i].masterKeyName.isEmpty { out[i].masterKeyName = account.masterKeyName }
            } else {
                out.append(Identity(address: account.masterAddress, masterKeyName: account.masterKeyName))
            }
        }
        return out
    }

    /// The identity a request is reviewed under: the pinned `signer` (bech32,
    /// compared case-insensitively) or nil when the wallet does not hold it;
    /// without a pin, `preferring` (the selected account's master) or the first.
    nonisolated static func identity(forSigner signer: String, among identities: [Identity],
                                     preferring: String?) -> Identity? {
        if !signer.isEmpty {
            return identities.first { $0.address.lowercased() == signer.lowercased() }
        }
        return identities.first { $0.address == preferring } ?? identities.first
    }
```

In `start()`, right after `try? await client.setGasMargins(gasMargins)`, add:

```swift
        bridgeReady = true
        // Whichever way start() ends from here (onboarding or main), a session
        // link that arrived during the cold launch is handled once the phase is set.
        defer {
            if let url = parkedSessionURL {
                parkedSessionURL = nil
                Task { await handleSessionRequest(url) }
            }
        }
```

In `handleDeepLink(_:)`, as its first statement:

```swift
        if DeepLink.isSessionRequest(url) {
            guard bridgeReady else { parkedSessionURL = url; return }
            Task { await handleSessionRequest(url) }
            return
        }
```

Before `// MARK: - connect (sign-in)`, add:

```swift
    // MARK: - session requests (connect with a key, disconnect)

    /// Verifies a session link and parks it for review. A refusal the producer
    /// must hear about is answered at once; a replay is dropped (its first copy
    /// is being handled); anything else is the user's to see and retry.
    func handleSessionRequest(_ url: URL) async {
        let request: SessionRequestInfo
        do {
            request = try await client.acceptSessionRequest(url: url.absoluteString)
        } catch {
            let bridgeError = error as? BridgeError ?? BridgeError(error)
            if bridgeError.code == .replayed { return }
            if let code = bridgeError.protocolCode { respond(to: url, code: code) } else { surface(bridgeError) }
            return
        }
        // Answered only through a safe callback; a disconnect may have none.
        let answerable = request.callback.isEmpty ? request.isDisconnect : DeepLink.isCallbackSafe(request.callback)
        guard answerable else {
            surface(BridgeError(NSError(domain: "GnokeyMobile", code: 3, userInfo: [
                NSLocalizedDescriptionKey: "Ignored a session request with a missing or unsafe callback.",
            ])))
            return
        }
        guard pendingSession == nil else {
            respondSession(request, pairs: [("status", "cancelled")] + stateEcho(request))
            return
        }
        let held = identities
        guard !held.isEmpty else { respondSession(request, error: "no_signer"); return }
        guard let identity = Self.identity(forSigner: request.signer, among: held,
                                           preferring: selectedAccount?.masterAddress) else {
            respondSession(request, error: "signer_unavailable")
            return
        }
        pendingSession = SessionFlow(request: request, identity: identity.address,
                                     masterKeyName: identity.masterKeyName)
        stageNetworkSwitch(remote: request.rpc, chainID: request.chainID)
    }

    /// The user picked another identity on the review (no pin).
    func selectIdentity(_ address: String) {
        guard let identity = identities.first(where: { $0.address == address }) else { return }
        pendingSession?.identity = identity.address
        pendingSession?.masterKeyName = identity.masterKeyName
    }

    /// The user approved: show the command and watch the chain.
    func startHandoff(tx: SessionTxInfo, grant: SessionGrantDraft, revokeExpired: [String], masterKeyName: String) {
        pendingSession?.grant = grant
        pendingSession?.revokeExpired = revokeExpired
        pendingSession?.masterKeyName = masterKeyName
        pendingSession?.tx = tx
    }

    /// A rebuilt command (the identity's sequence moved under the document).
    func updateSessionTx(_ tx: SessionTxInfo) { pendingSession?.tx = tx }

    /// The chain shows the outcome, or the key was already granted: answer with
    /// the bridge's reply, which already ends with `state`.
    func completeSession(reply: [[String]]) {
        guard let flow = pendingSession else { return }
        pendingSession = nil
        respondSession(flow.request, pairs: SessionCodec.tuples(reply))
        Task { await refreshAccountStates() }
    }

    /// A refusal found after acceptance (`session_expired`, `session_limit`, …).
    func failSession(code: String) {
        guard let flow = pendingSession else { return }
        pendingSession = nil
        respondSession(flow.request, error: code)
    }

    /// The user declined, or stopped waiting for the desktop.
    func cancelSession() {
        guard let flow = pendingSession else { return }
        pendingSession = nil
        respondSession(flow.request, pairs: [("status", "cancelled")] + stateEcho(flow.request))
    }

    private func respondSession(_ request: SessionRequestInfo, error code: String) {
        respondSession(request, pairs: [("status", "error"), ("code", code)] + stateEcho(request))
    }

    /// Opens the callback with `pairs`; nothing when there is none (a disconnect
    /// may carry none: the producer then checks the chain itself).
    private func respondSession(_ request: SessionRequestInfo, pairs: [(String, String)]) {
        guard let url = DeepLink.responseURL(callback: request.callback, pairs: pairs) else { return }
        UIApplication.shared.open(url)
    }

    private func stateEcho(_ request: SessionRequestInfo) -> [(String, String)] {
        request.state.isEmpty ? [] : [("state", request.state)]
    }
```

In `keepCurrentNetwork()`, after the `pendingConnect` block, add:

```swift
        if let flow = pendingSession {
            pendingSession = nil
            respondSession(flow.request, error: "network_declined")
        }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add ios/GnokeyMobile/Core/DeepLink.swift ios/GnokeyMobile/Core/AppModel.swift ios/GnokeyMobile/Screens/ConnectConsentView.swift ios/GnokeyMobileTests/DeepLinkTests.swift ios/GnokeyMobileTests/SessionFlowTests.swift
git commit -m "feat(ios): route session requests and hold one in AppModel until it is answered"
```

---

### Task 5: The review sheet

**Files:**
- Create: `ios/GnokeyMobile/Screens/SessionRequestView.swift`
- Modify: `ios/GnokeyMobile/GnokeyMobileApp.swift`

**Interfaces:**
- Consumes: `AppModel.pendingSession`, `identities`, `selectIdentity`, `startHandoff`, `completeSession`, `failSession`, `cancelSession` (Task 4); `BridgeClient.planSessionRequest`, `buildSessionTx` (Task 2); `SessionReview` (Task 3); `DeepLink.callbackOrigin`, `callbackTrust`; `SessionHandoffView` (Task 6 — this task adds a placeholder-free stub of it so the target compiles, Task 6 replaces it).
- Produces: `struct SessionRequestView: View`, presented by `RootView` while `pendingSession != nil`, no network switch is pending, no identity-only `connect` is pending, and the phase is `.main`.

What the review shows (gnoconnect-session.md, Review):
- the callback's host and how far it can be trusted;
- the network: endpoint and chain id;
- the identity, with a picker when there is no pin and the app holds several, and its key name in desktop gnokey (editable, required);
- for a `connect`:
  - each allow entry, as a toggle, with its risk;
  - the budget in plain terms with its worst case, or the warning that the session cannot spend anything, not even its fees;
  - the lifetime, among choices that never widen, and the resulting expiry date;
  - with `old`: the old grant next to the new one with the widenings highlighted, or the note that the old key is no longer on chain;
- for a `disconnect`: the session to revoke;
- the expired sessions the transaction may revoke, with the ones that must go preselected;
- an already-granted key: a sign-in style approval that answers the chain's grant.

The gas the identity pays is known only once the transaction is composed; the handoff screen shows it, before the desktop signs anything.

- [ ] **Step 1: Write the review**

`ios/GnokeyMobile/Screens/SessionRequestView.swift`:

```swift
import SwiftUI

/// Review of a GnoConnect session request — a `connect` naming the app's own
/// key (a grant, or a renewal with `old`) or a `disconnect` — following the
/// Review section of gnoconnect-session.md. The user may narrow a grant, never
/// widen it: the choices offered are never wider, and the bridge refuses a
/// wider grant when it composes the transaction. Once approved, the same sheet
/// shows the desktop command and watches the chain.
struct SessionRequestView: View {
    @Environment(AppModel.self) private var model

    @State private var plan: SessionPlanInfo?
    @State private var loadError: String?
    @State private var allow: [String] = []
    @State private var lifetime: Int64 = 0
    @State private var spend = ""
    @State private var period: Int64 = 0
    @State private var revokeExpired: Set<String> = []
    @State private var masterKeyName = ""
    @State private var building = false
    @State private var buildError: String?

    var body: some View {
        NavigationStack {
            Group {
                if let flow = model.pendingSession {
                    if flow.tx != nil {
                        SessionHandoffView()
                    } else {
                        review(flow)
                    }
                }
            }
            .background(Theme.background)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Cancel") { model.cancelSession() }.disabled(building)
                }
            }
        }
        .task(id: model.pendingSession?.identity) { await loadPlan() }
    }

    private var title: String {
        guard let flow = model.pendingSession else { return "" }
        if flow.request.isDisconnect { return "Disconnect App" }
        return plan?.alreadyGranted == true ? "Sign in" : "Authorize App"
    }

    // MARK: - review

    private func review(_ flow: SessionFlow) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                requesterCard(flow.request)
                networkCard
                identityCard(flow)
                if let loadError {
                    errorCard(loadError)
                } else if let plan {
                    if plan.alreadyGranted {
                        alreadyGrantedCard(plan)
                    } else if flow.request.isDisconnect {
                        targetCard(plan)
                        housekeepingCard(plan)
                        approveButton("Revoke on Computer", flow: flow, plan: plan)
                    } else {
                        if plan.hasOld { oldCard(plan) }
                        allowCard(flow.request)
                        budgetCard(flow.request)
                        lifetimeCard(flow.request)
                        housekeepingCard(plan)
                        approveButton("Authorize on Computer", flow: flow, plan: plan)
                    }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding()
                }
            }
            .padding()
        }
    }

    private func requesterCard(_ request: SessionRequestInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Requested by")
            if request.callback.isEmpty {
                Text("An app that will check the chain itself (no callback).")
                    .font(.footnote)
            } else {
                Text(DeepLink.callbackOrigin(request.callback))
                    .font(.system(.footnote, design: .monospaced))
                Text(DeepLink.callbackTrust(request.callback))
                    .font(.caption)
                    .foregroundStyle(Theme.warning)
            }
        }
        .card()
    }

    private var networkCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Network")
            Text("\(model.network.remote) · chain \(model.network.chainID)")
                .font(.system(.footnote, design: .monospaced))
        }
        .card()
    }

    private func identityCard(_ flow: SessionFlow) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(flow.request.isDisconnect ? "Identity that revokes" : "Identity that grants")
            if flow.request.signer.isEmpty && model.identities.count > 1 {
                Picker("Identity", selection: Binding(
                    get: { flow.identity },
                    set: { model.selectIdentity($0) }
                )) {
                    ForEach(model.identities, id: \.address) { identity in
                        Text(identity.address).tag(identity.address)
                    }
                }
                .pickerStyle(.menu)
            } else {
                Text(flow.identity).addressStyle()
            }
            LabeledField("Key name", placeholder: "its name in desktop gnokey", text: $masterKeyName)
            Text("This identity's key signs on your computer, with gnokey.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    private func errorCard(_ message: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "xmark.circle")
                .font(.footnote)
                .foregroundStyle(Theme.negative)
            Button("Try again") { Task { await loadPlan() } }
                .buttonStyle(SecondaryButtonStyle())
        }
        .card()
    }

    private func alreadyGrantedCard(_ plan: SessionPlanInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Already authorized")
            Text("This app's key is already a session of this identity. Approving tells the app who you are and what its session may do — nothing is signed.")
                .font(.footnote)
            ForEach(SessionCodec.values("allow", in: plan.reply), id: \.self) { entry in
                Text(entry).font(.system(.caption, design: .monospaced))
            }
            if let spend = SessionCodec.value("spend", in: plan.reply),
               let budget = SessionReview.budget(spend: spend,
                                                 period: Int64(SessionCodec.value("period", in: plan.reply) ?? "") ?? 0) {
                Text(budget).font(.caption)
            }
            if let expiresAt = Int64(SessionCodec.value("expires_at", in: plan.reply) ?? ""), expiresAt > 0 {
                Text("Until \(Date(timeIntervalSince1970: TimeInterval(expiresAt)).formatted(date: .abbreviated, time: .shortened))")
                    .font(.caption)
            }
            Button { model.completeSession(reply: plan.reply) } label: { Text("Approve") }
                .buttonStyle(PrimaryButtonStyle(enabled: true))
        }
        .card()
    }

    private func targetCard(_ plan: SessionPlanInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Session to revoke")
            if let target = plan.target {
                Text(target.address).addressStyle()
                ForEach(target.allowPaths, id: \.self) { entry in
                    Text(entry).font(.system(.caption, design: .monospaced))
                }
                if let expiry = target.expiryDate {
                    Text("\(expiry < Date() ? "Expired" : "Expires") \(expiry.formatted(date: .abbreviated, time: .shortened))")
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Text("The app's key stops working for this identity. Revoking costs gas, paid by the identity.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    private func oldCard(_ plan: SessionPlanInfo) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel("Replaces")
            if plan.oldOnChain, let old = plan.old {
                Text(old.address).addressStyle()
                Text("Now: \(SessionReview.budget(spend: old.spendLimit, period: old.spendPeriod) ?? "no spending") · \(old.allowPaths.joined(separator: ", "))")
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
                ForEach(Array(widenings(old).enumerated()), id: \.offset) { _, widening in
                    Label(text(for: widening), systemImage: "arrow.up.right.circle")
                        .font(.caption)
                        .foregroundStyle(Theme.warning)
                }
            } else {
                Text("The app's previous key is no longer on chain: nothing is replaced, a new session is created.")
                    .font(.footnote)
            }
        }
        .card()
    }

    private func allowCard(_ request: SessionRequestInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Allowed actions")
            ForEach(request.allow, id: \.self) { entry in
                Toggle(isOn: Binding(
                    get: { allow.contains(entry) },
                    set: { on in
                        allow = on ? request.allow.filter { allow.contains($0) || $0 == entry }
                                   : allow.filter { $0 != entry }
                    }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(entry).font(.system(.footnote, design: .monospaced))
                        if let risk = SessionReview.risk(of: entry) {
                            Label(risk, systemImage: "exclamationmark.triangle")
                                .font(.caption)
                                .foregroundStyle(Theme.warning)
                        }
                    }
                }
            }
            if allow.isEmpty {
                Text("Keep at least one action.").font(.caption).foregroundStyle(Theme.negative)
            }
        }
        .card()
    }

    private func budgetCard(_ request: SessionRequestInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Budget")
            if request.spend.isEmpty || spend.trimmingCharacters(in: .whitespaces).isEmpty {
                Label("This session cannot spend anything, not even its own fees.",
                      systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(Theme.warning)
            }
            if !request.spend.isEmpty {
                LabeledField("Limit", placeholder: "empty = no spending", text: $spend)
                Picker("Period", selection: $period) {
                    ForEach(SessionReview.periodChoices(requested: request.period), id: \.self) { choice in
                        Text(SessionReview.periodLabel(choice)).tag(choice)
                    }
                }
                .pickerStyle(.menu)
                if let budget = SessionReview.budget(spend: spend, period: period) {
                    Text(budget).font(.footnote)
                    if let worst = SessionReview.worstCase(spend: spend, period: period, lifetime: lifetime) {
                        Text(worst).font(.caption).foregroundStyle(Theme.textSecondary)
                    }
                }
            }
        }
        .card()
    }

    private func lifetimeCard(_ request: SessionRequestInfo) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel("Lifetime")
            Picker("Lifetime", selection: $lifetime) {
                ForEach(SessionReview.lifetimeChoices(requested: request.expires), id: \.self) { choice in
                    Text(SessionReview.duration(choice)).tag(choice)
                }
            }
            .pickerStyle(.menu)
            Text("Expires about \(Date().addingTimeInterval(TimeInterval(lifetime)).formatted(date: .abbreviated, time: .shortened)), counted from when it lands on chain.")
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .card()
    }

    @ViewBuilder
    private func housekeepingCard(_ plan: SessionPlanInfo) -> some View {
        if !plan.expired.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionLabel("Expired sessions")
                Text(plan.mustRevoke > 0
                     ? "This identity has no free session slot: revoke at least \(plan.mustRevoke) of these in the same transaction."
                     : "Expired sessions still take one of the 16 slots. You may revoke them in the same transaction.")
                    .font(.caption)
                    .foregroundStyle(plan.mustRevoke > 0 ? Theme.warning : Theme.textSecondary)
                ForEach(plan.expired) { session in
                    Toggle(isOn: Binding(
                        get: { revokeExpired.contains(session.pubKey) },
                        set: { on in
                            if on { revokeExpired.insert(session.pubKey) } else { revokeExpired.remove(session.pubKey) }
                        }
                    )) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(session.address).addressStyle()
                            if let expiry = session.expiryDate {
                                Text("Expired \(expiry.formatted(date: .abbreviated, time: .shortened))")
                                    .font(.caption)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                }
            }
            .card()
        }
    }

    private func approveButton(_ label: String, flow: SessionFlow, plan: SessionPlanInfo) -> some View {
        let ready = !masterKeyName.trimmingCharacters(in: .whitespaces).isEmpty
            && revokeExpired.count >= plan.mustRevoke
            && (flow.request.isDisconnect || !allow.isEmpty)
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                Task { await approve(flow, plan: plan) }
            } label: {
                if building { ProgressView().tint(.white) } else { Text(label) }
            }
            .buttonStyle(PrimaryButtonStyle(enabled: ready))
            .disabled(!ready || building)
            if let buildError {
                Text(buildError).font(.caption).foregroundStyle(Theme.negative)
            }
        }
    }

    // MARK: - actions

    /// Plans against the chain for the current identity, and resets the form
    /// to the request. A refusal the producer must hear about ends the flow.
    private func loadPlan() async {
        guard let flow = model.pendingSession, flow.tx == nil else { return }
        plan = nil
        loadError = nil
        buildError = nil
        allow = flow.request.allow
        lifetime = flow.request.expires
        spend = flow.request.spend
        period = flow.request.period
        masterKeyName = flow.masterKeyName
        do {
            let loaded = try await model.client.planSessionRequest(flow.request, identity: flow.identity)
            revokeExpired = Set(loaded.expired.prefix(loaded.mustRevoke).map(\.pubKey))
            plan = loaded
        } catch {
            let bridgeError = error as? BridgeError ?? BridgeError(error)
            if let code = bridgeError.protocolCode { model.failSession(code: code); return }
            loadError = bridgeError.message
        }
    }

    private func approve(_ flow: SessionFlow, plan: SessionPlanInfo) async {
        building = true
        defer { building = false }
        buildError = nil
        let limit = spend.trimmingCharacters(in: .whitespaces)
        let grant = flow.request.isDisconnect
            ? SessionGrantDraft()
            : SessionGrantDraft(allow: allow, spend: limit, period: limit.isEmpty ? 0 : period, expires: lifetime)
        let revoke = plan.expired.map(\.pubKey).filter { revokeExpired.contains($0) }
        let keyName = masterKeyName.trimmingCharacters(in: .whitespaces)
        do {
            let tx = try await model.client.buildSessionTx(flow.request, identity: flow.identity, grant: grant,
                                                           revokeExpired: revoke, masterKeyName: keyName)
            model.startHandoff(tx: tx, grant: grant, revokeExpired: revoke, masterKeyName: keyName)
        } catch {
            let bridgeError = error as? BridgeError ?? BridgeError(error)
            // The result is already on chain (the key was granted, or the
            // disconnect's key revoked, since the plan): plan again to show it.
            if bridgeError.code == .alreadyDone { await loadPlan(); return }
            if let code = bridgeError.protocolCode { model.failSession(code: code); return }
            buildError = bridgeError.message
        }
    }

    // MARK: - helpers

    private func widenings(_ old: ChainSession) -> [Widening] {
        let limit = spend.trimmingCharacters(in: .whitespaces)
        return SessionReview.widenings(
            old: old,
            new: SessionGrantDraft(allow: allow, spend: limit, period: limit.isEmpty ? 0 : period, expires: lifetime),
            now: Date())
    }

    private func text(for widening: Widening) -> String {
        switch widening {
        case .longerLife: return "Lasts longer than the current session."
        case .higherLimit: return "Higher spend limit than the current session."
        case .fasterReset: return "The budget resets more often than the current session's."
        case .newEntries(let entries): return "New actions: \(entries.joined(separator: ", "))"
        }
    }
}
```

So that this task compiles on its own, create `ios/GnokeyMobile/Screens/SessionHandoffView.swift` with its final content from Task 6, Step 1 now, and keep Task 6 for its checks.

- [ ] **Step 2: Present it**

In `GnokeyMobileApp.swift`, `RootView`, after the connect `.sheet(…) { … }` modifier, add:

```swift
        // A session request waits, like a connect, for the network decision and
        // for the main screen; one sheet at a time, so it also waits for a
        // pending sign-in. Only its own buttons end it: a swipe would leave the
        // producer unanswered.
        .sheet(isPresented: Binding(
            get: {
                model.pendingSession != nil && model.pendingNetworkSwitch == nil
                    && model.pendingConnect == nil && model.phase == .main
            },
            set: { _ in }
        )) {
            SessionRequestView()
                .environment(model)
                .interactiveDismissDisabled()
        }
```

- [ ] **Step 3: Build and run the tests**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0 (no new test; the app target compiles with the review and the sheet).

- [ ] **Step 4: Commit**

```bash
git add ios/GnokeyMobile/Screens/SessionRequestView.swift ios/GnokeyMobile/Screens/SessionHandoffView.swift ios/GnokeyMobile/GnokeyMobileApp.swift
git commit -m "feat(ios): review a session request — narrow, never widen — and present it as a sheet"
```

---

### Task 6: The desktop handoff and the chain watch

**Files:**
- Create (in Task 5, checked here): `ios/GnokeyMobile/Screens/SessionHandoffView.swift`

**Interfaces:**
- Consumes: `AppModel.pendingSession`, `updateSessionTx`, `completeSession`, `failSession` (Task 4); `BridgeClient.pollSessionOutcome`, `buildSessionTx` (Task 2); `CommandBlock` (existing); `SessionReview.coins` (Task 3).
- Produces: `struct SessionHandoffView: View` — the command, its cost, and a poll every 3 s backing off to 10 s:
  - Done → `completeSession(reply:)`.
  - Stale → rebuild; the new command replaces the old, with a note.
  - `already_done` on a rebuild → keep polling.
  - A protocol code on a rebuild → `failSession`.
  - `wrong_network` → a note.
  - A network error → try again at the next tick.

- [ ] **Step 1: Write the handoff**

`ios/GnokeyMobile/Screens/SessionHandoffView.swift`:

```swift
import SwiftUI

/// The transaction of an approved session request, handed to the computer that
/// holds the identity's key (gnoconnect-session.md, Obtaining the identity's
/// signature), and the watch on the chain until it shows the outcome. The
/// request stays pending meanwhile, in the background too; Cancel (the sheet's
/// toolbar) answers `cancelled`.
struct SessionHandoffView: View {
    @Environment(AppModel.self) private var model
    @State private var note: String?

    var body: some View {
        if let flow = model.pendingSession, let tx = flow.tx {
            ScrollView {
                VStack(spacing: 20) {
                    Text("Run this on the computer that holds the key of this identity — “\(flow.masterKeyName)” in gnokey:")
                        .font(.subheadline)
                        .foregroundStyle(Theme.textSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    CommandBlock(command: tx.command)

                    VStack(alignment: .leading, spacing: 6) {
                        SectionLabel("Cost")
                        Text("Up to \(SessionReview.coins(tx.gasFee)) in gas (\(tx.gasWanted) gas), paid by \(flow.identity).")
                            .font(.footnote)
                        if tx.signsDocument {
                            Text("The command writes gnoconnect-session.json in the current directory, signs it, checks it with a dry run, then broadcasts it.")
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()

                    if let note {
                        Label(note, systemImage: "info.circle")
                            .font(.footnote)
                            .foregroundStyle(Theme.warning)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .card()
                    }

                    HStack(spacing: 10) {
                        ProgressView()
                        Text("Waiting for the transaction on chain…")
                            .font(.footnote)
                            .foregroundStyle(Theme.textSecondary)
                    }
                    .padding(.top, 8)
                }
                .padding()
            }
            .task { await poll() }
        }
    }

    /// Polls every ~3 s, backing off to 10 s. Reads the flow afresh each time,
    /// since a rebuild replaces its transaction.
    private func poll() async {
        var delay: Double = 3
        while !Task.isCancelled {
            guard let flow = model.pendingSession, let tx = flow.tx else { return }
            do {
                let outcome = try await model.client.pollSessionOutcome(flow.request, identity: flow.identity, tx: tx)
                if outcome.done {
                    model.completeSession(reply: outcome.reply)
                    return
                }
                if outcome.stale { await rebuild(flow) }
            } catch {
                let bridgeError = error as? BridgeError ?? BridgeError(error)
                if bridgeError.code == .wrongNetwork {
                    note = "The app is no longer on chain \(flow.request.chainID). Switch back to it in Settings to keep watching."
                }
                // Anything else is a network hiccup: try again at the next tick.
            }
            try? await Task.sleep(for: .seconds(delay))
            delay = min(delay * 1.2, 10)
        }
    }

    /// The identity sent another transaction since the document was signed for
    /// its sequence, so it can never be included: build it again, which plans
    /// against the chain again too.
    private func rebuild(_ flow: SessionFlow) async {
        do {
            let tx = try await model.client.buildSessionTx(flow.request, identity: flow.identity, grant: flow.grant,
                                                           revokeExpired: flow.revokeExpired,
                                                           masterKeyName: flow.masterKeyName)
            model.updateSessionTx(tx)
            note = "This identity sent another transaction meanwhile, so the command changed: run this one."
        } catch {
            let bridgeError = error as? BridgeError ?? BridgeError(error)
            if bridgeError.code == .alreadyDone { return } // on chain already: the next poll says Done
            if let code = bridgeError.protocolCode { model.failSession(code: code); return }
            note = bridgeError.message
        }
    }
}
```

- [ ] **Step 2: Build and run the tests**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0. The file was committed with Task 5; if its content changed while checking, commit the change:

```bash
git add ios/GnokeyMobile/Screens/SessionHandoffView.swift
git commit -m "feat(ios): watch the chain for a session request's outcome and answer it"
```

---

### Task 7: Identity-only `connect`: `sessions` in features, and scope hints

**Files:**
- Modify: `ios/GnokeyMobile/Core/DeepLink.swift` (`ConnectRequest.hints`), `ios/GnokeyMobile/Core/AppModel.swift`, `ios/GnokeyMobile/Core/Models.swift`, `ios/GnokeyMobile/Screens/ConnectConsentView.swift`, `ios/GnokeyMobile/Screens/PermissionBuilderView.swift`
- Test: `ios/GnokeyMobileTests/SessionDraftTests.swift`

**Interfaces:**
- Consumes: `BridgeClient.parseScopeHints`, `sessionCoversHints` (Task 2); `ScopeHintsInfo` (Task 2); `SessionReview.budget`, `duration`, `periodLabel` (Task 3).
- Produces: `ConnectRequest.hints: ScopeHintsInfo?`; `SessionDraft.applying(_:) -> SessionDraft`; `AppModel.createSession(forHints:)`; `features` = `sendtx,signtx,sessions`.

- [ ] **Step 1: Write the failing test**

`ios/GnokeyMobileTests/SessionDraftTests.swift`:

```swift
import XCTest
@testable import GnokeyMobile

final class SessionDraftTests: XCTestCase {
    /// "Create a session for this app" pre-fills the builder from the hints.
    func testHintsPrefillTheBuilder() {
        var draft = SessionDraft()
        draft.masterAddress = "g1m"
        draft.masterKeyName = "main"
        let filled = draft.applying(ScopeHintsInfo(allow: ["vm/exec:gno.land/r/demo/a"], spend: "5000000ugnot",
                                                   period: 3600, expires: 2_592_000))
        XCTAssertEqual(filled.allowPaths, ["vm/exec:gno.land/r/demo/a"])
        XCTAssertEqual(filled.spendLimit, "5000000ugnot")
        XCTAssertEqual(filled.spendPeriodSeconds, 3600)
        XCTAssertEqual(filled.expiresIn, "2592000s")
        XCTAssertEqual(filled.masterAddress, "g1m")
        XCTAssertEqual(filled.masterKeyName, "main")
    }

    /// Each hint is optional: what the app did not hint stays as the user left it.
    func testMissingHintsKeepTheDraft() {
        let draft = SessionDraft()
        XCTAssertEqual(draft.applying(ScopeHintsInfo(allow: [], spend: "", period: 3600, expires: 0)), draft)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: FAIL — `value of type 'SessionDraft' has no member 'applying'`.

- [ ] **Step 3: Pre-fill from hints**

In `Models.swift`, after `struct SessionDraft { … }`:

```swift
extension SessionDraft {
    /// This draft with an identity-only `connect`'s scope hints applied: what
    /// the app said it will send through the wallet. A hint left out keeps the
    /// user's value; the period counts only with a spend limit.
    func applying(_ hints: ScopeHintsInfo) -> SessionDraft {
        var draft = self
        if !hints.allow.isEmpty { draft.allowPaths = hints.allow }
        if !hints.spend.isEmpty {
            draft.spendLimit = hints.spend
            draft.spendPeriodSeconds = hints.period
        }
        if hints.expires > 0 { draft.expiresIn = "\(hints.expires)s" }
        return draft
    }
}
```

- [ ] **Step 4: Read the hints on `connect`, advertise `sessions`**

In `DeepLink.swift`, add to `ConnectRequest` after `var chainID: String = ""`:

```swift
    /// Scope hints (`allow`, `spend`, `period`, `expires`): what the app says it
    /// will send through the wallet. Read by the bridge; nil when there are none.
    var hints: ScopeHintsInfo? = nil
```

In `AppModel.handleDeepLink(_:)`, replace the connect branch:

```swift
        if DeepLink.host(of: url) == DeepLink.connectHost {
            if let request = DeepLink.parseConnect(url) {
                handleConnect(request)
            } else {
```

with:

```swift
        if DeepLink.host(of: url) == DeepLink.connectHost {
            if let parsed = DeepLink.parseConnect(url) {
                Task {
                    var request = parsed
                    do {
                        request.hints = try await client.parseScopeHints(url: url.absoluteString)
                    } catch {
                        // Hints are validated like a grant (spec, Parameters). A
                        // bridge not up yet (a cold launch) only loses them: they
                        // are optional, and the sign-in goes on without.
                        let bridgeError = error as? BridgeError ?? BridgeError(error)
                        if let code = bridgeError.protocolCode {
                            respond(to: url, code: code)
                            return
                        }
                    }
                    handleConnect(request)
                }
            } else {
```

In `approveConnect()`, the features pair becomes:

```swift
            // The hosts we implement, plus `sessions`: `connect` with a key and
            // `old`, and `disconnect` (gnoconnect-session.md, `connect` features).
            ("features", "sendtx,signtx,sessions"),
```

and add, after `createSession(forMaster:…)`:

```swift
    /// Starts creating a session that covers an identity-only `connect`'s
    /// hints, for the selected identity. The connect stays parked: once the
    /// session lands, the consent sheet comes back with it selected.
    func createSession(forHints hints: ScopeHintsInfo) async {
        guard let account = selectedAccount else { return }
        do {
            let name = "session-\(UUID().uuidString.prefix(8))"
            sessionKey = try await client.generateSessionKey(name: name)
            pendingKeyName = name
            draft.masterAddress = account.masterAddress
            draft.masterKeyName = account.masterKeyName
            draft = draft.applying(hints)
            phase = .builder
        } catch { surface(error) }
    }
```

- [ ] **Step 5: The hints on the consent sheet**

In `ConnectConsentView.swift`, add `@State private var covered: Bool?` after `let request: ConnectRequest`. Insert this card after the "Identity to reveal" card (before the Approve button):

```swift
                    if let hints = request.hints {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel("What this app plans to do")
                            ForEach(hints.allow, id: \.self) { entry in
                                Text(entry).font(.system(.caption, design: .monospaced))
                            }
                            if let budget = SessionReview.budget(spend: hints.spend, period: hints.period) {
                                Text("Spending \(budget)").font(.caption)
                            }
                            if hints.expires > 0 {
                                Text("For \(SessionReview.duration(hints.expires))").font(.caption)
                            }
                            switch covered {
                            case true?:
                                Label("The selected session covers this.", systemImage: "checkmark.seal")
                                    .font(.caption)
                                    .foregroundStyle(Theme.positive)
                            case false?:
                                Label("The selected session does not cover this: the app's requests may be refused.",
                                      systemImage: "exclamationmark.triangle")
                                    .font(.caption)
                                    .foregroundStyle(Theme.warning)
                                Button("Create a session for this app") {
                                    Task { await model.createSession(forHints: hints) }
                                }
                                .buttonStyle(SecondaryButtonStyle())
                            case nil:
                                Text("Checking the selected session…")
                                    .font(.caption)
                                    .foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .card()
                    }
```

and make the sheet's `.task(id: model.selectedAccountID)` check coverage too:

```swift
            .task(id: model.selectedAccountID) {
                await model.refreshStatus()
                covered = nil
                if let hints = request.hints, let key = model.sessionKey, !model.draft.masterAddress.isEmpty {
                    covered = try? await model.client.sessionCoversHints(masterAddress: model.draft.masterAddress,
                                                                         sessionAddress: key.address, hints: hints)
                }
            }
```

- [ ] **Step 6: The builder shows the requested expiry and period**

In `PermissionBuilderView.swift`, add after `expiryChoices`:

```swift
    /// The presets, plus the draft's own value when it is none of them (a
    /// session pre-filled from an app's hints asks for, say, "2592000s").
    private var shownExpiryChoices: [(label: String, value: String)] {
        let expiresIn = model.draft.expiresIn
        guard !Self.expiryChoices.contains(where: { $0.value == expiresIn }) else { return Self.expiryChoices }
        var label = expiresIn
        if expiresIn.hasSuffix("s"), let seconds = Int64(expiresIn.dropLast()) {
            label = SessionReview.duration(seconds)
        }
        return [(label, expiresIn)] + Self.expiryChoices
    }
```

Change `ForEach(Self.expiryChoices, id: \.value)` to `ForEach(shownExpiryChoices, id: \.value)`. In the spending `Picker("Per", …)`, add before `Text("Lifetime").tag(Int64(0))`:

```swift
                            if ![0, 86_400, 604_800].contains(model.draft.spendPeriodSeconds) {
                                Text(SessionReview.periodLabel(model.draft.spendPeriodSeconds))
                                    .tag(model.draft.spendPeriodSeconds)
                            }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `make test.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add ios/GnokeyMobile/Core/DeepLink.swift ios/GnokeyMobile/Core/AppModel.swift ios/GnokeyMobile/Core/Models.swift ios/GnokeyMobile/Screens/ConnectConsentView.swift ios/GnokeyMobile/Screens/PermissionBuilderView.swift ios/GnokeyMobileTests/SessionDraftTests.swift
git commit -m "feat(ios): sessions in connect's features, and a session for an app's scope hints"
```

---

### Task 8: Round trip on the simulator: Bubble Rumble ↔ gnokey-mobile

**Files:**
- none in the repository. Record each step's outcome in the plan's ledger, and any bug as a fix commit with its test (TDD; a Swift unit test where the logic is pure, otherwise the reproduction steps in the ledger).

**Interfaces:**
- Consumes: everything above; Bubble Rumble's Session screen (`~/bubblerumble`: "Get a session from gnokey-mobile", "Renew / change the budget", "Revoke"); `npm run gnodev`; the iOS 26.5 simulator `CB3A9D85-7138-421B-9110-31B94C3DB491` driven with idb. See the user's notes on idb-companion ≥ 1.6.4, never sending Return, and `USER=remi` for brew.

The desktop signer is a gnokey built from `go.mod`'s gno (`make build/gnokey`), with test1 recovered into a scratch home:

```bash
cd ~/gnokey-mobile && make build/gnokey
H=$(mktemp -d)/gk
printf '%s\n\n\n' "source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast" \
  | ./build/gnokey add test1 --recover --insecure-password-stdin -home "$H"
```

To run a command the wallet shows, read it from the simulator (Copy, then `xcrun simctl pbpaste CB3A9D85-7138-421B-9110-31B94C3DB491`). Insert `-home "$H" -insecure-password-stdin` after `gnokey maketx session create|revoke` and after `gnokey sign`, and `-home "$H"` after `gnokey broadcast`. Feed an empty password on stdin.

- [ ] **Step 1: Set up**

1. Run `npm run gnodev` in `~/bubblerumble`.
2. Install the wallet: `make install.ios device=CB3A9D85-7138-421B-9110-31B94C3DB491`.
3. In the wallet, set the network to `http://127.0.0.1:26657`, chain `dev`. Create an account whose master is test1 (`g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5`, key name `test1`). Run its command to authorize it.
4. Run Bubble Rumble on the same simulator (`npx expo run:ios --device CB3A9D85-7138-421B-9110-31B94C3DB491` in `~/bubblerumble`).

Expected: both apps are installed; the wallet's account shows Active.

- [ ] **Step 2: Grant**

In Bubble Rumble, Session → "Get a session from gnokey-mobile". The wallet opens the review: requested by `bubblerumble://`, the network, identity test1, BR's allow entries, the budget with its worst case, the lifetime, no expired sessions. Approve, run the command in the terminal, wait.
Expected: the wallet answers. Bubble Rumble shows the session active with the granted budget, and `auth/accounts/g1jg8…/session/<addr>` exists on gnodev.

- [ ] **Step 3: A link delivered twice**

Copy BR's last request URL from Metro's log, or have BR send a new one. Open it twice quickly: `xcrun simctl openurl CB3A9D85-… '<url>'` twice, then confirm "Open in Gnokey?".
Expected: a single review. The second copy is dropped, so no second answer reaches BR.

- [ ] **Step 4: Background during the handoff**

Start a renewal in BR ("Renew / change the budget"), approve in the wallet, then send the wallet to the background (`xcrun simctl launch … land.gno.bubblerumble` or the home gesture) before running the command. Run it, then bring the wallet back.
Expected: the wallet resumes polling and answers; BR shows the renewed session and the old one revoked (`revoked` in the reply).

- [ ] **Step 5: Network switch**

Switch the wallet to another chain in Settings, then start a grant from BR (chain `dev`).
- Expected on "Keep current": BR receives `network_declined`.
- Expected on a second try with "Switch": the review shows chain `dev` and proceeds.

- [ ] **Step 6: A pin the wallet does not hold**

Open a session link pinned to another identity. Build it with the P2-M1 test helper, or edit `signer` in a copied BR request (the signature then fails with `invalid_proof`, which also checks that path).
Expected: `signer_unavailable` (or `invalid_proof` for the edited copy), and no review.

- [ ] **Step 7: Stale document**

Start a renewal (a document flow), approve, and before running the command send any transaction as test1 from the terminal. For example: `./build/gnokey maketx send -send 1ugnot -to g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5 -gas-fee 1000000ugnot -gas-wanted 2000000 -broadcast -chainid dev -remote 127.0.0.1:26657 -home "$H" -insecure-password-stdin test1`.
Expected: the wallet replaces the command and says why; the new one goes through.

- [ ] **Step 8: Disconnect**

In BR, Session → "Revoke". The wallet shows the session to revoke; approve, run the command.
Expected: the session is gone on gnodev, and BR shows no session. To check the no-callback case, open the same `disconnect` link without its `callback` parameter (re-signed with the P2-M1 test helper). Expected: the revocation completes and the sheet closes without opening anything.

- [ ] **Step 9: Identity-only connect with hints**

Open `land.gno.gnokey://connect?allow=vm%2Fexec%3Agno.land%2Fr%2Fdemo%2Fother&spend=1000000ugnot&period=3600&expires=86400&chainid=dev&callback=bubblerumble%3A%2F%2Fsession-callback&state=h1`.
Expected:
- The consent sheet lists the hints and says the selected session does not cover them.
- "Create a session for this app" opens the builder pre-filled: that entry, 1000000ugnot, per hour, 1 day.
- Once authorized, the consent sheet comes back; approving answers with `features=sendtx,signtx,sessions` and the new session.

- [ ] **Step 10: Ledger**

Record each step's outcome in the ledger. Fix every bug found with a failing test first: a Swift unit test where the logic is pure, otherwise the reproduction steps in the ledger. Commit each fix as `fix(ios): …`.

---

## After this milestone

- Spec §9: P2-M2 delivered, with the round trip's findings.
- The P2-M3 (Android) plan, from the same bridge and the screen decisions taken here.
