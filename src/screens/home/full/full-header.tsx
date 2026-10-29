import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, space } from '@/theme';

/** Back to where the card was opened; opened cold from a link, there is nothing behind it: Home. */
export function closeFull() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** Room at the bottom of a full-screen card: the home indicator (iOS) or the navigation bar (Android, edge to edge). */
export function useBottomGap(): number {
  return useSafeAreaInsets().bottom + space.m;
}

/** The top of a full-screen card: its name, what it puts on the right, and ✕. */
export function FullHeader({ title, right, onClose = closeFull, sheet = true }: {
  title: string; right?: ReactNode; onClose?(): void;
  /** shown as an iOS sheet, which starts below the status bar; false for a modal over the whole screen */
  sheet?: boolean;
}) {
  const insets = useSafeAreaInsets();
  // Android's modals cover the whole screen
  const top = Platform.OS === 'android' || !sheet ? insets.top : 0;
  return (
    <View style={[styles.head, { paddingTop: top + space.m }]}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.right}>
        {right}
        <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.close}>
          <Text style={styles.x}>✕</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, paddingBottom: space.s },
  title: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.m, flexShrink: 1 },
  close: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  x: { color: colors.muted, fontSize: 13 },
});
