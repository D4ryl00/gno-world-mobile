import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform, TextInput } from 'react-native';

import type { ChatClient } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { line, reply } from '@/offchain/chat/testing';
import { ChatPane } from '@/screens/chat/chat-pane';
import { splitLinks } from '@/screens/chat/line-model';

jest.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/screens/chat/line-model', () => {
  const actual = jest.requireActual('@/screens/chat/line-model');
  return { ...actual, splitLinks: jest.fn(actual.splitLinks) };
});

test('the screen shows lines, pins, the bot mark, a placeholder and the unreachable banner', async () => {
  const client = {
    poll: jest.fn()
      .mockResolvedValueOnce(reply({
        msgs: [line(1, { name: 'jae', body: 'hello', pinned: true }), line(2, { bot: true, body: 'on it' }),
          line(3, { body: '📷 photo', att: { kind: 'image', url: '/x', name: 'x.png' } })],
        pins: [line(1, { name: 'jae', body: 'hello', pinned: true })], here: 26,
      }))
      .mockRejectedValue(new Error('down')),
  } as unknown as ChatClient;
  const store = createChatStore({
    client, identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  // the loop loads once, then fails and waits forever: settle it before rendering (no update outside act)
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  render(<ChatPane store={store} offchainUrl="http://fake" />);
  expect(screen.getByText('Chat · 26 here')).toBeTruthy();
  expect(screen.getAllByText('hello').length).toBeGreaterThanOrEqual(1); // the line and its pin
  expect(screen.getByText(/🤖/)).toBeTruthy();
  expect(screen.getByText('📎 picture')).toBeTruthy();
  expect(screen.getByText('server unreachable — retrying')).toBeTruthy();
  act(() => store.getState().stop());
});

test('on Android the pane lifts its content above the keyboard itself (edge-to-edge: the window is not resized)', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  const client = { poll: jest.fn().mockRejectedValue(new Error('down')) } as unknown as ChatClient;
  const store = createChatStore({
    client, identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  render(<ChatPane store={store} offchainUrl="http://fake" />);
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
  act(() => store.getState().stop());
  os.restore();
});

test('Reply picked while editing leaves the edit: send posts a reply, and the edited text is not carried over', async () => {
  const t = Math.floor(Date.now() / 1000) - 60;
  const post = jest.fn(async () => line(3, { body: 'hi' }));
  const edit = jest.fn();
  const client = {
    poll: jest.fn()
      .mockResolvedValueOnce(reply({ msgs: [line(1, { t, tag: 'aaaa', body: 'my line' }), line(2, { t, name: 'bob', body: 'his line' })] }))
      .mockRejectedValue(new Error('down')),
    post, edit, typing: jest.fn(async () => undefined),
  } as unknown as ChatClient;
  const store = createChatStore({
    client, identity: { load: async () => ({ ...NO_IDENTITY, name: 'ann' }), save: async () => ({ ...NO_IDENTITY, name: 'ann' }) },
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  render(<ChatPane store={store} offchainUrl="http://fake" />);
  fireEvent(screen.getByText('my line'), 'longPress');
  fireEvent.press(screen.getByText('Edit'));
  fireEvent(screen.getByText('his line'), 'longPress');
  fireEvent.press(screen.getByText('Reply'));
  expect(screen.getByPlaceholderText('say something').props.value).toBe('');
  fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  fireEvent.press(screen.getByLabelText('send'));
  await waitFor(() => expect(post).toHaveBeenCalledWith('ann', 'hi', 2));
  expect(edit).not.toHaveBeenCalled();
  act(() => store.getState().stop());
});

test('a typing update, a new count of people here or a new "you" does not re-render the lines', async () => {
  const client = {
    poll: jest.fn().mockResolvedValueOnce(reply({ msgs: [line(1), line(2), line(3)] })).mockRejectedValue(new Error('down')),
  } as unknown as ChatClient;
  const store = createChatStore({
    client, identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  render(<ChatPane store={store} offchainUrl="http://fake" />);
  const before = (splitLinks as jest.Mock).mock.calls.length;
  act(() => store.setState({ typing: [{ name: 'bob', n: 3 }], here: 9, you: { cc: 'FR', tag: 'aaaa' } }));
  expect(screen.getByText('Chat · 9 here')).toBeTruthy();
  expect((splitLinks as jest.Mock).mock.calls.length).toBe(before);
  act(() => store.getState().stop());
});

function storeWith(identity: ChatIdentity, msgs = [line(2, { name: 'bob', body: 'his line' })]) {
  const post = jest.fn(async (_n: string, body: string) => line(9, { body }));
  const client = {
    poll: jest.fn().mockResolvedValueOnce(reply({ msgs })).mockRejectedValue(new Error('down')),
    post, typing: jest.fn(async () => undefined),
  } as unknown as ChatClient;
  let ident = identity;
  const store = createChatStore({
    client, identity: { load: async () => ident, save: async (p) => (ident = { ...ident, ...p }) },
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  return { store, post };
}

test('Reply puts the cursor in the field', async () => {
  const { store } = storeWith({ ...NO_IDENTITY, name: 'ann' });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  render(<ChatPane store={store} offchainUrl="http://fake" />);
  const focus = screen.UNSAFE_getByType(TextInput).instance.focus as jest.Mock;
  focus.mockClear();
  fireEvent(screen.getByText('his line'), 'longPress');
  fireEvent.press(screen.getByText('Reply'));
  expect(focus).toHaveBeenCalled();
  act(() => store.getState().stop());
});

test('a line held back for a name goes out once the name is saved and the sheet closed', async () => {
  const { store, post } = storeWith(NO_IDENTITY);
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  const onOpenIdentity = jest.fn();
  const view = render(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={onOpenIdentity} />);
  fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  fireEvent.press(screen.getByLabelText('send'));
  expect(onOpenIdentity).toHaveBeenCalled();
  view.rerender(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={onOpenIdentity} identityOpen />);
  expect(post).not.toHaveBeenCalled();
  await act(() => store.getState().setName('ann'));
  view.rerender(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={onOpenIdentity} identityOpen={false} />);
  await waitFor(() => expect(post).toHaveBeenCalledWith('ann', 'hi', undefined));
  act(() => store.getState().stop());
});

test('closing the sheet without a name drops the held-back line', async () => {
  const { store, post } = storeWith(NO_IDENTITY);
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  const view = render(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={() => undefined} />);
  fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  fireEvent.press(screen.getByLabelText('send'));
  view.rerender(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen />);
  view.rerender(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen={false} />);
  await act(() => store.getState().setName('ann'));
  expect(post).not.toHaveBeenCalled();
  act(() => store.getState().stop());
});

test('Send without a name, then Reserve: the line waits for the reservation, and goes once the sheet closes', async () => {
  const { store, post } = storeWith(NO_IDENTITY);
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  const view = render(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={() => undefined} />);
  fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  fireEvent.press(screen.getByLabelText('send'));
  view.rerender(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen />);
  await act(() => store.getState().setName('ann')); // Reserve's first step; its request is still in flight
  expect(post).not.toHaveBeenCalled();
  act(() => store.setState({ identity: { ...store.getState().identity, reservedName: 'ann', nameKey: 'k' } }));
  view.rerender(<ChatPane store={store} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen={false} />);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith('ann', 'hi', undefined);
  act(() => store.getState().stop());
});
