import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { NO_IDENTITY } from '@/offchain/chat/identity';
import { ChatHeader } from '@/screens/chat/chat-header';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const noop = () => undefined;

test('who is here, the name pill, ＋ and ⋯', async () => {
  const [onOpenIdentity, onAdd, onMenu] = [jest.fn(), jest.fn(), jest.fn()];
  await render(<ChatHeader here={26} me={{ ...NO_IDENTITY, name: 'ann' }} onOpenIdentity={onOpenIdentity} onAdd={onAdd} onMenu={onMenu} />);
  expect(screen.getByText('Chat · 26 here')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'ann' }));
  await fireEvent.press(screen.getByRole('button', { name: 'New room' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Channel menu' }));
  expect([onOpenIdentity, onAdd, onMenu].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
});

test('a long reserved name stays on one line and the title gives way', async () => {
  const long = 'n'.repeat(40);
  await render(<ChatHeader here={1} me={{ ...NO_IDENTITY, name: long, reservedName: long }} onOpenIdentity={noop} onAdd={noop} onMenu={noop} />);
  expect(screen.getByText(`${long} ✓`).props.numberOfLines).toBe(1);
  const title = screen.getByText(/^Chat · /);
  expect(title.props.numberOfLines).toBe(1);
  expect(StyleSheet.flatten(title.props.style)).toMatchObject({ flexShrink: 1 });
});
