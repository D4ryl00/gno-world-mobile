import { act, render, screen } from '@testing-library/react-native';
import { Keyboard, Platform, Text } from 'react-native';

import { Page } from '@/components/page';

function captureKeyboard() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const spy = jest.spyOn(Keyboard, 'addListener').mockImplementation(((ev: string, fn: (e: unknown) => void) => {
    handlers[ev] = fn;
    return { remove: () => undefined };
  }) as never);
  return { handlers, spy };
}

test('on Android the page makes room under its content while the keyboard is up', () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  const kb = captureKeyboard();
  render(<Page style={{}}><Text>field</Text></Page>);
  expect(screen.queryByTestId('keyboard-room')).toBeNull();
  act(() => kb.handlers.keyboardDidShow({ endCoordinates: { height: 300 } }));
  expect(screen.getByTestId('keyboard-room').props.style).toEqual({ height: 300 });
  act(() => kb.handlers.keyboardDidHide({}));
  expect(screen.queryByTestId('keyboard-room')).toBeNull();
  kb.spy.mockRestore();
  os.restore();
});

test('on iOS the scroll view\'s own insets do it: no extra room', () => {
  const os = jest.replaceProperty(Platform, 'OS', 'ios');
  const kb = captureKeyboard();
  render(<Page style={{}}><Text>field</Text></Page>);
  act(() => kb.handlers.keyboardDidShow?.({ endCoordinates: { height: 300 } }));
  expect(screen.queryByTestId('keyboard-room')).toBeNull();
  kb.spy.mockRestore();
  os.restore();
});
