import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGnoNativeContext } from '@gnolang/gnonative';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useStore, type StoreApi } from 'zustand';

import type { ChainApi } from '@/chain/api';
import { GameClient } from '@/chain/game-client';
import type { ChatClient } from '@/offchain/chat/client';
import { followAppState } from '@/offchain/chat/app-state';
import type { IdentityState } from '@/offchain/chat/identity-store';
import type { ChatState } from '@/offchain/chat/store';
import { browserId, createOffchain, type Offchain } from '@/offchain/http';
import { presenceStore, sendPresence } from '@/offchain/presence';
import type { RoomsState } from '@/offchain/rooms/store';
import { expoCrypto } from '@/offchain/sync/expo-crypto';
import type { SyncState } from '@/offchain/sync/store';
import { createSessionStore, type SessionState } from '@/session/store';
import { walletEnabled } from '@/session/wallet-build';
import { createChatChannel, type ChatChannelState } from '@/screens/channels/chat-channels';
import { createHomeChannels, type HomeChannelsState } from '@/screens/channels/home-channels';
import { createChatServices } from '@/state/chat-services';
import { createNetworkSync } from '@/state/network-sync';
import { settingsStore, watchHydration } from '@/state/settings';
import { randomHex } from '@/utils/random';
import { secureStore } from '@/utils/secure';

type SessionStore = ReturnType<typeof createSessionStore>; // StoreApi<SessionState>, the persist API and `ready`

interface Services {
  api: ChainApi;
  game: GameClient;
  offchain: Offchain;
  session: SessionStore;
  net: ReturnType<typeof createNetworkSync>;
  chat: StoreApi<ChatState> & { ready: Promise<void> };
  /** the name, reservation and picture the chat writes under */
  identity: StoreApi<IdentityState> & { ready: Promise<void> };
  chatClient: ChatClient;
  sync: StoreApi<SyncState>;
  /** the rooms: the book, the listed ones, a store per room */
  rooms: StoreApi<RoomsState>;
  /** the channels Home's chat card shows */
  homeChannels: StoreApi<HomeChannelsState> & { ready: Promise<void> };
  /** the channel the Chat tab shows */
  chatChannel: StoreApi<ChatChannelState> & { ready: Promise<void> };
}

const Ctx = createContext<Services | null>(null);

export function AppServices({ children }: PropsWithChildren) {
  const { gnonative } = useGnoNativeContext();
  const api: ChainApi = gnonative; // GnoNativeApi satisfies ChainApi (guarded by gnoNativeSatisfiesChainApi in src/chain/api.ts)

  const services = useMemo<Services>(() => {
    // The network gnonative is actually on. GnoNativeProvider starts on the settings' network; later
    // switches become current only once gnonative has applied them (see network-sync.ts).
    const { chainId, remote } = settingsStore.getState();
    const net = createNetworkSync({
      initial: { chainId, remote },
      pause: () => session.getState().pause(),
      apply: async (n) => {
        await api.setRemote(n.remote);
        await api.setChainID(n.chainId);
      },
      changed: async () => {
        // before hydration, the launch-time restore() picks up the current network itself
        if (session.ready.hasHydrated()) await session.getState().networkChanged();
      },
    });
    const offchain = createOffchain({
      baseUrl: () => settingsStore.getState().offchainUrl,
      bid: () => browserId(secureStore, randomHex),
    });
    const { identityState, chatClient, chat, sync, rooms } = createChatServices({
      offchain, secrets: secureStore, kv: AsyncStorage, crypto: expoCrypto, scope: () => settingsStore.getState().offchainUrl,
      // a name the server wants proven: the wallet signs the phrase (GnoConnect connect + challenge)
      wallet: walletEnabled ? { open: (url) => Linking.openURL(url).then(() => undefined), randomHex, network: () => net.current() } : undefined,
    });
    const homeChannels = createHomeChannels({ kv: AsyncStorage, scope: () => settingsStore.getState().offchainUrl });
    const chatChannel = createChatChannel({ kv: AsyncStorage, scope: () => settingsStore.getState().offchainUrl });
    const session = createSessionStore({
      api: () => api,
      secrets: secureStore,
      storage: AsyncStorage,
      openURL: (url) => Linking.openURL(url).then(() => undefined),
      randomHex,
      now: Date.now,
      network: () => net.current(),
      wallet: walletEnabled,
    });
    return { api, game: new GameClient(api, () => net.current().chainId), offchain, session, net, chat, identity: identityState, chatClient, sync, rooms, homeChannels, chatChannel };
  }, [api]);

  // follow network switches from Settings: gnonative first, then the session store
  useEffect(
    () =>
      settingsStore.subscribe((now, before) => {
        if (now.chainId !== before.chainId || now.remote !== before.remote)
          void services.net.set({ chainId: now.chainId, remote: now.remote });
      }),
    [services],
  );

  // resume a pending session request / re-unlock the active key on launch
  useEffect(() => {
    let done = false;
    // `ready`, not `persist`: it settles even when the storage could not be read
    return watchHydration(services.session.ready, () => {
      if (done) return;
      done = true;
      void services.session.getState().restore().catch(() => undefined);
    });
  }, [services]);

  // presence heartbeat: every 20 s while in the foreground
  const [pid] = useState(() => randomHex(8));
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const beat = async () => {
      try {
        const r = await sendPresence(services.offchain, pid, services.sync.getState().group);
        presenceStore.getState().update({ country: r.you, count: r.count, reachable: true });
      } catch {
        presenceStore.getState().update({ reachable: false }); // play stays open
      }
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop(); // never two intervals (e.g. 'active' reported twice)
      void beat();
      timer = setInterval(beat, 20000);
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [services, pid]);

  // chat long poll and rooms (the room on screen, scans): while in the foreground (resumed from its cursor), from
  // scratch when the server changes
  useEffect(() => {
    const chat = services.chat.getState;
    const rooms = services.rooms.getState;
    const lifecycle = {
      start: () => {
        chat().start();
        rooms().resume();
      },
      stop: () => {
        chat().stop();
        rooms().pause();
      },
    };
    if (AppState.currentState === 'active') lifecycle.start();
    const sub = AppState.addEventListener('change', (st) => followAppState(st, lifecycle));
    const unsub = settingsStore.subscribe((now, before) => {
      if (now.offchainUrl !== before.offchainUrl) {
        services.identity.getState().restart();
        chat().restart();
        rooms().restart();
        void services.homeChannels.getState().reload();
        void services.chatChannel.getState().reload();
      }
    });
    return () => {
      sub.remove();
      unsub();
      lifecycle.stop();
    };
  }, [services]);

  // /pair sync: in the foreground ("inactive" keeps it, as the chat), from scratch when the server changes; a name
  // reserved, proven or released here goes out to the paired devices
  useEffect(() => {
    const sync = services.sync.getState;
    const lifecycle = { start: () => sync().resume(), stop: () => sync().pause() };
    if (AppState.currentState === 'active') sync().resume();
    const sub = AppState.addEventListener('change', (st) => followAppState(st, lifecycle));
    const unsubUrl = settingsStore.subscribe((now, before) => {
      if (now.offchainUrl !== before.offchainUrl) sync().restart();
    });
    const unsubName = services.identity.subscribe((now, before) => {
      if (now.identity.reservedName !== before.identity.reservedName || now.identity.nameKey !== before.identity.nameKey) sync().changed();
    });
    return () => {
      sub.remove();
      unsubUrl();
      unsubName();
      sync().pause();
    };
  }, [services]);

  return <Ctx.Provider value={services}>{children}</Ctx.Provider>;
}

export function useServices(): Services {
  const s = useContext(Ctx);
  if (!s) throw new Error('useServices outside AppServices');
  return s;
}

export function useSession<T>(sel: (s: SessionState) => T): T {
  return useStore(useServices().session, sel);
}

export function useChat<T>(sel: (s: ChatState) => T): T {
  return useStore(useServices().chat, sel);
}

export function useIdentity<T>(sel: (s: IdentityState) => T): T {
  return useStore(useServices().identity, sel);
}

export function useRooms<T>(sel: (s: RoomsState) => T): T {
  return useStore(useServices().rooms, sel);
}

export function useHomeChannels<T>(sel: (s: HomeChannelsState) => T): T {
  return useStore(useServices().homeChannels, sel);
}

export function useChatChannel<T>(sel: (s: ChatChannelState) => T): T {
  return useStore(useServices().chatChannel, sel);
}

export function useSync<T>(sel: (s: SyncState) => T): T {
  return useStore(useServices().sync, sel);
}
