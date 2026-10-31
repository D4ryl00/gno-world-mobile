import { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useHomeChannels, useRooms, useServices } from '@/state/app-services';
import { colors, radius, space } from '@/theme';

/** The rooms Home's chat card may show: the ones joined, then the listed ones; a row adds it or takes it off. */
export function ShowOnHome({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const { rooms, homeChannels } = useServices();
  const book = useRooms((s) => s.book);
  const listed = useRooms((s) => s.listed);
  const listedError = useRooms((s) => s.listedError);
  const tabs = useHomeChannels((s) => s.tabs);
  useEffect(() => {
    if (visible) rooms.getState().poke();
  }, [visible, rooms]);

  const joined = new Set(book.rooms.map((r) => r.id));
  const others = (listed ?? []).filter((r) => !joined.has(r.id));
  const row = (id: string, name: string, here?: number) => {
    const on = tabs.some((t) => t.id === id);
    const toggle = () => (on ? homeChannels.getState().remove(id) : homeChannels.getState().add({ id, name }));
    return (
      <Pressable
        key={id} accessibilityRole="button" accessibilityLabel={`${name}${here === undefined ? '' : `, ${here} here`}`}
        accessibilityState={{ checked: on }} onPress={toggle} style={styles.row}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        {here === undefined ? null : <Text style={styles.muted}>{here ? `${here} here` : 'empty'}</Text>}
        <Text style={on ? styles.on : styles.muted}>{on ? '✓' : '＋'}</Text>
      </Pressable>
    );
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        <Text style={styles.title}>Show on Home</Text>
        <ScrollView>
          <Text style={styles.label}>YOUR ROOMS</Text>
          {book.rooms.map((r) => row(r.id, r.name))}
          <Text style={styles.label}>LISTED ON GNO.WORLD</Text>
          {listedError ? <Text style={styles.muted}>could not be listed right now</Text> : others.map((r) => row(r.id, r.name, r.here))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: '#000a' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: radius.m, borderTopRightRadius: radius.m, padding: space.l,
    paddingBottom: space.xl, maxHeight: '70%', gap: space.s,
  },
  title: { color: colors.fg, fontSize: 16, fontWeight: '700' },
  label: { color: colors.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginTop: space.m },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, borderBottomColor: colors.line, borderBottomWidth: 1 },
  name: { color: colors.fg, flex: 1 },
  muted: { color: colors.muted },
  on: { color: colors.ring },
});
