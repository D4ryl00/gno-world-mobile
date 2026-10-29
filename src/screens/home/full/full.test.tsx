import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useEffect as mockUseEffect } from 'react';

import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { line } from '@/offchain/chat/testing';
import { ChatFull } from '@/screens/home/full/chat-full';
import { HereFull } from '@/screens/home/full/here-full';

let mockChat: ReturnType<typeof createChatStore>;
let mockWhere: Record<string, unknown>;
const mockGet = jest.fn(async (path: string): Promise<unknown> => {
  if (path === '/api/where') return mockWhere;
  throw new Error(`unexpected ${path}`);
});

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), dismissTo: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: (cb: () => void | (() => void)) => mockUseEffect(cb, [cb]),
}));
const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('@/state/app-services', () => ({ useServices: () => ({ offchain: { get: mockGet }, chat: mockChat }) }));
jest.mock('@/state/settings', () => ({ useSettings: <T,>(sel: (s: { offchainUrl: string }) => T) => sel({ offchainUrl: 'http://fake' }) }));

const COUNTRIES = ['FR', 'CA', 'ES', 'UA', 'BG', 'BR', 'GB', 'GH', 'MX', 'NL', 'US', 'JP'];

describe('Here Now', () => {
  beforeEach(() => {
    mockWhere = {
      count: 22,
      by_country: COUNTRIES.map((cc, i) => ({ cc, n: i === 0 ? 5 : i < 4 ? 2 : 1 })),
      elsewhere: 3,
      geo: true,
      spots: [
        { cc: 'FR', lat: 48.5, lon: 1.5, n: 3 },
        { cc: 'FR', lat: 45.75, lon: 4.75, n: 2 },
        { cc: 'JP', lat: 35.75, lon: 139.75, n: 1 },
      ],
    };
  });

  test('the total, a dot per place, and every country with its share', async () => {
    await render(<HereFull />);
    expect(await screen.findByText('22 people')).toBeTruthy();
    for (const name of ['France', 'Japan', 'United Kingdom', 'Ukraine', 'elsewhere']) expect(screen.getByText(name)).toBeTruthy();
    expect(screen.getByText('23%')).toBeTruthy(); // France: 5 of 22
    expect(screen.getAllByTestId('map-spot')).toHaveLength(3);
    expect(screen.getByText('a dot per place, about 25 km precise')).toBeTruthy();
  });

  test('countries unavailable: no dots, the note says so, one unknown row', async () => {
    mockWhere = { count: 18, by_country: [], elsewhere: 0, geo: false, spots: (mockWhere.spots as unknown[]) };
    await render(<HereFull />);
    expect(await screen.findByText('unknown')).toBeTruthy();
    expect(screen.queryAllByTestId('map-spot')).toHaveLength(0);
    expect(screen.getByText('countries unavailable on this build')).toBeTruthy();
  });

  test('the table stays above the home indicator or the navigation bar', async () => {
    mockInsets.bottom = 48;
    try {
      await render(<HereFull />);
      expect(StyleSheet.flatten(screen.getByTestId('here-full-list').props.contentContainerStyle).paddingBottom).toBe(48 + 12);
    } finally {
      mockInsets.bottom = 0;
    }
  });

  test('✕ closes', async () => {
    await render(<HereFull />);
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(router.back).toHaveBeenCalled();
  });
});

describe('Chat, read only', () => {
  beforeEach(async () => {
    (router.dismissTo as jest.Mock).mockClear();
    mockChat = createChatStore({
      client: {} as never,
      identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
      kv: { getItem: async () => null, setItem: async () => undefined },
    });
    await mockChat.ready;
    mockChat.setState({
      phase: 'live',
      here: 7,
      lines: [line(1, { name: 'ann', body: 'gm' }), line(2, { name: 'bob', body: 'hi all', rx: { '❤️': 1 } })],
    });
  });

  test('the lines, newest last, with who is here; nothing to react with', async () => {
    await render(<ChatFull />);
    expect(screen.getByText('7 here')).toBeTruthy();
    // an inverted list renders the newest first, which shows it at the bottom
    expect(screen.getAllByText(/^(gm|hi all)$/).map((t) => t.props.children)).toEqual([['hi all'], ['gm']]);
    expect(screen.queryByRole('button', { name: /❤️/ })).toBeNull();
  });

  test('reading here counts as seen', async () => {
    await render(<ChatFull />);
    expect(mockChat.getState().lastSeen).toBe(2);
  });

  test('scrolling back loads older lines', async () => {
    const loadOlder = jest.fn(async () => undefined);
    mockChat.setState({ loadOlder });
    await render(<ChatFull />);
    await fireEvent(screen.getByTestId('chat-full-list'), 'endReached');
    expect(loadOlder).toHaveBeenCalled();
  });

  test('Write in Chat › stays above the home indicator or the navigation bar', async () => {
    mockInsets.bottom = 48;
    try {
      await render(<ChatFull />);
      expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Write in Chat ›' }).props.style).paddingBottom).toBe(48 + 12);
    } finally {
      mockInsets.bottom = 0;
    }
  });

  test('Write in Chat › goes to the Chat tab', async () => {
    await render(<ChatFull />);
    await fireEvent.press(screen.getByRole('button', { name: 'Write in Chat ›' }));
    expect(router.dismissTo).toHaveBeenCalledWith('/chat');
  });
});
