import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ChatIdentity } from '@/offchain/chat/identity';
import { colors, space } from '@/theme';

/** The Chat tab's top: who is in the channel, the name lines go out under, a new room, the channel's menu. */
export function ChatHeader({ here, me, onOpenIdentity, onAdd, onMenu }: {
  here: number; me: ChatIdentity; onOpenIdentity(): void; onAdd(): void; onMenu(): void;
}) {
  const insets = useSafeAreaInsets();
  const myName = me.reservedName || me.name;
  return (
    <View style={[styles.header, { paddingTop: insets.top + space.s }]}>
      <Text style={styles.title} numberOfLines={1}>Chat · {here} here</Text>
      <View style={styles.right}>
        <Pressable accessibilityRole="button" accessibilityLabel={myName || 'you'} onPress={onOpenIdentity} style={styles.pill}>
          <Text style={styles.pillText} numberOfLines={1}>{myName || 'you'}{me.reservedName ? ' ✓' : ''}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="New room" hitSlop={8} onPress={onAdd}>
          <Text style={styles.icon}>＋</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Channel menu" hitSlop={8} onPress={onMenu}>
          <Text style={styles.icon}>⋯</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, paddingBottom: space.s },
  title: { color: colors.fg, fontSize: 17, fontWeight: '700', flexShrink: 1 },
  // a reserved name of up to 40 characters: the title gives way, the name pill ends with an ellipsis
  right: { flexDirection: 'row', alignItems: 'center', gap: space.m, flexShrink: 1, marginLeft: space.s },
  pill: { borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: space.m, paddingVertical: space.xs, flexShrink: 1 },
  pillText: { color: colors.fg },
  icon: { color: colors.accent, fontSize: 20 },
});
