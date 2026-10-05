import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGnoNativeContext } from '@gnolang/gnonative';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useStore, type StoreApi } from 'zustand';

import type { ChainApi } from '@/chain/api';
import { GameClient } from '@/chain/game-client';
import { createChatClient, type ChatClient } from '@/offchain/chat/client';
import { createIdentityStore } from '@/offchain/chat/identity';
import { createChatStore, type ChatState } from '@/offchain/chat/store';
import { browserId, createOffchain, type Offchain } from '@/offchain/http';
import { presenceStore, sendPresence } from '@/offchain/presence';
import { createSessionStore, type SessionState } from '@/session/store';
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
  chatClient: ChatClient;
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
    const identity = createIdentityStore(secureStore);
    const chatClient = createChatClient(offchain, () => identity.load());
    const chat = createChatStore({
      client: chatClient, identity, kv: AsyncStorage, scope: () => settingsStore.getState().offchainUrl,
    });
    const session = createSessionStore({
      api: () => api,
      secrets: secureStore,
      storage: AsyncStorage,
      openURL: (url) => Linking.openURL(url).then(() => undefined),
      randomHex,
      now: Date.now,
      network: () => net.current(),
    });
    return { api, game: new GameClient(api, () => net.current().chainId), offchain, session, net, chat, chatClient };
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
        const r = await sendPresence(services.offchain, pid);
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

  // chat long poll: while in the foreground, from scratch when the server changes
  useEffect(() => {
    const chat = services.chat.getState;
    if (AppState.currentState === 'active') chat().start();
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? chat().start() : chat().stop()));
    const unsub = settingsStore.subscribe((now, before) => {
      if (now.offchainUrl !== before.offchainUrl) chat().restart();
    });
    return () => {
      sub.remove();
      unsub();
      chat().stop();
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
