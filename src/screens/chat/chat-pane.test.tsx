import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, KeyboardAvoidingView, Platform, TextInput } from 'react-native';

import type { ChatClient } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import { createIdentityState } from '@/offchain/chat/identity-store';
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

/** The identity the pane shows and the chat writes under, starting as `initial`. */
function idsWith(initial: ChatIdentity) {
  let held = initial;
  const s = createIdentityState({
    client: {} as ChatClient, identity: { load: async () => held, save: async (p) => (held = { ...held, ...p }) },
    kv: { getItem: async () => null, setItem: async () => undefined },
  });
  s.setState({ identity: initial });
  return s;
}
let ids = idsWith(NO_IDENTITY);
beforeEach(() => {
  ids = idsWith(NO_IDENTITY);
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
    client, identity: () => ids.getState().identity,
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  // the loop loads once, then fails and waits forever: settle it before rendering (no update outside act)
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" />);
  expect(screen.getAllByText('hello').length).toBeGreaterThanOrEqual(1); // the line and its pin
  expect(screen.getByText(/🤖/)).toBeTruthy();
  expect(screen.getByText('📎 picture')).toBeTruthy();
  expect(screen.getByText('server unreachable — retrying')).toBeTruthy();
  await act(() => store.getState().stop());
});

test('on Android the pane lifts its content above the keyboard itself (edge-to-edge: the window is not resized)', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  // Test Renderer only renders host elements: read the props the KeyboardAvoidingView class rendered with.
  const kav = jest.spyOn(KeyboardAvoidingView.prototype, 'render');
  const client = { poll: jest.fn().mockRejectedValue(new Error('down')) } as unknown as ChatClient;
  const store = createChatStore({
    client, identity: () => ids.getState().identity,
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" />);
  expect((kav.mock.contexts.at(-1) as KeyboardAvoidingView).props.behavior).toBe('padding');
  kav.mockRestore();
  await act(() => store.getState().stop());
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
  ids = idsWith({ ...NO_IDENTITY, name: 'ann' });
  const store = createChatStore({
    client, identity: () => ids.getState().identity,
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" />);
  await fireEvent(screen.getByText('my line'), 'longPress');
  await fireEvent.press(screen.getByText('Edit'));
  await fireEvent(screen.getByText('his line'), 'longPress');
  await fireEvent.press(screen.getByText('Reply'));
  expect(screen.getByPlaceholderText('say something').props.value).toBe('');
  await fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  await fireEvent.press(screen.getByLabelText('send'));
  await waitFor(() => expect(post).toHaveBeenCalledWith('ann', 'hi', 2));
  expect(edit).not.toHaveBeenCalled();
  await act(() => store.getState().stop());
});

test('a typing update, a new count of people here or a new "you" does not re-render the lines', async () => {
  const client = {
    poll: jest.fn().mockResolvedValueOnce(reply({ msgs: [line(1), line(2), line(3)] })).mockRejectedValue(new Error('down')),
  } as unknown as ChatClient;
  const store = createChatStore({
    client, identity: () => ids.getState().identity,
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" />);
  const before = (splitLinks as jest.Mock).mock.calls.length;
  await act(() => store.setState({ typing: [{ name: 'bob', n: 3 }], here: 9, you: { cc: 'FR', tag: 'aaaa' } }));
  expect((splitLinks as jest.Mock).mock.calls.length).toBe(before);
  await act(() => store.getState().stop());
});

function storeWith(identity: ChatIdentity, msgs = [line(2, { name: 'bob', body: 'his line' })]) {
  const post = jest.fn(async (_n: string, body: string) => line(9, { body }));
  const client = {
    poll: jest.fn().mockResolvedValueOnce(reply({ msgs })).mockRejectedValue(new Error('down')),
    post, typing: jest.fn(async () => undefined),
  } as unknown as ChatClient;
  ids = idsWith(identity);
  const store = createChatStore({
    client, identity: () => ids.getState().identity,
    kv: { getItem: async () => null, setItem: async () => undefined }, sleep: () => new Promise(() => undefined),
  });
  return { store, post };
}

test('Reply puts the cursor in the field', async () => {
  const { store } = storeWith({ ...NO_IDENTITY, name: 'ann' });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" />);
  // The jest preset mocks TextInput as a class whose focus is a jest.fn shared on its prototype.
  const focus = (TextInput as unknown as { prototype: { focus: jest.Mock } }).prototype.focus;
  focus.mockClear();
  await fireEvent(screen.getByText('his line'), 'longPress');
  await fireEvent.press(screen.getByText('Reply'));
  expect(focus).toHaveBeenCalled();
  await act(() => store.getState().stop());
});

test('a line held back for a name goes out once the name is saved and the sheet closed', async () => {
  const { store, post } = storeWith(NO_IDENTITY);
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  const onOpenIdentity = jest.fn();
  const view = await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={onOpenIdentity} />);
  await fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  await fireEvent.press(screen.getByLabelText('send'));
  expect(onOpenIdentity).toHaveBeenCalled();
  await view.rerender(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={onOpenIdentity} identityOpen />);
  expect(post).not.toHaveBeenCalled();
  await act(() => ids.getState().setName('ann'));
  await view.rerender(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={onOpenIdentity} identityOpen={false} />);
  await waitFor(() => expect(post).toHaveBeenCalledWith('ann', 'hi', undefined));
  await act(() => store.getState().stop());
});

test('closing the sheet without a name drops the held-back line', async () => {
  const { store, post } = storeWith(NO_IDENTITY);
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  const view = await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={() => undefined} />);
  await fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  await fireEvent.press(screen.getByLabelText('send'));
  await view.rerender(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen />);
  await view.rerender(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen={false} />);
  await act(() => ids.getState().setName('ann'));
  expect(post).not.toHaveBeenCalled();
  await act(() => store.getState().stop());
});

test('Send without a name, then Reserve: the line waits for the reservation, and goes once the sheet closes', async () => {
  const { store, post } = storeWith(NO_IDENTITY);
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  const view = await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={() => undefined} />);
  await fireEvent.changeText(screen.getByPlaceholderText('say something'), 'hi');
  await fireEvent.press(screen.getByLabelText('send'));
  await view.rerender(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen />);
  await act(() => ids.getState().setName('ann')); // Reserve's first step; its request is still in flight
  expect(post).not.toHaveBeenCalled();
  await act(() => ids.setState({ identity: { ...ids.getState().identity, reservedName: 'ann', nameKey: 'k' } }));
  await view.rerender(<ChatPane store={store} identity={ids} offchainUrl="http://fake" onOpenIdentity={() => undefined} identityOpen={false} />);
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(post).toHaveBeenCalledWith('ann', 'hi', undefined);
  await act(() => store.getState().stop());
});

test('with canModerate the line menu offers Pin and Delete; Delete asks first', async () => {
  const { store } = storeWith({ ...NO_IDENTITY, name: 'ann' });
  const pin = jest.fn(async () => undefined);
  const deleteLine = jest.fn(async () => undefined);
  store.setState({ pin, deleteLine });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  const alert = jest.spyOn(Alert, 'alert');
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" canModerate />);
  await fireEvent(screen.getByText('his line'), 'longPress');
  await fireEvent.press(screen.getByText('Pin'));
  expect(pin).toHaveBeenCalledWith(2, true);
  await fireEvent(screen.getByText('his line'), 'longPress');
  await fireEvent.press(screen.getByText('Delete'));
  expect(deleteLine).not.toHaveBeenCalled();
  // asked in the menu itself: iOS drops an alert raised while the menu closes
  expect(screen.getByText('Delete this line for everyone?')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Delete for everyone' }));
  expect(deleteLine).toHaveBeenCalledWith(2);
  expect(alert).not.toHaveBeenCalled();
  alert.mockRestore();
  await act(() => store.getState().stop());
});

test('a pinned line offers Unpin', async () => {
  const { store } = storeWith({ ...NO_IDENTITY, name: 'ann' }, [line(2, { name: 'bob', body: 'his line', pinned: true })]);
  const pin = jest.fn(async () => undefined);
  store.setState({ pin });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" canModerate />);
  await fireEvent(screen.getAllByText('his line')[0], 'longPress');
  await fireEvent.press(screen.getByText('Unpin'));
  expect(pin).toHaveBeenCalledWith(2, false);
  await act(() => store.getState().stop());
});

test('without the maker key, neither Pin nor Delete shows', async () => {
  const { store } = storeWith({ ...NO_IDENTITY, name: 'ann' });
  store.getState().start();
  await waitFor(() => expect(store.getState().phase).toBe('unreachable'));
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" />);
  await fireEvent(screen.getByText('his line'), 'longPress');
  expect(screen.queryByText('Pin')).toBeNull();
  expect(screen.queryByText('Delete')).toBeNull();
  await act(() => store.getState().stop());
});

test('the composer\'s placeholder is the one given', async () => {
  const { store } = storeWith({ ...NO_IDENTITY, name: 'ann' });
  await render(<ChatPane store={store} identity={ids} offchainUrl="http://fake" placeholder="say something in Dev chat" />);
  expect(screen.getByPlaceholderText('say something in Dev chat')).toBeTruthy();
});
