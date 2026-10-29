import { render, screen } from '@testing-library/react-native';

import { SessionScreen } from '@/screens/session';

const mockBuild = { walletEnabled: true };

jest.mock('@/session/wallet-build', () => ({
  get walletEnabled() {
    return mockBuild.walletEnabled;
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/state/app-services', () => ({
  useServices: () => ({ api: {} }),
  useSession: <T,>(sel: (s: object) => T) =>
    sel({ phase: 'none', refresh: async () => null, takeWalletError: () => undefined, begin: async () => undefined }),
}));

test('with the wallet, a session comes from gnokey-mobile', async () => {
  mockBuild.walletEnabled = true;
  await render(<SessionScreen />);
  expect(screen.getByText('Get a session from gnokey-mobile')).toBeTruthy();
  expect(screen.queryByText('Coming soon')).toBeNull();
});

test('without the wallet, gnokey-mobile is coming soon and a session comes from a computer', async () => {
  mockBuild.walletEnabled = false;
  await render(<SessionScreen />);
  expect(screen.getByText('Coming soon')).toBeTruthy();
  expect(screen.getByText('gnokey mobile')).toBeTruthy();
  expect(screen.getByText(/coming soon to the App Store and Google Play/)).toBeTruthy();
  expect(screen.getByText('Get a session from a computer')).toBeTruthy();
  expect(screen.queryByText('Get a session from gnokey-mobile')).toBeNull();
});
