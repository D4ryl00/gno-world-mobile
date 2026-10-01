import { StyleSheet, Text, TextInput, View, type KeyboardTypeOptions } from 'react-native';

import { colors, radius, space } from '@/theme';

export function Field({
  label, value, onChangeText, placeholder, keyboardType, error,
}: { label: string; value: string; onChangeText: (s: string) => void; placeholder?: string; keyboardType?: KeyboardTypeOptions; error?: string | null }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input} value={value} onChangeText={onChangeText} placeholder={placeholder}
        placeholderTextColor={colors.muted} keyboardType={keyboardType} autoCapitalize="none" autoCorrect={false}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.muted, fontSize: 12 },
  input: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.m },
  error: { color: colors.bad, fontSize: 12 },
});
