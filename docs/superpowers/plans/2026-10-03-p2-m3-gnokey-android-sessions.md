# P2-M3 — gnokey-mobile Android: session requests (`connect` with a key, `disconnect`, scope hints) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Android app of gnokey-mobile answers GnoConnect session requests end to end, as the iOS app does since P2-M2. It routes `connect` with `pubkey` and `disconnect` to a review that follows the spec's Review section and lets the user narrow (never widen) a grant. It hands the transaction to the desktop with the existing command block, watches the chain, and answers the producer's callback. An identity-only `connect` lists `sessions` in its features and checks its scope hints against the selected session, offering to create one that covers them.

**Architecture:** All protocol work stays in the Go bridge (P2-M1, P2-M1b, plus `NewSessionRequest` from P2-M2): `AcceptSessionRequest`, `PlanSessionRequest`, `BuildSessionTx`, `PollSessionOutcome`, `ParseScopeHints`, `SessionCoversHints`. Kotlin mirrors the Swift of P2-M2 one for one:
- typed mirrors, a JSON codec and the identity helpers (`SessionModels.kt`);
- pure review helpers (`SessionReview.kt`);
- one flow state in `AppViewModel` (`pendingSession`), from acceptance to the answer;
- one full-screen dialog holding the review (`SessionRequestScreen`) and then the handoff (`SessionHandoffPane`).

Pure logic is unit-tested on the JVM (JUnit 4, `android.net.Uri` unavailable there, so every tested helper takes strings). Screens and routing are checked by a manual round trip on the Android emulator against Bubble Rumble and gnodev.

**Tech Stack:** Kotlin 2.1.20, Jetpack Compose (BOM 2025.05.00, Material 3), kotlinx-serialization-json 1.8.1, JUnit 4.13.2, AGP 8.10.1, JDK 17; `android/libs/gnocore.aar` built by `make build.android` from `mobile/` (gomobile, Java package `gnolang.gno.mobile`).

**Spec:**
- `~/bubblerumble/docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` §4 (iOS and Android), §9 (native contract of the internal codes; P2-M2's findings).
- `~/bubblerumble/gnoconnect-session.md`: Parameters, `connect` with a key, Renewal and rotation, `disconnect`, Obtaining the identity's signature, Review, Callback results, Wallet housekeeping, `connect` features, `connect` without a key: scope hints.
- The screen decisions of `docs/superpowers/plans/2026-10-03-p2-m2-gnokey-ios-sessions.md`, kept unless this plan says otherwise.

## Global Constraints

- **Repository and build:**
  - Work in `~/gnokey-mobile`, branch `feat/deeplink-tx` (PR #138), committing on top of `2295ea1`. No new branch. Push only when the user asks.
  - No new dependency: no Gradle artifact (no Robolectric, no mockk), no Go module.
  - `android/libs/gnocore.aar` is git-ignored and built by `make build.android` (~10 min). The one present at the start (2026-10-03 09:41) predates `NewSessionRequest`: rebuild it first (Task 0), and again whenever `core/` or `mobile/` change.
  - Unit tests: `make test.android` (Task 0) — JVM only, no device.
  - Never use `android.net.Uri` in a function a unit test calls: give it a string overload and test that.
- **Bridge contract (gomobile Java):**
  - Hand a request back with `Mobile.newSessionRequest(url)`, never `SessionRequest().apply { url = … }`. The Java setter works, but one way on both platforms keeps the next reader from re-learning the Objective-C trap.
  - Kotlin property names follow the Java getters: `getURL` → `url`, `getRPC` → `rpc`, `getChainID` → `chainID`, `getAllowJSON` → `allowJSON`, `getAlreadyGranted` → `alreadyGranted`. If the compiler disagrees, use its names and ledger the difference.
- **Answering the callback:**
  - Every answer goes through `DeepLink.responseUri(callback, pairs)`, which handles the query vs fragment placement and refuses an unsafe callback.
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
  - A hinted `expires` counts from the arrival of the `connect`, minus 60 s of slack (P2-M2 fix `2295ea1`).
- **Commits:** follow the repo: `feat(android): …`, `test(android): …`, `fix(android): …`, `build: …`; no attribution trailer.

## Review Focus

- The same session link delivered twice (a double tap, or the activity recreated by a rotation, a process restore or a launch from Recents, all of which hand the launching intent back) opens one review and is answered once. Pinned in Task 4 (the `savedInstanceState` / `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` guard) and Task 8, steps 3 and 4.
- A session link that cold-launches the wallet is handled once the bridge is up, not lost. iOS parks it; here the coroutine waits on `bridgeReady`. The same applies to an identity-only `connect`'s hints, which iOS loses on a cold launch. Pinned in Task 4 and Task 8, step 2 (BR launches the wallet cold).
- A request pinned to an identity the wallet does not hold is answered `signer_unavailable`, never reviewed under another identity. Pinned in Task 4's `SessionFlowTest`, and Task 8, step 6.
- Declining the network switch for a session request answers `network_declined`; accepting it plans on the new chain. Pinned in Task 8, step 5.
- The app sent to the background during the desktop handoff resumes polling and answers once the chain shows the result, and a Stale document is replaced by a fresh command. Pinned in Task 8, steps 4 and 7.

---

## File Structure

All paths under `~/gnokey-mobile`; Kotlin sources under `android/app/src/main/java/land/gno/gnokey/`, tests under `android/app/src/test/java/land/gno/gnokey/`.

- `Makefile` — modify: `test.android` target (Task 0).
- `Models.kt` — modify: the session codes and `protocolCode` in `BridgeException` (Task 1); `SessionDraft.applying(_)` (Task 7).
- `SessionModels.kt` — create: `SessionRequestInfo`, `ChainSession`, `SessionPlanInfo`, `SessionGrantDraft`, `SessionTxInfo`, `SessionOutcomeInfo`, `ScopeHintsInfo`, `SessionFlow`, `SessionCodec`, `Identity`, `Identities` (Task 2; `Identities` used from Task 4).
- `BridgeClient.kt` — modify: the six session calls (Task 2).
- `SessionReview.kt` — create: pure review helpers (Task 3).
- `DeepLink.kt` — modify: `DISCONNECT_HOST`, `isSessionRequest`, `callbackTrust`, `handles` (Task 4); `ConnectRequest.hints`, `receivedAtMillis` (Task 7).
- `AppViewModel.kt` — modify: the session flow (Task 4); hints and `features` (Task 7).
- `MainActivity.kt` — modify: intent re-delivery guard (Task 4); the session dialog (Task 5).
- `screens/ConnectConsentDialog.kt` — modify: `DeepLink.callbackTrust` (Task 4); hints card (Task 7).
- `screens/SessionRequestScreen.kt` — create (Task 5).
- `screens/SessionHandoffPane.kt` — create (Task 6).
- `screens/PermissionBuilderScreen.kt` — modify: requested expiry and period choices (Task 7).
- Tests: `BridgeExceptionTest.kt`, `SessionCodecTest.kt`, `SessionReviewTest.kt`, `SessionFlowTest.kt`, `SessionDraftTest.kt` (create); `DeepLinkTest.kt` (modify).

---

### Task 0: Baseline: a current AAR and a `test.android` target

**Files:**
- Modify: `Makefile`

**Interfaces:**
- Produces: `make test.android` — builds the AAR if `core/`/`mobile/` changed, then runs the app's JVM unit tests.

- [ ] **Step 1: Rebuild the AAR from the current bridge**

Run: `cd ~/gnokey-mobile && git status -sb | head -1 && make build.android`
Expected: `## feat/deeplink-tx...origin/feat/deeplink-tx`, then exit 0. Check that the new constructor is exported:

```bash
d=$(mktemp -d) && unzip -q -o android/libs/gnocore.aar classes.jar -d "$d" && javap -cp "$d/classes.jar" gnolang.gno.mobile.Mobile | grep newSessionRequest
```
Expected: `public static native gnolang.gno.mobile.SessionRequest newSessionRequest(java.lang.String);`

- [ ] **Step 2: Add the target**

In `Makefile`, after the `.PHONY: test.ios` line, add:

```make

# JVM unit tests of the Android app: no device needed. The aar is a
# prerequisite because the app's sources compile against it.
test.android: $(gnocore_aar)
	cd android && ./gradlew --console=plain -q :app:testDebugUnitTest
.PHONY: test.android
```

- [ ] **Step 3: Run the existing tests**

Run: `make test.android`
Expected: exit 0, no output (`-q`); `android/app/build/test-results/testDebugUnitTest/TEST-land.gno.gnokey.DeepLinkTest.xml` reports `failures="0"`.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "build: make test.android runs the Android JVM unit tests"
```

---

### Task 1: The session codes in `BridgeException`

**Files:**
- Modify: `android/app/src/main/java/land/gno/gnokey/Models.kt`
- Test: `android/app/src/test/java/land/gno/gnokey/BridgeExceptionTest.kt`

**Interfaces:**
- Produces: `BridgeException.Code` entries `INVALID_REQUEST`, `INVALID_PROOF`, `STALE_REQUEST`, `SIGNER_UNAVAILABLE`, `SESSION_EXPIRED`, `SESSION_NOT_FOUND`, `SESSION_LIMIT`, `REPLAYED`, `ALREADY_DONE`, `WRONG_NETWORK`; `val protocolCode: String?` — the code to answer the callback with, or null when the app must not answer it.

- [ ] **Step 1: Write the failing test**

`BridgeExceptionTest.kt`:

```kotlin
package land.gno.gnokey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BridgeExceptionTest {
    /** The GnoConnect codes the bridge raises are what the producer is told. */
    @Test
    fun protocolCodesAreAnsweredVerbatim() {
        for (code in listOf("invalid_request", "invalid_proof", "stale_request", "signer_unavailable",
            "session_expired", "session_not_found", "session_limit")) {
            assertEquals(code, BridgeException("[$code] some detail").protocolCode)
        }
    }

    /** The wallet's own codes are acted on, never answered. */
    @Test
    fun walletCodesAreNeverAnswered() {
        for (code in listOf("replayed", "already_done", "wrong_network", "invalid_spec", "network", "internal")) {
            assertNull(code, BridgeException("[$code] some detail").protocolCode)
        }
        assertEquals(BridgeException.Code.REPLAYED, BridgeException("[replayed] x").code)
        assertEquals(BridgeException.Code.ALREADY_DONE, BridgeException("[already_done] x").code)
        assertEquals(BridgeException.Code.WRONG_NETWORK, BridgeException("[wrong_network] x").code)
        assertEquals("g1… has 16 sessions", BridgeException("[session_limit] g1… has 16 sessions").userMessage)
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.android`
Expected: FAIL — test compilation: `Unresolved reference 'protocolCode'` and `'REPLAYED'`.

- [ ] **Step 3: Add the codes**

In `Models.kt`, in `enum class Code`, after `INTERNAL("internal"),`:

```kotlin
        // GnoConnect session requests (gnoconnect-session.md, Callback results).
        INVALID_REQUEST("invalid_request"),
        INVALID_PROOF("invalid_proof"),
        STALE_REQUEST("stale_request"),
        SIGNER_UNAVAILABLE("signer_unavailable"),
        SESSION_EXPIRED("session_expired"),
        SESSION_NOT_FOUND("session_not_found"),
        SESSION_LIMIT("session_limit"),
        // The bridge's internal codes: acted on, never answered (spec §9).
        REPLAYED("replayed"),
        ALREADY_DONE("already_done"),
        WRONG_NETWORK("wrong_network"),
```

In `shortTitle`, before `Code.INTERNAL, Code.UNKNOWN -> "Error"`:

```kotlin
            Code.INVALID_REQUEST, Code.INVALID_PROOF, Code.STALE_REQUEST -> "Invalid Request"
            Code.SIGNER_UNAVAILABLE -> "Identity Not Held"
            Code.SESSION_EXPIRED -> "Session Expired"
            Code.SESSION_NOT_FOUND -> "Session Not Found"
            Code.SESSION_LIMIT -> "Too Many Sessions"
            Code.REPLAYED -> "Already Handled"
            Code.ALREADY_DONE -> "Already Done"
            Code.WRONG_NETWORK -> "Wrong Network"
```

and after `shortTitle`:

```kotlin

    /**
     * The code a session request is answered with (`status=error&code=…`),
     * verbatim from the bridge — or null for the wallet's own codes, which are
     * acted on and never answered: `replayed` (drop the copy), `already_done`
     * (keep polling), `wrong_network` (resolve the network first), and input,
     * network or internal failures, which the user sees and retries.
     */
    val protocolCode: String?
        get() = when (code) {
            Code.INVALID_REQUEST, Code.INVALID_PROOF, Code.STALE_REQUEST, Code.SIGNER_UNAVAILABLE,
            Code.SESSION_EXPIRED, Code.SESSION_NOT_FOUND, Code.SESSION_LIMIT -> code.wire
            else -> null
        }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test.android`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/land/gno/gnokey/Models.kt android/app/src/test/java/land/gno/gnokey/BridgeExceptionTest.kt
git commit -m "feat(android): the session request codes, and which of them the producer hears"
```

---

### Task 2: Session models, their codec, and the bridge calls

**Files:**
- Create: `android/app/src/main/java/land/gno/gnokey/SessionModels.kt`
- Modify: `android/app/src/main/java/land/gno/gnokey/BridgeClient.kt`
- Test: `android/app/src/test/java/land/gno/gnokey/SessionCodecTest.kt`

**Interfaces:**
- Consumes (`gnolang.gno.mobile`, generated from `mobile/sessions.go`):
  - `Bridge.acceptSessionRequest(String): SessionRequest`
  - `Bridge.planSessionRequest(SessionRequest, String): SessionPlan`
  - `Bridge.buildSessionTx(SessionRequest, String, SessionGrant, String, String): SessionTx`
  - `Bridge.pollSessionOutcome(SessionRequest, String, SessionTx): SessionOutcome`
  - `Bridge.parseScopeHints(String): ScopeHints`
  - `Bridge.sessionCoversHints(String, String, ScopeHints): Boolean`
  - `Mobile.newSessionRequest(String): SessionRequest`
- Produces: the Kotlin types below, `DeepLink.DISCONNECT_HOST`, and these `BridgeClient` suspend functions:
  - `acceptSessionRequest(url: String): SessionRequestInfo`
  - `planSessionRequest(request: SessionRequestInfo, identity: String): SessionPlanInfo`
  - `buildSessionTx(request, identity, grant: SessionGrantDraft, revokeExpired: List<String>, masterKeyName: String): SessionTxInfo`
  - `pollSessionOutcome(request, identity, tx: SessionTxInfo): SessionOutcomeInfo`
  - `parseScopeHints(url: String): ScopeHintsInfo?`
  - `sessionCoversHints(masterAddress: String, sessionAddress: String, hints: ScopeHintsInfo): Boolean`

- [ ] **Step 1: Write the failing test**

`SessionCodecTest.kt`:

```kotlin
package land.gno.gnokey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionCodecTest {
    /** A reply crosses the bridge as `[key, value]` pairs in callback order;
     *  `allow` repeats, so a map would lose entries. */
    @Test
    fun replyPairsKeepCallbackOrder() {
        val pairs = SessionCodec.pairs("""[["status","success"],["allow","a"],["allow","b"],["state","s"]]""")
        assertEquals(listOf(listOf("status", "success"), listOf("allow", "a"), listOf("allow", "b"), listOf("state", "s")), pairs)
        assertEquals(listOf("a", "b"), SessionCodec.values("allow", pairs))
        assertEquals("s", SessionCodec.value("state", pairs))
        assertNull(SessionCodec.value("revoked", pairs))
        assertEquals(listOf("status", "allow", "allow", "state"), SessionCodec.tuples(pairs).map { it.first })
    }

    @Test
    fun emptyFieldsDecodeToNothing() {
        assertEquals(emptyList<List<String>>(), SessionCodec.pairs(""))
        assertNull(SessionCodec.session(""))
        assertEquals(emptyList<ChainSession>(), SessionCodec.sessions("[]"))
        assertEquals(emptyList<String>(), SessionCodec.strings(""))
    }

    /** The shape `mobile/sessions.go` writes (`sessionJSON`). */
    @Test
    fun sessionsAsTheBridgeWritesThem() {
        val json = """[{"address":"g1x","pubKey":"gpub1x","expiresAt":1,"allowPaths":["bank/send"],"spendLimit":"1ugnot","spendPeriod":60}]"""
        assertEquals(
            listOf(ChainSession("g1x", "gpub1x", 1, listOf("bank/send"), "1ugnot", 60)),
            SessionCodec.sessions(json),
        )
        assertEquals("""["a","b"]""", SessionCodec.json(listOf("a", "b")))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.android`
Expected: FAIL — `Unresolved reference 'SessionCodec'`.

- [ ] **Step 3: Write the models**

`SessionModels.kt`:

```kotlin
package land.gno.gnokey

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * A verified GnoConnect session request — a `connect` naming the producer's
 * key, or a `disconnect` — as [BridgeClient.acceptSessionRequest] returns it.
 * The fields are for display: every later bridge call reads the request from
 * [url] again, so nothing held here can change what the producer signed.
 * Mirrors the iOS `SessionRequestInfo`.
 */
data class SessionRequestInfo(
    val url: String,
    val host: String,
    val pubKey: String,
    val old: String,
    val allow: List<String>,
    val spend: String,
    val period: Long,
    val expires: Long,
    val chainID: String,
    val rpc: String,
    val signer: String,
    val callback: String,
    val state: String,
) {
    val isDisconnect: Boolean get() = host == DeepLink.DISCONNECT_HOST
}

/** One session of the identity as the chain stores it (`sessionJSON` in the bridge). */
@Serializable
data class ChainSession(
    val address: String,
    val pubKey: String,
    val expiresAt: Long,
    val allowPaths: List<String> = emptyList(),
    val spendLimit: String = "",
    val spendPeriod: Long = 0,
) {
    /** Unix milliseconds; null for a session without expiry. */
    val expiryMillis: Long? get() = if (expiresAt > 0) expiresAt * 1000 else null
}

/** What a request does on chain, decided before the user is asked anything
 *  (see `core.SessionPlan`). */
data class SessionPlanInfo(
    val identity: String,
    val sessionAddress: String,
    /** The key is already a live session: approving answers [reply], no transaction. */
    val alreadyGranted: Boolean,
    val reply: List<List<String>>,
    val hasOld: Boolean,
    val oldOnChain: Boolean,
    val old: ChainSession?,
    val target: ChainSession?,
    /** Expired sessions the transaction may revoke; [mustRevoke] of them must go. */
    val expired: List<ChainSession>,
    val mustRevoke: Int,
)

/** The grant the user approved: the request's, or narrower. */
data class SessionGrantDraft(
    val allow: List<String> = emptyList(),
    val spend: String = "",
    val period: Long = 0,
    val expires: Long = 0,
)

/** The desktop command for a request's transaction (see `core.SessionTx`). */
data class SessionTxInfo(
    val command: String,
    val document: String,
    val signsDocument: Boolean,
    val revokes: List<String>,
    val gasWanted: Long,
    val gasFee: String,
    val accountNumber: Long,
    val sequence: Long,
)

/** One look at the chain while the desktop signs. */
data class SessionOutcomeInfo(val done: Boolean, val stale: Boolean, val reply: List<List<String>>)

/** What an identity-only `connect` says the producer will send through the wallet. */
data class ScopeHintsInfo(
    val allow: List<String>,
    val spend: String,
    val period: Long,
    val expires: Long,
) {
    /**
     * The hints [elapsedSeconds] after they arrived. The producer asked for
     * [expires] from its request, so a session created since for exactly that
     * lifetime has to count as covering it; checked against "now + expires"
     * instead, it never would. A minute of slack absorbs block time trailing
     * the clock. (P2-M2 round trip, `2295ea1`.)
     */
    fun remaining(elapsedSeconds: Long): ScopeHintsInfo =
        if (expires <= 0) this else copy(expires = maxOf(0L, expires - elapsedSeconds - 60))
}

/** A session request in progress, from acceptance to the answer. */
data class SessionFlow(
    val request: SessionRequestInfo,
    /** The identity that grants or revokes, and its key name in desktop gnokey. */
    val identity: String,
    val masterKeyName: String,
    /** Set once the user approved: the command shown, and what rebuilds it. */
    val tx: SessionTxInfo? = null,
    val grant: SessionGrantDraft = SessionGrantDraft(),
    val revokeExpired: List<String> = emptyList(),
)

/** A master identity the app can act for, with its key name in desktop gnokey. */
data class Identity(val address: String, val masterKeyName: String)

object Identities {
    /** The distinct masters among [accounts], in account order, each with the
     *  first non-empty key name recorded for it. */
    fun of(accounts: List<Account>): List<Identity> {
        val out = mutableListOf<Identity>()
        for (account in accounts) {
            if (account.masterAddress.isEmpty()) continue
            val i = out.indexOfFirst { it.address == account.masterAddress }
            if (i < 0) {
                out += Identity(account.masterAddress, account.masterKeyName)
            } else if (out[i].masterKeyName.isEmpty()) {
                out[i] = out[i].copy(masterKeyName = account.masterKeyName)
            }
        }
        return out
    }

    /**
     * The identity a request is reviewed under: the pinned [signer] (bech32,
     * compared case-insensitively) or null when the wallet does not hold it;
     * without a pin, [preferring] (the selected account's master) or the first.
     */
    fun forSigner(signer: String, among: List<Identity>, preferring: String?): Identity? {
        if (signer.isNotEmpty()) return among.firstOrNull { it.address.equals(signer, ignoreCase = true) }
        return among.firstOrNull { it.address == preferring } ?: among.firstOrNull()
    }
}

/** The JSON fields of the bridge's session types. */
object SessionCodec {
    private val format = Json { ignoreUnknownKeys = true }

    /** A callback reply as `[key, value]` pairs in callback order; empty for "". */
    fun pairs(text: String): List<List<String>> = decode(text) ?: emptyList()

    fun strings(text: String): List<String> = decode(text) ?: emptyList()

    fun session(text: String): ChainSession? = decode(text)

    fun sessions(text: String): List<ChainSession> = decode(text) ?: emptyList()

    fun json(items: List<String>): String = format.encodeToString(items)

    /** The pairs [DeepLink.responseUri] takes. */
    fun tuples(pairs: List<List<String>>): List<Pair<String, String>> =
        pairs.mapNotNull { if (it.size == 2) it[0] to it[1] else null }

    fun value(key: String, pairs: List<List<String>>): String? =
        pairs.firstOrNull { it.size == 2 && it[0] == key }?.get(1)

    fun values(key: String, pairs: List<List<String>>): List<String> =
        pairs.filter { it.size == 2 && it[0] == key }.map { it[1] }

    private inline fun <reified T> decode(text: String): T? =
        if (text.isEmpty()) null else runCatching { format.decodeFromString<T>(text) }.getOrNull()
}
```

In `DeepLink.kt`, after `const val CONNECT_HOST = "connect"`, add `const val DISCONNECT_HOST = "disconnect"` (Task 4 builds the routing on it).

- [ ] **Step 4: Add the bridge calls**

In `BridgeClient.kt`, add to the imports:

```kotlin
import gnolang.gno.mobile.ScopeHints
import gnolang.gno.mobile.SessionGrant
import gnolang.gno.mobile.SessionRequest
import gnolang.gno.mobile.SessionTx
```

Before `// --- helpers`, add:

```kotlin
    // --- GnoConnect sessions

    /** Verifies a session link: shape, proof of possession, iat window, replay. */
    suspend fun acceptSessionRequest(url: String): SessionRequestInfo = withContext(Dispatchers.IO) {
        wrap {
            val r = require().acceptSessionRequest(url)
            SessionRequestInfo(
                url = r.url, host = r.host, pubKey = r.pubKey, old = r.old,
                allow = SessionCodec.strings(r.allowJSON), spend = r.spend, period = r.period,
                expires = r.expires, chainID = r.chainID, rpc = r.rpc, signer = r.signer,
                callback = r.callback, state = r.state,
            )
        }
    }

    suspend fun planSessionRequest(request: SessionRequestInfo, identity: String): SessionPlanInfo =
        withContext(Dispatchers.IO) {
            wrap {
                val p = require().planSessionRequest(goSessionRequest(request), identity)
                SessionPlanInfo(
                    identity = p.identity, sessionAddress = p.sessionAddress,
                    alreadyGranted = p.alreadyGranted, reply = SessionCodec.pairs(p.replyJSON),
                    hasOld = p.hasOld, oldOnChain = p.oldOnChain,
                    old = SessionCodec.session(p.oldJSON), target = SessionCodec.session(p.targetJSON),
                    expired = SessionCodec.sessions(p.expiredJSON), mustRevoke = p.mustRevoke.toInt(),
                )
            }
        }

    /** Only after a successful [planSessionRequest] for the same request and
     *  identity: that is what makes `already_done` on a disconnect a success. */
    suspend fun buildSessionTx(
        request: SessionRequestInfo, identity: String, grant: SessionGrantDraft,
        revokeExpired: List<String>, masterKeyName: String,
    ): SessionTxInfo = withContext(Dispatchers.IO) {
        wrap {
            val g = SessionGrant().apply {
                allowJSON = SessionCodec.json(grant.allow)
                spend = grant.spend
                period = grant.period
                expires = grant.expires
            }
            val tx = require().buildSessionTx(
                goSessionRequest(request), identity, g, SessionCodec.json(revokeExpired), masterKeyName)
            SessionTxInfo(
                command = tx.command, document = tx.document, signsDocument = tx.signsDocument,
                revokes = SessionCodec.strings(tx.revokesJSON), gasWanted = tx.gasWanted,
                gasFee = tx.gasFee, accountNumber = tx.accountNumber, sequence = tx.sequence,
            )
        }
    }

    suspend fun pollSessionOutcome(
        request: SessionRequestInfo, identity: String, tx: SessionTxInfo,
    ): SessionOutcomeInfo = withContext(Dispatchers.IO) {
        wrap {
            val t = SessionTx().apply {
                command = tx.command
                document = tx.document
                signsDocument = tx.signsDocument
                revokesJSON = SessionCodec.json(tx.revokes)
                gasWanted = tx.gasWanted
                gasFee = tx.gasFee
                accountNumber = tx.accountNumber
                sequence = tx.sequence
            }
            val o = require().pollSessionOutcome(goSessionRequest(request), identity, t)
            SessionOutcomeInfo(o.done, o.stale, SessionCodec.pairs(o.replyJSON))
        }
    }

    /** The scope hints of an identity-only `connect`; null when it carries none. */
    suspend fun parseScopeHints(url: String): ScopeHintsInfo? = withContext(Dispatchers.IO) {
        wrap {
            val h = require().parseScopeHints(url)
            if (!h.present) null
            else ScopeHintsInfo(SessionCodec.strings(h.allowJSON), h.spend, h.period, h.expires)
        }
    }

    suspend fun sessionCoversHints(
        masterAddress: String, sessionAddress: String, hints: ScopeHintsInfo,
    ): Boolean = withContext(Dispatchers.IO) {
        wrap {
            val h = ScopeHints().apply {
                present = true
                allowJSON = SessionCodec.json(hints.allow)
                spend = hints.spend
                period = hints.period
                expires = hints.expires
            }
            require().sessionCoversHints(masterAddress, sessionAddress, h)
        }
    }
```

and in `// --- helpers`:

```kotlin
    /** The bridge reads a request from its URL alone; the other fields are
     *  display copies and are not sent back. Built by the bridge's constructor,
     *  as on iOS, where the URL setter never reached Go (P2-M2, `63b95f6`). */
    private fun goSessionRequest(request: SessionRequestInfo): SessionRequest =
        Mobile.newSessionRequest(request.url)
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `make test.android`
Expected: exit 0 (the main sources compile against the AAR, and `SessionCodecTest` passes).

- [ ] **Step 6: Commit**

```bash
git add android/app/src/main/java/land/gno/gnokey/SessionModels.kt android/app/src/main/java/land/gno/gnokey/BridgeClient.kt android/app/src/main/java/land/gno/gnokey/DeepLink.kt android/app/src/test/java/land/gno/gnokey/SessionCodecTest.kt
git commit -m "feat(android): session request models and the bridge calls behind them"
```

---

### Task 3: Review helpers

**Files:**
- Create: `android/app/src/main/java/land/gno/gnokey/SessionReview.kt`
- Test: `android/app/src/test/java/land/gno/gnokey/SessionReviewTest.kt`

**Interfaces:**
- Consumes: `ChainSession`, `SessionGrantDraft` (Task 2).
- Produces:
  - `object SessionReview` with `risk(entry)`, `budget(spend, period)`, `worstCase(spend, period, lifetime)`, `coins(coins, times = 1)`, `duration(seconds, singular = false)`, `periodLabel(period)`, `lifetimeChoices(requested)`, `periodChoices(requested)`, `widenings(old, new, nowSeconds)`;
  - `sealed interface Widening { LongerLife, HigherLimit, FasterReset, NewEntries(entries) }`.

- [ ] **Step 1: Write the failing test**

`SessionReviewTest.kt`:

```kotlin
package land.gno.gnokey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class SessionReviewTest {
    /** gnoconnect-session.md, Review: "5 GNOT per hour" and "at most 3,600 GNOT over 30 days". */
    @Test
    fun theSpecExample() {
        assertEquals("5 GNOT per hour", SessionReview.budget("5000000ugnot", 3600))
        assertEquals("at most 3,600 GNOT over 30 days", SessionReview.worstCase("5000000ugnot", 3600, 2_592_000))
    }

    @Test
    fun aLifetimeCap() {
        assertEquals("1.5 GNOT in total", SessionReview.budget("1500000ugnot", 0))
        assertEquals("at most 1.5 GNOT over 1 day", SessionReview.worstCase("1500000ugnot", 0, 86_400))
        assertNull(SessionReview.budget("", 3600))
        assertNull(SessionReview.worstCase("", 3600, 86_400))
    }

    /** A window that has started counts whole: 25 hours with a daily period is two windows. */
    @Test
    fun aPartialWindowCounts() {
        assertEquals("at most 2 GNOT over 25 hours", SessionReview.worstCase("1000000ugnot", 86_400, 90_000))
    }

    @Test
    fun otherDenominationsStayRaw() {
        assertEquals("12 foo + 3 GNOT", SessionReview.coins("12foo,3000000ugnot"))
        assertEquals("0.000001 GNOT", SessionReview.coins("1ugnot"))
    }

    @Test
    fun durations() {
        assertEquals("1 hour", SessionReview.duration(3600))
        assertEquals("hour", SessionReview.duration(3600, singular = true))
        assertEquals("2 hours", SessionReview.duration(7200))
        assertEquals("1 week", SessionReview.duration(604_800))
        assertEquals("30 days", SessionReview.duration(2_592_000))
        assertEquals("90 seconds", SessionReview.duration(90))
        assertEquals("Lifetime", SessionReview.periodLabel(0))
        assertEquals("Per day", SessionReview.periodLabel(86_400))
    }

    /** gnoconnect-session.md, Review: `*`, a bare `vm/exec`, `vm/run`, `bank/send` and `bank/multisend`. */
    @Test
    fun riskyEntries() {
        for (entry in listOf("*", "vm/exec", "vm/run", "bank/send", "bank/multisend")) {
            assertNotNull(entry, SessionReview.risk(entry))
        }
        assertNull(SessionReview.risk("vm/exec:gno.land/r/demo/a"))
    }

    /** The choices offered never widen the request. */
    @Test
    fun choicesNeverWiden() {
        assertEquals(listOf(2_592_000L, 604_800L, 86_400L, 3_600L), SessionReview.lifetimeChoices(2_592_000))
        assertEquals(listOf(600L), SessionReview.lifetimeChoices(600))
        assertEquals(listOf(3600L, 86_400L, 604_800L, 2_592_000L, 0L), SessionReview.periodChoices(3600))
        assertEquals(listOf(0L), SessionReview.periodChoices(0))
    }

    @Test
    fun widenings() {
        val now = 1_790_841_600L
        val old = ChainSession("g1o", "gpub1o", now + 86_400, listOf("bank/send"), "1000000ugnot", 86_400)
        val same = SessionGrantDraft(listOf("bank/send"), "1000000ugnot", 86_400, 86_400)
        assertEquals(emptyList<Widening>(), SessionReview.widenings(old, same, now))

        val wider = SessionGrantDraft(listOf("bank/send", "vm/run"), "2000000ugnot", 3_600, 172_800)
        assertEquals(
            listOf(Widening.LongerLife, Widening.HigherLimit, Widening.FasterReset, Widening.NewEntries(listOf("vm/run"))),
            SessionReview.widenings(old, wider, now),
        )

        // A lifetime cap becoming a resetting budget resets more often.
        val capped = old.copy(spendPeriod = 0)
        assertEquals(listOf(Widening.FasterReset), SessionReview.widenings(capped, same, now))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.android`
Expected: FAIL — `Unresolved reference 'SessionReview'`.

- [ ] **Step 3: Write the helpers**

`SessionReview.kt`:

```kotlin
package land.gno.gnokey

import java.math.BigDecimal
import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.util.Locale

/** What a session grant widens over the session it replaces (gnoconnect-session.md,
 *  Renewal and rotation: "highlight any widening"). */
sealed interface Widening {
    data object LongerLife : Widening
    data object HigherLimit : Widening
    data object FasterReset : Widening
    data class NewEntries(val entries: List<String>) : Widening
}

/** The words the session review uses, kept out of the composables so they are
 *  tested (gnoconnect-session.md, Review). Mirrors the iOS `SessionReview`. */
object SessionReview {
    /** Why an allow entry needs a second look: it reaches arbitrary code or
     *  moves funds directly. Null for a path-scoped entry. */
    fun risk(entry: String): String? = when (entry) {
        "*" -> "Anything this identity can do, including moving its coins."
        "vm/exec" -> "Calls to any realm."
        "vm/run" -> "Runs arbitrary code as this identity."
        "bank/send", "bank/multisend" -> "Sends coins directly."
        else -> null
    }

    /** "5 GNOT per hour", or "5 GNOT in total" for a lifetime cap; null without spending. */
    fun budget(spend: String, period: Long): String? {
        if (spend.isEmpty()) return null
        return if (period == 0L) "${coins(spend)} in total" else "${coins(spend)} per ${duration(period, singular = true)}"
    }

    /** The most the session can spend over its life, since the period resets for
     *  as long as it lives: "at most 3,600 GNOT over 30 days". */
    fun worstCase(spend: String, period: Long, lifetime: Long): String? {
        if (spend.isEmpty() || lifetime <= 0) return null
        val windows = if (period == 0L) 1L else (lifetime + period - 1) / period
        return "at most ${coins(spend, windows)} over ${duration(lifetime)}"
    }

    /** Coins in plain terms: ugnot as GNOT, other denominations as they are. */
    fun coins(coins: String, times: Long = 1): String =
        coins.split(",").joinToString(" + ") { coin(it, times) }

    /** "1 hour", "30 days"; with [singular], a single unit drops its count ("hour"). */
    fun duration(seconds: Long, singular: Boolean = false): String {
        val units = listOf("week" to 604_800L, "day" to 86_400L, "hour" to 3_600L, "minute" to 60L, "second" to 1L)
        val (name, size) = units.firstOrNull { seconds >= it.second && seconds % it.second == 0L } ?: ("second" to 1L)
        val n = seconds / size
        if (n == 1L) return if (singular) name else "1 $name"
        return "$n ${name}s"
    }

    fun periodLabel(period: Long): String =
        if (period == 0L) "Lifetime" else "Per ${duration(period, singular = true)}"

    /** Lifetimes the user may pick: the requested one, then shorter presets. */
    fun lifetimeChoices(requested: Long): List<Long> =
        listOf(requested) + listOf(604_800L, 86_400L, 3_600L).filter { it < requested }

    /** Periods the user may pick: the requested one, longer presets, then a
     *  lifetime cap (0), which never resets and so is the narrowest. */
    fun periodChoices(requested: Long): List<Long> {
        if (requested == 0L) return listOf(0L)
        return listOf(requested) + listOf(86_400L, 604_800L, 2_592_000L).filter { it > requested } + 0L
    }

    /** What [new] grants beyond [old], in the order the review lists them. */
    fun widenings(old: ChainSession, new: SessionGrantDraft, nowSeconds: Long): List<Widening> {
        val out = mutableListOf<Widening>()
        if (old.expiresAt != 0L && nowSeconds + new.expires > old.expiresAt) out += Widening.LongerLife
        if (exceeds(new.spend, old.spendLimit)) out += Widening.HigherLimit
        if (new.spend.isNotEmpty() && new.period != 0L && (old.spendPeriod == 0L || new.period < old.spendPeriod)) {
            out += Widening.FasterReset
        }
        val added = new.allow.filter { it !in old.allowPaths }
        if (added.isNotEmpty()) out += Widening.NewEntries(added)
        return out
    }

    // --- coins

    private fun coin(coin: String, times: Long): String {
        val (amount, denom) = parse(coin) ?: return coin
        val total = amount.multiply(BigDecimal.valueOf(times))
        return if (denom == "ugnot") "${number(total.movePointLeft(6))} GNOT" else "${number(total)} $denom"
    }

    private fun parse(coin: String): Pair<BigDecimal, String>? {
        val trimmed = coin.trim()
        val split = trimmed.indexOfFirst { !it.isDigit() }
        if (split <= 0) return null
        return BigDecimal(trimmed.substring(0, split)) to trimmed.substring(split)
    }

    /** Whether [new] allows more of some denomination than [old]. */
    private fun exceeds(new: String, old: String): Boolean {
        val had = old.split(",").mapNotNull(::parse)
            .groupBy({ it.second }, { it.first })
            .mapValues { (_, amounts) -> amounts.fold(BigDecimal.ZERO, BigDecimal::add) }
        return new.split(",").mapNotNull(::parse).any { (amount, denom) ->
            amount > (had[denom] ?: BigDecimal.ZERO)
        }
    }

    private fun number(value: BigDecimal): String =
        DecimalFormat("#,##0.######", DecimalFormatSymbols(Locale.US)).format(value)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `make test.android`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/land/gno/gnokey/SessionReview.kt android/app/src/test/java/land/gno/gnokey/SessionReviewTest.kt
git commit -m "feat(android): the session review's words — budget, worst case, risky entries, widenings"
```

---

### Task 4: Routing and the session flow in `AppViewModel`

**Files:**
- Modify: `DeepLink.kt`, `AppViewModel.kt`, `MainActivity.kt`, `screens/ConnectConsentDialog.kt`
- Test: `DeepLinkTest.kt` (modify), `SessionFlowTest.kt` (create)

**Interfaces:**
- Consumes: `BridgeClient` session calls, `SessionFlow`, `SessionCodec`, `Identities` (Task 2); `BridgeException.protocolCode` (Task 1).
- Produces:
  - In `DeepLink`: `isSessionRequest(uri: Uri)`, `isSessionRequest(scheme, host, params)` (the pure one the tests use), `callbackTrust(callback)`; `handles` also accepts `disconnect`.
  - In `AppViewModel`: `pendingSession: SessionFlow?` (read-only outside), `identities: List<Identity>`, `selectIdentity(address)`, `startHandoff(tx, grant, revokeExpired, masterKeyName)`, `updateSessionTx(tx)`, `completeSession(reply)`, `failSession(code)`, `cancelSession()`.

Decisions this task fixes:
- **A session request needs an identity the app already holds.** A wallet with no account answers `no_signer` (spec, `connect` with a key, step 1). A pin the app does not hold answers `signer_unavailable`. The pin is matched case-insensitively.
- **One session request at a time.** A second one arriving while one is pending is answered `cancelled` at once: the producer may retry.
- **A link that arrives before the bridge is up** (it launched the app) waits for it. `start()` completes a `CompletableDeferred` once the bridge is open and the legacy account migrated, and the handling coroutine awaits it. It differs from iOS, which parks one URL; a deferred needs no parking slot and serves the hints too (Task 7).
- **An intent handed back is not a new link.** A recreated activity (rotation, process restore) and a launch from Recents receive the launching intent again. `onCreate` reads it only when `savedInstanceState == null`, and never when `FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY` is set. The replay guard would drop a session copy anyway, but not after a process restore (fresh memory, so `stale_request` would answer a request already answered), nor an identity-only `connect`.
- **An unsafe callback.** A `connect` with a key whose callback is unsafe is dropped, like an unsafe identity-only `connect`. So is a `disconnect` whose callback is present but unsafe.

- [ ] **Step 1: Write the failing tests**

Append to `DeepLinkTest.kt`, before its final `}`:

```kotlin

    // --- session requests

    @Test
    fun sessionRequestsAreRecognised() {
        val s = DeepLink.SCHEME
        assertTrue(DeepLink.isSessionRequest(s, "connect", setOf("pubkey", "callback")))
        assertTrue(DeepLink.isSessionRequest(s, "Disconnect", setOf("pubkey")))
        // Scope hints without a key are still an identity-only sign-in.
        assertFalse(DeepLink.isSessionRequest(s, "connect", setOf("allow", "callback")))
        assertFalse(DeepLink.isSessionRequest(s, "sendtx", setOf("pubkey")))
        assertFalse(DeepLink.isSessionRequest("other", "connect", setOf("pubkey")))
        assertFalse(DeepLink.isSessionRequest(s, null, setOf("pubkey")))
    }

    @Test
    fun callbackTrust() {
        assertEquals("Verified web address.", DeepLink.callbackTrust("https://app.example/cb"))
        assertTrue(DeepLink.callbackTrust("bubblerumble://session-callback").startsWith("Custom app link"))
    }
```

`SessionFlowTest.kt`:

```kotlin
package land.gno.gnokey

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionFlowTest {
    private fun account(key: String, master: String, keyName: String) =
        Account(key, "g1s$key", "gpub1$key", master, keyName)

    /** Several accounts may share one master: the identities are the distinct
     *  masters, each with the first key name the app knows for it. */
    @Test
    fun identitiesAreTheDistinctMasters() {
        val ids = Identities.of(listOf(
            account("a", "g1m1", ""), account("b", "g1m1", "main"), account("c", "g1m2", "other"),
        ))
        assertEquals(listOf(Identity("g1m1", "main"), Identity("g1m2", "other")), ids)
    }

    @Test
    fun thePinDecides() {
        val ids = listOf(Identity("g1m1", "a"), Identity("g1m2", "b"))
        // bech32 may come in upper case.
        assertEquals("g1m2", Identities.forSigner("G1M2", ids, "g1m1")?.address)
        // A pin the wallet does not hold: nobody else signs in its place.
        assertNull(Identities.forSigner("g1other", ids, "g1m1"))
        assertEquals("g1m2", Identities.forSigner("", ids, "g1m2")?.address)
        assertEquals("g1m1", Identities.forSigner("", ids, null)?.address)
        assertNull(Identities.forSigner("", emptyList(), null))
    }
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `make test.android`
Expected: FAIL — `Unresolved reference 'isSessionRequest'` and `'callbackTrust'` (`Identities` exists since Task 2, so `SessionFlowTest` alone would pass: it pins Task 2's helpers where they are first used).

- [ ] **Step 3: Routing helpers in `DeepLink`**

In `DeepLink.kt`, replace `handles`:

```kotlin
    fun handles(host: String?): Boolean = host in HOSTS || host == CONNECT_HOST || host == DISCONNECT_HOST
```

and add after `hostOf`:

```kotlin

    /**
     * A GnoConnect session request: `disconnect`, or a `connect` naming the
     * producer's key (`pubkey`). A `connect` without one stays a sign-in, hints
     * or not.
     */
    fun isSessionRequest(uri: Uri): Boolean =
        uri.isHierarchical && isSessionRequest(uri.scheme, uri.host, uri.queryParameterNames)

    /** [isSessionRequest] on the parts of a link, so it is testable on the JVM. */
    fun isSessionRequest(scheme: String?, host: String?, params: Set<String>): Boolean {
        if (scheme != SCHEME) return false
        return when (host?.lowercase()) {
            DISCONNECT_HOST -> true
            CONNECT_HOST -> "pubkey" in params
            else -> false
        }
    }

    /** How far a callback identifies the requester: an `https` host is a
     *  verifiable anchor, a custom scheme is claimable by any app. */
    fun callbackTrust(callback: String): String {
        val scheme = callback.substringBefore("://", "").ifEmpty { callback.substringBefore(":", "") }
        return if (scheme.equals("https", ignoreCase = true)) {
            "Verified web address."
        } else {
            "Custom app link — the app's identity cannot be verified. Only approve if you started this."
        }
    }
```

In `screens/ConnectConsentDialog.kt`, replace `callbackTrust(request.callback)` with `DeepLink.callbackTrust(request.callback)` and delete the private `callbackTrust` function at the end of the file.

- [ ] **Step 4: The flow in `AppViewModel`**

Add `import kotlinx.coroutines.CompletableDeferred` to the imports.

After the `pendingNetworkSwitch` property, add:

```kotlin
    /** A GnoConnect session request (`connect` with a key, `disconnect`) from
     *  acceptance to the answer, presented full screen: review, then the
     *  desktop handoff. Mirrors the iOS `pendingSession`. */
    var pendingSession by mutableStateOf<SessionFlow?>(null)
        private set

    /** Completed by [start] once the bridge is open: a link that launched the
     *  app arrives before it, and waits for it rather than being lost. */
    private val bridgeReady = CompletableDeferred<Unit>()

    /** The master identities the app can act for. */
    val identities: List<Identity> get() = Identities.of(accounts)
```

In `start()`, right after `migrateLegacyAccountIfNeeded()`, add:

```kotlin
        // From here the bridge answers, and the accounts are all known: links
        // that arrived with the launch may go ahead.
        bridgeReady.complete(Unit)
```

In `handleDeepLink`, as its first statement:

```kotlin
        if (DeepLink.isSessionRequest(uri)) {
            viewModelScope.launch {
                bridgeReady.await()
                handleSessionRequest(uri)
            }
            return
        }
```

Before `// --- connect (sign-in)`, add:

```kotlin
    // --- session requests (connect with a key, disconnect)

    /**
     * Verifies a session link and parks it for review. A refusal the producer
     * must hear about is answered at once; a replay is dropped (its first copy
     * is being handled); anything else is the user's to see and retry.
     */
    private suspend fun handleSessionRequest(uri: android.net.Uri) {
        val request = try {
            client.acceptSessionRequest(uri.toString())
        } catch (e: Exception) {
            val error = e.asBridge()
            if (error.code == BridgeException.Code.REPLAYED) return
            val code = error.protocolCode
            if (code != null) respondError(uri, code) else surface(error)
            return
        }
        // Answered only through a safe callback; a disconnect may have none.
        val answerable =
            if (request.callback.isEmpty()) request.isDisconnect else DeepLink.isCallbackSafe(request.callback)
        if (!answerable) {
            surface(BridgeException("Ignored a session request with a missing or unsafe callback."))
            return
        }
        if (pendingSession != null) {
            answerSession(request, listOf("status" to "cancelled") + stateEcho(request))
            return
        }
        val held = identities
        if (held.isEmpty()) {
            refuseSession(request, "no_signer")
            return
        }
        val identity = Identities.forSigner(request.signer, held, selectedAccount?.masterAddress)
        if (identity == null) {
            refuseSession(request, "signer_unavailable")
            return
        }
        pendingSession = SessionFlow(request, identity.address, identity.masterKeyName)
        stageNetworkSwitch(request.rpc, request.chainID)
    }

    /** The user picked another identity on the review (no pin). */
    fun selectIdentity(address: String) {
        val identity = identities.firstOrNull { it.address == address } ?: return
        pendingSession = pendingSession?.copy(identity = identity.address, masterKeyName = identity.masterKeyName)
    }

    /** The user approved: show the command and watch the chain. */
    fun startHandoff(tx: SessionTxInfo, grant: SessionGrantDraft, revokeExpired: List<String>, masterKeyName: String) {
        pendingSession = pendingSession?.copy(
            tx = tx, grant = grant, revokeExpired = revokeExpired, masterKeyName = masterKeyName)
    }

    /** A rebuilt command (the identity's sequence moved under the document). */
    fun updateSessionTx(tx: SessionTxInfo) {
        pendingSession = pendingSession?.copy(tx = tx)
    }

    /** The chain shows the outcome, or the key was already granted: answer with
     *  the bridge's reply, which already ends with `state`. The identity's
     *  balance and sessions moved, so the main screen re-reads them. */
    fun completeSession(reply: List<List<String>>) {
        val flow = pendingSession ?: return
        pendingSession = null
        answerSession(flow.request, SessionCodec.tuples(reply))
        refreshStatus()
        refreshAccountStates()
    }

    /** A refusal found after acceptance (`session_expired`, `session_limit`, …). */
    fun failSession(code: String) {
        val flow = pendingSession ?: return
        pendingSession = null
        refuseSession(flow.request, code)
    }

    /** The user declined, or stopped waiting for the desktop. */
    fun cancelSession() {
        val flow = pendingSession ?: return
        pendingSession = null
        answerSession(flow.request, listOf("status" to "cancelled") + stateEcho(flow.request))
    }

    private fun refuseSession(request: SessionRequestInfo, code: String) =
        answerSession(request, listOf("status" to "error", "code" to code) + stateEcho(request))

    /** Opens the callback with [pairs]; nothing when there is none (a disconnect
     *  may carry none: the producer then checks the chain itself). */
    private fun answerSession(request: SessionRequestInfo, pairs: List<Pair<String, String>>) {
        openCallback(DeepLink.responseUri(request.callback, pairs) ?: return)
    }

    private fun stateEcho(request: SessionRequestInfo): List<Pair<String, String>> =
        if (request.state.isEmpty()) emptyList() else listOf("state" to request.state)
```

Replace `dismissPendingNetworkSwitch()` with:

```kotlin
    /**
     * User kept the current network (declined the staged switch). For a `tx`
     * prefill the call stays; a `connect` or a session request needed the
     * switch, so declining answers `network_declined`.
     */
    fun dismissPendingNetworkSwitch() {
        pendingNetworkSwitch = null
        pendingConnect?.let { request ->
            pendingConnect = null
            respondConnect(request, "error", "network_declined")
        }
        pendingSession?.let { flow ->
            pendingSession = null
            refuseSession(flow.request, "network_declined")
        }
    }
```

- [ ] **Step 5: Read a launching intent once**

In `MainActivity.kt`, replace `handleIntent(intent)` in `onCreate` with:

```kotlin
        // A recreated activity (rotation, process restore) is handed the intent
        // that launched it again: its link was handled already, or answered.
        if (savedInstanceState == null) handleIntent(intent)
```

and in `handleIntent`, after `val data = intent?.data ?: return`:

```kotlin
        // Reopened from Recents: the original launch intent again, not a new link.
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `make test.android`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add android/app/src/main/java/land/gno/gnokey/DeepLink.kt android/app/src/main/java/land/gno/gnokey/AppViewModel.kt android/app/src/main/java/land/gno/gnokey/MainActivity.kt android/app/src/main/java/land/gno/gnokey/screens/ConnectConsentDialog.kt android/app/src/test/java/land/gno/gnokey/DeepLinkTest.kt android/app/src/test/java/land/gno/gnokey/SessionFlowTest.kt
git commit -m "feat(android): route session requests and hold one in AppViewModel until it is answered"
```

---

### Task 5: The review screen

**Files:**
- Create: `android/app/src/main/java/land/gno/gnokey/screens/SessionRequestScreen.kt`
- Create (final content from Task 6, so this task compiles): `screens/SessionHandoffPane.kt`
- Modify: `MainActivity.kt`

**Interfaces:**
- Consumes: `AppViewModel.pendingSession`, `identities`, `selectIdentity`, `startHandoff`, `completeSession`, `failSession`, `cancelSession` (Task 4); `BridgeClient.planSessionRequest`, `buildSessionTx` (Task 2); `SessionReview` (Task 3); `DeepLink.callbackOrigin`, `callbackTrust`; `SessionHandoffPane` (Task 6).
- Produces: `@Composable fun SessionRequestScreen(model: AppViewModel)`, a full-screen dialog presented by `Root`. It shows while `pendingSession != null`, no network switch is pending, no identity-only `connect` is pending, and the phase is `Main`.

Screen decisions (kept from iOS unless noted):
- **A full-screen `Dialog`** (`usePlatformDefaultWidth = false`, no dismiss on outside click), with a top bar whose ✕ answers `cancelled`. It differs from iOS: Android's back gesture also answers `cancelled`, as `ConnectConsentDialog` already does. While a build is running, neither works.
- **The form lives in a `SessionReviewState` holder** created with `remember`. A rotation reloads the plan and resets the form to the request, since an un-approved review holds nothing worth keeping. Once approved, the command lives in `pendingSession.tx` and survives.
- **The content follows the iOS review card for card:**
  - requester and how far to trust it; network; identity (a menu when unpinned and several are held) and its desktop key name (required);
  - for a `connect`: allow entries as switches with their risk; budget (limit field + period menu) with its worst case, or the no-spend warning; lifetime menu with the resulting expiry; with `old`, the old grant and the widenings, or "no longer on chain";
  - for a `disconnect`: the session to revoke;
  - expired sessions with the ones that must go preselected;
  - an already-granted key: a sign-in style approval that answers the chain's grant.

- [ ] **Step 1: Write the review**

`screens/SessionRequestScreen.kt`:

```kotlin
package land.gno.gnokey.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.launch
import land.gno.gnokey.AppViewModel
import land.gno.gnokey.BridgeException
import land.gno.gnokey.ChainSession
import land.gno.gnokey.DeepLink
import land.gno.gnokey.Palette
import land.gno.gnokey.SectionLabel
import land.gno.gnokey.SessionCodec
import land.gno.gnokey.SessionFlow
import land.gno.gnokey.SessionGrantDraft
import land.gno.gnokey.SessionPlanInfo
import land.gno.gnokey.SessionRequestInfo
import land.gno.gnokey.SessionReview
import land.gno.gnokey.Widening
import land.gno.gnokey.asBridge
import land.gno.gnokey.card
import java.text.DateFormat
import java.util.Date

private val dateFormat: DateFormat = DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT)

private fun formatDate(millis: Long): String = dateFormat.format(Date(millis))

/**
 * The review form of one session request: the plan read from the chain and
 * what the user narrowed. Held outside the composables so loading and
 * approving are plain functions.
 */
private class SessionReviewState {
    var plan by mutableStateOf<SessionPlanInfo?>(null)
    var loadError by mutableStateOf<String?>(null)
    var allow by mutableStateOf(listOf<String>())
    var lifetime by mutableLongStateOf(0L)
    var spend by mutableStateOf("")
    var period by mutableLongStateOf(0L)
    var revokeExpired by mutableStateOf(setOf<String>())
    var masterKeyName by mutableStateOf("")
    var building by mutableStateOf(false)
    var buildError by mutableStateOf<String?>(null)

    /** The grant as the form stands; a limit cleared means no spending, and so no period. */
    fun grant(request: SessionRequestInfo): SessionGrantDraft {
        if (request.isDisconnect) return SessionGrantDraft()
        val limit = spend.trim()
        return SessionGrantDraft(allow, limit, if (limit.isEmpty()) 0 else period, lifetime)
    }

    /** Plans against the chain for the current identity, and resets the form
     *  to the request. A refusal the producer must hear about ends the flow. */
    suspend fun load(model: AppViewModel) {
        val flow = model.pendingSession ?: return
        if (flow.tx != null) return
        plan = null
        loadError = null
        buildError = null
        allow = flow.request.allow
        lifetime = flow.request.expires
        spend = flow.request.spend
        period = flow.request.period
        masterKeyName = flow.masterKeyName
        try {
            val loaded = model.client.planSessionRequest(flow.request, flow.identity)
            revokeExpired = loaded.expired.take(loaded.mustRevoke).map { it.pubKey }.toSet()
            plan = loaded
        } catch (e: Exception) {
            val error = e.asBridge()
            val code = error.protocolCode
            if (code != null) model.failSession(code) else loadError = error.userMessage
        }
    }

    suspend fun approve(model: AppViewModel, flow: SessionFlow, plan: SessionPlanInfo) {
        building = true
        buildError = null
        val grant = grant(flow.request)
        val revoke = plan.expired.map { it.pubKey }.filter { it in revokeExpired }
        val keyName = masterKeyName.trim()
        try {
            val tx = model.client.buildSessionTx(flow.request, flow.identity, grant, revoke, keyName)
            model.startHandoff(tx, grant, revoke, keyName)
        } catch (e: Exception) {
            val error = e.asBridge()
            val code = error.protocolCode
            when {
                // The result is already on chain (the key was granted, or the
                // disconnect's key revoked, since the plan): plan again to show it.
                error.code == BridgeException.Code.ALREADY_DONE -> {
                    building = false
                    load(model)
                }
                code != null -> model.failSession(code)
                else -> buildError = error.userMessage
            }
        } finally {
            building = false
        }
    }
}

/**
 * Review of a GnoConnect session request — a `connect` naming the app's own
 * key (a grant, or a renewal with `old`) or a `disconnect` — following the
 * Review section of gnoconnect-session.md. The user may narrow a grant, never
 * widen it: the choices offered are never wider, and the bridge refuses a
 * wider grant when it composes the transaction. Once approved, the same dialog
 * shows the desktop command and watches the chain. Mirrors the iOS
 * `SessionRequestView`.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionRequestScreen(model: AppViewModel) {
    val flow = model.pendingSession ?: return
    val state = remember { SessionReviewState() }
    LaunchedEffect(flow.identity) { state.load(model) }

    val title = when {
        flow.request.isDisconnect -> "Disconnect App"
        state.plan?.alreadyGranted == true -> "Sign in"
        else -> "Authorize App"
    }

    Dialog(
        // Back answers `cancelled`, like the ✕ (and like the sign-in dialog).
        onDismissRequest = { if (!state.building) model.cancelSession() },
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = false),
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                TopAppBar(
                    title = { Text(title) },
                    navigationIcon = {
                        IconButton(onClick = { model.cancelSession() }, enabled = !state.building) {
                            Icon(Icons.Default.Close, "Cancel")
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Palette.Background),
                )
            },
            containerColor = Palette.Background,
        ) { padding ->
            if (flow.tx != null) {
                SessionHandoffPane(model, Modifier.padding(padding))
            } else {
                Review(model, flow, state, Modifier.padding(padding))
            }
        }
    }
}

@Composable
private fun Review(model: AppViewModel, flow: SessionFlow, state: SessionReviewState, modifier: Modifier) {
    val scope = rememberCoroutineScope()
    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        RequesterCard(flow.request)
        Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            SectionLabel("Network")
            Mono("${model.network.remote} · chain ${model.network.chainID}")
        }
        IdentityCard(model, flow, state)

        val plan = state.plan
        val loadError = state.loadError
        when {
            loadError != null -> Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(loadError, color = Palette.Negative, style = MaterialTheme.typography.bodySmall)
                OutlinedButton(onClick = { scope.launch { state.load(model) } }) { Text("Try again") }
            }
            plan == null -> Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            plan.alreadyGranted -> AlreadyGrantedCard(model, plan)
            flow.request.isDisconnect -> {
                TargetCard(plan)
                HousekeepingCard(plan, state)
                ApproveButton("Revoke on Computer", model, flow, plan, state)
            }
            else -> {
                if (plan.hasOld) OldCard(plan, flow.request, state)
                AllowCard(flow.request, state)
                BudgetCard(flow.request, state)
                LifetimeCard(flow.request, state)
                HousekeepingCard(plan, state)
                ApproveButton("Authorize on Computer", model, flow, plan, state)
            }
        }
    }
}

@Composable
private fun RequesterCard(request: SessionRequestInfo) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel("Requested by")
        if (request.callback.isEmpty()) {
            Text("An app that will check the chain itself (no callback).", style = MaterialTheme.typography.bodySmall)
        } else {
            Mono(DeepLink.callbackOrigin(request.callback))
            Text(DeepLink.callbackTrust(request.callback), color = Palette.Warning,
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun IdentityCard(model: AppViewModel, flow: SessionFlow, state: SessionReviewState) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionLabel(if (flow.request.isDisconnect) "Identity that revokes" else "Identity that grants")
        val identities = model.identities
        if (flow.request.signer.isEmpty() && identities.size > 1) {
            ChoiceMenu(flow.identity, identities.map { it.address }, { it }) { model.selectIdentity(it) }
        } else {
            Mono(flow.identity)
        }
        OutlinedTextField(
            value = state.masterKeyName,
            onValueChange = { state.masterKeyName = it },
            label = { Text("Key name in desktop gnokey") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )
        Caption("This identity's key signs on your computer, with gnokey.")
    }
}

@Composable
private fun AlreadyGrantedCard(model: AppViewModel, plan: SessionPlanInfo) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionLabel("Already authorized")
        Text(
            "This app's key is already a session of this identity. Approving tells the app who you " +
                "are and what its session may do — nothing is signed.",
            style = MaterialTheme.typography.bodySmall,
        )
        SessionCodec.values("allow", plan.reply).forEach { Mono(it) }
        val spend = SessionCodec.value("spend", plan.reply)
        val period = SessionCodec.value("period", plan.reply)?.toLongOrNull() ?: 0
        spend?.let { SessionReview.budget(it, period) }?.let { Caption(it) }
        SessionCodec.value("expires_at", plan.reply)?.toLongOrNull()?.takeIf { it > 0 }?.let {
            Caption("Until ${formatDate(it * 1000)}")
        }
        Button(onClick = { model.completeSession(plan.reply) }, modifier = Modifier.fillMaxWidth()) {
            Text("Approve")
        }
    }
}

@Composable
private fun TargetCard(plan: SessionPlanInfo) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel("Session to revoke")
        plan.target?.let { target ->
            Mono(target.address)
            target.allowPaths.forEach { Mono(it) }
            target.expiryMillis?.let {
                Caption("${if (it < System.currentTimeMillis()) "Expired" else "Expires"} ${formatDate(it)}")
            }
        }
        Caption("The app's key stops working for this identity. Revoking costs gas, paid by the identity.")
    }
}

@Composable
private fun OldCard(plan: SessionPlanInfo, request: SessionRequestInfo, state: SessionReviewState) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        SectionLabel("Replaces")
        val old = plan.old
        if (plan.oldOnChain && old != null) {
            Mono(old.address)
            Caption("Now: ${SessionReview.budget(old.spendLimit, old.spendPeriod) ?: "no spending"} · " +
                old.allowPaths.joinToString(", "))
            SessionReview.widenings(old, state.grant(request), System.currentTimeMillis() / 1000).forEach {
                WarningLabel(text(it))
            }
        } else {
            Text("The app's previous key is no longer on chain: nothing is replaced, a new session is created.",
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun AllowCard(request: SessionRequestInfo, state: SessionReviewState) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionLabel("Allowed actions")
        request.allow.forEach { entry ->
            ToggleRow(
                checked = entry in state.allow,
                // Kept in request order, whatever order they are toggled in.
                onCheckedChange = { on ->
                    state.allow = if (on) request.allow.filter { it in state.allow || it == entry }
                    else state.allow - entry
                },
            ) {
                Mono(entry)
                SessionReview.risk(entry)?.let { WarningLabel(it) }
            }
        }
        if (state.allow.isEmpty()) {
            Text("Keep at least one action.", color = Palette.Negative, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun BudgetCard(request: SessionRequestInfo, state: SessionReviewState) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionLabel("Budget")
        if (request.spend.isEmpty() || state.spend.isBlank()) {
            WarningLabel("This session cannot spend anything, not even its own fees.")
        }
        if (request.spend.isNotEmpty()) {
            OutlinedTextField(
                value = state.spend,
                onValueChange = { state.spend = it },
                label = { Text("Limit (empty = no spending)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
            ChoiceMenu(state.period, SessionReview.periodChoices(request.period), SessionReview::periodLabel) {
                state.period = it
            }
            val spend = state.spend.trim()
            SessionReview.budget(spend, state.period)?.let { budget ->
                Text(budget, style = MaterialTheme.typography.bodyMedium)
                SessionReview.worstCase(spend, state.period, state.lifetime)?.let { Caption(it) }
            }
        }
    }
}

@Composable
private fun LifetimeCard(request: SessionRequestInfo, state: SessionReviewState) {
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionLabel("Lifetime")
        ChoiceMenu(state.lifetime, SessionReview.lifetimeChoices(request.expires), { SessionReview.duration(it) }) {
            state.lifetime = it
        }
        Caption("Expires about ${formatDate(System.currentTimeMillis() + state.lifetime * 1000)}, " +
            "counted from when it lands on chain.")
    }
}

@Composable
private fun HousekeepingCard(plan: SessionPlanInfo, state: SessionReviewState) {
    if (plan.expired.isEmpty()) return
    Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        SectionLabel("Expired sessions")
        if (plan.mustRevoke > 0) {
            WarningLabel("This identity has no free session slot: revoke at least ${plan.mustRevoke} " +
                "of these in the same transaction.")
        } else {
            Caption("Expired sessions still take one of the 16 slots. You may revoke them in the same transaction.")
        }
        plan.expired.forEach { session: ChainSession ->
            ToggleRow(
                checked = session.pubKey in state.revokeExpired,
                onCheckedChange = { on ->
                    state.revokeExpired = if (on) state.revokeExpired + session.pubKey
                    else state.revokeExpired - session.pubKey
                },
            ) {
                Mono(session.address)
                session.expiryMillis?.let { Caption("Expired ${formatDate(it)}") }
            }
        }
    }
}

@Composable
private fun ApproveButton(
    label: String, model: AppViewModel, flow: SessionFlow, plan: SessionPlanInfo, state: SessionReviewState,
) {
    val scope = rememberCoroutineScope()
    val ready = state.masterKeyName.isNotBlank() &&
        state.revokeExpired.size >= plan.mustRevoke &&
        (flow.request.isDisconnect || state.allow.isNotEmpty())
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Button(
            onClick = { scope.launch { state.approve(model, flow, plan) } },
            enabled = ready && !state.building,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (state.building) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            else Text(label)
        }
        state.buildError?.let {
            Text(it, color = Palette.Negative, style = MaterialTheme.typography.bodySmall)
        }
    }
}

private fun text(widening: Widening): String = when (widening) {
    Widening.LongerLife -> "Lasts longer than the current session."
    Widening.HigherLimit -> "Higher spend limit than the current session."
    Widening.FasterReset -> "The budget resets more often than the current session's."
    is Widening.NewEntries -> "New actions: ${widening.entries.joinToString(", ")}"
}

// --- small pieces

@Composable
private fun Mono(text: String) {
    Text(text, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun Caption(text: String) {
    Text(text, color = Palette.TextSecondary, style = MaterialTheme.typography.bodySmall)
}

/** A choice among a few values, as a button that opens a menu (the iOS menu picker). */
@Composable
private fun <T> ChoiceMenu(selected: T, choices: List<T>, label: (T) -> String, onSelect: (T) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }) {
            Text(label(selected), maxLines = 1)
            Spacer(Modifier.width(4.dp))
            Icon(Icons.Default.ArrowDropDown, null)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            choices.forEach { choice ->
                DropdownMenuItem(text = { Text(label(choice)) }, onClick = {
                    onSelect(choice)
                    expanded = false
                })
            }
        }
    }
}

@Composable
private fun ToggleRow(checked: Boolean, onCheckedChange: (Boolean) -> Unit, content: @Composable ColumnScope.() -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp), content = content)
        Spacer(Modifier.width(8.dp))
        Switch(checked = checked, onCheckedChange = onCheckedChange)
    }
}
```

So that this task compiles on its own, create `screens/SessionHandoffPane.kt` now with its final content from Task 6, Step 1, and keep Task 6 for its checks.

- [ ] **Step 2: Present it**

In `MainActivity.kt`, add `import land.gno.gnokey.screens.SessionRequestScreen`, and at the end of `Root`, after the connect block:

```kotlin

    // A session request waits, like a connect, for the network decision and
    // for the main screen; one dialog at a time, so it also waits for a
    // pending sign-in.
    if (model.pendingSession != null && model.pendingNetworkSwitch == null &&
        model.pendingConnect == null && model.phase is AppViewModel.Phase.Main
    ) {
        SessionRequestScreen(model)
    }
```

- [ ] **Step 3: Build and run the tests**

Run: `make test.android && (cd android && ./gradlew --console=plain -q :app:assembleDebug -PgnoAbi=x86_64)`
Expected: exit 0 for both (no new test; the app compiles with the review and the dialog). Fix any warning the Kotlin compiler prints about the new files (unused import or variable) before committing.

- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/land/gno/gnokey/screens/SessionRequestScreen.kt android/app/src/main/java/land/gno/gnokey/screens/SessionHandoffPane.kt android/app/src/main/java/land/gno/gnokey/MainActivity.kt
git commit -m "feat(android): review a session request — narrow, never widen — full screen"
```

---

### Task 6: The desktop handoff and the chain watch

**Files:**
- Create (in Task 5, checked here): `android/app/src/main/java/land/gno/gnokey/screens/SessionHandoffPane.kt`

**Interfaces:**
- Consumes: `AppViewModel.pendingSession`, `updateSessionTx`, `completeSession`, `failSession` (Task 4); `BridgeClient.pollSessionOutcome`, `buildSessionTx` (Task 2); `CommandBlock` (existing); `SessionReview.coins` (Task 3).
- Produces: `@Composable fun SessionHandoffPane(model: AppViewModel, modifier: Modifier = Modifier)` — the command, its cost, and a poll every 3 s backing off to 10 s:
  - Done → `completeSession(reply)`.
  - Stale → rebuild; the new command replaces the old, with a note.
  - `already_done` on a rebuild → keep polling.
  - A protocol code on a rebuild → `failSession`.
  - `wrong_network` → a note.
  - A network error → try again at the next tick.

- [ ] **Step 1: Write the handoff**

`screens/SessionHandoffPane.kt`:

```kotlin
package land.gno.gnokey.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import land.gno.gnokey.AppViewModel
import land.gno.gnokey.BridgeException
import land.gno.gnokey.Palette
import land.gno.gnokey.SectionLabel
import land.gno.gnokey.SessionFlow
import land.gno.gnokey.SessionReview
import land.gno.gnokey.asBridge
import land.gno.gnokey.card

/**
 * The transaction of an approved session request, handed to the computer that
 * holds the identity's key (gnoconnect-session.md, Obtaining the identity's
 * signature), and the watch on the chain until it shows the outcome. The
 * request stays pending meanwhile, in the background too; the dialog's ✕ or
 * back answers `cancelled`. Mirrors the iOS `SessionHandoffView`.
 */
@Composable
fun SessionHandoffPane(model: AppViewModel, modifier: Modifier = Modifier) {
    val flow = model.pendingSession ?: return
    val tx = flow.tx ?: return
    var note by remember { mutableStateOf<String?>(null) }

    // Polls every ~3 s, backing off to 10 s. Reads the flow afresh each time,
    // since a rebuild replaces its transaction.
    LaunchedEffect(Unit) {
        var delayMs = 3000L
        while (true) {
            val current = model.pendingSession ?: break
            val currentTx = current.tx ?: break
            try {
                val outcome = model.client.pollSessionOutcome(current.request, current.identity, currentTx)
                if (outcome.done) {
                    model.completeSession(outcome.reply)
                    break
                }
                if (outcome.stale) rebuild(model, current)?.let { note = it }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (e.asBridge().code == BridgeException.Code.WRONG_NETWORK) {
                    note = "The wallet is no longer on chain ${current.request.chainID}: " +
                        "the transaction cannot be watched until it is back on it."
                }
                // Anything else is a network hiccup: try again at the next tick.
            }
            delay(delayMs)
            delayMs = (delayMs * 12 / 10).coerceAtMost(10_000L)
        }
    }

    Column(
        modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        Text(
            "Run this on the computer that holds the key of this identity — “${flow.masterKeyName}” in gnokey:",
            color = Palette.TextSecondary,
            modifier = Modifier.fillMaxWidth(),
        )

        CommandBlock(tx.command)

        Column(Modifier.card(), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            SectionLabel("Cost")
            Text("Up to ${SessionReview.coins(tx.gasFee)} in gas (${tx.gasWanted} gas), paid by ${flow.identity}.",
                style = MaterialTheme.typography.bodySmall)
            if (tx.signsDocument) {
                Text(
                    "The command writes gnoconnect-session.json in the current directory, signs it, " +
                        "checks it with a dry run, then broadcasts it.",
                    color = Palette.TextSecondary,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }

        note?.let {
            Column(Modifier.card()) { WarningLabel(it) }
        }

        Row(verticalAlignment = Alignment.CenterVertically) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            Spacer(Modifier.width(10.dp))
            Text("Waiting for the transaction on chain…", color = Palette.TextSecondary,
                style = MaterialTheme.typography.bodySmall)
        }
    }
}

/**
 * The identity sent another transaction since the document was signed for its
 * sequence, so it can never be included: build it again, which plans against
 * the chain again too. Returns the note to show, or null for none.
 */
private suspend fun rebuild(model: AppViewModel, flow: SessionFlow): String? =
    try {
        val tx = model.client.buildSessionTx(
            flow.request, flow.identity, flow.grant, flow.revokeExpired, flow.masterKeyName)
        model.updateSessionTx(tx)
        "This identity sent another transaction meanwhile, so the command changed: run this one."
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        val error = e.asBridge()
        val code = error.protocolCode
        when {
            error.code == BridgeException.Code.ALREADY_DONE -> null // on chain already: the next poll says Done
            code != null -> {
                model.failSession(code)
                null
            }
            else -> error.userMessage
        }
    }
```

- [ ] **Step 2: Build and run the tests**

Run: `make test.android && (cd android && ./gradlew --console=plain -q :app:assembleDebug -PgnoAbi=x86_64)`
Expected: exit 0. The file was committed with Task 5; if its content changed while checking, commit the change:

```bash
git add android/app/src/main/java/land/gno/gnokey/screens/SessionHandoffPane.kt
git commit -m "feat(android): watch the chain for a session request's outcome and answer it"
```

---

### Task 7: Identity-only `connect`: `sessions` in features, and scope hints

**Files:**
- Modify: `DeepLink.kt` (`ConnectRequest`), `AppViewModel.kt`, `Models.kt`, `screens/ConnectConsentDialog.kt`, `screens/PermissionBuilderScreen.kt`
- Test: `SessionDraftTest.kt`

**Interfaces:**
- Consumes: `BridgeClient.parseScopeHints`, `sessionCoversHints`, `ScopeHintsInfo.remaining` (Task 2); `SessionReview.budget`, `duration`, `periodLabel` (Task 3); `bridgeReady`, `respondError` (Task 4 / existing).
- Produces: `ConnectRequest.hints: ScopeHintsInfo?`, `ConnectRequest.receivedAtMillis: Long`; `SessionDraft.applying(hints): SessionDraft`; `AppViewModel.createSessionForHints(hints)`; `features` = `sendtx,signtx,sessions`.

Decisions this task fixes:
- **Hints are read once the bridge is up**, never lost on a cold launch (iOS loses them). Hints the bridge refuses answer their protocol code, as on iOS.
- **A hinted lifetime equal to a builder preset selects that preset** (86400 s → "24 hours", 604800 s → "7 days", 2592000 s → "30 days"), so the builder never shows "1 day" next to "24 hours". That is a deferred P2-M2 minor, avoided here; iOS keeps it.
- **Coverage counts from the arrival of the `connect`** (P2-M2 fix): `hints.remaining(elapsedSeconds)`.
- **The sign-in dialog scrolls**: the hints card can push it past the screen height.

- [ ] **Step 1: Write the failing test**

`SessionDraftTest.kt`:

```kotlin
package land.gno.gnokey

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionDraftTest {
    /** "Create a session for this app" pre-fills the builder from the hints. */
    @Test
    fun hintsPrefillTheBuilder() {
        val draft = SessionDraft(masterAddress = "g1m", masterKeyName = "main")
        val filled = draft.applying(ScopeHintsInfo(listOf("vm/exec:gno.land/r/demo/a"), "5000000ugnot", 3600, 90_000))
        assertEquals(listOf("vm/exec:gno.land/r/demo/a"), filled.allowPaths)
        assertEquals("5000000ugnot", filled.spendLimit)
        assertEquals(3600L, filled.spendPeriodSeconds)
        assertEquals("90000s", filled.expiresIn)
        assertEquals("g1m", filled.masterAddress)
        assertEquals("main", filled.masterKeyName)
    }

    /** A hinted lifetime that is a builder preset selects the preset. */
    @Test
    fun presetLifetimesSelectThePreset() {
        val draft = SessionDraft()
        assertEquals("24h", draft.applying(ScopeHintsInfo(emptyList(), "", 0, 86_400)).expiresIn)
        assertEquals("7d", draft.applying(ScopeHintsInfo(emptyList(), "", 0, 604_800)).expiresIn)
        assertEquals("30d", draft.applying(ScopeHintsInfo(emptyList(), "", 0, 2_592_000)).expiresIn)
    }

    /** Each hint is optional: what the app did not hint stays as the user left it. */
    @Test
    fun missingHintsKeepTheDraft() {
        val draft = SessionDraft()
        assertEquals(draft, draft.applying(ScopeHintsInfo(emptyList(), "", 3600, 0)))
    }

    /** The hints' lifetime counts from their arrival, with a minute of slack. */
    @Test
    fun hintsCountFromTheirArrival() {
        val hints = ScopeHintsInfo(listOf("bank/send"), "", 0, 86_400)
        assertEquals(86_400L - 300 - 60, hints.remaining(300).expires)
        assertEquals(0L, hints.remaining(100_000).expires)
        val noLifetime = hints.copy(expires = 0)
        assertEquals(noLifetime, noLifetime.remaining(300))
    }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `make test.android`
Expected: FAIL — `Unresolved reference 'applying'`.

- [ ] **Step 3: Pre-fill from hints**

In `Models.kt`, after `data class SessionDraft(…)`:

```kotlin

/** The builder's expiry presets, by their length in seconds. */
private val EXPIRY_PRESETS = mapOf(86_400L to "24h", 604_800L to "7d", 2_592_000L to "30d")

/**
 * This draft with an identity-only `connect`'s scope hints applied: what the
 * app said it will send through the wallet. A hint left out keeps the user's
 * value; the period counts only with a spend limit. A lifetime that is a
 * preset selects the preset.
 */
fun SessionDraft.applying(hints: ScopeHintsInfo): SessionDraft {
    var draft = this
    if (hints.allow.isNotEmpty()) draft = draft.copy(allowPaths = hints.allow)
    if (hints.spend.isNotEmpty()) draft = draft.copy(spendLimit = hints.spend, spendPeriodSeconds = hints.period)
    if (hints.expires > 0) draft = draft.copy(expiresIn = EXPIRY_PRESETS[hints.expires] ?: "${hints.expires}s")
    return draft
}
```

- [ ] **Step 4: Read the hints on `connect`, advertise `sessions`**

In `DeepLink.kt`, add to `ConnectRequest` after `val chainID: String = "",`:

```kotlin
    /** Scope hints (`allow`, `spend`, `period`, `expires`): what the app says it
     *  will send through the wallet. Read by the bridge; null when there are none. */
    val hints: ScopeHintsInfo? = null,
    /** When the link arrived: the hints' `expires` counts from here. */
    val receivedAtMillis: Long = System.currentTimeMillis(),
```

In `AppViewModel.handleDeepLink`, replace the connect branch:

```kotlin
        if (DeepLink.hostOf(uri) == DeepLink.CONNECT_HOST) {
            val request = DeepLink.parseConnect(uri)
            if (request != null) handleConnect(request)
            else surface(BridgeException("Ignored a sign-in link with a missing or unsafe callback."))
            return
        }
```

with:

```kotlin
        if (DeepLink.hostOf(uri) == DeepLink.CONNECT_HOST) {
            val parsed = DeepLink.parseConnect(uri)
            if (parsed == null) {
                surface(BridgeException("Ignored a sign-in link with a missing or unsafe callback."))
                return
            }
            viewModelScope.launch {
                // The bridge reads the hints, and a link that launched the app
                // arrives before it is up: wait for it rather than lose them.
                bridgeReady.await()
                val hints = try {
                    client.parseScopeHints(uri.toString())
                } catch (e: Exception) {
                    // Hints are validated like a grant (spec, Parameters).
                    val code = e.asBridge().protocolCode
                    if (code != null) {
                        respondError(uri, code)
                        return@launch
                    }
                    null
                }
                handleConnect(parsed.copy(hints = hints))
            }
            return
        }
```

In `approveConnect()`, replace the features pair and its comment with:

```kotlin
                // The hosts we implement, plus `sessions`: `connect` with a key
                // and `old`, and `disconnect` (gnoconnect-session.md, `connect`
                // features).
                "features" to "sendtx,signtx,sessions",
```

and add, after `createSession(forMaster: …)`:

```kotlin

    /** Starts creating a session that covers an identity-only `connect`'s
     *  hints, for the selected identity. The connect stays parked: once the
     *  session lands, the consent dialog comes back with it selected. */
    fun createSessionForHints(hints: ScopeHintsInfo) = viewModelScope.launch {
        val account = selectedAccount ?: return@launch
        try {
            val name = "session-" + UUID.randomUUID().toString().take(8)
            sessionKey = client.generateSessionKey(name)
            pendingKeyName = name
            draft = draft.copy(masterAddress = account.masterAddress, masterKeyName = account.masterKeyName)
                .applying(hints)
            phase = Phase.Builder
        } catch (e: Exception) {
            surface(e)
        }
    }
```

- [ ] **Step 5: The hints on the consent dialog**

In `screens/ConnectConsentDialog.kt`, add the imports `androidx.compose.foundation.rememberScrollState`, `androidx.compose.foundation.verticalScroll`, `androidx.compose.material3.OutlinedButton`, `androidx.compose.runtime.getValue`, `androidx.compose.runtime.mutableStateOf`, `androidx.compose.runtime.remember`, `androidx.compose.runtime.setValue`, `androidx.compose.ui.Modifier`, `land.gno.gnokey.SessionReview`.

At the top of `ConnectConsentDialog`, before `AlertDialog(`:

```kotlin
    // Whether the selected session already serves the app's hints: null while
    // checking, and when the check could not run.
    var covered by remember(request) { mutableStateOf<Boolean?>(null) }
    var checkFailed by remember(request) { mutableStateOf(false) }
    LaunchedEffect(request, model.selectedAccountID, model.sessionKey) {
        covered = null
        checkFailed = false
        val hints = request.hints ?: return@LaunchedEffect
        val key = model.sessionKey ?: return@LaunchedEffect
        if (model.draft.masterAddress.isEmpty()) return@LaunchedEffect
        // The producer asked for its lifetime from the request, not from now.
        val elapsed = (System.currentTimeMillis() - request.receivedAtMillis + 999) / 1000
        try {
            covered = model.client.sessionCoversHints(model.draft.masterAddress, key.address, hints.remaining(elapsed))
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            checkFailed = true
        }
    }
```

Make the text column scroll: `Column(verticalArrangement = Arrangement.spacedBy(8.dp))` becomes `Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp))`. After `SessionSummary(model)`, add:

```kotlin

                request.hints?.let { hints ->
                    SectionLabel("What this app plans to do")
                    hints.allow.forEach {
                        Text(it, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    }
                    SessionReview.budget(hints.spend, hints.period)?.let {
                        Text("Spending $it", style = MaterialTheme.typography.bodySmall)
                    }
                    if (hints.expires > 0) {
                        Text("For ${SessionReview.duration(hints.expires)}", style = MaterialTheme.typography.bodySmall)
                    }
                    when (covered) {
                        true -> Text("The selected session covers this.", color = Palette.Positive,
                            style = MaterialTheme.typography.bodySmall)
                        false -> {
                            WarningLabel("The selected session does not cover this: the app's requests may be refused.")
                            OutlinedButton(onClick = { model.createSessionForHints(hints) }) {
                                Text("Create a session for this app")
                            }
                        }
                        null -> Text(
                            if (checkFailed) "Could not check the selected session." else "Checking the selected session…",
                            color = Palette.TextSecondary, style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
```

- [ ] **Step 6: The builder shows the requested expiry and period**

In `screens/PermissionBuilderScreen.kt`, add `import land.gno.gnokey.SessionReview`. Inside `PermissionBuilderScreen`, before `Scaffold(`:

```kotlin
    // The presets, plus the draft's own value when it is none of them: a
    // session pre-filled from an app's hints asks for, say, "90000s".
    val shownExpiryChoices = run {
        val current = model.draft.expiresIn
        if (expiryChoices.any { it.first == current }) expiryChoices
        else {
            val seconds = current.removeSuffix("s").toLongOrNull()
            listOf(current to (seconds?.let { SessionReview.duration(it) } ?: current)) + expiryChoices
        }
    }
```

In the Expiry card, replace both uses of `expiryChoices` with `shownExpiryChoices`. In the Spending card, replace `val periods = listOf(0L to "Lifetime", 86_400L to "Per day", 604_800L to "Per week")` with:

```kotlin
                    val presets = listOf(0L to "Lifetime", 86_400L to "Per day", 604_800L to "Per week")
                    val current = model.draft.spendPeriodSeconds
                    // A hinted period that is none of the presets (an hour, say) shows as its own choice.
                    val periods = if (presets.any { it.first == current }) presets
                    else listOf(current to SessionReview.periodLabel(current)) + presets
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `make test.android && (cd android && ./gradlew --console=plain -q :app:assembleDebug -PgnoAbi=x86_64)`
Expected: exit 0 for both.

- [ ] **Step 8: Commit**

```bash
git add android/app/src/main/java/land/gno/gnokey/DeepLink.kt android/app/src/main/java/land/gno/gnokey/AppViewModel.kt android/app/src/main/java/land/gno/gnokey/Models.kt android/app/src/main/java/land/gno/gnokey/screens/ConnectConsentDialog.kt android/app/src/main/java/land/gno/gnokey/screens/PermissionBuilderScreen.kt android/app/src/test/java/land/gno/gnokey/SessionDraftTest.kt
git commit -m "feat(android): sessions in connect's features, and a session for an app's scope hints"
```

---

### Task 8: Round trip on the emulator: Bubble Rumble ↔ gnokey-mobile

**Files:**
- none in the repository. Record each step's outcome in the plan's ledger, and fix each bug in its own commit with its test (TDD: a JVM unit test where the logic is pure, otherwise the reproduction steps in the ledger).

**Interfaces:**
- Consumes:
  - everything above;
  - Bubble Rumble's Session screen (`~/bubblerumble`: "Get a session from gnokey-mobile", "Renew the session", "Revoke");
  - `npm run gnodev` (in `~/bubblerumble`);
  - the emulator `Medium_Phone` (`emulator-5554`, Android 17), driven with adb. See the user's notes on the Android emulator: uiautomator's stale dump on screens that never idle (the handoff's spinner is one: use `screencap` + coordinates there, ×1.2), the LogBox banner over BR's tabs, and `adb reverse` for 26657 and 8081.

The desktop signer is a gnokey built from `go.mod`'s gno (`make build/gnokey`), with test1 recovered into a scratch home:

```bash
cd ~/gnokey-mobile && make build/gnokey
H=$(mktemp -d)/gk
printf '%s\n\n\n' "source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast" \
  | ./build/gnokey add test1 --recover --insecure-password-stdin -home "$H"
```

To run a command the wallet shows, read it from the screen. On the review the dump works (`adb shell uiautomator dump /sdcard/ui.xml` after deleting the old file; the command is the text of one node). On the handoff, tap Copy and read the clipboard with `adb shell cmd clipboard get-primary-clip` where the platform supports it, or use the dump taken right after the screen appears. Insert `-home "$H" -insecure-password-stdin` after `gnokey maketx session create|revoke` and after `gnokey sign`, and `-home "$H"` after `gnokey broadcast`. Feed an empty password on stdin.

Signed test links (steps 3, 6, 8) come from a throwaway, **untracked** test in `core/` that reuses the package's `signedLink` / `launchLink` / `connectParams` helpers and prints a link. Delete it at the end of the task. Example, `core/zz_manual_link_test.go`:

```go
package core

import (
	"fmt"
	"strconv"
	"testing"
	"time"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

// go test ./core -run TestManualLink -v -args <host> <state> <callback> [signer]
func TestManualLink(t *testing.T) {
	key := secp256k1.GenPrivKey()
	kv := withParam(withParam(withParam(connectParams(crypto.PubKeyToBech32(key.PubKey())),
		"iat", strconv.FormatInt(time.Now().Unix(), 10)), "state", "manual"), "callback", "https://example.com/cb")
	fmt.Println(signedLink(t, HostConnect, kv, key, nil))
}
```

Adapt `state`, `callback`, `signer` and the host (`HostDisconnect` with `withoutParam` for the grant-only keys) per step. Keep the key printed (`key.Bytes()`) when a later step must sign a `disconnect` with the same key.

- [ ] **Step 1: Set up**

1. Run `npm run gnodev` in `~/bubblerumble`.
2. Install the wallet: `make install.android` (it reverses tcp:26657).
3. In the wallet, set the network to `http://127.0.0.1:26657`, chain `dev`. Create an account whose master is test1 (`g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5`, key name `test1`), and run its command to authorize it.
4. Run Bubble Rumble on the same emulator: `adb reverse tcp:8081 tcp:8081`, then `npx expo run:android` in `~/bubblerumble`. Choose gnodev (`127.0.0.1:26657`, chain `dev`) in BR's settings.
5. Force-stop the wallet (`adb shell am force-stop land.gno.gnokey`), so that step 2 launches it cold.

Expected: both apps are installed; the wallet's account shows Active.

- [ ] **Step 2: Grant (cold launch)**

In Bubble Rumble, Session → "Get a session from gnokey-mobile". The wallet starts and, once on its main screen, opens the review:
- requested by `bubblerumble://` (custom link warning);
- the network and identity test1;
- BR's allow entries, the budget with its worst case, the lifetime;
- no expired sessions.

Approve, run the command, wait.
Expected: the wallet answers. Bubble Rumble shows the session active with the granted budget, and `auth/accounts/g1jg8…/session/<addr>` exists on gnodev.

- [ ] **Step 3: A link delivered twice**

Generate a link with the helper (`callback=https://example.com/cb`, `state=dup1`). Open it twice quickly: `adb shell am start -a android.intent.action.VIEW -d '<link>'` twice.
Expected: one review; the second copy is dropped. Cancel → the browser opens `https://example.com/cb#status=cancelled&state=dup1`, once.

- [ ] **Step 4: Background and rotation during the handoff**

Start a renewal in BR ("Renew the session") and approve in the wallet. Rotate the emulator (`adb emu rotate`, twice) and check that the handoff is still shown and nothing was answered. Then send the wallet to the background (`adb shell input keyevent KEYCODE_HOME`) before running the command. Run it, then bring the wallet back.
Expected: the wallet resumes polling and answers; BR shows the renewed session, with the old one revoked (`revoked` in the reply).

- [ ] **Step 5: Network switch**

Switch the wallet to another chain id in Settings (same RPC, chain `other`), then start a grant from BR (chain `dev`).
- Expected on "Keep current": BR shows that the wallet declined the network (`network_declined`).
- Expected on a second try with "Switch": the review shows chain `dev` and plans.

- [ ] **Step 6: A pin the wallet does not hold**

Generate a link pinned to an address the wallet does not hold (`signer=g1p2808…`, any valid bech32), with `callback=https://example.com/cb&state=pin1`. Then take a test1-pinned link and edit its `signer` after signing (`state=pin2`).
Expected: no review. The first is answered `status=error&code=signer_unavailable&state=pin1`, the second `code=invalid_proof&state=pin2`.

- [ ] **Step 7: Stale document**

Start a renewal (a document flow) and approve. Before running the command, send any transaction as test1 from the terminal: `./build/gnokey maketx send -send 1ugnot -to g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5 -gas-fee 1000000ugnot -gas-wanted 2000000 -broadcast -chainid dev -remote 127.0.0.1:26657 -home "$H" -insecure-password-stdin test1`.
Expected: the wallet replaces the command and says why; the new one goes through.

- [ ] **Step 8: Disconnect**

In BR, Session → "Revoke". The wallet shows the session to revoke; approve, run the command.
Expected: the session is gone on gnodev, and BR shows no session. For the no-callback case:
1. Grant a helper key through a helper link with `callback=https://example.com/cb`.
2. Open a `disconnect` for that key without `callback`, signed by the same key.

Expected: the review says "An app that will check the chain itself (no callback)", the revocation completes, and the dialog closes without opening anything.

- [ ] **Step 9: Identity-only connect with hints**

Open `land.gno.gnokey://connect?allow=vm%2Fexec%3Agno.land%2Fr%2Fdemo%2Fother&spend=1000000ugnot&period=3600&expires=86400&chainid=dev&callback=https%3A%2F%2Fexample.com%2Fcb&state=h1` with `adb shell am start -a android.intent.action.VIEW -d '<link>'`. In adb's shell, quote it so `&` is not interpreted.
Expected:
- The sign-in dialog lists the hints and says the selected session does not cover them.
- "Create a session for this app" opens the builder pre-filled: that entry, `1000000ugnot`, "Per hour" selected, "24 hours" selected (the preset, not a separate "1 day").
- Once authorized, the dialog comes back with the new session selected and "covers this". Approving opens `https://example.com/cb#status=success&…&features=sendtx%2Csigntx%2Csessions…&state=h1`.

- [ ] **Step 10: Ledger and cleanup**

Record each step's outcome in the ledger. Fix every bug found with a failing test first: a JVM unit test where the logic is pure, otherwise the reproduction steps in the ledger. Commit each fix as `fix(android): …`. Delete `core/zz_manual_link_test.go`; `git status` shows only the existing untracked files.

---

## After this milestone

- Spec §9: P2-M3 delivered, with the round trip's findings; P2 complete on both platforms.
- Push `feat/deeplink-tx` to PR #138 when the user asks.
- Next: the GnoConnect standard update (§7 step 6) and the P3-M2 / P3-M3 plans.
