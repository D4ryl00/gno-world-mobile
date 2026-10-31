import { createStore, type StoreApi } from 'zustand/vanilla';

import { isMine, unreadCount } from '@/offchain/chat/merge';
import { seenKeyFor, type ChatState, type KV } from '@/offchain/chat/store';
import type { RoomInvite } from '@/offchain/chat/types';
import { OffchainError } from '@/offchain/http';
import { EMPTY_BOOK, forgetRoom, rememberRoom, type Book, type BookStore } from '@/offchain/sync/rooms';

import type { ListedRoom, RoomInfo, RoomsClient } from './client';
import { parseRoomLink } from './link';

type ChatStore = StoreApi<ChatState> & { ready: Promise<void> };

export const NOT_A_LINK = 'that is not a room link';
export const NO_ANSWER = 'the box did not answer about that room — try again in a moment';
/** the site's words for a room that is not there (GET /api/room 404) */
export const NO_SUCH_ROOM = 'no such room — the link may be wrong, or the room was quiet for a month and is gone';
const NOT_THE_MAKER = 'only the room\'s maker can do that';
export const NOT_JOINED = 'that room is not in your list — a line written there joins it';
/** room stores kept in memory besides Public */
export const MAX_STORES = 8;
export const SCAN_EVERY = 120_000;
export const POKE_GAP = 10_000;
const INVITE_FRESH = 3_600_000;

export interface RoomsState {
  book: Book;
  /** the book of this server has been read */
  bookRead: boolean;
  /** the rooms listed on the server; null until read on this server */
  listed: ListedRoom[] | null;
  /** the last listing failed (the previous one is kept) */
  listedError: boolean;
  /** what scans counted, for rooms not on screen */
  unread: Record<string, number>;
  /** room id → who invited, until the room is opened */
  invited: Record<string, string>;
  /** the last fresh invitation, until dismissed or opened */
  banner: { id: string; name: string; from: string } | null;
  /** a room found gone by its own poll: its name, to say so once */
  goneSaid: string | null;
  /** rooms the last scan found gone: nothing is forgotten or hidden for it (one 404 may be a hiccup; the room's own
   * poll decides, after three) */
  gone: Record<string, true>;
  /** the room long-polling beside Public; '' none */
  focused: string;
  /** room stores dropped so far: a screen holding one asks room() again when this changes */
  dropped: number;
  /** a room's store ('' is Public's), made on demand; never drops one (screens call it while rendering) */
  room(id: string): ChatStore;
  /** the maker's key the book holds for a room; '' none */
  keyOf(id: string): string;
  unreadOf(id: string): number;
  /** a screen shows this room: it long-polls (the previous room stops), and stores past 8 go; pairs with blur */
  focus(id: string): void;
  /** that screen lets go; the room stops once no screen shows it */
  blur(id: string): void;
  /** the room is picked: its invitation and unread count go (the screen showing it focuses it) */
  open(id: string): void;
  join(text: string): Promise<{ id: string } | { error: string }>;
  make(name: string, listed: boolean): Promise<{ id: string } | { error: string }>;
  leave(id: string): Promise<void>;
  /** the words to show */
  rename(id: string, name: string): Promise<string>;
  /** '' done, else the error */
  setListed(id: string, on: boolean): Promise<string>;
  /** '' done, else the error */
  drop(id: string): Promise<string>;
  /** the words to show */
  invite(id: string, to: string, tag: string): Promise<string>;
  onInvites(dm: RoomInvite[]): void;
  scanAll(): Promise<void>;
  /** what the server says of a room now (listed or not); null when it did not answer */
  roomInfo(id: string): Promise<RoomInfo | 'gone' | null>;
  refreshListed(): Promise<void>;
  /** the listing and the scan now, unless they ran in the last 10 s */
  poke(): void;
  resume(): void;
  pause(): void;
  restart(): void;
  reloadBook(): Promise<void>;
  dismissBanner(): void;
  dismissGone(): void;
}

export interface RoomsDeps {
  client: RoomsClient;
  book: BookStore;
  publicStore: ChatStore;
  /** a room's chat store; `onPosted` when a line of this app's went out there */
  makeRoomStore(id: string, onPosted: () => void): ChatStore;
  /** the book changed here: /pair pushes it */
  syncChanged(): void;
  /** where the room stores keep their seen marks: scans read the ones of rooms without a store */
  kv: KV;
  scope: () => string;
  now?: () => number;
  setInterval?: typeof setInterval;
  clearInterval?: typeof clearInterval;
}

const say = (e: unknown) =>
  e instanceof OffchainError
    ? e.status !== 0 ? e.message : 'The chat server did not answer — try again.'
    : e instanceof Error ? e.message : 'The chat server did not answer — try again.';

/** A stored seen mark ("<gen>:<id>" or a plain id). */
const parseMark = (raw: string | null) => {
  const m = raw ? /^(?:\d+:)?(\d+)$/.exec(raw) : null;
  return m ? Number(m[1]) : 0;
};

const INITIAL = {
  book: EMPTY_BOOK, bookRead: false, listed: null, listedError: false, unread: {}, invited: {}, banner: null, goneSaid: null, gone: {}, focused: '', dropped: 0,
};

export function createRoomsStore(d: RoomsDeps): StoreApi<RoomsState> {
  const now = d.now ?? Date.now;
  const every = d.setInterval ?? setInterval;
  const stopEvery = d.clearInterval ?? clearInterval;
  // insertion order is recency: the first is the least recently opened
  const stores = new Map<string, { store: ChatStore; unsub: () => void }>();
  const seenInvites = new Set<string>();
  // screens showing each room (focus/blur pairs): a screen mounting over another claims before the other lets go
  const claims = new Map<string, number>();
  let active = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let lastPoke = -Infinity;
  // bumped by restart(): an answer to a request made before is about another server
  let epoch = 0;
  // rooms made here whose book write failed: kept in memory, and written with the book's next change
  const unsaved = new Map<string, { id: string; name: string; key: string }>();
  const withUnsaved = (b: Book) =>
    [...unsaved.values()].reduce((acc, r) => (acc.rooms.some((x) => x.id === r.id) ? acc : rememberRoom(acc, r, now())), b);

  return createStore<RoomsState>()((set, get) => {
    const drop = (id: string) => {
      const s = stores.get(id);
      if (!s) return;
      s.unsub();
      s.store.getState().stop();
      stores.delete(id);
      set((st) => ({ dropped: st.dropped + 1, focused: st.focused === id ? '' : st.focused }));
    };

    /** the book's own update: a /pair pull changing it meanwhile is merged, not overwritten; nothing changed, no push */
    const changeBook = (f: (b: Book) => Book) => {
      const e = epoch;
      const keep = [...unsaved.keys()];
      let changed = false;
      return d.book.update((b0) => {
        const b = withUnsaved(b0);
        const b1 = f(b);
        changed = b1 !== b0;
        return b1;
      }).then((b) => {
        for (const id of keep) unsaved.delete(id);
        if (e !== epoch || !changed) return;
        set({ book: b });
        d.syncChanged();
      });
    };
    const remember = (r: { id: string; name: string; key?: string }) => changeBook((b) => rememberRoom(b, r, now()));
    const forget = (id: string) => changeBook((b) => forgetRoom(b, id, now()));
    const joined = (id: string) => get().book.rooms.some((r) => r.id === id);

    const nameOf = (id: string) =>
      get().book.rooms.find((r) => r.id === id)?.name || get().listed?.find((r) => r.id === id)?.name
      || stores.get(id)?.store.getState().roomName || 'private room';

    const onGone = (id: string) => {
      const name = nameOf(id);
      drop(id);
      set((s) => ({ goneSaid: name, gone: { ...s.gone, [id]: true } }));
      void forget(id);
    };

    const room = (id: string): ChatStore => {
      if (!id) return d.publicStore;
      const had = stores.get(id);
      if (had) {
        stores.delete(id);
        stores.set(id, had);
        return had.store;
      }
      // the first line written in a room not joined joins it, as the site does
      const store = d.makeRoomStore(id, () => {
        if (!get().book.rooms.some((r) => r.id === id)) void remember({ id, name: nameOf(id) });
      });
      const unsub = store.subscribe((s, before) => {
        if (s.gone && !before.gone) onGone(id);
      });
      stores.set(id, { store, unsub });
      return store;
    };

    /** past 8 stores, the least recently opened go: never the focused one */
    const evict = () => {
      for (const old of [...stores.keys()]) {
        if (stores.size <= MAX_STORES) break;
        if (old !== get().focused) drop(old);
      }
    };

    /** the room goes off screen: its loop stops, and what was read there stays read (the scan's count was older) */
    const leave = (id: string) => {
      const s = stores.get(id)?.store.getState();
      if (!s) return;
      s.stop();
      set((st) => ({ unread: { ...st.unread, [id]: unreadCount(s, s.lastSeen, s.mine) } }));
    };

    const tick = () => {
      lastPoke = now();
      void get().refreshListed();
      void get().scanAll();
    };

    const fail = (e: unknown) => ({ error: say(e) });

    return {
      ...INITIAL,
      room,
      keyOf: (id) => get().book.rooms.find((r) => r.id === id)?.key ?? '',
      unreadOf: (id) => {
        const s = stores.get(id)?.store.getState();
        return id === get().focused && s ? unreadCount(s, s.lastSeen, s.mine) : get().unread[id] ?? 0;
      },
      focus: (id) => {
        claims.set(id, (claims.get(id) ?? 0) + 1);
        const was = get().focused;
        if (was && was !== id) leave(was);
        set({ focused: id });
        if (!id) return;
        const store = room(id);
        evict();
        if (active) store.getState().start();
      },
      blur: (id) => {
        const n = (claims.get(id) ?? 0) - 1;
        if (n > 0) claims.set(id, n);
        else claims.delete(id);
        // another screen still shows it (a full screen opened over the card): it keeps polling
        if (!id || n > 0 || get().focused !== id) return;
        leave(id);
        set({ focused: '' });
      },
      open: (id) => {
        set((s) => {
          const { [id]: _i, ...invited } = s.invited;
          return { invited, unread: { ...s.unread, [id]: 0 }, banner: s.banner?.id === id ? null : s.banner };
        });
      },
      join: async (text) => {
        const id = parseRoomLink(text);
        if (!id) return { error: NOT_A_LINK };
        const e = epoch;
        try {
          const info = await d.client.info(id);
          if (e !== epoch) return { error: NO_ANSWER };
          if (info === 'gone') {
            await forget(id);
            return { error: NO_SUCH_ROOM };
          }
          // joined already: the book stays as it is (its order is the browser's)
          await changeBook((b) => (b.rooms.some((r) => r.id === id) ? b : rememberRoom(b, { id, name: info.name }, now())));
          return { id };
        } catch {
          return { error: NO_ANSWER };
        }
      },
      make: async (name, listed) => {
        const e = epoch;
        try {
          const r = await d.client.make(name, listed);
          if (e !== epoch) return { error: NO_ANSWER };
          await remember(r).catch(() => {
            // the room is made: its key stays here, and goes into the book with its next change
            unsaved.set(r.id, r);
            set((s) => ({ book: rememberRoom(s.book, r, now()) }));
          });
          return { id: r.id };
        } catch (err) {
          return fail(err);
        }
      },
      leave: async (id) => {
        drop(id);
        if (joined(id)) await forget(id);
      },
      rename: async (id, name) => {
        const key = get().keyOf(id);
        if (!key) {
          if (!joined(id)) return NOT_JOINED;
          await remember({ id, name });
          return `renamed to "${name}" for you (the room's maker or the owner renames it for everyone)`;
        }
        try {
          const r = await d.client.setRoom(id, key, { name });
          await remember({ id, name: r.name || name });
          return `renamed to "${r.name || name}"`;
        } catch (err) {
          return say(err);
        }
      },
      setListed: async (id, on) => {
        const key = get().keyOf(id);
        if (!key) return NOT_THE_MAKER;
        try {
          await d.client.setRoom(id, key, { listed: on });
          return '';
        } catch (err) {
          return say(err);
        }
      },
      drop: async (id) => {
        const key = get().keyOf(id);
        if (!key) return NOT_THE_MAKER;
        try {
          await d.client.dropRoom(id, key);
          await get().leave(id);
          return '';
        } catch (err) {
          return say(err);
        }
      },
      invite: async (id, to, tag) => {
        const key = get().keyOf(id);
        if (!key) return NOT_THE_MAKER;
        try {
          const r = await d.client.invite(id, key, to, tag);
          return `${r.to} gets "${nameOf(id)}" on their next poll`;
        } catch (err) {
          return say(err);
        }
      },
      onInvites: (dm) => {
        for (const inv of dm) {
          const seen = `${inv.room}:${inv.at}`;
          if (seenInvites.has(seen)) continue;
          seenInvites.add(seen);
          const { book } = get();
          // left after being invited: the invitation is old news
          if ((book.left[inv.room] ?? 0) >= inv.at * 1000) continue;
          if (!book.rooms.some((r) => r.id === inv.room)) void remember({ id: inv.room, name: inv.name });
          if (now() - inv.at * 1000 < INVITE_FRESH) {
            set((s) => ({ invited: { ...s.invited, [inv.room]: inv.from }, banner: { id: inv.room, name: inv.name, from: inv.from } }));
          }
        }
      },
      scanAll: async () => {
        const e = epoch;
        for (const { id } of get().book.rooms) {
          if (e !== epoch) return;
          if (id === get().focused) continue;
          const s = stores.get(id)?.store.getState();
          const key = seenKeyFor(d.scope(), id);
          const mark = s?.lastSeen || parseMark(await d.kv.getItem(key).catch(() => null));
          try {
            const r = await d.client.scan(id, mark);
            if (e !== epoch) return;
            if (!mark) {
              // never read here: what is there now is not unread
              const next = Math.max(r.next ?? 0, ...r.msgs.map((l) => l.id));
              if (next) void d.kv.setItem(key, r.gen === null ? String(next) : `${r.gen}:${next}`).catch(() => undefined);
              set((st) => {
                const { [id]: _g, ...gone } = st.gone;
                return { unread: { ...st.unread, [id]: 0 }, gone };
              });
              continue;
            }
            const n = r.msgs.filter((l) => l.id > mark && !isMine(l, r.you, s?.mine ?? [])).length;
            set((st) => {
              const { [id]: _g, ...gone } = st.gone; // reached again: an earlier 404 was a hiccup
              return { unread: { ...st.unread, [id]: n }, gone };
            });
          } catch (err) {
            if (e !== epoch) return;
            if (err instanceof OffchainError && err.status === 404) set((st) => ({ gone: { ...st.gone, [id]: true } }));
            // otherwise the count stays: a scan never shows an error
          }
        }
      },
      roomInfo: (id) => d.client.info(id).catch(() => null),
      refreshListed: async () => {
        const e = epoch;
        try {
          const listed = await d.client.listPublic();
          if (e === epoch) set({ listed, listedError: false });
        } catch {
          if (e === epoch) set({ listedError: true });
        }
      },
      poke: () => {
        if (now() - lastPoke < POKE_GAP) return;
        tick();
      },
      resume: () => {
        active = true;
        void get().reloadBook().then(() => get().poke());
        if (timer === null) timer = every(tick, SCAN_EVERY);
        const f = get().focused;
        if (f) room(f).getState().start();
      },
      pause: () => {
        active = false;
        if (timer !== null) stopEvery(timer);
        timer = null;
        const f = get().focused;
        if (f) stores.get(f)?.store.getState().stop();
      },
      restart: () => {
        const wasActive = active;
        get().pause();
        epoch++;
        for (const id of [...stores.keys()]) drop(id);
        unsaved.clear();
        seenInvites.clear();
        claims.clear();
        lastPoke = -Infinity;
        set({ ...INITIAL, dropped: get().dropped }); // only ever counts up: screens compare it
        if (wasActive) get().resume();
      },
      reloadBook: async () => {
        const e = epoch;
        const book = await d.book.load().catch(() => null);
        if (!book || e !== epoch) return;
        set({ book: withUnsaved(book), bookRead: true });
        // left on a paired device: its store closes here too
        for (const id of [...stores.keys()]) if (book.left[id] && !book.rooms.some((r) => r.id === id)) drop(id);
      },
      dismissBanner: () => set({ banner: null }),
      dismissGone: () => set({ goneSaid: null }),
    };
  });
}
