import { getRandomBytes } from 'expo-crypto';

export const randomHex = (bytes: number) =>
  Array.from(getRandomBytes(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
