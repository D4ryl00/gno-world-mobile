import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { fetchWhere, WHERE_EVERY_MS } from '@/offchain/home';
import { useServices } from '@/state/app-services';
import { colors, space } from '@/theme';

import { hereRows, hereText } from '../format';
import { CountryRow } from '../here-card';
import { usePoll } from '../use-poll';
import { FullHeader, useBottomGap } from './full-header';
import { WorldMap } from './world-map';

export function HereFull() {
  const { offchain } = useServices();
  const where = usePoll(() => fetchWhere(offchain), WHERE_EVERY_MS);
  const width = useWindowDimensions().width - 2 * space.l;
  const bottom = useBottomGap();
  const w = where.data;
  const rows = w ? hereRows(w) : [];
  return (
    <View style={styles.root}>
      <FullHeader title="HERE NOW" right={w && <Text style={styles.total}>{hereText(w)}</Text>} />
      <ScrollView testID="here-full-list" contentContainerStyle={[styles.body, { paddingBottom: bottom }]}>
        {/* without geo the server places nobody: the land alone */}
        <WorldMap width={width} spots={w?.geo ? w.spots : []} />
        <Text style={styles.muted}>{!w || w.geo ? 'a dot per place, about 25 km precise' : 'countries unavailable on this build'}</Text>
        {rows.map((r) => (
          <CountryRow key={r.cc || r.name} row={r} total={w?.count} />
        ))}
        {w && !rows.length && <Text style={styles.muted}>nobody yet</Text>}
        {!w && !where.failed && <Text style={styles.muted}>loading…</Text>}
        {where.failed && <Text style={styles.muted}>{w ? 'could not refresh — trying again' : 'server unreachable — trying again'}</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  total: { color: colors.fg, flexShrink: 1, textAlign: 'right' },
  body: { paddingHorizontal: space.l, gap: space.s },
  muted: { color: colors.muted, fontSize: 12 },
});
