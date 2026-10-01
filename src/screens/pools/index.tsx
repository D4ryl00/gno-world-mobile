import { router, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';

import type { AllPools } from '@/chain/game-client';
import type { Teams } from '@/chain/parse';
import { Button } from '@/components/button';
import { useNow } from '@/hooks/use-now';
import { isPlayBlocked, NOPLAY_TEXT, usePresence } from '@/offchain/presence';
import { useServices } from '@/state/app-services';
import { colors, space } from '@/theme';
import { flagEmoji } from '@/utils/flag';
import { gnot } from '@/utils/gnot';

import { PoolRow } from './pool-row';
import { sortPools } from './sort';

export function PoolsScreen() {
  const { game } = useServices();
  const now = useNow(5000);
  const blocked = usePresence((s) => isPlayBlocked(s.country));
  const [data, setData] = useState<AllPools | null>(null);
  const [teams, setTeams] = useState<Teams>({});
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [all, t] = await Promise.all([game.allPools(), game.teams().catch(() => ({}))]);
      setData(all);
      setTeams(t);
      setError(all.pools.length === 0 && all.failed.length ? 'the node did not answer' : '');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  }, [game]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const { live, closed } = sortPools(data?.pools ?? [], now);
  const topTeams = Object.entries(teams).sort(([, a], [, b]) => b.won - a.won || b.paid - a.paid).slice(0, 10);

  return (
    <SectionList
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl tintColor={colors.fg} refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={
        <View style={{ gap: space.m }}>
          <Text style={styles.lede}>Last boop standing takes the pot. Every boop resets the clock.</Text>
          {blocked ? <Text style={styles.warn}>{NOPLAY_TEXT}</Text> : <Button title="New pool" onPress={() => router.push('/create' as Href)} />}
          {error ? <Text style={styles.warn}>{error}</Text> : null}
        </View>
      }
      sections={[
        { title: 'Live', data: live },
        { title: 'Closed', data: closed.slice(0, 30) },
      ]}
      keyExtractor={(p) => p.key}
      renderSectionHeader={({ section }) => <Text style={styles.h}>{section.title}</Text>}
      renderItem={({ item }) => <PoolRow pool={item} />}
      ItemSeparatorComponent={() => <View style={{ height: space.s }} />}
      ListFooterComponent={
        topTeams.length ? (
          <View style={{ gap: space.xs, marginTop: space.l }}>
            <Text style={styles.h}>Teams</Text>
            {topTeams.map(([cc, t]) => (
              <Text key={cc} style={styles.team}>
                {flagEmoji(cc)} {cc} · won {gnot(t.won)} · played {gnot(t.paid)} · {t.players} players
              </Text>
            ))}
          </View>
        ) : null
      }
    />
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.s },
  lede: { color: colors.muted },
  h: { color: colors.fg, fontSize: 18, fontWeight: '800', marginTop: space.l, marginBottom: space.s },
  warn: { color: colors.accent },
  team: { color: colors.fg },
});
