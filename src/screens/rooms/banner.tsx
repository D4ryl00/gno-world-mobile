import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '@/theme';

/** A line over the chat: an invitation, or a room that went; with an action and ×. */
export function Banner({ text, action, onAction, onDismiss }: { text: string; action?: string; onAction?(): void; onDismiss(): void }) {
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>{text}</Text>
      {action ? (
        <Pressable accessibilityRole="button" accessibilityLabel={action} onPress={onAction} hitSlop={8}>
          <Text style={styles.action}>{action}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onDismiss} hitSlop={8}>
        <Text style={styles.x}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row', alignItems: 'center', gap: space.m, marginHorizontal: space.l, marginVertical: space.xs,
    padding: space.s, borderRadius: radius.m, borderWidth: 1, borderColor: colors.accent, backgroundColor: '#2a2100',
  },
  text: { color: colors.fg, flex: 1 },
  action: { color: colors.accent, fontWeight: '600' },
  x: { color: colors.muted, fontSize: 18 },
});
