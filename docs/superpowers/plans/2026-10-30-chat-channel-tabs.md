# Channel Tabs, Rooms and New Pool Without a Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** gno.world's rooms in the app — read, write, make, join, leave, invite, maker tools — switched by a row of channel tabs on Home's chat card (user-picked) and on the Chat tab (pre-filled), plus a "New pool" that is disabled without a session and points to Session.

**Architecture:** The chat store becomes the log of one channel (Public = room `''`); the identity (name, reservation, avatar, wallet proof) moves to its own zustand store. A rooms registry (`src/offchain/rooms/store.ts`) owns the book, the listed rooms, per-room chat stores (max 8 in memory), the one room long-poll beside Public, unread scans and invitations. Two small per-server persisted stores remember Home's tabs and the Chat tab's current channel; a shared `ChannelTabs` row renders both.

**Tech Stack:** Expo SDK 58, Expo Router (typed routes), React Native, TypeScript, zustand 5, Jest 30 (jest-expo), @testing-library/react-native 14 (async `render`/`fireEvent`), the fake off-chain server in `scripts/fake-offchain/`.

**Spec:** `docs/superpowers/specs/2026-10-30-chat-channel-tabs-design.md` (French), which builds on `docs/superpowers/specs/2026-10-13-p3-m2b2-rooms-design.md` (protocol §3, registry §5, errors §7, fake server §8). Read both.

## Global Constraints

- Repo `~/bubblerumble`, branch `feat/channel-tabs`; `git commit -s` (DCO); nothing pushed without the user's go-ahead.
- No new dependency. The system share sheet is React Native's `Share`.
- Wire protocol exactly as M2b-2 §3: `room=<id>` on chat GET/POST/PATCH, withdraw, typing, report, pin, DELETE; `X-Room: <id>` on react and vote; `X-Room-Key: <key>` on pin, line DELETE, `POST/DELETE /api/room?id=`, `POST /api/room/invite?room=`; every poll carries `&name=<display name, ≤96 chars>` (Public too). Public sends no `room` and no `X-Room`.
- Room id: `/^[A-Za-z0-9_-]{20}$/` (`ROOM_ID` in `src/offchain/sync/rooms.ts`). Room link: `https://gno.world/#r/<id>` (ignore any `&ref=…`).
- Storage keys: `br.chat.seen:<server>` and `br.chat.marks:<server>` unchanged for Public; rooms `br.chat.seen:<server>:<id>`, `br.chat.marks:<server>:<id>`; Home tabs `br.home.channels:<server>`; Chat current channel `br.chat.current:<server>`. No migration.
- At most two long-polls: Public (foreground, as today) and the room on screen.
- Scans: registry-driven, every 120 000 ms while the app is in the foreground; plus `poke()` on Chat tab focus and on opening "Show on Home", at most once per 10 000 ms; one room at a time, `wait=0&limit=200`.
- Listed rooms order: `made` ascending, then `id`. Unread counts only for Public and joined rooms.
- Texts, verbatim (spec + M2b-2): `A session lets this phone play. Start one to create a pool.`, `Go to Session ›`, `Show on Home`, `YOUR ROOMS`, `LISTED ON GNO.WORLD`, `could not be listed right now`, `Remove from Home`, `Write in <name> ›`, `say something in <name>`, `Pair with a browser`, `that is not a room link`, `the box did not answer about that room — try again in a moment`, `"<name>" is gone — the room was quiet for a month`, `<from> opened "<name>" for you`, `Open`, `Make a room`, `a name for a new room`, `List it publicly, for anyone to join`, `Make`, `or paste a room's link`, `Join`, `Public rooms`, `none right now — make one and list it`, `empty`, `<n> here`, `open`, `Share link`, `Invite…`, `with two bobs, add the four-letter tag`, `Rename`, `Listed publicly`, `Delete room`, `Delete this room for everyone? It cannot be undone.`, `Leave`, `Pin`, `Unpin`, `Delete`, `renamed to "<name>" for you (the room's maker or the owner renames it for everyone)`, `<to> gets "<name>" on their next poll`.
- Tab pills: one line, ellipsis, `maxWidth: 110`; `🔑 ` before the name when the app holds the maker key.
- Before "done": `npx jest`, `npx tsc --noEmit`, `npx expo lint` (zero errors, zero warnings), `npm run e2e:chat`, `npm run e2e:pair`, `npm run e2e:rooms`; then the iOS simulator against the fake server.
- Comments: short, saying why, matching the surrounding code. Screens read Expo Router from `expo-router` only.

## Review Focus

1. **A Home tab whose room vanished** (left and unlisted, or 404): the tab goes, Home falls back to Public, no crash or blank card — and a failed `/api/rooms` read removes nothing. Pinned in Task 9 (`prune` with `null`).
2. **Switching channels quickly** (tab → tab → other screen): never more than one room long-poll open, and a late poll answer from the old room never lands in the new one. Pinned in Task 6 (`focus` replaces) and Task 4 (epoch per store).
3. **Server switch in Settings with rooms open**: room stores stopped and dropped, book, Home tabs and Chat channel re-read for the new server, no key sent to the wrong server. Pinned in Task 6 (`restart`) and Task 9 (`reload`).
4. **`room` route param for a room not in the row** (link, stale invite): it is joined via `join(id)` or, if gone, the Chat tab stays on Public with the gone message. Pinned in Task 10.
5. **Deep link to `/create` without a session**: the form keeps its disabled "set up a session first" button (unchanged). Pinned in Task 1.

---

### Task 1: Pools — "New pool" disabled without a session

**Files:**
- Modify: `src/screens/pools/index.tsx`
- Test: `src/screens/pools/index.test.tsx` (new)

**Interfaces:**
- Consumes: `useSession((s) => s.active)` from `@/state/app-services`; `Button` (`disabled`, `kind="secondary"`).
- Produces: nothing for later tasks.

- [ ] **Step 1: Write the failing tests** — mock `@/state/app-services` (`useServices: () => ({ game: { allPools: async () => ({ pools: [], ... }), teams: async () => ({}) } })`, `useSession` with a mutable `mockActive`), `expo-router` (`router: { push: jest.fn(), navigate: jest.fn() }`, `useFocusEffect` as `useEffect`), `@/offchain/presence` (`usePresence` with a mutable `mockCountry`, `isPlayBlocked: (c) => c === 'XX'`, `NOPLAY_TEXT: 'blocked'`).
  - `without a session, New pool is disabled and Go to Session navigates there`: `getByRole('button', { name: 'New pool' })` has `accessibilityState.disabled === true`; pressing it does not call `router.push`; `getByText('A session lets this phone play. Start one to create a pool.')`; pressing `Go to Session ›` calls `router.navigate` with `'/session'`.
  - `with a session, New pool opens the form and no hint shows`: press → `router.push('/create')`; `queryByText('Go to Session ›')` is null.
  - `a blocked country shows only the no-play text`: `getByText('blocked')`, no `New pool`, no `Go to Session ›`.
- [ ] **Step 2: Run** `npx jest src/screens/pools/index.test.tsx` — expect FAIL (no hint, button enabled).
- [ ] **Step 3: Implement** in the header: blocked → `NOPLAY_TEXT`; else `New pool` with `disabled={!active}`; when `!active`, the hint `Text` (muted, centered) and `<Button kind="secondary" title="Go to Session ›" onPress={() => router.navigate('/session')} />`.
- [ ] **Step 4: Run** the test file — PASS. Also `npx jest src/screens/create-pool` — still PASS (Review Focus 5: the form is untouched).
- [ ] **Step 5: Commit** `feat(pools): New pool needs a session, with a way to Session`.

---

### Task 2: Identity store split out of the chat store

**Files:**
- Create: `src/offchain/chat/identity-store.ts`, `src/offchain/chat/identity-store.test.ts`
- Modify: `src/offchain/chat/store.ts`, `src/offchain/chat/store.test.ts`, `src/state/app-services.tsx`, `src/screens/chat/identity-sheet.tsx` (+ its test), `src/screens/chat/index.tsx` (+ test), `src/screens/chat/chat-pane.tsx` (+ test), `src/app/pair.tsx`, `src/app/session-callback.tsx`, `src/screens/home/index.test.tsx`, `e2e/chat.e2e.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // identity-store.ts
  export interface IdentityState {
    identity: ChatIdentity; identityError: string; walletSoon: boolean;
    proving: { state: string; name: string; identity: string; chainId: string } | null;
    setName(name: string): Promise<void>;
    reserveName(identity: string): Promise<boolean>;
    onProofReply(r: WalletReply): Promise<boolean>;
    cancelProving(): void;
    releaseName(): Promise<boolean>;
    setAvatar(body: Blob | Uint8Array, contentType: string): Promise<boolean>;
    clearIdentityError(): void;
    reloadIdentity(): Promise<void>;
    /** another server: drop what is shown and read this server's identity */
    restart(): void;
  }
  export interface IdentityDeps { client: ChatClient; identity: IdentityStore; kv: KV; scope?: () => string; wallet?: ChatDeps['wallet'] }
  export function createIdentityState(d: IdentityDeps): StoreApi<IdentityState> & { ready: Promise<void> };
  export const displayName = (i: ChatIdentity) => i.reservedName || i.name || 'anon';
  ```
  `PROVING_KEY` moves here (same value). `ChatState` loses every identity field and action above; `ChatDeps.identity` becomes `identity: () => ChatIdentity` (read at write time) and `wallet` leaves `ChatDeps`. `Services` gains `identity: StoreApi<IdentityState> & { ready: Promise<void> }` and `useIdentity<T>(sel: (s: IdentityState) => T): T`.

- [ ] **Step 1: Move the tests** — tests at `store.test.ts` lines 268–305 and 481–494 (identity part), 561–700 (proof, reload) move to `identity-store.test.ts`, rewritten against `createIdentityState`; add `restart reads the identity of the new server` (save a reserved name under scope A, switch scope to B, `restart()`, `identity.reservedName === ''`). In `store.test.ts`, the remaining tests pass `identity: () => ({ ...NO_IDENTITY, name: 'ann' })`; keep `send posts under the reserved name…` and `send falls back to the free name, then anon…` by changing what `identity()` returns between calls.
- [ ] **Step 2: Run** `npx jest src/offchain/chat` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `identity-store.ts` by moving code from `store.ts` unchanged in behavior (`act` on `identityError`, `setProving`, `walletRefusal`, `parseProving`, `ready` loading identity and proving). The chat store's `name()` becomes `displayName(d.identity())`.
- [ ] **Step 4: Rewire consumers** — `app-services.tsx`: create `identityState` before the chat store, `chat = createChatStore({ ..., identity: () => identityState.getState().identity })`; sync's `identityChanged` → `identityState.getState().reloadIdentity()`; the server-switch effect calls `identityState.getState().restart()` before `chat().restart()`; the name-change subscription subscribes `identityState`. `IdentitySheet` takes `store: StoreApi<IdentityState>`; `ChatPane` reads the name from `useIdentity`; `pair.tsx` uses `useIdentity`; `session-callback.tsx` calls `identity.getState().onProofReply`. Update the mocks in the screen tests and `e2e/chat.e2e.test.ts`'s `app()` (it builds both stores).
- [ ] **Step 5: Run** `npx jest`, `npx tsc --noEmit`, `npm run e2e:chat` — PASS.
- [ ] **Step 6: Commit** `refactor(chat): the identity gets its own store`.

---

### Task 3: Chat client per room; poll reply carries room name and invitations

**Files:**
- Modify: `src/offchain/chat/client.ts`, `src/offchain/chat/types.ts`, `src/offchain/chat/parse.ts`, `src/offchain/chat/client.test.ts`, `src/offchain/chat/parse.test.ts`, `src/offchain/chat/testing.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface RoomInvite { room: string; name: string; from: string; at: number } // a `dm` entry of kind "room"; at in seconds
  // ChatPollReply gains:
  roomName: string | null; // the reply's `name` (a room poll)
  dm: RoomInvite[];        // only kind "room" with a valid room id
  // client.ts
  export interface PollQuery { since: number; wait: number; limit: number; gen: number | null; name: string }
  export interface RoomAccess { room: string; key: () => string } // room '' = Public; key '' = not the maker
  export function createChatClient(oc: Offchain, identity: () => Promise<ChatIdentity>, access?: RoomAccess): ChatClient;
  // ChatClient gains:
  pin(id: number, on: boolean): Promise<{ pins: ChatLine[] }>;
  deleteLine(id: number): Promise<void>;
  ```
  Name-related methods (`reserveName`, `nameChallenge`, `proveName`, `releaseName`, `uploadAvatar`, `reportBoop`) never carry `room`.
- [ ] **Step 1: Write failing tests** in `client.test.ts` with a recording fake `Offchain`:
  - `a room client puts room= on poll, older, post, edit, withdraw and typing`: paths `/api/chat?since=0&wait=0&limit=80&name=ann&room=AAAAAAAAAAAAAAAAAAAA`, `/api/chat?before=9&limit=100&room=…`, `POST /api/chat?room=…`, `PATCH /api/chat?id=5&room=…`, `POST /api/chat/withdraw?room=…`, `POST /api/chat/typing?room=…`.
  - `react and vote carry X-Room, not room=`: headers include `X-Room: AAAAAAAAAAAAAAAAAAAA`.
  - `pin and deleteLine carry X-Room-Key`: `POST /api/chat/pin?id=5&room=…` (and `&on=0` for unpin), `DELETE /api/chat?id=5&room=…`, header `X-Room-Key: k1`.
  - `Public sends no room and no X-Room; the poll carries name= (URL-encoded, cut to 96)`.
  - `name routes never carry room`.
  In `parse.test.ts`: `a poll reply reads the room name and keeps only room invitations with a valid id` (`dm: [{room: 20-char id, name:'x', from:'bob', kind:'room', at: 5}, {kind:'dm', …}, {kind:'room', room:'bad'}]` → one entry).
- [ ] **Step 2: Run** `npx jest src/offchain/chat/client src/offchain/chat/parse` — FAIL.
- [ ] **Step 3: Implement**: a `q(path)` helper appending `room=` when `access.room`; headers merge `X-Room` / `X-Room-Key`; `oc.del` for `deleteLine`. `testing.ts`'s `reply()` gains `roomName: null, dm: []`.
- [ ] **Step 4: Run** the tests — PASS; `npx tsc --noEmit` — clean.
- [ ] **Step 5: Commit** `feat(chat): the chat client talks to one room`.

---

### Task 4: Chat store per room — marks, room name, gone, maker actions, invites out

**Files:**
- Modify: `src/offchain/chat/store.ts`, `src/offchain/chat/store.test.ts`

**Interfaces:**
- Consumes: Task 3's client, `PollQuery.name`.
- Produces — `ChatDeps` gains `room?: string` (default `''`), `onInvites?(dm: RoomInvite[]): void` (called with each poll's `dm`, Public only), `onPosted?(): void` (after a successful `send`); `ChatState` gains:
  ```ts
  roomName: string;   // from the poll, '' for Public or until known
  gone: boolean;      // three 404 polls, 20 s apart: the room is gone and the loop stopped
  pin(id: number, on: boolean): Promise<void>;
  deleteLine(id: number): Promise<void>;
  ```
  Keys: `seenKey()` = `${SEEN_KEY}:${scope}` + (room ? `:${room}` : ''); same for marks.
- [ ] **Step 1: Write failing tests**:
  - `a room keeps its own seen mark and marks` (keys `br.chat.seen:S:AAAAAAAAAAAAAAAAAAAA`, `br.chat.marks:S:AAAA…`; Public's keys untouched).
  - `the poll sends the current display name` (identity changes between polls → `name` follows).
  - `the poll's room name is kept`.
  - `three 404 polls 20 s apart make the room gone and stop polling; a success in between resets the count` (fake `sleep` records 20 000).
  - `pin replaces the pins and patches the line; deleteLine removes it; refusals set error`.
  - `Public hands each poll's invitations to onInvites; a room does not`.
  - `onPosted is called after a successful send only`.
- [ ] **Step 2: Run** `npx jest src/offchain/chat/store` — FAIL.
- [ ] **Step 3: Implement** in the loop: an `OffchainError` with `status === 404` on a room (`d.room`) → `misses++`, `misses >= 3` → `set({ gone: true, phase: 'idle' })` and return, else `sleep(20_000)`; reset `misses` on success. Pass `name: displayName(d.identity()).slice(0, 96)` in every poll query.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(chat): one store per room`.

---

### Task 5: Rooms client and room links

**Files:**
- Create: `src/offchain/rooms/client.ts`, `src/offchain/rooms/client.test.ts`, `src/offchain/rooms/link.ts`, `src/offchain/rooms/link.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface RoomInfo { id: string; name: string; listed: boolean; here: number; made: number }
  export interface ListedRoom { id: string; name: string; here: number; made: number }
  export interface RoomsClient {
    make(name: string, listed: boolean): Promise<{ id: string; name: string; key: string }>; // POST /api/room {name, public}
    info(id: string): Promise<RoomInfo | 'gone'>;                    // GET /api/room?id= ; 404 → 'gone'
    listPublic(): Promise<ListedRoom[]>;                              // GET /api/rooms, sorted made asc then id
    setRoom(id: string, key: string, p: { name: string } | { listed: boolean }): Promise<{ name?: string }>; // POST /api/room?id= {name}|{public}
    dropRoom(id: string, key: string): Promise<void>;                 // DELETE /api/room?id=
    invite(id: string, key: string, to: string, tag: string): Promise<{ to: string }>; // POST /api/room/invite?room= {to, tag, name}
    scan(id: string, since: number): Promise<ChatPollReply>;          // GET /api/chat?since=&wait=0&limit=200&room=
  }
  export function createRoomsClient(oc: Offchain, identity: () => Promise<ChatIdentity>): RoomsClient;
  // link.ts
  export function parseRoomLink(text: string): string | null; // `…#r/<id>[&…]` or a bare id; validated by ROOM_ID
  export const roomLink = (baseUrl: string, id: string) => `${baseUrl.replace(/\/+$/, '')}/#r/${id}`;
  ```
  `invite` sends `name` = the inviter's display name; every write carries `X-Name-Key` as the chat client does.
- [ ] **Step 1: Write failing tests** — one per method for path, method, body and headers (`X-Room-Key` on setRoom/dropRoom/invite); `info` 404 → `'gone'`; `listPublic` drops malformed entries and sorts by `made` then `id`; `parseRoomLink` accepts `https://gno.world/#r/<id>`, `https://gno.world/#r/<id>&ref=g1…`, a bare id, surrounding spaces; rejects `https://gno.world/`, a 19-char id, `#rumble/3`.
- [ ] **Step 2: Run** `npx jest src/offchain/rooms` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(rooms): rooms client and links`.

---

### Task 6: Rooms registry

**Files:**
- Create: `src/offchain/rooms/store.ts`, `src/offchain/rooms/store.test.ts`
- Modify: `src/offchain/sync/rooms.ts` (export `remember`/`forget` helpers)

**Interfaces:**
- Consumes: `BookStore`, `mergeBook`, `Book`, `RoomEntry` (sync/rooms.ts); Task 4's `createChatStore`; Task 5's client and `parseRoomLink`; `unreadCount`, `isMine` (merge.ts).
- Produces:
  ```ts
  // sync/rooms.ts
  export function rememberRoom(b: Book, e: { id: string; name: string; key?: string }, at: number): Book; // site's roomRemember: to the front, at=now, key kept if known, id out of left
  export function forgetRoom(b: Book, id: string, at: number): Book;                                       // site's roomForget: out, left[id]=at

  // rooms/store.ts
  export interface RoomsState {
    book: Book;
    listed: ListedRoom[] | null;  // null: never read on this server
    listedError: boolean;
    unread: Record<string, number>;       // scan counts for rooms without a live store
    invited: Record<string, string>;      // id → from, until opened
    banner: { id: string; name: string; from: string } | null;
    goneSaid: string | null;              // the room name to say "is gone" for, until dismissed
    focused: string;                      // the room long-polling beside Public ('' none)
    room(id: string): ChatStore;          // '' → Public's store; else created on demand, LRU max 8
    keyOf(id: string): string;            // maker key from the book, '' none
    unreadOf(id: string): number;         // live store → unreadCount, else unread[id]
    focus(id: string): void;              // stop the previous room's loop, start this one's ('' stops only)
    blur(id: string): void;               // stop it if it is the focused one
    open(id: string): void;               // focus + invited/unread cleared
    join(text: string): Promise<{ id: string } | { error: string }>;
    make(name: string, listed: boolean): Promise<{ id: string } | { error: string }>;
    leave(id: string): Promise<void>;
    rename(id: string, name: string): Promise<string>;   // the words to show (§3 of M2b-2)
    setListed(id: string, on: boolean): Promise<string>; // '' ok, else the error
    drop(id: string): Promise<string>;
    invite(id: string, to: string, tag: string): Promise<string>; // success words or error
    onInvites(dm: RoomInvite[]): void;
    scanAll(): Promise<void>;
    refreshListed(): Promise<void>;
    poke(): void;                         // refreshListed + scanAll, at most once per 10 s
    resume(): void;                       // foreground: book read, timer every 120 s (poke-free), focused room restarted
    pause(): void;                        // background: timer and room loops off
    restart(): void;                      // another server: stores dropped, state reset, epoch++, resume()
    reloadBook(): Promise<void>;          // the sync store changed the book; a room left elsewhere closes its store
    dismissBanner(): void;
    dismissGone(): void;
  }
  type ChatStore = StoreApi<ChatState> & { ready: Promise<void> };
  export interface RoomsDeps {
    client: RoomsClient; book: BookStore; publicStore: ChatStore;
    makeRoomStore(id: string): ChatStore;  // app-services builds it with the room's client, onPosted → remember if not joined
    syncChanged(): void; now?: () => number; setInterval?: typeof setInterval; clearInterval?: typeof clearInterval;
  }
  export function createRoomsStore(d: RoomsDeps): StoreApi<RoomsState>;
  ```
  Join-on-first-line: `makeRoomStore` is given `onPosted` that calls the registry's internal `ensureJoined(id, name)` (remember only when not in the book; name from `listed` or the store's `roomName`).
- [ ] **Step 1: Write failing tests** with a fake `RoomsClient`, an in-memory `BookStore`, fake room stores (`createChatStore` over a fake chat client) and fake timers:
  - `rememberRoom / forgetRoom follow the site` (front, at, key kept, left cleared / set).
  - `focus starts one room loop and stops the previous; focus('') stops it; blur only stops the focused one`.
  - `at most 8 room stores: the least recently opened is stopped and dropped` (never Public, never the focused one).
  - `join: a link is remembered and returned; gone forgets and says the site's message; a network error says the box did not answer; junk says not a room link`.
  - `make remembers the room with its key and calls syncChanged`.
  - `leave stops and drops the store and writes left`.
  - `rename with the key calls setRoom then remembers; without it only the label changes and the words say so`.
  - `setListed, drop and invite need the key and return the server's words on refusal`; `drop leaves`.
  - `onInvites remembers the room; under an hour and unseen it sets invited and banner; older or already seen does not`.
  - `scanAll counts lines past the mark that are not mine, skips the focused room, marks 404 rooms gone without forgetting; with no mark the count is 0 and the mark becomes next`.
  - `a room store that goes gone is forgotten and its name is said once` (`goneSaid`).
  - `poke runs at most once per 10 s; resume runs it every 120 s; pause stops it`.
  - `refreshListed keeps the last list on failure and sets listedError`.
  - `restart drops room stores, reads the new server's book, and ignores answers from before` (a `join` resolving after `restart` changes nothing).
  - `reloadBook: a room left elsewhere closes its store`.
- [ ] **Step 2: Run** `npx jest src/offchain/rooms/store src/offchain/sync/rooms` — FAIL.
- [ ] **Step 3: Implement.** Book writes are read-modify-write (`await d.book.load()` → `rememberRoom`/`forgetRoom` → `save`) so a concurrent `/pair` pull is merged, not overwritten. Scan marks: the room store's `lastSeen` when it exists, else the stored `br.chat.seen:<server>:<id>` read through the room store's own key helper — export `seenKeyFor(scope, room)` from `store.ts` for it.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(rooms): the rooms registry`.

---

### Task 7: Fake server rooms, wiring, and the rooms e2e

**Files:**
- Modify: `scripts/fake-offchain/server.ts`, `src/state/app-services.tsx`, `src/app/(tabs)/_layout.tsx`, `package.json` (script `e2e:rooms`)
- Create: `e2e/rooms.e2e.test.ts`

**Interfaces:**
- Consumes: Tasks 3–6.
- Produces: `Services` gains `rooms: StoreApi<RoomsState>`; `useRooms<T>(sel: (s: RoomsState) => T): T`; `useRoomOnScreen(id: string): void` in `src/screens/channels/use-room-on-screen.ts` (`useFocusEffect` → `rooms.focus(id)`, cleanup `rooms.blur(id)`). Fake server test hook: `FakeServer.vanish(roomId: string): void` (404 everywhere for it).
- [ ] **Step 1: Fake server** — per M2b-2 §8: logs per room (`room=` on every chat route, `X-Room` on react/vote), `POST/GET/DELETE /api/room`, `GET /api/rooms` (listed ones, with `made`, `here`), `POST /api/room/invite` (adds `{room, name, from, kind:'room', at}` to the `dm` of the Public poll of the client that last polled with `&name=<to>`), pin and line delete with `X-Room-Key`, `name` and `here` in a room poll, `vanish()`. Error texts from M2b-2 §3.
- [ ] **Step 2: Write the e2e** (`e2e/rooms.e2e.test.ts`, two apps as in `e2e/chat.e2e.test.ts`, each with identity state + Public store + registry):
  - `ann makes a room, bob joins by its link, lines go both ways`.
  - `ann invites bob; bob's Public poll brings the invitation and a banner`.
  - `maker tools: rename for everyone, list then unlist, pin, delete a line, drop the room`.
  - `bob leaves; the book has it in left`.
  - `a vanished room is gone after three 404s` (fake sleep shortened via deps).
  - `with site-sync, a made room and a left room reach the browser by /pair` (reuse `scripts/fake-offchain/site-sync.ts` as `e2e/pair.e2e.test.ts` does).
  - `never more than two long-polls open` (count open `wait>0` requests in the fake server while focusing rooms in turn).
- [ ] **Step 3: Run** `npm run e2e:rooms` — FAIL until wired.
- [ ] **Step 4: Wire `app-services.tsx`** — create the rooms client and registry; `publicStore` = the existing chat store, built with `onInvites: (dm) => rooms.getState().onInvites(dm)`; `makeRoomStore(id)` builds `createChatStore({ client: createChatClient(offchain, () => identity.load(), { room: id, key: () => rooms.getState().keyOf(id) }), room: id, identity: …, kv: AsyncStorage, scope })`; foreground → `rooms.resume()`, background → `pause()`; server switch → `rooms.restart()`; `sync.subscribe` on `rooms` change → `rooms.reloadBook()`. Tab badge in `(tabs)/_layout.tsx`: Public unread + `Σ unreadOf(id)` over book ids.
- [ ] **Step 5: Run** `npm run e2e:rooms`, `npm run e2e:chat`, `npm run e2e:pair`, `npx jest`, `npx tsc --noEmit` — PASS.
- [ ] **Step 6: Commit** `feat(rooms): fake server rooms, wiring, e2e`.

---

### Task 8: `ChannelTabs`

**Files:**
- Create: `src/screens/channels/channel-tabs.tsx`, `src/screens/channels/channel-tabs.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface Channel { id: string; name: string; keyed?: boolean; unread?: number }
  export function ChannelTabs(p: {
    channels: Channel[]; current: string; onSelect(id: string): void;
    separatorAfter?: number;        // index after which the divider goes (Chat tab)
    onAdd?(): void;                 // dashed ＋ pill at the end (Home full screen)
    onLongPress?(id: string): void; // never fired for Public ('')
  }): JSX.Element;
  ```
- [ ] **Step 1: Write failing tests**: `each pill is a tab, the current one selected` (`getAllByRole('tab')`, `accessibilityState.selected`); `the label says the unread count` (`Dev chat, 3 unread`); `a keyed room shows 🔑`; `pressing a pill selects it`; `＋ shows only with onAdd` (label `Add a channel`); `long-press on Public does nothing, on a room calls onLongPress`; `the divider renders after separatorAfter` (testID `channel-separator`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** — horizontal `ScrollView`, `showsHorizontalScrollIndicator={false}`; scroll the current pill into view on change (`onLayout` x → `scrollTo`); styles from the mockup (border `colors.line`, current `colors.accent`, unread badge `colors.bad`).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(channels): the channel tabs row`.

---

### Task 9: Home — tabs on the card and full screen, "Show on Home", "Write in …"

**Files:**
- Create: `src/screens/channels/home-channels.ts` (+ `.test.ts`), `src/screens/home/full/show-on-home.tsx`
- Modify: `src/screens/home/chat-card.tsx`, `src/screens/home/full/chat-full.tsx`, `src/state/app-services.tsx`, `src/screens/home/cards.test.tsx`, `src/screens/home/full/full.test.tsx`, `src/screens/home/index.test.tsx`

**Interfaces:**
- Consumes: `ChannelTabs`, `useRooms`, `useRoomOnScreen`, `Channel`.
- Produces:
  ```ts
  export interface HomeChannelsState {
    tabs: { id: string; name: string }[]; // tabs[0] is always Public {id:'', name:'Public'}
    current: string;
    add(c: { id: string; name: string }): void;  // appended, becomes current; no duplicate
    remove(id: string): void;                    // not Public; removing current → ''
    select(id: string): void;
    prune(valid: Set<string> | null): void;      // null (listing not read) removes nothing
    reload(): Promise<void>;                     // the current server's record; unreadable → default
  }
  export function createHomeChannels(d: { kv: KV; scope: () => string }): StoreApi<HomeChannelsState> & { ready: Promise<void> };
  ```
  `Services` gains `homeChannels`; server switch → `homeChannels.getState().reload()`.
- [ ] **Step 1: Write failing tests**
  - `home-channels.test.ts`: `default is Public only`; `add appends and selects, no duplicates`; `Public cannot be removed; removing the current one falls back to Public`; `saved per server and read back` (key `br.home.channels:<server>`); `a damaged record is the default`; `prune(null) keeps everything; prune(set) drops tabs not in it and falls back`.
  - `cards.test.tsx`: `the card shows the current channel's lines and its tabs; a tab switches without opening`; `the card's label names the channel` (`/^Chat, Dev chat\./`); `pressing the lines opens the full screen`.
  - `full.test.tsx`: `the full screen switches channel for Home too`; `＋ opens Show on Home with YOUR ROOMS and LISTED ON GNO.WORLD, ✓ on tabs already there; a row adds or removes`; `could not be listed right now when /api/rooms failed`; `long-press a room tab → Remove from Home`; `Write in Dev chat › dismisses to /chat with room=<id>` (`router.dismissTo({ pathname: '/chat', params: { room: id } })`, Public → `params: {}`).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: the card and full screen read `homeChannels.current`, `rooms.room(current)` for lines and `useRoomOnScreen(current)`; "Show on Home" is a `Modal` sheet in `show-on-home.tsx` calling `rooms.poke()` on open, listing `book.rooms` then `listed` minus book with `<n> here`; prune runs in an effect: `valid` = book ids ∪ listed ids when `listed !== null`, plus `''`; a room store `gone` also prunes it. Mark seen per channel as today (`markSeen` on the shown store).
- [ ] **Step 4: Run** `npx jest src/screens/home src/screens/channels` — PASS.
- [ ] **Step 5: Commit** `feat(home): channel tabs on the chat card`.

---

### Task 10: Chat tab — pre-filled row, current channel, header, banner, gone

**Files:**
- Create: `src/screens/channels/chat-channels.ts` (+ `.test.ts`), `src/screens/chat/chat-header.tsx`
- Modify: `src/screens/chat/index.tsx` (+ test), `src/screens/chat/chat-pane.tsx` (+ test), `src/state/app-services.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function chatRow(book: Book, listed: ListedRoom[] | null, unreadOf: (id: string) => number): { channels: Channel[]; separatorAfter?: number };
  // Public, book.rooms (as stored: at desc), then listed minus book; separatorAfter = index of the last joined room when listed ones follow;
  // `unread` set for Public and joined rooms only (a listed room being read has a store, but no counter)
  export interface ChatChannelState { current: string; select(id: string): void; reload(): Promise<void> }
  export function createChatChannel(d: { kv: KV; scope: () => string }): StoreApi<ChatChannelState> & { ready: Promise<void> }; // key br.chat.current:<server>
  export function ChatHeader(p: { here: number; onOpenIdentity(): void; onAdd(): void; onMenu(): void }): JSX.Element;
  ```
  `ChatPane` loses its header and `onOpenPair`; gains `placeholder: string`, `canModerate: boolean` (maker key held: line menu adds Pin/Unpin and Delete).
- [ ] **Step 1: Write failing tests**
  - `chat-channels.test.ts`: `the row is Public, joined rooms, then listed ones not joined, with the separator`; `no separator without listed rooms`; `listed null shows joined only`; `current channel saved per server`.
  - `index.test.tsx`: `the room param selects that channel then is cleared` (`router.setParams({ room: undefined })`); `a room param not in the row is joined via join(id)`; `a gone join leaves Public current and says the gone message`; `a current channel no longer in the row falls back to Public`; `the header shows "Chat · N here", the name pill, ＋ and ⋯`; `⋯ on Public shows only Pair with a browser`; `the banner shows, Open selects the room, × dismisses`; `the gone message shows and can be dismissed`; `the composer placeholder names the channel`; `Chat focus pokes the registry` and `useRoomOnScreen` focuses the current room.
  - `chat-pane.test.tsx`: `with canModerate the line menu offers Pin and Delete; Delete asks first`; `without it, neither shows`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `ChatScreen` = `ChatHeader` + `ChannelTabs` + banner + gone line + `ChatPane` (store = `rooms.room(current)`); `IdentitySheet` as today (store = identity state); a sent first line in a listed room joins it (Task 6's `onPosted`). The existing `identity=1` param handling stays.
- [ ] **Step 4: Run** `npx jest src/screens/chat src/screens/channels` — PASS.
- [ ] **Step 5: Commit** `feat(chat): channel tabs on the Chat tab`.

---

### Task 11: Rooms sheets — ＋, ⋯ room menu, invite, share

**Files:**
- Create: `src/app/rooms/new.tsx`, `src/screens/rooms/new-sheet.tsx` (+ test), `src/screens/rooms/room-menu.tsx` (+ test), `src/screens/rooms/invite-sheet.tsx` (+ test)
- Modify: `src/app/_layout.tsx` (`rooms/new` as `presentation: 'formSheet'`, title `New room`), `src/screens/chat/index.tsx`

**Interfaces:**
- Consumes: registry actions (Task 6), `roomLink`, `RoomsClient.info` for the listed state, `chatChannel.select`.
- Produces: `RoomMenu(p: { id: string; onClose(): void; onLeft(): void })`, `InviteSheet(p: { id: string; visible: boolean; onClose(): void })`.
- [ ] **Step 1: Write failing tests**
  - `new-sheet.test.tsx`: `Make makes the room, selects it in Chat and opens the share sheet` (`Share.share` with `roomLink`); `Join with a link selects the room`; `junk says that is not a room link`; `Public rooms lists /api/rooms with N here or empty and open for joined ones; search shows from 9 rooms`; `none right now — make one and list it`; `could not be listed right now`; server errors shown verbatim.
  - `room-menu.test.tsx`: `with the key: Share link, Invite…, Rename, Listed publicly, Delete room, Leave, Pair with a browser`; `without it: Share link, Rename, Leave, Pair with a browser`; `Delete room confirms with the exact text, then drops and returns to Public`; `Rename without the key says renamed for you`.
  - `invite-sheet.test.tsx`: `name and optional 4-hex tag; success says <to> gets "<name>" on their next poll; a bad tag is refused before sending`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** (`Alert.alert` for confirmations, `Alert.prompt`-free rename: a small `Modal` with a `Field`, since `Alert.prompt` is iOS-only).
- [ ] **Step 4: Run** `npx jest src/screens/rooms src/screens/chat` — PASS.
- [ ] **Step 5: Commit** `feat(rooms): make, join, room menu, invite`.

---

### Task 12: Deep link, docs, full verification

**Files:**
- Modify: `src/screens/pair/index.tsx` (drop `Opening rooms comes with the next update.`), `docs/superpowers/specs/2026-10-01-bubblerumble-mobile-design.md` §9 (M2b-2 delivered with tabs), `docs/superpowers/specs/2026-10-13-p3-m2b2-rooms-design.md` (one line at the top: screens superseded by the 2026-10-30 spec)

- [ ] **Step 1:** Check `gno.world://chat?room=<id>` opens the Chat tab on the room (the `room` param path of Task 10) with `xcrun simctl openurl booted 'gno.world://chat?room=<id>'` against the fake server (`npm run fake-offchain`, Settings → off-chain URL).
- [ ] **Step 2: Run** `npx jest`, `npx tsc --noEmit`, `npx expo lint`, `npm run e2e:chat`, `npm run e2e:pair`, `npm run e2e:rooms` — all PASS, zero lint warnings.
- [ ] **Step 3: Manual iOS simulator pass** against the fake server: Pools without/with a session; Home card tabs, full screen add/remove, Write in …; Chat row, switching, ＋ make/join, ⋯ maker tools, invite from a second client (`npm run fake-browser` or a second e2e app), banner, vanish → gone message. Then production read-only: `/api/rooms` listed in the row, open "Dev chat" without writing.
- [ ] **Step 4: Commit** `docs: rooms with channel tabs delivered`.
