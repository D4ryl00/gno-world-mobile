# Home Cards Full Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping a Home card (GNOT, Here Now, Chat) opens it full screen with more detail — a price chart you can read with a finger, a world map of who is here, the chat to read — and Home's GNOT card shows fdv like the site.

**Architecture:** Three Expo Router routes under `src/app/home/` presented as `modal` on the root stack; their screens live in `src/screens/home/full/`. The fetchers in `src/offchain/home.ts` read the extra fields (`fdv`, `supply`, `volumes`, `spots`); pure scale/tick/format helpers sit in `src/screens/home/format.ts`; the chart and map are `react-native-svg`. The crosshair uses React Native's responder props (the app has no `GestureHandlerRootView`) and turns the sheet's `gestureEnabled` off while held. The land outline is a generated TypeScript constant.

**Tech Stack:** Expo SDK 58, Expo Router 58 (typed routes), React Native 0.88, TypeScript, zustand 5, react-native-svg 15.16, Jest 30 (jest-expo), @testing-library/react-native 14 (async `render`/`fireEvent`).

**Spec:** `docs/superpowers/specs/2026-10-29-home-fullscreen-design.md` (French). Parent: `docs/superpowers/specs/2026-10-29-home-tab-design.md`.

## Global Constraints

- Repo `~/bubblerumble`, branch `feat/home-tab` (local, ahead of PR #2); `git commit -s`; nothing pushed without the user's go-ahead.
- No new dependency (JS or native). Chart and map: `react-native-svg`. No d3, no map library at runtime.
- Routes, verbatim: `GET /api/prices?coin=gnot&days=<1|7|30>` (now also read: `fdv`, `supply`, `volumes`), `GET /api/where` (now also read: `spots`).
- Same refresh rules as the cards: `usePoll`, prices every 300 000 ms keyed by days, where every 20 000 ms; same loading/failure texts as the cards.
- Colours from `src/theme.ts`, plus the site's chart colours `#ff7676` (change < 0) and `#3ddc84` (change ≥ 0) for the full-screen price line.
- Texts, verbatim: `a dot per place, about 25 km precise`, `countries unavailable on this build`, `Write in Chat ›`, `fdv $…`, `mc $…`, `vol $…`, hint `Opens the chat to read`.
- Before "done": `npx jest`, `npx tsc --noEmit`, `npx expo lint` with zero errors and zero warnings; check on the iOS simulator.
- Comments: short, saying why, as in the surrounding code.

## Review Focus

1. **Finger outside the data** (left of the first point, right of the last, or a 2-point series): the crosshair snaps to the nearest end, never undefined — pinned in Task 2 (`nearestIndex`).
2. **`volumes` shorter than `series`, missing, or with non-numbers**: bars only where a number exists; the readout drops the `vol` part for that point — pinned in Tasks 1 and 2.
3. **Bad `spots`** (lat/lon out of range, `n` ≤ 0, not an array) and `geo: false`: dropped / no dots, never a crash — pinned in Tasks 1 and 3.
4. **A `days` route param that is not 1, 7 or 30** (deep link, typo): the price view falls back to 1 — pinned in Task 5.
5. **Read-only chat**: a long press or a tap on a reaction or a poll option does nothing — pinned in Task 4.

---

### Task 1: Read the extra fields

**Files:**
- Modify: `src/offchain/home.ts`, `src/offchain/home.test.ts`, `scripts/fake-offchain/server.ts`

**Interfaces:**
- Produces: `Prices` gains `fdv: number; supply: number; volumes: [number, number][]` (0 / `[]` when absent); `Where` gains `spots: Spot[]`; `export interface Spot { cc: string; lat: number; lon: number; n: number }`.

- [ ] **Step 1: Failing tests** in `home.test.ts`:
  - update the two `fetchPrices` `toEqual`s with `fdv: 0, supply: 0, volumes: []` where absent;
  - `test('fetchPrices reads fdv, supply and the finite volume points')`: reply `{ now: 0.0583, change: -0.02, cap: 11503756, fdv: 77713900, supply: 1333000000, series: [[1, 0.06], [2, 0.061]], volumes: [[1, 1112.5], [2, 'x'], [3]] }` → `fdv: 77713900, supply: 1333000000, volumes: [[1, 1112.5]]`;
  - `test('fetchWhere keeps only well-formed spots')`: `spots: [{ cc: 'FR', lat: 48.5, lon: 1.5, n: 2 }, { cc: 'XX', lat: 95, lon: 0, n: 1 }, { cc: 'ES', lat: 41.5, lon: 2.25, n: 0 }, { cc: 'BR', lat: -23.5, lon: 'x', n: 1 }, null]` → `spots: [{ cc: 'FR', lat: 48.5, lon: 1.5, n: 2 }]`; `spots: 'nope'` → `[]`; update the existing `fetchWhere` `toEqual`s with `spots: []`.
- [ ] **Step 2:** `npx jest src/offchain/home.test.ts` → FAIL (missing fields).
- [ ] **Step 3:** Implement in `home.ts`. A spot is kept when `cc` is a string, `lat` in [-90, 90], `lon` in [-180, 180], `n` > 0, all finite. Volumes filtered like series.
- [ ] **Step 4:** Fake server: `/api/prices` adds `fdv: 77713900`, `supply: 1333000000`, `volumes` (one `[t, v]` per series point, some zeros); `/api/where` adds `spots` matching its `by_country` (FR ×2 places summing 3, ES 1).
- [ ] **Step 5:** `npx jest src/offchain` → PASS; `npx tsc --noEmit` clean.
- [ ] **Step 6:** `git commit -s -m "feat(home): read fdv, supply, volumes and the places people are"`

### Task 2: Numbers, scales and ticks; fdv on the Home card

**Files:**
- Modify: `src/screens/home/format.ts`, `format.test.ts`, `price-card.tsx`, `cards.test.tsx`, `index.test.tsx`; `docs/superpowers/specs/2026-10-29-home-tab-design.md` §4 (cap → fdv, with the `mc` fallback)

**Interfaces:**
- Produces (all in `format.ts`):
  - `shortUsd(usd: number): string` — `$77.7M`, `$1M` for 999 950, `$950`; the rounding rule of today's `formatCap`, which it replaces.
  - `shortNum(v: number, digits = 1): string` — `1.33B` with `digits` 2.
  - `formatFdv(p: Pick<Prices, 'fdv' | 'cap'>): string | null` — `fdv $77.7M`; else `mc $11.5M`; else `null`.
  - `readoutText(t: number, price: number, vol: number | null): string` — `27 Oct 14:05 · $0.0594 · vol $1.2k`; `vol $0` for 0; no vol part for `null`. Local time, `en-GB` day + short month, 24 h.
  - `interface Scale { x(t: number): number; y(p: number): number; min: number; max: number; nearestIndex(px: number): number }` and `priceScale(series: [number, number][], box: { left: number; right: number; top: number; bottom: number }): Scale` — y spans min..max of the series (flat series: middle), x spans first..last time.
  - `niceTicks(min: number, max: number, count: number): number[]` — round steps (1, 2, 5 × 10^k) inside [min, max].
  - `timeTicks(t0: number, t1: number, days: PriceDays): { t: number; label: string }[]` — 1d: each 6 h on the hour, label `HH:00`; 7d: each local midnight, label day of month; 30d: each 7th local midnight from t0, label `27 Oct`.

- [ ] **Step 1: Failing tests** in `format.test.ts`: the values above, plus
  - `nearestIndex` on `[[0,1],[10,2],[20,3]]` in a box 0..200: px −50 → 0, px 95 → 1, px 999 → 2; a 2-point series → 0 or 1;
  - `niceTicks(0.0567, 0.0617, 5)` → `[0.057, 0.058, 0.059, 0.06, 0.061]`;
  - `timeTicks` for a 1d window starting 2026-10-28 13:24 local → first tick 18:00, labels `18:00, 00:00, 06:00, 12:00`;
  - the old `formatCap` tests move to `shortUsd`.
- [ ] **Step 2:** In `cards.test.tsx` and `index.test.tsx`, fixtures gain `fdv: 77713900`; expected `cap $11.5M` becomes `fdv $77.7M`; add `test('without fdv the card shows the market cap as mc, as the site')` (`fdv: 0` → `mc $11.5M`).
- [ ] **Step 3:** `npx jest src/screens/home` → FAIL.
- [ ] **Step 4:** Implement; the price card renders `formatFdv(shown)` where it rendered `formatCap`. Fix the parent spec's §4 line.
- [ ] **Step 5:** `npx jest src/screens/home` → PASS.
- [ ] **Step 6:** `git commit -s -m "feat(home): the GNOT card shows fdv as the site; scales, ticks and readout for the full chart"`

### Task 3: The world map

**Files:**
- Create: `scripts/world-land.mjs`, `src/screens/home/full/world-land.ts` (generated), `src/screens/home/full/world-map.tsx`, `src/screens/home/full/world-map.test.tsx`

**Interfaces:**
- Produces: `LAND_PATH: string` (SVG path in a viewBox `-180 -84 360 144`, i.e. x = lon, y = −lat, Antarctica cut below −60°); `WorldMap({ spots, width }: { spots: Spot[]; width: number })` — height = width × 144 / 360.

- [ ] **Step 1:** Write `scripts/world-land.mjs` (Node, no dependency): fetch `https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json`, decode the TopoJSON arcs (delta + transform) of `objects.land`, emit one path (`M…L…Z`, 1 decimal, rings entirely below −60° dropped), write `src/screens/home/full/world-land.ts` with a header comment naming the source and the command. Run it: `node scripts/world-land.mjs`. Expected: file written, under 120 KB.
- [ ] **Step 2: Failing test** `world-map.test.tsx`: `test('one dot per place, bigger for more people')` — two spots (n 1 and 3) → two elements with testID `map-spot`, the second's `r` larger; `test('no places, no dots')` → zero `map-spot`, land path present (testID `map-land`).
- [ ] **Step 3:** `npx jest src/screens/home/full/world-map.test.tsx` → FAIL.
- [ ] **Step 4:** Implement `WorldMap`: `Svg` with the viewBox, land `fill={colors.line}`, dots `colors.accent` at (lon, −lat), radius growing with `n` (builder's curve, readable at n = 1).
- [ ] **Step 5:** PASS; `git commit -s -m "feat(home): a flat world map with the places people are"`

### Task 4: Chat lines that can be read only

**Files:**
- Modify: `src/screens/chat/chat-line.tsx`, `src/screens/chat/chat-line.test.tsx`

**Interfaces:**
- Produces: `ChatLineRow` gains `readOnly?: boolean`. When true: no long-press menu (neither touch nor the accessibility `menu`/`longpress` actions), reactions and poll options render as plain views (not buttons, no `onPress`); links and the reply jump stay tappable.

- [ ] **Step 1: Failing test** `test('read only: no menu, no reacting, no voting; the quoted line still jumps')` — a line with a reaction, a poll and a reply: long press → `onLongPress` not called; no role `button` for the reaction or the options; press on the quote → `onJump` called.
- [ ] **Step 2:** FAIL → implement → `npx jest src/screens/chat` PASS.
- [ ] **Step 3:** `git commit -s -m "feat(chat): chat lines can be shown read only"`

### Task 5: The price view (chart, figures, route)

**Files:**
- Create: `src/screens/home/full/full-header.tsx`, `src/screens/home/full/price-chart.tsx`, `src/screens/home/full/price-full.tsx`, `src/screens/home/full/price-full.test.tsx`, `src/app/home/price.tsx`
- Modify: `src/app/_layout.tsx`

**Interfaces:**
- Consumes: Task 1 `Prices`; Task 2 `priceScale`, `niceTicks`, `timeTicks`, `shortUsd`, `shortNum`, `formatPrice`, `formatChange`; `usePoll`.
- Produces:
  - `FullHeader({ title, right, onClose }: { title: string; right?: ReactNode; onClose(): void })` — title left, `right` then a ✕ button (`accessibilityLabel="Close"`).
  - `PriceChart({ data, days, color, onPick }: { data: Prices; days: PriceDays; color: string; onPick?(i: number | null): void })` — fills its parent (measures itself); testIDs `full-chart`, `vol-bar` (one per non-zero volume point).
  - `PriceFull({ initialDays }: { initialDays: PriceDays })`.
  - Route `/home/price?days=N`; root stack entries `home/price`, `home/here`, `home/chat` with `presentation: 'modal', headerShown: false` (the two other routes arrive in Task 7).

- [ ] **Step 1: Failing tests** `price-full.test.tsx` (mock `@/state/app-services` and `expo-router` as `index.test.tsx` does):
  - `test('header, figures and periods')`: `$0.0583`, `−0.02%`, `fdv $77.7M`, `$11.5M`, `1.33B GNOT`, the period's high/low via `formatPrice`, volume total via `shortUsd`; the 7 days button selected when `initialDays` 7; pressing 30 days requests `days=30`;
  - `test('an unknown days param opens on 1 day')` — route component with `useLocalSearchParams` → `{ days: 'abc' }` requests `days=1`;
  - `test('✕ closes')` → `router.back` called;
  - `test('a figure the server does not give is not shown')` — `fdv: 0, supply: 0` → no `fdv`, no `GNOT` supply line.
- [ ] **Step 2:** FAIL → implement. Chart layout: price axis on the right (labels from `niceTicks`, horizontal grid lines `#ffffff10`), time labels at the bottom (`timeTicks`), volume bars in the bottom fifth, area under the line at low opacity, line colour from the sign of `change`.
- [ ] **Step 3:** `npx jest src/screens/home` PASS; open `/home/price?days=7` on the iOS simulator by tapping nothing yet: `xcrun simctl openurl <udid> "world.gno.app://home/price?days=7"` and look at it.
- [ ] **Step 4:** `git commit -s -m "feat(home): the GNOT price full screen"`

### Task 6: The crosshair

**Files:**
- Create: `src/screens/home/full/use-crosshair.ts`, `src/screens/home/full/use-crosshair.test.tsx`
- Modify: `price-chart.tsx`, `price-full.tsx`, `price-full.test.tsx`

**Interfaces:**
- Consumes: `Scale.nearestIndex`, `readoutText`.
- Produces: `useCrosshair(opts: { holdMs?: number; slop?: number; onPick(px: number | null): void }): { responder: GestureResponderHandlers }` — defaults `holdMs` 200, `slop` 8. A press held `holdMs` without moving more than `slop` activates; then moves call `onPick(x)`; release or termination calls `onPick(null)`; moving beyond `slop` before activation gives the touch up (`onResponderTerminationRequest` true until active, false after).

- [ ] **Step 1: Failing tests** (fake timers; drive the handlers directly):
  - hold 200 ms then move to x 120 → `onPick(120)`; release → `onPick(null)`;
  - move 20 px before 200 ms → `onPick` never called;
  - in `price-full.test.tsx`: after a pick on the chart (drive `full-chart`'s responder), the readout shows `readoutText(...)` for that point and `navigation.setOptions` was called with `{ gestureEnabled: false }`; after release, with `{ gestureEnabled: true }` and the readout is empty.
- [ ] **Step 2:** FAIL → implement; the chart draws the dashed vertical and horizontal lines, the dot, and the price label on the right axis for the picked index.
- [ ] **Step 3:** PASS; on the simulator: hold and slide (`idb ui swipe` with `--duration`, or a long press then swipe), screenshot, compare the price with the site's crosshair at the same time.
- [ ] **Step 4:** `git commit -s -m "feat(home): read the price at a moment with a finger"`

### Task 7: Here Now and Chat views

**Files:**
- Create: `src/screens/home/full/here-full.tsx`, `src/screens/home/full/chat-full.tsx`, `src/screens/home/full/full.test.tsx`, `src/app/home/here.tsx`, `src/app/home/chat.tsx`
- Modify: `src/screens/home/here-card.tsx` (export `CountryRow({ row, total }: { row: HereRow; total?: number })`, which adds the share column when `total` is given)

**Interfaces:**
- Consumes: Task 1 `Where.spots`; Task 3 `WorldMap`; Task 4 `readOnly`; `usePoll`, `hereRows`, `hereText`, `FullHeader`.
- Produces: `HereFull()`, `ChatFull()`.

- [ ] **Step 1: Failing tests** `full.test.tsx`:
  - Here: header `22 people`; 12 countries all rendered (no height cap), each with its share (`FR` 5 of 22 → `23%`); one `map-spot` per spot; note `a dot per place, about 25 km precise`; with `geo: false` → no `map-spot`, note `countries unavailable on this build`, the `unknown` row;
  - Chat: lines from the store, newest at the bottom (inverted list), `N here` in the header; no element with role `button` inside a line; `Write in Chat ›` → `router.dismissTo('/chat')`; when shown with lines newer than `lastSeen`, `markSeen` runs; scrolling to the end calls `loadOlder`.
- [ ] **Step 2:** FAIL → implement (chat: inverted `FlatList` of `ChatLineRow readOnly` like `ChatPane`, `onJump` scrolls to the line, `useFocusEffect` → `markSeen`, `onEndReached` → `loadOlder`).
- [ ] **Step 3:** PASS; simulator: open `world.gno.app://home/here` and `…/home/chat`, screenshot both.
- [ ] **Step 4:** `git commit -s -m "feat(home): Here Now and Chat full screen"`

### Task 8: The cards open their views

**Files:**
- Modify: `src/screens/home/price-card.tsx`, `here-card.tsx`, `chat-card.tsx`, `index.tsx`, `cards.test.tsx`, `index.test.tsx`

**Interfaces:**
- Consumes: routes `/home/price`, `/home/here`, `/home/chat`.
- Produces: `PriceCard` and `HereCard` gain `onOpen(): void`; each shows a `›` in its header that is a button (`accessibilityLabel` `Open GNOT full screen` / `Open Here Now full screen`); a tap anywhere else on the card also opens (outer `Pressable` with `accessible={false}`, so the period buttons and rows stay reachable by screen readers).

- [ ] **Step 1: Failing tests:**
  - price card: press on the price text → `onOpen`; press on `7 days` → `onDays(7)` and not `onOpen`; the `›` button → `onOpen`;
  - here card: press on a row → `onOpen`; `›` → `onOpen`;
  - chat card: press → `router.navigate('/home/chat')`; hint `Opens the chat to read`;
  - Home: pressing the price card's `›` with 30 days selected → `router.push({ pathname: '/home/price', params: { days: '30' } })`; Here's `›` → `router.push('/home/here')`.
- [ ] **Step 2:** FAIL → implement → `npx jest` (whole suite) PASS, `npx tsc --noEmit`, `npx expo lint` clean.
- [ ] **Step 3:** Simulator end to end: tap each card, check the view, swipe down closes (and does not while the crosshair is held), ✕ closes, `Write in Chat ›` lands on the Chat tab, Home's polling resumes after closing. Android if the emulator answers.
- [ ] **Step 4:** `git commit -s -m "feat(home): tap a card to open it full screen"`
