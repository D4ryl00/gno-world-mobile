# Adena `connect({challenge})` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adena's GnoConnect in-page provider answers `connect({challenge, signer?, chainid?})` with the identity, its gpub and a sign-data proof, by reusing upstream's `SignArbitrary`, after rebasing the fork onto upstream `main`.

**Architecture:** The fork (`~/adena-wallet`, `feat/gnoconnect-in-page`) is rebased onto `upstream/main`, which brings `SignArbitrary` (#931, #943). A new SDK-free module `inject/gnoconnect/challenge.ts` holds the rules, the gpub conversion and the flow, all driven through an injected `ChallengeSteps` interface, so jest can test it. `provider.ts` builds those steps from the executor (`addEstablish`, `getNetwork`/`switchNetwork`, `getAccount`, `signArbitrary`). The Playwright bench checks the whole path against the app's fake gno.world server.

**Tech Stack:** TypeScript, Jest 29 (jsdom), webpack, `adena-module` (`toBech32`), `@cosmjs/encoding` (`fromBase64`), Playwright 1.63 + Node 22 `node:test`, the app's `scripts/fake-offchain/server.ts`.

**Spec:** `docs/superpowers/specs/2026-10-13-adena-connect-challenge-design.md` (parent: `docs/superpowers/specs/2026-10-12-gnoconnect-challenge-design.md` §4, §8).

## Global Constraints

- Repos: `~/adena-wallet` (branch `feat/gnoconnect-in-page`, fork D4ryl00, remote `upstream` = onbloc), `~/gno-inpage-wallets` (branch `feat/gnoconnect-in-page-wallets`, #6016), `~/bubblerumble` (`main`, local). Nothing is pushed without the user's go-ahead.
- `challenge`: non-empty UTF-8, at most **4096 bytes**, no control character (C0, DEL, C1, as Go's `unicode.IsControl`); otherwise `invalid_request`. `pubkey` together with `challenge` → `invalid_request`.
- With a challenge the wallet **always asks**: upstream's `approve-sign-arbitrary` window, even for an already approved origin.
- The answer: `{address, chainid, pubkey: gpub, features (with "challenge"), proof: {signed, signature}}` — **no `session`**.
- Codes: a refusal of the signature → `Rejected` with no code; a pin other than the current account, `ACCOUNT_MISMATCH`, or an answer with no key/signature → `signer_unavailable`; a declined/unknown network → `network_declined`.
- No new background code, no new popup: approach 1 of the spec.
- The wallet stays dapp-agnostic (memory: wallet-dapp-agnostic): no `gno.world` in Adena code, tests or comments; use `example.com`.
- Adena specs colocate as `*.spec.ts`; anything importing `@adena-wallet/sdk` cannot load under jest (its native crypto fails under jsdom) — `challenge.ts` must not import `./response`, `./provider` or the executor.
- Comments at the length the codebase uses (short, one or two lines).

## Review Focus

1. A challenge of non-ASCII text near the limit — counted in UTF-8 bytes, not characters: 2048 × `é` (4096 bytes) passes, one more byte is refused (Task 2 test).
2. Control characters beyond `\n`: tab, DEL (U+007F) and C1 (U+0085) are refused, as Go refuses them (Task 2 test).
3. A pin written in upper case (`G1JG…`): the same identity, accepted, the proof made for the current (lower-case) address (Task 2 test).
4. After a network switch, the answer's `chainid` is the chain the document was signed for (`signed.chain_id`), never a stale one (Task 2 test).
5. `challenge: ''` or a non-string challenge is a bad challenge (`invalid_request`), not a plain `connect` (Task 2 test).

---

### Task 1: Rebase the fork onto upstream `main`

**Files:**
- No new files. Conflicts are resolved in place; record each one in the ledger.

**Interfaces:**
- Produces: `AdenaExecutor.signArbitrary(params: SignArbitraryParams): Promise<SignArbitraryResponse>` (upstream `src/inject/executor/executor.ts`), `SignArbitraryParams {signer: string; data: string}` and `SignArbitraryData {signed: TxSignPayload; signature: {pubKey: {typeUrl: string; value: string}; signature: string}}` (upstream `src/inject/types/sign-arbitrary.ts`), on the fork's branch.

- [ ] **Step 1: Record the baselines (failing tests by name) before touching anything**

```bash
cd ~/adena-wallet && git status --short   # expect only GNOCONNECT_ADENA_IMPLEMENTATION.md and dist-wallet2/ untracked
git fetch upstream
W=~/bubblerumble/.superpowers/sdd/2026-10-13-adena-connect-challenge; mkdir -p $W
(cd packages/adena-extension && npx jest --ci 2>&1 | grep -E "^(PASS|FAIL) " | sort > $W/ext-fork.txt)
(cd packages/adena-module && npx jest 2>&1 | grep -E "^(PASS|FAIL) " | sort > $W/module-fork.txt)
git worktree add /tmp/adena-upstream upstream/main && (cd /tmp/adena-upstream && yarn install --immutable >/dev/null && yarn build:module >/dev/null && cd packages/adena-extension && npx jest --ci 2>&1 | grep -E "^(PASS|FAIL) " | sort > $W/ext-upstream.txt)
grep -c FAIL $W/ext-fork.txt $W/ext-upstream.txt
```

Expected: the counts print (the fork had 32 known failures in `yarn test:ci` in August); the files list every suite as PASS or FAIL.

- [ ] **Step 2: Back up and rebase**

```bash
cd ~/adena-wallet
git branch backup/gnoconnect-in-page-before-sign-arbitrary
git rebase upstream/main
```

Expected: stops on conflicts. For each: keep the fork's behaviour, unless upstream fixed the same thing (then take upstream's), and add a ledger line `Task 1: conflict <file>: <what each side did> — kept <side>`. Likely files: `src/inject/message/command-handler.ts` and `gno-connect-allowlist.constant.ts` (upstream #884), `package.json`/`yarn.lock` (#899: take upstream's versions, then `yarn install`), `src/inject/executor/executor.ts` and `src/inject/message/message-handler.ts` (both sides add methods: keep both). `git rebase --continue` after each.

- [ ] **Step 3: Install, build and run the suites**

```bash
cd ~/adena-wallet && yarn install && yarn build:module && yarn build:service
W=~/bubblerumble/.superpowers/sdd/2026-10-13-adena-connect-challenge
(cd packages/adena-extension && npx jest --ci 2>&1 | grep -E "^(PASS|FAIL) " | sort > $W/ext-rebased.txt)
(cd packages/adena-module && npx jest 2>&1 | grep -E "^(PASS|FAIL) " | sort > $W/module-rebased.txt)
comm -13 <(cat $W/ext-fork.txt $W/ext-upstream.txt | grep FAIL | sort -u) <(grep FAIL $W/ext-rebased.txt)
comm -13 <(grep FAIL $W/module-fork.txt | sort -u) <(grep FAIL $W/module-rebased.txt)
(cd packages/adena-extension && npx jest --ci src/inject/gnoconnect src/inject/message 2>&1 | tail -5)
```

Expected: the build succeeds; both `comm` print nothing (no suite fails that failed in neither baseline); `src/inject/gnoconnect` and `src/inject/message` all pass, including upstream's `sign-arbitrary.spec.ts`.

- [ ] **Step 4: The bench, unchanged, on the rebased build**

```bash
cd ~/bubblerumble && (GNOROOT=$PWD/.e2e/gnoroot-5cdbc25fcde0 npm run gnodev > /tmp/gnodev-bench.log 2>&1 &)
until curl -s http://127.0.0.1:26657/status >/dev/null; do sleep 2; done
cd prototypes/inpage-sessions/bench && npm test 2>&1 | tail -8
```

Expected: `# pass 19`, `# fail 0`. A failure is a rebase regression: debug it (superpowers:systematic-debugging) before Task 2.

- [ ] **Step 5: Clean up the upstream worktree**

```bash
cd ~/adena-wallet && git worktree remove /tmp/adena-upstream
git log --oneline -1 && git rev-list --count upstream/main..HEAD
```

Expected: the branch tip, and `26` (the fork's commits, all kept), or fewer with a ledger ruling for each commit dropped because upstream already has it.

---

### Task 2: `challenge.ts` — the rules, the gpub and the flow (jest)

**Files:**
- Create: `~/adena-wallet/packages/adena-extension/src/inject/gnoconnect/challenge.ts`
- Create: `~/adena-wallet/packages/adena-extension/src/inject/gnoconnect/challenge.spec.ts`
- Modify: `~/adena-wallet/packages/adena-extension/src/inject/gnoconnect/types.ts` (`GnoAccount`, `GnoConnectOptions`)

**Interfaces:**
- Consumes: `GnoConnectRequestError` (`./errors`), `GnoAccount`, `GnoConnectOptions`, `UserResponse` (`./types`), `toBech32` (`adena-module`), `fromBase64` (`@cosmjs/encoding`).
- Produces:
  - `MAX_CHALLENGE_BYTES = 4096`
  - `validateChallenge(opts: GnoConnectOptions): string` — returns the challenge; throws `GnoConnectRequestError('invalid_request', …)`
  - `gpubFromCompressed(base64: string): string` — throws `GnoConnectRequestError('signer_unavailable', …)` unless 33 bytes
  - `interface SignedText { signed: { chain_id: string } & Record<string, unknown>; signature?: { pubKey?: { value?: string }; signature?: string } }`
  - `interface ChallengeSteps { establish(): Promise<UserResponse<null>>; resolveNetwork(chainid?: string): Promise<string>; currentAddress(): Promise<string>; sign(signer: string, data: string): Promise<UserResponse<SignedText>> }`
  - `connectWithChallenge(steps: ChallengeSteps, opts: GnoConnectOptions, features: string[]): Promise<UserResponse<GnoAccount>>`
  - `GnoAccount` gains `features?: string[]` and `proof?: { signed: Record<string, unknown>; signature: string }`; `GnoConnectOptions` gains `challenge?: string`.

- [ ] **Step 1: Write the failing tests**

`challenge.spec.ts`:

```ts
import { GnoConnectRequestError } from './errors';
import { decodeGpub } from './session-request';
import {
  ChallengeSteps,
  connectWithChallenge,
  gpubFromCompressed,
  MAX_CHALLENGE_BYTES,
  SignedText,
  validateChallenge,
} from './challenge';
import { UserResponse } from './types';

// test1, the key of gno's sign-data vectors (tm2/pkg/std/signdata_test.go).
const TEST1 = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
const TEST1_PUB = 'A+FhNtsXHjLfSJk1lB8FbiL4mGPjc50Kt81J7EKDnJ2y';
const FEATURES = ['sendtx', 'signtx', 'multi_msg', 'sessions', 'challenge'];
const CHALLENGE = 'example.com: prove this wallet is yours · 9UQV';

const signedFor = (chainId: string): UserResponse<SignedText> => ({
  status: 'Approved',
  args: {
    signed: { chain_id: chainId, msgs: [] },
    signature: { pubKey: { value: TEST1_PUB }, signature: 'c2ln' },
  },
});

function steps(over: Partial<ChallengeSteps> = {}): ChallengeSteps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    establish: async () => (calls.push('establish'), { status: 'Approved', args: null }),
    resolveNetwork: async (chainid) => (calls.push(`network ${chainid ?? ''}`), chainid ?? 'dev'),
    currentAddress: async () => (calls.push('account'), TEST1),
    sign: async (signer, data) => (calls.push(`sign ${signer} ${data}`), signedFor('dev')),
    ...over,
  };
}

describe('validateChallenge', () => {
  it('returns the text', () => {
    expect(validateChallenge({ challenge: CHALLENGE })).toBe(CHALLENGE);
  });

  it.each([
    ['empty', { challenge: '' }],
    ['not a string', { challenge: 7 as unknown as string }],
    ['with a key', { challenge: 'a', pubkey: 'gpub1x' }],
    ['a newline', { challenge: 'a\nb' }],
    ['a tab', { challenge: 'a\tb' }],
    ['DEL', { challenge: 'a\u007fb' }],
    ['C1', { challenge: 'a\u0085b' }],
    ['one byte too many', { challenge: 'é'.repeat(MAX_CHALLENGE_BYTES / 2) + 'a' }],
  ])('refuses %s as invalid_request', (_name, opts) => {
    expect(() => validateChallenge(opts)).toThrow(expect.objectContaining({ code: 'invalid_request' }));
  });

  it('counts bytes, not characters', () => {
    const text = 'é'.repeat(MAX_CHALLENGE_BYTES / 2);
    expect(validateChallenge({ challenge: text })).toBe(text);
  });
});

describe('gpubFromCompressed', () => {
  it('wraps the key as tm2 prints it: the gpub of test1', () => {
    const gpub = gpubFromCompressed(TEST1_PUB);
    expect(gpub.startsWith('gpub1')).toBe(true);
    expect(decodeGpub(gpub)).toMatchObject({ type: 'secp256k1', address: TEST1 });
  });

  it('refuses a key that is not 33 bytes', () => {
    expect(() => gpubFromCompressed('c2ln')).toThrow(expect.objectContaining({ code: 'signer_unavailable' }));
  });
});

describe('connectWithChallenge', () => {
  it('signs as the current account and answers the proof, its key and the features', async () => {
    const s = steps();
    const answer = await connectWithChallenge(s, { challenge: CHALLENGE, chainid: 'dev' }, FEATURES);
    expect(s.calls).toEqual(['establish', 'network dev', 'account', `sign ${TEST1} ${CHALLENGE}`]);
    expect(answer).toEqual({
      status: 'Approved',
      args: {
        address: TEST1,
        chainid: 'dev',
        pubkey: gpubFromCompressed(TEST1_PUB),
        features: FEATURES,
        proof: { signed: { chain_id: 'dev', msgs: [] }, signature: 'c2ln' },
      },
    });
    expect('session' in (answer as { args: object }).args).toBe(false);
  });

  it('refuses a bad challenge before any step', async () => {
    const s = steps();
    expect(await connectWithChallenge(s, { challenge: 'a\u0085b' }, FEATURES)).toEqual({
      status: 'Rejected',
      code: 'invalid_request',
    });
    expect(s.calls).toEqual([]);
  });

  it('stops when the user refuses the site', async () => {
    const s = steps({ establish: async () => ({ status: 'Rejected' }) });
    expect(await connectWithChallenge(s, { challenge: CHALLENGE }, FEATURES)).toEqual({ status: 'Rejected' });
  });

  it('answers network_declined when the network cannot be had', async () => {
    const s = steps({
      resolveNetwork: async () => {
        throw new GnoConnectRequestError('network_declined', 'no');
      },
    });
    expect(await connectWithChallenge(s, { challenge: CHALLENGE, chainid: 'other' }, FEATURES)).toEqual({
      status: 'Rejected',
      code: 'network_declined',
    });
  });

  it('refuses a pin that is not the current account, without a signature window', async () => {
    const s = steps();
    const answer = await connectWithChallenge(s, { challenge: CHALLENGE, signer: 'g1qynsu9dwj9lq0m5fkje7jh6qy3md80ztqnshhm' }, FEATURES);
    expect(answer).toEqual({ status: 'Rejected', code: 'signer_unavailable' });
    expect(s.calls.some((c) => c.startsWith('sign'))).toBe(false);
  });

  it('takes a pin in upper case for the same identity', async () => {
    const s = steps();
    const answer = await connectWithChallenge(s, { challenge: CHALLENGE, signer: TEST1.toUpperCase() }, FEATURES);
    expect(answer.status).toBe('Approved');
    expect(s.calls).toContain(`sign ${TEST1} ${CHALLENGE}`);
  });

  it('passes the refusal of the signature on, with no code', async () => {
    const s = steps({ sign: async () => ({ status: 'Rejected' }) });
    expect(await connectWithChallenge(s, { challenge: CHALLENGE }, FEATURES)).toEqual({ status: 'Rejected' });
  });

  it('answers signer_unavailable when the account signs without a key (a Ledger account)', async () => {
    const s = steps({ sign: async () => ({ status: 'Approved', args: { signed: { chain_id: 'dev' } } }) });
    expect(await connectWithChallenge(s, { challenge: CHALLENGE }, FEATURES)).toEqual({
      status: 'Rejected',
      code: 'signer_unavailable',
    });
  });

  it('answers the chain the document was signed for', async () => {
    const s = steps({ resolveNetwork: async () => 'dev', sign: async () => signedFor('test5') });
    const answer = await connectWithChallenge(s, { challenge: CHALLENGE, chainid: 'dev' }, FEATURES);
    expect(answer.status === 'Approved' && answer.args.chainid).toBe('test5');
  });

  it('lets a genuine failure through', async () => {
    const s = steps({ sign: async () => Promise.reject(Object.assign(new Error('mismatch'), { code: 'signer_unavailable' })) });
    await expect(connectWithChallenge(s, { challenge: CHALLENGE }, FEATURES)).rejects.toMatchObject({ code: 'signer_unavailable' });
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd ~/adena-wallet/packages/adena-extension && npx jest --ci src/inject/gnoconnect/challenge.spec.ts 2>&1 | tail -6`
Expected: FAIL — `Cannot find module './challenge'`.

- [ ] **Step 3: Add the types**

In `types.ts`, `GnoAccount` becomes:

```ts
export interface GnoAccount {
  address: string;
  chainid: string;
  pubkey: string | null;
  features?: string[];
  /** With a challenge: what the identity signed (Adena's SignArbitrary `signed`), and the signature, base64. */
  proof?: { signed: Record<string, unknown>; signature: string };
}
```

and `GnoConnectOptions` gains, after `oldsig?: string;`:

```ts
  /** A text for the identity to sign, proving it holds the address; never with `pubkey`. */
  challenge?: string;
```

- [ ] **Step 4: Write `challenge.ts`**

```ts
// `connect` with a `challenge`: the identity signs the producer's text through
// SignArbitrary. Free of @adena-wallet/sdk so jest can load it; the provider
// supplies the steps.
import { fromBase64 } from '@cosmjs/encoding';
import { toBech32 } from 'adena-module';

import { GnoConnectRequestError } from './errors';
import { GnoAccount, GnoConnectOptions, GnoErrorCode, UserResponse } from './types';

export const MAX_CHALLENGE_BYTES = 4096;

/** C0, DEL and C1, as Go's unicode.IsControl. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The standard's rules for a challenge; returns the text. */
export function validateChallenge(opts: GnoConnectOptions): string {
  const { challenge } = opts;
  const bad = (why: string): never => {
    throw new GnoConnectRequestError('invalid_request', `challenge: ${why}`);
  };
  if (opts.pubkey !== undefined) bad('a connect proves an identity or names a key, not both');
  if (typeof challenge !== 'string' || challenge === '') return bad('empty');
  if (new TextEncoder().encode(challenge).length > MAX_CHALLENGE_BYTES) bad(`over ${MAX_CHALLENGE_BYTES} bytes`);
  if (CONTROL.test(challenge)) bad('a control character');
  return challenge;
}

/** The amino Any of a secp256k1 key, as tm2 prints it: `0a13 "/tm.PubKeySecp256k1" 1223 0a21` + key. */
const SECP_PREFIX = [0x0a, 0x13, ...Array.from('/tm.PubKeySecp256k1', (c) => c.charCodeAt(0)), 0x12, 0x23, 0x0a, 0x21];

export function gpubFromCompressed(base64: string): string {
  const key = fromBase64(base64);
  if (key.length !== 33) {
    throw new GnoConnectRequestError('signer_unavailable', `the account's key is ${key.length} bytes, not a secp256k1 key`);
  }
  return toBech32('gpub', Uint8Array.from([...SECP_PREFIX, ...key]));
}

/** SignArbitrary's answer, as far as the proof needs it. */
export interface SignedText {
  signed: { chain_id: string } & Record<string, unknown>;
  signature?: { pubKey?: { value?: string }; signature?: string };
}

/** What the flow needs from the wallet; a GnoConnectRequestError thrown is an answer. */
export interface ChallengeSteps {
  establish(): Promise<UserResponse<null>>;
  /** The chain to sign for: `chainid`, switched to if needed, or the active one. */
  resolveNetwork(chainid?: string): Promise<string>;
  currentAddress(): Promise<string>;
  sign(signer: string, data: string): Promise<UserResponse<SignedText>>;
}

const refused = (code?: GnoErrorCode): UserResponse<never> =>
  code ? { status: 'Rejected', code } : { status: 'Rejected' };

export async function connectWithChallenge(
  steps: ChallengeSteps,
  opts: GnoConnectOptions,
  features: string[],
): Promise<UserResponse<GnoAccount>> {
  try {
    const challenge = validateChallenge(opts);
    const established = await steps.establish();
    if (established.status === 'Rejected') return established;
    await steps.resolveNetwork(opts.chainid);
    const signer = await steps.currentAddress();
    if (opts.signer && opts.signer.toLowerCase() !== signer.toLowerCase()) {
      throw new GnoConnectRequestError('signer_unavailable', `Cannot sign as ${opts.signer}: it is not the active account`);
    }
    const answer = await steps.sign(signer, challenge);
    if (answer.status === 'Rejected') return answer;
    const { signed, signature } = answer.args;
    if (!signature?.pubKey?.value || !signature.signature) {
      throw new GnoConnectRequestError('signer_unavailable', 'This account cannot sign a text (a Ledger account)');
    }
    return {
      status: 'Approved',
      args: {
        address: signer,
        chainid: signed.chain_id,
        pubkey: gpubFromCompressed(signature.pubKey.value),
        features,
        proof: { signed, signature: signature.signature },
      },
    };
  } catch (error) {
    if (error instanceof GnoConnectRequestError) return refused(error.code);
    throw error;
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `cd ~/adena-wallet/packages/adena-extension && npx jest --ci src/inject/gnoconnect 2>&1 | tail -6`
Expected: PASS, every suite of `src/inject/gnoconnect` (the new one and the existing ones).

- [ ] **Step 6: Lint and commit**

```bash
cd ~/adena-wallet/packages/adena-extension && npx eslint src/inject/gnoconnect/challenge.ts src/inject/gnoconnect/challenge.spec.ts src/inject/gnoconnect/types.ts && npx tsc --noEmit -p . 2>&1 | grep -c "challenge" 
git add src/inject/gnoconnect/challenge.ts src/inject/gnoconnect/challenge.spec.ts src/inject/gnoconnect/types.ts
git commit -m "feat(gnoconnect): connect with a challenge — the rules, the gpub and the flow"
```

Expected: eslint silent; the `grep -c` prints `0` (no type error mentions the new files).

---

### Task 3: Adena signs as gno's sign-data vectors expect

**Files:**
- Modify: `~/adena-wallet/packages/adena-module/src/wallet/keyring/sign-arbitrary.spec.ts`

**Interfaces:**
- Consumes: upstream `signArbitraryMessage({keyring, publicKey, chainId, signer, data})`, `HDWalletKeyring`, `MNEMONIC`/`SIGNER` already in that spec.

- [ ] **Step 1: Pin the signatures of gno's vectors**

Append to `sign-arbitrary.spec.ts` (inside no `describe`, after the last one):

```ts
// gno's tm2/pkg/std/signdata_test.go checks these same signatures with
// std.VerifySignData: the wallet and the Go verifier agree byte for byte.
describe('agreement with gno sign-data', () => {
  it.each([
    ['ascii', 'hello', '8hpjD4/il8opyBcDRI3Uax7RawxfahpY7agfp3fbv8V0OI1lPGBmIJ7epkRjGfFbyl57udqJHErR3q79qmwEZg=='],
    [
      'non-ascii',
      'Sign in to Gnoland · 서명 · 🔑',
      'mHvGbtC4bLtA55GZao2b6qBKGh8cNnAgGQHaNSIbdkEAWT83TbuBbeL9dF4tc2lODsHirfx7aW/PGtjg5Z+nfg==',
    ],
  ])('%s: the signature of gno\'s vector', async (_name, data, expected) => {
    const keyring = await HDWalletKeyring.fromMnemonic(MNEMONIC);
    const publicKey = await keyring.getPublicKey(0);
    const { signature } = await signArbitraryMessage({
      keyring,
      publicKey,
      chainId: CHAIN_ID,
      signer: SIGNER,
      data,
    });
    expect(Buffer.from(signature).toString('base64')).toBe(expected);
  });
});
```

(The keyring and key are built as the spec's own `it('produces a signature an independent verifier accepts')` builds them.)

- [ ] **Step 2: Run it**

Run: `cd ~/adena-wallet/packages/adena-module && npx jest src/wallet/keyring/sign-arbitrary.spec.ts 2>&1 | tail -6`
Expected: PASS. This test pins agreement rather than new behaviour, so it may pass at once; a failure is a finding (Adena and gno disagree) — stop and debug, do not change the expected values.

- [ ] **Step 3: Commit**

```bash
cd ~/adena-wallet && git add packages/adena-module/src/wallet/keyring/sign-arbitrary.spec.ts
git commit -m "test(sign-arbitrary): the signatures gno's sign-data vectors expect"
```

---

### Task 4: The provider takes the challenge, checked on the bench

**Files:**
- Modify: `~/adena-wallet/packages/adena-extension/src/inject/gnoconnect/provider.ts` (`FEATURES`, `connect`, new `challengeSteps`)
- Modify: `~/bubblerumble/prototypes/inpage-sessions/session-request.js` (`pubFromGpub`)
- Modify: `~/bubblerumble/prototypes/inpage-sessions/session-request.test.mjs`
- Modify: `~/bubblerumble/prototypes/inpage-sessions/page.js` (challenge actions)
- Modify: `~/bubblerumble/prototypes/inpage-sessions/index.html` (buttons)
- Modify: `~/bubblerumble/prototypes/inpage-sessions/bench/sessions.spec.mjs` (fake server behind `/api/`, scenarios 8–12)
- Modify: `~/bubblerumble/prototypes/inpage-sessions/bench/package.json` (test script flag)
- Modify: `~/bubblerumble/prototypes/inpage-sessions/bench/README.md`

**Interfaces:**
- Consumes: `connectWithChallenge`, `ChallengeSteps`, `SignedText` (Task 2); `AdenaExecutor.signArbitrary` (Task 1); `startFakeServer(port, {host})` from `~/bubblerumble/scripts/fake-offchain/server.ts` (returns `{url, close()}`; `GET /api/name/challenge` → `{words}`, `POST /api/name {name, doc, sig, pub, addr}` → 200 `{name, key, addr}` or 409 `{error}`; `GET /api/name?name=` → `{name, reserved?, by?}`).
- Produces: page actions `reserveByProof`, `proveAgain`, `provePinOther`, `proveBadText` returning lines `{action, status, code?, reserved?, error?, chainid?, features?}`; `pubFromGpub(gpub: string): Uint8Array` in `session-request.js`.

- [ ] **Step 1: `pubFromGpub` — failing test first**

Append to `session-request.test.mjs`:

```js
test('pubFromGpub reads back the key gpubFromKey wrapped', () => {
  const raw = Uint8Array.from(Buffer.from('A+FhNtsXHjLfSJk1lB8FbiL4mGPjc50Kt81J7EKDnJ2y', 'base64'));
  assert.deepEqual(pubFromGpub(gpubFromKey('secp256k1', raw)), raw);
  assert.throws(() => pubFromGpub('gpub1qqqqqq'));
});
```

and add `pubFromGpub` to that file's import from `./session-request.js`.

Run: `cd ~/bubblerumble/prototypes/inpage-sessions && node --test session-request.test.mjs 2>&1 | tail -4`
Expected: FAIL — `pubFromGpub` is not exported.

- [ ] **Step 2: Write `pubFromGpub`**

In `session-request.js`, after `bech32Encode` (it uses that section's `CHARSET` and `polymod`), add a decoder and the export:

```js
function bech32Decode(s) {
  const lower = s.toLowerCase();
  const pos = lower.lastIndexOf('1');
  if (pos < 1 || pos + 7 > lower.length) throw new Error(`not bech32: ${s}`);
  const hrp = lower.slice(0, pos);
  const data = [...lower.slice(pos + 1)].map((c) => {
    const v = CHARSET.indexOf(c);
    if (v < 0) throw new Error(`not bech32: ${s}`);
    return v;
  });
  const expanded = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  if (polymod([...expanded, ...data]) !== 1) throw new Error(`bad checksum: ${s}`);
  const bytes = [];
  let acc = 0, bits = 0;
  for (const v of data.slice(0, -6)) {
    acc = (acc << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return { hrp, bytes };
}

/** The 33-byte key inside a secp256k1 `gpub1…` (the reverse of gpubFromKey). */
export function pubFromGpub(gpub) {
  const { hrp, bytes } = bech32Decode(gpub);
  const url = new TextEncoder().encode('/tm.PubKeySecp256k1');
  const prefix = [0x0a, url.length, ...url, 0x12, 35, 0x0a, 33];
  if (hrp !== 'gpub' || bytes.length !== prefix.length + 33 || prefix.some((b, i) => bytes[i] !== b)) {
    throw new Error(`not a secp256k1 gpub: ${gpub}`);
  }
  return Uint8Array.from(bytes.slice(prefix.length));
}
```

Run: `node --test session-request.test.mjs 2>&1 | tail -4`
Expected: PASS (all tests of the file).

- [ ] **Step 3: Bench scenarios — failing first**

In `bench/package.json`, the test script becomes:

```json
"test": "node --experimental-strip-types --no-warnings --test --test-concurrency=1 --test-timeout=180000 sessions.spec.mjs"
```

In `bench/sessions.spec.mjs`:

1. Import the fake server: `import { startFakeServer } from '../../../scripts/fake-offchain/server.ts';`, and add `let fake;`.
2. In `serve()`, before reading a file, proxy the API:

```js
    if (req.url.startsWith('/api/')) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const upstream = await fetch(`${fake.url}${req.url}`, {
        method: req.method,
        headers: { 'Content-Type': req.headers['content-type'] ?? 'application/json', 'X-Bid': 'bench0000000000a' },
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      return res.writeHead(upstream.status, { 'Content-Type': 'application/json' }).end(await upstream.text());
    }
```

3. In the top-level `before`, before `serve()`: `fake = await startFakeServer(0, { host: '127.0.0.1' });` and in the top-level `after`: `await fake?.close();`.
4. After test 7, add:

```js
describe('challenge: connect({challenge}) proves the identity', () => {
  let page;
  before(async () => {
    page = await openPage('key=secp256k1');
  });

  test('8. first visit: the site, then the signature; the proof reserves a name', async () => {
    await run(page, 'disconnect', []); // this origin starts unapproved
    const line = await run(page, 'reserveByProof', ['Connect', 'Sign']);
    assert.equal(line.status, 'Approved');
    assert.equal(line.chainid, 'dev');
    assert.ok(line.features.includes('challenge'));
    assert.equal(line.session, undefined);
    assert.equal(line.reserved, true, JSON.stringify(line));
  });

  test('9. an approved origin is still asked; a refusal is Rejected', async () => {
    const line = await run(page, 'proveAgain', ['Cancel']);
    assert.equal(line.status, 'Rejected');
    assert.equal(line.code, undefined);
  });

  test('10. a pin the wallet does not hold: signer_unavailable, no window', async () => {
    assert.equal((await run(page, 'provePinOther', [])).code, 'signer_unavailable');
  });

  test('11. a challenge with a control character: invalid_request, no window', async () => {
    assert.equal((await run(page, 'proveBadText', [])).code, 'invalid_request');
  });

  after(() => page?.close());
});
```

Upstream's signature window (`approve-sign-arbitrary/index.tsx`) labels its buttons `Cancel` and `Sign`; the site window's is `Connect`.

In `page.js`, add to `actions` (and a `TEST1` constant beside `GRANT`: `const TEST1 = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';`, and `pubFromGpub` to the import from `./session-request.js`):

```js
  /** What gno.world's page would do: a phrase from the server, signed through connect, sent back. */
  async reserveByProof() {
    const { words } = await (await fetch('/api/name/challenge', { cache: 'no-store' })).json();
    const answer = await wallet.provider.connect({ challenge: words, signer: TEST1, chainid: CHAIN_ID });
    if (answer.status !== 'Approved') return record('reserveByProof', { status: answer.status, code: answer.code });
    const { address, chainid, features, proof, pubkey, session } = answer.args;
    const res = await fetch('/api/name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bench',
        doc: signBytesOf(proof.signed),
        sig: proof.signature,
        pub: base64(pubFromGpub(pubkey)),
        addr: address,
      }),
    });
    const body = await res.json();
    return record('reserveByProof', { status: answer.status, chainid, features, session, reserved: res.ok, error: body.error });
  },
  async proveAgain() {
    const answer = await wallet.provider.connect({ challenge: 'example.com: again', chainid: CHAIN_ID });
    return record('proveAgain', { status: answer.status, code: answer.code });
  },
  async provePinOther() {
    const answer = await wallet.provider.connect({ challenge: 'example.com: pin', signer: 'g1qynsu9dwj9lq0m5fkje7jh6qy3md80ztqnshhm', chainid: CHAIN_ID });
    return record('provePinOther', { status: answer.status, code: answer.code });
  },
  async proveBadText() {
    const answer = await wallet.provider.connect({ challenge: 'example.com:\u0085bad', chainid: CHAIN_ID });
    return record('proveBadText', { status: answer.status, code: answer.code });
  },
```

and, above `const actions`, the site's serializer and a base64 helper:

```js
// gno.world's signBytesOf (app-panels.js): sorted JSON, <>& escaped, as std.SignDataPayload writes it.
const sortedObject = (t) =>
  typeof t !== 'object' || t === null
    ? t
    : Array.isArray(t)
      ? t.map(sortedObject)
      : Object.keys(t).sort().reduce((o, k) => ((o[k] = sortedObject(t[k])), o), {});
const signBytesOf = (t) =>
  JSON.stringify(sortedObject(t)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const base64 = (bytes) => btoa(String.fromCharCode(...bytes));
```

In `index.html`, add buttons `reserveByProof`, `proveAgain`, `provePinOther`, `proveBadText` to `#buttons`, same markup as the others.

Build the extension unchanged (`cd ~/adena-wallet && yarn build:service`), start gnodev (Task 1 Step 4), then:

Run: `cd ~/bubblerumble/prototypes/inpage-sessions/bench && npm test 2>&1 | grep -E "^(not )?ok|# (pass|fail)"`
Expected: tests 1–7 ok; 8–11 `not ok` — the provider still treats a challenge as a plain `connect` (8: no `proof`, so `reserved` is false or the page throws reading `proof.signed`; 9 and 10: no window and Approved; 11: Approved).

- [ ] **Step 4: Wire the provider**

In `provider.ts`:

1. Imports: add `import { ChallengeSteps, connectWithChallenge, SignedText } from './challenge';` and `GnoConnectRequestError` is already imported.
2. `FEATURES`:

```ts
/** What a `connect` answer lists: the hosts, the multi-message form, sessions, challenges. */
const FEATURES = ['sendtx', 'signtx', 'multi_msg', 'sessions', 'challenge'];
```

3. Above `createGnoConnectProvider`:

```ts
/** The wallet's side of `connect` with a challenge: the existing executor calls. */
function challengeSteps(host: ProviderHost): ChallengeSteps {
  return {
    establish: async () => toUserResponse(await host.executor().addEstablish(host.siteName()), () => null),
    async resolveNetwork(chainid) {
      const active = await readNetwork(host);
      if (!chainid || active.chainId === chainid) return active.chainId;
      return (await switchTo(host, chainid)).chainId;
    },
    async currentAddress() {
      const response = await host.executor().getAccount();
      const account = toUserResponse(response, (data) => (data as AccountResultLike)?.address ?? '');
      if (account.status === 'Rejected' || !account.args) {
        throw new GnoConnectRequestError('no_signer', 'No active account');
      }
      return account.args;
    },
    async sign(signer, data) {
      const response = await host.executor().signArbitrary({ signer, data });
      return toUserResponse(response, (d) => d as unknown as SignedText);
    },
  };
}
```

4. In `connect(opts)`, first lines:

```ts
    async connect(opts) {
      if (opts?.challenge !== undefined) {
        const answer = await connectWithChallenge(challengeSteps(host), opts, FEATURES);
        if (answer.status === 'Approved') {
          const { address, chainid, pubkey } = answer.args;
          events.rememberAccount({ address, chainid, pubkey });
        }
        return answer;
      }
      if (opts?.pubkey !== undefined) {
```

- [ ] **Step 5: Build and run the bench**

```bash
cd ~/adena-wallet/packages/adena-extension && npx eslint src/inject/gnoconnect/provider.ts && npx jest --ci src/inject 2>&1 | tail -4 && cd ~/adena-wallet && yarn build:service 2>&1 | tail -2
cd ~/bubblerumble/prototypes/inpage-sessions/bench && npm test 2>&1 | grep -E "^(not )?ok|# (pass|fail)"
```

Expected: eslint silent, `src/inject` all pass, the build succeeds; the bench `# pass 23`, `# fail 0` (19 + 4; test 8 counts the first-visit pair of windows, Connect then Sign).

- [ ] **Step 6: README and commits**

Add to `bench/README.md`, after the "What it does" list:

```md
Challenge scenarios (8–11, spec `docs/superpowers/specs/2026-10-13-adena-connect-challenge-design.md`):
the bench starts the app's fake gno.world server (`scripts/fake-offchain/server.ts`) and serves it under
`/api/` beside the page, which does what gno.world's page would do: a phrase from the server, signed
through `connect({challenge})`, the proof converted (`signBytesOf(proof.signed)`, the signature, the
compressed key from the gpub) and sent back to reserve a name.
```

```bash
cd ~/adena-wallet && git add packages/adena-extension/src/inject/gnoconnect/provider.ts
git commit -m "feat(gnoconnect): connect with a challenge — signed through SignArbitrary, answered with the proof"
cd ~/bubblerumble && git add prototypes/inpage-sessions
git commit -m "test(bench): connect({challenge}) — a name reserved by the wallet's proof, and the refusals"
```

---

### Task 5: The in-page standard's two sentences (#6016)

**Files:**
- Modify: `~/gno-inpage-wallets/docs/resources/gnoconnect.md` ("The `signer` pin" section; the in-page `GnoAccount.proof` text)

- [ ] **Step 1: Check they are missing**

```bash
cd ~/gno-inpage-wallets && f=docs/resources/gnoconnect.md
sed -n '/^## The `signer` pin/,/^## /p' $f | grep -q "challenge" && echo pin-ok || echo pin-RED
grep -q "rebuilds the canonical bytes" $f && echo bytes-ok || echo bytes-RED
```

Expected: `pin-RED`, `bytes-RED`.

- [ ] **Step 2: Write them**

At the end of "The `signer` pin" section's paragraph that allows a delegated or session key, add:

```md
With a `challenge` there is no such latitude: the identity itself signs (see Proving the identity), since a session key's signature proves nothing about the address.
```

After the `GnoAccount` block (the paragraph introducing `proof`), add:

```md
In the browser `proof.signed` is the document as an object; the producer rebuilds the canonical bytes from it — sorted by key, no spaces, `<`, `>` and `&` escaped — before verifying, as it decodes `signed` from base64url on a launch link.
```

Run Step 1's commands again. Expected: `pin-ok`, `bytes-ok`.

- [ ] **Step 3: Commit**

```bash
cd ~/gno-inpage-wallets && git add docs/resources/gnoconnect.md
git commit -m "docs(gnoconnect): in the browser, the identity signs a challenge and the producer rebuilds the bytes"
```

---

### Task 6: Docs, and what to push

**Files:**
- Modify: `~/bubblerumble/docs/superpowers/specs/2026-10-12-gnoconnect-challenge-design.md` (§8, status line)
- Modify: `~/bubblerumble/docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` (§9)
- Modify: `~/bubblerumble/docs/superpowers/specs/2026-10-13-adena-connect-challenge-design.md` (a status line under the date)

- [ ] **Step 1: Write the status**

Challenge spec, status paragraph: append « Adena (§8) livré le <date> : fork `feat/gnoconnect-in-page` rebasée sur l'amont (`<backup>`), `connect({challenge})` (`<commits>`), banc 23/23 ; #6016 `<commit>` ». §8: replace « (en dernier, spec et plan à part) » with « — fait, voir `2026-10-13-adena-connect-challenge-design.md` ». Parent spec §9, in the « Réservation du nom 100 % mobile » item: add one sentence with the same facts. Adena spec: « **Statut :** livré le <date> (plan `docs/superpowers/plans/2026-10-13-adena-connect-challenge.md`). » Fill every `<…>` from `git log`.

- [ ] **Step 2: Verify and commit**

```bash
cd ~/bubblerumble && grep -n "<date>\|<commit\|<backup>" docs/superpowers/specs/2026-10-1*.md; npx expo lint 2>&1 | tail -2
git add docs/superpowers/specs && git commit -m "docs: Adena proves the identity in the browser — connect({challenge}) done"
```

Expected: the grep prints nothing; lint clean.

- [ ] **Step 3: Tell the user what to push**

List, without pushing: `~/adena-wallet` `feat/gnoconnect-in-page` (force-with-lease: rebased; backup `backup/gnoconnect-in-page-before-sign-arbitrary`), `~/gno-inpage-wallets` `feat/gnoconnect-in-page-wallets` (fast-forward: one commit on `fea266219`).
