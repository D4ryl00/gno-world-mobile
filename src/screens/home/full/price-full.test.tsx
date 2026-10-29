import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useEffect as mockUseEffect } from 'react';

import PriceRoute from '@/app/home/price';
import { priceScale, readoutText } from '@/screens/home/format';
import { PriceFull } from '@/screens/home/full/price-full';

let mockParams: Record<string, string> = {};
let mockPrices: Record<string, unknown>;
const mockGet = jest.fn(async (path: string): Promise<unknown> => {
  if (path.startsWith('/api/prices')) return mockPrices;
  throw new Error(`unexpected ${path}`);
});

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: (cb: () => void | (() => void)) => mockUseEffect(cb, [cb]),
  useLocalSearchParams: () => mockParams,
}));
const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('@/state/app-services', () => ({ useServices: () => ({ offchain: { get: mockGet } }) }));
jest.mock('@/screens/home/format', () => {
  const actual = jest.requireActual('@/screens/home/format');
  return { ...actual, priceScale: jest.fn(actual.priceScale) };
});

beforeEach(() => {
  mockGet.mockClear();
  (router.back as jest.Mock).mockClear();
  mockParams = {};
  mockPrices = {
    now: 0.0583, change: -0.02, cap: 11503756, fdv: 77713900, supply: 1333000000,
    series: [[1, 0.06], [2, 0.0617], [3, 0.0567]], volumes: [[1, 100], [2, 0], [3, 1100]],
  };
});

test('header, figures and periods', async () => {
  await render(<PriceFull initialDays={7} />);
  expect(await screen.findByText('$0.0583')).toBeTruthy();
  for (const t of ['−0.02%', '$77.7M', '$11.5M', '1.33B GNOT', '$1.2k', '7d high', '$0.0617', '7d low', '$0.0567']) {
    expect(screen.getByText(t)).toBeTruthy();
  }
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=7');
  expect(screen.getByRole('button', { name: '7 days' }).props.accessibilityState).toMatchObject({ selected: true });
  await fireEvent.press(screen.getByRole('button', { name: '30 days' }));
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=30');
});

test('an unknown days param opens on 1 day', async () => {
  mockParams = { days: 'abc' };
  await render(<PriceRoute />);
  expect(await screen.findByText('$0.0583')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=1');
});

test('the route opens on the period it is given', async () => {
  mockParams = { days: '30' };
  await render(<PriceRoute />);
  expect(await screen.findByText('$0.0583')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledWith('/api/prices?coin=gnot&days=30');
});

test('✕ closes', async () => {
  await render(<PriceFull initialDays={1} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(router.back).toHaveBeenCalled();
});

test('a figure the server does not give is not shown', async () => {
  mockPrices = { ...mockPrices, fdv: 0, supply: 0 };
  await render(<PriceFull initialDays={1} />);
  expect(await screen.findByText('$0.0583')).toBeTruthy();
  expect(screen.queryByText('fdv')).toBeNull();
  expect(screen.queryByText('supply')).toBeNull();
  expect(screen.getByText('market cap')).toBeTruthy();
});

test('the volume bars: one stroke per point that traded', async () => {
  await render(<PriceFull initialDays={1} />);
  expect(await screen.findByText('$0.0583')).toBeTruthy();
  await fireEvent(screen.getByTestId('full-chart'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 300 } } });
  expect(screen.getByTestId('vol-bars').props.d.match(/M/g)).toHaveLength(2);
});

test('hold and slide on the chart: the moment is read out, then cleared when the finger lifts', async () => {
  jest.useFakeTimers();
  try {
    await render(<PriceFull initialDays={1} />);
    expect(await screen.findByText('$0.0583')).toBeTruthy();
    const chart = screen.getByTestId('full-chart');
    await fireEvent(chart, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 300 } } });
    const at = (x: number) => ({ nativeEvent: { locationX: x, locationY: 100, pageX: x, pageY: 100 } });
    await fireEvent(chart, 'responderGrant', at(150));
    await act(async () => void jest.advanceTimersByTime(200));
    await fireEvent(chart, 'responderMove', at(0));
    expect(screen.getByText(readoutText(1, 0.06, 100))).toBeTruthy();
    await fireEvent(chart, 'responderRelease', at(0));
    expect(screen.queryByText(readoutText(1, 0.06, 100))).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('sliding the finger does not rebuild the chart', async () => {
  jest.useFakeTimers();
  try {
    await render(<PriceFull initialDays={1} />);
    expect(await screen.findByText('$0.0583')).toBeTruthy();
    const chart = screen.getByTestId('full-chart');
    await fireEvent(chart, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 300 } } });
    const at = (x: number) => ({ nativeEvent: { locationX: x, locationY: 100, pageX: x, pageY: 100 } });
    const built = (priceScale as jest.Mock).mock.calls.length;
    await fireEvent(chart, 'responderGrant', at(150));
    await act(async () => void jest.advanceTimersByTime(200));
    await fireEvent(chart, 'responderMove', at(10));
    await fireEvent(chart, 'responderMove', at(290));
    expect((priceScale as jest.Mock).mock.calls.length).toBe(built);
  } finally {
    jest.useRealTimers();
  }
});

test('the figures stay above the home indicator or the navigation bar', async () => {
  mockInsets.bottom = 34;
  try {
    await render(<PriceFull initialDays={1} />);
    expect(StyleSheet.flatten(screen.getByTestId('full-root').props.style).paddingBottom).toBe(34 + 12);
  } finally {
    mockInsets.bottom = 0;
  }
});

test('opened from a link with nothing behind, ✕ goes to Home', async () => {
  (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
  await render(<PriceFull initialDays={1} />);
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(router.replace).toHaveBeenCalledWith('/');
});

const hold = async (x: number) => {
  const chart = screen.getByTestId('full-chart');
  await fireEvent(chart, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 300 } } });
  const at = (px: number) => ({ nativeEvent: { locationX: px, locationY: 100, pageX: px, pageY: 100 } });
  await fireEvent(chart, 'responderGrant', at(x));
  await act(async () => void jest.advanceTimersByTime(200));
  return { move: (px: number) => fireEvent(chart, 'responderMove', at(px)) };
};

test('no period volume when nothing traded', async () => {
  mockPrices = { ...mockPrices, volumes: [[1, 0], [2, 0], [3, 0]] };
  await render(<PriceFull initialDays={1} />);
  expect(await screen.findByText('$0.0583')).toBeTruthy();
  expect(screen.queryByText('1d volume')).toBeNull();
});

test('the readout finds a point\'s volume when the server lists one per point, even at slightly other times', async () => {
  jest.useFakeTimers();
  try {
    mockPrices = { ...mockPrices, volumes: [[11, 100], [12, 0], [13, 1100]] };
    await render(<PriceFull initialDays={1} />);
    expect(await screen.findByText('$0.0583')).toBeTruthy();
    await hold(0);
    expect(screen.getByText(readoutText(1, 0.06, 100))).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

test('a point the volumes do not cover says nothing of volume', async () => {
  jest.useFakeTimers();
  try {
    mockPrices = { ...mockPrices, volumes: [[1, 100]] };
    await render(<PriceFull initialDays={1} />);
    expect(await screen.findByText('$0.0583')).toBeTruthy();
    const h = await hold(0);
    expect(screen.getByText(readoutText(1, 0.06, 100))).toBeTruthy();
    await h.move(300);
    expect(screen.getByText(readoutText(3, 0.0567, null))).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

test('new prices arriving under a held finger: no stale point, no crash', async () => {
  jest.useFakeTimers();
  try {
    await render(<PriceFull initialDays={1} />);
    expect(await screen.findByText('$0.0583')).toBeTruthy();
    await hold(300);
    expect(screen.getByText(readoutText(3, 0.0567, 1100))).toBeTruthy();
    mockPrices = { ...mockPrices, now: 0.0584, series: [[4, 0.061], [5, 0.0584]], volumes: [] };
    await act(async () => void jest.advanceTimersByTime(300000));
    expect(await screen.findByText('$0.0610')).toBeTruthy(); // the new period high: the refresh arrived
    expect(screen.queryByText(/ · \$0\.0567/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('while another period loads, the figures keep the period they describe', async () => {
  await render(<PriceFull initialDays={1} />);
  expect(await screen.findByText('1d high')).toBeTruthy();
  mockGet.mockImplementationOnce(() => new Promise(() => {}));
  await fireEvent.press(screen.getByRole('button', { name: '30 days' }));
  expect(screen.getByText('1d high')).toBeTruthy();
  expect(screen.queryByText('30d high')).toBeNull();
});
