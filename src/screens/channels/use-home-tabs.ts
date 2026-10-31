import { useEffect } from 'react';
import { useStore } from 'zustand';

import { unreadCount } from '@/offchain/chat/merge';
import { useHomeChannels, useRooms, useServices } from '@/state/app-services';

import type { Channel } from './channel-tabs';
import { useRoomOnScreen } from './use-room-on-screen';

/**
 * Home's channels as tabs, the current one's store (long-polling while the screen has the focus), and the tabs of
 * rooms no longer reachable pruned: gone (its own poll, three 404s), or neither joined nor listed once a listing came
 * in. One scan's 404 hides nothing.
 */
export function useHomeTabs() {
  const { rooms, homeChannels } = useServices();
  const tabs = useHomeChannels((s) => s.tabs);
  const current = useHomeChannels((s) => s.current);
  const book = useRooms((s) => s.book);
  const listed = useRooms((s) => s.listed);
  // a store dropped meanwhile (more rooms opened elsewhere than kept) is made again
  useRooms((s) => s.dropped);
  // a stable selector input: the store of the current channel
  const store = rooms.getState().room(current);
  const roomGone = useStore(store, (s) => s.gone);
  const publicUnread = useStore(rooms.getState().room(''), (s) => unreadCount(s, s.lastSeen, s.mine));
  useRoomOnScreen(current);

  useEffect(() => {
    const h = homeChannels.getState();
    if (current && roomGone) h.remove(current);
    if (listed) h.prune(new Set([...book.rooms.map((r) => r.id), ...listed.map((r) => r.id)]));
  }, [homeChannels, book, listed, current, roomGone]);

  // the name the room has now (renamed since it was added), else the one kept with the tab
  const nameOf = (id: string, kept: string) =>
    (id && (book.rooms.find((r) => r.id === id)?.name || listed?.find((r) => r.id === id)?.name)) || kept;
  const keyed = (id: string) => !!book.rooms.find((r) => r.id === id)?.key;
  const channels: Channel[] = tabs.map((t) => ({
    id: t.id, name: nameOf(t.id, t.name), keyed: keyed(t.id),
    unread: t.id ? rooms.getState().unreadOf(t.id) : publicUnread,
  }));
  const name = channels.find((c) => c.id === current)?.name ?? 'Public';
  return { channels, current, name, store, select: homeChannels.getState().select };
}
