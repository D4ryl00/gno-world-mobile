import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@/theme';

/** The › in a card's header: opens the card full screen (the card itself also does, for a finger). */
export function OpenButton({ label, onPress }: { label: string; onPress?(): void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={onPress}>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chevron: { color: colors.muted, fontSize: 16, fontWeight: '600', paddingHorizontal: 2 },
});
