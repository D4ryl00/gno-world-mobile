import type { PropsWithChildren } from 'react';
import { ScrollView, type StyleProp, type ViewStyle } from 'react-native';

/**
 * A screen's scrolling body when it has fields. With the keyboard up, a tap on a button acts at once (instead of
 * only closing the keyboard), the content can scroll above the keyboard (iOS insets; Android resizes the window),
 * and dragging closes the keyboard.
 */
export function Page({ style, children }: PropsWithChildren<{ style: StyleProp<ViewStyle> }>) {
  return (
    <ScrollView
      contentContainerStyle={style}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets>
      {children}
    </ScrollView>
  );
}
