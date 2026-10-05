import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import type { ChatClient } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { OffchainError } from '@/offchain/http';
import { IdentitySheet } from '@/screens/chat/identity-sheet';

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: null })),
}));

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
