# P1 — gnonative `SignBytes` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a gnonative app sign arbitrary bytes with an activated key, and activate a key as a session of a master from TypeScript, so the Bubble Rumble dapp can produce GnoConnect proofs of possession and sign as a session.

**Architecture:** A new unary RPC `SignBytes` on `GnoNativeService`, whose messages are amino types in `api/gnonativetypes` (the `.proto` for them is generated). The service reuses the activated account's `SignerFromKeybase` (keybase, key name, password) and calls `Keybase.Sign`. The Expo module gains `signBytes()` and an optional `master` argument on `activateAccount()`.

**Tech Stack:** Go 1.25 (`.tool-versions`), connectrpc, amino genproto, buf 1.55.1, TypeScript (Expo module), gomobile.

**Spec:** `docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` §3 (in `~/bubblerumble`).

## Global Constraints

- Repository `~/gnonative`, branch `feat/sign-bytes` (based on `origin/main`, already created). Check it out before Task 1: `git -C ~/gnonative switch feat/sign-bytes`. The working tree has an untracked `docs/errdetails-next-steps.md` from another branch; leave it untracked and never add it.
- Signature format is tm2's: `Keybase.Sign(name, password, data)` → secp256k1 ECDSA over SHA-256, 64 bytes `R‖S`. Do not hash or prefix the data again.
- `pub_key` in the response is `PubKey.Bytes()` (amino), the same encoding as `KeyInfo.pub_key`.
- No other gnonative changes (spec §3 "Hors périmètre").
- Commits authored with the repository's existing identity; no attribution trailer.

## Review Focus

- A `SignBytes` call for an address that was never activated → `ErrCode_ErrNoActiveAccount`, never a panic (pinned in Task 1).
- A `SignBytes` call before `SetPassword` (key activated, password empty) → a decryption error surfaced as a typed error, not a signature with an empty password (pinned in Task 1).
- Empty `data` → a valid signature over the empty byte string; the chain-side verifier accepts it (pinned in Task 1).
- `activateAccount(name)` without `master` after a previous `activateAccount(name, master)` must clear the master (the Go side already does; the TS wrapper must send `undefined`, not an empty array) (pinned in Task 2).
- `npm pack` must ship the rebuilt native frameworks, not stale ones: a tarball whose framework lacks the new RPC fails only at runtime on device (pinned in Task 3).

---

### Task 1: `SignBytes` RPC in the Go service

**Files:**
- Modify: `api/gnonativetypes/gnonativetypes.go` (after `SignTxResponse`, ~line 400)
- Modify: `api/gnonativetypes/package.go` (type list, after `SignTxResponse{},`)
- Modify: `api/rpc.proto` (after `rpc SignTx(...)`, ~line 205)
- Regenerated: `api/gnonativetypes.proto`, `api/gen/go/*.pb.go`, `api/gen/go/_goconnect/*.connect.go`, `api/gen/es/*`, `gen.sum`
- Modify: `service/api.go` (after `ClientSignTx`, ~line 1155)
- Create: `service/signbytes_test.go`

**Interfaces:**
- Produces: `func (s *gnoNativeService) SignBytes(ctx context.Context, req *connect.Request[api_gen.SignBytesRequest]) (*connect.Response[api_gen.SignBytesResponse], error)`; proto messages `SignBytesRequest{address bytes=1; data bytes=2}`, `SignBytesResponse{signature bytes=1; pub_key bytes=2}`; generated TS types `SignBytesRequest`, `SignBytesResponse` in `api/gen/es/gnonativetypes_pb.ts` and method `signBytes` on `GnoNativeService` in `api/gen/es/rpc_pb.ts`.

- [ ] **Step 1: Add the amino types**

In `api/gnonativetypes/gnonativetypes.go`, right after `type SignTxResponse struct { ... }`:

```go
type SignBytesRequest struct {
	// The address of the activated account whose key signs
	Address []byte `json:"address" yaml:"address"`
	// The bytes to sign, as given (the key's scheme hashes them, e.g. SHA-256 for secp256k1)
	Data []byte `json:"data" yaml:"data"`
}

type SignBytesResponse struct {
	// The signature, in the key's scheme (64 bytes R||S for secp256k1)
	Signature []byte `json:"signature" yaml:"signature"`
	// The signing key's public key, amino-encoded like KeyInfo.pub_key
	PubKey []byte `json:"pub_key" yaml:"pub_key"`
}
```

In `api/gnonativetypes/package.go`, after the line `SignTxResponse{},` add:

```go
	SignBytesRequest{},
	SignBytesResponse{},
```

- [ ] **Step 2: Declare the RPC**

In `api/rpc.proto`, right after the `rpc SignTx(SignTxRequest) returns (SignTxResponse);` line:

```proto
  // Sign arbitrary bytes with the key of the activated account with the given address.
  // The bytes are signed as given, in the key's scheme (secp256k1: ECDSA over SHA-256, 64 bytes R||S).
  // If there is no activated account with the given address, return [ErrCode](#land.gno.gnonative.v1.ErrCode).ErrNoActiveAccount.
  // If the password is wrong or unset, return [ErrCode](#land.gno.gnonative.v1.ErrCode).ErrDecryptionFailed.
  rpc SignBytes(SignBytesRequest) returns (SignBytesResponse);
```

- [ ] **Step 3: Regenerate**

Run: `cd ~/gnonative && make generate`
Expected: `api/gnonativetypes.proto` now contains `message SignBytesRequest` and `message SignBytesResponse`; `grep -n SignBytes api/gen/go/_goconnect/*.connect.go api/gen/es/rpc_pb.ts` shows the new method; `go build ./...` fails with `*gnoNativeService does not implement ... (missing method SignBytes)`.

- [ ] **Step 4: Write the failing tests**

Create `service/signbytes_test.go`:

```go
package service

import (
	"context"
	"errors"
	"testing"

	"connectrpc.com/connect"
	"github.com/gnolang/gno/tm2/pkg/crypto/keys"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	api_gen "github.com/gnolang/gnonative/v4/api/gen/go"
)

// gno's integration test seed (gno.land/pkg/integration DefaultAccount_Seed).
const testMnemonic = "source bonus chronic canvas draft south burst lottery vacant surface solve popular case indicate oppose farm nothing bullet exhibit title speed wink action roast"

func newTestService(t *testing.T) *gnoNativeService {
	t.Helper()
	return &gnoNativeService{
		logger:       zap.NewNop(),
		keybase:      keys.NewInMemory(),
		userAccounts: map[string]*userAccount{},
	}
}

// activated creates key "sess" with password "pw", activates it and, if setPassword, sets the password.
func activated(t *testing.T, s *gnoNativeService, setPassword bool) keys.Info {
	t.Helper()
	ctx := context.Background()
	info, err := s.keybase.CreateAccount("sess", testMnemonic, "", "pw", 0, 0)
	require.NoError(t, err)
	_, err = s.ActivateAccount(ctx, connect.NewRequest(&api_gen.ActivateAccountRequest{NameOrBech32: "sess"}))
	require.NoError(t, err)
	if setPassword {
		_, err = s.SetPassword(ctx, connect.NewRequest(&api_gen.SetPasswordRequest{Password: "pw", Address: info.GetAddress().Bytes()}))
		require.NoError(t, err)
	}
	return info
}

func TestSignBytes(t *testing.T) {
	s := newTestService(t)
	info := activated(t, s, true)
	data := []byte("gnoconnect-session-v1\nhost=createsession\nstate=ab+c=")

	res, err := s.SignBytes(context.Background(), connect.NewRequest(&api_gen.SignBytesRequest{
		Address: info.GetAddress().Bytes(),
		Data:    data,
	}))
	require.NoError(t, err)
	assert.Len(t, res.Msg.Signature, 64)
	assert.Equal(t, info.GetPubKey().Bytes(), res.Msg.PubKey)
	assert.True(t, info.GetPubKey().VerifyBytes(data, res.Msg.Signature), "signature must verify over the raw data")
	assert.False(t, info.GetPubKey().VerifyBytes([]byte("other"), res.Msg.Signature))
}

func TestSignBytesEmptyData(t *testing.T) {
	s := newTestService(t)
	info := activated(t, s, true)

	res, err := s.SignBytes(context.Background(), connect.NewRequest(&api_gen.SignBytesRequest{
		Address: info.GetAddress().Bytes(),
	}))
	require.NoError(t, err)
	assert.True(t, info.GetPubKey().VerifyBytes([]byte{}, res.Msg.Signature))
}

func TestSignBytesNoActiveAccount(t *testing.T) {
	s := newTestService(t)
	info, err := s.keybase.CreateAccount("sess", testMnemonic, "", "pw", 0, 0)
	require.NoError(t, err)

	_, err = s.SignBytes(context.Background(), connect.NewRequest(&api_gen.SignBytesRequest{
		Address: info.GetAddress().Bytes(),
		Data:    []byte("x"),
	}))
	require.Error(t, err)
	assert.True(t, errors.Is(err, api_gen.ErrCode_ErrNoActiveAccount), "got %v", err)
}

func TestSignBytesPasswordUnset(t *testing.T) {
	s := newTestService(t)
	info := activated(t, s, false)

	_, err := s.SignBytes(context.Background(), connect.NewRequest(&api_gen.SignBytesRequest{
		Address: info.GetAddress().Bytes(),
		Data:    []byte("x"),
	}))
	require.Error(t, err)
	assert.True(t, errors.Is(err, api_gen.ErrCode_ErrDecryptionFailed), "got %v", err)
}
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `cd ~/gnonative && go test ./service/ -run TestSignBytes -v`
Expected: build failure `s.SignBytes undefined (type *gnoNativeService has no field or method SignBytes)`.

- [ ] **Step 6: Implement**

In `service/api.go`, after `ClientSignTx`:

```go
func (s *gnoNativeService) SignBytes(ctx context.Context, req *connect.Request[api_gen.SignBytesRequest]) (*connect.Response[api_gen.SignBytesResponse], error) {
	signer, err := s.getSigner(req.Msg.Address)
	if err != nil {
		return nil, err
	}

	data := req.Msg.Data
	if data == nil {
		data = []byte{}
	}
	sig, pub, err := signer.Keybase.Sign(signer.Account, signer.Password, data)
	if err != nil {
		return nil, getGrpcError(err)
	}

	return connect.NewResponse(&api_gen.SignBytesResponse{
		Signature: sig,
		PubKey:    pub.Bytes(),
	}), nil
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd ~/gnonative && go test ./service/ -run TestSignBytes -v`
Expected: 4 tests PASS. If `TestSignBytesPasswordUnset` fails because `getGrpcError` maps the empty-password error to another code, print the error (`t.Logf("%v", err)`), check `getGrpcError` in `service/` for the wrong-password mapping (`keyerror.IsErrWrongPassword`), and map the keybase's empty/invalid-password error to `ErrCode_ErrDecryptionFailed` there — do not loosen the assertion.

- [ ] **Step 8: Full Go checks and commit**

Run: `cd ~/gnonative && go build ./... && go vet ./service/ && go test ./service/`
Expected: no errors.

```bash
cd ~/gnonative
git add api/gnonativetypes/gnonativetypes.go api/gnonativetypes/package.go api/rpc.proto api/gnonativetypes.proto api/gen gen.sum service/api.go service/signbytes_test.go go.mod go.sum
git commit -m "feat(api): add SignBytes to sign arbitrary bytes with an activated key"
```

### Task 2: Expo module — `signBytes` and `activateAccount(…, master)`

**Files:**
- Regenerated: `expo/src/api/vendor/*` (copy of `api/gen/es`)
- Modify: `expo/src/api/types.ts` (imports; `GnoKeyApi.activateAccount`; new `signBytes`)
- Modify: `expo/src/api/GnoNativeApi.ts` (imports; `activateAccount` ~line 325; new `signBytes` after `signTx` ~line 112)

**Interfaces:**
- Consumes: generated `SignBytesResponse`, `GnoNativeService.signBytes` (Task 1).
- Produces (TypeScript, used by the dapp):
  - `activateAccount(nameOrBech32: string, master?: Uint8Array): Promise<ActivateAccountResponse>`
  - `signBytes(address: Uint8Array, data: Uint8Array): Promise<SignBytesResponse>` where `SignBytesResponse = { signature: Uint8Array; pubKey: Uint8Array }`

- [ ] **Step 1: Refresh the vendored generated code**

Run: `cd ~/gnonative/expo && make clean.api && make build.api && grep -c SignBytes src/api/vendor/gnonativetypes_pb.ts src/api/vendor/rpc_pb.ts`
Expected: both counts ≥ 1.

- [ ] **Step 2: Update the interface (`expo/src/api/types.ts`)**

Add `SignBytesResponse,` to the import list from `'./vendor/gnonativetypes_pb'`. Replace the `activateAccount` line with:

```ts
  activateAccount: (nameOrBech32: string, master?: Uint8Array) => Promise<ActivateAccountResponse>;
```

After the `signTx(...)` declaration add:

```ts
  signBytes(address: Uint8Array, data: Uint8Array): Promise<SignBytesResponse>;
```

- [ ] **Step 3: Update the implementation (`expo/src/api/GnoNativeApi.ts`)**

Add `SignBytesResponse,` to the import list from `'./vendor/gnonativetypes_pb'`. Replace `activateAccount`:

```ts
  async activateAccount(nameOrBech32: string, master?: Uint8Array): Promise<ActivateAccountResponse> {
    const client = this.#getClient();
    // An absent master activates the key as an ordinary account (the service clears any previous master).
    const response = client.activateAccount(master ? { nameOrBech32, master } : { nameOrBech32 });
    return response;
  }
```

After `signTx(...)`:

```ts
  async signBytes(address: Uint8Array, data: Uint8Array): Promise<SignBytesResponse> {
    const client = this.#getClient();
    return client.signBytes({ address, data });
  }
```

- [ ] **Step 4: Typecheck**

Run: `cd ~/gnonative/expo && npm install && npx tsc --noEmit -p .`
Expected: no errors. (If `npm install` was already done, skip it.)

- [ ] **Step 5: Commit**

```bash
cd ~/gnonative
git add expo/src/api/types.ts expo/src/api/GnoNativeApi.ts expo/src/api/vendor
git commit -m "feat(expo): expose signBytes and the master of activateAccount"
```

### Task 3: Build the native frameworks and pack the module

**Files:**
- No source changes. Produces `~/gnonative/expo/gnolang-gnonative-<version>.tgz` (not committed).

**Interfaces:**
- Produces: the tarball the dapp installs (P3-M1 Task 2): path `~/gnonative/expo/gnolang-gnonative-<version>.tgz`, where `<version>` is `expo/package.json` `version`.

- [ ] **Step 1: Build frameworks from this branch**

Run: `cd ~/gnonative/expo && make clean.ios clean.android && make build`
Expected: completes; `ls ios/*.xcframework android/libs/*.aar` (or the paths printed by the Makefile's `IOS_FRAMEWORK_DST` / `ANDROID_FRAMEWORK_DST`) lists freshly dated files. gomobile/gobind are built by the root Makefile's `bind.init` from `go.mod`; it needs `ANDROID_HOME` / `ANDROID_NDK_HOME` (NDK present under `~/Library/Android/sdk/ndk`).

- [ ] **Step 2: Prove the frameworks contain the new RPC**

Run: `cd ~/gnonative/expo && strings $(find ios -name 'GnoCore' -type f | head -1) | grep -c SignBytes`
Expected: ≥ 1. (If the binary name differs, use `find ios -path '*xcframework*' -type f -size +1M`.) A 0 here means the build used stale Go code: rerun Step 1.

- [ ] **Step 3: Pack**

Run: `cd ~/gnonative/expo && npm run build && npm pack && tar -tzf gnolang-gnonative-*.tgz | grep -E 'xcframework|\.aar|build/index.js' | head`
Expected: the tarball lists the iOS framework, the Android aar and `build/index.js`.

- [ ] **Step 4: Record the tarball path**

Print and keep: `ls -1 ~/gnonative/expo/gnolang-gnonative-*.tgz`. No commit (build artefact). If `.gitignore` does not already ignore `*.tgz` in `expo/`, do not change it; just never `git add` the tarball.
