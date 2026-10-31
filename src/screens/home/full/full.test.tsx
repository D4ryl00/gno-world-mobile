import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useEffect as mockUseEffect } from 'react';
import { useStore as mockUseStore } from 'zustand';

import { line } from '@/offchain/chat/testing';
import { screenServices } from '@/screens/channels/testing';
import { ChatFull } from '@/screens/home/full/chat-full';
import { HereFull } from '@/screens/home/full/here-full';

let mockS: ReturnType<typeof screenServices>;
const ROOM = 'AAAAAAAAAAAAAAAAAAAA';
const LISTED = 'BBBBBBBBBBBBBBBBBBBB';
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
jest.mock('@/state/app-services', () => ({
  useServices: () => ({ ...mockS, offchain: { get: mockGet } }),
  useRooms: <T,>(sel: (s: ReturnType<typeof mockS.rooms.getState>) => T) => mockUseStore(mockS.rooms, sel),
  useHomeChannels: <T,>(sel: (s: ReturnType<typeof mockS.homeChannels.getState>) => T) => mockUseStore(mockS.homeChannels, sel),
}));
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
    mockS = screenServices({
      book: { rooms: [{ id: ROOM, name: 'Dev chat', key: '', at: 1 }], left: {} },
      listed: [{ id: LISTED, name: 'governance', here: 4, made: 1 }, { id: ROOM, name: 'Dev chat', here: 2, made: 2 }],
    });
    await mockS.ready;
    mockS.chat.setState({
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
    expect(mockS.chat.getState().lastSeen).toBe(2);
  });

  test('scrolling back loads older lines', async () => {
    const loadOlder = jest.fn(async () => undefined);
    mockS.chat.setState({ loadOlder });
    await render(<ChatFull />);
    await fireEvent(screen.getByTestId('chat-full-list'), 'endReached');
    expect(loadOlder).toHaveBeenCalled();
  });

  test('Write in Chat › stays above the home indicator or the navigation bar', async () => {
    mockInsets.bottom = 48;
    try {
      await render(<ChatFull />);
      expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Write in Public ›' }).props.style).paddingBottom).toBe(48 + 12);
    } finally {
      mockInsets.bottom = 0;
    }
  });

  test('Write in Public › goes to the Chat tab on Public, whatever it showed', async () => {
    mockS.chatChannel.getState().select(ROOM);
    await render(<ChatFull />);
    await fireEvent.press(screen.getByRole('button', { name: 'Write in Public ›' }));
    expect(mockS.chatChannel.getState().current).toBe('');
    expect(router.dismissTo).toHaveBeenCalledWith('/chat');
  });

  test('Write in Dev chat › goes to the Chat tab on that room', async () => {
    mockS.homeChannels.getState().add({ id: ROOM, name: 'Dev chat' });
    await render(<ChatFull />);
    await fireEvent.press(screen.getByRole('button', { name: 'Write in Dev chat ›' }));
    expect(mockS.chatChannel.getState().current).toBe(ROOM);
    expect(router.dismissTo).toHaveBeenCalledWith('/chat');
  });

  test('the full screen switches channel for Home too', async () => {
    mockS.homeChannels.getState().add({ id: ROOM, name: 'Dev chat' });
    mockS.rooms.getState().room(ROOM).setState({ phase: 'live', lines: [line(9, { body: 'room line' })] });
    await render(<ChatFull />);
    expect(screen.getByText('room line')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: /^Public/ }));
    expect(screen.getByText('gm')).toBeTruthy();
    expect(mockS.homeChannels.getState().current).toBe('');
  });

  test('＋ opens Show on Home: your rooms, then listed ones, ✓ on tabs there; a row adds or removes', async () => {
    mockS.homeChannels.getState().add({ id: ROOM, name: 'Dev chat' });
    await render(<ChatFull />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add a channel' }));
    expect(screen.getByText('Show on Home')).toBeTruthy();
    expect(screen.getByText('YOUR ROOMS')).toBeTruthy();
    expect(screen.getByText('LISTED ON GNO.WORLD')).toBeTruthy();
    const mine = screen.getByRole('button', { name: /^Dev chat/ });
    expect(mine.props.accessibilityState.checked).toBe(true);
    const listed = screen.getByRole('button', { name: /^governance/ });
    expect(within(listed).getByText('4 here')).toBeTruthy();
    expect(listed.props.accessibilityState.checked).toBe(false);
    await fireEvent.press(listed);
    expect(mockS.homeChannels.getState().tabs.map((t) => t.id)).toEqual(['', ROOM, LISTED]);
    expect(mockS.homeChannels.getState().current).toBe(LISTED);
    await fireEvent.press(screen.getByRole('button', { name: /^Dev chat/ }));
    expect(mockS.homeChannels.getState().tabs.map((t) => t.id)).toEqual(['', LISTED]);
    expect(mockS.book().rooms.map((r) => r.id)).toEqual([ROOM]); // adding a listed room does not join it
  });

  test('could not be listed right now when /api/rooms failed', async () => {
    mockS.client.listPublic = async () => {
      throw new Error('down');
    };
    await render(<ChatFull />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add a channel' }));
    expect(screen.getByText('could not be listed right now')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Dev chat/ })).toBeTruthy();
  });

  test('long-press a room tab offers Remove from Home', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    mockS.homeChannels.getState().add({ id: ROOM, name: 'Dev chat' });
    await render(<ChatFull />);
    await fireEvent(screen.getByRole('tab', { name: /^Dev chat/ }), 'longPress');
    const buttons = alert.mock.calls[0][2]!;
    await act(async () => buttons.find((b) => b.text === 'Remove from Home')!.onPress!());
    expect(mockS.homeChannels.getState().tabs.map((t) => t.id)).toEqual(['']);
    alert.mockRestore();
  });
});
