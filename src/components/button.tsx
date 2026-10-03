import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, space } from '@/theme';

/** `selected` marks the current choice among sibling buttons (a preset). */
export function Button({
  title, onPress, disabled, kind = 'primary', selected,
}: {
  title: string; onPress: () => void; disabled?: boolean; kind?: 'primary' | 'secondary' | 'danger'; selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[kind], selected && styles.selected, (disabled || pressed) && styles.dim]}>
      <Text style={[styles.text, kind === 'primary' && styles.primaryText, selected && styles.selectedText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: space.m, paddingHorizontal: space.l, borderRadius: radius.m, alignItems: 'center', borderWidth: 1 },
  primary: { backgroundColor: colors.ring, borderColor: colors.ring },
  secondary: { backgroundColor: 'transparent', borderColor: colors.line },
  danger: { backgroundColor: 'transparent', borderColor: colors.bad },
  selected: { borderColor: colors.accent },
  selectedText: { color: colors.accent },
  dim: { opacity: 0.5 },
  text: { color: colors.fg, fontWeight: '600' },
  primaryText: { color: '#000' },
});
