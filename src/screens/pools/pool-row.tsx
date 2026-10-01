import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Pool } from '@/chain/parse';
import { Countdown } from '@/components/countdown';
import { colors, radius, space } from '@/theme';
import { shortAddr } from '@/utils/address';
import { flagEmoji } from '@/utils/flag';
import { gnot } from '@/utils/gnot';

export function PoolRow({ pool }: { pool: Pool }) {
  const status = pool.cancelled
    ? 'cancelled'
    : pool.popped
      ? `popped by ${shortAddr(pool.lastBidder)}`
      : pool.over
        ? `won by ${shortAddr(pool.lastBidder)}${pool.paid ? '' : ' (unclaimed)'}`
        : pool.bids === 0
          ? 'no boops yet'
          : `${flagEmoji(pool.flag)} ${shortAddr(pool.lastBidder)} on top`;
  return (
    <Link href={`/pool/${pool.key}`} asChild>
      <Pressable style={styles.row}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>{pool.name}</Text>
          <Text style={styles.badge}>v{pool.version}</Text>
        </View>
        <Text style={styles.pot}>{gnot(pool.pot)}</Text>
        <Text style={styles.meta}>{status}</Text>
        {!pool.over && !pool.cancelled && pool.bids > 0 ? <Countdown until={pool.deadline} /> : null}
        {!pool.over && !pool.cancelled ? <Text style={styles.meta}>next boop {gnot(pool.nextPrice)}</Text> : null}
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  row: { backgroundColor: colors.card, borderColor: colors.line, borderWidth: 1, borderRadius: radius.m, padding: space.l, gap: space.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', gap: space.s },
  name: { color: colors.fg, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  badge: { color: colors.muted, fontSize: 12 },
  pot: { color: colors.accent, fontSize: 20, fontWeight: '800' },
  meta: { color: colors.muted },
});
