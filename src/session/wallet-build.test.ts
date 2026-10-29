import { walletFromEnv } from '@/session/wallet-build';

test('the wallet is on unless the build sets EXPO_PUBLIC_WALLET=off', () => {
  expect(walletFromEnv(undefined)).toBe(true);
  expect(walletFromEnv('')).toBe(true);
  expect(walletFromEnv('on')).toBe(true);
  expect(walletFromEnv('off')).toBe(false);
});
