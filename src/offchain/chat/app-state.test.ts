import { followAppState } from '@/offchain/chat/app-state';

test('the chat stops only in the background; "inactive" (Notification Center, a system sheet) keeps it', () => {
  const chat = { start: jest.fn(), stop: jest.fn() };
  followAppState('inactive', chat);
  expect(chat.start).not.toHaveBeenCalled();
  expect(chat.stop).not.toHaveBeenCalled();
  followAppState('background', chat);
  expect(chat.stop).toHaveBeenCalledTimes(1);
  followAppState('active', chat);
  expect(chat.start).toHaveBeenCalledTimes(1);
});
