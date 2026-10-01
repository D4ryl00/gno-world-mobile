import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, space } from '@/theme';

export function Button({
  title, onPress, disabled, kind = 'primary',
}: { title: string; onPress: () => void; disabled?: boolean; kind?: 'primary' | 'secondary' | 'danger' }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.base, styles[kind], (disabled || pressed) && styles.dim]}>
      <Text style={[styles.text, kind === 'primary' && styles.primaryText]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: space.m, paddingHorizontal: space.l, borderRadius: radius.m, alignItems: 'center', borderWidth: 1 },
  primary: { backgroundColor: colors.ring, borderColor: colors.ring },
  secondary: { backgroundColor: 'transparent', borderColor: colors.line },
  danger: { backgroundColor: 'transparent', borderColor: colors.bad },
  dim: { opacity: 0.5 },
  text: { color: colors.fg, fontWeight: '600' },
  primaryText: { color: '#000' },
});
