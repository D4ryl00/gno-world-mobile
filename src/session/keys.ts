import type { ChainApi } from '@/chain/api';
import { decodeAddress, encodeAddress, encodePubKey } from '@/utils/bech32';

import type { SessionKey } from './types';

export interface SecretStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const PASSWORD_KEY = 'br.keybase.password';
const inFlightPasswords = new WeakMap<SecretStore, Promise<string>>();

/** One random password protects every session key in gnonative's keybase; it lives in the secure store. */
export async function keybasePassword(store: SecretStore, randomHex: (bytes: number) => string): Promise<string> {
  const existing = inFlightPasswords.get(store);
  if (existing) return existing;

  const promise = (async () => {
    const have = await store.get(PASSWORD_KEY);
    if (have) return have;
    const pw = randomHex(32);
    await store.set(PASSWORD_KEY, pw);
    return pw;
  })();

  inFlightPasswords.set(store, promise);
  try {
    return await promise;
  } catch (e) {
    inFlightPasswords.delete(store);
    throw e;
  }
}

export async function createSessionKey(
  api: ChainApi, store: SecretStore, randomHex: (bytes: number) => string, now: () => number,
): Promise<SessionKey> {
  const password = await keybasePassword(store, randomHex);
  const keyName = `br-session-${now()}`;
  const info = await api.createAccount(keyName, await api.generateRecoveryPhrase(), password);
  if (!info) throw new Error('gnonative did not create the key');
  return { keyName, address: encodeAddress(info.address), pubkey: encodePubKey(info.pubKey) };
}

/** Activate `key` (as a session of `master` when given) and unlock it, so it can sign. */
export async function unlockKey(api: ChainApi, store: SecretStore, key: SessionKey, master?: string): Promise<void> {
  const password = await keybasePassword(store, () => {
    throw new Error('the keybase password is missing from the secure store');
  });
  await api.activateAccount(key.keyName, master ? decodeAddress(master) : undefined);
  await api.setPassword(password, decodeAddress(key.address));
}
