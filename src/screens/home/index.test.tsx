import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useEffect as mockUseEffect } from 'react';
import { StyleSheet } from 'react-native';
import { useStore as mockUseStore } from 'zustand';

import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { HomeScreen } from '@/screens/home';
import { CARD_HEIGHT } from '@/screens/home/layout';

let mockChat: ReturnType<typeof createChatStore>;
const serve = async (path: string): Promise<unknown> => {
  if (path.startsWith('/api/prices')) return { now: 0.05822, change: -0.308, cap: 11487970.4, fdv: 77713900, series: [[1, 0.0584], [2, 0.0583]] };
  if (path === '/api/where') return { by_country: [{ cc: 'FR', n: 3 }], count: 18, elsewhere: 0, geo: true };
  throw new Error(`unexpected ${path}`);
};
const mockGet = jest.fn(serve);

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn(), push: jest.fn() },
  useFocusEffect: (cb: () => void | (() => void)) => mockUseEffect(cb, [cb]),
}));
jest.mock('@/state/app-services', () => ({
  useServices: () => ({ offchain: { get: mockGet }, chat: mockChat }),
  useChat: <T,>(sel: (s: ReturnType<typeof mockChat.getState>) => T) => mockUseStore(mockChat, sel),
}));

beforeEach(async () => {
  mockGet.mockClear().mockImplementation(serve);
  mockChat = createChatStore({
    client: {} as never,
    identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
    kv: { getItem: async () => null, setItem: async () => undefined },
  });
  await mockChat.ready;
});

test('Home shows the price, who is here and the chat; a period asks for its prices', async () => {
  await render(<HomeScreen />);
  expect(await screen.findByText('$0.0582')).toBeTruthy();
  expect(screen.getByText('18 people')).toBeTruthy();
  expect(screen.getByRole('button', { name: /^Chat/ })).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=1');
  await fireEvent.press(screen.getByRole('button', { name: '30 days' }));
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=30');
});

test('pulling down reloads the prices and who is here, fresh as they are', async () => {
  const view = await render(<HomeScreen />);
  expect(await screen.findByText('18 people')).toBeTruthy();
  mockGet.mockClear();
  const [scroll] = view.container.queryAll((n) => n.props.refreshControl);
  await act(() => scroll.props.refreshControl.props.onRefresh());
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=1');
  expect(mockGet).toHaveBeenCalledWith('/api/where');
});

test('switching period keeps the price while the new chart loads', async () => {
  await render(<HomeScreen />);
  expect(await screen.findByText('$0.0582')).toBeTruthy();
  mockGet.mockImplementation((p) => (p.includes('days=30') ? new Promise(() => {}) : serve(p)));
  await fireEvent.press(screen.getByRole('button', { name: '30 days' }));
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=30');
  expect(screen.getByText('$0.0582')).toBeTruthy();
  expect(screen.getByText('fdv $77.7M')).toBeTruthy();
});

test('the three cards are the same height', async () => {
  const view = await render(<HomeScreen />);
  expect(await screen.findByText('18 people')).toBeTruthy();
  const cards = view.container.queryAll((n) => n.type === 'View' && StyleSheet.flatten(n.props.style)?.height === CARD_HEIGHT);
  expect(cards).toHaveLength(3);
});

test('the cards open full screen, the price on the period it shows', async () => {
  await render(<HomeScreen />);
  expect(await screen.findByText('18 people')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: '30 days' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Open GNOT full screen' }));
  expect(router.push).toHaveBeenCalledWith({ pathname: '/home/price', params: { days: '30' } });
  await fireEvent.press(screen.getByRole('button', { name: 'Open Here Now full screen' }));
  expect(router.push).toHaveBeenCalledWith('/home/here');
});
