import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChatLine } from '@/offchain/chat/types';
import { colors, space } from '@/theme';

export function Pins({ pins, onJump }: { pins: ChatLine[]; onJump: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  if (!pins.length) return null;
  const shown = open ? pins : pins.slice(0, 1);
  return (
    <View style={styles.box}>
      {shown.map((p) => (
        <Pressable key={p.id} onPress={() => onJump(p.id)}>
          <Text style={styles.pin} numberOfLines={open ? 4 : 1}>📌 {p.name}: {p.body}</Text>
        </Pressable>
      ))}
      {pins.length > 1 ? (
        <Pressable accessibilityRole="button" onPress={() => setOpen(!open)}>
          <Text style={styles.more}>{open ? 'fewer' : `${pins.length - 1} more pinned`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderBottomColor: colors.line, borderBottomWidth: 1, paddingHorizontal: space.l, paddingVertical: space.xs, gap: space.xs },
  pin: { color: colors.fg },
  more: { color: colors.muted, fontSize: 12 },
});
