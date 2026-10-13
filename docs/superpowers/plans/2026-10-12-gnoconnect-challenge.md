# GnoConnect `connect` + `challenge` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reserve a gno.world name from the app with gnokey-mobile: the app asks for a proof with `connect?challenge=…`, gnokey-mobile has the identity's key sign it on the computer through gnokey-pair (`gnokey sign-data`), and gno.world accepts it unchanged.

**Architecture:** The proof is the document of Adena's `SignArbitrary`, built and checked by `std.SignDataPayload` / `std.VerifySignData` (already on gno `feat/gnokey-sign-data`, 38723ce23). The GnoConnect standard gains `challenge` on `connect`; gnokey-pair gains a request kind `data` that runs `gnokey sign-data`; gnokey-mobile's Go core builds that request and checks the proof, its iOS and Android apps show the phrase and answer the callback; the app follows the site's sequence (`POST {name, addr}` → 409 → challenge → wallet → `POST {name, doc, sig, pub, addr}`).

**Tech Stack:** Go 1.25 (gno, gnokey-pair, gnokey-mobile core/mobile, gomobile), Swift/SwiftUI (iOS), Kotlin/Compose (Android), TypeScript/React Native/Expo SDK 57, zustand, jest, Node 22 (fake server).

**Spec:** `docs/superpowers/specs/2026-10-12-gnoconnect-challenge-design.md`

## Global Constraints

- The signed document is exactly `std.SignDataPayload(chainID, identity, challenge)`: ADR-036 `sign/MsgSignData`, `chain_id` kept, `account_number`/`sequence`/`gas` `"0"`, `fee.amount` `[]`, `memo` `""`.
- The identity (master key) signs, never a session key.
- `challenge`: non-empty UTF-8, at most 4096 bytes, no control character (C0, DEL, C1 — Go's `unicode.IsControl`); otherwise `invalid_request`.
- A `connect` with both `pubkey` and `challenge` is `invalid_request`, on both transports.
- Link reply: `signed` = base64url (no padding) of the canonical signed bytes; `signature` = base64url (no padding) of 64 bytes `R‖S`; `pubkey` = the identity's gpub, required with a challenge; no `session`; `features` includes `challenge`.
- With a challenge, the wallet always asks the user, and shows the callback host, the identity, the network, the whole phrase and "nothing goes on chain".
- gno.world's `POST /api/name` proof: `doc` = the canonical JSON (sorted keys, no spaces, `<>&` escaped), `sig` base64 (std), `pub` base64 (std) of the 33-byte compressed key, `addr` the identity.
- Wallet repos stay dapp-neutral: no `gno.world`, `bubblerumble` or dapp name in gnokey-mobile, gnokey-pair or the standard; use `exampledapp://session-callback`, `https://example.com/cb`, `example.com`.
- Nothing is pushed without the user's go-ahead (every repo). Commits are local.
- App repo: `npx expo lint` (zero errors and warnings) and `npx tsc --noEmit` before calling a task done.
- No automatic test POSTs to production (parent spec §5.7).

## Review Focus

1. **A challenge with characters a URL mangles** (`·`, spaces, `+`, `&`, `%`, emoji) must reach the computer and the proof byte for byte: the proof's data equals the phrase gno.world handed out. → Task 3 (`TestParseChallengeDecodesStrictly`), Task 6 (`buildChallengeLink` round trip).
2. **The user picks another account in the wallet than the one the app pinned** (`signer`): the app must not send a proof for another address to the server; it says which account the wallet proved. → Task 7 (`a proof for another account is not sent`).
3. **A wallet without `challenge` support** answers `success` with no `signed`: the app must not loop, must not POST, and must point to the boop path. → Task 7 (`a wallet that cannot prove says how to boop instead`).
4. **The wallet answers after the app forgot the request** (app killed, second reservation started): an unknown `state` is not the chat's; the session store gets it and ignores it, nothing crashes. → Task 7 (`a reply with another state is not the chat's`).
5. **The server refuses after the signature** (the wallet already holds a name, the name is taken): its words reach the sheet, no key is saved, `proving` is cleared so the user can try another name. → Task 7 (`a refusal after the signature is the sheet's error`).

---

## Repositories and branches

| Repo | Path | Branch | Base |
|---|---|---|---|
| gno (standard, launch links) | `~/gno-external-wallets` | `feat/gnoconnect-external-wallets` | as is (PR #5970) |
| gno (standard, in-page) | `~/gno-inpage-wallets` | `feat/gnoconnect-in-page-wallets` | rebased on the above (PR #6016) |
| gno (gnokey-pair) | `~/gno-gnokey-pair` | `feat/gnokey-pair` | rebased on `feat/gnokey-sign-data` |
| gnokey-mobile | `~/gnokey-mobile` | `feat/send-to-computer` | as is |
| app | `~/bubblerumble` | `main` | as is |

All four gno paths are worktrees of one repository (`git -C ~/gno worktree list`).

---

### Task 1: The standard — `challenge` on `connect` (launch links, then in-page)

**Files:**
- Modify: `~/gno-external-wallets/docs/resources/gnoconnect.md` (`### \`connect\``, ~lines 475–528; `#### Parameters` of Sessions)
- Modify (after rebase): `~/gno-inpage-wallets/docs/resources/gnoconnect.md` (`### \`provider\``, `#### Optional methods`, `### Sessions in the browser` `GnoConnectOptions`)

**Interfaces:**
- Produces: the wire contract every later task follows (Global Constraints).

- [ ] **Step 1: Launch links — request line and parameter**

In `### \`connect\` — request the user's identity`, replace the request block with:

```
<scheme>://connect?callback=<url>&state=<token>&rpc=<rpc>&chainid=<chainid>&challenge=<text>&signer=<bech32>
```

and add after the paragraph on scope hints and `pubkey`:

```markdown
A `connect` may carry a **`challenge`**: a text the producer's backend handed
out, which the identity signs to prove it controls the address (see Proving the
identity below). Without it, a `connect` proves nothing.
```

- [ ] **Step 2: Launch links — the reply and `features`**

Replace the success line of the reply block with:

```
<callback>?status=success&address=<bech32>&session=<bech32>&pubkey=<gpub>&chainid=<id>&features=<tokens>&signed=<base64url>&signature=<base64url>&state=<echoed>
```

In the `features` paragraph, after `sessions (…)`, add: ``and `challenge` (signs a `challenge`: see Proving the identity)``.

- [ ] **Step 3: Launch links — "Proving the identity"**

Replace the paragraph starting "The returned identity is **display-level**." (ends "…a backend able to verify one.") with:

```markdown
Without a `challenge` the returned identity is **display-level**: it proves
nothing about control of the address, so treat it as the user stating who they
are. Authority comes from the on-chain `tx` the user reviews and signs.

#### Proving the identity: `challenge`

`challenge` is a text the producer's backend chose: non-empty UTF-8, at most
4096 bytes, no control character (C0, DEL or C1, as Go's `unicode.IsControl`
defines them). Anything else is `invalid_request`. A `connect` naming a key
(`pubkey`) **and** carrying a `challenge` is `invalid_request` too: a `connect`
either asks for a session or proves the identity, so the identity never signs
twice in one exchange.

The **identity** signs — never a session key, whose signature proves nothing
about the address — this document, with `chain_id` the chain of the answer:

    {"account_number":"0","chain_id":"<chainid>","fee":{"amount":[],"gas":"0"},"memo":"",
     "msgs":[{"type":"sign/MsgSignData","value":{"data":"<base64 of the challenge>","signer":"<address>"}}],
     "sequence":"0"}

The bytes signed are that JSON sorted by key, without spaces, with `<`, `>` and
`&` escaped as `<`, `>`, `&`: the document Adena's
`SignArbitrary` signs (ADR-036's off-chain message, chain id kept so a proof made
on one network is none on another). No node decodes `sign/MsgSignData`, so the
document can never be broadcast as a transaction. gno's `std.SignDataPayload`
builds these bytes and `std.VerifySignData` checks a proof; `gnokey sign-data`
signs one.

The reply carries `signed`, the bytes signed, and `signature`, 64 bytes `R‖S`,
both base64url without padding, and `pubkey`, the identity's key, which is then
required. It carries no `session`. With a `challenge` the wallet asks the user
every time, and shows the callback host, the identity, the network, the whole
text and that nothing goes on chain.

A wallet that does not know `challenge` ignores it (Forward compatibility) and
answers without `signed` and `signature`: the producer is proven only when the
reply carries them, and otherwise falls back to another way rather than asking
again. `challenge` in `features` says the wallet signs one.

The producer makes the challenge (fresh, single use, naming its own domain),
checks the signature against `pubkey`, that `pubkey`'s address is `address`, and
the chain id, and refuses a chain it did not expect.
```

- [ ] **Step 4: Launch links — Sessions parameters**

In `#### Parameters` (Sessions), add one bullet:

```markdown
- `challenge` is never part of a `connect` naming a key: such a request is
  `invalid_request` (see Proving the identity).
```

- [ ] **Step 5: Commit the launch-link part**

```bash
cd ~/gno-external-wallets
git add docs/resources/gnoconnect.md
git commit -m "docs(gnoconnect): prove the identity with connect + challenge"
```

- [ ] **Step 6: Rebase the in-page branch**

```bash
cd ~/gno-inpage-wallets
git branch backup/inpage-before-challenge
git rebase feat/gnoconnect-external-wallets
```

Expected: clean, or conflicts only in `docs/resources/gnoconnect.md` (resolve by keeping both sides' text).

- [ ] **Step 7: In-page — options, account and review**

In `GnoConnectOptions` add:

```ts
  challenge?: string;  // proves the identity: see Proving the identity; never with pubkey
```

Replace `interface GnoAccount { … }` with:

```ts
interface GnoAccount {
  address: string;         // bech32
  chainid: string;         // the chain this answer was given against
  pubkey: string | null;   // gpub, when the wallet exposes one; set with a proof
  features?: string[];     // as the launch link's `features`
  proof?: {                // with a challenge: what the identity signed
    signed: TxSignPayload; // the document, as an object (Adena's SignArbitrary `signed`)
    signature: string;     // base64, 64 bytes R‖S
  };
}
```

After "**`connect` on an already-approved origin MUST resolve without prompting,**…", add:

```markdown
A `connect` carrying a `challenge` is the other exception: it always prompts,
since what the user approves is a signature, not an origin.
```

Replace the paragraph "Message signing is deliberately absent. …" with:

```markdown
Proving the identity goes through `connect` with a `challenge` (see Proving the
identity), on both transports. Signing an arbitrary statement stays outside
this standard: everything else signable in Gno is a transaction.
```

- [ ] **Step 8: Commit the in-page part**

```bash
cd ~/gno-inpage-wallets
git add docs/resources/gnoconnect.md
git commit -m "docs(gnoconnect): challenge in the browser — connect({challenge}) and GnoAccount.proof"
```

No push (Global Constraints).

---

### Task 2: gnokey-pair — the `data` request (sign a phrase with `gnokey sign-data`)

**Files:**
- Modify: `~/gno-gnokey-pair/contribs/gnokey-pair/protocol/protocol.go`
- Create: `~/gno-gnokey-pair/contribs/gnokey-pair/data.go`
- Create: `~/gno-gnokey-pair/contribs/gnokey-pair/data_test.go`
- Modify: `~/gno-gnokey-pair/contribs/gnokey-pair/keys.go` (keybase interface, `gnokeyBin`)
- Modify: `~/gno-gnokey-pair/contribs/gnokey-pair/run.go` (`versions`, `run`, `process`)
- Modify: `~/gno-gnokey-pair/contribs/gnokey-pair/run_test.go` (`fakeKeys`)

**Interfaces:**
- Consumes: `std.SignDataPayload(chainID string, signer crypto.Address, data string) ([]byte, error)`, `std.VerifySignData(doc []byte, pub crypto.PubKey, sig []byte) (std.SignedData, error)` (`std.SignedData{ChainID string; Signer crypto.Address; Data string}`).
- Produces (package `protocol`): `KindData = "data"`, `MaxDataSize = 4096`, `Request.Data string` (`json:"data,omitempty"`), `Result.Proof json.RawMessage` (`json:"proof,omitempty"`) — the JSON `gnokey sign-data` writes: `{"signed": {…}, "signature": {"pubKey": {"typeUrl": "/tm.PubKeySecp256k1", "value": "<base64>"}, "signature": "<base64>"}}`.

- [ ] **Step 1: Rebase on `feat/gnokey-sign-data`**

```bash
cd ~/gno-gnokey-pair
git status --short   # only docs/superpowers/plans/ untracked; leave it
git branch backup/gnokey-pair-before-sign-data
git rebase feat/gnokey-sign-data
cd contribs/gnokey-pair && go test ./... 2>&1 | tail -5
```

Expected: rebase clean; tests pass.

- [ ] **Step 2: Protocol fields**

In `protocol/protocol.go`, in the const block add:

```go
	KindData = "data" // a text for the identity to sign with gnokey sign-data
```

after `MaxTxSize`:

```go
// MaxDataSize bounds Request.Data, as GnoConnect bounds a challenge.
const MaxDataSize = 4096
```

In `Request`, after `Tx`:

```go
	Data      string          `json:"data,omitempty"`        // KindData: the text to sign
```

In `Result`, after `Manual`:

```go
	Proof    json.RawMessage `json:"proof,omitempty"`    // data: gnokey sign-data's output, checked
```

- [ ] **Step 3: Write the failing tests**

Create `data_test.go`:

```go
package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/gnolang/gno/contribs/gnokey-pair/protocol"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/std"
)

const testPhrase = "example.com: prove this wallet is yours · 9UQV & +"

func dataRequestJSON(t *testing.T, edit func(*protocol.Request)) []byte {
	t.Helper()
	r := protocol.Request{
		Kind: protocol.KindData, ChainID: "test-chain", Signer: signerAddr.String(), Data: testPhrase,
		Requester: &protocol.Requester{Name: "Gnokey Mobile", For: "example.com"},
	}
	if edit != nil {
		edit(&r)
	}
	b, err := json.Marshal(r)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// proofJSON is what gnokey sign-data writes for data, signed by key.
func proofJSON(t *testing.T, key crypto.PrivKey, chainID string, signer crypto.Address, data string) []byte {
	t.Helper()
	payload, err := std.SignDataPayload(chainID, signer, data)
	if err != nil {
		t.Fatal(err)
	}
	sig, err := key.Sign(payload)
	if err != nil {
		t.Fatal(err)
	}
	pub := key.PubKey().(secp256k1.PubKeySecp256k1)
	out, _ := json.Marshal(map[string]any{
		"signed": json.RawMessage(payload),
		"signature": map[string]any{
			"pubKey":    map[string]string{"typeUrl": "/tm.PubKeySecp256k1", "value": base64.StdEncoding.EncodeToString(pub[:])},
			"signature": base64.StdEncoding.EncodeToString(sig),
		},
	})
	return out
}

func TestParseDataRequest(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		edit func(*protocol.Request)
		want string // substring of the detail; empty means valid
	}{
		{"valid", nil, ""},
		{"no chain", func(r *protocol.Request) { r.ChainID = "" }, "missing chainid"},
		{"bad signer", func(r *protocol.Request) { r.Signer = "g1nope" }, "signer"},
		{"no data", func(r *protocol.Request) { r.Data = "" }, "no text to sign"},
		{"too long", func(r *protocol.Request) { r.Data = strings.Repeat("a", protocol.MaxDataSize+1) }, "exceeds"},
		{"control character", func(r *protocol.Request) { r.Data = "a\nb" }, "control character"},
		{"invalid UTF-8", func(r *protocol.Request) { r.Data = "\xff" }, "UTF-8"},
		{"a tx too", func(r *protocol.Request) { r.Tx = json.RawMessage(`{}`) }, "carries a transaction"},
		{"offline", func(r *protocol.Request) { r.Offline = true }, "offline"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := parseDataRequest(dataRequestJSON(t, c.edit))
			switch {
			case c.want == "" && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case c.want != "" && (err == nil || !strings.Contains(err.Error(), c.want)):
				t.Fatalf("got %v, want %q", err, c.want)
			}
		})
	}
}

func TestVerifyProof(t *testing.T) {
	t.Parallel()
	req, err := parseDataRequest(dataRequestJSON(t, nil))
	if err != nil {
		t.Fatal(err)
	}
	good := proofJSON(t, signerKey, "test-chain", signerAddr, testPhrase)
	if err := verifyProof(good, req); err != nil {
		t.Fatalf("a good proof: %v", err)
	}
	for name, proof := range map[string][]byte{
		"another key":    proofJSON(t, otherKey, "test-chain", otherAddr, testPhrase),
		"another chain":  proofJSON(t, signerKey, "other-chain", signerAddr, testPhrase),
		"another phrase": proofJSON(t, signerKey, "test-chain", signerAddr, "something else"),
		"not JSON":       []byte("{"),
	} {
		if verifyProof(proof, req) == nil {
			t.Errorf("%s: accepted", name)
		}
	}
}

func TestPipelineData(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name   string
		edit   func(*pipelineCase)
		status string
		code   string
	}{
		{name: "signed", status: protocol.StatusSuccess},
		{name: "declined", edit: func(c *pipelineCase) { c.answers = "\n" }, status: protocol.StatusCancelled},
		{name: "gnokey signs with another key", edit: func(c *pipelineCase) { c.keys.key = otherKey },
			status: protocol.StatusError, code: protocol.CodeTxFailed},
		{name: "signer not in keybase", edit: func(c *pipelineCase) { c.keys.keys = nil },
			status: protocol.StatusError, code: protocol.CodeSignerUnavailable},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			pc := newPipelineCase()
			pc.node.chainID, pc.node.acc = "never-asked", nil // a data request touches no node
			if c.edit != nil {
				c.edit(pc)
			}
			res, out := pc.serve(t, context.Background(), dataRequestJSON(t, nil))
			if res.Status != c.status || res.Code != c.code {
				t.Fatalf("got %s/%s, want %s/%s\n%s", res.Status, res.Code, c.status, c.code, out)
			}
			if c.status != protocol.StatusSuccess {
				return
			}
			if !strings.Contains(out, testPhrase) || !strings.Contains(out, "nothing goes on chain") {
				t.Errorf("the review does not show the phrase:\n%s", out)
			}
			req, _ := parseDataRequest(dataRequestJSON(t, nil))
			if err := verifyProof(res.Proof, req); err != nil {
				t.Errorf("the returned proof: %v", err)
			}
		})
	}
}

func TestPipelineDataByHand(t *testing.T) {
	t.Parallel()
	pc := newPipelineCase()
	var out lockedBuffer
	p := pc.pairing(strings.NewReader("y\n"), &out)
	p.cfg.manual = true
	p.cfg.timeout = 3 * time.Second
	done := make(chan protocol.Result, 1)
	go func() {
		res, _ := p.serve(context.Background(), dataRequestJSON(t, nil), "aardvark adroitness")
		done <- res
	}()
	path := waitForOutputPath(t, &out) // the -output-document of the printed command
	if err := writeFile(path, proofJSON(t, signerKey, "test-chain", signerAddr, testPhrase)); err != nil {
		t.Fatal(err)
	}
	res := <-done
	if res.Status != protocol.StatusSuccess || len(res.Proof) == 0 {
		t.Fatalf("got %+v\n%s", res, out.String())
	}
	if !bytes.Contains([]byte(out.String()), []byte("gnokey sign-data -chainid test-chain -data-path ")) {
		t.Errorf("no gnokey sign-data command:\n%s", out.String())
	}
}
```

Add to `run_test.go`, next to `fakeKeys.Sign`:

```go
func (k *fakeKeys) CanSignData(context.Context) bool { return true }

func (k *fakeKeys) SignData(_ context.Context, dataPath, chainID, signer, outPath string) error {
	k.signed++
	if k.signErr != nil {
		return k.signErr
	}
	data, err := os.ReadFile(dataPath)
	if err != nil {
		return err
	}
	addr, err := crypto.AddressFromBech32(signer)
	if err != nil {
		return err
	}
	// gnokey signs with the key it holds: when that is another key, the
	// document names that key's address, as gnokey sign-data does.
	if k.key.PubKey().Address() != addr {
		addr = k.key.PubKey().Address()
	}
	payload, err := std.SignDataPayload(chainID, addr, string(data))
	if err != nil {
		return err
	}
	sig, err := k.key.Sign(payload)
	if err != nil {
		return err
	}
	pub := k.key.PubKey().(secp256k1.PubKeySecp256k1)
	out, _ := json.Marshal(map[string]any{
		"signed": json.RawMessage(payload),
		"signature": map[string]any{
			"pubKey":    map[string]string{"typeUrl": "/tm.PubKeySecp256k1", "value": base64.StdEncoding.EncodeToString(pub[:])},
			"signature": base64.StdEncoding.EncodeToString(sig),
		},
	})
	return os.WriteFile(outPath, out, 0o600)
}
```

(adding the imports `encoding/json` and `github.com/gnolang/gno/tm2/pkg/crypto/secp256k1` to `run_test.go`), and to `helpers_test.go`:

```go
// waitForOutputPath waits for the by-hand command and returns its -output-document.
func waitForOutputPath(t *testing.T, out *lockedBuffer) string {
	t.Helper()
	re := regexp.MustCompile(`-output-document (\S+)`)
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if m := re.FindStringSubmatch(out.String()); m != nil {
			return m[1]
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("no -output-document in:\n%s", out.String())
	return ""
}

func writeFile(path string, b []byte) error { return os.WriteFile(path, b, 0o600) }
```

(with `os`, `regexp` imports in `helpers_test.go`).

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd ~/gno-gnokey-pair/contribs/gnokey-pair && go test -run 'Data|VerifyProof' ./...`
Expected: build failure — `undefined: parseDataRequest`, `verifyProof`, `fakeKeys does not implement keybase`… only once the interface changes; at this step, `undefined: parseDataRequest`.

- [ ] **Step 5: The keybase**

In `keys.go`, extend the interface (`type keybase interface` near the top) with:

```go
	// CanSignData says whether this gnokey has sign-data.
	CanSignData(ctx context.Context) bool
	// SignData has gnokey sign the text in dataPath, writing the proof to outPath.
	SignData(ctx context.Context, dataPath, chainID, signer, outPath string) error
```

and implement on `gnokeyBin`:

```go
func (g *gnokeyBin) CanSignData(ctx context.Context) bool {
	out, _ := g.command(ctx, "sign-data", "-h").CombinedOutput() // -h exits non-zero
	return strings.Contains(string(out), "sign-data [flags]")
}

func (g *gnokeyBin) SignData(ctx context.Context, dataPath, chainID, signer, outPath string) error {
	cmd := g.command(ctx, "sign-data", "-chainid", chainID, "-data-path", dataPath, "-output-document", outPath, signer)
	var stderr bytes.Buffer
	cmd.Stdin, cmd.Stdout, cmd.Stderr = g.stdin, g.stdout, io.MultiWriter(g.stderr, &stderr)
	if err := cmd.Run(); err != nil {
		if strings.Contains(stderr.String(), "not found") {
			return fmt.Errorf("%w: %s", errKeyNotFound, signer)
		}
		return fmt.Errorf("gnokey sign-data: %w", err)
	}
	return nil
}
```

- [ ] **Step 6: `data.go`**

```go
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/gnolang/gno/contribs/gnokey-pair/protocol"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// A data request asks the identity to sign a text — a service's challenge — to
// prove it controls the address. gnokey sign-data signs it; nothing goes on
// chain, so no node is needed.

// dataRequest is a data request that passed validation.
type dataRequest struct {
	protocol.Request
	signer crypto.Address
}

func parseDataRequest(raw []byte) (*dataRequest, error) {
	invalid := func(format string, args ...any) error {
		return failf(protocol.CodeInvalidRequest, format, args...)
	}
	var r dataRequest
	if err := json.Unmarshal(raw, &r.Request); err != nil {
		return nil, invalid("malformed request: %v", err)
	}
	switch {
	case r.Kind != protocol.KindData:
		return nil, invalid("unsupported kind %q", r.Kind)
	case r.ChainID == "":
		return nil, invalid("missing chainid")
	case len(r.Request.Tx) > 0:
		return nil, invalid("a data request carries a transaction")
	case r.Offline:
		return nil, invalid("a data request is never offline: it needs no network anyway")
	case r.Data == "":
		return nil, invalid("no text to sign")
	case len(r.Data) > protocol.MaxDataSize:
		return nil, invalid("a text of %d bytes exceeds %d", len(r.Data), protocol.MaxDataSize)
	case !utf8.ValidString(r.Data):
		return nil, invalid("the text is not UTF-8")
	case strings.IndexFunc(r.Data, unicode.IsControl) >= 0:
		return nil, invalid("the text has a control character")
	}
	signer, err := crypto.AddressFromBech32(r.Signer)
	if err != nil {
		return nil, invalid("signer: %v", err)
	}
	r.signer = signer
	return &r, nil
}

// kindOf reads a request's kind before it is parsed for that kind.
func kindOf(raw []byte) string {
	var k struct{ Kind string }
	json.Unmarshal(raw, &k)
	return k.Kind
}

func (p *pairing) processData(ctx context.Context, raw []byte, words string) (*protocol.Result, error) {
	req, err := parseDataRequest(raw)
	if err != nil {
		return nil, err
	}
	key, err := p.findKey(ctx, req.signer)
	if err != nil {
		return nil, err
	}
	p.printf("\n")
	renderData(p, req, key, words)

	question := "Sign? [y/N] "
	if p.cfg.manual {
		question = "Approve and print the gnokey command? [y/N] "
	}
	ok, err := p.ask(ctx, question)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, errCancelled
	}

	dir, err := os.MkdirTemp("", "gnokey-pair-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(dir)
	dataPath, outPath := filepath.Join(dir, "data.txt"), filepath.Join(dir, "proof.json")
	if err := os.WriteFile(dataPath, []byte(req.Data), 0o600); err != nil {
		return nil, err
	}

	var proof []byte
	if p.cfg.manual {
		cmd := p.gnokeyCommand("sign-data")
		if p.cfg.home != "" {
			cmd = append(cmd, "-home", p.cfg.home)
		}
		cmd = append(cmd, "-chainid", req.ChainID, "-data-path", dataPath, "-output-document", outPath, req.signer.String())
		p.printf("\nRun this in another terminal; gnokey-pair then sends the proof to your phone.\n\n%s\n\nWaiting for the proof (at most %s, Ctrl-C to cancel)...\n", shellJoin(cmd), p.cfg.timeout)
		if proof, err = waitProof(ctx, outPath, p.cfg.timeout); err != nil {
			return nil, err
		}
	} else {
		if key != nil && key.Type == "ledger" {
			p.printf("Confirm on the Ledger.\n")
		}
		err = p.keys.SignData(ctx, dataPath, req.ChainID, req.signer.String(), outPath)
		switch {
		case errors.Is(err, errKeyNotFound):
			return nil, failf(protocol.CodeSignerUnavailable, "%v", err)
		case err != nil:
			return nil, failf(protocol.CodeTxFailed, "%v", err)
		}
		if proof, err = os.ReadFile(outPath); err != nil {
			return nil, err
		}
	}
	if err := verifyProof(proof, req); err != nil {
		return nil, failf(protocol.CodeTxFailed, "gnokey produced something else than what you approved, so nothing is sent: %v", err)
	}
	return &protocol.Result{Status: protocol.StatusSuccess, Proof: json.RawMessage(proof)}, nil
}

func renderData(p *pairing, req *dataRequest, key *keyInfo, words string) {
	var b strings.Builder
	b.WriteString("gnokey-pair: request from your phone\n")
	fmt.Fprintf(&b, "Check words:  %s      (compare with the phone; stop if they differ)\n\n", strings.Join(strings.Fields(words), "  "))
	switch rq := req.Requester; {
	case rq == nil || rq.Name == "" && rq.For == "":
		line(&b, topColumn, "Requester", "not stated")
	case rq.For == "":
		line(&b, topColumn, "Requester", "%s   (claimed, not verified)", quote(rq.Name))
	default:
		line(&b, topColumn, "Requester", "%s for %s   (claimed, not verified)", quote(rq.Name), quote(rq.For))
	}
	line(&b, topColumn, "Network", "%s", esc(req.ChainID))
	signer := req.signer.String()
	if key != nil {
		signer += "  " + quote(key.Name)
		if key.Type == "ledger" {
			signer += " (Ledger: confirm on the device)"
		}
	}
	line(&b, topColumn, "Signer", "%s", signer)
	line(&b, topColumn, "Action", "sign this text to prove the address is yours; nothing goes on chain")
	b.WriteString("\n")
	line(&b, topColumn, "Text", "%s", quote(req.Data))
	b.WriteString("\n")
	p.printf("%s", b.String())
}

// proofOutput is gnokey sign-data's output (Adena's SignArbitrary answer).
type proofOutput struct {
	Signed    json.RawMessage `json:"signed"`
	Signature struct {
		PubKey struct {
			TypeURL string `json:"typeUrl"`
			Value   string `json:"value"`
		} `json:"pubKey"`
		Signature string `json:"signature"`
	} `json:"signature"`
}

// verifyProof checks what gnokey wrote: the request's signer signed the
// request's text on the request's chain.
func verifyProof(proof []byte, req *dataRequest) error {
	var o proofOutput
	if err := json.Unmarshal(proof, &o); err != nil {
		return fmt.Errorf("unreadable proof: %w", err)
	}
	if o.Signature.PubKey.TypeURL != "/tm.PubKeySecp256k1" {
		return fmt.Errorf("a %q key, not secp256k1", o.Signature.PubKey.TypeURL)
	}
	raw, err := base64.StdEncoding.DecodeString(o.Signature.PubKey.Value)
	if err != nil || len(raw) != secp256k1.PubKeySecp256k1Size {
		return errors.New("an unreadable public key")
	}
	var pub secp256k1.PubKeySecp256k1
	copy(pub[:], raw)
	sig, err := base64.StdEncoding.DecodeString(o.Signature.Signature)
	if err != nil {
		return errors.New("an unreadable signature")
	}
	signed, err := std.VerifySignData(o.Signed, pub, sig)
	switch {
	case err != nil:
		return err
	case signed.Signer != req.signer:
		return fmt.Errorf("signed by %s instead of %s", signed.Signer, req.signer)
	case signed.ChainID != req.ChainID:
		return fmt.Errorf("signed for %s instead of %s", signed.ChainID, req.ChainID)
	case signed.Data != req.Data:
		return errors.New("another text was signed")
	}
	return nil
}

// waitProof waits for path to hold a proof. A half-written file does not
// decode, so it is read again at the next poll.
func waitProof(ctx context.Context, path string, timeout time.Duration) ([]byte, error) {
	wctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	tick := time.NewTicker(signedPoll)
	defer tick.Stop()
	for {
		var o proofOutput
		if bz, err := os.ReadFile(path); err == nil && json.Unmarshal(bz, &o) == nil && len(o.Signed) > 0 {
			return bz, nil
		}
		select {
		case <-wctx.Done():
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return nil, failf(protocol.CodeTxFailed, "no proof in %s after %s", path, timeout)
		case <-tick.C:
		}
	}
}
```

- [ ] **Step 7: Route data requests and announce the kind**

In `run.go`, at the top of `process`:

```go
	if kindOf(raw) == protocol.KindData {
		return p.processData(ctx, raw, words)
	}
```

In `run`, replace `wormhole.Config{RelayURL: p.cfg.relay, Versions: protocol.AppVersions(versions)}` with a copy that announces `data` only when gnokey can sign it:

```go
	v := versions
	v.Kinds = slices.Clone(versions.Kinds)
	if p.keys.CanSignData(ctx) {
		v.Kinds = append(v.Kinds, protocol.KindData)
	} else {
		p.printf("note: this gnokey has no sign-data, so the phone cannot ask it to sign a text\n")
	}
	ch, err := wormhole.Allocate(actx, wormhole.Config{RelayURL: p.cfg.relay, Versions: protocol.AppVersions(v)})
```

(import `slices`).

- [ ] **Step 8: Run the tests**

Run: `cd ~/gno-gnokey-pair/contribs/gnokey-pair && go test ./... 2>&1 | tail -5`
Expected: PASS (data tests and every existing test).

- [ ] **Step 9: Lint and commit**

```bash
cd ~/gno-gnokey-pair && go run -modfile ./misc/devdeps/go.mod github.com/golangci/golangci-lint/v2/cmd/golangci-lint run --config .github/golangci.yml ./contribs/gnokey-pair/... 2>&1 | tail -5
git add contribs/gnokey-pair
git commit -m "feat(gnokey-pair): sign a text with gnokey sign-data, for the phone to prove an identity"
```

Expected lint: `0 issues.` (if the lint config does not reach the contribs module, run it from `contribs/gnokey-pair` with `-modfile ../../misc/devdeps/go.mod`).

- [ ] **Step 10: Manual check with the real gnokey**

```bash
cd ~/gno && go install ./gno.land/cmd/gnokey   # the sign-data gnokey, in $GOBIN
cd ~/gno-gnokey-pair/contribs/gnokey-pair && go run . -h 2>&1 | head -5
```

Expected: `gnokey sign-data -h` in `$GOBIN/gnokey` prints `sign-data [flags]`. The end-to-end pairing run is in Task 8.

---

### Task 3: gnokey-mobile core — read the challenge, send it, check the proof

**Files:**
- Modify: `~/gnokey-mobile/go.mod`, `go.sum` (gno and gnokey-pair versions)
- Create: `~/gnokey-mobile/core/gnoconnect_challenge.go`
- Create: `~/gnokey-mobile/core/gnoconnect_challenge_test.go`
- Modify: `~/gnokey-mobile/core/gnoconnect_request.go` (`ParseSessionRequest`)
- Modify: `~/gnokey-mobile/core/pair.go` (`DialPair` versions, `CanSignData`)
- Modify: `~/gnokey-mobile/mobile/pair.go` (`SendData`, `PairResult.Proof`, `ConnectProof`, `VerifyProof`)
- Modify: `~/gnokey-mobile/mobile/sessions.go` (`ParseChallenge`)
- Test: `~/gnokey-mobile/mobile/pair_test.go`

**Interfaces:**
- Consumes: Task 2's `protocol.KindData`, `Request.Data`, `Result.Proof`; `std.SignDataPayload`, `std.VerifySignData`.
- Produces (package `core`):
  - `func ParseChallenge(rawURL string) (string, error)` — `""` when the link has none; `CodeInvalidRequest` when bad or with `pubkey`.
  - `func ValidateChallenge(s string) error`
  - `func (s *Service) DataPairRequest(identity, challenge, callback string) (protocol.Request, error)`
  - `func (p *Pairing) CanSignData() error` — `CodePairUnsupported` when the peer lacks `data`.
  - `type ConnectProof struct { Signed, Signature, PubKey string }` (base64url, base64url, gpub)
  - `func VerifyProof(proof []byte, identity, chainID, challenge string) (*ConnectProof, error)` — `CodeSignerUnavailable` on any mismatch.
- Produces (package `mobile`, gomobile):
  - `func (b *Bridge) ParseChallenge(url string) (string, error)`
  - `func (p *Pairing) SendData(identity, challenge, callback string) error`
  - `PairResult.Proof string`
  - `type ConnectProof struct { Signed, Signature, PubKey string }`
  - `func (b *Bridge) VerifyProof(proof, identity, challenge string) (*ConnectProof, error)` — the chain is the wallet's network.

- [ ] **Step 1: Checkpoint — publish the gno branches (user's go-ahead)**

gnokey-mobile builds against published module versions. Ask the user: "To build gnokey-mobile against `std.VerifySignData` and the `data` kind, I need to push `feat/gnokey-sign-data` and the rebased `feat/gnokey-pair` (force-with-lease, it was rebased) to origin (D4ryl00/gno). Push?" Wait for a yes, then:

```bash
cd ~/gno && git push -u origin feat/gnokey-sign-data
cd ~/gno-gnokey-pair && git push --force-with-lease origin feat/gnokey-pair
```

- [ ] **Step 2: Bump the modules**

```bash
cd ~/gnokey-mobile
SD=$(git -C ~/gno rev-parse --short=12 feat/gnokey-sign-data)
GP=$(git -C ~/gno-gnokey-pair rev-parse --short=12 feat/gnokey-pair)
go mod edit -replace github.com/gnolang/gno=github.com/D4ryl00/gno@$SD
go mod edit -replace github.com/gnolang/gno/contribs/gnokey-pair=github.com/D4ryl00/gno/contribs/gnokey-pair@$GP
GOFLAGS=-mod=mod go mod tidy
go build ./... && go test ./core/... ./mobile/... 2>&1 | tail -5
```

Expected: builds; existing tests pass. Commit:

```bash
git add go.mod go.sum
git commit -m "build: gno with sign-data, gnokey-pair with the data kind"
```

- [ ] **Step 3: Write the failing core tests**

`core/gnoconnect_challenge_test.go`:

```go
package core

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"

	"github.com/gnolang/gno/contribs/gnokey-pair/protocol"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/std"
)

const testChallenge = "example.com: prove this wallet is yours · 9UQV & + 50% 🔑"

func challengeLink(extra string) string {
	return "land.gno.gnokey://connect?challenge=" + url.QueryEscape(testChallenge) + "&chainid=dev&callback=" +
		url.QueryEscape("exampledapp://session-callback") + "&state=s1" + extra
}

func TestParseChallengeDecodesStrictly(t *testing.T) {
	// GnoConnect links are RFC 3986: a space is %20 and '+' (%2B) stays a plus. QueryEscape writes a space as '+',
	// so turn those into %20 (the literal '+' of the phrase is already %2B).
	link := strings.ReplaceAll(challengeLink(""), "+", "%20")
	got, err := ParseChallenge(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != testChallenge {
		t.Fatalf("got %q, want %q", got, testChallenge)
	}
}

func TestParseChallenge(t *testing.T) {
	enc := func(s string) string { return strings.ReplaceAll(url.QueryEscape(s), "+", "%20") }
	for _, c := range []struct {
		name, link string
		want       string // "" with ok: no challenge
		bad        bool
	}{
		{"none", "land.gno.gnokey://connect?callback=exampledapp%3A%2F%2Fcb&state=s", "", false},
		{"one", "land.gno.gnokey://connect?challenge=" + enc("hello") + "&callback=exampledapp%3A%2F%2Fcb", "hello", false},
		{"twice", "land.gno.gnokey://connect?challenge=a&challenge=b&callback=exampledapp%3A%2F%2Fcb", "", true},
		{"empty", "land.gno.gnokey://connect?challenge=&callback=exampledapp%3A%2F%2Fcb", "", true},
		{"with a key", "land.gno.gnokey://connect?challenge=a&pubkey=gpub1x&callback=exampledapp%3A%2F%2Fcb", "", true},
		{"control character", "land.gno.gnokey://connect?challenge=a%0Ab&callback=exampledapp%3A%2F%2Fcb", "", true},
		{"too long", "land.gno.gnokey://connect?challenge=" + strings.Repeat("a", 4097) + "&callback=exampledapp%3A%2F%2Fcb", "", true},
		{"not a connect", "land.gno.gnokey://sendtx?challenge=a", "", true},
	} {
		t.Run(c.name, func(t *testing.T) {
			got, err := ParseChallenge(c.link)
			if c.bad {
				if !HasCode(err, CodeInvalidRequest) {
					t.Fatalf("got %q, %v; want invalid_request", got, err)
				}
				return
			}
			if err != nil || got != c.want {
				t.Fatalf("got %q, %v; want %q", got, err, c.want)
			}
		})
	}
}

func TestSessionRequestRefusesAChallenge(t *testing.T) {
	key := secp256k1.GenPrivKey()
	link := signedTestConnect(t, key, "&challenge=hello") // the helper of gnoconnect_request_test.go, with extra params
	if _, err := ParseSessionRequest(link); !HasCode(err, CodeInvalidRequest) {
		t.Fatalf("got %v, want invalid_request", err)
	}
}

func TestDataPairRequest(t *testing.T) {
	s := newTestService(t) // network chain "dev", remote set by the helper
	r, err := s.DataPairRequest("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", testChallenge, "exampledapp://session-callback")
	if err != nil {
		t.Fatal(err)
	}
	if r.Kind != protocol.KindData || r.Data != testChallenge || r.ChainID != s.Network().ChainID ||
		r.Signer != "g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5" || r.Requester.For != "exampledapp://session-callback" {
		t.Fatalf("got %+v", r)
	}
	if _, err := s.DataPairRequest("g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5", "a\nb", ""); !HasCode(err, CodeInvalidRequest) {
		t.Fatalf("a bad text: %v", err)
	}
}

func proofOf(t *testing.T, key crypto.PrivKey, chainID string, signer crypto.Address, data string) []byte {
	t.Helper()
	payload, err := std.SignDataPayload(chainID, signer, data)
	if err != nil {
		t.Fatal(err)
	}
	sig, _ := key.Sign(payload)
	pub := key.PubKey().(secp256k1.PubKeySecp256k1)
	out, _ := json.Marshal(map[string]any{
		"signed": json.RawMessage(payload),
		"signature": map[string]any{
			"pubKey":    map[string]string{"typeUrl": "/tm.PubKeySecp256k1", "value": base64.StdEncoding.EncodeToString(pub[:])},
			"signature": base64.StdEncoding.EncodeToString(sig),
		},
	})
	return out
}

func TestVerifyProof(t *testing.T) {
	key, other := secp256k1.GenPrivKey(), secp256k1.GenPrivKey()
	id := key.PubKey().Address()
	p, err := VerifyProof(proofOf(t, key, "dev", id, testChallenge), id.String(), "dev", testChallenge)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := std.SignDataPayload("dev", id, testChallenge)
	if p.Signed != base64.RawURLEncoding.EncodeToString(payload) || p.PubKey != crypto.PubKeyToBech32(key.PubKey()) {
		t.Fatalf("got %+v", p)
	}
	sig, _ := base64.RawURLEncoding.DecodeString(p.Signature)
	if !key.PubKey().VerifyBytes(payload, sig) {
		t.Fatal("the signature does not verify over signed")
	}
	for name, proof := range map[string][]byte{
		"another identity": proofOf(t, other, "dev", other.PubKey().Address(), testChallenge),
		"another chain":    proofOf(t, key, "test", id, testChallenge),
		"another text":     proofOf(t, key, "dev", id, "nope"),
		"not JSON":         []byte("{"),
	} {
		if _, err := VerifyProof(proof, id.String(), "dev", testChallenge); !HasCode(err, CodeSignerUnavailable) {
			t.Errorf("%s: %v", name, err)
		}
	}
}
```

Before writing these, check the names of the existing helpers and adapt the three calls if they differ: `grep -n "^func " core/*_test.go | grep -i "service\|signed\|connect"` — use the repo's own helper for a test `Service` and for a signed `connect` link (e.g. `signedConnect` in `mobile/sessions_test.go` has a core counterpart), and `HasCode`/`errors.As(*CodedError)` per `core/errors.go`.

- [ ] **Step 4: Run to see them fail**

Run: `cd ~/gnokey-mobile && go test ./core/ -run 'Challenge|DataPair|VerifyProof'`
Expected: `undefined: ParseChallenge` (and the others).

- [ ] **Step 5: `core/gnoconnect_challenge.go`**

```go
package core

import (
	"encoding/base64"
	"encoding/json"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/gnolang/gno/contribs/gnokey-pair/protocol"
	"github.com/gnolang/gno/tm2/pkg/crypto"
	"github.com/gnolang/gno/tm2/pkg/crypto/secp256k1"
	"github.com/gnolang/gno/tm2/pkg/std"
)

// GnoConnect `connect` with a `challenge`: the identity signs the producer's
// text to prove it controls the address. The identity's key is on the
// computer, so the text goes to gnokey-pair, which has gnokey sign-data sign
// it; the wallet checks the proof before answering.

// MaxChallengeSize bounds a challenge, as the standard does.
const MaxChallengeSize = protocol.MaxDataSize

// ValidateChallenge applies the standard's rules to a challenge.
func ValidateChallenge(s string) error {
	switch {
	case s == "":
		return Errf(CodeInvalidRequest, "the challenge is empty")
	case len(s) > MaxChallengeSize:
		return Errf(CodeInvalidRequest, "a challenge of %d bytes exceeds %d", len(s), MaxChallengeSize)
	case !utf8.ValidString(s):
		return Errf(CodeInvalidRequest, "the challenge is not UTF-8")
	case strings.IndexFunc(s, unicode.IsControl) >= 0:
		return Errf(CodeInvalidRequest, "the challenge has a control character")
	}
	return nil
}

// ParseChallenge reads the challenge of a `connect` link: "" when it has none.
func ParseChallenge(rawURL string) (string, error) {
	host, rawQuery, err := splitLaunchLink(rawURL)
	if err != nil {
		return "", err
	}
	if host != HostConnect {
		return "", Errf(CodeInvalidRequest, "%q is not a connect", host)
	}
	params, err := decodeQuery(rawQuery)
	if err != nil {
		return "", err
	}
	var challenges []string
	hasKey := false
	for _, p := range params {
		switch p.Key {
		case "challenge":
			challenges = append(challenges, p.Value)
		case "pubkey":
			hasKey = true
		}
	}
	switch {
	case len(challenges) == 0:
		return "", nil
	case len(challenges) > 1:
		return "", Errf(CodeInvalidRequest, "challenge appears more than once")
	case hasKey:
		return "", Errf(CodeInvalidRequest, "a connect proves an identity or names a key, not both")
	}
	if err := ValidateChallenge(challenges[0]); err != nil {
		return "", err
	}
	return challenges[0], nil
}

// DataPairRequest is the request for gnokey-pair to have identity sign
// challenge, on the wallet's chain.
func (s *Service) DataPairRequest(identity, challenge, callback string) (protocol.Request, error) {
	if err := ValidateChallenge(challenge); err != nil {
		return protocol.Request{}, err
	}
	if _, err := crypto.AddressFromBech32(identity); err != nil {
		return protocol.Request{}, Errf(CodeInvalidAddress, "identity %q: %v", identity, err)
	}
	cfg := s.Network()
	return protocol.Request{
		Kind: protocol.KindData, ChainID: cfg.ChainID, RPC: cfg.Remote, Signer: identity, Data: challenge,
		Requester: &protocol.Requester{Name: PairRequester, For: callbackOrigin(callback)},
	}, nil
}

// ConnectProof is the reply's proof: Signed and Signature in base64url without
// padding, PubKey the identity's gpub.
type ConnectProof struct {
	Signed    string
	Signature string
	PubKey    string
}

// VerifyProof checks gnokey-pair's proof: identity signed challenge on
// chainID. Any mismatch is signer_unavailable: the computer could not prove it.
func VerifyProof(proof []byte, identity, chainID, challenge string) (*ConnectProof, error) {
	fail := func(format string, args ...any) (*ConnectProof, error) {
		return nil, Errf(CodeSignerUnavailable, "the computer's proof does not check out: "+format, args...)
	}
	var o struct {
		Signed    json.RawMessage `json:"signed"`
		Signature struct {
			PubKey struct {
				TypeURL string `json:"typeUrl"`
				Value   string `json:"value"`
			} `json:"pubKey"`
			Signature string `json:"signature"`
		} `json:"signature"`
	}
	if err := json.Unmarshal(proof, &o); err != nil {
		return fail("%v", err)
	}
	raw, err := base64.StdEncoding.DecodeString(o.Signature.PubKey.Value)
	if o.Signature.PubKey.TypeURL != "/tm.PubKeySecp256k1" || err != nil || len(raw) != secp256k1.PubKeySecp256k1Size {
		return fail("not a secp256k1 key")
	}
	var pub secp256k1.PubKeySecp256k1
	copy(pub[:], raw)
	sig, err := base64.StdEncoding.DecodeString(o.Signature.Signature)
	if err != nil {
		return fail("an unreadable signature")
	}
	signed, err := std.VerifySignData(o.Signed, pub, sig)
	switch {
	case err != nil:
		return fail("%v", err)
	case signed.Signer.String() != identity:
		return fail("signed by %s, not %s", signed.Signer, identity)
	case signed.ChainID != chainID:
		return fail("signed for %s, not %s", signed.ChainID, chainID)
	case signed.Data != challenge:
		return fail("another text was signed")
	}
	payload, err := std.SignDataPayload(chainID, signed.Signer, challenge)
	if err != nil {
		return fail("%v", err)
	}
	return &ConnectProof{
		Signed:    base64.RawURLEncoding.EncodeToString(payload),
		Signature: base64.RawURLEncoding.EncodeToString(sig),
		PubKey:    crypto.PubKeyToBech32(pub),
	}, nil
}

// CanSignData fails with CodePairUnsupported when gnokey-pair cannot sign a text.
func (p *Pairing) CanSignData() error {
	if !slices.Contains(p.peer.Kinds, protocol.KindData) {
		return Errf(CodePairUnsupported, "the computer cannot sign a text: update gnokey-pair, and gnokey to a version with sign-data")
	}
	return nil
}
```

- [ ] **Step 6: Refuse a challenge in a session request; announce `data`**

In `ParseSessionRequest` (`core/gnoconnect_request.go`), inside the parameter loop, before `dst, ok := single[p.Key]`:

```go
		if p.Key == "challenge" {
			return nil, Errf(CodeInvalidRequest, "a connect proves an identity or names a key, not both")
		}
```

In `DialPair` (`core/pair.go`) change the wallet's versions to:

```go
	versions := protocol.AppVersions(protocol.Versions{V: 1, Kinds: []string{protocol.KindTx, protocol.KindData}})
```

- [ ] **Step 7: Run the core tests**

Run: `go test ./core/ 2>&1 | tail -5`
Expected: PASS.

- [ ] **Step 8: The bridge (failing test first)**

Add to `mobile/pair_test.go` (it already runs a relay through `relaytest`; reuse its pairing setup — read `TestPairingCrossesTheBridge` and copy its relay/peer scaffolding):

```go
func TestPairingSendsData(t *testing.T) {
	// same scaffolding as TestPairingCrossesTheBridge, with the peer announcing
	// Kinds {tx, data}; the peer asserts the request it receives:
	//   req.Kind == protocol.KindData, req.Data == "hello", req.Signer == identity
	// and answers protocol.Result{Status: "success", Proof: <proof of key over "hello" on the bridge's chain>}.
	// Then: res, _ := p.AwaitResult(); proof, err := b.VerifyProof(res.Proof, identity, "hello")
	// must succeed with proof.PubKey == crypto.PubKeyToBech32(key.PubKey()).
}

func TestBridgeParseChallenge(t *testing.T) {
	b := newTestBridge(t)
	got, err := b.ParseChallenge("land.gno.gnokey://connect?challenge=hello%20there&callback=exampledapp%3A%2F%2Fcb")
	if err != nil || got != "hello there" {
		t.Fatalf("got %q, %v", got, err)
	}
}
```

Write `TestPairingSendsData` in full by copying the body of `TestPairingCrossesTheBridge` and changing exactly the three points named in its comment; keep `proofOf`-style proof building inline (the core test helper is not visible from `mobile`).

- [ ] **Step 9: Bridge code**

In `mobile/sessions.go`:

```go
// ParseChallenge reads a connect link's challenge: "" when there is none,
// "[invalid_request]" when it breaks the standard's rules or comes with a key.
func (b *Bridge) ParseChallenge(url string) (string, error) {
	return core.ParseChallenge(url)
}
```

In `mobile/pair.go`, add `Proof string` to `PairResult` (doc: "on success of SendData, gnokey sign-data's output: check it with VerifyProof") and set it in `AwaitResult`: `Proof: string(res.Proof),`. Then:

```go
// SendData sends challenge for identity to sign on the computer ("Send to my
// computer" for a connect with a challenge). "[pair_unsupported]" means the
// computer cannot sign a text.
func (p *Pairing) SendData(identity, challenge, callback string) error {
	c := p.conn()
	if c == nil {
		return invalidSpecErr("not connected")
	}
	if err := c.CanSignData(); err != nil {
		return err
	}
	req, err := p.b.svc.DataPairRequest(identity, challenge, callback)
	if err != nil {
		return err
	}
	return c.Send(req)
}

// ConnectProof is a connect reply's proof: Signed and Signature base64url
// without padding, PubKey the identity's gpub.
type ConnectProof struct {
	Signed    string
	Signature string
	PubKey    string
}

// VerifyProof checks gnokey-pair's proof: identity signed challenge on the
// wallet's chain. "[signer_unavailable]" otherwise.
func (b *Bridge) VerifyProof(proof, identity, challenge string) (*ConnectProof, error) {
	p, err := core.VerifyProof([]byte(proof), identity, b.svc.Network().ChainID, challenge)
	if err != nil {
		return nil, err
	}
	return &ConnectProof{Signed: p.Signed, Signature: p.Signature, PubKey: p.PubKey}, nil
}
```

- [ ] **Step 10: Run, lint, commit**

```bash
cd ~/gnokey-mobile && go test ./core/... ./mobile/... 2>&1 | tail -5 && go vet ./core/ ./mobile/
git add core mobile
git commit -m "feat: a connect with a challenge — the identity signs it on the computer, the wallet checks the proof"
```

Expected: PASS, vet clean. No dapp name in any new test (Global Constraints).

---

### Task 4: gnokey-mobile iOS — the phrase in the sign-in sheet, sent to the computer

**Files:**
- Modify: `ios/GnokeyMobile/Core/DeepLink.swift` (`ConnectRequest`, `parseConnect`)
- Modify: `ios/GnokeyMobile/Core/BridgeClient.swift` (`parseChallenge`, `verifyProof`)
- Modify: `ios/GnokeyMobile/Core/PairingSession.swift` (`PairResultInfo.proof`, `sendData`, `ConnectProofInfo`)
- Modify: `ios/GnokeyMobile/Screens/SendToComputer.swift` (`PairPayload.proof`, `verifiedProof`)
- Modify: `ios/GnokeyMobile/Core/AppModel.swift` (connect branch of `handleDeepLink`, `approveConnect(proof:)`)
- Modify: `ios/GnokeyMobile/Screens/ConnectConsentView.swift`
- Test: `ios/GnokeyMobileTests/` (the existing DeepLink tests file; `ls ios/GnokeyMobileTests` to find it)

**Interfaces:**
- Consumes: Task 3's gomobile `GnoMobileBridge.parseChallenge(_:)`, `GnoMobilePairing.sendData(_:challenge:callback:)`, `GnoMobilePairResult.proof`, `GnoMobileBridge.verifyProof(_:identity:challenge:)` → `GnoMobileConnectProof` (`signed`, `signature`, `pubKey`).
- Produces: `struct ConnectProofInfo: Equatable { var signed, signature, pubKey: String }`; `ConnectRequest.challenge: String`.

- [ ] **Step 1: Rebuild the framework**

```bash
cd ~/gnokey-mobile && make --no-print-directory -n | head -20   # find the iOS framework target (e.g. make framework.ios)
```

Run that target; expected: `GnoCore.xcframework` rebuilt with `ParseChallenge`, `SendData`, `VerifyProof`. (Trap from memory: gomobile maps Go `URL`-style initialisms to lowerCamel setters; check generated names in the framework headers: `grep -n "ParseChallenge\|SendData\|VerifyProof\|ConnectProof" -r ios/Frameworks/GnoCore.xcframework/*/GnoCore.framework/Headers/*.h`.)

- [ ] **Step 2: Failing test — the link's challenge is read**

In the DeepLink test file add:

```swift
func testParseConnectReadsTheChallenge() {
    let url = URL(string: "land.gno.gnokey://connect?challenge=example.com%3A%20prove%20%C2%B7%20a%20%2B%20b&callback=exampledapp%3A%2F%2Fsession-callback&state=s1")!
    XCTAssertEqual(DeepLink.parseConnect(url)?.challenge, "example.com: prove · a + b")
}
```

Run: `xcodebuild test -project ios/GnokeyMobile.xcodeproj -scheme GnokeyMobile -destination 'platform=iOS Simulator,id=CB3A9D85-7138-421B-9110-31B94C3DB491' -only-testing:GnokeyMobileTests 2>&1 | tail -15`
Expected: FAIL (no member `challenge`).

- [ ] **Step 3: `ConnectRequest.challenge` and its parsing**

In `ConnectRequest` add:

```swift
    /// A text the app's backend wants the identity to sign (GnoConnect
    /// `challenge`): approving then signs it on the computer. Empty when absent.
    var challenge: String = ""
```

In `parseConnect`, add the case `case "challenge": challenge = value` (declare `var challenge = ""` with the others) and pass `challenge: challenge` to the initializer. Update the struct's doc comment: "Display-level without a challenge; with one, the identity signs it."

Run the test: PASS.

- [ ] **Step 4: Bridge and pairing wrappers**

`PairingSession.swift`: add `var proof: String` to `PairResultInfo` (set from `r.proof` in `awaitResult`), and:

```swift
/// A connect reply's proof (`mobile.ConnectProof`).
struct ConnectProofInfo: Equatable, Sendable {
    var signed: String
    var signature: String
    var pubKey: String
}
```

and in `PairingSession`:

```swift
    /// Sends a connect's challenge for `identity` to sign on the computer.
    func sendData(identity: String, challenge: String, callback: String) async throws {
        try await blocking { try self.pairing.sendData(identity, challenge: challenge, callback: callback) }
    }
```

`BridgeClient.swift`:

```swift
    /// A connect link's challenge, "" when none; throws `invalid_request` when it breaks the rules.
    func parseChallenge(url: String) throws -> String {
        do {
            var error: NSError?
            let c = requireBridge().parseChallenge(url, error: &error)
            if let error { throw error }
            return c
        } catch { throw BridgeError(error) }
    }

    /// Checks the computer's proof for `identity` and `challenge` on the wallet's chain.
    func verifyProof(_ proof: String, identity: String, challenge: String) throws -> ConnectProofInfo {
        do {
            let p = try requireBridge().verifyProof(proof, identity: identity, challenge: challenge)
            return ConnectProofInfo(signed: p.signed, signature: p.signature, pubKey: p.pubKey)
        } catch { throw BridgeError(error) }
    }
```

(Match the exact gomobile Swift signatures from the headers checked in Step 1; a Go `(string, error)` usually comes out as `func parseChallenge(_ url: String?, error: NSErrorPointer) -> String`. Follow how `parseScopeHints` is called in this file for a pointer-returning method.)

- [ ] **Step 5: The proof payload in "Send to my computer"**

In `SendToComputer.swift`:

```swift
    /// A connect's challenge, for the identity to sign.
    case proof(identity: String, challenge: String, callback: String)
```

In `SendToComputerModel` add `private(set) var verifiedProof: ConnectProofInfo?`, reset it to nil in `start` and `stop`, send with:

```swift
            case let .proof(identity, challenge, callback):
                try await session.sendData(identity: identity, challenge: challenge, callback: callback)
```

and after `awaitResult`, before `phase = .answered(…)`:

```swift
            if case let .proof(identity, challenge, _) = payload, result.status == "success" {
                verifiedProof = try await model.client.verifyProof(result.proof, identity: identity, challenge: challenge)
            }
```

(`BridgeClient` calls are awaited from here as `newPairing` is.) In `successText`, a result with a non-empty `proof` reads `"Signed by your computer."`. In `SendToComputerCard.idle`'s text, when the payload is a proof the copy is: "Run gnokey-pair on the computer, then scan the code it shows. It shows the text and signs it with gnokey; nothing goes on chain." — add a `var signsText = false` parameter to the card to pick it, and hide the offline toggle when `signsText` (no network either way).

- [ ] **Step 6: AppModel**

In the connect branch of `handleDeepLink`, after the hints, read the challenge:

```swift
                    do {
                        request.challenge = try await client.parseChallenge(url: url.absoluteString)
                    } catch {
                        let bridgeError = error as? BridgeError ?? BridgeError(error)
                        respond(to: url, code: bridgeError.protocolCode ?? "invalid_request")
                        return
                    }
```

Replace `approveConnect()` with:

```swift
    /// User approved the sign-in: return the active identity to the callback.
    /// With a challenge, only once the computer's proof is checked (`proof`).
    func approveConnect(proof: ConnectProofInfo? = nil) {
        guard let request = pendingConnect else { return }
        if !request.challenge.isEmpty && proof == nil { return }
        pendingConnect = nil
        guard let key = sessionKey, !draft.masterAddress.isEmpty else {
            respondConnect(request, status: "error", code: "no_signer")
            return
        }
        let features = ("features", "sendtx,signtx,sessions,challenge")
        if let proof {
            respondConnect(request, status: "success", extra: [
                ("address", draft.masterAddress),
                ("pubkey", proof.pubKey),
                ("chainid", network.chainID),
                features,
                ("signed", proof.signed),
                ("signature", proof.signature),
            ])
            return
        }
        respondConnect(request, status: "success", extra: [
            ("address", draft.masterAddress),
            ("session", key.address),
            ("pubkey", key.pubKey),
            ("chainid", network.chainID),
            // The hosts we implement, plus `sessions` (connect with a key, `old`,
            // `disconnect`) and `challenge` (gnoconnect.md, `connect` features).
            features,
        ])
    }
```

- [ ] **Step 7: The sign-in sheet**

In `ConnectConsentView`, add `@State private var pairing = SendToComputerModel()`. When `request.challenge` is not empty:
- title `"Prove your identity"` instead of `"Sign in"`;
- after the identity card, a card:

```swift
                    if !request.challenge.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            SectionLabel("Text to sign")
                            Text(request.challenge)
                                .font(.system(.footnote, design: .monospaced))
                                .textSelection(.enabled)
                            Text("Signing proves this account is yours. Nothing goes on chain and it costs nothing; your computer signs with the account's key.")
                                .font(.caption)
                                .foregroundStyle(Theme.textSecondary)
                        }
                        .card()
                        SendToComputerCard(pairing: pairing, watchesChain: false, signsText: true) {
                            .proof(identity: model.draft.masterAddress, challenge: request.challenge, callback: request.callback)
                        }
                    }
```

- the Approve button only without a challenge (`if request.challenge.isEmpty { … Approve … }`); Cancel stays;
- `.onChange(of: pairing.verifiedProof) { _, proof in if let proof { model.approveConnect(proof: proof) } }`.

- [ ] **Step 8: Build and run the unit tests**

Run the `xcodebuild test` command of Step 2. Expected: PASS, no warnings in the touched files.

- [ ] **Step 9: Commit**

```bash
git add ios
git commit -m "feat(ios): a connect with a challenge — show the text, sign it on the computer, answer with the proof"
```

---

### Task 5: gnokey-mobile Android — the same

**Files:**
- Modify: `android/app/src/main/java/land/gno/gnokey/DeepLink.kt` (`ConnectRequest`, `parseConnect`)
- Modify: `android/app/src/main/java/land/gno/gnokey/BridgeClient.kt` (`parseChallenge`, `verifyProof`)
- Modify: `android/app/src/main/java/land/gno/gnokey/PairingSession.kt` (`PairResultInfo.proof`, `sendData`, `ConnectProofInfo`)
- Modify: `android/app/src/main/java/land/gno/gnokey/screens/SendToComputer.kt` (`PairPayload.Proof`, `verifiedProof`)
- Modify: `android/app/src/main/java/land/gno/gnokey/AppViewModel.kt` (connect handling, `approveConnect(proof)`)
- Modify: `android/app/src/main/java/land/gno/gnokey/screens/ConnectConsentDialog.kt`
- Test: `android/app/src/test/java/land/gno/gnokey/DeepLinkTest.kt` (`ls android/app/src/test/java/land/gno/gnokey`)

**Interfaces:**
- Consumes: Task 3's gomobile Java API `gnolang.gno.mobile.Bridge.parseChallenge(String)`, `Pairing.sendData(String, String, String)`, `PairResult.getProof()`, `Bridge.verifyProof(String, String, String): ConnectProof` (`getSigned()`, `getSignature()`, `getPubKey()`).
- Produces: `data class ConnectProofInfo(val signed: String, val signature: String, val pubKey: String)`; `ConnectRequest.challenge: String`.

- [ ] **Step 1: Rebuild the AAR** — the Android framework target found in Task 4 Step 1 (`ORG_GRADLE_PROJECT_gnoAbi=arm64-v8a` for the emulator, per memory).

- [ ] **Step 2: Failing test**

```kotlin
@Test
fun parseConnectReadsTheChallenge() {
    val uri = Uri.parse("land.gno.gnokey://connect?challenge=example.com%3A%20prove%20%C2%B7%20a%20%2B%20b&callback=exampledapp%3A%2F%2Fsession-callback&state=s1")
    assertEquals("example.com: prove · a + b", DeepLink.parseConnect(uri)?.challenge)
}
```

Run: `cd android && ./gradlew testDebugUnitTest --tests '*DeepLinkTest*' 2>&1 | tail -15` — FAIL.

- [ ] **Step 3: `ConnectRequest.challenge`** — add `val challenge: String = ""` (KDoc as on iOS) and `challenge = uri.getQueryParameter("challenge") ?: ""` in `parseConnect`. Test PASS.

- [ ] **Step 4: Wrappers**

`PairingSession.kt`: `PairResultInfo` gains `val proof: String` (from `r.proof`), plus

```kotlin
/** A connect reply's proof (`mobile.ConnectProof`). */
data class ConnectProofInfo(val signed: String, val signature: String, val pubKey: String)
```

and

```kotlin
    /** Sends a connect's challenge for [identity] to sign on the computer. */
    suspend fun sendData(identity: String, challenge: String, callback: String) =
        blocking { pairing.sendData(identity, challenge, callback) }
```

`BridgeClient.kt`:

```kotlin
    suspend fun parseChallenge(url: String): String = withContext(Dispatchers.IO) {
        wrap { require().parseChallenge(url) }
    }

    suspend fun verifyProof(proof: String, identity: String, challenge: String): ConnectProofInfo =
        withContext(Dispatchers.IO) {
            wrap {
                val p = require().verifyProof(proof, identity, challenge)
                ConnectProofInfo(p.signed, p.signature, p.pubKey)
            }
        }
```

- [ ] **Step 5: The proof payload** — in `SendToComputer.kt`:

```kotlin
    /** A connect's challenge, for the identity to sign. */
    data class Proof(val identity: String, val challenge: String, val callback: String) : PairPayload
```

`SendToComputerState` gains `var verifiedProof by mutableStateOf<ConnectProofInfo?>(null); private set`, reset in `start`/`stop`; in `start`, `is PairPayload.Proof -> s.sendData(p.identity, p.challenge, p.callback)`, and after `awaitResult`:

```kotlin
            if (p is PairPayload.Proof && result.status == "success") {
                verifiedProof = model.client.verifyProof(result.proof, p.identity, p.challenge)
            }
```

`SendToComputerCard` gains `signsText: Boolean = false`: its idle text as on iOS, and no offline switch when true.

- [ ] **Step 6: AppViewModel** — in the connect deep-link handling (where `parseScopeHints` is called), read `request = request.copy(challenge = client.parseChallenge(uri.toString()))`, answering `invalid_request` (or the bridge's protocol code) on failure, exactly as hints are handled there. Replace `approveConnect()` with the Kotlin twin of iOS Task 4 Step 6:

```kotlin
    /** User approved the sign-in; with a challenge, only once the computer's proof is checked. */
    fun approveConnect(proof: ConnectProofInfo? = null) {
        val request = pendingConnect ?: return
        if (request.challenge.isNotEmpty() && proof == null) return
        pendingConnect = null
        val key = sessionKey
        if (key == null || draft.masterAddress.isEmpty()) {
            respondConnect(request, "error", "no_signer")
            return
        }
        val features = "features" to "sendtx,signtx,sessions,challenge"
        if (proof != null) {
            respondConnect(
                request, "success",
                extra = listOf(
                    "address" to draft.masterAddress,
                    "pubkey" to proof.pubKey,
                    "chainid" to network.chainID,
                    features,
                    "signed" to proof.signed,
                    "signature" to proof.signature,
                ),
            )
            return
        }
        respondConnect(
            request, "success",
            extra = listOf(
                "address" to draft.masterAddress,
                "session" to key.address,
                "pubkey" to key.pubKey,
                "chainid" to network.chainID,
                // The hosts we implement, plus `sessions` (connect with a key, `old`,
                // `disconnect`) and `challenge` (gnoconnect.md, `connect` features).
                features,
            ),
        )
    }
```

- [ ] **Step 7: The dialog** — `ConnectConsentDialog.kt`: with a challenge, title "Prove your identity", a "Text to sign" card (the text, selectable, and the same note as iOS), `SendToComputerCard(model, state, watchesChain = false, signsText = true) { PairPayload.Proof(model.draft.masterAddress, request.challenge, request.callback) }` with `val state = remember { SendToComputerState() }`, Approve shown only without a challenge, and

```kotlin
    LaunchedEffect(state.verifiedProof) { state.verifiedProof?.let { model.approveConnect(it) } }
```

- [ ] **Step 8: Tests and build** — `./gradlew testDebugUnitTest assembleDebug 2>&1 | tail -15`: PASS and builds.

- [ ] **Step 9: Commit**

```bash
git add android
git commit -m "feat(android): a connect with a challenge — show the text, sign it on the computer, answer with the proof"
```

---

### Task 6: The app — the challenge link and the proof the server takes

**Files:**
- Modify: `src/utils/base64url.ts`, `src/utils/base64url.test.ts`
- Modify: `src/session/gnoconnect.ts`, `src/session/gnoconnect.test.ts`
- Create: `src/offchain/chat/name-proof.ts`, `src/offchain/chat/name-proof.test.ts`

**Interfaces:**
- Produces:
  - `fromBase64url(s: string): Uint8Array`, `toBase64(b: Uint8Array): string` (standard alphabet, padded).
  - `interface ChallengeRequest { challenge: string; signer: string; chainid: string; rpc?: string; callback: string; state: string }`, `buildChallengeLink(r: ChallengeRequest): string`.
  - `WalletReply` gains `pubkey: string; signed: string; signature: string`.
  - `interface NameProof { doc: string; sig: string; pub: string; addr: string }`, `proofFromReply(r: WalletReply, identity: string): NameProof` (throws `Error` with a sentence for the sheet).

- [ ] **Step 1: Failing tests**

`src/utils/base64url.test.ts` add:

```ts
test('fromBase64url reads what base64url writes, padding or not', () => {
  for (const n of [0, 1, 2, 3, 4, 31, 32, 33]) {
    const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
    expect(fromBase64url(base64url(b))).toEqual(b);
  }
  expect(fromBase64url('_-8')).toEqual(new Uint8Array([0xff, 0xef]));
  expect(() => fromBase64url('a$b')).toThrow();
});

test('toBase64 is the standard alphabet with padding', () => {
  expect(toBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=');
  expect(toBase64(new TextEncoder().encode('hello'))).toBe('aGVsbG8=');
});
```

`src/session/gnoconnect.test.ts` add:

```ts
test('a challenge link keeps every character of the phrase', () => {
  const challenge = 'gno.world: prove this wallet is yours · a+b & 50% 🔑';
  const link = buildChallengeLink({
    challenge, signer: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5', chainid: 'gnoland-1',
    callback: CALLBACK_URL, state: 'abcd',
  });
  expect(link.startsWith('land.gno.gnokey://connect?challenge=')).toBe(true);
  expect(link.includes(' ')).toBe(false);
  const q = new URL(link.replace('land.gno.gnokey://', 'https://x/')).searchParams;
  expect(q.get('challenge')).toBe(challenge);
  expect(q.get('signer')).toBe('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5');
  expect(q.get('state')).toBe('abcd');
  expect(q.has('pubkey')).toBe(false);
});

test('a reply carries the proof fields', () => {
  const r = parseReplyURL('gno.world://session-callback?status=success&address=g1x&pubkey=gpub1y&signed=e30&signature=AAAA&state=s');
  expect(r).toMatchObject({ pubkey: 'gpub1y', signed: 'e30', signature: 'AAAA' });
});
```

Append to `src/offchain/chat/testing.ts` (test builders; Task 7 uses them too):

```ts
import type { WalletReply } from '@/session/gnoconnect';

/**
 * test1 (gnoland's default test mnemonic) proving "hello" on gnoland-1: its real gpub as `gnokey list` prints it,
 * and the signature cosmjs (Adena's stack) made over the document — the vectors of gno's std/signdata_test.go.
 */
export const PROOF = {
  addr: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5',
  gpub: 'gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq0skzdkmzu0r9h6gny6eg8c9dc303xrrudee6z4he4y7cs5rnjwmyf40yaj',
  pub: 'A+FhNtsXHjLfSJk1lB8FbiL4mGPjc50Kt81J7EKDnJ2y',
  doc: '{"account_number":"0","chain_id":"gnoland-1","fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"sign/MsgSignData","value":{"data":"aGVsbG8=","signer":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"}}],"sequence":"0"}',
  signed: 'eyJhY2NvdW50X251bWJlciI6IjAiLCJjaGFpbl9pZCI6Imdub2xhbmQtMSIsImZlZSI6eyJhbW91bnQiOltdLCJnYXMiOiIwIn0sIm1lbW8iOiIiLCJtc2dzIjpbeyJ0eXBlIjoic2lnbi9Nc2dTaWduRGF0YSIsInZhbHVlIjp7ImRhdGEiOiJhR1ZzYkc4PSIsInNpZ25lciI6Imcxamc4bXR1dHU5a2hoZndjNG54bXVoY3BmdGYwcGFqZGhmdnNxZjUifX1dLCJzZXF1ZW5jZSI6IjAifQ',
  signature: '8hpjD4_il8opyBcDRI3Uax7RawxfahpY7agfp3fbv8V0OI1lPGBmIJ7epkRjGfFbyl57udqJHErR3q79qmwEZg',
  sig: '8hpjD4/il8opyBcDRI3Uax7RawxfahpY7agfp3fbv8V0OI1lPGBmIJ7epkRjGfFbyl57udqJHErR3q79qmwEZg==',
};

/** A wallet's success reply to a challenge, carrying PROOF. */
export const proofReply = (o: Partial<WalletReply> = {}): WalletReply => ({
  status: 'success', code: '', state: 's', address: PROOF.addr, session: '', expiresAt: 0, allow: [], spend: '', period: 0,
  chainid: 'gnoland-1', hash: '', revoked: '', pubkey: PROOF.gpub, signed: PROOF.signed, signature: PROOF.signature, ...o,
});
```

`src/offchain/chat/name-proof.test.ts`:

```ts
import { proofFromReply } from './name-proof';
import { PROOF, proofReply as reply } from './testing';

const ADDR = PROOF.addr;

test('the reply becomes what gno.world takes', () => {
  expect(proofFromReply(reply(), ADDR)).toEqual({ doc: PROOF.doc, sig: PROOF.sig, pub: PROOF.pub, addr: ADDR });
});

test('a reply without a proof, or for another account, is refused', () => {
  expect(() => proofFromReply(reply({ signed: '' }), ADDR)).toThrow(/cannot prove/);
  expect(() => proofFromReply(reply({ address: 'g1other' }), ADDR)).toThrow(/g1other/);
  expect(() => proofFromReply(reply({ pubkey: 'gpub1nope' }), ADDR)).toThrow();
});
```

Run: `npx jest src/utils/base64url src/session/gnoconnect src/offchain/chat/name-proof` — FAIL (missing exports).

- [ ] **Step 2: Base64 helpers** — append to `src/utils/base64url.ts`:

```ts
/** RFC 4648 §5, with or without padding. */
export function fromBase64url(s: string): Uint8Array {
  const t = s.replace(/=+$/, '');
  if (/[^A-Za-z0-9_-]/.test(t) || t.length % 4 === 1) throw new Error('not base64url');
  const out: number[] = [];
  let acc = 0, bits = 0;
  for (const c of t) {
    acc = (acc << 6) | A.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
    }
  }
  return Uint8Array.from(out);
}

/** RFC 4648 §4: the standard alphabet, padded. */
export const toBase64 = (b: Uint8Array): string => {
  const s = base64url(b).replace(/-/g, '+').replace(/_/g, '/');
  return s + '='.repeat((4 - (s.length % 4)) % 4);
};
```

- [ ] **Step 3: The link and the reply fields** — in `src/session/gnoconnect.ts`:

```ts
/** A `connect` asking the identity to sign `challenge` (gnoconnect.md, "Proving the identity"). */
export interface ChallengeRequest {
  challenge: string;
  signer: string;
  chainid: string;
  rpc?: string;
  callback: string;
  state: string;
}

export function buildChallengeLink(r: ChallengeRequest): string {
  const p: [string, string][] = [['challenge', r.challenge], ['signer', r.signer], ['chainid', r.chainid]];
  if (r.rpc) p.push(['rpc', r.rpc]);
  p.push(['callback', r.callback], ['state', r.state]);
  return `${WALLET_SCHEME}://connect?${p.map(([k, v]) => `${k}=${enc(v)}`).join('&')}`;
}
```

`WalletReply` gains `pubkey: string;` `/** with a challenge: the bytes signed, base64url */ signed: string;` `/** with a challenge: base64url, 64 bytes */ signature: string;` and `parseReplyEntries` sets `pubkey: last('pubkey'), signed: last('signed'), signature: last('signature')`.

- [ ] **Step 4: `src/offchain/chat/name-proof.ts`**

```ts
import { toBase64, fromBase64url } from '@/utils/base64url';
import { decodePubKey } from '@/utils/bech32';
import type { WalletReply } from '@/session/gnoconnect';

/** What gno.world's POST /api/name takes as a proof (the site's walletProve). */
export interface NameProof {
  /** the signed document, as the site's signBytesOf writes it: sorted, no spaces, <>& escaped */
  doc: string;
  /** base64 */
  sig: string;
  /** base64 of the 33-byte compressed key */
  pub: string;
  addr: string;
}

/**
 * A gpub's bytes before a secp256k1 key: a protobuf Any, field 1 the type URL "/tm.PubKeySecp256k1", field 2 the
 * key message (field 1, 33 bytes). Read from `gnokey list` (test1), 2026-10-12.
 */
const SECP_PREFIX = [
  0x0a, 0x13, ...Array.from('/tm.PubKeySecp256k1', (c) => c.charCodeAt(0)), 0x12, 0x23, 0x0a, 0x21,
];

/**
 * A wallet's `connect` reply to a challenge, as gno.world takes it. The wallet signed canonical bytes
 * (std.SignDataPayload), which are exactly the `doc` the site sends.
 */
export function proofFromReply(r: WalletReply, identity: string): NameProof {
  if (!r.signed || !r.signature || !r.pubkey) {
    throw new Error('Your wallet cannot prove the account. Boop from this app, then reserve within 3 minutes.');
  }
  if (r.address !== identity) throw new Error(`Your wallet proved ${r.address}, not ${identity}: choose that account in the wallet.`);
  const amino = decodePubKey(r.pubkey);
  if (amino.length !== SECP_PREFIX.length + 33 || SECP_PREFIX.some((b, i) => amino[i] !== b)) {
    throw new Error('Your wallet answered with an unknown kind of key.');
  }
  return {
    doc: new TextDecoder().decode(fromBase64url(r.signed)),
    sig: toBase64(fromBase64url(r.signature)),
    pub: toBase64(amino.slice(SECP_PREFIX.length)),
    addr: identity,
  };
}
```

- [ ] **Step 5: Run the tests** — `npx jest src/utils/base64url src/session/gnoconnect src/offchain/chat/name-proof`: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/base64url.ts src/utils/base64url.test.ts src/session/gnoconnect.ts src/session/gnoconnect.test.ts src/offchain/chat/name-proof.ts src/offchain/chat/name-proof.test.ts src/offchain/chat/testing.ts
git commit -m "feat(chat): the challenge link, and the wallet's proof as gno.world takes it"
```

---

### Task 7: The app — reserving through the wallet

**Files:**
- Modify: `src/offchain/chat/client.ts`, `src/offchain/chat/client.test.ts`
- Modify: `src/offchain/chat/store.ts`, `src/offchain/chat/store.test.ts`
- Modify: `src/state/app-services.tsx` (chat store's wallet deps)
- Modify: `src/app/session-callback.tsx`
- Modify: `src/screens/chat/identity-sheet.tsx`, `src/screens/chat/identity-sheet.test.tsx`, `src/screens/chat/index.tsx`

**Interfaces:**
- Consumes: Task 6's `buildChallengeLink`, `CALLBACK_URL`, `WalletReply`, `proofFromReply`, `NameProof`.
- Produces:
  - `ChatClient.reserveName(name: string, addr: string)`, `ChatClient.nameChallenge(): Promise<string>`, `ChatClient.proveName(name: string, p: NameProof): Promise<{ name: string; key: string; addr: string }>`.
  - `ChatDeps.wallet?: { open(url: string): Promise<void>; randomHex(n: number): string; network(): { chainId: string; remote: string } }`.
  - `ChatState.proving: { state: string; name: string; identity: string } | null`; `reserveName(identity: string): Promise<boolean>`; `onProofReply(r: WalletReply): Promise<boolean>` (true when the reply was the chat's).

- [ ] **Step 1: Client — failing test**

In `client.test.ts`, replace `reserveName('ann')` in the requests test with `reserveName('ann', 'g1x')` and `expect(calls[0].body).toEqual({ name: 'ann', addr: 'g1x' });`, and add:

```ts
test('the challenge, then the proof', async () => {
  const { oc, calls } = fakeOffchain({ words: 'w', name: 'Ann', key: 'k64', addr: 'g1x' });
  const c = createChatClient(oc, async () => NO_IDENTITY);
  expect(await c.nameChallenge()).toBe('w');
  const p = { doc: '{}', sig: 's', pub: 'p', addr: 'g1x' };
  expect(await c.proveName('Ann', p)).toEqual({ name: 'Ann', key: 'k64', addr: 'g1x' });
  expect(calls.map((x) => `${x.verb} ${x.path}`)).toEqual(['GET /api/name/challenge', 'POST /api/name']);
  expect(calls[1].body).toEqual({ name: 'Ann', ...p });
});
```

(`fakeOffchain` answers every call with the object it was given; check its definition at the top of the file and extend it if it records only some verbs.)

- [ ] **Step 2: Client code**

```ts
  reserveName(name: string, addr: string): Promise<{ name: string; key: string; addr: string }>;
  /** the phrase the wallet signs (GET /api/name/challenge) */
  nameChallenge(): Promise<string>;
  /** POST /api/name with the wallet's proof */
  proveName(name: string, proof: NameProof): Promise<{ name: string; key: string; addr: string }>;
```

and in the object:

```ts
    reserveName: async (name, addr) => reserved(await oc.post<Obj>('/api/name', { name, addr }, { headers: (await keyed()).headers }), name),
    nameChallenge: async () => {
      const words = str((await oc.get<Obj>('/api/name/challenge'))?.words);
      if (!words) throw new OffchainError(0, 'the server answered without a phrase');
      return words;
    },
    proveName: async (name, proof) => reserved(await oc.post<Obj>('/api/name', { name, ...proof }, { headers: (await keyed()).headers }), name),
```

with, above `return {`:

```ts
  const reserved = (r: Obj, name: string) => {
    if (!str(r?.key)) throw new OffchainError(0, 'the server answered without the name key');
    return { name: str(r.name) || name, key: str(r.key), addr: str(r.addr) };
  };
```

Run `npx jest src/offchain/chat/client`: PASS.

- [ ] **Step 3: Store — failing tests**

In `store.test.ts`'s harness add `nameChallenge: jest.fn(), proveName: jest.fn()` to the client, a `wallet` dep, and expose it:

```ts
  const opened: string[] = [];
  const wallet = {
    open: async (url: string) => void opened.push(url),
    randomHex: () => 'feedfacefeedface',
    network: () => ({ chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' }),
  };
  // … createChatStore({ …, wallet }) … return { …, opened }
```

Update `reserving saves the key` to `reserveName('g1x')` with `toHaveBeenCalledWith('ann', 'g1x')`, and `a refused reservation …` to reject with `new OffchainError(400, 'a name of 1 to 32 characters')` (a 409 now leads to the wallet). Then add:

```ts
import { PROOF, proofReply } from './testing';

const ADDR = PROOF.addr;
const okReply = (o: Partial<WalletReply> = {}) => proofReply({ state: 'feedfacefeedface', ...o });

/** A store whose reservation is waiting for the wallet. */
async function provingHarness() {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(409, 'Connect your wallet and let it sign the phrase'));
  h.client.nameChallenge.mockResolvedValueOnce('gno.world: prove this wallet is yours · tok');
  await h.store.getState().reserveName(ADDR);
  return h;
}

test('a 409 has the wallet sign the phrase, then the proof reserves the name', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(409, 'Connect your wallet and let it sign the phrase'));
  h.client.nameChallenge.mockResolvedValueOnce('gno.world: prove this wallet is yours · tok');
  expect(await h.store.getState().reserveName(ADDR)).toBe(false);
  expect(h.store.getState().proving).toEqual({ state: 'feedfacefeedface', name: 'ann', identity: ADDR });
  expect(h.store.getState().identityError).toBe('');
  expect(h.opened).toHaveLength(1);
  const q = new URL(h.opened[0].replace('land.gno.gnokey://', 'https://x/')).searchParams;
  expect([q.get('challenge'), q.get('signer'), q.get('chainid'), q.get('state')])
    .toEqual(['gno.world: prove this wallet is yours · tok', ADDR, 'gnoland-1', 'feedfacefeedface']);

  h.client.proveName.mockResolvedValueOnce({ name: 'Ann', key: 'k', addr: ADDR });
  expect(await h.store.getState().onProofReply(okReply())).toBe(true);
  expect(h.client.proveName).toHaveBeenCalledWith('ann', expect.objectContaining({ addr: ADDR, doc: expect.stringContaining('sign/MsgSignData') }));
  expect(h.store.getState().identity).toMatchObject({ reservedName: 'Ann', nameKey: 'k' });
  expect(h.store.getState().proving).toBeNull();
});

test('a reply with another state is not the chat\'s', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  expect(await h.store.getState().onProofReply(okReply({ state: 'other' }))).toBe(false);
  expect(h.client.proveName).not.toHaveBeenCalled();
});

test('a wallet that cannot prove says how to boop instead', async () => {
  const h = await provingHarness();
  expect(await h.store.getState().onProofReply(okReply({ signed: '', signature: '' }))).toBe(true);
  expect(h.store.getState().identityError).toMatch(/Boop from this app, then reserve within 3 minutes/);
  expect(h.client.proveName).not.toHaveBeenCalled();
  expect(h.store.getState().proving).toBeNull();
});

test('a proof for another account is not sent', async () => {
  const h = await provingHarness();
  expect(await h.store.getState().onProofReply(okReply({ address: 'g1other' }))).toBe(true);
  expect(h.store.getState().identityError).toMatch(/g1other/);
  expect(h.client.proveName).not.toHaveBeenCalled();
});

test('a refusal after the signature is the sheet\'s error', async () => {
  const h = await provingHarness();
  h.client.proveName.mockRejectedValueOnce(new OffchainError(409, 'this wallet holds the name remi already'));
  expect(await h.store.getState().onProofReply(okReply())).toBe(true);
  expect(h.store.getState().identityError).toBe('this wallet holds the name remi already');
  expect(h.store.getState().identity.nameKey).toBe('');
  expect(h.store.getState().proving).toBeNull();
});

test('a cancelled or refused wallet answer ends the wait', async () => {
  const h = await provingHarness();
  expect(await h.store.getState().onProofReply(okReply({ status: 'cancelled' }))).toBe(true);
  expect(h.store.getState().proving).toBeNull();
  expect(h.store.getState().identityError).toBe('');
  const g = await provingHarness();
  expect(await g.store.getState().onProofReply(okReply({ status: 'error', code: 'signer_unavailable' }))).toBe(true);
  expect(g.store.getState().identityError).toMatch(/computer/);
});
```

Run: `npx jest src/offchain/chat/store` — FAIL.

- [ ] **Step 4: Store code**

In `ChatState` add:

```ts
  /** a reservation waiting for the wallet's proof */
  proving: { state: string; name: string; identity: string } | null;
  /** reserves the field's name for the identity (the session's master); false also while the wallet signs */
  reserveName(identity: string): Promise<boolean>;
  /** the wallet's answer to the chat's challenge: false when the reply is not the chat's */
  onProofReply(r: WalletReply): Promise<boolean>;
  /** stops waiting for the wallet (the sheet's Cancel) */
  cancelProving(): void;
```

(replacing the old `reserveName(): Promise<boolean>`), and `wallet?` in `ChatDeps` (Interfaces above). Initial state `proving: null`. Replace the `reserveName` action with:

```ts
      reserveName: async (identity) => {
        const n = get().identity.name.trim();
        try {
          const r = await d.client.reserveName(n, identity);
          set({ identity: await d.identity.save({ name: r.name, reservedName: r.name, nameKey: r.key }), identityError: '', proving: null });
          return true;
        } catch (e) {
          // as the site: a 409 asks for the wallet's signature, whatever it says
          if (!(e instanceof OffchainError && e.status === 409) || !d.wallet) {
            set({ identityError: say(e) });
            return false;
          }
        }
        const launched = await act(async () => {
          const challenge = await d.client.nameChallenge();
          const state = d.wallet!.randomHex(16);
          const { chainId, remote } = d.wallet!.network();
          set({ proving: { state, name: n, identity } });
          await d.wallet!.open(buildChallengeLink({ challenge, signer: identity, chainid: chainId, rpc: remote, callback: CALLBACK_URL, state }));
        }, 'identityError');
        if (!launched) set({ proving: null }); // no wallet opened: nothing to wait for
        return false;
      },
      cancelProving: () => set({ proving: null }),
      onProofReply: async (r) => {
        const p = get().proving;
        if (!p || r.state !== p.state) return false;
        set({ proving: null });
        if (r.status === 'cancelled') return true;
        if (r.status === 'error') {
          set({ identityError: walletRefusal(r.code) });
          return true;
        }
        await act(async () => {
          const got = await d.client.proveName(p.name, proofFromReply(r, p.identity));
          set({ identity: await d.identity.save({ name: got.name, reservedName: got.name, nameKey: got.key }) });
        }, 'identityError');
        return true;
      },
```

with, next to `say`:

```ts
/** The wallet's refusal of a challenge, in words for the sheet. */
const walletRefusal = (code: string) =>
  code === 'signer_unavailable'
    ? 'Your computer could not sign: run gnokey-pair with a gnokey that has sign-data, then try again.'
    : code === 'network_declined'
      ? 'The wallet is on another network than the app.'
      : `The wallet refused (${code || 'no reason given'}).`;
```

`say(e)` must also cover the plain `Error` that `proofFromReply` throws: change it to

```ts
const say = (e: unknown) =>
  e instanceof OffchainError ? (e.status !== 0 ? e.message : 'The chat server did not answer — try again.')
    : e instanceof Error ? e.message : 'The chat server did not answer — try again.';
```

(and check the existing `say` tests still hold: a network failure is an `OffchainError(0, …)`). Imports: `buildChallengeLink, CALLBACK_URL, type WalletReply` from `@/session/gnoconnect`, `proofFromReply` from `./name-proof`.

Run `npx jest src/offchain/chat`: PASS.

- [ ] **Step 5: Wire the wallet, route the reply**

`src/state/app-services.tsx`, in `createChatStore({ … })` add:

```ts
      wallet: {
        open: (url) => Linking.openURL(url).then(() => undefined),
        randomHex,
        network: () => net.current(),
      },
```

(`net` is created above; `net.current()` returns `{ chainId, remote }`.)

`src/app/session-callback.tsx`: take `chat` from `useServices()` and replace the dispatch with:

```ts
    const reply = parseReplyEntries(entries);
    void (async () => {
      if (reply && (await chat.getState().onProofReply(reply).catch(() => false))) {
        router.replace('/chat');
        return;
      }
      if (reply) await session.getState().onReply(reply).catch(() => undefined);
      router.replace('/session');
    })();
```

(The route of the chat tab: `ls src/app/\(tabs\)` — use its path, `/chat`.)

- [ ] **Step 6: The sheet**

`IdentitySheet` takes `identity: string` (the session's master, `''` without a session) instead of `canReserve`; `canReserve = !!identity`. `index.tsx` passes `identity={active?.master ?? ''}` (check the field name on the session store's `active`). Reserve calls `store.getState().reserveName(identity)`. While `proving` (from `useStore(store, (s) => s.proving)`): the button reads "Waiting for your wallet…", disabled, with a secondary "Cancel" calling `store.getState().cancelProving()`. The note becomes:

```tsx
{canReserve
  ? 'A reserved name is yours alone and your lines carry a ✓. Your wallet signs a phrase on your computer — or boop from this app, then reserve within 3 minutes.'
  : 'Reserving needs a session (Session tab).'}
```

Update `identity-sheet.test.tsx` to the new prop and copy; add one test that a `proving` store shows "Waiting for your wallet…".

- [ ] **Step 7: Run everything, lint, typecheck**

```bash
npx jest 2>&1 | tail -5
npx expo lint && npx tsc --noEmit
```

Expected: all suites pass; lint zero warnings; tsc clean.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat(chat): reserve a name through the wallet — the phrase signed on the computer, as the site"
```

---

### Task 8: Fake server and e2e — the site's rules, a real signature check

**Files:**
- Modify: `scripts/fake-offchain/server.ts`
- Create: `e2e/test-wallet.ts`
- Modify: `e2e/chat.e2e.test.ts`, `e2e/fake-offchain.e2e.test.ts` (fidelity of the new answers)

**Interfaces:**
- Consumes: Task 7's store (`reserveName(identity)`, `onProofReply`, `ChatDeps.wallet`), Task 6's `WalletReply` fields.
- Produces: `newTestWallet(): { address: string; answer(link: string): WalletReply }` (Node `crypto`, a fresh secp256k1 key).

- [ ] **Step 1: Failing e2e**

`e2e/test-wallet.ts`:

```ts
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

import { bech32 } from 'bech32';

import type { WalletReply } from '../src/session/gnoconnect';
import { base64url } from '../src/utils/base64url';

const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');

/** A wallet whose identity key is here: it answers a challenge link as gnokey-mobile does. */
export function newTestWallet() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x!, 'base64url'), y = Buffer.from(jwk.y!, 'base64url');
  const pub = Buffer.concat([Buffer.from([y[31] & 1 ? 3 : 2]), x]);
  const address = bech32.encode('g', bech32.toWords(createHash('ripemd160').update(createHash('sha256').update(pub).digest()).digest()));
  // a gpub is a protobuf Any: "/tm.PubKeySecp256k1", then the 33-byte key (as `gnokey list` prints it)
  const anyPrefix = Buffer.concat([Buffer.from([0x0a, 0x13]), Buffer.from('/tm.PubKeySecp256k1'), Buffer.from([0x12, 0x23, 0x0a, 0x21])]);
  const gpub = bech32.encode('gpub', bech32.toWords(Buffer.concat([anyPrefix, pub])), 1023);
  const answer = (link: string): WalletReply => {
    const q = new URL(link.replace('land.gno.gnokey://', 'https://x/')).searchParams;
    const doc = JSON.stringify({
      account_number: '0', chain_id: q.get('chainid'), fee: { amount: [], gas: '0' }, memo: '',
      msgs: [{ type: 'sign/MsgSignData', value: { data: Buffer.from(q.get('challenge')!, 'utf8').toString('base64'), signer: address } }],
      sequence: '0',
    }); // keys already in sorted order; base64 and bech32 need no escaping
    const raw = sign('sha256', Buffer.from(doc), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    let s = BigInt('0x' + raw.subarray(32).toString('hex'));
    if (s > N / 2n) s = N - s;
    const sig = Buffer.concat([raw.subarray(0, 32), Buffer.from(s.toString(16).padStart(64, '0'), 'hex')]);
    return {
      status: 'success', code: '', state: q.get('state')!, address, session: '', expiresAt: 0, allow: [], spend: '',
      period: 0, chainid: q.get('chainid')!, hash: '', revoked: '', pubkey: gpub,
      signed: base64url(Buffer.from(doc)), signature: base64url(sig),
    };
  };
  return { address, answer };
}
```

In `e2e/chat.e2e.test.ts`, give `app()` a wallet that records the links it is asked to open:

```ts
import { randomBytes } from 'node:crypto';
import { newTestWallet } from './test-wallet';

function app(bid: string) {
  // … as today, then:
  const opened: string[] = [];
  const wallet = {
    open: async (url: string) => void opened.push(url),
    randomHex: (n: number) => randomBytes(n / 2).toString('hex'),
    network: () => ({ chainId: 'dev', remote: 'http://127.0.0.1:26657' }),
  };
  const store = createChatStore({ client, identity, kv: /* as today */, wallet });
  return { store, client, identity, opened };
}
```

and replace the boop test with:

```ts
test('the wallet signs the phrase, then the name is reserved and its lines carry the mark', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  const w = newTestWallet();
  await ann.store.ready;
  await ann.store.getState().setName('Ann');
  expect(await ann.store.getState().reserveName(w.address)).toBe(false);
  expect(ann.opened).toHaveLength(1);
  expect(await ann.store.getState().onProofReply(w.answer(ann.opened[0]))).toBe(true);
  expect(ann.store.getState().identity.reservedName).toBe('Ann');
  expect(await ann.store.getState().send('signed')).toBe(true);
  expect(ann.store.getState().lines.at(-1)).toMatchObject({ name: 'Ann', reserved: true });

  // released, the name is anyone's again
  await ann.store.getState().releaseName();
  const bob = app('bbbbbbbbbbbbbbbb');
  await bob.store.ready;
  await bob.store.getState().setName('ann');
  expect(await bob.store.getState().send('fake')).toBe(true); // released: free again
});

test('a boop from the last 3 minutes reserves without the wallet', async () => {
  const ann = app('aaaaaaaaaaaaaaaa');
  await ann.store.ready;
  await ann.store.getState().setName('Ann');
  await ann.client.reportBoop('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5', 1, 1, 6);
  expect(await ann.store.getState().reserveName('g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5')).toBe(true);
  expect(ann.opened).toHaveLength(0);
});

test('a wallet that already holds a name is told so after signing', async () => {
  const w = newTestWallet();
  const ann = app('aaaaaaaaaaaaaaaa');
  await ann.store.ready;
  await ann.store.getState().setName('Ann');
  await ann.store.getState().reserveName(w.address);
  await ann.store.getState().onProofReply(w.answer(ann.opened[0]));
  const again = app('cccccccccccccccc');
  await again.store.ready;
  await again.store.getState().setName('Other');
  await again.store.getState().reserveName(w.address);
  expect(await again.store.getState().onProofReply(w.answer(again.opened[0]))).toBe(true);
  expect(again.store.getState().identityError).toMatch(/holds the name Ann already/);
});
```

Run: `npm run e2e:chat` — FAIL (the fake server has no challenge, ignores proofs).

- [ ] **Step 2: Fake server**

In `server.ts`: `boops` becomes `Map<string, { addr: string; at: number }>` (set `{ addr, at: now() }` in the boop route); add `const challenges = new Set<string>();` and a `proves(body, addr)` helper:

```ts
import { createHash, createPublicKey, ECDH, randomBytes, verify } from 'node:crypto';
import { bech32 } from 'bech32';

const addressOf = (pub: Buffer) =>
  bech32.encode('g', bech32.toWords(createHash('ripemd160').update(createHash('sha256').update(pub).digest()).digest()));

/** The site's proof check, as seen from outside: the key's address must be addr, the phrase one we handed out. */
function proofError(body: Record<string, any>, addr: string, challenges: Set<string>): string {
  try {
    const pub = Buffer.from(String(body.pub), 'base64');
    if (pub.length !== 33) return 'that key is not a key';
    const owner = addressOf(pub);
    if (owner !== addr) return `that signature does not prove this wallet: that key belongs to ${owner.slice(0, 8)}`;
    const doc = JSON.parse(String(body.doc));
    const msg = doc?.msgs?.[0]?.value;
    const words = Buffer.from(String(msg?.data ?? ''), 'base64').toString('utf8');
    if (msg?.signer !== addr || !challenges.has(words)) return 'that phrase is not one this box handed out';
    const un = ECDH.convertKey(pub, 'secp256k1', undefined, undefined, 'uncompressed') as Buffer;
    const key = createPublicKey({ key: { kty: 'EC', crv: 'secp256k1', x: un.subarray(1, 33).toString('base64url'), y: un.subarray(33).toString('base64url') }, format: 'jwk' });
    if (!verify('sha256', Buffer.from(String(body.doc)), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(String(body.sig), 'base64'))) return 'that signature does not check out';
    challenges.delete(words);
    return '';
  } catch {
    return 'that proof is unreadable';
  }
}
```

Routes:

```ts
      if (route === 'GET /api/name/challenge') {
        const words = `fake: prove this wallet is yours · ${randomBytes(12).toString('base64url')}`;
        challenges.add(words);
        return send(res, 200, { words });
      }

      if (route === 'POST /api/name') {
        const addr = String(body.addr ?? '');
        if (!/^g1[0-9a-z]{38}$/.test(addr)) return send(res, 400, { error: 'connect your wallet first' });
        const held = [...names.values()].find((e) => e.addr === addr);
        if (held) return send(res, 409, { error: `this wallet holds the name ${held.name} already — one name a wallet` });
        const boop = boops.get(bid);
        const booped = boop?.addr === addr && now() - boop.at <= 180;
        if (!booped) {
          if (!body.doc) return send(res, 409, { error: 'Connect your wallet and let it sign the phrase this page asks for — a boop from the last 3 minutes does the same.' });
          const why = proofError(body, addr, challenges);
          if (why) return send(res, 409, { error: why });
        }
        const name = String(body.name ?? '').trim();
        if (!name || name.length > 32) return send(res, 400, { error: 'a name of 1 to 32 characters' });
        const taken = names.get(fold(name));
        if (taken && taken.addr !== addr) return send(res, 409, { error: 'that name or a look-alike is taken' });
        const entry = { name, key: randomBytes(16).toString('hex'), addr };
        names.set(fold(name), entry);
        return send(res, 200, entry);
      }
```

(The key is 32 hex characters, as production's was on 2026-10-12.) Update the file's header comment: the name rules were read again on 2026-10-12.

- [ ] **Step 3: Fidelity** — in `e2e/fake-offchain.e2e.test.ts` add a check that `GET /api/name/challenge` answers `{ words: string }`, as production does (`{"words":"gno.world: prove this wallet is yours · …"}`).

- [ ] **Step 4: Run** — `npm run e2e:chat` then `npx jest` then `npx expo lint && npx tsc --noEmit`. Expected: all pass, zero warnings.

- [ ] **Step 5: Commit**

```bash
git add scripts/fake-offchain e2e
git commit -m "test(chat): the fake server checks the wallet's proof; e2e reserves through a test wallet"
```

---

### Task 9: End to end, docs, and the user's check on production

**Files:**
- Modify: `docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` (§9)
- Modify: `docs/superpowers/specs/2026-10-12-gnoconnect-challenge-design.md` (status line)

- [ ] **Step 1: iOS simulator round trip (fake server)** — gnokey-mobile and the app installed on the iOS 26.5 simulator (memory: ios-simulator-driving), fake server on 8787 (`npm run fake-offchain`), app Settings → off-chain server `http://127.0.0.1:8787`, a session active. On the Mac: `gnokey-pair -remote http://127.0.0.1:26657` (the rebased gnokey-pair, `$GOBIN/gnokey` with sign-data, a key for the session's master). In the app: Chat → you → name → Reserve. Expected: gnokey-mobile opens "Prove your identity" with the phrase; "Scan or type the code" with gnokey-pair's code; gnokey-pair shows the text and asks `Sign?`; after `y` and the password, the phone returns to the app, the sheet shows "✓ yours". Take screenshots of the three screens.

- [ ] **Step 2: Android emulator round trip** — the same on `Medium_Phone` (memory: android-emulator-driving: `adb reverse tcp:8787 tcp:8787`, arm64 build).

- [ ] **Step 3: The user's check on production** — ask the user to reserve a free name on production from the app, with an identity that holds no name yet (`remi` holds `remi` already). Record the outcome in §9 of the parent spec.

- [ ] **Step 4: Docs** — parent spec §9: "Réservation du nom 100 % mobile : `connect` + `challenge` (spec 2026-10-12), gnokey sign-data, gnokey-pair `data`, gnokey-mobile iOS/Android ; vérifiée sur simulateur, émulateur, et par l'utilisateur sur la production le …". Challenge spec: a "Statut" line with the commits of each repo. Commit:

```bash
git add docs/superpowers/specs
git commit -m "docs: §9 — the name is reserved from the phone, through connect + challenge"
```

- [ ] **Step 5: Publishing** — list for the user what is local and unpushed (standard #5970 and #6016 branches, gnokey-mobile `feat/send-to-computer`, gno branches if not pushed in Task 3) and push only what they approve.

---

## Corrections to make (final review, 2026-10-13)

The whole-branch review found no Critical issue. The user asked to make the fixes later; each one gets
a failing test first when it is made. Tasks 1–9 are done (ledger:
`.superpowers/sdd/2026-10-12-gnoconnect-challenge/progress.md`).

### Important

- [x] **I1 — The `signer` pin is not honored on a challenge `connect`** (spec §4 says `signer` resolves
  "as elsewhere"; the plan's request line had it, the standard commit dropped it). Standard
  (`~/gno-external-wallets`, request line ~478 and the Parameters table's `signer` row, "—" for an
  identity `connect`): make `signer` optional on an identity `connect` and put it in the request line.
  `core.ParseChallenge` (or a sibling) returns the pin. iOS and Android preselect or lock the pinned
  account, and answer `signer_unavailable` when it is not held. Today the user can go through the
  whole computer ceremony with the wrong account, and only then does the app say "choose that account".
- [x] **I2 — The standard's producer guidance leaves out the essential check** ("Proving the identity",
  last paragraph): add that the producer verifies `signed` as a sign-data document
  (`std.VerifySignData` or the same shape checks), with data equal to its own unused challenge and
  signer equal to `address`. Without it, a producer could accept any public signature by that key
  (a tx signature replayed from the chain).
- [x] **I3 — iOS: a cold launch can refuse every `connect` with `invalid_request`**, the plain sign-in
  too (`ios/GnokeyMobile/Core/AppModel.swift` ~446–454). `parseChallenge` runs before the bridge is up;
  a nil bridge gives `[internal]`, which `?? "invalid_request"` turns into a refusal. Fix: wait for the
  bridge as Android does (park the URL like `parkedSessionURL`), or call `parseChallenge` only when
  `parsed.challenge` is non-empty and treat a non-protocol error as "not ready". Add a cold-launch
  round trip to the manual checks.
- [x] **I4 — Android: a refusal after the signature is not visible.** Back from the wallet, the app
  lands on Chat with the name sheet closed, so "holds the name … already" or "taken" shows only when
  the sheet is reopened (`src/app/session-callback.tsx` `router.replace('/chat')`, and the `sheet`
  state in `src/screens/chat/index.tsx`). Fix: reopen the sheet after a proof reply (e.g.
  `/chat?identity=1`), or show the error on the chat screen.

### Minor

- [x] **M1** — The wallet never answers `signer_unavailable` (spec §6): after a failure on the computer
  it shows the error and the user's Cancel gives the app a silent `cancelled`, so the app's
  `walletRefusal('signer_unavailable')` never fires. Either align spec §6, or answer
  `signer_unavailable` on Decline after such a failure.
- [x] **M2** — `approveConnect(proof:)` answers with `draft.masterAddress` rather than the identity the
  proof was verified for, and `AccountMenu` stays usable while the computer signs (iOS
  `AppModel.swift` ~690, Android `AppViewModel.kt` ~660). Carry the identity in `ConnectProofInfo`;
  the `sessionKey == nil → no_signer` guard does not apply to the proof path.
- [x] **M3** — The challenge sheet still says "Identity to reveal" with a Session row and
  `SessionSummary` ("Not on chain" seen in Task 9), though the reply carries no session: hide them
  with a challenge.
- [x] **M4** — Android `BridgeClient.kt` ~350: the KDoc "The scope hints of an identity-only
  `connect`…" sits above `parseChallenge`; move it back above `parseScopeHints`.
- [x] **M5** — The app does not compare the reply's `chainid` with the chain it asked for
  (`name-proof.ts` / `store.ts` `onProofReply`); a local check gives a clear message.
- [x] **M6** — `proving` lives only in memory: if the OS evicts the app during the minutes at the
  computer, the valid proof is ignored and the user lands on Session without a word. Persist
  `{state, name, identity}` as the session store persists `pending`.

Done 2026-10-13, each with a test that failed first (ledger has the commits and checks): I1/I2
standard `a548c81b7` (#6016 rebased), gnokey-mobile `caaa012`, `5302bc9`, `41c102a`; I3 `5302bc9`,
checked by cold launches on the simulator; I4 app `004b956`; M1/M3 `c119736`; M2 with I1; the final review's Important (a pin re-checked after onboarding) `d29b60e`; M4 `41c102a`;
M5 `21799f1`; M6 `8f78391`.

### Recommendation (not a fix)

- The wallet could warn when the challenge text names no part of the callback's host (a cheap
  anti-relay hint); the standard could make it a SHOULD.
