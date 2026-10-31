import { createStore, type StoreApi } from 'zustand/vanilla';

import type { KV } from '@/offchain/chat/store';
import { ROOM_ID } from '@/offchain/sync/rooms';

export const HOME_KEY = 'br.home.channels';
export const PUBLIC_TAB = { id: '', name: 'Public' };

export interface HomeChannelsState {
  /** tabs[0] is always Public */
  tabs: { id: string; name: string }[];
  current: string;
  /** appended and made current; a tab already there is only made current */
  add(c: { id: string; name: string }): void;
  /** not Public; the current one gone, Public is current */
  remove(id: string): void;
  select(id: string): void;
  /** drops the tabs not in `valid`; null (the listing not read) drops nothing */
  prune(valid: Set<string> | null): void;
  /** the record of the current server */
  reload(): Promise<void>;
}

const DEFAULT = { tabs: [PUBLIC_TAB], current: '' };

/** What Home's chat card shows: Public, and the rooms picked in its full screen. Kept per server. */
export function createHomeChannels(d: { kv: KV; scope: () => string }): StoreApi<HomeChannelsState> & { ready: Promise<void> } {
  const key = () => `${HOME_KEY}:${d.scope()}`;
  // bumped by reload(): a record read before is another server's
  let epoch = 0;
  const read = async () => {
    try {
      const v = JSON.parse((await d.kv.getItem(key())) ?? 'null') as { tabs?: unknown; current?: unknown } | null;
      const rooms = (Array.isArray(v?.tabs) ? v.tabs : [])
        .filter((t): t is { id: string; name: string } => !!t && ROOM_ID.test(t.id) && typeof t.name === 'string')
        .map((t) => ({ id: t.id, name: t.name }));
      const tabs = [PUBLIC_TAB, ...rooms];
      return { tabs, current: tabs.some((t) => t.id === v?.current) ? (v!.current as string) : '' };
    } catch {
      return DEFAULT;
    }
  };
  const store = createStore<HomeChannelsState>()((set, get) => {
    const save = (p: Pick<HomeChannelsState, 'tabs' | 'current'>) => {
      set(p);
      void d.kv.setItem(key(), JSON.stringify(p)).catch(() => undefined);
    };
    const without = (ids: (id: string) => boolean) => {
      const tabs = get().tabs.filter((t) => !t.id || !ids(t.id));
      if (tabs.length === get().tabs.length) return;
      save({ tabs, current: tabs.some((t) => t.id === get().current) ? get().current : '' });
    };
    return {
      ...DEFAULT,
      add: (c) => {
        const tabs = get().tabs.some((t) => t.id === c.id) ? get().tabs : [...get().tabs, { id: c.id, name: c.name }];
        save({ tabs, current: c.id });
      },
      remove: (id) => without((t) => t === id),
      select: (id) => {
        if (get().tabs.some((t) => t.id === id) && id !== get().current) save({ tabs: get().tabs, current: id });
      },
      prune: (valid) => {
        if (valid) without((t) => !valid.has(t));
      },
      reload: async () => {
        const e = ++epoch;
        set(DEFAULT);
        const v = await read();
        if (e === epoch) set(v);
      },
    };
  });
  const ready = store.getState().reload();
  return Object.assign(store, { ready });
}
