import { requireOptionalNativeModule } from 'expo';

interface Pbkdf2Native {
  sha256Hex(password: string, salt: string, iterations: number, length: number): Promise<string>;
}

// null in a build without the module (Expo Go, a dev build made before it existed)
const native = requireOptionalNativeModule<Pbkdf2Native>('Pbkdf2');

export const NO_MODULE = 'this build cannot pair — update the app';

/** PBKDF2-HMAC-SHA256 of UTF-8 strings, native and off the JS thread: 200 000 rounds take many seconds in Hermes. */
export async function pbkdf2Sha256(password: string, salt: string, iterations: number, length: number): Promise<Uint8Array> {
  if (!native) throw new Error(NO_MODULE);
  const hex = await native.sha256Hex(password, salt, iterations, length);
  if (hex.length !== length * 2 || !/^[0-9a-f]*$/.test(hex)) throw new Error('the key derivation answered nonsense');
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}
