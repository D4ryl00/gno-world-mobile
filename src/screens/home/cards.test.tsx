import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { useStore as mockUseStore } from 'zustand';

import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { line } from '@/offchain/chat/testing';
import type { Prices, Where } from '@/offchain/home';
import { ChatCard } from '@/screens/home/chat-card';
import { HereCard } from '@/screens/home/here-card';
import { PriceCard } from '@/screens/home/price-card';

let mockChat: ReturnType<typeof createChatStore>;
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@/state/app-services', () => ({
  useChat: <T,>(sel: (s: ReturnType<typeof mockChat.getState>) => T) => mockUseStore(mockChat, sel),
}));

const PRICES: Prices = { days: 1, now: 0.05822, change: -0.308, cap: 11487970.4, fdv: 77713900, supply: 0, series: [[1793183280, 0.0584], [1793183340, 0.0583]], volumes: [] };
const WHERE: Where = { count: 18, byCountry: [{ cc: 'FR', n: 3 }, { cc: 'AU', n: 1 }], elsewhere: 2, geo: true, spots: [] };

const layout = (el: Parameters<typeof fireEvent>[0], width: number, height: number) =>
  fireEvent(el, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width, height } } });

describe('PriceCard', () => {
  test('a tap on the card or its › opens it full screen; the periods still switch the card', async () => {
    const [onOpen, onDays] = [jest.fn(), jest.fn()];
    await render(<PriceCard data={PRICES} failed={false} days={1} onDays={onDays} onOpen={onOpen} />);
    await fireEvent.press(screen.getByText('$0.0582'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: '7 days' }));
    expect(onDays).toHaveBeenCalledWith(7);
    expect(onOpen).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Open GNOT full screen' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  test('shows the price, the change, the fdv and the periods', async () => {
    const onDays = jest.fn();
    await render(<PriceCard data={PRICES} failed={false} days={1} onDays={onDays} />);
    for (const t of ['GNOT', '$0.0582', '−0.31%', 'fdv $77.7M']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByRole('button', { name: '1 day' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: '7 days' }).props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByRole('button', { name: '7 days' }));
    expect(onDays).toHaveBeenCalledWith(7);
    expect(screen.getByRole('button', { name: '30 days' })).toBeTruthy();
  });

  test('without data after a failure: the site text', async () => {
    await render(<PriceCard data={null} failed days={1} onDays={jest.fn()} />);
    expect(screen.getByText('prices are busy — trying again')).toBeTruthy();
  });

  test('a failure with data keeps the price and adds a note', async () => {
    await render(<PriceCard data={PRICES} failed days={1} onDays={jest.fn()} />);
    expect(screen.getByText('$0.0582')).toBeTruthy();
    expect(screen.getByText('prices are busy — trying again')).toBeTruthy();
  });

  test('while a period loads, the card says so instead of going blank', async () => {
    await render(<PriceCard data={null} failed={false} days={30} onDays={jest.fn()} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  test('while another period loads, the price stays and the old chart dims', async () => {
    await render(<PriceCard data={PRICES} stale failed={false} days={30} onDays={jest.fn()} />);
    for (const t of ['$0.0582', '−0.31%', 'fdv $77.7M']) expect(screen.getByText(t)).toBeTruthy();
    expect(screen.getByTestId('price-chart-box').props.accessibilityState).toMatchObject({ busy: true });
    expect(screen.queryByText('loading…')).toBeNull();
  });

  test('while another period loads after no prices, the card says loading, not no prices', async () => {
    await render(<PriceCard data={{ ...PRICES, now: null }} stale failed={false} days={30} onDays={jest.fn()} />);
    expect(screen.getByText('loading…')).toBeTruthy();
    expect(screen.queryByText('no prices right now')).toBeNull();
  });

  test('the chart fills the room the card leaves it', async () => {
    await render(<PriceCard data={PRICES} failed={false} days={1} onDays={jest.fn()} />);
    await layout(screen.getByTestId('price-plot'), 300, 97);
    expect(screen.getByTestId('price-chart').props).toMatchObject({ width: 300, height: 97 });
  });

  test('without fdv the card shows the market cap as mc, as the site', async () => {
    await render(<PriceCard data={{ ...PRICES, fdv: 0 }} failed={false} days={1} onDays={jest.fn()} />);
    expect(screen.getByText('mc $11.5M')).toBeTruthy();
  });

  test('one point is no chart, and no prices as the site says it', async () => {
    await render(<PriceCard data={{ ...PRICES, series: [[1, 2]] }} failed={false} days={1} onDays={jest.fn()} />);
    expect(screen.queryByTestId('price-chart')).toBeNull();
    expect(screen.getByText('no prices right now')).toBeTruthy();
  });

  test('a reply without a price never shows $0', async () => {
    await render(<PriceCard data={{ days: 1, now: null, change: 0, cap: 0, fdv: 0, supply: 0, series: [], volumes: [] }} failed={false} days={1} onDays={jest.fn()} />);
    expect(screen.getByText('no prices right now')).toBeTruthy();
    expect(screen.queryByText(/^\$0/)).toBeNull();
    expect(screen.queryByText(/^(fdv|mc) /)).toBeNull();
  });
});

describe('HereCard', () => {
  test('a tap on the card or its › opens it full screen', async () => {
    const onOpen = jest.fn();
    await render(<HereCard data={WHERE} failed={false} onOpen={onOpen} />);
    await fireEvent.press(screen.getByText('France'));
    await fireEvent.press(screen.getByRole('button', { name: 'Open Here Now full screen' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  test('the total and the table, elsewhere included', async () => {
    await render(<HereCard data={WHERE} failed={false} />);
    expect(screen.getByText('18 people')).toBeTruthy();
    expect(screen.getByText('France')).toBeTruthy();
    expect(screen.getByText('🇫🇷')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('elsewhere')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  test('countries unavailable: one unknown row with the total', async () => {
    await render(<HereCard data={{ ...WHERE, byCountry: [], elsewhere: 0, geo: false, spots: [] }} failed={false} />);
    expect(screen.getByText('18 people · countries unavailable on this build')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
    expect(screen.getByText('18')).toBeTruthy();
  });

  test('before the first answer, the card says it is loading', async () => {
    await render(<HereCard data={null} failed={false} />);
    expect(screen.getByText('loading…')).toBeTruthy();
  });

  test('many countries scroll inside the card', async () => {
    const many = ['FR', 'ES', 'BG', 'BR', 'CA', 'GH', 'MX', 'NL', 'US', 'DE', 'IT', 'JP'].map((cc) => ({ cc, n: 1 }));
    await render(<HereCard data={{ count: 12, byCountry: many, elsewhere: 0, geo: true, spots: [] }} failed={false} />);
    const rows = screen.getByTestId('here-rows');
    expect(within(rows).getByText('France')).toBeTruthy();
    expect(within(rows).getByText('Japan')).toBeTruthy();
    expect(rows.props.nestedScrollEnabled).toBe(true); // without it, Android does not scroll a list inside the page
  });

  test('the rows are padded once, and the empty room under a short table opens the card too', async () => {
    await render(<HereCard data={WHERE} failed={false} onOpen={jest.fn()} />);
    const list = screen.getByTestId('here-rows');
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toEqual({ flexGrow: 1 });
    expect(StyleSheet.flatten(screen.getByTestId('here-rows-press').props.style)).toMatchObject({ flexGrow: 1, paddingRight: 8 });
  });

  test('nobody yet when the table is empty', async () => {
    await render(<HereCard data={{ count: 0, byCountry: [], elsewhere: 0, geo: true, spots: [] }} failed={false} />);
    expect(screen.getByText('nobody yet')).toBeTruthy();
  });
});

describe('ChatCard', () => {
  beforeEach(async () => {
    (router.navigate as jest.Mock).mockClear();
    mockChat = createChatStore({
      client: {} as never,
      identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
      kv: { getItem: async () => null, setItem: async () => undefined },
    });
    await mockChat.ready;
  });

  test('the last 3 lines, oldest first, with their age; a press opens Chat', async () => {
    const now = Math.floor(Date.now() / 1000);
    mockChat.setState({
      lines: [
        line(1, { name: 'old', body: 'too old' }),
        line(2, { name: 'ann', body: 'gm', t: now - 3 * 3600 }),
        line(3, { name: 'bob', body: 'pic', att: { kind: 'image', url: '', name: '' } }),
        line(4, { name: 'cid', body: 'when gnoverse?', t: now }),
      ],
    });
    await render(<ChatCard />);
    expect(screen.queryByText('too old')).toBeNull();
    const names = screen.getAllByTestId('chat-card-name').map((n) => n.props.children);
    expect(names).toEqual(['ann', 'bob', 'cid']);
    expect(screen.getByText('3h')).toBeTruthy();
    expect(screen.getByText('📎 picture')).toBeTruthy();
    // a screen reader reads the lines, not just the card's purpose
    const card = screen.getByRole('button', { name: /^Chat\. ann: gm, 3h\. bob: 📎 picture, [^.]+\. cid: when gnoverse\?, [^.]+$/ });
    expect(card.props.accessibilityHint).toBe('Opens the chat to read');
    await fireEvent.press(card);
    expect(router.navigate).toHaveBeenCalledWith('/home/chat');
  });

  test('before the first lines arrive, the card says it is loading', async () => {
    mockChat.setState({ phase: 'loading' });
    await render(<ChatCard />);
    expect(screen.getByText('loading…')).toBeTruthy();
    expect(screen.queryByText('nothing said yet')).toBeNull();
  });

  test('an unreachable chat says so, under the lines it still has', async () => {
    mockChat.setState({ phase: 'unreachable' });
    const view = await render(<ChatCard />);
    expect(screen.getByText('chat unreachable — retrying')).toBeTruthy();
    expect(screen.queryByText('nothing said yet')).toBeNull();
    await view.unmount();
    mockChat.setState({ phase: 'unreachable', lines: [line(1, { name: 'ann', body: 'gm' })] });
    await render(<ChatCard />);
    expect(screen.getByText('gm')).toBeTruthy();
    expect(screen.getByText('chat unreachable — retrying')).toBeTruthy();
  });

  test('as many of the newest lines as the card has room for', async () => {
    mockChat.setState({ phase: 'live', lines: Array.from({ length: 12 }, (_, i) => line(i + 1, { name: `n${i + 1}`, body: 'hi' })) });
    await render(<ChatCard />);
    expect(screen.getAllByTestId('chat-card-name')).toHaveLength(3); // until measured
    await layout(screen.getByTestId('chat-card-lines'), 300, 140);
    await layout(screen.getAllByTestId('chat-card-line')[0], 300, 20);
    // (140 + 8 gap) / (20 + 8) = 5.3: five lines, the newest
    expect(screen.getAllByTestId('chat-card-name').map((n) => n.props.children)).toEqual(['n8', 'n9', 'n10', 'n11', 'n12']);
  });

  test('an empty chat says so and still opens Chat', async () => {
    mockChat.setState({ phase: 'live' });
    await render(<ChatCard />);
    expect(screen.getByText('nothing said yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Chat. nothing said yet' }));
    expect(router.navigate).toHaveBeenCalledWith('/home/chat');
  });
});
