import type { PropsWithChildren } from 'react';
import { Platform, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';

import { useKeyboardHeight } from '@/hooks/use-keyboard-height';

/**
 * A screen's scrolling body when it has fields. With the keyboard up, a tap on a button acts at once (instead of
 * only closing the keyboard), the content can scroll above the keyboard (iOS: the scroll view's insets; Android,
 * edge-to-edge: the window keeps its size, so room the keyboard's height is added under the content), and dragging
 * closes the keyboard.
 */
export function Page({ style, children }: PropsWithChildren<{ style: StyleProp<ViewStyle> }>) {
  const keyboard = useKeyboardHeight();
  return (
    <ScrollView
      contentContainerStyle={style}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets>
      {children}
      {Platform.OS === 'android' && keyboard > 0 ? <View testID="keyboard-room" style={{ height: keyboard }} /> : null}
    </ScrollView>
  );
}
