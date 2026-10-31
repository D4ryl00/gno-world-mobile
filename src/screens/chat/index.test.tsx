import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { useEffect as mockUseEffect } from 'react';
import { useStore as mockUseStore } from 'zustand';

import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createIdentityState } from '@/offchain/chat/identity-store';
import { NO_SUCH_ROOM } from '@/offchain/rooms/store';
import { screenServices } from '@/screens/channels/testing';
import { ChatScreen } from '@/screens/chat';

const A = 'AAAAAAAAAAAAAAAAAAAA';
const L = 'LLLLLLLLLLLLLLLLLLLL';
const X = 'XXXXXXXXXXXXXXXXXXXX';
const mockParams: { identity?: string; room?: string } = {};
let mockS: ReturnType<typeof screenServices>;
let mockIdentity: ReturnType<typeof createIdentityState>;

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => mockUseEffect(cb, [cb]),
  useLocalSearchParams: () => mockParams,
  router: { setParams: jest.fn(), push: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/state/app-services', () => ({
  useServices: () => ({ ...mockS, identity: mockIdentity }),
  useSession: <T,>(sel: (s: { active: null }) => T) => sel({ active: null }),
  useRooms: <T,>(sel: (s: ReturnType<typeof mockS.rooms.getState>) => T) => mockUseStore(mockS.rooms, sel),
  useChatChannel: <T,>(sel: (s: ReturnType<typeof mockS.chatChannel.getState>) => T) => mockUseStore(mockS.chatChannel, sel),
}));

beforeEach(async () => {
  delete mockParams.identity;
  delete mockParams.room;
  jest.mocked(router.setParams).mockClear();
  jest.mocked(router.push).mockClear();
  mockS = screenServices({
    book: { rooms: [{ id: A, name: 'Dev chat', key: '', at: 1 }], left: {} },
    listed: [{ id: L, name: 'governance', here: 4, made: 1 }],
  });
  mockIdentity = createIdentityState({
    client: {} as never,
    identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
    kv: { getItem: async () => null, setItem: async () => undefined },
  });
  await Promise.all([mockS.ready, mockIdentity.ready]);
});

// Back from the wallet, the answer to a proof (a name reserved, or refused) is
// on the name sheet: the callback asks for it, whatever the screen kept.
test('the chat opens on the name sheet when asked to', async () => {
  mockParams.identity = '1';
  await render(<ChatScreen />);
  expect(screen.getByLabelText('name')).toBeTruthy();
});

test('the chat opens without the name sheet otherwise', async () => {
  await render(<ChatScreen />);
  expect(screen.queryByLabelText('name')).toBeNull();
});

test('the param is spent once read: closed, the sheet stays closed; a second proof opens it again', async () => {
  mockParams.identity = '1';
  const view = await render(<ChatScreen />);
  expect(router.setParams).toHaveBeenCalledWith({ identity: undefined });
  await fireEvent.press(screen.getByText('Done'));
  delete mockParams.identity; // what setParams did
  await view.rerender(<ChatScreen />);
  expect(screen.queryByLabelText('name')).toBeNull();
  mockParams.identity = '1'; // the next proof comes back
  await view.rerender(<ChatScreen />);
  expect(screen.getByLabelText('name')).toBeTruthy();
});

test('the row is Public, the rooms joined, then the listed ones', async () => {
  await render(<ChatScreen />);
  expect(screen.getAllByRole('tab').map((t) => t.props.accessibilityLabel)).toEqual(['Public', 'Dev chat', 'governance']);
  expect(screen.getByTestId('channel-separator')).toBeTruthy();
});

test('the room param selects that channel then is cleared', async () => {
  mockParams.room = A;
  await render(<ChatScreen />);
  expect(mockS.chatChannel.getState().current).toBe(A);
  expect(router.setParams).toHaveBeenCalledWith({ room: undefined });
  expect(screen.getByPlaceholderText('say something in Dev chat')).toBeTruthy();
});

test('a room param not in the row is joined', async () => {
  mockS.client.info = async () => ({ id: X, name: 'party', listed: false, here: 1, made: 1 });
  mockParams.room = X;
  await render(<ChatScreen />);
  await act(async () => undefined);
  expect(mockS.book().rooms.map((r) => r.id)).toContain(X);
  expect(mockS.chatChannel.getState().current).toBe(X);
});

test('a gone join leaves Public current and says why', async () => {
  mockParams.room = X;
  await render(<ChatScreen />);
  expect(await screen.findByText(NO_SUCH_ROOM)).toBeTruthy();
  expect(mockS.chatChannel.getState().current).toBe('');
});

test('a current channel no longer in the row falls back to Public', async () => {
  mockS.chatChannel.getState().select(X);
  await render(<ChatScreen />);
  expect(mockS.chatChannel.getState().current).toBe('');
});

test('a listed room is read without joining it', async () => {
  await render(<ChatScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'governance' }));
  expect(mockS.chatChannel.getState().current).toBe(L);
  expect(mockS.rooms.getState().focused).toBe(L);
  expect(mockS.book().rooms.map((r) => r.id)).toEqual([A]);
});

test('the header shows who is here, the name pill, ＋ and ⋯', async () => {
  mockS.chat.setState({ here: 26 });
  await render(<ChatScreen />);
  expect(screen.getByText('Chat · 26 here')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'you' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Channel menu' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'New room' }));
  expect(router.push).toHaveBeenCalledWith('/rooms/new');
});

test('Leave in ⋯ goes back to Public', async () => {
  mockS.chatChannel.getState().select(A);
  await render(<ChatScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Channel menu' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Leave' }));
  await act(async () => undefined);
  expect(mockS.chatChannel.getState().current).toBe('');
});

test('⋯ on Public offers only Pair with a browser', async () => {
  await render(<ChatScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Channel menu' }));
  expect(screen.queryByText('Leave')).toBeNull();
  await fireEvent.press(screen.getByText('Pair with a browser'));
  expect(router.push).toHaveBeenCalledWith('/pair');
});

test('the invitation banner opens the room or goes away', async () => {
  mockS.rooms.setState({ banner: { id: A, name: 'Dev chat', from: 'bob' } });
  await render(<ChatScreen />);
  expect(screen.getByText('bob opened "Dev chat" for you')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Open' }));
  expect(mockS.chatChannel.getState().current).toBe(A);
  expect(screen.queryByText('bob opened "Dev chat" for you')).toBeNull();
  await act(() => mockS.rooms.setState({ banner: { id: A, name: 'Dev chat', from: 'cat' } }));
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(mockS.rooms.getState().banner).toBeNull();
});

test('a gone room is said, until dismissed', async () => {
  mockS.rooms.setState({ goneSaid: 'quiet' });
  await render(<ChatScreen />);
  expect(screen.getByText('"quiet" is gone — the room was quiet for a month')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
  expect(mockS.rooms.getState().goneSaid).toBeNull();
});

test('the composer names the channel; the Chat tab pokes the scans and long-polls its room', async () => {
  const poke = jest.spyOn(mockS.rooms.getState(), 'poke');
  mockS.chatChannel.getState().select(A);
  await render(<ChatScreen />);
  expect(screen.getByPlaceholderText('say something in Dev chat')).toBeTruthy();
  expect(poke).toHaveBeenCalled();
  expect(mockS.rooms.getState().focused).toBe(A);
});

test('a reply, an edit or a draft does not follow to another channel', async () => {
  await render(<ChatScreen />);
  await fireEvent.changeText(screen.getByPlaceholderText('say something in Public'), 'half a thought');
  await fireEvent.press(screen.getByRole('tab', { name: 'Dev chat' }));
  expect(screen.getByPlaceholderText('say something in Dev chat').props.value).toBe('');
});

test('a room one scan found gone can still be opened: its own poll decides', async () => {
  mockS.rooms.setState({ gone: { [A]: true } });
  await render(<ChatScreen />);
  await fireEvent.press(screen.getByRole('tab', { name: 'Dev chat' }));
  expect(mockS.chatChannel.getState().current).toBe(A);
});

test('a room param waits for the book and the listing: a room joined already is not joined again', async () => {
  const info = jest.fn(async () => ({ id: A, name: 'Dev chat', listed: false, here: 1, made: 1 }));
  mockS.client.info = info;
  const book = mockS.rooms.getState().book;
  mockS.rooms.setState({ book: { rooms: [], left: {} }, bookRead: false, listed: null });
  mockParams.room = A;
  await render(<ChatScreen />);
  await act(async () => undefined); // the Chat tab's poke brings the listing in: the book is still not read
  expect(info).not.toHaveBeenCalled();
  await act(() => mockS.rooms.setState({ book, bookRead: true }));
  expect(mockS.chatChannel.getState().current).toBe(A);
  expect(info).not.toHaveBeenCalled();
});

test('a listed room asked for before the listing came is read, not joined', async () => {
  mockS.rooms.setState({ listed: null });
  mockParams.room = L;
  await render(<ChatScreen />);
  await act(() => mockS.rooms.setState({ listed: [{ id: L, name: 'governance', here: 4, made: 1 }] }));
  expect(mockS.chatChannel.getState().current).toBe(L);
  expect(mockS.book().rooms.map((r) => r.id)).toEqual([A]);
});

test('with the listing failing, a room param not joined is joined', async () => {
  mockS.client.info = async () => ({ id: X, name: 'party', listed: false, here: 1, made: 1 });
  mockS.rooms.setState({ listed: null, listedError: true });
  mockParams.room = X;
  await render(<ChatScreen />);
  await act(async () => undefined);
  expect(mockS.chatChannel.getState().current).toBe(X);
});
