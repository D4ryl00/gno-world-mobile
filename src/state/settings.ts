import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import { createStore } from 'zustand/vanilla';

import { isAddress } from '@/utils/address';
import { isFlag } from '@/utils/flag';

export interface Settings {
  chainId: string;
  remote: string;
  offchainUrl: string;
  flag: string;
  ref: string;
}

export const DEFAULT_SETTINGS: Settings = {
  chainId: 'gnoland-1',
  remote: 'https://rpc.gno.land:443',
  offchainUrl: 'https://bubblerumble.net',
  flag: '',
  ref: '',
};

export const NETWORK_PRESETS = [
  { label: 'gno.land (mainnet)', chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' },
  { label: 'Local gnodev', chainId: 'dev', remote: 'http://127.0.0.1:26657' },
];

const HTTP_URL = /^https?:\/\/[^\s/]+(\/[^\s]*)?$/;

export const validateRemote = (url: string) =>
  HTTP_URL.test(url.trim()) ? null : 'must be an http:// or https:// URL, e.g. https://rpc.gno.land:443';

export const validateOffchainUrl = (url: string) =>
  HTTP_URL.test(url.trim()) ? null : 'must be an http:// or https:// URL, e.g. https://bubblerumble.net';

export interface SettingsState extends Settings {
  setNetwork(chainId: string, remote: string): void;
  setOffchainUrl(url: string): void;
  setFlag(cc: string): void;
  setRefOnce(addr: string, self?: string): void;
}

/** onSettled runs once the initial rehydrate is over, whether it succeeded or failed (the store then holds the defaults). */
export const createSettingsStore = (storage: StateStorage, onSettled?: () => void) =>
  createStore<SettingsState>()(
    persist(
      (set, get) => ({
        ...DEFAULT_SETTINGS,
        setNetwork: (chainId, remote) => set({ chainId: chainId.trim(), remote: remote.trim() }),
        setOffchainUrl: (url) => set({ offchainUrl: url.trim().replace(/\/+$/, '') }),
        setFlag: (cc) => {
          const up = cc.trim().toUpperCase();
          if (up === '' || isFlag(up)) set({ flag: up });
        },
        setRefOnce: (addr, self) => {
          if (!get().ref && isAddress(addr) && addr !== self) set({ ref: addr });
        },
      }),
      {
        name: 'br.settings',
        storage: createJSONStorage(() => storage),
        onRehydrateStorage: () => () => onSettled?.(),
      },
    ),
  );

let settled = false;
const settledListeners = new Set<() => void>();

/** Ready once the first rehydrate has settled, even if it failed (zustand's hasHydrated stays false then). */
export const settingsReady = {
  hasHydrated: () => settled,
  onFinishHydration: (fn: () => void) => {
    settledListeners.add(fn);
    return () => void settledListeners.delete(fn);
  },
};

export const settingsStore = createSettingsStore(AsyncStorage, () => {
  settled = true;
  settledListeners.forEach((fn) => fn());
});

/** Calls onDone once hydration is finished, including when it finished before we subscribed. Returns the unsubscribe. */
export function watchHydration(
  p: { hasHydrated(): boolean; onFinishHydration(fn: () => void): () => void },
  onDone: () => void,
): () => void {
  const unsubscribe = p.onFinishHydration(onDone);
  if (p.hasHydrated()) onDone();
  return unsubscribe;
}

export function useSettings<T>(selector: (s: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}

export function useSettingsHydrated(): boolean {
  const [done, setDone] = useState(settingsReady.hasHydrated());
  useEffect(() => watchHydration(settingsReady, () => setDone(true)), []);
  return done;
}
