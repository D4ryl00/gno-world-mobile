import { fireEvent, render, screen } from '@testing-library/react-native';

import { line } from '@/offchain/chat/testing';
import { ChatLineRow } from '@/screens/chat/chat-line';

test('holding a reaction shows who reacted', async () => {
  const l = line(1, { rx: { '❤️': 2 }, rxwho: { '❤️': ['ann', 'bob'] } });
  await render(
    <ChatLineRow line={l} mine={false} now={Date.now()} offchainUrl="http://fake" myReactions={[]} myVote={undefined}
      onLongPress={jest.fn()} onJump={jest.fn()} onReact={jest.fn()} onVote={jest.fn()} />,
  );
  expect(screen.queryByText('❤️ ann, bob')).toBeNull();
  await fireEvent(screen.getByText('❤️ 2'), 'longPress');
  expect(screen.getByText('❤️ ann, bob')).toBeTruthy();
});

test('the line menu is an accessibility action on the name', async () => {
  const onLongPress = jest.fn();
  const l = line(1, { name: 'ann' });
  await render(
    <ChatLineRow line={l} mine={false} now={Date.now()} offchainUrl="http://fake" myReactions={[]} myVote={undefined}
      onLongPress={onLongPress} onJump={jest.fn()} onReact={jest.fn()} onVote={jest.fn()} />,
  );
  await fireEvent(screen.getByLabelText(/^ann/), 'accessibilityAction', { nativeEvent: { actionName: 'menu' } });
  expect(onLongPress).toHaveBeenCalledWith(l);
});
