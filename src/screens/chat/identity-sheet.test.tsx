import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform } from 'react-native';

import type { ChatClient } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { OffchainError } from '@/offchain/http';
import { IdentitySheet } from '@/screens/chat/identity-sheet';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));
jest.mock('@/screens/chat/avatar', () => ({ avatarJpeg: jest.fn(async () => new Uint8Array([1, 2, 3])) }));

function make(identity: ChatIdentity, client: Partial<ChatClient> = {}) {
  let ident = identity;
  const store = createChatStore({
    client: client as ChatClient,
    identity: { load: async () => ident, save: async (p) => (ident = { ...ident, ...p }) },
    kv: { getItem: async () => null, setItem: async () => undefined },
  });
  return store;
}

test('a free name is saved; reserving needs a session', async () => {
  const store = make(NO_IDENTITY);
  await store.ready;
  render(<IdentitySheet store={store} visible onClose={() => undefined} offchainUrl="http://fake" canReserve={false} />);
  fireEvent.changeText(screen.getByLabelText('name'), 'ann');
  fireEvent.press(screen.getByText('Save name'));
  await waitFor(() => expect(store.getState().identity.name).toBe('ann'));
  expect(screen.getByText(/Reserving needs a session/)).toBeTruthy();
});

test('reserving shows the mark, and the server\'s refusal as is', async () => {
  const reserveName = jest.fn()
    .mockRejectedValueOnce(new OffchainError(403, 'boop once from this app first'))
    .mockResolvedValueOnce({ name: 'ann', key: 'k', addr: 'g1x' });
  const store = make({ ...NO_IDENTITY, name: 'ann' }, { reserveName } as Partial<ChatClient>);
  await store.ready;
  render(<IdentitySheet store={store} visible onClose={() => undefined} offchainUrl="http://fake" canReserve />);
  fireEvent.press(screen.getByText('Reserve this name'));
  expect(await screen.findByText('boop once from this app first')).toBeTruthy();
  fireEvent.press(screen.getByText('Reserve this name'));
  expect(await screen.findByText('✓ yours')).toBeTruthy();
  expect(screen.getByText('Release')).toBeTruthy();
});

test('on Android the sheet rises above the keyboard itself (edge-to-edge: the window is not resized)', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  const store = make(NO_IDENTITY);
  await store.ready;
  render(<IdentitySheet store={store} visible onClose={() => undefined} offchainUrl="http://fake" canReserve={false} />);
  expect(screen.UNSAFE_getByType(KeyboardAvoidingView).props.behavior).toBe('padding');
  os.restore();
});

test('the library opens without asking for photo access (a refusal does not block the picker)', async () => {
  const picker = jest.requireMock('expo-image-picker');
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });
  picker.launchImageLibraryAsync.mockClear();
  const store = make(NO_IDENTITY);
  await store.ready;
  render(<IdentitySheet store={store} visible onClose={() => undefined} offchainUrl="http://fake" canReserve={false} />);
  fireEvent.press(screen.getByText('Choose a photo'));
  await waitFor(() => expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(1));
});

test('a picker that fails says so and leaves the sheet usable', async () => {
  const picker = jest.requireMock('expo-image-picker');
  picker.launchImageLibraryAsync.mockReset();
  picker.launchImageLibraryAsync.mockRejectedValueOnce(new Error('iCloud said no')).mockResolvedValue({ canceled: true, assets: null });
  const store = make(NO_IDENTITY);
  await store.ready;
  render(<IdentitySheet store={store} visible onClose={() => undefined} offchainUrl="http://fake" canReserve={false} />);
  fireEvent.press(screen.getByText('Choose a photo'));
  expect(await screen.findByText('That picture could not be read — try another one.')).toBeTruthy();
  fireEvent.press(screen.getByText('Choose a photo'));
  await waitFor(() => expect(picker.launchImageLibraryAsync).toHaveBeenCalledTimes(2));
});

test('the sheet shows its own error, not the composer\'s, and closing it clears its own', async () => {
  const store = make(NO_IDENTITY);
  await store.ready;
  store.setState({ error: 'the composer\'s trouble', identityError: 'the sheet\'s trouble' });
  const onClose = jest.fn();
  render(<IdentitySheet store={store} visible onClose={onClose} offchainUrl="http://fake" canReserve={false} />);
  expect(screen.getByText('the sheet\'s trouble')).toBeTruthy();
  expect(screen.queryByText('the composer\'s trouble')).toBeNull();
  fireEvent.press(screen.getByText('Done'));
  expect(onClose).toHaveBeenCalled();
  expect(store.getState().identityError).toBe('');
});

test('"anon" is proposed and can be saved as is', async () => {
  const store = make(NO_IDENTITY);
  await store.ready;
  render(<IdentitySheet store={store} visible onClose={() => undefined} offchainUrl="http://fake" canReserve={false} />);
  expect(screen.getByLabelText('name').props.value).toBe('anon');
  fireEvent.press(screen.getByText('Save name'));
  await waitFor(() => expect(store.getState().identity.name).toBe('anon'));
});

test('a picked photo is sent as the small JPEG', async () => {
  const picker = jest.requireMock('expo-image-picker');
  picker.launchImageLibraryAsync.mockReset();
  picker.launchImageLibraryAsync.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///p.jpg', mimeType: 'image/heic' }] });
  const uploadAvatar = jest.fn(async () => ({ id: 'abcdefgh', key: 'k' }));
  const store = make(NO_IDENTITY, { uploadAvatar } as Partial<ChatClient>);
  await store.ready;
  render(<IdentitySheet store={store} visible onClose={() => undefined} offchainUrl="http://fake" canReserve={false} />);
  fireEvent.press(screen.getByText('Choose a photo'));
  await waitFor(() => expect(uploadAvatar).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), 'image/jpeg'));
});
