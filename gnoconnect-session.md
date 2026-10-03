# GnoConnect — Sessions through `connect` (draft)

> **Status:** draft proposal. Written to slot into
> `docs/resources/gnoconnect.md`, under "Launch Links (external wallets)": it
> extends `connect` and adds one host, `disconnect`. It uses that document's
> terms and rules: network resolution, the `signer` pin, the `status`/`code`
> callback envelope, callback URL rules, and forward compatibility. A `connect`
> without the parameters below means exactly what it means today, and nothing
> below changes `sendtx` or `signtx`.

## Sessions: the wallet's business, behind `connect` and `disconnect`

The standard already treats sessions as the wallet's business: a producer pins
an identity, never a key, and the wallet chooses which key signs (see The
`signer` pin). This section keeps that model and gives producers exactly two
verbs. A producer **connects** and **disconnects**; which sessions exist, which
one signs, and how they are created, renewed and cleaned up is decided in the
wallet, with the user.

A producer connects in one of two ways:

| the producer wants to | `connect` carries | the wallet | afterwards the producer |
|---|---|---|---|
| send through the wallet | nothing new, or optional **scope hints** (`allow`, `spend`, `period`, `expires`) | answers with the identity; it MAY first pick one of its own sessions that covers the hints, or offer to create one | sends `sendtx` / `signtx` pinned to `address` |
| sign by itself | a **`pubkey`** it holds, the grant it needs, and a proof of possession | authorises that key on chain as a session of the identity, inside the limits the user approved | signs every transaction with its key, without going back to the wallet |

The two are compatible. A producer that holds its own session key can still send
`sendtx` requests: the wallet signs them with its own key or one of its own
sessions. Both are sessions of the same identity, which is what the chain
credits and what `signer` pins.

**Renewing, changing the budget or the allowed paths** is a new `connect` with a
fresh key that names the current one in `old`. The wallet revokes the old
session and creates the new one in a single transaction. A producer may also
`disconnect` and then `connect` again, which costs two transactions and leaves a
gap between them.

**Why `disconnect` is a host and the grant is a parameter.** The launch-link
rules make every operation that must not be ignored a host, because a wallet
silently ignores query parameters it does not understand. Ignoring `pubkey` is
safe: a wallet that does not know it answers an identity-only `connect` and
grants nothing, and the producer detects it (see Callback results). Ignoring a
revocation would not be safe, since the producer would believe a key was
disabled when it still works. So revocation is the host `disconnect`, and a
wallet that does not implement it answers `unsupported_host`.

### Two kinds of session

The `signer` pin section says a session's limits are "the wallet's business".
That stays true for **wallet-held** sessions: keys the wallet signs `sendtx` and
`signtx` requests with, which the producer never sees. Scope hints only help the
wallet choose or prepare one; they give the producer no handle on it.

A session requested with `pubkey` is **producer-held**. The key is generated
by, stored by and signs inside the producer. The wallet acts only as a
*broker*: it shows the user the grant, obtains the identity's signature on the
`auth` messages, and reports the result. Two consequences:

- **The private key never travels.** Only its public key appears in a request. A
  wallet MUST NOT generate a session key for a producer, and a producer MUST NOT
  send a private key in any parameter. It follows that a wallet cannot hand one
  of its existing sessions to a producer: with `pubkey`, the session is always
  the producer's own key.
- **The producer can only act on its own session.** Every request that names a
  key carries a proof of possession made with that key (see Proof of
  possession). The producer cannot list, read, replace or revoke any other
  session of the identity. The wallet stays responsible for housekeeping the
  identity's sessions (see Wallet housekeeping), and no request can ask for it.

### Chain rules a producer must know

These are gno.land consensus rules today (`tm2/pkg/sdk/auth`,
`gno.land/pkg/gnoland`), not choices made by this standard:

- **A session cannot sign `auth/*` or `vm/add_package`.** Even a `*` grant
  excludes them. Only the identity's own key can create, replace or revoke a
  session, so a wallet that only holds a session key needs some other route to
  that key (see Obtaining the identity's signature).
- **Sessions cannot be updated.** Changing limits means revoking and creating
  again, which is what a `connect` with `old` does.
- **At most 16 sessions per identity, and expired ones count.** The chain never
  deletes an expired session; only `MsgRevokeSession` removes one.
- **At most 8 allow entries per session.** The grammar is `*`, or
  `<route>/<type>[:<path>]` with `<route>/<type>` one of `vm/exec`, `vm/run`,
  `bank/send` or `bank/multisend`. Only `vm/exec` takes a `:<path>`, matched as
  `path == entry` or `path` starting with `entry + "/"`.
- **The spend limit covers every outflow** charged to the identity for the
  session's transactions: gas fees, `MsgCall.Send`, bank sends and storage
  deposits. An empty limit means the session cannot spend anything, so it
  cannot even pay its own gas.
- **`period` is a resetting window.** Once `period` seconds have passed since
  the window opened, the next spend resets the counter and opens a new window
  at that spend's block time. `0` makes the limit a lifetime cap. Maximum:
  2,592,000 seconds (30 days).
- **The budget counts gross outflows.** Coins flowing back to the identity,
  such as a realm paying out winnings, do not lower the session's used amount.
- **A spend over the limit is refused before any fee is taken.** The session's
  total outflow is checked against the remaining budget first.
- **Maximum lifetime is 126,144,000 seconds (about 4 years).**
- **A session holds no coins.** Everything is debited from the identity's
  balance, so a session is only as funded as its identity. Anyone can fund the
  identity by sending to its address, and no session operation is involved.
- **The same key can be revoked and recreated in one transaction.** The new
  session gets a new account number and a sequence of 0, so transactions signed
  for the old one cannot be replayed.
- **Fees are still charged on most rejections.** A message that fails in its
  handler (a bound exceeded, a duplicate key) still costs
  the transaction's fee, because only `ValidateBasic` (for example the 8-entry
  cap) and the session spend check reject a transaction before fees are taken.
- **Every message in a transaction succeeds or none does.** A revocation
  followed by a failing creation leaves the revoked session in place.


### Parameters

| parameter | `connect` (identity) | `connect` with `pubkey` | `disconnect` | meaning |
|---|---|---|---|---|
| `pubkey` | — | required | required | the producer's key, bech32 `gpub1…` |
| `old` | — | optional | — | the producer's current session key, `gpub1…`, to revoke in the same transaction |
| `allow` | optional hint, 1–8, repeatable | required, 1–8, repeatable | — | allow entries, chain grammar |
| `spend` | optional hint | optional | — | spend limit per period, `gnokey` coin syntax (`5000000ugnot`) |
| `period` | optional hint | optional | — | seconds, `0`–`2592000`; absent means `0` |
| `expires` | optional hint | required | — | lifetime in **seconds from inclusion**, `1`–`126144000` |
| `chainid` | optional, as today | **required** | **required** | network, resolved as in Network resolution |
| `rpc` | optional | optional | optional | advisory, as everywhere |
| `signer` | — | optional; **required** with `old` | **required** | the identity (`address` from a previous `connect`) |
| `callback` | **required**, as today | **required** | optional | where the wallet answers |
| `state` | as today | **required** | **required** | opaque correlation token, at most 256 characters |
| `iat` | — | **required** | **required** | issue time, unix seconds |
| `sig` | — | **required** | **required** | proof of possession by `pubkey` |
| `oldsig` | — | **required** with `old` | — | proof of possession by `old` |

Rules:

- **`pubkey` sets the mode.** A `connect` with `pubkey` asks for a grant to
  that key. Without it, `allow`, `spend`, `period` and `expires` are hints for
  the wallet's own sessions, and the request is otherwise today's `connect`.
- **`old` comes with `pubkey`.** A wallet that implements `pubkey` MUST
  implement `old`. So the only wallets that ignore `old` are the ones that
  ignore `pubkey` too, and they grant nothing. `old` MUST differ from `pubkey`,
  and requires `signer` and `oldsig`; otherwise the request is
  `invalid_request`.
- **`expires` is a duration, not a timestamp.** The identity's signature may come
  minutes after the request (see Obtaining the identity's signature). The wallet
  converts it to an absolute `ExpiresAt` when it composes the transaction. A
  producer cannot ask for a session with no expiry: an unlimited lifetime is a
  decision the user takes in their wallet, not something a dapp can request.
- **`callback` is required on `connect`,** as it already is: the producer needs
  the answer, and with no `signer` it has no other way to learn the identity. On
  `disconnect` it is optional, because the producer can confirm the revocation
  on chain by itself.
- **`state` is required when a key is named,** not just recommended, because it
  is part of the signed payload and the replay defence.
- **`signer` is required with `old` and on `disconnect`.** They act on an
  existing session, and a session lives under one identity. Without `old` it is
  optional, and a missing pin means "whichever identity the user picks". A
  producer that already knows the identity SHOULD pin it.
- **Encoding** follows the launch-link rules. `+` is a literal plus in every
  parameter above (none of them is an argument value), and repeated `allow`
  parameters keep their order.
- **The usual validation applies.** A wallet answers `invalid_request` to a
  request with a missing required parameter, a malformed key, an allow entry the
  chain grammar rejects, more than 8 entries, or an out-of-range `period` or
  `expires`. It validates hints the same way, so the grammar is the same
  whichever mode a producer uses.

### Proof of possession

Every request that names a key is signed by that key, so a producer can only
have a key authorised, replaced or revoked if it controls it.

**Payload.** Take all query parameters of the request except `sig` and `oldsig`,
percent-decode them, and sort them by key then value (bytewise, UTF-8). The
payload is these lines joined with `\n` (LF), with no trailing newline:

```
gnoconnect-session-v1
host=<host, lowercased>
<key>=<value>
<key>=<value>
…
```

- **No line breaks in values.** A value containing a control character is
  `invalid_request`.
- **No `=` in parameter names.** A decoded name containing `=` is
  `invalid_request`: `a%3Db=c` and `a=b%3Dc` would give the same line, so a
  relay could rename a signed parameter without breaking the signature.
- **Everything in the request is covered,** including `callback`, `chainid`,
  `iat`, `state`, `signer` and `old`. Changing any of them breaks the
  signature, so a request redirected to another callback or replayed on another
  chain is refused.
- **The host is covered too** (`connect` or `disconnect`), so a signed
  `connect` cannot be replayed as a `disconnect`, or the reverse.
- **The `gnoconnect-session-v1` prefix** keeps this payload from ever looking
  like a transaction sign document (which starts with `{`). That matters because
  the same key will sign transactions.
- **Parameters added by future extensions are signed too,** since every
  parameter except the signatures is covered. A wallet that does not know a
  parameter still verifies the signature over it, then ignores it.

**Signature.** It is made with the key's own scheme, as tm2's `PrivKey.Sign`
does, and checked as `PubKey.VerifyBytes` does:

- secp256k1: ECDSA over SHA-256(payload), 64 bytes `R‖S`, low-S. Wallets MUST
  support it.
- ed25519: RFC 8032 over the payload, 64 bytes. Wallets MAY support it, and
  answer `invalid_proof` if they do not.

`sig` and `oldsig` are **base64url without padding** (RFC 4648 §5). Both sign
the same payload.

**Wallet checks, before showing anything to the user:**

1. `sig` verifies against `pubkey`, and with `old` `oldsig` verifies against
   `old`. Otherwise answer `invalid_proof`.
2. `iat` is no more than 10 minutes old and no more than 1 minute in the future
   by the wallet's clock. Otherwise answer `stale_request`.
3. The wallet SHOULD remember the `(pubkey, state)` pairs it has accepted for
   that window and drop a repeat.

**What it proves.** That the requester holds the private key, and nothing about
*who* the requester is. As for every `connect`, the producer's identity to the
user is its callback destination, which the wallet MUST show. What the proof
stops is one producer replacing or revoking another producer's session, and a
producer getting a key it does not control authorised.

### `connect` without a key: scope hints

```
<scheme>://connect?allow=<entry>&allow=<entry>&spend=<coins>&period=<s>&expires=<s>&chainid=<id>&callback=<url>&state=<token>
```

The hints describe what the producer intends to send through the wallet. The
wallet MAY use them to choose a session it already holds for the identity that
covers them, or to offer the user to create one, before it answers, so the
first `sendtx` does not stop on a missing or too narrow session. What it does
with them is entirely its own decision:

- The user may also choose to sign with the identity itself, or to decide
  later. The answer is the same in every case: today's `connect` callback.
- Creating a wallet-held session is a grant like any other. Its review follows
  the Review section, and its costs are paid by the identity.
- A hint creates no obligation. The producer learns nothing about the session,
  and a later `sendtx` that the session cannot cover is handled as the `signer`
  pin section already says: the wallet offers a fix in its own review.

### `connect` with a key

```
<scheme>://connect?pubkey=<gpub>&allow=<entry>&allow=<entry>&spend=<coins>&period=<s>&expires=<s>&chainid=<id>&rpc=<rpc>&signer=<address>&callback=<url>&state=<token>&iat=<unix>&sig=<b64url>
```

The wallet:

1. Resolves the network, then the identity: the pinned `signer`, or one the user
   picks. If it cannot obtain a signature from the pinned identity, it answers
   `signer_unavailable`; if it has no identity at all, `no_signer`.
2. Looks up `pubkey` as a session of that identity
   (`auth/accounts/{address}/session/{session address}`):
   - **Present and not expired:** nothing to sign. After the user agrees to
     disclose the identity, as for any `connect`, the wallet answers with the
     grant read from the chain. This makes `connect` safe to repeat: a producer
     whose callback was lost asks again with the same key and gets its answer.
   - **Present and expired:** the wallet answers `session_expired`. The
     producer connects again with a fresh key and names the expired one in
     `old`, which frees its slot.
3. Checks on chain everything else the chain would reject, because a rejected
   transaction still costs its fee: the identity has a free session slot, or the
   wallet can free one (see Wallet housekeeping). If not, the wallet answers
   `session_limit`.
4. Shows the consent screen (see Review).
5. Composes one transaction: `MsgRevokeSession` for `old` if given and on chain,
   any housekeeping revocations, then `MsgCreateSession{Creator: identity,
   SessionKey: pubkey, ExpiresAt: now + expires, AllowPaths: allow, SpendLimit:
   spend, SpendPeriod: period}`. It obtains the identity's signature and
   broadcasts.
6. Waits until the session is visible on chain, then answers.

**Narrowing.** The user MAY narrow the grant on the review screen: a shorter
lifetime, a lower spend limit, a longer period, fewer allow entries. The user MUST
NOT widen it: the producer did not ask for more, and more authority on a key a
third party holds helps no one. The callback reports what was actually granted,
and the producer MUST work with that.

#### Renewal and rotation: `old`

```
<scheme>://connect?pubkey=<new gpub>&old=<gpub>&allow=…&spend=…&period=…&expires=…&chainid=<id>&signer=<address>&callback=<url>&state=<token>&iat=<unix>&sig=<b64url>&oldsig=<b64url>
```

This is how a producer renews before expiry, changes the budget or changes the
allowed paths. The rules of a `connect` with a key apply, plus:

- **The new grant is new consent.** The review MUST show the old and new limits
  side by side and highlight any widening: a longer lifetime, a higher limit, a
  shorter period, new allow entries.
- **Revocation and creation go in one transaction,** revocation first. The
  transaction is atomic: if the creation fails, the old session is still there.
  This is what makes `old` worth having over `disconnect` then `connect`: one
  signature by the identity, one fee, and no moment without a working session.
- **An `old` that has expired but is still stored is valid:** renewing it is
  exactly what `old` is for.
- **An `old` that is no longer on chain** (the user revoked it, or a previous
  renewal already did) does not fail the request. The proof still shows the
  producer held it; there is simply nothing to revoke. The review says so, the
  transaction creates the new session only, and the callback omits `revoked`.
- **A fresh key every time.** Since `old` and `pubkey` differ, a renewal is also
  a rotation: a copy of the old key that leaked stops working.

### `disconnect`

```
<scheme>://disconnect?pubkey=<gpub>&chainid=<id>&signer=<address>&callback=<url>&state=<token>&iat=<unix>&sig=<b64url>
```

- **It ends a producer-held session.** A producer that connected without a key
  holds nothing the wallet could revoke for it. It disconnects by forgetting the
  address, and sends no request.
- **`pubkey` must be a session of `signer` on chain,** or the wallet answers
  `session_not_found`.
- **The user still confirms.** Revoking only removes authority, but it costs gas
  to the identity and may need the identity's signature from another device. The
  wallet MAY use a lighter screen than for a grant.
- **The wallet MAY add housekeeping revocations** to the same transaction, as on
  `connect`, and shows them in the review.
- **A producer that has lost its key cannot ask for this.** The user then revokes
  from the wallet's own interface, which is wallet business.

### Obtaining the identity's signature

This standard does not say how the wallet obtains the identity's signature on
the `auth` messages, only that the user approved the content first. Possible
routes:

- **The wallet holds the identity's key.** One approval, signed on the device.
- **A hardware signer.**
- **A desktop handoff,** for a wallet that only holds a session key and cannot
  sign `auth/*` itself, such as Gnokey Mobile. The wallet shows the user a
  command or QR code for the identity's signer on another device, then watches
  the chain. For a `connect` with a key, no `old` and no housekeeping:

  ```
  gnokey maketx session create -pubkey <gpub> -expires-at <unix> \
    -allow-paths <entry> … -spend-limit <coins> -spend-period <s> \
    -gas-fee … -gas-wanted … -chainid <id> -remote <rpc> <identity>
  ```

  For a `disconnect` with no housekeeping:

  ```
  gnokey maketx session revoke -pubkey <gpub> \
    -gas-fee … -gas-wanted … -chainid <id> -remote <rpc> <identity>
  ```

  `-broadcast` defaults to `true` in `gnokey`, so these sign and broadcast.
  Passing `-broadcast=false` instead prints the unsigned document.

  For a `connect` with `old`, and for any transaction carrying housekeeping
  revocations, `gnokey` has no single command. The wallet writes the unsigned
  multi-message document and shows:

  ```
  gnokey sign -tx-path <file> -chainid <id> -account-number <n> \
    -account-sequence <seq> <identity> \
  && gnokey broadcast -dry-run -remote <rpc> <file> \
  && gnokey broadcast -remote <rpc> <file>
  ```

  The `-dry-run` step runs the transaction without committing it, so anything
  the chain would reject (a session list filled since the wallet checked, a
  stale sequence) stops the command before a fee is charged.
  Without it, a doomed transaction is still included and costs its whole fee.

  `gnokey sign` does not look up the account: the wallet fills in the
  identity's account number and current sequence. The document goes stale as
  soon as the identity sends any other transaction (the broadcast then fails
  with `signature verification failed`), so the wallet regenerates it when the
  sequence moves. A plain `gnokey broadcast` does not simulate first, which is
  why the command above runs `-dry-run` before it.

So the answer may come minutes after the request. The wallet SHOULD keep the
request pending until the chain shows the outcome, MUST let the user cancel
(answering `cancelled`), and answers once the chain confirms. A producer MUST
treat the request as possibly unanswered, as the launch-link rules require, and
SHOULD watch the chain itself when it can (it always can once it knows the
identity).

### Review

Before obtaining any signature, the review screen MUST show:

- **the callback's host** (the producer's only identity);
- **the network**: chain id and the endpoint in effect, as in Network resolution;
- **the identity** that grants;
- **each allow entry,** with a warning on entries that let the key reach
  arbitrary code or move funds directly: `*`, a bare `vm/exec`, `vm/run`,
  `bank/send` and `bank/multisend`;
- **the budget in plain terms** ("5 GNOT per hour") **and its worst case** over
  the whole lifetime ("at most 3,600 GNOT over 30 days"), since the period
  resets for as long as the session lives;
- **the absolute expiry date**;
- **with `old`,** the old and new grants side by side, widenings highlighted, or
  a note that the old key is no longer on chain and nothing is replaced;
- **every housekeeping revocation** added to the transaction;
- **for every transaction,** what the identity pays in gas for it.

### Callback results

```
<callback>?status=success&address=<bech32>&chainid=<id>&features=<tokens>&session=<bech32>&expires_at=<unix>&allow=<entry>…&spend=<coins>&period=<s>&revoked=<bech32>&hash=<txhash>&state=<echoed>   # connect with a key
<callback>?status=success&address=<bech32>&chainid=<id>&hash=<txhash>&state=<echoed>                                                                                                       # disconnect
<callback>?status=cancelled&state=<echoed>
<callback>?status=error&code=<code>&state=<echoed>
```

A `connect` without a key answers exactly as today.

- **`address`** is the identity, the one a later request pins as `signer`.
- **`session`** is the bech32 address of `pubkey`, which the producer computes
  itself. In a `connect` without a key, the same field is the wallet's own
  delegated key, informational only. **A producer MUST compare `session` with
  the address of its `pubkey`.** If they differ, or `session` is missing, the
  wallet did not grant anything: it does not implement these parameters and
  answered an identity-only `connect`. The producer still has a valid
  `address`, which is what a fallback (such as a desktop command it shows
  itself) needs.
- **`expires_at`, `allow`, `spend` and `period`** are what was actually granted,
  after any narrowing, or what is on chain for an existing session (step 2).
- **`revoked`** is the address of `old` when this transaction revoked it. It is
  absent when there was no `old`, or when `old` was no longer on chain.
- **`hash`** is optional. A wallet that watched a desktop signer broadcast may
  not know it, and an answer about an existing session has none. As everywhere,
  it is a hint and not proof.
- **`pubkey`** in a callback keeps the meaning it has for `connect`: the
  identity's public key, optional. It is never the producer's key.

**A producer MUST confirm on chain before relying on the result.** After a
`connect` with a key, it queries `auth/accounts/{address}/session/{session}` and
checks `ExpiresAt`, `SpendLimit`, `SpendPeriod` and `AllowPaths`; with
`revoked`, it also checks the old session is gone. After a `disconnect`, it
checks the session is gone. Anyone can open a callback scheme.

**Error codes.** All of `sendtx`'s apply where they make sense:
`invalid_request`, `network_declined`, `signer_unavailable`, `no_signer`,
`unsupported_host` (a wallet without `disconnect`), `tx_failed`. Requests that
name a key add:

- `invalid_proof`: `sig` or `oldsig` did not verify, or the key type is not
  supported.
- `stale_request`: `iat` is outside the window.
- `session_expired`: `connect` named a key that is an expired session of the
  identity.
- `session_not_found`: `disconnect` named a key that is not a session of
  `signer`.
- `session_limit`: the identity already has 16 sessions and the wallet could not
  make room (see Wallet housekeeping).

### Wallet housekeeping

Expired sessions count towards the limit of 16 and are never removed by the
chain. When it composes a `connect` or `disconnect` transaction, a wallet MAY
add `MsgRevokeSession` messages for **expired** sessions of the identity, and it
SHOULD do so before answering `session_limit`. These messages MUST appear in the
review.

This is entirely the wallet's decision: there is no request parameter for it,
and the producer neither sees nor controls it. A wallet MUST NOT revoke a session
that has not expired, other than the `old` of a `connect` or the `pubkey` of a
`disconnect`, without the user explicitly choosing to.

### `connect` features

A wallet that implements `pubkey` and `old` on `connect`, and the `disconnect`
host, lists `sessions` in `connect`'s `features`. The token is informational: a
producer learns it only in the answer, and what decides is the `session`
comparison above. For `disconnect`, a producer may also just try the host and
treat `unsupported_host` as the answer.

### Producer obligations

- **Generate the key on the device** and keep it in the platform's secure
  storage (Keychain or Android Keystore). Never transmit it.
- **Use a fresh key for every `connect` that grants,** first and renewal alike.
- **Keep the old key until the renewal is confirmed on chain,** then delete
  it. A transaction signed with the old key may fail if the swap happens while it
  is pending; re-sign it with the new key.
- **Watch the session and renew with `old` well before expiry.** With a wallet
  that hands off to a desktop, the user needs time to reach a computer, so a
  notification several days ahead works better than a failure mid-session.
- **Read the remaining budget from the chain**, not from a local tally:
  `remaining = (now ≥ SpendReset + SpendPeriod) ? SpendLimit : SpendLimit −
  SpendUsed`. What can actually be spent is also capped by the identity's
  balance (`bank/balances/{address}`). A low balance is fixed by funding the
  identity's address, not by a session operation. Winnings paid back to the
  identity raise its balance but leave the session's budget unchanged.
- **Sign transactions in the session format**: the signature carries the session
  address and the transaction names the identity as caller and sender. A client
  that cannot represent this produces invalid transactions (gnonative before
  5.0.1 is one example).
- **Use `disconnect` when the user logs out,** then delete the key once the
  revocation is confirmed.

### Example: a game that needs about an hour of play at a time

The producer asks for 5 GNOT per hour on its realms only, for 30 days.
Parameters before encoding:

```
land.gno.gnokey://connect
  ?pubkey=gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq…
  &allow=vm/exec:gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubblerumble5
  &allow=vm/exec:gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/bubble
  &allow=vm/exec:gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr/wbubble
  &spend=5000000ugnot&period=3600&expires=2592000
  &chainid=gnoland-1&rpc=https://rpc.gno.land:443
  &callback=https://bubblerumble.net/app/session
  &state=Qm9vcC0xNzI3&iat=1790841600&sig=…
```

The review shows the callback host `bubblerumble.net`, `gnoland-1` and its
endpoint, three realm paths, "5 GNOT per hour, at most 3,600 GNOT over 30 days"
and the expiry date. After the user's approval and the identity's signature, the
callback is:

```
https://bubblerumble.net/app/session#status=success&address=g1…&chainid=gnoland-1&features=sendtx,signtx,sessions&session=g1…&expires_at=1793433600&allow=…&spend=5000000ugnot&period=3600&state=Qm9vcC0xNzI3
```

Three days before `expires_at`, the producer notifies the user and sends a new
`connect` with a new key in `pubkey`, the current key in `old`, `signer` set to
the identity, signed by both keys. When the user logs out, it sends
`disconnect` for the current key.

A wallet that only knows today's `connect` answers the first request with
`status=success&address=g1…` and no `session` for that key. The producer then
knows it must obtain the grant another way, and already knows the identity.

### Open questions

- **In-page transport.** The provider's `connect(opts)` could take the same
  fields (`pubkey`, `old`, the grant, `sig`, `oldsig`) and gain a `disconnect`
  method. The rule that `connect` on an approved origin resolves without
  prompting would then only hold for a `connect` without a key, or for a key
  that is already a session covering the request. Left out of this draft.
- **Wallet-held identity key.** A wallet that holds the identity's key turns
  this flow into a single approval. Whether Gnokey Mobile should offer such a
  mode, restricted to `auth/*`, is a wallet design question outside this
  standard.
- **Attenuated sub-sessions.** If the chain ever let a session create a
  narrower child session, a session-only wallet could grant without the
  identity's key. That would need consensus changes (a parent link, a shared
  budget, cascading revocation) and a separate proposal.
- **The `iat` window.** Ten minutes is a judgement call, not a tested value.
  It only bounds how long a link may wait before the wallet opens it; the
  identity's signature may come later.

### Verification

Every chain behaviour this draft relies on was exercised on gnodev, built from
gno `83e0a40ea` (chain `dev`), with `gnokey` from the same commit:

> These runs used the earlier host names (`createsession`, `replacesession`,
> `revokesession`). Only the request surface changed since: the transactions
> (create; revoke + create; revoke) and the payload construction are the same,
> apart from the `host=` line.

| behaviour | result |
|---|---|
| a session cannot create a session, even a narrower one, even when it holds `*` | refused: `cannot be signed by a session (privilege escalation)` |
| a session cannot revoke itself | refused, same error |
| the realm sees the identity as caller; `IsUserCall` passes; `GetSessionInfo` reports the session | confirmed, including on an unmodified copy of `bubblerumble5` (`CreatePool`, `Bid`, `Withdraw`) |
| spend covers gas, `Send` and storage deposit | `127300 = 100000 + 1000 + 26300` |
| an over-limit spend costs nothing | refused at the pre-check, 0 gas, balance unchanged |
| `period` resets, and the new window starts at the spend | confirmed |
| inflows do not lower `SpendUsed` | `Withdraw` of 519,615 raised `SpendUsed` by the 100,000 fee only |
| `vm/exec:<p>` matches `<p>/sub` but not `<p>x` | confirmed |
| revoke + create in one tx (`connect` with `old`), through `gnokey sign` and `gnokey broadcast` | works |
| atomicity: revoke + failing create | the revocation is rolled back; the fee is charged |
| same key revoked and recreated in one tx | accepted; new account number, sequence 0 |
| expired sessions stay listed and count towards 16; a 17th is refused | confirmed, before and after expiry |
| an expired session cannot sign | refused: `session expired` |
| revoking an expired session, and replacing one, frees and reuses the slot | confirmed |
| 3 housekeeping revocations + 1 creation in one tx | works |
| an ed25519 session key creates and signs a realm call | works |
| `gnokey sign` with a stale identity sequence | refused: `signature verification failed` |
| chain bounds: `period` > 30 d, `expires` > ~4 y or in the past, bad grammar, empty list | refused in the handler, fee charged |
| more than 8 allow entries | refused at `CheckTx`, no fee |
| `broadcast -dry-run` on a doomed transaction | the failure is reported and no fee is charged; a plain `broadcast` of the same transaction charges the full fee |
| proof of possession: canonical payload, secp256k1 from a `gnokey` keybase and ed25519, base64url, tamper detection | all checks pass (Go, tm2 `crypto`) |
