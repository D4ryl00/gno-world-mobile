import { render } from '@testing-library/react-native';
import { KeyboardAvoidingView, Platform, Text } from 'react-native';

import { MenuSheet } from '@/screens/rooms/menu-sheet';

// Rename and Invite… type in this sheet: found on the Android emulator, the keyboard covered it
test('the sheet rises above the keyboard (on Android too: edge-to-edge keeps the window full size)', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  // Test Renderer only renders host elements: read the props the KeyboardAvoidingView class rendered with.
  const kav = jest.spyOn(KeyboardAvoidingView.prototype, 'render');
  await render(<MenuSheet items={[]} visible onClose={() => undefined}><Text>a form</Text></MenuSheet>);
  expect((kav.mock.contexts.at(-1) as KeyboardAvoidingView | undefined)?.props.behavior).toBe('padding');
  kav.mockRestore();
  os.restore();
});
