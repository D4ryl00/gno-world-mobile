import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import type { ListedRoom, RoomsClient } from '@/offchain/rooms/client';
import { createRoomsStore } from '@/offchain/rooms/store';
import { EMPTY_BOOK, type Book } from '@/offchain/sync/rooms';

import { createChatChannel } from './chat-channels';
import { createHomeChannels } from './home-channels';

/** Screen-test services: Public, a rooms registry over an in-memory book and a fake rooms client, Home's channels. */
export function screenServices(o: { book?: Book; listed?: ListedRoom[] | null; client?: Partial<RoomsClient> } = {}) {
  const kv = new Map<string, string>();
  const kvs = { getItem: async (k: string) => kv.get(k) ?? null, setItem: async (k: string, v: string) => void kv.set(k, v) };
  let held = o.book ?? EMPTY_BOOK;
  const scope = () => 'http://fake';
  // lines are set straight into the stores; typing is the one call a screen makes on its own
  const chatClient = { typing: async () => undefined } as never;
  const chat = createChatStore({ client: chatClient, identity: () => NO_IDENTITY, kv: kvs, scope });
  const client: RoomsClient = {
    make: async () => ({ id: '', name: '', key: '' }),
    info: async () => 'gone',
    listPublic: async () => o.listed ?? [],
    setRoom: async () => ({}),
    dropRoom: async () => undefined,
    invite: async (_id, _key, to) => ({ to }),
    scan: async () => {
      throw new Error('no scans in screen tests');
    },
    ...o.client,
  };
  const rooms = createRoomsStore({
    client, book: { load: async () => held, save: async (b) => void (held = b), update: async (f) => (held = f(held)) }, publicStore: chat, kv: kvs, scope,
    syncChanged: () => undefined,
    makeRoomStore: (room, onPosted) => createChatStore({ client: chatClient, identity: () => NO_IDENTITY, kv: kvs, scope, room, onPosted }),
  });
  rooms.setState({ book: held, bookRead: true, listed: o.listed === undefined ? [] : o.listed });
  const homeChannels = createHomeChannels({ kv: kvs, scope });
  const chatChannel = createChatChannel({ kv: kvs, scope });
  return {
    chat, rooms, homeChannels, chatChannel, client, kv, book: () => held,
    ready: Promise.all([chat.ready, homeChannels.ready, chatChannel.ready]),
  };
}
