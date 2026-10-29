import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '@/theme';

/** "Coming soon": gnokey-mobile, in a build that ships without it. */
export function WalletSoon({ title, children }: PropsWithChildren<{ title?: string }>) {
  return (
    <View style={styles.box}>
      <Text style={styles.tag}>Coming soon</Text>
      {title ? <Text style={styles.h}>{title}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#1f1a0d', borderColor: colors.accent, borderWidth: 1, borderRadius: radius.m, padding: space.m, gap: space.s },
  tag: {
    alignSelf: 'flex-start', backgroundColor: colors.accent, color: colors.bg, borderRadius: radius.s - 2, overflow: 'hidden',
    paddingHorizontal: space.s - 2, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase',
  },
  h: { color: colors.fg, fontSize: 17, fontWeight: '700' },
});
