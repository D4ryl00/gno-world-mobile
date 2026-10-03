# P2-M1b — gnokey-mobile core: the deferred minors of P2-M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix, in gnokey-mobile's `core/` and `mobile/`, the eight minors the P2-M1 final review deferred, so that P2-M2 (iOS) and P2-M3 (Android) build on a bridge whose contract no longer changes: expiry judged on chain time, a rebuild after a landed result that says so, a dedicated code for a wrong network, a refused link answered once, the signer pin compared as an address, a session key that is already an account refused up front, the missing tests, and a green `make test.integration`.

**Architecture:** Same layering as P2-M1: pure functions stay pure; `Service` methods gain one chain read (`Status`, for the latest block time) and one account read (collision check). Two new internal codes (`already_done`, `wrong_network`) join `replayed` as codes native code acts on but never answers. A test-only fake RPC client (`fakeChain`) lets unit tests drive the `Service` methods without a node.

**Tech Stack:** Go 1.25, `github.com/gnolang/gno v1.5.1-0.20260928125126-5cdbc25fcde0` (tm2 `bft/rpc/client`, `bft/rpc/core/types`, `bft/abci/types`, `amino`, `std`; `gno.land/pkg/gnoland`), gomobile-bound package `mobile`.

**Spec:** `~/bubblerumble/gnoconnect-session.md` (Proof of possession — wallet checks 3; `connect` with a key steps 1–3; Wallet housekeeping: "A wallet MUST NOT revoke a session that has not expired …"), `~/bubblerumble/docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` §9 (the deferred minors, under "Livré", P2-M1), and the P2-M1 final review `~/gnokey-mobile/.superpowers/sdd/2026-10-02-p2-m1-gnokey-core-sessions/final-review.md` (Minor 2–7, 9, 10).

## Global Constraints

- Repository `~/gnokey-mobile`, branch `feat/deeplink-tx` (PR #138), committing on top of `b546701`. No new branch, no push until the user asks.
- No new module dependency; gno stays at `v1.5.1-0.20260928125126-5cdbc25fcde0`.
- Every error is a `*core.CodedError` (`"[code] message"`). Protocol codes are answered verbatim to the callback. Internal codes are never answered: `replayed` (drop the copy), `already_done` (keep polling: the next poll reports Done), `wrong_network` (resolve the network — switch, or answer `network_declined` — then call again).
- Expiry and `ExpiresAt` are judged on chain time: `min(wallet clock, latest block time)`. The `iat` window stays on the wallet clock (spec, "Wallet checks").
- gomobile surface (`mobile/`): no new exported type or field in this plan; only doc comments change there.
- Commit messages follow the repo: `fix(sessions): …`, `test(sessions): …`; no attribution trailer.
- Run `gofmt -w` on the files you touched, then `go vet ./...`, `go vet -tags integration ./...` and `go test ./core/... ./mobile/...`, before every commit.

## Review Focus

- A phone clock running ahead must never make a live session look expired, nor stretch a new session's `ExpiresAt` (pinned in Task 1).
- A rebuild after the result already landed must lead to Done, never to an error answered to the producer (pinned in Task 2).
- A request for another chain is never planned, built or polled as if it were on this one, and is never answered `invalid_spec` (pinned in Task 3).
- The same refused link delivered twice is answered once (pinned in Task 4).
- An upper-case `signer` pin of the right identity is accepted; a different identity is still refused (pinned in Task 5).

---

## File Structure

- `core/fakechain_test.go` — create: `fakeChain` (fake `rpcclient.Client`), `onFakeChain`, `sessionListJSON`, `accountJSON` (Task 1).
- `core/errors.go` — modify: `CodeAlreadyDone` (Task 2), `CodeWrongNetwork` (Task 3).
- `core/gnoconnect_plan.go` — modify: `chainNow`, `PlanSessionRequest` (Tasks 1, 3, 5).
- `core/gnoconnect_tx.go` — modify: `BuildSessionTx` (Tasks 1, 2).
- `core/gnoconnect_hints.go` — modify: `SessionCoversHints` (Task 1).
- `core/gnoconnect_outcome.go` — modify: the chain check's code (Task 3).
- `core/gnoconnect_proof.go` — modify: `ReplayGuard.AdmitLink`, `AcceptSessionRequest` (Task 4).
- `mobile/sessions.go` — modify: doc comments stating the native contract (Tasks 2, 3).
- Tests next to each file; `core/gnoconnect_integration_test.go` (Task 5), `core/integration_test.go` (Task 6).

---

### Task 1: Judge expiry on chain time

**Files:**
- Create: `core/fakechain_test.go`, `core/gnoconnect_chaintime_test.go`
- Modify: `core/gnoconnect_plan.go`, `core/gnoconnect_tx.go`, `core/gnoconnect_hints.go`

**Interfaces:**
- Consumes: `newTestService` (existing), `session`, `connectFor`, `planNow`, `testIdentity` (P2-M1 test helpers), `SessionStatus`.
- Produces: `func (s *Service) chainNow() (time.Time, error)`; test helpers `type fakeChain struct { rpcclient.Client; blockTime time.Time; data map[string]string; paths []string }`, `func onFakeChain(svc *Service, f *fakeChain)`, `func sessionListJSON(t *testing.T, sts ...*SessionStatus) string`, `func accountJSON(t *testing.T, address string, sequence uint64) string`.

- [ ] **Step 1: Write the fake chain**

`core/fakechain_test.go`:

```go
package core

import (
	"context"
	"testing"
	"time"

	"github.com/gnolang/gno/gno.land/pkg/gnoland"
	"github.com/gnolang/gno/tm2/pkg/amino"
	abci "github.com/gnolang/gno/tm2/pkg/bft/abci/types"
	rpcclient "github.com/gnolang/gno/tm2/pkg/bft/rpc/client"
	ctypes "github.com/gnolang/gno/tm2/pkg/bft/rpc/core/types"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// fakeChain answers the two RPC calls the session code makes: Status (the
// latest block time) and ABCIQuery (by path). Any other call panics through
// the nil embedded interface.
type fakeChain struct {
	rpcclient.Client
	blockTime time.Time
	data      map[string]string // query path → amino JSON; absent = "null"
	paths     []string          // query paths, in call order
}

func (f *fakeChain) Status(context.Context, *int64) (*ctypes.ResultStatus, error) {
	return &ctypes.ResultStatus{SyncInfo: ctypes.SyncInfo{LatestBlockTime: f.blockTime}}, nil
}

func (f *fakeChain) ABCIQuery(_ context.Context, path string, _ []byte) (*ctypes.ResultABCIQuery, error) {
	f.paths = append(f.paths, path)
	data, ok := f.data[path]
	if !ok {
		data = "null"
	}
	return &ctypes.ResultABCIQuery{Response: abci.ResponseQuery{ResponseBase: abci.ResponseBase{Data: []byte(data)}}}, nil
}

// onFakeChain points svc at f instead of a node.
func onFakeChain(svc *Service, f *fakeChain) {
	svc.mu.Lock()
	svc.rpc = f
	svc.mu.Unlock()
}

// sessionListJSON is what auth/accounts/{addr}/sessions answers for sts,
// checked by decoding it back the way QuerySessions does.
func sessionListJSON(t *testing.T, sts ...*SessionStatus) string {
	t.Helper()
	accs := make([]std.Account, len(sts))
	for i, st := range sts {
		addr, err := crypto.AddressFromBech32(st.SessionAddress)
		if err != nil {
			t.Fatal(err)
		}
		master, err := crypto.AddressFromBech32(st.MasterAddress)
		if err != nil {
			t.Fatal(err)
		}
		acc := &gnoland.GnoSessionAccount{AllowPaths: st.AllowPaths}
		acc.Address, acc.MasterAddress, acc.ExpiresAt, acc.SpendPeriod = addr, master, st.ExpiresAt, st.SpendPeriod
		if st.PubKey != "" {
			if acc.PubKey, err = crypto.PubKeyFromBech32(st.PubKey); err != nil {
				t.Fatal(err)
			}
		}
		if acc.SpendLimit, err = std.ParseCoins(st.SpendLimit); err != nil {
			t.Fatal(err)
		}
		accs[i] = acc
	}
	bz, err := amino.MarshalJSON(accs)
	if err != nil {
		t.Fatal(err)
	}
	if back, err := decodeSessions(bz); err != nil || len(back) != len(sts) {
		t.Fatalf("the fake session list does not decode: %v, %v", back, err)
	}
	return string(bz)
}

// accountJSON is what auth/accounts/{address} answers for a regular account,
// checked by decoding it back the way QueryAccount does.
func accountJSON(t *testing.T, address string, sequence uint64) string {
	t.Helper()
	addr, err := crypto.AddressFromBech32(address)
	if err != nil {
		t.Fatal(err)
	}
	acc := gnoland.GnoAccount{BaseAccount: std.BaseAccount{Address: addr, Sequence: sequence}}
	bz, err := amino.MarshalJSON(acc)
	if err != nil {
		t.Fatal(err)
	}
	var back gnoland.GnoAccount
	if err := amino.UnmarshalJSON(bz, &back); err != nil || back.Sequence != sequence {
		t.Fatalf("the fake account does not decode: %+v, %v", back, err)
	}
	return string(bz)
}
```

- [ ] **Step 2: Write the failing test**

`core/gnoconnect_chaintime_test.go`:

```go
package core

import (
	"testing"
	"time"

	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
)

func TestChainNowNeverRunsAheadOfTheChain(t *testing.T) {
	svc, _ := newTestService(t)
	block := time.Unix(1790841600, 0)
	onFakeChain(svc, &fakeChain{blockTime: block})

	svc.now = func() time.Time { return block.Add(time.Hour) } // the phone runs ahead
	if got, err := svc.chainNow(); err != nil || !got.Equal(block) {
		t.Errorf("clock ahead: %v, %v", got, err)
	}
	svc.now = func() time.Time { return block.Add(-time.Minute) } // the phone is behind
	if got, err := svc.chainNow(); err != nil || !got.Equal(block.Add(-time.Minute)) {
		t.Errorf("clock behind: %v, %v", got, err)
	}
	onFakeChain(svc, &fakeChain{}) // a node that reports no block time
	if _, err := svc.chainNow(); err == nil {
		t.Error("a node without a block time must not be trusted")
	}
}

func TestPlanSessionRequestJudgesExpiryOnChainTime(t *testing.T) {
	svc, _ := newTestService(t)
	live := session(30 * time.Minute) // expires 30 minutes after planNow
	onFakeChain(svc, &fakeChain{blockTime: planNow, data: map[string]string{
		"auth/accounts/" + testIdentity + "/sessions": sessionListJSON(t, live.st),
	}})
	svc.now = func() time.Time { return planNow.Add(time.Hour) } // the phone is an hour ahead

	r := connectFor(secp256k1.GenPrivKey(), nil)
	r.ChainID = DefaultChainID
	p, err := svc.PlanSessionRequest(r, testIdentity)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Expired) != 0 {
		t.Errorf("a live session was offered for revocation: %+v", p.Expired[0])
	}
}

func TestBuildSessionTxCountsExpiresFromChainTime(t *testing.T) {
	svc, _ := newTestService(t)
	onFakeChain(svc, &fakeChain{blockTime: planNow, data: map[string]string{
		"auth/accounts/" + testIdentity: accountJSON(t, testIdentity, 3),
	}})
	svc.now = func() time.Time { return planNow.Add(time.Hour) }

	r := grantRequest(secp256k1.GenPrivKey(), nil)
	r.ChainID = DefaultChainID
	tx, err := svc.BuildSessionTx(r, testIdentity, r.Grant(), nil, "id")
	if err != nil {
		t.Fatal(err)
	}
	doc := decodeDoc(t, tx.Document)
	create := doc.Msgs[0].(auth.MsgCreateSession)
	if create.ExpiresAt != planNow.Unix()+r.Expires {
		t.Errorf("ExpiresAt = %d, want chain time + expires = %d", create.ExpiresAt, planNow.Unix()+r.Expires)
	}
}
```

Add `"github.com/gnolang/gno/tm2/pkg/sdk/auth"` to the imports (`decodeDoc` is in `core/gnoconnect_tx_test.go`). `BuildSessionTx` also prices the gas through `MinGasFee`: on the fake, `auth/gasprice` answers `null`, and `QueryGasPrice` then falls back to the genesis price, so the fake needs no entry for it.

- [ ] **Step 3: Run it to verify it fails**

Run: `go test ./core/ -run 'ChainNow|ChainTime'`
Expected: FAIL — `svc.chainNow undefined`.

- [ ] **Step 4: Write `chainNow` and use it**

In `core/gnoconnect_plan.go`, add `"context"` to the imports and, before `PlanSessionRequest`:

```go
// chainNow is the time the session code judges expiry by: the latest block's,
// unless the wallet's clock is behind it. A phone clock running ahead then
// never makes a live session look expired (and offered for revocation), nor
// stretches a new session past the lifetime the producer asked for.
func (s *Service) chainNow() (time.Time, error) {
	s.mu.RLock()
	rpc := s.rpc
	s.mu.RUnlock()
	status, err := rpc.Status(context.Background(), nil)
	if err != nil {
		return time.Time{}, Errf(CodeNetwork, "query the latest block: %v", err)
	}
	block := status.SyncInfo.LatestBlockTime
	if block.IsZero() {
		return time.Time{}, Errf(CodeNetwork, "the node reports no block time")
	}
	if now := s.now(); now.Before(block) {
		return now, nil
	}
	return block, nil
}
```

and make `PlanSessionRequest` end with:

```go
	sessions, err := s.QuerySessions(identity)
	if err != nil {
		return nil, err
	}
	now, err := s.chainNow()
	if err != nil {
		return nil, err
	}
	return planSessionRequest(r, identity, sessions, now)
}
```

In `core/gnoconnect_tx.go`, `BuildSessionTx`: before `cfg := s.Network()`, add

```go
	now, err := s.chainNow()
	if err != nil {
		return nil, err
	}
```

and pass `Now: now` instead of `Now: s.now()`.

In `core/gnoconnect_hints.go`, `SessionCoversHints` becomes:

```go
// SessionCoversHints reads one session and checks it against the hints, on
// chain time.
func (s *Service) SessionCoversHints(masterAddress, sessionAddress string, h *ScopeHints) (bool, error) {
	st, err := s.QuerySession(masterAddress, sessionAddress)
	if err != nil {
		return false, err
	}
	now, err := s.chainNow()
	if err != nil {
		return false, err
	}
	return SessionCovers(st, h, now), nil
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./core/ -run 'ChainNow|ChainTime|Plan|Compose' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
gofmt -w core/fakechain_test.go core/gnoconnect_chaintime_test.go core/gnoconnect_plan.go core/gnoconnect_tx.go core/gnoconnect_hints.go
go vet ./... && go vet -tags integration ./... && go test ./core/... ./mobile/...
git add core/fakechain_test.go core/gnoconnect_chaintime_test.go core/gnoconnect_plan.go core/gnoconnect_tx.go core/gnoconnect_hints.go
git commit -m "fix(sessions): judge expiry on chain time, never ahead of the latest block"
```

---

### Task 2: A rebuild after the result landed says `already_done`

**Files:**
- Modify: `core/errors.go`, `core/gnoconnect_tx.go`, `mobile/sessions.go`
- Test: `core/gnoconnect_tx_test.go`, `core/gnoconnect_outcome_test.go`

**Interfaces:**
- Consumes: `fakeChain`, `onFakeChain`, `sessionListJSON`, `accountJSON` (Task 1); `session`, `grantRequest`, `newGPub`, `requireCode` (P2-M1).
- Produces: `const CodeAlreadyDone = "already_done"`; `BuildSessionTx` fails with it when the plan shows the request already fulfilled (a connect's key is a live session, a disconnect's key is no longer a session).

- [ ] **Step 1: Write the failing tests**

Append to `core/gnoconnect_tx_test.go`:

```go
func TestRebuildAfterTheResultLandedIsAlreadyDone(t *testing.T) {
	svc, _ := newTestService(t)
	svc.now = func() time.Time { return planNow }
	granted := session(time.Hour)
	onFakeChain(svc, &fakeChain{blockTime: planNow, data: map[string]string{
		"auth/accounts/" + testIdentity + "/sessions": sessionListJSON(t, granted.st),
	}})

	// A connect whose key is already a live session: the poll saw the sequence
	// move before it saw the session (a lagging node), the rebuild sees it.
	r := grantRequest(granted.key, nil)
	r.ChainID = DefaultChainID
	_, err := svc.BuildSessionTx(r, testIdentity, r.Grant(), nil, "id")
	requireCode(t, err, CodeAlreadyDone)

	// A disconnect whose key is no longer a session: revoked.
	gone := &SessionRequest{Host: HostDisconnect, PubKey: newGPub(), ChainID: DefaultChainID, Signer: testIdentity, State: "s"}
	_, err = svc.BuildSessionTx(gone, testIdentity, Grant{}, nil, "id")
	requireCode(t, err, CodeAlreadyDone)
}
```

Append to `core/gnoconnect_outcome_test.go` (it pins the Task 8 ruling of P2-M1; it passes before and after this task — check it fails by swapping the two reads in `PollSessionOutcome` locally, then restore):

```go
func TestPollReadsTheSequenceBeforeTheSession(t *testing.T) {
	svc, _ := newTestService(t)
	f := &fakeChain{blockTime: planNow}
	onFakeChain(svc, f)
	r := grantRequest(secp256k1.GenPrivKey(), nil)
	r.ChainID = DefaultChainID
	out, err := svc.PollSessionOutcome(r, testIdentity, &SessionTx{SignsDocument: true, Sequence: 1})
	if err != nil {
		t.Fatal(err)
	}
	// Read in the other order, a transaction landing between the two reads
	// would show a moved sequence and no session: reported Stale, not Done.
	if len(f.paths) != 2 || f.paths[0] != "auth/accounts/"+testIdentity || !strings.Contains(f.paths[1], "/session/") {
		t.Errorf("queries = %v: the account must be read before the session", f.paths)
	}
	if !out.Stale {
		t.Errorf("sequence 0 on chain, document for 1, no session: %+v", out)
	}
}
```

Add `"strings"` to that file's imports.

- [ ] **Step 2: Run them to verify they fail**

Run: `go test ./core/ -run 'RebuildAfter|PollReadsTheSequence'`
Expected: FAIL — `undefined: CodeAlreadyDone`.

- [ ] **Step 3: Add the code**

In `core/errors.go`, after `CodeReplayed = "replayed"`:

```go
	// CodeAlreadyDone is not a protocol code either: a rebuild found the
	// request's result already on chain. Nothing to sign; the next poll
	// reports Done, and that is what native code answers.
	CodeAlreadyDone = "already_done"
```

- [ ] **Step 4: Make `BuildSessionTx` say so**

In `core/gnoconnect_tx.go`, add `"errors"` to the imports and replace the start of `BuildSessionTx`, up to and including the `PlanSessionRequest` error check, with:

```go
func (s *Service) BuildSessionTx(r *SessionRequest, identity string, grant Grant, revokeExpired []string, masterKeyName string) (*SessionTx, error) {
	plan, err := s.PlanSessionRequest(r, identity)
	var ce *CodedError
	if r.Host == HostDisconnect && errors.As(err, &ce) && ce.Code == CodeSessionNotFound {
		// The key is no longer a session: revoked by this request's own
		// transaction (seen late through a lagging node) or by anyone else.
		// Either way it no longer works, and a poll reports the disconnect done.
		return nil, Errf(CodeAlreadyDone, "%s", ce.Msg)
	}
	if err != nil {
		return nil, err
	}
	if plan.Existing != nil {
		// A rebuild after the result landed: nothing to sign, a poll reports it done.
		return nil, Errf(CodeAlreadyDone, "%s is already a session of %s", plan.SessionAddress, plan.Identity)
	}
```

(the rest of the function — the account read, the fee, `chainNow`, `composeSessionTx` — is unchanged).

In `mobile/sessions.go`, the `BuildSessionTx` doc comment becomes:

```go
// BuildSessionTx composes the desktop command for the approved grant and the
// expired sessions (JSON array of pubkeys) the user chose to revoke. Call it
// again when a poll reports Stale. "[already_done]" means the result is
// already on chain: keep polling, the next poll reports Done; never answer it.
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `go test ./core/ -run 'RebuildAfter|PollReadsTheSequence|Compose' -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
gofmt -w core/errors.go core/gnoconnect_tx.go core/gnoconnect_tx_test.go core/gnoconnect_outcome_test.go mobile/sessions.go
go vet ./... && go vet -tags integration ./... && go test ./core/... ./mobile/...
git add core/errors.go core/gnoconnect_tx.go core/gnoconnect_tx_test.go core/gnoconnect_outcome_test.go mobile/sessions.go
git commit -m "fix(sessions): a rebuild after the result landed is already_done, not an error to answer"
```

---

### Task 3: A request for another chain is `wrong_network`

**Files:**
- Modify: `core/errors.go`, `core/gnoconnect_plan.go`, `core/gnoconnect_outcome.go`, `mobile/sessions.go`
- Test: `core/gnoconnect_plan_test.go`, `core/gnoconnect_outcome_test.go`

**Interfaces:**
- Produces: `const CodeWrongNetwork = "wrong_network"`, returned by `PlanSessionRequest` (and so `BuildSessionTx`) and `PollSessionOutcome` when `r.ChainID` is not the wallet's chain.

- [ ] **Step 1: Change the tests**

In `core/gnoconnect_plan_test.go`, `TestPlanSessionRequestChecksPinAndNetwork`, the last assertion becomes:

```go
	requireCode(t, err, CodeWrongNetwork)
```

In `core/gnoconnect_outcome_test.go`, `TestPollSessionOutcomeRefusesAnotherChain`, the assertion becomes:

```go
	requireCode(t, err, CodeWrongNetwork)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go test ./core/ -run 'ChecksPinAndNetwork|RefusesAnotherChain'`
Expected: FAIL — `undefined: CodeWrongNetwork`.

- [ ] **Step 3: Add the code and use it**

In `core/errors.go`, after `CodeAlreadyDone`:

```go
	// CodeWrongNetwork is not a protocol code: the wallet is not on the
	// request's chain. Native code resolves the network as for any request —
	// switch, or answer network_declined — then calls again.
	CodeWrongNetwork = "wrong_network"
```

In `core/gnoconnect_plan.go` (`PlanSessionRequest`) and `core/gnoconnect_outcome.go` (`PollSessionOutcome`), the chain check returns:

```go
		return nil, Errf(CodeWrongNetwork, "the request is for chain %q, the wallet is on %q", r.ChainID, cfg.ChainID)
```

In `mobile/sessions.go`, the `PlanSessionRequest` doc comment becomes:

```go
// PlanSessionRequest reads identity's sessions and plans the request for
// review. "[wrong_network]" (also from BuildSessionTx and PollSessionOutcome)
// means the wallet is not on the request's chain: resolve the network —
// switch, or answer network_declined — and call again; never answer it as is.
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/... ./mobile/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
gofmt -w core/errors.go core/gnoconnect_plan.go core/gnoconnect_outcome.go core/gnoconnect_plan_test.go core/gnoconnect_outcome_test.go mobile/sessions.go
go vet ./... && go vet -tags integration ./... && go test ./core/... ./mobile/...
git add core/errors.go core/gnoconnect_plan.go core/gnoconnect_outcome.go core/gnoconnect_plan_test.go core/gnoconnect_outcome_test.go mobile/sessions.go
git commit -m "fix(sessions): a request for another chain is wrong_network, for native code to resolve"
```

---

### Task 4: A refused link delivered twice is answered once

**Files:**
- Modify: `core/gnoconnect_proof.go`
- Test: `core/gnoconnect_proof_test.go`

**Interfaces:**
- Consumes: `signedLink`, `connectParams` (P2-M1).
- Produces: `func (g *ReplayGuard) AdmitLink(rawURL string, now time.Time) bool`; `AcceptSessionRequest` fails with `replayed` on any link it has already received within the window, accepted or refused.

- [ ] **Step 1: Write the failing test**

Append to `core/gnoconnect_proof_test.go`:

```go
func TestAcceptSessionRequestAnswersARefusedLinkOnce(t *testing.T) {
	svc, _ := newTestService(t)
	svc.now = func() time.Time { return time.Unix(1790841600+5, 0) }
	key := secp256k1.GenPrivKey()
	// Signed by another key: refused.
	link := signedLink(t, HostConnect, connectParams(crypto.PubKeyToBech32(key.PubKey())), secp256k1.GenPrivKey(), nil)

	_, err := svc.AcceptSessionRequest(link)
	requireCode(t, err, CodeInvalidProof)
	_, err = svc.AcceptSessionRequest(link) // the intent delivered again
	requireCode(t, err, CodeReplayed)
}

func TestReplayGuardForgetsLinks(t *testing.T) {
	g := NewReplayGuard()
	now := time.Unix(1790841600, 0)
	if !g.AdmitLink("l", now) || g.AdmitLink("l", now.Add(time.Minute)) {
		t.Fatal("a link is admitted once")
	}
	if !g.AdmitLink("l", now.Add(12*time.Minute)) {
		t.Fatal("a link is forgotten once its window is over")
	}
	if !g.Admit("l", "", now) {
		t.Fatal("links and (pubkey, state) pairs never collide")
	}
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `go test ./core/ -run 'RefusedLinkOnce|ForgetsLinks'`
Expected: FAIL — `g.AdmitLink undefined`.

- [ ] **Step 3: Remember links**

In `core/gnoconnect_proof.go`, add `"crypto/sha256"` to the imports and replace `Admit` with:

```go
// Admit records the pair and reports whether it is new.
func (g *ReplayGuard) Admit(pubkey, state string, now time.Time) bool {
	return g.admit("pair\x00"+pubkey+"\x00"+state, now)
}

// AdmitLink records a raw link, whatever becomes of it, and reports whether it
// is new: a link delivered twice (an intent re-delivered, a double tap) is
// answered once, even when the answer is an error.
func (g *ReplayGuard) AdmitLink(rawURL string, now time.Time) bool {
	sum := sha256.Sum256([]byte(rawURL))
	return g.admit("link\x00"+string(sum[:]), now)
}

func (g *ReplayGuard) admit(k string, now time.Time) bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	for seen, at := range g.seen {
		if now.Sub(at) > iatMaxAge+iatMaxFuture {
			delete(g.seen, seen)
		}
	}
	if _, ok := g.seen[k]; ok {
		return false
	}
	g.seen[k] = now
	return true
}
```

and `AcceptSessionRequest` with:

```go
// AcceptSessionRequest runs every check a wallet makes before showing anything
// to the user: shape, proof of possession, freshness, and replay. A link
// already received — accepted or refused — or a (pubkey, state) pair already
// accepted fails with CodeReplayed, which the caller must not answer.
func (s *Service) AcceptSessionRequest(rawURL string) (*SessionRequest, error) {
	now := s.now()
	if !s.replay.AdmitLink(rawURL, now) {
		return nil, Errf(CodeReplayed, "this link was already received")
	}
	r, err := ParseSessionRequest(rawURL)
	if err != nil {
		return nil, err
	}
	if err := r.VerifyProof(); err != nil {
		return nil, err
	}
	if err := CheckFreshness(r.IAT, now); err != nil {
		return nil, err
	}
	if !s.replay.Admit(r.PubKey, r.State, now) {
		return nil, Errf(CodeReplayed, "this request is already being handled")
	}
	return r, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/ -run 'Proof|Freshness|Replay|Accept' -v && go test ./mobile/`
Expected: PASS (the bridge's replay test included).

- [ ] **Step 5: Commit**

```bash
gofmt -w core/gnoconnect_proof.go core/gnoconnect_proof_test.go
go vet ./... && go vet -tags integration ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_proof.go core/gnoconnect_proof_test.go
git commit -m "fix(sessions): answer a refused link once when it is delivered twice"
```

---

### Task 5: The signer pin as an address, and a key that is already an account

**Files:**
- Modify: `core/gnoconnect_plan.go`
- Test: `core/gnoconnect_plan_test.go`, `core/gnoconnect_integration_test.go`

**Interfaces:**
- Consumes: `CodeWrongNetwork` (Task 3), `chainNow`, `fakeChain`, `onFakeChain`, `accountJSON` (Task 1); `QueryAccount` (existing); `freshIdentity`, `newIntegrationService`, `requestLink`, `grantParams`, `mustAccept` (P2-M1 integration test).
- Produces: `PlanSessionRequest` compares the pin as a decoded address (`signer_unavailable` only for another identity), plans with the identity in canonical bech32, and refuses with `invalid_request` a connect whose new key's address is already a regular account.

- [ ] **Step 1: Write the failing tests**

Append to `core/gnoconnect_plan_test.go` (add `"strings"` to its imports):

```go
func TestPlanSessionRequestComparesThePinAsAnAddress(t *testing.T) {
	svc, _ := newTestService(t)
	r := connectFor(secp256k1.GenPrivKey(), nil)
	r.ChainID = "dev" // stops at the network check, which comes after the pin
	r.Signer = strings.ToUpper(testIdentity)
	_, err := svc.PlanSessionRequest(r, testIdentity)
	requireCode(t, err, CodeWrongNetwork)

	r.Signer = "g1u7y667z64x2h7vc6fmpcprgey4ck233jaww9zq"
	_, err = svc.PlanSessionRequest(r, testIdentity)
	requireCode(t, err, CodeSignerUnavailable)
}

func TestPlanRefusesAKeyThatIsAlreadyAnAccount(t *testing.T) {
	svc, _ := newTestService(t)
	key := secp256k1.GenPrivKey()
	keyAddr := crypto.AddressToBech32(key.PubKey().Address())
	onFakeChain(svc, &fakeChain{blockTime: planNow, data: map[string]string{
		"auth/accounts/" + keyAddr: accountJSON(t, keyAddr, 0),
	}})
	svc.now = func() time.Time { return planNow }
	r := connectFor(key, nil)
	r.ChainID = DefaultChainID
	_, err := svc.PlanSessionRequest(r, testIdentity)
	requireCode(t, err, CodeInvalidRequest)
}
```

Append to `core/gnoconnect_integration_test.go`:

```go
// TestIntegrationSessionKeyThatIsAnAccount: the chain refuses a session key
// whose address already holds a regular account; the wallet says so up front.
func TestIntegrationSessionKeyThatIsAnAccount(t *testing.T) {
	svc := newIntegrationService(t)
	id := freshIdentity(t)
	k := secp256k1.GenPrivKey()
	self, _ := crypto.AddressFromBech32(id.address)
	if _, err := id.client.Send(gnoclient.BaseTxCfg{GasFee: "1000000ugnot", GasWanted: 2_000_000},
		bank.MsgSend{FromAddress: self, ToAddress: k.PubKey().Address(), Amount: std.Coins{{Denom: "ugnot", Amount: 1}}}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.PlanSessionRequest(mustAccept(t, svc, requestLink(t, HostConnect, grantParams(k), k, nil)), id.address)
	requireCode(t, err, CodeInvalidRequest)
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `go test ./core/ -run 'PinAsAnAddress|AlreadyAnAccount'`
Expected: FAIL — the upper-case pin gets `signer_unavailable`; the colliding key gets a plan.

- [ ] **Step 3: Rewrite `PlanSessionRequest`**

In `core/gnoconnect_plan.go`, add `"github.com/gnolang/gno/tm2/pkg/crypto"` to the imports and replace `PlanSessionRequest` (with its doc comment) by:

```go
// PlanSessionRequest reads identity's sessions and plans the request. identity
// is the account the user picked, which must match a pinned signer, and the
// wallet must be on the request's chain.
func (s *Service) PlanSessionRequest(r *SessionRequest, identity string) (*SessionPlan, error) {
	id, err := crypto.AddressFromBech32(identity)
	if err != nil {
		return nil, Errf(CodeInvalidAddress, "identity %q: %v", identity, err)
	}
	if r.Signer != "" {
		// Compared as addresses: a valid bech32 pin may be in upper case.
		if pin, err := crypto.AddressFromBech32(r.Signer); err != nil || pin != id {
			return nil, Errf(CodeSignerUnavailable, "the request is pinned to %s, not %s", r.Signer, identity)
		}
	}
	if cfg := s.Network(); r.ChainID != cfg.ChainID {
		return nil, Errf(CodeWrongNetwork, "the request is for chain %q, the wallet is on %q", r.ChainID, cfg.ChainID)
	}
	identity = crypto.AddressToBech32(id)
	sessions, err := s.QuerySessions(identity)
	if err != nil {
		return nil, err
	}
	now, err := s.chainNow()
	if err != nil {
		return nil, err
	}
	p, err := planSessionRequest(r, identity, sessions, now)
	if err != nil {
		return nil, err
	}
	// The chain refuses a session key whose address already holds a regular
	// account, after charging the fee if the transaction is not simulated
	// first: tell the producer now, not the user at the desktop.
	if r.Host == HostConnect && p.Existing == nil {
		acc, err := s.QueryAccount(p.SessionAddress)
		if err != nil {
			return nil, err
		}
		if acc.Exists {
			return nil, Errf(CodeInvalidRequest, "%s is already an account on chain: use a fresh key", p.SessionAddress)
		}
	}
	return p, nil
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `go test ./core/... ./mobile/...` then, with `npm run gnodev` running in `~/bubblerumble`: `GNOKEY=$PWD/build/gnokey go test -count=1 -tags integration -v -run 'IntegrationSession(Requests|CommandsRunInGnokey|KeyThatIsAnAccount)' ./core/`
Expected: PASS, the three integration tests included.

- [ ] **Step 5: Commit**

```bash
gofmt -w core/gnoconnect_plan.go core/gnoconnect_plan_test.go core/gnoconnect_integration_test.go
go vet ./... && go vet -tags integration ./... && go test ./core/... ./mobile/...
git add core/gnoconnect_plan.go core/gnoconnect_plan_test.go core/gnoconnect_integration_test.go
git commit -m "fix(sessions): compare the signer pin as an address, refuse a key that is already an account"
```

---

### Task 6: The missing tests, and a green `make test.integration`

**Files:**
- Modify: `core/integration_test.go`
- Test: `core/gnoconnect_plan_test.go`, `mobile/sessions_test.go`

**Interfaces:**
- Consumes: `planSessionRequest`, `session`, `statuses`, `connectFor`, `planNow` (P2-M1); `coreSessionRequest`, `signedConnect` (P2-M1 bridge).
- Produces: tests only, and `TestIntegrationSessionLifecycle` skipping on a chain without `gno.land/r/demo/counter`.

- [ ] **Step 1: Write the tests**

Append to `core/gnoconnect_plan_test.go`:

```go
func TestPlanNeverOffersAKeylessExpiredSession(t *testing.T) {
	noPub := session(-time.Hour)
	noPub.st.PubKey = ""
	revocable := session(-time.Hour)
	p, err := planSessionRequest(connectFor(secp256k1.GenPrivKey(), nil), testIdentity, statuses(noPub, revocable), planNow)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Expired) != 1 || p.Expired[0] != revocable.st {
		t.Errorf("offered for revocation: %+v", p.Expired)
	}
}
```

Append to `mobile/sessions_test.go`:

```go
func TestBridgeReadsTheRequestFromItsURL(t *testing.T) {
	key := secp256k1.GenPrivKey()
	// The mirrored fields say something else: only URL counts.
	req := &SessionRequest{URL: signedConnect(t, key), PubKey: crypto.PubKeyToBech32(secp256k1.GenPrivKey().PubKey()),
		AllowJSON: `["*"]`, Spend: "1000000000ugnot", State: "forged"}
	r, err := coreSessionRequest(req)
	if err != nil {
		t.Fatal(err)
	}
	if r.PubKey != crypto.PubKeyToBech32(key.PubKey()) || r.State != "s1" || r.Spend != "5000000ugnot" || len(r.Allow) != 2 {
		t.Errorf("request = %+v", r)
	}
}
```

- [ ] **Step 2: Run them**

Run: `go test ./core/ -run KeylessExpired -v && go test ./mobile/ -run ReadsTheRequestFromItsURL -v`
Expected: PASS — both pin behaviour P2-M1 already has (the review found them untested). Check each can fail: drop `&& st.PubKey != ""` from `planSessionRequest`, and make `coreSessionRequest` overwrite `r.PubKey` with `req.PubKey`, run, watch them fail, restore.

- [ ] **Step 3: Skip the old lifecycle test where its realm is missing**

In `core/integration_test.go`, `TestIntegrationSessionLifecycle`, right after the `LatestBlockHeight` check:

```go
	// This test calls gno.land/r/demo/counter, which a gnodev loading only
	// Bubble Rumble's devchain/ (npm run gnodev) does not have.
	if data, err := svc.abciQuery("vm/qfile", []byte("gno.land/r/demo/counter")); err != nil || len(data) == 0 {
		t.Skipf("gno.land/r/demo/counter is not deployed here (%v)", err)
	}
```

- [ ] **Step 4: Run the whole integration target**

Run (gnodev up): `make test.integration`
Expected: PASS; `TestIntegrationSessionLifecycle` reports SKIP on the devchain gnodev.

- [ ] **Step 5: Commit**

```bash
gofmt -w core/integration_test.go core/gnoconnect_plan_test.go mobile/sessions_test.go
go vet ./... && go vet -tags integration ./... && go test ./core/... ./mobile/...
git add core/integration_test.go core/gnoconnect_plan_test.go mobile/sessions_test.go
git commit -m "test(sessions): pin keyless expired sessions and the bridge's URL; skip the counter test without its realm"
```

---

## After this milestone

- `make build.android` once (no new surface, but the bridge's errors changed).
- Spec §9: move the P2-M1 deferred minors to "Réglé", noting the native contract (`replayed`, `already_done`, `wrong_network` are never answered; what each one asks native code to do).
- Then the P2-M2 (iOS) and P2-M3 (Android) plans, from the bridge as it is.
