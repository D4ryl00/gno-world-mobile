import { useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { Card } from '@/components/card';
import type { Where } from '@/offchain/home';
import { colors, space } from '@/theme';
import { flagEmoji } from '@/utils/flag';

import { hereRows, hereText, type HereRow } from './format';
import { CARD_HEIGHT } from './layout';
import { OpenButton } from './open-button';

export function HereCard({ data, failed, onOpen }: { data: Where | null; failed: boolean; onOpen?(): void }) {
  const rows = data ? hereRows(data) : [];
  const list = useRef<ScrollViewInstance>(null);
  return (
    <Card style={styles.card}>
      {/* a tap on the header or the rows opens it full screen; the press areas sit inside the list, so a drag still
          scrolls it, and they are not accessible elements, so the rows stay readable one by one */}
      <Pressable accessible={false} onPress={onOpen} style={({ pressed }) => [styles.head, pressed && styles.pressed]}>
        <Text style={styles.label}>HERE NOW</Text>
        <View style={styles.right}>
          {data && <Text style={styles.total}>{hereText(data)}</Text>}
          <OpenButton label="Open Here Now full screen" onPress={onOpen} />
        </View>
      </Pressable>
      {/* a long table scrolls within the card (Android scrolls a list inside the page only when told); a flash of the bar says there is more */}
      <ScrollView
        ref={list}
        testID="here-rows"
        style={styles.rows}
        contentContainerStyle={styles.rowsGrow}
        nestedScrollEnabled
        onContentSizeChange={() => list.current?.flashScrollIndicators()}>
        <Pressable testID="here-rows-press" accessible={false} onPress={onOpen} style={({ pressed }) => [styles.rowsIn, pressed && styles.pressed]}>
          {rows.map((r) => (
            <CountryRow key={r.cc || r.name} row={r} />
          ))}
          {data && !rows.length && <Text style={styles.muted}>nobody yet</Text>}
          {!data && !failed && <Text style={styles.muted}>loading…</Text>}
          {failed && <Text style={styles.muted}>{data ? 'could not refresh — trying again' : 'server unreachable — trying again'}</Text>}
        </Pressable>
      </ScrollView>
    </Card>
  );
}

/** A line of the table; with `total`, each line also says its share of everyone here. */
export function CountryRow({ row, total }: { row: HereRow; total?: number }) {
  return (
    <View style={styles.row}>
      <Text style={styles.flag}>{row.cc ? flagEmoji(row.cc) : '·'}</Text>
      <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
      <View style={styles.barBox}>{row.share !== null && <View style={[styles.bar, { width: `${Math.round(row.share * 100)}%` }]} />}</View>
      <Text style={styles.n}>{row.n}</Text>
      {total ? <Text style={styles.pc}>{Math.round((row.n / total) * 100)}%</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { height: CARD_HEIGHT },
  pressed: { opacity: 0.7 },
  right: { flexDirection: 'row', alignItems: 'center', gap: space.s, flexShrink: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  total: { color: colors.fg, flexShrink: 1, textAlign: 'right' },
  rows: { flex: 1 },
  // the press area fills the list, so the room under a short table opens the card too
  rowsGrow: { flexGrow: 1 },
  rowsIn: { flexGrow: 1, gap: space.s, paddingRight: space.s }, // the scroll bar clear of the counts
  row: { flexDirection: 'row', alignItems: 'center', gap: space.s },
  flag: { width: 22, textAlign: 'center', color: colors.muted },
  name: { color: colors.fg, width: 110 },
  barBox: { flex: 1 },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.accent },
  n: { color: colors.muted, minWidth: 24, textAlign: 'right', fontVariant: ['tabular-nums'] },
  pc: { color: colors.muted, fontSize: 12, minWidth: 36, textAlign: 'right', fontVariant: ['tabular-nums'] },
  muted: { color: colors.muted, fontSize: 12 },
});
