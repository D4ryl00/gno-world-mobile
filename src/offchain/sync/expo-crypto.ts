import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync, CryptoDigestAlgorithm, digest, getRandomBytes } from 'expo-crypto';

import { pbkdf2Sha256 } from '../../../modules/pbkdf2';
import type { CryptoBackend } from './crypto';

/** The app's backend: AES-GCM and SHA-256 by expo-crypto (native), PBKDF2 by modules/pbkdf2. */
export const expoCrypto: CryptoBackend = {
  random: (n) => getRandomBytes(n),
  sha256: async (data) => new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, new Uint8Array(data))),
  pbkdf2: pbkdf2Sha256,
  seal: async (key, plain, iv) => {
    const sealed = await aesEncryptAsync(plain, await AESEncryptionKey.import(key), { nonce: { bytes: iv } });
    return (await sealed.combined('bytes')) as Uint8Array; // iv | ciphertext | tag, as the site lays it out
  },
  open: async (key, sealed) =>
    (await aesDecryptAsync(AESSealedData.fromCombined(sealed), await AESEncryptionKey.import(key), { output: 'bytes' })) as Uint8Array,
};
