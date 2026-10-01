import * as SecureStore from 'expo-secure-store';

import type { SecretStore } from '@/session/keys';

export const secureStore: SecretStore = {
  get: (k) => SecureStore.getItemAsync(k),
  set: (k, v) => SecureStore.setItemAsync(k, v),
};
