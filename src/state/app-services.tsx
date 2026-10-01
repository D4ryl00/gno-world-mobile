import AsyncStorage from '@react-native-async-storage/async-storage';
import { useGnoNativeContext } from '@gnolang/gnonative';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';
import { useStore } from 'zustand';

import type { ChainApi } from '@/chain/api';
import { GameClient } from '@/chain/game-client';
import { browserId, createOffchain, type Offchain } from '@/offchain/http';
import { presenceStore, sendPresence } from '@/offchain/presence';
import { createSessionStore, type SessionState } from '@/session/store';
import { settingsStore, useSettings } from '@/state/settings';
import { randomHex } from '@/utils/random';
import { secureStore } from '@/utils/secure';

type SessionStore = ReturnType<typeof createSessionStore>; // StoreApi<SessionState> plus the persist API

interface Services {
  api: ChainApi;
  game: GameClient;
  offchain: Offchain;
  session: SessionStore;
}

const Ctx = createContext<Services | null>(null);

export function AppServices({ children }: PropsWithChildren) {
  const { gnonative } = useGnoNativeContext();
  const api: ChainApi = gnonative; // GnoNativeApi satisfies ChainApi (guarded by _Check in src/chain/api.ts)
  const chainId = useSettings((s) => s.chainId);
  const remote = useSettings((s) => s.remote);

  const services = useMemo<Services>(() => {
    const offchain = createOffchain({
      baseUrl: () => settingsStore.getState().offchainUrl,
      bid: () => browserId(secureStore, randomHex),
    });
    const session = createSessionStore({
      api: () => api,
      secrets: secureStore,
      storage: AsyncStorage,
      openURL: (url) => Linking.openURL(url).then(() => undefined),
      randomHex,
      now: () => Date.now(),
      network: () => {
        const s = settingsStore.getState();
        return { chainId: s.chainId, remote: s.remote };
      },
    });
    return { api, game: new GameClient(api, () => settingsStore.getState().chainId), offchain, session };
  }, [api]);

  // keep gnonative on the configured network
  useEffect(() => {
    void api.setRemote(remote).catch(() => undefined);
    void api.setChainID(chainId).catch(() => undefined);
  }, [api, chainId, remote]);

  // resume a pending session request / re-unlock the active key on launch
  useEffect(() => {
    const s = services.session;
    const go = () => void s.getState().restore().catch(() => undefined);
    if (s.persist.hasHydrated()) go();
    else return s.persist.onFinishHydration(go);
  }, [services]);

  // presence heartbeat: every 20 s while in the foreground
  const pid = useRef(randomHex(8)).current;
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
    const start = () => {
      void beat();
      timer = setInterval(beat, 20000);
    };
    const stop = () => timer && clearInterval(timer);
    start();
    const sub = AppState.addEventListener('change', (st) => (st === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [services, pid]);

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
