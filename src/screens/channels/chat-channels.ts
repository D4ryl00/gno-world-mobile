import { createStore, type StoreApi } from 'zustand/vanilla';

import type { KV } from '@/offchain/chat/store';
import type { ListedRoom } from '@/offchain/rooms/client';
import { ROOM_ID, type Book } from '@/offchain/sync/rooms';

import type { Channel } from './channel-tabs';

export const CURRENT_KEY = 'br.chat.current';

/**
 * The Chat tab's row: Public, the rooms joined (the book's order, the browser's), then the listed rooms not joined.
 * Unread counts for Public and joined rooms only: a listed room has no mark to count from.
 */
export function chatRow(book: Book, listed: ListedRoom[] | null, unreadOf: (id: string) => number): { channels: Channel[]; separatorAfter?: number } {
  const joined = new Set(book.rooms.map((r) => r.id));
  const others = (listed ?? []).filter((r) => !joined.has(r.id));
  const channels: Channel[] = [
    { id: '', name: 'Public', unread: unreadOf('') },
    ...book.rooms.map((r) => ({ id: r.id, name: r.name, keyed: !!r.key, unread: unreadOf(r.id) })),
    ...others.map((r) => ({ id: r.id, name: r.name })),
  ];
  return { channels, separatorAfter: others.length ? book.rooms.length : undefined };
}

export interface ChatChannelState {
  current: string;
  select(id: string): void;
  /** the current server's */
  reload(): Promise<void>;
}

/** The Chat tab's channel, its own (Home has its own), kept per server. */
export function createChatChannel(d: { kv: KV; scope: () => string }): StoreApi<ChatChannelState> & { ready: Promise<void> } {
  const key = () => `${CURRENT_KEY}:${d.scope()}`;
  let epoch = 0;
  const store = createStore<ChatChannelState>()((set) => ({
    current: '',
    select: (id) => {
      epoch++; // picked now: a saved channel still being read does not replace it
      set({ current: id });
      void d.kv.setItem(key(), id).catch(() => undefined);
    },
    reload: async () => {
      const e = ++epoch;
      set({ current: '' });
      const v = await d.kv.getItem(key()).catch(() => null);
      if (e === epoch && v && ROOM_ID.test(v)) set({ current: v });
    },
  }));
  const ready = store.getState().reload();
  return Object.assign(store, { ready });
}
