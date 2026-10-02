# P2-M1 — gnokey-mobile core: session requests (`connect` with a key, `disconnect`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gnokey-mobile's shared Go layer (`core/` + the gomobile bridge `mobile/`) can take a signed GnoConnect session request — `connect` with `pubkey` (optionally `old`) or `disconnect` — verify it, decide on chain what it does, compose the transaction as a desktop `gnokey` command, watch the chain for the outcome and produce the callback answer. iOS and Android screens are not part of this milestone (P2-M2, P2-M3).

**Architecture:** Pure functions do the protocol work (payload, parsing, proof, grant narrowing, planning from a session list, transaction composition, replies) and are unit-tested without a node. Thin `Service` methods add the chain reads (`auth/accounts/{addr}/sessions`, `auth/accounts/{addr}`, gas price) and the clock. The bridge re-parses the original link on every call, so nothing the native side holds can change what the producer signed. A build-tagged integration test drives every flow against gnodev, signing as the identity in-process, and optionally runs the generated commands through a real `gnokey`.

**Tech Stack:** Go 1.25, `github.com/gnolang/gno v1.5.0` (tm2 `crypto`, `std`, `sdk/auth`, `amino`; `gno.land/pkg/gnoland`, `gnoclient`), gomobile-bound package `mobile`.

**Spec:** `~/bubblerumble/docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` §4, and the protocol `~/bubblerumble/gnoconnect-session.md` (sections Parameters, Proof of possession, `connect` with a key, Renewal and rotation, `disconnect`, Obtaining the identity's signature, Callback results, Wallet housekeeping).

## Global Constraints

- Repository `~/gnokey-mobile`. Create branch `feat/gnoconnect-sessions` from `feat/deeplink-tx` (commit `01cf1da`, PR #138); this work is stacked on #138 and goes in its own PR later. Do not touch `feat/deeplink-tx`.
- gno stays at `v1.5.0` (`go.mod`); no new module dependencies.
- Every error is a `*core.CodedError` (`"[code] message"`). The GnoConnect protocol codes double as `CodedError` codes so native code can answer the callback with them verbatim: `invalid_request`, `invalid_proof`, `stale_request`, `signer_unavailable`, `session_expired`, `session_not_found`, `session_limit`. `replayed` is internal: native code must **not** answer a replayed request (its first copy is already being handled).
- Chain bounds come from `std`: `std.MaxSessionsPerAccount` (16), `std.MaxAllowPathsPerSession` (8), `std.MaxSessionDuration` (126144000 s), `std.MaxSpendPeriod` (2592000 s). Convert with `int64(...)` / `int(...)` where types differ.
- Payload: prefix line `gnoconnect-session-v1`, then `host=<lowercased host>`, then every query parameter except `sig` and `oldsig`, strictly percent-decoded (`+` is a literal plus), sorted by key then value bytewise, joined with `\n`, no trailing newline. A control character (`< 0x20` or `0x7f`) in a key or value is `invalid_request`.
- Signatures: base64url without padding (`base64.RawURLEncoding`), verified with tm2 `PubKey.VerifyBytes`; secp256k1 and ed25519 keys are supported, anything else is `invalid_proof`.
- `iat` window: at most 10 minutes old, at most 1 minute in the future. Replay memory: `(pubkey, state)` pairs for 11 minutes.
- `state` is at most 256 characters.
- Callback `features` for a session-capable wallet: `sendtx,signtx,sessions`.
- Gas for a session transaction: `gasWanted = 1_000_000 + 1_000_000 × messages`; fee from `Service.MinGasFee(gasWanted)` (chain gas price + configured buffer).
- The multi-message document is written by the command to `gnoconnect-session.json` in the user's current directory.
- gomobile surface (`mobile/`): fields are only `string`, `bool`, `int64`, `[]byte`; lists and nested values cross as JSON strings (fields suffixed `JSON`).
- Commit messages follow the repo: `feat(sessions): …`, `test(sessions): …`, `build: …`; no attribution trailer.
- Run `gofmt -w` on the files you touched, then `go vet ./...` and `go test ./core/... ./mobile/...`, before every commit.

## Review Focus

- A link that repeats a single-valued parameter (`pubkey`, `chainid`, `callback`, …) must be refused, so a wallet and a proxy never read two different requests from one signed payload (pinned in Task 2).
- The payload is sorted by key, then value — not by whole `key=value` lines, which differ as soon as one key is a prefix of another (`arg` / `arg.x`) (pinned in Task 1).
- An expired session the chain lists without a public key cannot be revoked, so it must never be offered as housekeeping, and its slot must not be counted as freeable (pinned in Task 6).
- The wallet must never revoke a session that has not expired other than `old` / the `disconnect` key, whatever list of keys the native side passes (pinned in Task 7).
- The same link delivered twice (Android re-delivering an intent, a double tap) must not start a second flow, and must not be answered (pinned in Task 3).

---

## File Structure

- `core/errors.go` — modify: add the protocol codes.
- `core/gnoconnect_payload.go` — create: link splitting, strict query decoding, `CanonicalPayload`.
- `core/gnoconnect_request.go` — create: `SessionRequest`, `ParseSessionRequest`.
- `core/gnoconnect_proof.go` — create: `VerifyProof`, `CheckFreshness`, `ReplayGuard`, `Service.AcceptSessionRequest`.
- `core/client.go` — modify: `Service` gets a clock and a replay guard.
- `core/gnoconnect_grant.go` — create: `Grant`, `CheckNarrowing`.
- `core/gnoconnect_reply.go` — create: `sessionReply`, `sessionAddressOf`.
- `core/query.go` — modify: `SessionStatus.PubKey`, `sessionStatusFrom`, `decodeSessions`, `QuerySessions`.
- `core/gnoconnect_plan.go` — create: `SessionPlan`, `planSessionRequest`, `Service.PlanSessionRequest`.
- `core/gnoconnect_tx.go` — create: `SessionTx`, `composeSessionTx`, `Service.BuildSessionTx`.
- `core/gnoconnect_outcome.go` — create: `SessionOutcome`, `Service.PollSessionOutcome`.
- `mobile/sessions.go` — create: bridge types and methods.
- Tests next to each file (`*_test.go`); `core/gnoconnect_integration_test.go` (build tag `integration`).
- `Makefile` — modify: build a matching `gnokey` for the integration test.

---

### Task 1: Protocol codes and the canonical payload

**Files:**
- Modify: `core/errors.go`
- Create: `core/gnoconnect_payload.go`
- Test: `core/gnoconnect_payload_test.go`

**Interfaces:**
- Produces: constants `CodeInvalidRequest`, `CodeInvalidProof`, `CodeStaleRequest`, `CodeSignerUnavailable`, `CodeSessionExpired`, `CodeSessionNotFound`, `CodeSessionLimit`, `CodeReplayed`; `func CanonicalPayload(rawURL string) (string, error)`; unexported `type queryParam struct{ Key, Value string }`, `func splitLaunchLink(rawURL string) (host, rawQuery string, err error)`, `func decodeQuery(rawQuery string) ([]queryParam, error)`, `func canonicalPayload(host string, params []queryParam) string`; test helper `func requireCode(t *testing.T, err error, code string)`; test constants `vectorGPub`, `vectorLink`, `vectorPayload`.

- [ ] **Step 1: Create the branch**

```bash
cd ~/gnokey-mobile
git checkout feat/deeplink-tx && git checkout -b feat/gnoconnect-sessions
```

- [ ] **Step 2: Write the failing test**

`core/gnoconnect_payload_test.go`:

```go
package core

import (
	"errors"
	"strings"
	"testing"
)

// requireCode fails unless err is a CodedError with the given code.
func requireCode(t *testing.T, err error, code string) {
	t.Helper()
	var ce *CodedError
	if !errors.As(err, &ce) || ce.Code != code {
		t.Fatalf("error = %v, want code %s", err, code)
	}
}

// The vector Bubble Rumble's TypeScript producer and the original Go reference
// agree on (bubblerumble src/session/gnoconnect.test.ts).
const (
	vectorGPub = "gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pqwy7ynrtu4aum2869uhjarjtsuer63evxrrm3d4sa3w6mkyzefv8yhklkkx"
	vectorLink = "land.gno.gnokey://connect?pubkey=" + vectorGPub +
		"&allow=vm%2Fexec%3Agno.land%2Fr%2Ffoo&allow=bank%2Fsend&spend=5000000ugnot&period=3600&expires=2592000" +
		"&chainid=dev&callback=https%3A%2F%2Fexample.com%2Fcb%3Fx%3D1&state=ab%2Bc%3D&iat=1790841600"
)

var vectorPayload = strings.Join([]string{
	"gnoconnect-session-v1",
	"host=connect",
	"allow=bank/send",
	"allow=vm/exec:gno.land/r/foo",
	"callback=https://example.com/cb?x=1",
	"chainid=dev",
	"expires=2592000",
	"iat=1790841600",
	"period=3600",
	"pubkey=" + vectorGPub,
	"spend=5000000ugnot",
	"state=ab+c=",
}, "\n")

func TestCanonicalPayloadMatchesTheSharedVector(t *testing.T) {
	for _, link := range []string{
		vectorLink,
		vectorLink + "&sig=AAAA&oldsig=BBBB",                       // the signatures are not signed
		strings.Replace(vectorLink, "://connect", "://Connect", 1), // the host is lowercased
		vectorLink + "#status=ignored",                             // the fragment is not part of the request
	} {
		got, err := CanonicalPayload(link)
		if err != nil {
			t.Fatalf("%s: %v", link, err)
		}
		if got != vectorPayload {
			t.Errorf("%s:\n got %q\nwant %q", link, got, vectorPayload)
		}
	}
}

func TestCanonicalPayloadSortsByKeyThenValue(t *testing.T) {
	// Sorting whole "k=v" lines would put "arg.x=a" first ('.' < '='); the spec sorts by key, then value.
	got, err := CanonicalPayload("land.gno.gnokey://disconnect?arg.x=a&arg=z&arg=b")
	if err != nil {
		t.Fatal(err)
	}
	want := "gnoconnect-session-v1\nhost=disconnect\narg=b\narg=z\narg.x=a"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestCanonicalPayloadKeepsPlusLiteral(t *testing.T) {
	got, err := CanonicalPayload("land.gno.gnokey://disconnect?state=a+b%2Bc")
	if err != nil {
		t.Fatal(err)
	}
	if want := "gnoconnect-session-v1\nhost=disconnect\nstate=a+b+c"; got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestCanonicalPayloadRefusesMalformedLinks(t *testing.T) {
	for _, link := range []string{
		"land.gno.gnokey://disconnect?state=a%0Ab", // line break in a value
		"land.gno.gnokey://disconnect?st%09ate=x",  // control character in a key
		"land.gno.gnokey://disconnect?state=%7F",   // DEL
		"land.gno.gnokey://disconnect?state=%zz",   // bad escape
		"disconnect?state=x",                       // not a launch link
	} {
		_, err := CanonicalPayload(link)
		requireCode(t, err, CodeInvalidRequest)
	}
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `go test ./core/ -run CanonicalPayload`
Expected: FAIL — `undefined: CanonicalPayload` (and `CodeInvalidRequest`).

- [ ] **Step 4: Add the protocol codes**

In `core/errors.go`, inside the existing `const ( … )` block, after `CodeInternal = "internal"`:

```go

	// GnoConnect protocol codes: a session request that fails with one of these
	// is answered to the producer's callback as `code=<code>`.
	CodeInvalidRequest    = "invalid_request"
	CodeInvalidProof      = "invalid_proof"
	CodeStaleRequest      = "stale_request"
	CodeSignerUnavailable = "signer_unavailable"
	CodeSessionExpired    = "session_expired"
	CodeSessionNotFound   = "session_not_found"
	CodeSessionLimit      = "session_limit"
	// CodeReplayed is not a protocol code: the same request arrived twice and its
	// first copy is already being handled, so the copy gets no answer at all.
	CodeReplayed = "replayed"
```

- [ ] **Step 5: Write the payload code**

`core/gnoconnect_payload.go`:

```go
package core

import (
	"net/url"
	"sort"
	"strings"
)

// payloadPrefix starts every session-request payload, so it can never be
// mistaken for a transaction sign document (which starts with '{'): the same
// key signs both.
const payloadPrefix = "gnoconnect-session-v1"

// queryParam is one decoded query parameter, kept in link order.
type queryParam struct{ Key, Value string }

// splitLaunchLink returns the lowercased host and the raw query of a launch
// link, `<scheme>://<host>?<query>#<fragment>`. The fragment is not part of a
// request and is dropped.
func splitLaunchLink(rawURL string) (host, rawQuery string, err error) {
	i := strings.Index(rawURL, "://")
	if i < 0 {
		return "", "", Errf(CodeInvalidRequest, "not a launch link: %q", rawURL)
	}
	rest := rawURL[i+3:]
	if j := strings.IndexByte(rest, '#'); j >= 0 {
		rest = rest[:j]
	}
	hostPath, query, _ := strings.Cut(rest, "?")
	host, _, _ = strings.Cut(hostPath, "/")
	return strings.ToLower(host), query, nil
}

// decodeQuery splits a raw query into parameters, percent-decoding keys and
// values strictly (RFC 3986): '+' stays a literal plus, as the launch-link
// rules require for every session parameter.
func decodeQuery(rawQuery string) ([]queryParam, error) {
	var out []queryParam
	for _, part := range strings.Split(rawQuery, "&") {
		if part == "" {
			continue
		}
		k, v, _ := strings.Cut(part, "=")
		key, err := url.PathUnescape(k)
		if err != nil {
			return nil, Errf(CodeInvalidRequest, "bad escape in parameter name %q", k)
		}
		value, err := url.PathUnescape(v)
		if err != nil {
			return nil, Errf(CodeInvalidRequest, "bad escape in %s", key)
		}
		if hasControl(key) || hasControl(value) {
			return nil, Errf(CodeInvalidRequest, "control character in %q", key)
		}
		out = append(out, queryParam{Key: key, Value: value})
	}
	return out, nil
}

func hasControl(s string) bool {
	return strings.ContainsFunc(s, func(r rune) bool { return r < 0x20 || r == 0x7f })
}

// CanonicalPayload is the text a session request is signed over
// (gnoconnect-session.md, "Proof of possession"): the prefix, the host, then
// every parameter but `sig` and `oldsig`, sorted by key and then value.
func CanonicalPayload(rawURL string) (string, error) {
	host, rawQuery, err := splitLaunchLink(rawURL)
	if err != nil {
		return "", err
	}
	params, err := decodeQuery(rawQuery)
	if err != nil {
		return "", err
	}
	return canonicalPayload(host, params), nil
}

func canonicalPayload(host string, params []queryParam) string {
	kept := make([]queryParam, 0, len(params))
	for _, p := range params {
		if p.Key != "sig" && p.Key != "oldsig" {
			kept = append(kept, p)
		}
	}
	// By key, then by value: sorting the joined "k=v" lines would differ as soon
	// as one key is a prefix of another.
	sort.SliceStable(kept, func(i, j int) bool {
		if kept[i].Key != kept[j].Key {
			return kept[i].Key < kept[j].Key
		}
		return kept[i].Value < kept[j].Value
	})
	var b strings.Builder
	b.WriteString(payloadPrefix)
	b.WriteString("\nhost=")
	b.WriteString(host)
	for _, p := range kept {
		b.WriteString("\n")
		b.WriteString(p.Key)
		b.WriteString("=")
		b.WriteString(p.Value)
	}
	return b.String()
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `go test ./core/ -run CanonicalPayload -v`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
go vet ./... && go test ./core/... ./mobile/...
git add core/errors.go core/gnoconnect_payload.go core/gnoconnect_payload_test.go
git commit -m "feat(sessions): the canonical payload a session request is signed over"
```

---

### Task 2: Parse and validate a session request

**Files:**
- Create: `core/gnoconnect_request.go`
- Test: `core/gnoconnect_request_test.go`

**Interfaces:**
- Consumes: `splitLaunchLink`, `decodeQuery`, `canonicalPayload`, `queryParam`, the codes (Task 1); `ValidateAllowPaths` (existing).
- Produces:

```go
const HostConnect = "connect"; const HostDisconnect = "disconnect"
type SessionRequest struct {
	Host string; PubKey string; Old string; Allow []string; Spend string; Period int64; Expires int64
	ChainID string; RPC string; Signer string; Callback string; State string; IAT int64
	Payload string; Sig []byte; OldSig []byte
}
func ParseSessionRequest(rawURL string) (*SessionRequest, error)
```

Test helpers (in the test file, used by later tasks): `testIdentity` (const), `func launchLink(host string, kv ...string) string`, `func connectParams(pubkey string) []string`, `func withParam(kv []string, key, value string) []string`, `func withoutParam(kv []string, key string) []string`, `func newGPub() string`.

- [ ] **Step 1: Write the failing test**

`core/gnoconnect_request_test.go`:

```go
package core

import (
	"net/url"
	"strings"
	"testing"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

const testIdentity = "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" // gnodev test1

// launchLink builds a launch link with strictly percent-encoded values, in the given order.
func launchLink(host string, kv ...string) string {
	q := make([]string, 0, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		q = append(q, kv[i]+"="+strings.ReplaceAll(url.QueryEscape(kv[i+1]), "+", "%20"))
	}
	return "land.gno.gnokey://" + host + "?" + strings.Join(q, "&")
}

// connectParams is a valid `connect` with a key, before signing.
func connectParams(pubkey string) []string {
	return []string{
		"pubkey", pubkey,
		"allow", "vm/exec:gno.land/r/demo/a",
		"allow", "bank/send",
		"spend", "5000000ugnot", "period", "3600", "expires", "2592000",
		"chainid", "dev", "rpc", "http://127.0.0.1:26657",
		"callback", "bubblerumble://session-callback", "state", "s1", "iat", "1790841600",
	}
}

// withParam replaces every value of key with one value (appending it when absent).
func withParam(kv []string, key, value string) []string {
	out := withoutParam(kv, key)
	return append(out, key, value)
}

func withoutParam(kv []string, key string) []string {
	var out []string
	for i := 0; i+1 < len(kv); i += 2 {
		if kv[i] != key {
			out = append(out, kv[i], kv[i+1])
		}
	}
	return out
}

func newGPub() string { return crypto.PubKeyToBech32(secp256k1.GenPrivKey().PubKey()) }

func TestParseConnectWithAKey(t *testing.T) {
	r, err := ParseSessionRequest(launchLink(HostConnect, append(connectParams(vectorGPub), "sig", "AAAA", "x-future", "1")...))
	if err != nil {
		t.Fatal(err)
	}
	if r.Host != HostConnect || r.PubKey != vectorGPub || r.ChainID != "dev" || r.State != "s1" || r.IAT != 1790841600 {
		t.Errorf("fields: %+v", r)
	}
	if len(r.Allow) != 2 || r.Allow[0] != "vm/exec:gno.land/r/demo/a" || r.Allow[1] != "bank/send" {
		t.Errorf("allow kept in link order: %v", r.Allow)
	}
	if r.Spend != "5000000ugnot" || r.Period != 3600 || r.Expires != 2592000 {
		t.Errorf("grant: %+v", r)
	}
	if len(r.Sig) != 3 { // "AAAA" is three zero bytes
		t.Errorf("sig = %v", r.Sig)
	}
	// An unknown parameter is ignored but still signed.
	if !strings.Contains(r.Payload, "\nx-future=1") {
		t.Errorf("payload must cover unknown parameters: %q", r.Payload)
	}
}

func TestParseRenewal(t *testing.T) {
	old := newGPub()
	kv := append(connectParams(vectorGPub), "old", old, "signer", testIdentity, "sig", "AAAA", "oldsig", "BBBB")
	r, err := ParseSessionRequest(launchLink(HostConnect, kv...))
	if err != nil {
		t.Fatal(err)
	}
	if r.Old != old || r.Signer != testIdentity || len(r.OldSig) != 3 {
		t.Errorf("renewal fields: %+v", r)
	}
}

func TestParseDisconnectDropsGrantParameters(t *testing.T) {
	kv := []string{"pubkey", vectorGPub, "old", newGPub(), "allow", "bank/send", "spend", "1ugnot", "expires", "60",
		"chainid", "dev", "signer", testIdentity, "state", "s2", "iat", "1790841600", "sig", "AAAA"}
	r, err := ParseSessionRequest(launchLink(HostDisconnect, kv...))
	if err != nil {
		t.Fatal(err)
	}
	if r.Old != "" || r.Allow != nil || r.Spend != "" || r.Expires != 0 {
		t.Errorf("disconnect must not carry a grant: %+v", r)
	}
	if r.Callback != "" {
		t.Errorf("callback is optional on disconnect: %q", r.Callback)
	}
}

func TestParseRefusesInvalidRequests(t *testing.T) {
	signed := func(kv []string) []string { return append(kv, "sig", "AAAA") }
	base := connectParams(vectorGPub)
	nineAllows := base
	for i := 0; i < 8; i++ {
		nineAllows = append(nineAllows, "allow", "bank/send")
	}
	disc := []string{"pubkey", vectorGPub, "chainid", "dev", "signer", testIdentity, "state", "s", "iat", "1"}
	cases := []struct {
		name string
		host string
		kv   []string
		code string
	}{
		{"not a session host", "sendtx", signed(base), CodeInvalidRequest},
		{"no pubkey", HostConnect, signed(withoutParam(base, "pubkey")), CodeInvalidRequest},
		{"malformed pubkey", HostConnect, signed(withParam(base, "pubkey", "gpub1xyz")), CodeInvalidRequest},
		{"no chainid", HostConnect, signed(withoutParam(base, "chainid")), CodeInvalidRequest},
		{"no state", HostConnect, signed(withoutParam(base, "state")), CodeInvalidRequest},
		{"state too long", HostConnect, signed(withParam(base, "state", strings.Repeat("s", 257))), CodeInvalidRequest},
		{"no iat", HostConnect, signed(withoutParam(base, "iat")), CodeInvalidRequest},
		{"iat not a number", HostConnect, signed(withParam(base, "iat", "soon")), CodeInvalidRequest},
		{"no sig", HostConnect, base, CodeInvalidRequest},
		{"sig not base64url", HostConnect, append(base, "sig", "a+b/"), CodeInvalidProof},
		{"duplicate chainid", HostConnect, signed(append(base, "chainid", "other")), CodeInvalidRequest},
		{"duplicate pubkey", HostConnect, signed(append(base, "pubkey", newGPub())), CodeInvalidRequest},
		{"no callback", HostConnect, signed(withoutParam(base, "callback")), CodeInvalidRequest},
		{"no allow", HostConnect, signed(withoutParam(base, "allow")), CodeInvalidRequest},
		{"nine allow", HostConnect, signed(nineAllows), CodeInvalidRequest},
		{"bad allow", HostConnect, signed(withParam(base, "allow", "vm/call")), CodeInvalidRequest},
		{"no expires", HostConnect, signed(withoutParam(base, "expires")), CodeInvalidRequest},
		{"expires 0", HostConnect, signed(withParam(base, "expires", "0")), CodeInvalidRequest},
		{"expires past 4 years", HostConnect, signed(withParam(base, "expires", "126144001")), CodeInvalidRequest},
		{"negative period", HostConnect, signed(withParam(base, "period", "-1")), CodeInvalidRequest},
		{"period past 30 days", HostConnect, signed(withParam(base, "period", "2592001")), CodeInvalidRequest},
		{"bad spend", HostConnect, signed(withParam(base, "spend", "five gnot")), CodeInvalidRequest},
		{"bad signer", HostConnect, signed(withParam(base, "signer", "g1nope")), CodeInvalidRequest},
		{"old equals pubkey", HostConnect, append(base, "old", vectorGPub, "signer", testIdentity, "sig", "AAAA", "oldsig", "AAAA"), CodeInvalidRequest},
		{"old without signer", HostConnect, append(base, "old", newGPub(), "sig", "AAAA", "oldsig", "AAAA"), CodeInvalidRequest},
		{"old without oldsig", HostConnect, append(base, "old", newGPub(), "signer", testIdentity, "sig", "AAAA"), CodeInvalidRequest},
		{"disconnect without signer", HostDisconnect, signed(withoutParam(disc, "signer")), CodeInvalidRequest},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := ParseSessionRequest(launchLink(c.host, c.kv...))
			requireCode(t, err, c.code)
		})
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run Parse`
Expected: FAIL — `undefined: ParseSessionRequest`.

- [ ] **Step 3: Write the parser**

`core/gnoconnect_request.go`:

```go
package core

import (
	"encoding/base64"
	"strconv"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// GnoConnect session hosts (gnoconnect-session.md). A `connect` comes here
// only when it names a key; an identity-only `connect` stays a sign-in.
const (
	HostConnect    = "connect"
	HostDisconnect = "disconnect"
)

const maxStateLen = 256

// SessionRequest is a `connect` that names the producer's key (a grant, or a
// renewal with Old) or a `disconnect` (a revocation), as the producer signed it.
type SessionRequest struct {
	Host     string   // HostConnect or HostDisconnect
	PubKey   string   // bech32 gpub1…: the producer's key
	Old      string   // connect: the producer's current key, revoked in the same transaction
	Allow    []string // connect: allow entries, link order
	Spend    string   // connect: coins per period; empty = the session cannot spend
	Period   int64    // connect: seconds; 0 = lifetime cap
	Expires  int64    // connect: lifetime in seconds from inclusion
	ChainID  string
	RPC      string // advisory
	Signer   string // the identity pin; required with Old and on disconnect
	Callback string // required on connect, optional on disconnect
	State    string
	IAT      int64 // issue time, unix seconds

	Payload string // what Sig and OldSig sign (CanonicalPayload)
	Sig     []byte
	OldSig  []byte
}

// ParseSessionRequest reads and validates a session request. It checks the
// shape only: the proof, the clock and the chain come after (VerifyProof,
// CheckFreshness, PlanSessionRequest).
func ParseSessionRequest(rawURL string) (*SessionRequest, error) {
	host, rawQuery, err := splitLaunchLink(rawURL)
	if err != nil {
		return nil, err
	}
	if host != HostConnect && host != HostDisconnect {
		return nil, Errf(CodeInvalidRequest, "%q is not a session host", host)
	}
	params, err := decodeQuery(rawQuery)
	if err != nil {
		return nil, err
	}

	r := &SessionRequest{Host: host, Payload: canonicalPayload(host, params)}
	var period, expires, iat, sig, oldSig string
	single := map[string]*string{
		"pubkey": &r.PubKey, "old": &r.Old, "spend": &r.Spend, "period": &period, "expires": &expires,
		"chainid": &r.ChainID, "rpc": &r.RPC, "signer": &r.Signer, "callback": &r.Callback,
		"state": &r.State, "iat": &iat, "sig": &sig, "oldsig": &oldSig,
	}
	seen := map[string]bool{}
	for _, p := range params {
		if p.Key == "allow" {
			r.Allow = append(r.Allow, p.Value)
			continue
		}
		dst, ok := single[p.Key]
		if !ok {
			continue // unknown: signed (it is in Payload), otherwise ignored
		}
		// Two values for one parameter would let the wallet and whatever relayed
		// the link read two different requests out of one signed payload.
		if seen[p.Key] {
			return nil, Errf(CodeInvalidRequest, "%s appears more than once", p.Key)
		}
		seen[p.Key] = true
		*dst = p.Value
	}

	pub, err := parsePubKeyParam("pubkey", r.PubKey)
	if err != nil {
		return nil, err
	}
	for _, p := range []struct{ name, value string }{
		{"chainid", r.ChainID}, {"state", r.State}, {"iat", iat}, {"sig", sig},
	} {
		if p.value == "" {
			return nil, Errf(CodeInvalidRequest, "%s is required", p.name)
		}
	}
	if len(r.State) > maxStateLen {
		return nil, Errf(CodeInvalidRequest, "state is longer than %d characters", maxStateLen)
	}
	if r.IAT, err = strconv.ParseInt(iat, 10, 64); err != nil {
		return nil, Errf(CodeInvalidRequest, "iat %q is not unix seconds", iat)
	}
	if r.Sig, err = decodeSig("sig", sig); err != nil {
		return nil, err
	}
	if r.Signer != "" {
		if _, err := crypto.AddressFromBech32(r.Signer); err != nil {
			return nil, Errf(CodeInvalidRequest, "signer %q: %v", r.Signer, err)
		}
	}

	if host == HostDisconnect {
		if r.Signer == "" {
			return nil, Errf(CodeInvalidRequest, "signer is required on disconnect")
		}
		// The grant parameters mean nothing here; dropping them keeps later code
		// from ever acting on them.
		r.Old, r.Allow, r.Spend, r.Period, r.Expires = "", nil, "", 0, 0
		return r, nil
	}

	if r.Callback == "" {
		return nil, Errf(CodeInvalidRequest, "callback is required on connect")
	}
	if err := ValidateAllowPaths(r.Allow); err != nil {
		return nil, Errf(CodeInvalidRequest, "allow: %v", err.(*CodedError).Msg)
	}
	if expires == "" {
		return nil, Errf(CodeInvalidRequest, "expires is required")
	}
	if r.Expires, err = strconv.ParseInt(expires, 10, 64); err != nil || r.Expires < 1 || r.Expires > int64(std.MaxSessionDuration) {
		return nil, Errf(CodeInvalidRequest, "expires %q: want 1 to %d seconds", expires, int64(std.MaxSessionDuration))
	}
	if period != "" {
		if r.Period, err = strconv.ParseInt(period, 10, 64); err != nil || r.Period < 0 || r.Period > int64(std.MaxSpendPeriod) {
			return nil, Errf(CodeInvalidRequest, "period %q: want 0 to %d seconds", period, int64(std.MaxSpendPeriod))
		}
	}
	if r.Spend != "" {
		if _, err := std.ParseCoins(r.Spend); err != nil {
			return nil, Errf(CodeInvalidRequest, "spend %q: %v", r.Spend, err)
		}
	}
	if r.Old != "" {
		old, err := parsePubKeyParam("old", r.Old)
		if err != nil {
			return nil, err
		}
		if old.Equals(pub) {
			return nil, Errf(CodeInvalidRequest, "old must differ from pubkey")
		}
		if r.Signer == "" {
			return nil, Errf(CodeInvalidRequest, "signer is required with old")
		}
		if oldSig == "" {
			return nil, Errf(CodeInvalidRequest, "oldsig is required with old")
		}
		if r.OldSig, err = decodeSig("oldsig", oldSig); err != nil {
			return nil, err
		}
	}
	return r, nil
}

func parsePubKeyParam(name, value string) (crypto.PubKey, error) {
	if value == "" {
		return nil, Errf(CodeInvalidRequest, "%s is required", name)
	}
	pub, err := crypto.PubKeyFromBech32(value)
	if err != nil {
		return nil, Errf(CodeInvalidRequest, "%s %q: %v", name, value, err)
	}
	return pub, nil
}

// decodeSig decodes a base64url signature (RFC 4648 §5, no padding). A value
// that does not decode cannot verify, so it is answered as a failed proof.
func decodeSig(name, value string) ([]byte, error) {
	b, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil || len(b) == 0 {
		return nil, Errf(CodeInvalidProof, "%s is not base64url", name)
	}
	return b, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/ -run 'Parse|CanonicalPayload' -v`
Expected: PASS (every case of `TestParseRefusesInvalidRequests` included).

- [ ] **Step 5: Commit**

```bash
go vet ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_request.go core/gnoconnect_request_test.go
git commit -m "feat(sessions): parse and validate connect-with-a-key and disconnect"
```

---

### Task 3: Proof of possession, freshness, replay, and `AcceptSessionRequest`

**Files:**
- Create: `core/gnoconnect_proof.go`
- Modify: `core/client.go`
- Test: `core/gnoconnect_proof_test.go`

**Interfaces:**
- Consumes: `SessionRequest`, `ParseSessionRequest`, codes (Tasks 1–2); `newTestService` (existing, `core/command_test.go`).
- Produces: `func (r *SessionRequest) VerifyProof() error`; `func CheckFreshness(iat int64, now time.Time) error`; `type ReplayGuard`; `func NewReplayGuard() *ReplayGuard`; `func (g *ReplayGuard) Admit(pubkey, state string, now time.Time) bool`; `Service` fields `now func() time.Time` and `replay *ReplayGuard`; `func (s *Service) AcceptSessionRequest(rawURL string) (*SessionRequest, error)`; test helper `func signedLink(t *testing.T, host string, kv []string, key, oldKey crypto.PrivKey) string`.

- [ ] **Step 1: Write the failing test**

`core/gnoconnect_proof_test.go`:

```go
package core

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/ed25519"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

// signedLink builds a launch link and signs it as a producer does: sig by key,
// and oldsig by oldKey when it is not nil, both over the canonical payload.
func signedLink(t *testing.T, host string, kv []string, key, oldKey crypto.PrivKey) string {
	t.Helper()
	link := launchLink(host, kv...)
	payload, err := CanonicalPayload(link)
	if err != nil {
		t.Fatal(err)
	}
	sig, err := key.Sign([]byte(payload))
	if err != nil {
		t.Fatal(err)
	}
	link += "&sig=" + base64.RawURLEncoding.EncodeToString(sig)
	if oldKey != nil {
		oldSig, err := oldKey.Sign([]byte(payload))
		if err != nil {
			t.Fatal(err)
		}
		link += "&oldsig=" + base64.RawURLEncoding.EncodeToString(oldSig)
	}
	return link
}

func parsed(t *testing.T, link string) *SessionRequest {
	t.Helper()
	r, err := ParseSessionRequest(link)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestVerifyProof(t *testing.T) {
	sk, ek := secp256k1.GenPrivKey(), ed25519.GenPrivKey()
	for name, key := range map[string]crypto.PrivKey{"secp256k1": sk, "ed25519": ek} {
		t.Run(name, func(t *testing.T) {
			r := parsed(t, signedLink(t, HostConnect, connectParams(crypto.PubKeyToBech32(key.PubKey())), key, nil))
			if err := r.VerifyProof(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestVerifyProofRefusesWhatTheKeyDidNotSign(t *testing.T) {
	key := secp256k1.GenPrivKey()
	pub := crypto.PubKeyToBech32(key.PubKey())

	tampered := strings.Replace(signedLink(t, HostConnect, connectParams(pub), key, nil), "state=s1", "state=s2", 1)
	requireCode(t, parsed(t, tampered).VerifyProof(), CodeInvalidProof)

	byAnother := signedLink(t, HostConnect, connectParams(pub), secp256k1.GenPrivKey(), nil)
	requireCode(t, parsed(t, byAnother).VerifyProof(), CodeInvalidProof)

	// A connect signed as a disconnect (or the reverse) fails: the host is in the payload.
	disc := []string{"pubkey", pub, "chainid", "dev", "signer", testIdentity, "state", "s", "iat", "1790841600"}
	asConnect := strings.Replace(signedLink(t, HostDisconnect, disc, key, nil), "://disconnect", "://connect", 1)
	if r, err := ParseSessionRequest(asConnect); err == nil { // it may already fail to parse as a connect
		requireCode(t, r.VerifyProof(), CodeInvalidProof)
	}
}

func TestVerifyProofChecksOldsig(t *testing.T) {
	key, old := secp256k1.GenPrivKey(), secp256k1.GenPrivKey()
	kv := append(connectParams(crypto.PubKeyToBech32(key.PubKey())),
		"old", crypto.PubKeyToBech32(old.PubKey()), "signer", testIdentity)

	if err := parsed(t, signedLink(t, HostConnect, kv, key, old)).VerifyProof(); err != nil {
		t.Fatal(err)
	}
	wrongOld := signedLink(t, HostConnect, kv, key, secp256k1.GenPrivKey())
	requireCode(t, parsed(t, wrongOld).VerifyProof(), CodeInvalidProof)
}

func TestCheckFreshness(t *testing.T) {
	iat := int64(1790841600)
	for _, c := range []struct {
		now  int64
		code string
	}{
		{iat, ""}, {iat + 600, ""}, {iat + 601, CodeStaleRequest}, {iat - 60, ""}, {iat - 61, CodeStaleRequest},
	} {
		err := CheckFreshness(iat, time.Unix(c.now, 0))
		if c.code == "" {
			if err != nil {
				t.Errorf("now %+d: %v", c.now-iat, err)
			}
			continue
		}
		requireCode(t, err, c.code)
	}
}

func TestReplayGuard(t *testing.T) {
	g := NewReplayGuard()
	now := time.Unix(1790841600, 0)
	if !g.Admit("k", "s", now) {
		t.Fatal("first copy refused")
	}
	if g.Admit("k", "s", now.Add(time.Second)) {
		t.Fatal("second copy admitted")
	}
	if !g.Admit("k", "other", now) || !g.Admit("k2", "s", now) {
		t.Fatal("a different pair is a different request")
	}
	if !g.Admit("k", "s", now.Add(12*time.Minute)) {
		t.Fatal("a pair is forgotten once its iat window is over")
	}
}

func TestAcceptSessionRequest(t *testing.T) {
	svc, _ := newTestService(t)
	svc.now = func() time.Time { return time.Unix(1790841600+5, 0) }
	key := secp256k1.GenPrivKey()
	link := signedLink(t, HostConnect, connectParams(crypto.PubKeyToBech32(key.PubKey())), key, nil)

	r, err := svc.AcceptSessionRequest(link)
	if err != nil {
		t.Fatal(err)
	}
	if r.State != "s1" {
		t.Errorf("state = %q", r.State)
	}
	_, err = svc.AcceptSessionRequest(link) // delivered twice
	requireCode(t, err, CodeReplayed)

	svc.now = func() time.Time { return time.Unix(1790841600+3600, 0) }
	stale := signedLink(t, HostConnect, withParam(connectParams(crypto.PubKeyToBech32(key.PubKey())), "state", "s9"), key, nil)
	_, err = svc.AcceptSessionRequest(stale)
	requireCode(t, err, CodeStaleRequest)

	tampered := strings.Replace(link, "state=s1", "state=s3", 1)
	_, err = svc.AcceptSessionRequest(tampered)
	requireCode(t, err, CodeInvalidProof)
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run 'Proof|Freshness|Replay|Accept'`
Expected: FAIL — `r.VerifyProof undefined`, `undefined: CheckFreshness`, `svc.now undefined`.

- [ ] **Step 3: Give `Service` a clock and a replay guard**

In `core/client.go`, add `"time"` to the imports and two fields to `Service`:

```go
type Service struct {
	mu      sync.RWMutex
	cfg     NetworkConfig
	rpc     rpcclient.Client
	ks      *Keystore
	margins GasMargins
	now     func() time.Time // the wallet's clock; tests replace it
	replay  *ReplayGuard     // session requests already accepted
}
```

and set them in `NewService`:

```go
	s := &Service{ks: ks, margins: DefaultGasMargins, now: time.Now, replay: NewReplayGuard()}
```

- [ ] **Step 4: Write the proof code**

`core/gnoconnect_proof.go`:

```go
package core

import (
	"sync"
	"time"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/ed25519"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

// The iat window (gnoconnect-session.md, "Wallet checks"): it bounds how long a
// link may wait before the wallet opens it, not how long the identity's
// signature may take.
const (
	iatMaxAge    = 10 * time.Minute
	iatMaxFuture = time.Minute
)

// VerifyProof checks that the key the request names signed it, and with Old,
// that the old key did too.
func (r *SessionRequest) VerifyProof() error {
	if err := verifySig("sig", r.PubKey, r.Sig, r.Payload); err != nil {
		return err
	}
	if r.Old != "" {
		return verifySig("oldsig", r.Old, r.OldSig, r.Payload)
	}
	return nil
}

func verifySig(name, gpub string, sig []byte, payload string) error {
	pub, err := crypto.PubKeyFromBech32(gpub)
	if err != nil {
		return Errf(CodeInvalidRequest, "%q: %v", gpub, err)
	}
	switch pub.(type) {
	case secp256k1.PubKeySecp256k1, ed25519.PubKeyEd25519:
	default:
		return Errf(CodeInvalidProof, "%s: %T keys are not supported", name, pub)
	}
	if !pub.VerifyBytes([]byte(payload), sig) {
		return Errf(CodeInvalidProof, "%s does not verify", name)
	}
	return nil
}

// CheckFreshness refuses a request issued more than 10 minutes ago or more
// than a minute in the future, by the wallet's clock.
func CheckFreshness(iat int64, now time.Time) error {
	issued := time.Unix(iat, 0)
	if now.Sub(issued) > iatMaxAge || issued.Sub(now) > iatMaxFuture {
		return Errf(CodeStaleRequest, "issued at %d, now %d", iat, now.Unix())
	}
	return nil
}

// ReplayGuard remembers the (pubkey, state) pairs the wallet accepted, for as
// long as a request carrying them could still pass CheckFreshness.
type ReplayGuard struct {
	mu   sync.Mutex
	seen map[string]time.Time
}

func NewReplayGuard() *ReplayGuard { return &ReplayGuard{seen: map[string]time.Time{}} }

// Admit records the pair and reports whether it is new.
func (g *ReplayGuard) Admit(pubkey, state string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for k, at := range g.seen {
		if now.Sub(at) > iatMaxAge+iatMaxFuture {
			delete(g.seen, k)
		}
	}
	k := pubkey + "\x00" + state
	if _, ok := g.seen[k]; ok {
		return false
	}
	g.seen[k] = now
	return true
}

// AcceptSessionRequest runs every check a wallet makes before showing anything
// to the user: shape, proof of possession, freshness, and replay. A replayed
// request fails with CodeReplayed, which the caller must not answer.
func (s *Service) AcceptSessionRequest(rawURL string) (*SessionRequest, error) {
	r, err := ParseSessionRequest(rawURL)
	if err != nil {
		return nil, err
	}
	if err := r.VerifyProof(); err != nil {
		return nil, err
	}
	now := s.now()
	if err := CheckFreshness(r.IAT, now); err != nil {
		return nil, err
	}
	if !s.replay.Admit(r.PubKey, r.State, now) {
		return nil, Errf(CodeReplayed, "this request is already being handled")
	}
	return r, nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./core/ -run 'Proof|Freshness|Replay|Accept|Parse|CanonicalPayload' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
go vet ./... && go test ./core/... ./mobile/...
git add core/client.go core/gnoconnect_proof.go core/gnoconnect_proof_test.go
git commit -m "feat(sessions): verify the proof of possession, the iat window and replays"
```

---

### Task 4: The grant and its narrowing

**Files:**
- Create: `core/gnoconnect_grant.go`
- Test: `core/gnoconnect_grant_test.go`

**Interfaces:**
- Consumes: `SessionRequest` (Task 2), `ValidateAllowPaths`, `parseCoinsOrEmpty` (existing, `core/sessionfix.go`).
- Produces: `type Grant struct { Allow []string; Spend string; Period int64; Expires int64 }`; `func (r *SessionRequest) Grant() Grant`; `func CheckNarrowing(requested, chosen Grant) error` (code `invalid_spec` on any widening).

- [ ] **Step 1: Write the failing test**

`core/gnoconnect_grant_test.go`:

```go
package core

import "testing"

func requested() Grant {
	return Grant{Allow: []string{"vm/exec:gno.land/r/demo/a", "bank/send"}, Spend: "5000000ugnot", Period: 3600, Expires: 2592000}
}

func TestRequestGrantIsACopy(t *testing.T) {
	r := &SessionRequest{Allow: []string{"bank/send"}, Spend: "1ugnot", Period: 60, Expires: 3600}
	g := r.Grant()
	g.Allow[0] = "vm/run"
	if r.Allow[0] != "bank/send" {
		t.Fatal("changing the grant changed the request")
	}
	if g.Spend != "1ugnot" || g.Period != 60 || g.Expires != 3600 {
		t.Errorf("grant = %+v", g)
	}
}

func TestCheckNarrowingAccepts(t *testing.T) {
	for name, chosen := range map[string]Grant{
		"the request itself":   requested(),
		"fewer entries":        {Allow: []string{"bank/send"}, Spend: "5000000ugnot", Period: 3600, Expires: 2592000},
		"lower spend":          {Allow: requested().Allow, Spend: "1000000ugnot", Period: 3600, Expires: 2592000},
		"no spending":          {Allow: requested().Allow, Spend: "", Period: 3600, Expires: 2592000},
		"longer period":        {Allow: requested().Allow, Spend: "5000000ugnot", Period: 86400, Expires: 2592000},
		"lifetime cap":         {Allow: requested().Allow, Spend: "5000000ugnot", Period: 0, Expires: 2592000},
		"shorter lifetime":     {Allow: requested().Allow, Spend: "5000000ugnot", Period: 3600, Expires: 86400},
	} {
		if err := CheckNarrowing(requested(), chosen); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestCheckNarrowingRefusesWidening(t *testing.T) {
	lifetimeCap := requested()
	lifetimeCap.Period = 0
	for name, c := range map[string]struct{ req, chosen Grant }{
		"new entry":           {requested(), Grant{Allow: []string{"vm/run"}, Spend: "5000000ugnot", Period: 3600, Expires: 2592000}},
		"higher spend":        {requested(), Grant{Allow: requested().Allow, Spend: "6000000ugnot", Period: 3600, Expires: 2592000}},
		"other denomination":  {requested(), Grant{Allow: requested().Allow, Spend: "1foo", Period: 3600, Expires: 2592000}},
		"shorter period":      {requested(), Grant{Allow: requested().Allow, Spend: "5000000ugnot", Period: 60, Expires: 2592000}},
		"period on a cap":     {lifetimeCap, Grant{Allow: requested().Allow, Spend: "5000000ugnot", Period: 3600, Expires: 2592000}},
		"longer lifetime":     {requested(), Grant{Allow: requested().Allow, Spend: "5000000ugnot", Period: 3600, Expires: 2592001}},
		"no lifetime":         {requested(), Grant{Allow: requested().Allow, Spend: "5000000ugnot", Period: 3600, Expires: 0}},
		"no entries":          {requested(), Grant{Allow: nil, Spend: "5000000ugnot", Period: 3600, Expires: 2592000}},
		"period past 30 days": {Grant{Allow: requested().Allow, Spend: "1ugnot", Period: 2592000, Expires: 2592000}, Grant{Allow: requested().Allow, Spend: "1ugnot", Period: 2592001, Expires: 2592000}},
	} {
		if err := CheckNarrowing(c.req, c.chosen); err == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run 'Grant|Narrowing'`
Expected: FAIL — `undefined: Grant`.

- [ ] **Step 3: Write the grant code**

`core/gnoconnect_grant.go`:

```go
package core

import (
	"slices"

	"github.com/gnolang/gno/tm2/pkg/std"
)

// Grant is what a session may do: the request's, or a narrower one the user
// chose on the review screen.
type Grant struct {
	Allow   []string // allow entries
	Spend   string   // coins per period; empty = cannot spend
	Period  int64    // seconds; 0 = lifetime cap
	Expires int64    // lifetime in seconds from inclusion
}

// Grant is what the request asks for.
func (r *SessionRequest) Grant() Grant {
	return Grant{Allow: slices.Clone(r.Allow), Spend: r.Spend, Period: r.Period, Expires: r.Expires}
}

// CheckNarrowing accepts chosen only if it grants no more than requested: the
// user may narrow a request, never widen it (gnoconnect-session.md,
// "Narrowing"). Narrower means fewer entries, a lower or no spend limit, a
// longer period or a lifetime cap (period 0), and a shorter lifetime.
func CheckNarrowing(requested, chosen Grant) error {
	if err := ValidateAllowPaths(chosen.Allow); err != nil {
		return err
	}
	for _, a := range chosen.Allow {
		if !slices.Contains(requested.Allow, a) {
			return Errf(CodeInvalidSpec, "%q was not requested", a)
		}
	}
	req, err := parseCoinsOrEmpty(requested.Spend, "requested spend limit")
	if err != nil {
		return err
	}
	got, err := parseCoinsOrEmpty(chosen.Spend, "spend limit")
	if err != nil {
		return err
	}
	for _, c := range got {
		if c.Amount > req.AmountOf(c.Denom) {
			return Errf(CodeInvalidSpec, "spend limit %s is above the requested %s", chosen.Spend, requested.Spend)
		}
	}
	if chosen.Period < 0 || chosen.Period > int64(std.MaxSpendPeriod) {
		return Errf(CodeInvalidSpec, "period %d: want 0 to %d seconds", chosen.Period, int64(std.MaxSpendPeriod))
	}
	// A lifetime cap (0) is the narrowest period; otherwise the window may only grow.
	if chosen.Period != 0 && (requested.Period == 0 || chosen.Period < requested.Period) {
		return Errf(CodeInvalidSpec, "period %d resets more often than the requested %d", chosen.Period, requested.Period)
	}
	if chosen.Expires < 1 || chosen.Expires > requested.Expires {
		return Errf(CodeInvalidSpec, "lifetime %d: want 1 to the requested %d seconds", chosen.Expires, requested.Expires)
	}
	return nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/ -run 'Grant|Narrowing' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
go vet ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_grant.go core/gnoconnect_grant_test.go
git commit -m "feat(sessions): a grant the user may narrow, never widen"
```

---

### Task 5: The success reply

**Files:**
- Create: `core/gnoconnect_reply.go`
- Test: `core/gnoconnect_reply_test.go`

**Interfaces:**
- Consumes: `SessionRequest`, `HostConnect` (Task 2); `SessionStatus` (existing, `core/query.go`).
- Produces: `const gnoconnectFeatures = "sendtx,signtx,sessions"`; `func sessionReply(r *SessionRequest, identity, sessionAddress string, granted *SessionStatus, revokedOld string) [][2]string`; `func sessionAddressOf(gpub string) (string, error)`.

- [ ] **Step 1: Write the failing test**

`core/gnoconnect_reply_test.go`:

```go
package core

import (
	"reflect"
	"testing"
)

func TestSessionReplyForAConnect(t *testing.T) {
	r := &SessionRequest{Host: HostConnect, ChainID: "dev", State: "s1"}
	granted := &SessionStatus{Found: true, ExpiresAt: 1793433600, AllowPaths: []string{"vm/exec:gno.land/r/demo/a", "bank/send"},
		SpendLimit: "5000000ugnot", SpendPeriod: 3600}
	got := sessionReply(r, testIdentity, "g1session", granted, "g1old")
	want := [][2]string{
		{"status", "success"}, {"address", testIdentity}, {"chainid", "dev"},
		{"features", "sendtx,signtx,sessions"}, {"session", "g1session"}, {"expires_at", "1793433600"},
		{"allow", "vm/exec:gno.land/r/demo/a"}, {"allow", "bank/send"},
		{"spend", "5000000ugnot"}, {"period", "3600"}, {"revoked", "g1old"}, {"state", "s1"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got  %v\nwant %v", got, want)
	}
	for _, kv := range sessionReply(r, testIdentity, "g1session", granted, "") {
		if kv[0] == "revoked" {
			t.Error("revoked must be absent when the transaction revoked no old key")
		}
	}
}

func TestSessionReplyForADisconnect(t *testing.T) {
	r := &SessionRequest{Host: HostDisconnect, ChainID: "dev", State: "s2"}
	got := sessionReply(r, testIdentity, "g1session", &SessionStatus{}, "")
	want := [][2]string{{"status", "success"}, {"address", testIdentity}, {"chainid", "dev"}, {"state", "s2"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("got %v, want %v", got, want)
	}
}

func TestSessionAddressOf(t *testing.T) {
	// vectorGPub's address, as gnokey prints it.
	addr, err := sessionAddressOf(vectorGPub)
	if err != nil {
		t.Fatal(err)
	}
	if len(addr) != 40 || addr[:3] != "g1" {
		t.Errorf("address = %q", addr)
	}
	if _, err := sessionAddressOf("gpub1xyz"); err == nil {
		t.Error("a malformed key has no address")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run 'SessionReply|SessionAddressOf'`
Expected: FAIL — `undefined: sessionReply`.

- [ ] **Step 3: Write the reply code**

`core/gnoconnect_reply.go`:

```go
package core

import (
	"strconv"

	"github.com/gnolang/gno/tm2/pkg/crypto"
)

// gnoconnectFeatures is what a session-capable wallet lists in `features`: the
// signing hosts, and `sessions` (connect with a key, old, and disconnect).
const gnoconnectFeatures = "sendtx,signtx,sessions"

// sessionReply is the success answer to a session request, as ordered pairs
// for the callback (gnoconnect-session.md, "Callback results"). granted is the
// session as the chain stores it, so the producer learns what was actually
// granted after any narrowing; revokedOld is the old key's address when this
// transaction revoked it, or "".
func sessionReply(r *SessionRequest, identity, sessionAddress string, granted *SessionStatus, revokedOld string) [][2]string {
	out := [][2]string{{"status", "success"}, {"address", identity}, {"chainid", r.ChainID}}
	if r.Host == HostConnect {
		out = append(out,
			[2]string{"features", gnoconnectFeatures},
			[2]string{"session", sessionAddress},
			[2]string{"expires_at", strconv.FormatInt(granted.ExpiresAt, 10)})
		for _, a := range granted.AllowPaths {
			out = append(out, [2]string{"allow", a})
		}
		out = append(out,
			[2]string{"spend", granted.SpendLimit},
			[2]string{"period", strconv.FormatInt(granted.SpendPeriod, 10)})
		if revokedOld != "" {
			out = append(out, [2]string{"revoked", revokedOld})
		}
	}
	return append(out, [2]string{"state", r.State})
}

// sessionAddressOf is the address of a bech32 public key: what `session` and
// `revoked` carry, and what the chain files a session under.
func sessionAddressOf(gpub string) (string, error) {
	pub, err := crypto.PubKeyFromBech32(gpub)
	if err != nil {
		return "", Errf(CodeInvalidPubKey, "%q: %v", gpub, err)
	}
	return crypto.AddressToBech32(pub.Address()), nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/ -run 'SessionReply|SessionAddressOf' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
go vet ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_reply.go core/gnoconnect_reply_test.go
git commit -m "feat(sessions): the callback answer to a session request"
```

---

### Task 6: List the identity's sessions and plan the request

**Files:**
- Modify: `core/query.go`
- Create: `core/gnoconnect_plan.go`
- Test: `core/gnoconnect_plan_test.go`

**Interfaces:**
- Consumes: `SessionRequest`, hosts, codes (Tasks 1–2); `sessionReply`, `sessionAddressOf` (Task 5); `newTestService` (existing).
- Produces:

```go
// query.go
SessionStatus gains: PubKey string // bech32 gpub1…; empty when the chain stored none
func sessionStatusFrom(acc *gnoland.GnoSessionAccount) *SessionStatus
func decodeSessions(data []byte) ([]*SessionStatus, error)
func (s *Service) QuerySessions(masterAddress string) ([]*SessionStatus, error)

// gnoconnect_plan.go
type SessionPlan struct {
	Identity string; SessionAddress string
	Existing *SessionStatus; Reply [][2]string
	Old *SessionStatus; Target *SessionStatus
	Expired []*SessionStatus; MustRevoke int
}
func planSessionRequest(r *SessionRequest, identity string, sessions []*SessionStatus, now time.Time) (*SessionPlan, error)
func (s *Service) PlanSessionRequest(r *SessionRequest, identity string) (*SessionPlan, error)
```

- [ ] **Step 1: Write the failing test**

`core/gnoconnect_plan_test.go`:

```go
package core

import (
	"testing"
	"time"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

// A session list exactly as gnodev answered auth/accounts/{addr}/sessions.
const sessionsJSON = `[{"@type":"/gno.SessionAccount","BaseSessionAccount":{"BaseAccount":{"address":"g1sud8uacprr70ue2zj4g4pdxxefye5qajkdteey","coins":"","public_key":{"@type":"/tm.PubKeySecp256k1","value":"A7x4FCLXdnqP0yL+BkAtr0mYpVd9k8kv0O5Bzw08eRs3"},"account_number":"23","sequence":"5"},"master_address":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5","expires_at":"1793538659","spend_limit":"5000000ugnot","spend_period":"3600","spend_used":"3702814ugnot","spend_reset":"1790946659"},"allow_paths":["vm/exec:gno.land/r/demo/a"]}]`

func TestDecodeSessions(t *testing.T) {
	got, err := decodeSessions([]byte(sessionsJSON))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("sessions = %d", len(got))
	}
	st := got[0]
	if !st.Found || st.SessionAddress != "g1sud8uacprr70ue2zj4g4pdxxefye5qajkdteey" || st.MasterAddress != testIdentity ||
		st.ExpiresAt != 1793538659 || st.SpendLimit != "5000000ugnot" || st.SpendPeriod != 3600 || st.Sequence != 5 {
		t.Errorf("session = %+v", st)
	}
	pub, err := crypto.PubKeyFromBech32(st.PubKey)
	if err != nil || crypto.AddressToBech32(pub.Address()) != st.SessionAddress {
		t.Errorf("pubkey %q does not match the address (%v)", st.PubKey, err)
	}
	if none, err := decodeSessions([]byte("null")); err != nil || len(none) != 0 {
		t.Errorf("no sessions: %v, %v", none, err)
	}
}

var planNow = time.Unix(1790841600, 0)

type testSession struct {
	key crypto.PrivKey
	st  *SessionStatus
}

// session makes a session of testIdentity; expiresIn < 0 makes an expired one.
func session(expiresIn time.Duration) testSession {
	key := secp256k1.GenPrivKey()
	return testSession{key, &SessionStatus{
		Found: true, SessionAddress: crypto.AddressToBech32(key.PubKey().Address()), MasterAddress: testIdentity,
		PubKey: crypto.PubKeyToBech32(key.PubKey()), ExpiresAt: planNow.Add(expiresIn).Unix(),
		AllowPaths: []string{"bank/send"}, SpendLimit: "1ugnot",
	}}
}

func statuses(ss ...testSession) []*SessionStatus {
	out := make([]*SessionStatus, len(ss))
	for i, s := range ss {
		out[i] = s.st
	}
	return out
}

func connectFor(key crypto.PrivKey, old crypto.PrivKey) *SessionRequest {
	r := &SessionRequest{Host: HostConnect, PubKey: crypto.PubKeyToBech32(key.PubKey()), ChainID: "dev", State: "s"}
	if old != nil {
		r.Old, r.Signer = crypto.PubKeyToBech32(old.PubKey()), testIdentity
	}
	return r
}

func live(n int) []testSession {
	out := make([]testSession, n)
	for i := range out {
		out[i] = session(time.Hour)
	}
	return out
}

func TestPlanANewKey(t *testing.T) {
	key := secp256k1.GenPrivKey()
	p, err := planSessionRequest(connectFor(key, nil), testIdentity, statuses(live(3)...), planNow)
	if err != nil {
		t.Fatal(err)
	}
	if p.Existing != nil || p.Old != nil || p.MustRevoke != 0 || len(p.Expired) != 0 {
		t.Errorf("plan = %+v", p)
	}
	if p.SessionAddress != crypto.AddressToBech32(key.PubKey().Address()) || p.Identity != testIdentity {
		t.Errorf("addresses = %s, %s", p.SessionAddress, p.Identity)
	}
}

func TestPlanAKeyAlreadyGranted(t *testing.T) {
	s := session(time.Hour)
	p, err := planSessionRequest(connectFor(s.key, nil), testIdentity, statuses(s), planNow)
	if err != nil {
		t.Fatal(err)
	}
	if p.Existing != s.st || len(p.Reply) == 0 {
		t.Fatalf("an existing live session answers without a transaction: %+v", p)
	}
	if p.Reply[4] != [2]string{"session", s.st.SessionAddress} {
		t.Errorf("reply = %v", p.Reply)
	}
}

func TestPlanAnExpiredKey(t *testing.T) {
	s := session(-time.Hour)
	_, err := planSessionRequest(connectFor(s.key, nil), testIdentity, statuses(s), planNow)
	requireCode(t, err, CodeSessionExpired)
}

func TestPlanARenewal(t *testing.T) {
	old := session(time.Hour)
	p, err := planSessionRequest(connectFor(secp256k1.GenPrivKey(), old.key), testIdentity, statuses(old), planNow)
	if err != nil {
		t.Fatal(err)
	}
	if p.Old != old.st {
		t.Errorf("old = %+v", p.Old)
	}

	gone := secp256k1.GenPrivKey()
	p, err = planSessionRequest(connectFor(secp256k1.GenPrivKey(), gone), testIdentity, nil, planNow)
	if err != nil {
		t.Fatal(err)
	}
	if p.Old == nil || p.Old.Found || p.Old.SessionAddress != crypto.AddressToBech32(gone.PubKey().Address()) {
		t.Errorf("an old key no longer on chain is planned as not found: %+v", p.Old)
	}
}

func TestPlanHousekeeping(t *testing.T) {
	expired := []testSession{session(-time.Hour), session(-time.Minute)}
	full := append(live(14), expired...) // 16 sessions, 2 expired
	p, err := planSessionRequest(connectFor(secp256k1.GenPrivKey(), nil), testIdentity, statuses(full...), planNow)
	if err != nil {
		t.Fatal(err)
	}
	if p.MustRevoke != 1 || len(p.Expired) != 2 {
		t.Errorf("must revoke %d of %d expired", p.MustRevoke, len(p.Expired))
	}

	// The old key frees its own slot.
	sixteen := live(16)
	p, err = planSessionRequest(connectFor(secp256k1.GenPrivKey(), sixteen[0].key), testIdentity, statuses(sixteen...), planNow)
	if err != nil || p.MustRevoke != 0 {
		t.Errorf("renewal on a full list: %+v, %v", p, err)
	}
}

func TestPlanSessionLimit(t *testing.T) {
	_, err := planSessionRequest(connectFor(secp256k1.GenPrivKey(), nil), testIdentity, statuses(live(16)...), planNow)
	requireCode(t, err, CodeSessionLimit)

	// An expired session the chain lists without a public key cannot be revoked:
	// it is neither offered nor counted as room.
	noPub := session(-time.Hour)
	noPub.st.PubKey = ""
	list := statuses(append(live(15), noPub)...)
	p, err := planSessionRequest(connectFor(secp256k1.GenPrivKey(), nil), testIdentity, list, planNow)
	requireCode(t, err, CodeSessionLimit)
	if p != nil {
		t.Errorf("plan = %+v", p)
	}
}

func TestPlanADisconnect(t *testing.T) {
	expired := session(-time.Hour) // revoking an expired session is still a revocation
	r := &SessionRequest{Host: HostDisconnect, PubKey: expired.st.PubKey, ChainID: "dev", Signer: testIdentity, State: "s"}
	p, err := planSessionRequest(r, testIdentity, statuses(expired), planNow)
	if err != nil {
		t.Fatal(err)
	}
	if p.Target != expired.st || len(p.Expired) != 0 {
		t.Errorf("plan = %+v", p)
	}

	r.PubKey = newGPub()
	_, err = planSessionRequest(r, testIdentity, statuses(expired), planNow)
	requireCode(t, err, CodeSessionNotFound)
}

func TestPlanSessionRequestChecksPinAndNetwork(t *testing.T) {
	svc, _ := newTestService(t) // on DefaultNetworkConfig: chain topaz-1, no node needed for these checks
	r := connectFor(secp256k1.GenPrivKey(), nil)
	r.ChainID = DefaultChainID
	r.Signer = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
	_, err := svc.PlanSessionRequest(r, testIdentity)
	requireCode(t, err, CodeSignerUnavailable)

	r.Signer, r.ChainID = "", "dev"
	_, err = svc.PlanSessionRequest(r, testIdentity)
	requireCode(t, err, CodeInvalidSpec)
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run 'DecodeSessions|Plan'`
Expected: FAIL — `undefined: decodeSessions`, `undefined: planSessionRequest`, `unknown field PubKey`.

- [ ] **Step 3: Extend `query.go`**

In `core/query.go`:

1. Add the field to `SessionStatus`, after `MasterAddress`:

```go
	PubKey         string // bech32 gpub1…; empty when the chain stored none (needed to revoke it)
```

2. Add these functions after `QuerySession`:

```go
// sessionStatusFrom maps a stored session account.
func sessionStatusFrom(acc *gnoland.GnoSessionAccount) *SessionStatus {
	st := &SessionStatus{
		Found:          true,
		SessionAddress: crypto.AddressToBech32(acc.Address),
		MasterAddress:  crypto.AddressToBech32(acc.MasterAddress),
		ExpiresAt:      acc.ExpiresAt,
		AllowPaths:     acc.AllowPaths,
		SpendLimit:     acc.SpendLimit.String(),
		SpendPeriod:    acc.SpendPeriod,
		SpendUsed:      acc.SpendUsed.String(),
		SpendReset:     acc.SpendReset,
		AccountNumber:  acc.AccountNumber,
		Sequence:       acc.Sequence,
	}
	if acc.PubKey != nil {
		st.PubKey = crypto.PubKeyToBech32(acc.PubKey)
	}
	return st
}

// QuerySessions lists every session of masterAddress, expired ones included:
// the chain never deletes those, and they count towards the 16-session limit.
func (s *Service) QuerySessions(masterAddress string) ([]*SessionStatus, error) {
	master, err := crypto.AddressFromBech32(masterAddress)
	if err != nil {
		return nil, Errf(CodeInvalidAddress, "master address %q: %v", masterAddress, err)
	}
	data, err := s.abciQuery(fmt.Sprintf("auth/accounts/%s/sessions", crypto.AddressToBech32(master)), nil)
	if err != nil {
		return nil, err
	}
	return decodeSessions(data)
}

func decodeSessions(data []byte) ([]*SessionStatus, error) {
	if len(data) == 0 || string(data) == "null" {
		return nil, nil
	}
	var accs []std.Account
	if err := amino.UnmarshalJSON(data, &accs); err != nil {
		return nil, Errf(CodeInternal, "decode sessions: %v", err)
	}
	out := make([]*SessionStatus, 0, len(accs))
	for _, a := range accs {
		gsa, ok := a.(*gnoland.GnoSessionAccount)
		if !ok {
			return nil, Errf(CodeInternal, "unexpected session account type %T", a)
		}
		out = append(out, sessionStatusFrom(gsa))
	}
	return out, nil
}
```

3. In `QuerySession`, replace the final `return &SessionStatus{ … }, nil` (after the `amino.UnmarshalJSON` into `acc`) with:

```go
	return sessionStatusFrom(&acc), nil
```

- [ ] **Step 4: Write the planner**

`core/gnoconnect_plan.go`:

```go
package core

import (
	"time"

	"github.com/gnolang/gno/tm2/pkg/std"
)

// SessionPlan is what a session request does on chain, decided before the user
// is asked anything (gnoconnect-session.md, `connect` with a key steps 2–3,
// `disconnect`, Wallet housekeeping).
type SessionPlan struct {
	Identity       string // the master address that grants or revokes
	SessionAddress string // the address of the request's key

	// connect: the key is already a live session of Identity. Nothing to sign:
	// Reply answers with the grant as the chain stores it.
	Existing *SessionStatus
	Reply    [][2]string

	// connect with Old: the old session, Found=false when it is no longer on
	// chain (nothing to revoke, which the review says).
	Old *SessionStatus

	// disconnect: the session to revoke.
	Target *SessionStatus

	// Expired sessions of Identity, other than the request's keys, that the
	// transaction may revoke too; MustRevoke of them must go for a new session
	// to fit under std.MaxSessionsPerAccount.
	Expired    []*SessionStatus
	MustRevoke int
}

// planSessionRequest decides from the identity's session list.
func planSessionRequest(r *SessionRequest, identity string, sessions []*SessionStatus, now time.Time) (*SessionPlan, error) {
	sessionAddr, err := sessionAddressOf(r.PubKey)
	if err != nil {
		return nil, err
	}
	oldAddr := ""
	if r.Old != "" {
		if oldAddr, err = sessionAddressOf(r.Old); err != nil {
			return nil, err
		}
	}
	expired := func(st *SessionStatus) bool { return st.ExpiresAt != 0 && st.ExpiresAt <= now.Unix() }

	p := &SessionPlan{Identity: identity, SessionAddress: sessionAddr}
	var mine, old *SessionStatus
	for _, st := range sessions {
		switch {
		case st.SessionAddress == sessionAddr:
			mine = st
		case oldAddr != "" && st.SessionAddress == oldAddr:
			old = st
		case expired(st) && st.PubKey != "": // revoking needs the key
			p.Expired = append(p.Expired, st)
		}
	}

	if r.Host == HostDisconnect {
		if mine == nil {
			return nil, Errf(CodeSessionNotFound, "%s is not a session of %s", sessionAddr, identity)
		}
		p.Target = mine
		return p, nil
	}

	if mine != nil {
		if expired(mine) {
			return nil, Errf(CodeSessionExpired, "%s expired at %d", sessionAddr, mine.ExpiresAt)
		}
		p.Existing = mine
		p.Reply = sessionReply(r, identity, sessionAddr, mine, "")
		return p, nil
	}
	if r.Old != "" {
		p.Old = old
		if old == nil {
			p.Old = &SessionStatus{Found: false, SessionAddress: oldAddr, MasterAddress: identity}
		}
	}
	after := len(sessions) + 1
	if old != nil {
		after-- // revoked in the same transaction
	}
	if over := after - int(std.MaxSessionsPerAccount); over > 0 {
		if over > len(p.Expired) {
			return nil, Errf(CodeSessionLimit, "%s has %d sessions and only %d expired ones to revoke",
				identity, len(sessions), len(p.Expired))
		}
		p.MustRevoke = over
	}
	return p, nil
}

// PlanSessionRequest reads identity's sessions and plans the request. identity
// is the account the user picked, which must match a pinned signer, and the
// wallet must be on the request's chain.
func (s *Service) PlanSessionRequest(r *SessionRequest, identity string) (*SessionPlan, error) {
	if r.Signer != "" && r.Signer != identity {
		return nil, Errf(CodeSignerUnavailable, "the request is pinned to %s, not %s", r.Signer, identity)
	}
	if cfg := s.Network(); r.ChainID != cfg.ChainID {
		return nil, Errf(CodeInvalidSpec, "the request is for chain %q, the wallet is on %q", r.ChainID, cfg.ChainID)
	}
	sessions, err := s.QuerySessions(identity)
	if err != nil {
		return nil, err
	}
	return planSessionRequest(r, identity, sessions, s.now())
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./core/... -v -run 'DecodeSessions|Plan'` then `go test ./core/... ./mobile/...`
Expected: PASS, and the existing tests (which use `QuerySession`'s output) still pass.

- [ ] **Step 6: Commit**

```bash
go vet ./...
git add core/query.go core/gnoconnect_plan.go core/gnoconnect_plan_test.go
git commit -m "feat(sessions): read the identity's sessions and plan a request before review"
```

---

### Task 7: Compose the transaction and the desktop command

**Files:**
- Create: `core/gnoconnect_tx.go`
- Test: `core/gnoconnect_tx_test.go`

**Interfaces:**
- Consumes: `SessionRequest` (Task 2), `Grant`, `CheckNarrowing` (Task 4), `SessionPlan`, `planSessionRequest`, `Service.PlanSessionRequest` (Task 6), test helpers `session`, `statuses`, `connectFor`, `live`, `planNow` (Task 6); `shellQuote`, `parseCoinsOrEmpty`, `Service.MinGasFee`, `Service.QueryAccount` (existing).
- Produces:

```go
const SessionTxFile = "gnoconnect-session.json"
type SessionTx struct {
	Command string; Document string; SignsDocument bool; Revokes []string
	GasWanted int64; GasFee string; AccountNumber uint64; Sequence uint64
}
func sessionGasWanted(msgs int) int64
type sessionTxInput struct { Request *SessionRequest; Plan *SessionPlan; Grant Grant; RevokeExpired []string
	MasterKeyName, Remote, ChainID, GasFee string; AccountNumber, Sequence uint64; Now time.Time }
func composeSessionTx(in sessionTxInput) (*SessionTx, error)
func (s *Service) BuildSessionTx(r *SessionRequest, identity string, grant Grant, revokeExpired []string, masterKeyName string) (*SessionTx, error)
```

- [ ] **Step 1: Write the failing test**

`core/gnoconnect_tx_test.go`:

```go
package core

import (
	"strings"
	"testing"
	"time"

	"github.com/gnolang/gno/tm2/pkg/amino"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/sdk/auth"
	"github.com/gnolang/gno/tm2/pkg/std"
)

func txInput(t *testing.T, r *SessionRequest, sessions []*SessionStatus) sessionTxInput {
	t.Helper()
	p, err := planSessionRequest(r, testIdentity, sessions, planNow)
	if err != nil {
		t.Fatal(err)
	}
	return sessionTxInput{
		Request: r, Plan: p, Grant: r.Grant(), MasterKeyName: "test1",
		Remote: "http://127.0.0.1:26657", ChainID: "dev", GasFee: "2000ugnot",
		AccountNumber: 7, Sequence: 42, Now: planNow,
	}
}

// grantRequest is a connect for key asking for the standard test grant.
func grantRequest(key, old crypto.PrivKey) *SessionRequest {
	r := connectFor(key, old)
	r.Allow = []string{"vm/exec:gno.land/r/demo/a", "bank/send"}
	r.Spend, r.Period, r.Expires = "5000000ugnot", 3600, 2592000
	return r
}

func decodeDoc(t *testing.T, doc string) std.Tx {
	t.Helper()
	var tx std.Tx
	if err := amino.UnmarshalJSON([]byte(doc), &tx); err != nil {
		t.Fatal(err)
	}
	return tx
}

func TestComposeAGrant(t *testing.T) {
	key := secp256k1.GenPrivKey()
	r := grantRequest(key, nil)
	tx, err := composeSessionTx(txInput(t, r, nil))
	if err != nil {
		t.Fatal(err)
	}
	want := "gnokey maketx session create -pubkey " + r.PubKey + " -expires-at 2592000s" +
		" -allow-paths vm/exec:gno.land/r/demo/a -allow-paths bank/send -spend-limit 5000000ugnot -spend-period 3600" +
		" -gas-fee 2000ugnot -gas-wanted 2000000 -broadcast -chainid dev -remote http://127.0.0.1:26657 test1"
	if tx.Command != want {
		t.Errorf("command:\n got %s\nwant %s", tx.Command, want)
	}
	if tx.SignsDocument || len(tx.Revokes) != 0 || tx.GasWanted != 2_000_000 {
		t.Errorf("tx = %+v", tx)
	}
	doc := decodeDoc(t, tx.Document)
	create, ok := doc.Msgs[0].(auth.MsgCreateSession)
	if len(doc.Msgs) != 1 || !ok {
		t.Fatalf("msgs = %#v", doc.Msgs)
	}
	if create.ExpiresAt != planNow.Unix()+2592000 || crypto.AddressToBech32(create.Creator) != testIdentity ||
		create.SpendLimit.String() != "5000000ugnot" || create.SpendPeriod != 3600 || len(create.AllowPaths) != 2 {
		t.Errorf("create = %+v", create)
	}
}

func TestComposeANarrowedGrant(t *testing.T) {
	r := grantRequest(secp256k1.GenPrivKey(), nil)
	in := txInput(t, r, nil)
	in.Grant = Grant{Allow: []string{"bank/send"}, Spend: "", Period: 0, Expires: 86400}
	tx, err := composeSessionTx(in)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(tx.Command, "-spend-limit") || strings.Contains(tx.Command, "-spend-period") ||
		!strings.Contains(tx.Command, "-expires-at 86400s -allow-paths bank/send -gas-fee") {
		t.Errorf("command = %s", tx.Command)
	}

	in.Grant = Grant{Allow: []string{"vm/run"}, Spend: "5000000ugnot", Period: 3600, Expires: 2592000}
	_, err = composeSessionTx(in)
	requireCode(t, err, CodeInvalidSpec)
}

func TestComposeARenewal(t *testing.T) {
	old := session(time.Hour)
	r := grantRequest(secp256k1.GenPrivKey(), old.key)
	tx, err := composeSessionTx(txInput(t, r, statuses(old)))
	if err != nil {
		t.Fatal(err)
	}
	if !tx.SignsDocument || tx.GasWanted != 3_000_000 || len(tx.Revokes) != 1 || tx.Revokes[0] != old.st.SessionAddress {
		t.Errorf("tx = %+v", tx)
	}
	doc := decodeDoc(t, tx.Document)
	if _, ok := doc.Msgs[0].(auth.MsgRevokeSession); !ok {
		t.Errorf("the old session is revoked first: %#v", doc.Msgs)
	}
	if _, ok := doc.Msgs[1].(auth.MsgCreateSession); !ok {
		t.Errorf("then the new one is created: %#v", doc.Msgs)
	}
	for _, part := range []string{
		"printf '%s\\n' '{",
		"' > gnoconnect-session.json && ",
		"gnokey sign -tx-path gnoconnect-session.json -chainid dev -account-number 7 -account-sequence 42 test1 && ",
		"gnokey broadcast -dry-run -remote http://127.0.0.1:26657 gnoconnect-session.json && ",
		"gnokey broadcast -remote http://127.0.0.1:26657 gnoconnect-session.json",
	} {
		if !strings.Contains(tx.Command, part) {
			t.Errorf("command lacks %q:\n%s", part, tx.Command)
		}
	}

	// An old key no longer on chain: nothing to revoke, a single command.
	gone := grantRequest(secp256k1.GenPrivKey(), secp256k1.GenPrivKey())
	tx, err = composeSessionTx(txInput(t, gone, nil))
	if err != nil || tx.SignsDocument || len(tx.Revokes) != 0 {
		t.Errorf("tx = %+v, %v", tx, err)
	}
}

func TestComposeHousekeeping(t *testing.T) {
	expired := []testSession{session(-time.Hour), session(-time.Minute)}
	full := statuses(append(live(14), expired...)...)
	r := grantRequest(secp256k1.GenPrivKey(), nil)

	in := txInput(t, r, full)
	in.RevokeExpired = []string{expired[1].st.PubKey}
	tx, err := composeSessionTx(in)
	if err != nil {
		t.Fatal(err)
	}
	if !tx.SignsDocument || len(tx.Revokes) != 1 || tx.Revokes[0] != expired[1].st.SessionAddress {
		t.Errorf("tx = %+v", tx)
	}

	in.RevokeExpired = nil // the list is full: one must go
	_, err = composeSessionTx(in)
	requireCode(t, err, CodeSessionLimit)

	in.RevokeExpired = []string{full[0].PubKey} // a live session is never revoked as housekeeping
	_, err = composeSessionTx(in)
	requireCode(t, err, CodeInvalidSpec)

	in.RevokeExpired = []string{expired[0].st.PubKey, expired[0].st.PubKey}
	_, err = composeSessionTx(in)
	requireCode(t, err, CodeInvalidSpec)
}

func TestComposeADisconnect(t *testing.T) {
	target := session(time.Hour)
	r := &SessionRequest{Host: HostDisconnect, PubKey: target.st.PubKey, ChainID: "dev", Signer: testIdentity, State: "s"}
	tx, err := composeSessionTx(txInput(t, r, statuses(target)))
	if err != nil {
		t.Fatal(err)
	}
	want := "gnokey maketx session revoke -pubkey " + r.PubKey +
		" -gas-fee 2000ugnot -gas-wanted 2000000 -broadcast -chainid dev -remote http://127.0.0.1:26657 test1"
	if tx.Command != want || len(tx.Revokes) != 1 || tx.Revokes[0] != target.st.SessionAddress {
		t.Errorf("command:\n got %s\nwant %s (revokes %v)", tx.Command, want, tx.Revokes)
	}

	expired := session(-time.Hour)
	in := txInput(t, r, statuses(target, expired))
	in.RevokeExpired = []string{expired.st.PubKey}
	tx, err = composeSessionTx(in)
	if err != nil || !tx.SignsDocument || len(tx.Revokes) != 2 || tx.Revokes[0] != target.st.SessionAddress {
		t.Errorf("tx = %+v, %v", tx, err)
	}
}

func TestComposeRefusesAnAlreadyGrantedKey(t *testing.T) {
	s := session(time.Hour)
	r := grantRequest(s.key, nil)
	_, err := composeSessionTx(txInput(t, r, statuses(s)))
	requireCode(t, err, CodeInvalidSpec)
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run Compose`
Expected: FAIL — `undefined: sessionTxInput`, `undefined: composeSessionTx`.

- [ ] **Step 3: Write the composer**

`core/gnoconnect_tx.go`:

```go
package core

import (
	"strconv"
	"strings"
	"time"

	"github.com/gnolang/gno/tm2/pkg/amino"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/sdk/auth"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// SessionTxFile is where the desktop command writes a multi-message document
// before signing it.
const SessionTxFile = "gnoconnect-session.json"

// SessionTx is a session request's transaction, as what the user runs where the
// identity's key lives (gnoconnect-session.md, "Obtaining the identity's
// signature"). A single message is one `gnokey maketx session …` command;
// several are a document that `gnokey sign` signs at a fixed account number and
// sequence, dry-run before the real broadcast.
type SessionTx struct {
	Command       string   // shell command to copy or scan
	Document      string   // the unsigned transaction, amino JSON (always set)
	SignsDocument bool     // Command signs Document: it goes stale when the identity's sequence moves
	Revokes       []string // session addresses revoked, in message order
	GasWanted     int64
	GasFee        string
	AccountNumber uint64 // the identity's, as the document is signed for
	Sequence      uint64
}

// sessionGasWanted gives every session message 1M gas (a create used 1.37M
// with its signature on gnodev), plus 1M for the transaction itself.
func sessionGasWanted(msgs int) int64 { return 1_000_000 + 1_000_000*int64(msgs) }

type sessionTxInput struct {
	Request       *SessionRequest
	Plan          *SessionPlan
	Grant         Grant    // connect: what the user approved
	RevokeExpired []string // pubkeys the user chose among Plan.Expired
	MasterKeyName string   // the identity's key name in the desktop gnokey
	Remote        string
	ChainID       string
	GasFee        string // for sessionGasWanted(messages)
	AccountNumber uint64
	Sequence      uint64
	Now           time.Time
}

func composeSessionTx(in sessionTxInput) (*SessionTx, error) {
	r, p := in.Request, in.Plan
	if p.Existing != nil {
		return nil, Errf(CodeInvalidSpec, "%s is already a session of %s: nothing to sign", p.SessionAddress, p.Identity)
	}
	if in.MasterKeyName == "" {
		return nil, Errf(CodeInvalidSpec, "master key name must not be empty")
	}
	feeCoin, err := std.ParseCoin(in.GasFee)
	if err != nil {
		return nil, Errf(CodeInvalidCoins, "gas fee %q: %v", in.GasFee, err)
	}
	identity, err := crypto.AddressFromBech32(p.Identity)
	if err != nil {
		return nil, Errf(CodeInvalidAddress, "identity %q: %v", p.Identity, err)
	}

	// Housekeeping: only sessions the plan found expired — a live session is
	// never revoked behind the user's back — and enough of them to make room.
	offered := map[string]bool{}
	for _, st := range p.Expired {
		offered[st.PubKey] = true
	}
	chosen := map[string]bool{}
	for _, k := range in.RevokeExpired {
		if !offered[k] {
			return nil, Errf(CodeInvalidSpec, "%s is not an expired session of %s", k, p.Identity)
		}
		if chosen[k] {
			return nil, Errf(CodeInvalidSpec, "%s is listed twice", k)
		}
		chosen[k] = true
	}
	if len(in.RevokeExpired) < p.MustRevoke {
		return nil, Errf(CodeSessionLimit, "%d expired sessions must be revoked to make room, %d chosen",
			p.MustRevoke, len(in.RevokeExpired))
	}

	var msgs []std.Msg
	var revokes []string
	revoke := func(gpub string) error {
		pub, err := crypto.PubKeyFromBech32(gpub)
		if err != nil {
			return Errf(CodeInvalidPubKey, "%q: %v", gpub, err)
		}
		msgs = append(msgs, auth.MsgRevokeSession{Creator: identity, SessionKey: pub})
		revokes = append(revokes, crypto.AddressToBech32(pub.Address()))
		return nil
	}
	pub, err := crypto.PubKeyFromBech32(r.PubKey)
	if err != nil {
		return nil, Errf(CodeInvalidPubKey, "%q: %v", r.PubKey, err)
	}

	switch r.Host {
	case HostConnect:
		if err := CheckNarrowing(r.Grant(), in.Grant); err != nil {
			return nil, err
		}
		if p.Old != nil && p.Old.Found {
			if err := revoke(r.Old); err != nil {
				return nil, err
			}
		}
		for _, k := range in.RevokeExpired {
			if err := revoke(k); err != nil {
				return nil, err
			}
		}
		spend, err := parseCoinsOrEmpty(in.Grant.Spend, "spend limit")
		if err != nil {
			return nil, err
		}
		msgs = append(msgs, auth.MsgCreateSession{
			Creator:     identity,
			SessionKey:  pub,
			ExpiresAt:   in.Now.Unix() + in.Grant.Expires,
			AllowPaths:  in.Grant.Allow,
			SpendLimit:  spend,
			SpendPeriod: in.Grant.Period,
		})
	case HostDisconnect:
		if err := revoke(r.PubKey); err != nil {
			return nil, err
		}
		for _, k := range in.RevokeExpired {
			if err := revoke(k); err != nil {
				return nil, err
			}
		}
	default:
		return nil, Errf(CodeInvalidRequest, "%q is not a session host", r.Host)
	}

	gasWanted := sessionGasWanted(len(msgs))
	doc, err := amino.MarshalJSON(std.Tx{Msgs: msgs, Fee: std.NewFee(gasWanted, feeCoin)})
	if err != nil {
		return nil, Errf(CodeInternal, "encode the transaction: %v", err)
	}
	tx := &SessionTx{
		Document: string(doc), Revokes: revokes, GasWanted: gasWanted, GasFee: in.GasFee,
		AccountNumber: in.AccountNumber, Sequence: in.Sequence,
	}
	if len(msgs) == 1 {
		tx.Command = singleSessionCommand(in, gasWanted)
		return tx, nil
	}
	tx.SignsDocument = true
	tx.Command = documentCommand(in, tx.Document)
	return tx, nil
}

// singleSessionCommand is `gnokey maketx session create|revoke`, which signs,
// simulates and broadcasts in one go.
func singleSessionCommand(in sessionTxInput, gasWanted int64) string {
	r := in.Request
	var args []string
	if r.Host == HostConnect {
		args = []string{"gnokey", "maketx", "session", "create", "-pubkey", r.PubKey,
			// A duration: gnokey counts it from when the user runs the command,
			// the closest a desktop handoff gets to "seconds from inclusion".
			"-expires-at", strconv.FormatInt(in.Grant.Expires, 10) + "s"}
		for _, a := range in.Grant.Allow {
			args = append(args, "-allow-paths", a)
		}
		if in.Grant.Spend != "" {
			args = append(args, "-spend-limit", in.Grant.Spend)
		}
		if in.Grant.Period > 0 {
			args = append(args, "-spend-period", strconv.FormatInt(in.Grant.Period, 10))
		}
	} else {
		args = []string{"gnokey", "maketx", "session", "revoke", "-pubkey", r.PubKey}
	}
	args = append(args, "-gas-fee", in.GasFee, "-gas-wanted", strconv.FormatInt(gasWanted, 10),
		"-broadcast", "-chainid", in.ChainID, "-remote", in.Remote, in.MasterKeyName)
	return shellJoin(args)
}

// documentCommand writes the document, signs it for the identity's account
// number and sequence, dry-runs it — so a transaction the chain would reject
// costs no fee — and broadcasts it.
func documentCommand(in sessionTxInput, doc string) string {
	write := "printf '%s\\n' " + shellQuote(doc) + " > " + SessionTxFile
	sign := shellJoin([]string{"gnokey", "sign", "-tx-path", SessionTxFile, "-chainid", in.ChainID,
		"-account-number", strconv.FormatUint(in.AccountNumber, 10),
		"-account-sequence", strconv.FormatUint(in.Sequence, 10), in.MasterKeyName})
	dryRun := shellJoin([]string{"gnokey", "broadcast", "-dry-run", "-remote", in.Remote, SessionTxFile})
	broadcast := shellJoin([]string{"gnokey", "broadcast", "-remote", in.Remote, SessionTxFile})
	return strings.Join([]string{write, sign, dryRun, broadcast}, " && ")
}

func shellJoin(args []string) string {
	quoted := make([]string, len(args))
	for i, a := range args {
		quoted[i] = shellQuote(a)
	}
	return strings.Join(quoted, " ")
}

// BuildSessionTx composes the transaction for the grant the user approved and
// the expired sessions they chose to revoke, priced at the chain's gas price.
// It plans again first, so a session list that changed since the review is
// never signed blind.
func (s *Service) BuildSessionTx(r *SessionRequest, identity string, grant Grant, revokeExpired []string, masterKeyName string) (*SessionTx, error) {
	plan, err := s.PlanSessionRequest(r, identity)
	if err != nil {
		return nil, err
	}
	acc, err := s.QueryAccount(identity)
	if err != nil {
		return nil, err
	}
	if !acc.Exists {
		return nil, Errf(CodeInvalidSpec, "%s has no account on this chain yet: send it some coins first", identity)
	}
	msgs := 1 + len(revokeExpired)
	if r.Host == HostConnect && plan.Old != nil && plan.Old.Found {
		msgs++
	}
	fee, err := s.MinGasFee(sessionGasWanted(msgs))
	if err != nil {
		return nil, err
	}
	cfg := s.Network()
	return composeSessionTx(sessionTxInput{
		Request: r, Plan: plan, Grant: grant, RevokeExpired: revokeExpired, MasterKeyName: masterKeyName,
		Remote: cfg.Remote, ChainID: cfg.ChainID, GasFee: fee,
		AccountNumber: acc.AccountNumber, Sequence: acc.Sequence, Now: s.now(),
	})
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/ -run Compose -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
go vet ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_tx.go core/gnoconnect_tx_test.go
git commit -m "feat(sessions): compose a session transaction as a desktop gnokey command"
```

---

### Task 8: Watch the chain for the outcome

**Files:**
- Create: `core/gnoconnect_outcome.go`
- Test: `core/gnoconnect_outcome_test.go`

**Interfaces:**
- Consumes: `SessionRequest` (Task 2), `sessionReply`, `sessionAddressOf` (Task 5), `SessionTx` (Task 7); `QuerySession`, `QueryAccount` (existing).
- Produces: `type SessionOutcome struct { Done bool; Stale bool; Reply [][2]string }`; `func sessionDone(r *SessionRequest, st *SessionStatus) bool`; `func outcomeReply(r *SessionRequest, identity, sessionAddress string, tx *SessionTx, st *SessionStatus) [][2]string`; `func (s *Service) PollSessionOutcome(r *SessionRequest, identity string, tx *SessionTx) (*SessionOutcome, error)`.

- [ ] **Step 1: Write the failing test**

`core/gnoconnect_outcome_test.go`:

```go
package core

import (
	"testing"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

func TestSessionDone(t *testing.T) {
	connect, disconnect := &SessionRequest{Host: HostConnect}, &SessionRequest{Host: HostDisconnect}
	found, gone := &SessionStatus{Found: true}, &SessionStatus{Found: false}
	if !sessionDone(connect, found) || sessionDone(connect, gone) {
		t.Error("a connect is done when the session appears")
	}
	if !sessionDone(disconnect, gone) || sessionDone(disconnect, found) {
		t.Error("a disconnect is done when the session is gone")
	}
}

func TestOutcomeReplyNamesTheOldKeyOnlyWhenRevoked(t *testing.T) {
	key, old := secp256k1.GenPrivKey(), secp256k1.GenPrivKey()
	r := grantRequest(key, old)
	oldAddr := crypto.AddressToBech32(old.PubKey().Address())
	st := &SessionStatus{Found: true, ExpiresAt: 1, AllowPaths: []string{"bank/send"}}

	has := func(reply [][2]string) bool {
		for _, kv := range reply {
			if kv == [2]string{"revoked", oldAddr} {
				return true
			}
		}
		return false
	}
	if !has(outcomeReply(r, testIdentity, "g1s", &SessionTx{Revokes: []string{oldAddr}}, st)) {
		t.Error("revoked is missing although the transaction revoked the old key")
	}
	if has(outcomeReply(r, testIdentity, "g1s", &SessionTx{}, st)) {
		t.Error("revoked is present although the old key was no longer on chain")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run 'SessionDone|OutcomeReply'`
Expected: FAIL — `undefined: sessionDone`.

- [ ] **Step 3: Write the outcome code**

`core/gnoconnect_outcome.go`:

```go
package core

import "slices"

// SessionOutcome is one look at the chain while the identity's signer works.
type SessionOutcome struct {
	Done  bool        // the chain shows the result; Reply answers the producer
	Stale bool        // the document's sequence is used up without the result: build the transaction again
	Reply [][2]string // set when Done
}

// sessionDone reports whether the chain shows the request's result: the
// session present after a connect, gone after a disconnect.
func sessionDone(r *SessionRequest, st *SessionStatus) bool {
	if r.Host == HostDisconnect {
		return !st.Found
	}
	return st.Found
}

// outcomeReply answers a request whose result is on chain. `revoked` names the
// old key only when this transaction revoked it.
func outcomeReply(r *SessionRequest, identity, sessionAddress string, tx *SessionTx, st *SessionStatus) [][2]string {
	revokedOld := ""
	if r.Old != "" {
		if old, err := sessionAddressOf(r.Old); err == nil && slices.Contains(tx.Revokes, old) {
			revokedOld = old
		}
	}
	return sessionReply(r, identity, sessionAddress, st, revokedOld)
}

// PollSessionOutcome looks once for the result of tx. A document signed for a
// sequence the identity has since used — it sent another transaction, or this
// one failed — can never be included: Stale tells the caller to rebuild it.
func (s *Service) PollSessionOutcome(r *SessionRequest, identity string, tx *SessionTx) (*SessionOutcome, error) {
	addr, err := sessionAddressOf(r.PubKey)
	if err != nil {
		return nil, err
	}
	st, err := s.QuerySession(identity, addr)
	if err != nil {
		return nil, err
	}
	if sessionDone(r, st) {
		return &SessionOutcome{Done: true, Reply: outcomeReply(r, identity, addr, tx, st)}, nil
	}
	if !tx.SignsDocument {
		return &SessionOutcome{}, nil
	}
	acc, err := s.QueryAccount(identity)
	if err != nil {
		return nil, err
	}
	return &SessionOutcome{Stale: acc.Sequence != tx.Sequence}, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/ -run 'SessionDone|OutcomeReply' -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
go vet ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_outcome.go core/gnoconnect_outcome_test.go
git commit -m "feat(sessions): watch the chain for a session request's outcome"
```

---

### Task 9: The gomobile bridge

**Files:**
- Create: `mobile/sessions.go`
- Test: `mobile/sessions_test.go`

**Interfaces:**
- Consumes: `core.Service.AcceptSessionRequest`, `core.ParseSessionRequest`, `core.Service.PlanSessionRequest`, `core.Service.BuildSessionTx`, `core.Service.PollSessionOutcome`, `core.SessionPlan`, `core.SessionTx`, `core.SessionOutcome`, `core.Grant`, `core.SessionStatus` (Tasks 2–8); `decodeStringArray`, `encodeStringArray`, `invalidSpecErr`, `internalErr` (existing, `mobile/`).
- Produces (gomobile surface, consumed by P2-M2/M3):

```go
type SessionRequest struct { URL, Host, PubKey, Old, AllowJSON, Spend string; Period, Expires int64
	ChainID, RPC, Signer, Callback, State string }
type SessionPlan struct { Identity, SessionAddress string; AlreadyGranted bool; ReplyJSON string
	HasOld, OldOnChain bool; OldJSON, TargetJSON, ExpiredJSON string; MustRevoke int64 }
type SessionGrant struct { AllowJSON, Spend string; Period, Expires int64 }
type SessionTx struct { Command, Document string; SignsDocument bool; RevokesJSON string
	GasWanted int64; GasFee string; AccountNumber, Sequence int64 }
type SessionOutcome struct { Done, Stale bool; ReplyJSON string }
func (b *Bridge) AcceptSessionRequest(url string) (*SessionRequest, error)
func (b *Bridge) PlanSessionRequest(req *SessionRequest, identity string) (*SessionPlan, error)
func (b *Bridge) BuildSessionTx(req *SessionRequest, identity string, grant *SessionGrant, revokeExpiredJSON, masterKeyName string) (*SessionTx, error)
func (b *Bridge) PollSessionOutcome(req *SessionRequest, identity string, tx *SessionTx) (*SessionOutcome, error)
```

JSON shapes: `ReplyJSON` is an array of `[key, value]` string pairs in callback order; `OldJSON`/`TargetJSON` are one session object, `ExpiredJSON` an array of them: `{"address","pubKey","expiresAt","allowPaths","spendLimit","spendPeriod"}`.

- [ ] **Step 1: Write the failing test**

`mobile/sessions_test.go`:

```go
package mobile

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gnokey-mobile2/core"
)

// signedConnect is a connect with a key, issued now, signed by key.
func signedConnect(t *testing.T, key crypto.PrivKey) string {
	t.Helper()
	kv := []string{
		"pubkey", crypto.PubKeyToBech32(key.PubKey()),
		"allow", "vm/exec:gno.land/r/demo/a", "allow", "bank/send",
		"spend", "5000000ugnot", "period", "3600", "expires", "2592000",
		"chainid", core.DefaultChainID, "callback", "bubblerumble://session-callback",
		"state", "s1", "iat", strconv.FormatInt(time.Now().Unix(), 10),
	}
	q := make([]string, 0, len(kv)/2)
	for i := 0; i < len(kv); i += 2 {
		q = append(q, kv[i]+"="+strings.ReplaceAll(url.QueryEscape(kv[i+1]), "+", "%20"))
	}
	link := "land.gno.gnokey://connect?" + strings.Join(q, "&")
	payload, err := core.CanonicalPayload(link)
	if err != nil {
		t.Fatal(err)
	}
	sig, err := key.Sign([]byte(payload))
	if err != nil {
		t.Fatal(err)
	}
	return link + "&sig=" + base64.RawURLEncoding.EncodeToString(sig)
}

func newTestBridge(t *testing.T) *Bridge {
	t.Helper()
	b, err := NewBridge(DefaultNetworkConfig(), t.TempDir(), "test-password")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAcceptSessionRequestCrossesTheBridge(t *testing.T) {
	b := newTestBridge(t)
	key := secp256k1.GenPrivKey()
	link := signedConnect(t, key)
	req, err := b.AcceptSessionRequest(link)
	if err != nil {
		t.Fatal(err)
	}
	if req.URL != link || req.Host != "connect" || req.PubKey != crypto.PubKeyToBech32(key.PubKey()) ||
		req.AllowJSON != `["vm/exec:gno.land/r/demo/a","bank/send"]` || req.Spend != "5000000ugnot" ||
		req.Period != 3600 || req.Expires != 2592000 || req.State != "s1" {
		t.Errorf("request = %+v", req)
	}
	_, err = b.AcceptSessionRequest(link)
	if err == nil || !strings.HasPrefix(err.Error(), "[replayed]") {
		t.Errorf("a second delivery must fail as replayed, got %v", err)
	}
}

func TestSessionPlanFrom(t *testing.T) {
	plan := &core.SessionPlan{
		Identity: "g1id", SessionAddress: "g1s",
		Old:      &core.SessionStatus{Found: true, SessionAddress: "g1old", PubKey: "gpub1old", ExpiresAt: 9, AllowPaths: []string{"bank/send"}, SpendLimit: "1ugnot", SpendPeriod: 60},
		Expired:  []*core.SessionStatus{{Found: true, SessionAddress: "g1x", PubKey: "gpub1x", ExpiresAt: 1}},
		MustRevoke: 1,
	}
	got, err := sessionPlanFrom(plan)
	if err != nil {
		t.Fatal(err)
	}
	if got.Identity != "g1id" || got.SessionAddress != "g1s" || got.AlreadyGranted || !got.HasOld || !got.OldOnChain || got.MustRevoke != 1 {
		t.Errorf("plan = %+v", got)
	}
	var old sessionJSON
	if err := json.Unmarshal([]byte(got.OldJSON), &old); err != nil || old.Address != "g1old" || old.SpendPeriod != 60 || old.AllowPaths[0] != "bank/send" {
		t.Errorf("old = %s (%v)", got.OldJSON, err)
	}
	var expired []sessionJSON
	if err := json.Unmarshal([]byte(got.ExpiredJSON), &expired); err != nil || len(expired) != 1 || expired[0].PubKey != "gpub1x" {
		t.Errorf("expired = %s (%v)", got.ExpiredJSON, err)
	}

	granted, err := sessionPlanFrom(&core.SessionPlan{Existing: &core.SessionStatus{Found: true}, Reply: [][2]string{{"status", "success"}, {"state", "s"}}})
	if err != nil || !granted.AlreadyGranted || granted.ReplyJSON != `[["status","success"],["state","s"]]` {
		t.Errorf("already granted = %+v, %v", granted, err)
	}
}

func TestSessionTxRoundTrip(t *testing.T) {
	in := &core.SessionTx{Command: "c", Document: "{}", SignsDocument: true, Revokes: []string{"g1a"},
		GasWanted: 3_000_000, GasFee: "3000ugnot", AccountNumber: 7, Sequence: 42}
	out, err := coreSessionTx(sessionTxFrom(in))
	if err != nil {
		t.Fatal(err)
	}
	if out.Command != "c" || out.Document != "{}" || !out.SignsDocument || len(out.Revokes) != 1 ||
		out.GasWanted != 3_000_000 || out.GasFee != "3000ugnot" || out.AccountNumber != 7 || out.Sequence != 42 {
		t.Errorf("round trip = %+v", out)
	}
}

func TestBridgeRefusesNilArguments(t *testing.T) {
	b := newTestBridge(t)
	if _, err := b.PlanSessionRequest(nil, "g1"); err == nil {
		t.Error("nil request accepted")
	}
	if _, err := b.BuildSessionTx(&SessionRequest{URL: "x"}, "g1", nil, "", "k"); err == nil {
		t.Error("nil grant accepted")
	}
	if _, err := b.PollSessionOutcome(&SessionRequest{URL: "x"}, "g1", nil); err == nil {
		t.Error("nil tx accepted")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./mobile/`
Expected: FAIL — `b.AcceptSessionRequest undefined`, `undefined: sessionPlanFrom`.

- [ ] **Step 3: Write the bridge**

`mobile/sessions.go`:

```go
package mobile

import (
	"encoding/json"

	"github.com/gnolang/gnokey-mobile2/core"
)

// SessionRequest is a verified GnoConnect session request (see
// core.SessionRequest). URL is the link it came from: every later call reads
// the request from it again, so nothing the native side holds can change what
// the producer signed.
type SessionRequest struct {
	URL       string
	Host      string // "connect" or "disconnect"
	PubKey    string
	Old       string
	AllowJSON string // JSON array, link order
	Spend     string
	Period    int64
	Expires   int64
	ChainID   string
	RPC       string
	Signer    string
	Callback  string
	State     string
}

// SessionPlan is what the request does on chain (see core.SessionPlan).
type SessionPlan struct {
	Identity       string
	SessionAddress string
	// AlreadyGranted: the key is already a live session; ReplyJSON answers the
	// producer without any transaction.
	AlreadyGranted bool
	ReplyJSON      string // JSON array of [key, value] pairs, callback order
	HasOld         bool
	OldOnChain     bool
	OldJSON        string // the old session (sessionJSON) when OldOnChain
	TargetJSON     string // disconnect: the session to revoke (sessionJSON)
	ExpiredJSON    string // JSON array of sessionJSON: expired sessions the transaction may revoke
	MustRevoke     int64  // how many of them must go for the new session to fit
}

// SessionGrant is the grant the user approved: the request's, or narrower.
type SessionGrant struct {
	AllowJSON string
	Spend     string
	Period    int64
	Expires   int64
}

// SessionTx is the desktop command for the request's transaction (see core.SessionTx).
type SessionTx struct {
	Command       string
	Document      string
	SignsDocument bool
	RevokesJSON   string
	GasWanted     int64
	GasFee        string
	AccountNumber int64
	Sequence      int64
}

// SessionOutcome is one look at the chain (see core.SessionOutcome).
type SessionOutcome struct {
	Done      bool
	Stale     bool
	ReplyJSON string // set when Done
}

// sessionJSON is how a session travels inside the JSON fields above.
type sessionJSON struct {
	Address     string   `json:"address"`
	PubKey      string   `json:"pubKey"`
	ExpiresAt   int64    `json:"expiresAt"`
	AllowPaths  []string `json:"allowPaths"`
	SpendLimit  string   `json:"spendLimit"`
	SpendPeriod int64    `json:"spendPeriod"`
}

// AcceptSessionRequest verifies a session link (shape, proof, iat window,
// replay). Errors carry the protocol code to answer the callback with, except
// "[replayed]", which must not be answered.
func (b *Bridge) AcceptSessionRequest(url string) (*SessionRequest, error) {
	r, err := b.svc.AcceptSessionRequest(url)
	if err != nil {
		return nil, err
	}
	return &SessionRequest{
		URL: url, Host: r.Host, PubKey: r.PubKey, Old: r.Old, AllowJSON: encodeStringArray(r.Allow),
		Spend: r.Spend, Period: r.Period, Expires: r.Expires, ChainID: r.ChainID, RPC: r.RPC,
		Signer: r.Signer, Callback: r.Callback, State: r.State,
	}, nil
}

// PlanSessionRequest reads identity's sessions and plans the request for review.
func (b *Bridge) PlanSessionRequest(req *SessionRequest, identity string) (*SessionPlan, error) {
	r, err := coreSessionRequest(req)
	if err != nil {
		return nil, err
	}
	p, err := b.svc.PlanSessionRequest(r, identity)
	if err != nil {
		return nil, err
	}
	return sessionPlanFrom(p)
}

// BuildSessionTx composes the desktop command for the approved grant and the
// expired sessions (JSON array of pubkeys) the user chose to revoke.
func (b *Bridge) BuildSessionTx(req *SessionRequest, identity string, grant *SessionGrant, revokeExpiredJSON, masterKeyName string) (*SessionTx, error) {
	if grant == nil {
		return nil, invalidSpecErr("grant must not be nil")
	}
	r, err := coreSessionRequest(req)
	if err != nil {
		return nil, err
	}
	allow, err := decodeStringArray("grant allow", grant.AllowJSON)
	if err != nil {
		return nil, err
	}
	revoke, err := decodeStringArray("revoke expired", revokeExpiredJSON)
	if err != nil {
		return nil, err
	}
	tx, err := b.svc.BuildSessionTx(r, identity,
		core.Grant{Allow: allow, Spend: grant.Spend, Period: grant.Period, Expires: grant.Expires},
		revoke, masterKeyName)
	if err != nil {
		return nil, err
	}
	return sessionTxFrom(tx), nil
}

// PollSessionOutcome looks once for the result of tx.
func (b *Bridge) PollSessionOutcome(req *SessionRequest, identity string, tx *SessionTx) (*SessionOutcome, error) {
	if tx == nil {
		return nil, invalidSpecErr("session tx must not be nil")
	}
	r, err := coreSessionRequest(req)
	if err != nil {
		return nil, err
	}
	ctx, err := coreSessionTx(tx)
	if err != nil {
		return nil, err
	}
	out, err := b.svc.PollSessionOutcome(r, identity, ctx)
	if err != nil {
		return nil, err
	}
	reply, err := encodePairs(out.Reply)
	if err != nil {
		return nil, err
	}
	return &SessionOutcome{Done: out.Done, Stale: out.Stale, ReplyJSON: reply}, nil
}

func coreSessionRequest(req *SessionRequest) (*core.SessionRequest, error) {
	if req == nil {
		return nil, invalidSpecErr("session request must not be nil")
	}
	return core.ParseSessionRequest(req.URL)
}

func sessionPlanFrom(p *core.SessionPlan) (*SessionPlan, error) {
	out := &SessionPlan{
		Identity: p.Identity, SessionAddress: p.SessionAddress,
		AlreadyGranted: p.Existing != nil, HasOld: p.Old != nil, OldOnChain: p.Old != nil && p.Old.Found,
		MustRevoke: int64(p.MustRevoke),
	}
	var err error
	if out.ReplyJSON, err = encodePairs(p.Reply); err != nil {
		return nil, err
	}
	if out.OldOnChain {
		if out.OldJSON, err = encodeJSON(sessionJSONFrom(p.Old)); err != nil {
			return nil, err
		}
	}
	if p.Target != nil {
		if out.TargetJSON, err = encodeJSON(sessionJSONFrom(p.Target)); err != nil {
			return nil, err
		}
	}
	expired := make([]sessionJSON, len(p.Expired))
	for i, st := range p.Expired {
		expired[i] = sessionJSONFrom(st)
	}
	if out.ExpiredJSON, err = encodeJSON(expired); err != nil {
		return nil, err
	}
	return out, nil
}

func sessionJSONFrom(st *core.SessionStatus) sessionJSON {
	allow := st.AllowPaths
	if allow == nil {
		allow = []string{}
	}
	return sessionJSON{Address: st.SessionAddress, PubKey: st.PubKey, ExpiresAt: st.ExpiresAt,
		AllowPaths: allow, SpendLimit: st.SpendLimit, SpendPeriod: st.SpendPeriod}
}

func sessionTxFrom(tx *core.SessionTx) *SessionTx {
	return &SessionTx{
		Command: tx.Command, Document: tx.Document, SignsDocument: tx.SignsDocument,
		RevokesJSON: encodeStringArray(tx.Revokes), GasWanted: tx.GasWanted, GasFee: tx.GasFee,
		AccountNumber: int64(tx.AccountNumber), Sequence: int64(tx.Sequence),
	}
}

func coreSessionTx(tx *SessionTx) (*core.SessionTx, error) {
	revokes, err := decodeStringArray("revokes", tx.RevokesJSON)
	if err != nil {
		return nil, err
	}
	return &core.SessionTx{
		Command: tx.Command, Document: tx.Document, SignsDocument: tx.SignsDocument, Revokes: revokes,
		GasWanted: tx.GasWanted, GasFee: tx.GasFee,
		AccountNumber: uint64(tx.AccountNumber), Sequence: uint64(tx.Sequence),
	}, nil
}

// encodePairs is a reply as a JSON array of [key, value]; "" when there is none.
func encodePairs(pairs [][2]string) (string, error) {
	if len(pairs) == 0 {
		return "", nil
	}
	return encodeJSON(pairs)
}

func encodeJSON(v any) (string, error) {
	bz, err := json.Marshal(v)
	if err != nil {
		return "", internalErr(err)
	}
	return string(bz), nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./mobile/ -v` then `go test ./core/... ./mobile/...`
Expected: PASS.

- [ ] **Step 5: Check the gomobile binding still builds**

Run: `make build.android` (or `make build.ios`; either regenerates the bindings through gomobile)
Expected: success — `gomobile bind` accepts every new exported type and method. If gomobile reports an unsupported type, it names it: fix the field to one of `string`, `bool`, `int64`, `[]byte`, never a nested struct.

- [ ] **Step 6: Commit**

```bash
go vet ./...
git add mobile/sessions.go mobile/sessions_test.go
git commit -m "feat(sessions): bridge session requests to iOS and Android"
```

---

### Task 10: Integration test on gnodev

**Files:**
- Create: `core/gnoconnect_integration_test.go`
- Modify: `Makefile` (the `test.integration` target)

**Interfaces:**
- Consumes: everything above; `integrationRemote`, `integrationChainID`, `masterSeed`, `masterAddr` (existing, `core/integration_test.go`, same build tag).
- Produces: `make test.integration` runs the session flows; with `GNOKEY` set, the generated commands also run through a real `gnokey`.

Prerequisite: a gnodev on `127.0.0.1:26657`, chain id `dev`, from a gno revision that signs like `v1.5.0` — for example `npm run gnodev` in `~/bubblerumble` (gno `5cdbc25fc`, the mainnet line, which descends from `v1.5.0` and changes nothing in signing). The test makes a fresh funded identity per run, so it never touches test1's own sessions.

- [ ] **Step 1: Write the integration test**

`core/gnoconnect_integration_test.go`:

```go
//go:build integration

package core

import (
	"encoding/base64"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gnolang/gno/gno.land/pkg/gnoclient"
	"github.com/gnolang/gno/tm2/pkg/amino"
	rpcclient "github.com/gnolang/gno/tm2/pkg/bft/rpc/client"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/bip39"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/sdk/auth"
	"github.com/gnolang/gno/tm2/pkg/sdk/bank"
	"github.com/gnolang/gno/tm2/pkg/std"
)

type identity struct {
	address  string
	mnemonic string
	client   *gnoclient.Client
}

// freshIdentity makes and funds a new account, so a run never depends on what
// earlier runs (or a dapp under test) left on test1.
func freshIdentity(t *testing.T) identity {
	t.Helper()
	rpc, err := rpcclient.NewHTTPClient(integrationRemote)
	if err != nil {
		t.Fatal(err)
	}
	entropy, _ := bip39.NewEntropy(256)
	mnemonic, _ := bip39.NewMnemonic(entropy)
	signer, err := gnoclient.SignerFromBip39(mnemonic, integrationChainID, "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	info, err := signer.Info()
	if err != nil {
		t.Fatal(err)
	}
	funder, err := gnoclient.SignerFromBip39(masterSeed, integrationChainID, "", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	test1 := gnoclient.Client{Signer: funder, RPCClient: rpc}
	from, _ := crypto.AddressFromBech32(masterAddr)
	if _, err := test1.Send(gnoclient.BaseTxCfg{GasFee: "1000000ugnot", GasWanted: 2_000_000},
		bank.MsgSend{FromAddress: from, ToAddress: info.GetAddress(), Amount: std.Coins{{Denom: "ugnot", Amount: 1_000_000_000}}}); err != nil {
		t.Fatalf("fund the identity: %v", err)
	}
	return identity{address: crypto.AddressToBech32(info.GetAddress()), mnemonic: mnemonic,
		client: &gnoclient.Client{Signer: signer, RPCClient: rpc}}
}

// requestLink is a session link signed now by key (and oldKey).
func requestLink(t *testing.T, host string, kv []string, key, oldKey crypto.PrivKey) string {
	t.Helper()
	kv = append(withoutParam(withoutParam(kv, "iat"), "chainid"), "iat", strconv.FormatInt(time.Now().Unix(), 10), "chainid", integrationChainID)
	link := launchLink(host, kv...)
	payload, _ := CanonicalPayload(link)
	sig, _ := key.Sign([]byte(payload))
	link += "&sig=" + base64.RawURLEncoding.EncodeToString(sig)
	if oldKey != nil {
		oldSig, _ := oldKey.Sign([]byte(payload))
		link += "&oldsig=" + base64.RawURLEncoding.EncodeToString(oldSig)
	}
	return link
}

var stateCounter int

func grantParams(key crypto.PrivKey, extra ...string) []string {
	stateCounter++
	kv := withParam(connectParams(crypto.PubKeyToBech32(key.PubKey())), "state", "it-"+strconv.Itoa(stateCounter))
	return append(kv, extra...)
}

// signAsDesktop does what the command does: sign the document as the identity
// at the account number and sequence it was built for, then broadcast.
func signAsDesktop(t *testing.T, id identity, tx *SessionTx) {
	t.Helper()
	var doc std.Tx
	if err := amino.UnmarshalJSON([]byte(tx.Document), &doc); err != nil {
		t.Fatal(err)
	}
	signed, err := id.client.SignTx(doc, tx.AccountNumber, tx.Sequence)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := id.client.BroadcastTxCommit(signed); err != nil {
		t.Fatalf("broadcast: %v", err)
	}
}

func waitOutcome(t *testing.T, svc *Service, r *SessionRequest, id identity, tx *SessionTx) *SessionOutcome {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		out, err := svc.PollSessionOutcome(r, id.address, tx)
		if err != nil {
			t.Fatal(err)
		}
		if out.Done {
			return out
		}
		if time.Now().After(deadline) {
			t.Fatalf("no outcome within 30s (stale=%v)", out.Stale)
		}
		time.Sleep(time.Second)
	}
}

func replyValue(reply [][2]string, key string) string {
	for _, kv := range reply {
		if kv[0] == key {
			return kv[1]
		}
	}
	return ""
}

func newIntegrationService(t *testing.T) *Service {
	t.Helper()
	svc, err := NewService(NetworkConfig{Remote: integrationRemote, ChainID: integrationChainID}, t.TempDir(), "pw")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.LatestBlockHeight(); err != nil {
		t.Fatalf("gnodev not reachable at %s: %v", integrationRemote, err)
	}
	return svc
}

// grant runs a connect end to end and returns its reply.
func grant(t *testing.T, svc *Service, id identity, link string, revokeExpired []string) (*SessionRequest, *SessionTx, [][2]string) {
	t.Helper()
	r, err := svc.AcceptSessionRequest(link)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := svc.BuildSessionTx(r, id.address, r.Grant(), revokeExpired, "id")
	if err != nil {
		t.Fatal(err)
	}
	signAsDesktop(t, id, tx)
	return r, tx, waitOutcome(t, svc, r, id, tx).Reply
}

func TestIntegrationSessionRequests(t *testing.T) {
	svc := newIntegrationService(t)
	id := freshIdentity(t)
	k1 := secp256k1.GenPrivKey()
	k1Addr := crypto.AddressToBech32(k1.PubKey().Address())

	// connect with a key: one command, granted as asked.
	_, tx, reply := grant(t, svc, id, requestLink(t, HostConnect, grantParams(k1), k1, nil), nil)
	if tx.SignsDocument || replyValue(reply, "session") != k1Addr || replyValue(reply, "spend") != "5000000ugnot" ||
		replyValue(reply, "features") != "sendtx,signtx,sessions" {
		t.Fatalf("grant: tx %+v, reply %v", tx, reply)
	}

	// The same key again (a lost callback): answered from the chain, nothing to sign.
	r, err := svc.AcceptSessionRequest(requestLink(t, HostConnect, grantParams(k1), k1, nil))
	if err != nil {
		t.Fatal(err)
	}
	plan, err := svc.PlanSessionRequest(r, id.address)
	if err != nil || plan.Existing == nil || replyValue(plan.Reply, "session") != k1Addr {
		t.Fatalf("repeat: %+v, %v", plan, err)
	}

	// Renewal: revoke k1 and create k2 in one signed document.
	k2 := secp256k1.GenPrivKey()
	_, tx, reply = grant(t, svc, id, requestLink(t, HostConnect,
		grantParams(k2, "old", crypto.PubKeyToBech32(k1.PubKey()), "signer", id.address), k2, k1), nil)
	if !tx.SignsDocument || replyValue(reply, "revoked") != k1Addr {
		t.Fatalf("renewal: tx %+v, reply %v", tx, reply)
	}
	if st, _ := svc.QuerySession(id.address, k1Addr); st.Found {
		t.Fatal("the old session survived its renewal")
	}

	// Renewal naming an old key that is gone: the new session only, no `revoked`.
	k3 := secp256k1.GenPrivKey()
	_, tx, reply = grant(t, svc, id, requestLink(t, HostConnect,
		grantParams(k3, "old", crypto.PubKeyToBech32(k1.PubKey()), "signer", id.address), k3, k1), nil)
	if tx.SignsDocument || replyValue(reply, "revoked") != "" {
		t.Fatalf("renewal of a gone key: tx %+v, reply %v", tx, reply)
	}

	// A document goes stale when the identity's sequence moves.
	k4 := secp256k1.GenPrivKey()
	r4, err := svc.AcceptSessionRequest(requestLink(t, HostConnect,
		grantParams(k4, "old", crypto.PubKeyToBech32(k3.PubKey()), "signer", id.address), k4, k3))
	if err != nil {
		t.Fatal(err)
	}
	tx4, err := svc.BuildSessionTx(r4, id.address, r4.Grant(), nil, "id")
	if err != nil || !tx4.SignsDocument {
		t.Fatalf("build: %+v, %v", tx4, err)
	}
	self, _ := crypto.AddressFromBech32(id.address)
	if _, err := id.client.Send(gnoclient.BaseTxCfg{GasFee: "1000000ugnot", GasWanted: 2_000_000},
		bank.MsgSend{FromAddress: self, ToAddress: self, Amount: std.Coins{{Denom: "ugnot", Amount: 1}}}); err != nil {
		t.Fatal(err)
	}
	if out, err := svc.PollSessionOutcome(r4, id.address, tx4); err != nil || !out.Stale {
		t.Fatalf("stale: %+v, %v", out, err)
	}
	tx4, err = svc.BuildSessionTx(r4, id.address, r4.Grant(), nil, "id")
	if err != nil {
		t.Fatal(err)
	}
	signAsDesktop(t, id, tx4)
	waitOutcome(t, svc, r4, id, tx4)

	// Fill the list to 16: k2 and k4 are live (k1 and k3 were revoked by
	// renewals), so 11 more live sessions and 3 short-lived ones.
	master, _ := crypto.AddressFromBech32(id.address)
	var short []crypto.PrivKey
	var msgs []auth.MsgCreateSession
	for i := 0; i < 14; i++ {
		k := secp256k1.GenPrivKey()
		expires := time.Now().Add(time.Hour).Unix()
		if i >= 11 {
			short = append(short, k)
			expires = time.Now().Add(4 * time.Second).Unix()
		}
		msgs = append(msgs, auth.MsgCreateSession{Creator: master, SessionKey: k.PubKey(), ExpiresAt: expires,
			AllowPaths: []string{"bank/send"}})
	}
	if _, err := id.client.CreateSession(gnoclient.BaseTxCfg{GasFee: "1000000ugnot", GasWanted: 30_000_000}, msgs...); err != nil {
		t.Fatalf("fill the session list: %v", err)
	}
	time.Sleep(6 * time.Second) // let the short ones expire

	// A new key on a full list: one expired session must go.
	k5 := secp256k1.GenPrivKey()
	r5, err := svc.AcceptSessionRequest(requestLink(t, HostConnect, grantParams(k5), k5, nil))
	if err != nil {
		t.Fatal(err)
	}
	plan, err = svc.PlanSessionRequest(r5, id.address)
	if err != nil || plan.MustRevoke != 1 || len(plan.Expired) != 3 {
		t.Fatalf("full list: %+v, %v", plan, err)
	}
	_, tx, _ = grant(t, svc, id, requestLink(t, HostConnect, grantParams(k5), k5, nil), []string{crypto.PubKeyToBech32(short[0].PubKey())})
	if !tx.SignsDocument || len(tx.Revokes) != 1 {
		t.Fatalf("housekeeping: %+v", tx)
	}

	// An expired session's own key: session_expired.
	_, err = svc.PlanSessionRequest(mustAccept(t, svc, requestLink(t, HostConnect, grantParams(short[2]), short[2], nil)), id.address)
	requireCode(t, err, CodeSessionExpired)

	// Use the last two expired slots, then a 17th key has nowhere to go.
	k6, k7 := secp256k1.GenPrivKey(), secp256k1.GenPrivKey()
	grant(t, svc, id, requestLink(t, HostConnect, grantParams(k6), k6, nil), []string{crypto.PubKeyToBech32(short[1].PubKey())})
	grant(t, svc, id, requestLink(t, HostConnect, grantParams(k7), k7, nil), []string{crypto.PubKeyToBech32(short[2].PubKey())})
	k8 := secp256k1.GenPrivKey()
	_, err = svc.PlanSessionRequest(mustAccept(t, svc, requestLink(t, HostConnect, grantParams(k8), k8, nil)), id.address)
	requireCode(t, err, CodeSessionLimit)

	// disconnect: a key that is not a session, then k7.
	disc := func(k crypto.PrivKey) string {
		stateCounter++
		return requestLink(t, HostDisconnect, []string{"pubkey", crypto.PubKeyToBech32(k.PubKey()),
			"signer", id.address, "state", "it-" + strconv.Itoa(stateCounter)}, k, nil)
	}
	_, err = svc.PlanSessionRequest(mustAccept(t, svc, disc(k8)), id.address)
	requireCode(t, err, CodeSessionNotFound)

	rd := mustAccept(t, svc, disc(k7))
	txd, err := svc.BuildSessionTx(rd, id.address, Grant{}, nil, "id")
	if err != nil || txd.SignsDocument || !strings.HasPrefix(txd.Command, "gnokey maketx session revoke ") {
		t.Fatalf("disconnect: %+v, %v", txd, err)
	}
	signAsDesktop(t, id, txd)
	if reply := waitOutcome(t, svc, rd, id, txd).Reply; replyValue(reply, "address") != id.address || replyValue(reply, "session") != "" {
		t.Fatalf("disconnect reply: %v", reply)
	}
}

func mustAccept(t *testing.T, svc *Service, link string) *SessionRequest {
	t.Helper()
	r, err := svc.AcceptSessionRequest(link)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

// TestIntegrationSessionCommandsRunInGnokey runs the generated commands as a
// user would, through the gnokey binary in $GNOKEY (make test.integration
// builds one at the gno revision in go.mod).
func TestIntegrationSessionCommandsRunInGnokey(t *testing.T) {
	gnokey := os.Getenv("GNOKEY")
	if gnokey == "" {
		t.Skip("GNOKEY is not set")
	}
	svc := newIntegrationService(t)
	id := freshIdentity(t)
	home := t.TempDir()
	add := exec.Command(gnokey, "add", "id", "--recover", "--insecure-password-stdin", "-home", home)
	add.Stdin = strings.NewReader(id.mnemonic + "\n\n\n")
	if out, err := add.CombinedOutput(); err != nil {
		t.Fatalf("gnokey add: %v\n%s", err, out)
	}
	run := func(command string) {
		t.Helper()
		for _, sub := range []string{"maketx session create", "maketx session revoke", "sign"} {
			command = strings.ReplaceAll(command, "gnokey "+sub+" ", gnokey+" "+sub+" -home "+home+" -insecure-password-stdin ")
		}
		command = strings.ReplaceAll(command, "gnokey broadcast ", gnokey+" broadcast -home "+home+" ")
		sh := exec.Command("sh", "-c", command)
		sh.Dir = t.TempDir()
		sh.Stdin = strings.NewReader("\n")
		if out, err := sh.CombinedOutput(); err != nil {
			t.Fatalf("command failed: %v\n%s\n%s", err, command, out)
		}
		if _, err := os.Stat(filepath.Join(sh.Dir, SessionTxFile)); err == nil {
			t.Logf("document written to %s", SessionTxFile)
		}
	}

	k1 := secp256k1.GenPrivKey()
	r1 := mustAccept(t, svc, requestLink(t, HostConnect, grantParams(k1), k1, nil))
	tx1, err := svc.BuildSessionTx(r1, id.address, r1.Grant(), nil, "id")
	if err != nil {
		t.Fatal(err)
	}
	run(tx1.Command)
	waitOutcome(t, svc, r1, id, tx1)

	k2 := secp256k1.GenPrivKey()
	r2 := mustAccept(t, svc, requestLink(t, HostConnect,
		grantParams(k2, "old", crypto.PubKeyToBech32(k1.PubKey()), "signer", id.address), k2, k1))
	tx2, err := svc.BuildSessionTx(r2, id.address, r2.Grant(), nil, "id")
	if err != nil || !tx2.SignsDocument {
		t.Fatalf("renewal: %+v, %v", tx2, err)
	}
	run(tx2.Command)
	if reply := waitOutcome(t, svc, r2, id, tx2).Reply; replyValue(reply, "revoked") == "" {
		t.Fatalf("renewal reply: %v", reply)
	}

	stateCounter++
	rd := mustAccept(t, svc, requestLink(t, HostDisconnect, []string{"pubkey", crypto.PubKeyToBech32(k2.PubKey()),
		"signer", id.address, "state", "it-" + strconv.Itoa(stateCounter)}, k2, nil))
	txd, err := svc.BuildSessionTx(rd, id.address, Grant{}, nil, "id")
	if err != nil {
		t.Fatal(err)
	}
	run(txd.Command)
	waitOutcome(t, svc, rd, id, txd)
}
```

- [ ] **Step 2: Build gnokey for the integration target**

In `Makefile`, replace the `test.integration` block with:

```make
# expects a local gnodev at 127.0.0.1:26657, chain id "dev", from a gno revision
# that signs like the one in go.mod (v1.5.0, or its mainnet line — e.g.
# `npm run gnodev` in bubblerumble). The session tests also run the generated
# desktop commands through a gnokey built from go.mod's gno.
gnokey_bin := build/gnokey

$(gnokey_bin): go.mod go.sum
	go build -o $@ github.com/gnolang/gno/gno.land/cmd/gnokey

test.integration: $(gnokey_bin)
	GNOKEY=$(abspath $(gnokey_bin)) go test -tags integration -v -run Integration ./core/...
.PHONY: test.integration
```

- [ ] **Step 3: Run the session integration tests**

Run (gnodev up): `make build/gnokey && GNOKEY=$PWD/build/gnokey go test -tags integration -v -run 'IntegrationSession' ./core/`
Expected: PASS for `TestIntegrationSessionRequests` and `TestIntegrationSessionCommandsRunInGnokey`. (`TestIntegrationSessionLifecycle`, the older test, needs `gno.land/r/demo/counter`, which a gnodev loading only `devchain/` does not have; it is not part of this task.)

- [ ] **Step 4: Commit**

```bash
go vet -tags integration ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_integration_test.go Makefile
git commit -m "test(sessions): every session flow against gnodev, and the commands through gnokey"
```

---

## After this milestone

- P2-M2 (iOS) and P2-M3 (Android) plans are written once this lands, from the bridge as it is: routing (`connect` with `pubkey` → `AcceptSessionRequest`, `disconnect` host), the consent screen (Review section), the handoff screen reusing `HandoffScreen`/`CommandBlock` with `Stale` regeneration, cancel → `cancelled`, `sessions` added to the identity-only `connect`'s `features`, and the Swift/Kotlin parser tests. Then the BR ↔ gnokey-mobile round trip on both platforms.
- Scope hints on an identity-only `connect` stay deferred (spec §9, item 2).
