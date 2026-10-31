import type { StoreApi } from 'zustand/vanilla';

import { createChatClient } from '@/offchain/chat/client';
import { createIdentityStore } from '@/offchain/chat/identity';
import { createIdentityState, type IdentityDeps } from '@/offchain/chat/identity-store';
import { createChatStore, type KV } from '@/offchain/chat/store';
import type { Offchain } from '@/offchain/http';
import { createRoomsClient } from '@/offchain/rooms/client';
import { createRoomsStore, type RoomsState } from '@/offchain/rooms/store';
import { createSyncClient } from '@/offchain/sync/client';
import type { CryptoBackend } from '@/offchain/sync/crypto';
import { createBookStore } from '@/offchain/sync/rooms';
import { createSyncStore } from '@/offchain/sync/store';
import type { SecretStore } from '@/session/keys';

export interface ChatServicesDeps {
  offchain: Offchain;
  secrets: SecretStore;
  kv: KV;
  crypto: CryptoBackend;
  /** the off-chain server: names, books and marks are kept per server */
  scope: () => string;
  wallet?: IdentityDeps['wallet'];
  /** the rooms' waits (tests shorten them) */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

/**
 * The chat's stores, wired together: the identity, Public, the /pair sync and the rooms registry. The app and the e2e
 * tests build them the same way.
 */
export function createChatServices(d: ChatServicesDeps) {
  const identity = createIdentityStore(d.secrets, d.scope);
  const chatClient = createChatClient(d.offchain, () => identity.load());
  const identityState = createIdentityState({ client: chatClient, identity, kv: d.kv, scope: d.scope, wallet: d.wallet });
  const current = () => identityState.getState().identity;
  // made below: Public hands it its invitations
  let rooms: StoreApi<RoomsState> | null = null;
  const chat = createChatStore({
    client: chatClient, identity: current, kv: d.kv, scope: d.scope, onInvites: (dm) => rooms?.getState().onInvites(dm),
  });
  const book = createBookStore({ kv: d.kv, secrets: d.secrets, crypto: d.crypto, scope: d.scope });
  // /pair: the rooms book and the reserved name shared with gno.world in a browser
  const sync = createSyncStore({
    client: createSyncClient(d.offchain), crypto: d.crypto, secrets: d.secrets, book, identity, scope: d.scope,
    identityChanged: () => void identityState.getState().reloadIdentity(),
  });
  const registry = createRoomsStore({
    client: createRoomsClient(d.offchain, () => identity.load()), book, publicStore: chat, kv: d.kv, scope: d.scope,
    syncChanged: () => sync.getState().changed(),
    makeRoomStore: (id, onPosted) =>
      createChatStore({
        client: createChatClient(d.offchain, () => identity.load(), { room: id, key: () => registry.getState().keyOf(id) }),
        identity: current, kv: d.kv, scope: d.scope, room: id, onPosted, sleep: d.sleep,
      }),
  });
  rooms = registry;
  // a book /pair changed: rooms joined or left on another device
  sync.subscribe((now, before) => {
    if (now.rooms !== before.rooms) void registry.getState().reloadBook();
  });
  return { identity, identityState, chatClient, chat, sync, rooms: registry };
}
