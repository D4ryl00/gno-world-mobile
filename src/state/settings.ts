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

export const createSettingsStore = (storage: StateStorage) =>
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
      { name: 'br.settings', storage: createJSONStorage(() => storage) },
    ),
  );

export const settingsStore = createSettingsStore(AsyncStorage);

export function useSettings<T>(selector: (s: SettingsState) => T): T {
  return useStore(settingsStore, selector);
}

export function useSettingsHydrated(): boolean {
  const [done, setDone] = useState(settingsStore.persist.hasHydrated());
  useEffect(() => settingsStore.persist.onFinishHydration(() => setDone(true)), []);
  return done;
}
