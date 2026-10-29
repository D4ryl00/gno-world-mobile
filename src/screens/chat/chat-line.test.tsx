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

test('read only: no menu, no reacting, no voting; the quoted line still jumps', async () => {
  const [onLongPress, onJump, onReact, onVote] = [jest.fn(), jest.fn(), jest.fn(), jest.fn()];
  const l = line(2, {
    name: 'ann',
    re: { id: 1, name: 'bob', body: 'gm' },
    poll: { q: 'when?', opts: ['now', 'later'], votes: [1, 0] },
    rx: { '❤️': 2 },
  });
  await render(
    <ChatLineRow readOnly line={l} mine={false} now={Date.now()} offchainUrl="http://fake" myReactions={[]} myVote={undefined}
      onLongPress={onLongPress} onJump={onJump} onReact={onReact} onVote={onVote} />,
  );
  await fireEvent(screen.getByText(/^now ·/), 'longPress');
  await fireEvent(screen.getByLabelText(/^ann/), 'accessibilityAction', { nativeEvent: { actionName: 'menu' } });
  // the testing library hands an unhandled long press to the row's own prop, with no line: the menu opens only with one
  expect(onLongPress).not.toHaveBeenCalledWith(l);
  expect(screen.queryAllByRole('button')).toHaveLength(0);
  await fireEvent.press(screen.getByText(/^now ·/));
  await fireEvent.press(screen.getByText('❤️ 2'));
  expect(onVote).not.toHaveBeenCalled();
  expect(onReact).not.toHaveBeenCalled();
  expect(screen.getByLabelText(/^ann/).props.accessibilityActions).toBeUndefined();
  await fireEvent.press(screen.getByText(/^↩ bob/));
  expect(onJump).toHaveBeenCalledWith(1);
});
