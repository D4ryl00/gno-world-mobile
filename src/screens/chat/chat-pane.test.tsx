import { act, render, screen, waitFor } from '@testing-library/react-native';

import type { ChatClient } from '@/offchain/chat/client';
import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { line, reply } from '@/offchain/chat/testing';
import { ChatPane } from '@/screens/chat/chat-pane';

jest.mock('expo-router', () => ({ useFocusEffect: () => undefined }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

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
