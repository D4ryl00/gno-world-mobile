import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { NO_IDENTITY } from '@/offchain/chat/identity';
import { createChatStore } from '@/offchain/chat/store';
import { ChatScreen } from '@/screens/chat';

const mockParams: { identity?: string } = {};
let mockChat: ReturnType<typeof createChatStore>;

jest.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  useLocalSearchParams: () => mockParams,
  router: { setParams: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/state/app-services', () => ({
  useServices: () => ({ chat: mockChat }),
  useSession: <T,>(sel: (s: { active: null }) => T) => sel({ active: null }),
}));

beforeEach(async () => {
  mockChat = createChatStore({
    client: {} as never,
    identity: { load: async () => NO_IDENTITY, save: async () => NO_IDENTITY },
    kv: { getItem: async () => null, setItem: async () => undefined },
  });
  await mockChat.ready;
});

// Back from the wallet, the answer to a proof (a name reserved, or refused) is
// on the name sheet: the callback asks for it, whatever the screen kept.
test('the chat opens on the name sheet when asked to', async () => {
  mockParams.identity = '1';
  await render(<ChatScreen />);
  expect(screen.getByLabelText('name')).toBeTruthy();
});

test('the chat opens without the name sheet otherwise', async () => {
  delete mockParams.identity;
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
