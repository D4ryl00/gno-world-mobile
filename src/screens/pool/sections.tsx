import { StyleSheet, Text, View } from 'react-native';

import type { Pool } from '@/chain/parse';
import { Card } from '@/components/card';
import { colors, space } from '@/theme';
import { shortAddr } from '@/utils/address';
import { flagEmoji } from '@/utils/flag';
import { gnot, humanDuration } from '@/utils/gnot';

export function Split({ pool }: { pool: Pool }) {
  const lines = [
    ['to earlier boopers', pool.divPaid], ['to inviters', pool.refPaid], ['to the creator', pool.creatorPaid],
    ['to the BUBBLE treasury', pool.treasuryPaid], ['to the winner', pool.winnerPaid], ["to the winner's team", pool.teamPaid],
    ['shared at the close', pool.sharedPaid],
  ].filter(([, v]) => (v as number) > 0) as [string, number][];
  if (!lines.length) return null;
  return (
    <Card>
      <Text style={styles.h}>Where the money went</Text>
      {lines.map(([l, v]) => <Text key={l} style={styles.t}>{gnot(v)} {l}</Text>)}
    </Card>
  );
}

export function History({ pool, me }: { pool: Pool; me: string }) {
  if (!pool.history.length) return null;
  return (
    <Card>
      <Text style={styles.h}>Boops</Text>
      {pool.history.map((b) => (
        <Text key={b.n} style={styles.t}>
          #{b.n} {flagEmoji(b.flag)} {b.bidder === me ? 'you' : shortAddr(b.bidder)} · {gnot(b.price)}
          {b.shot ? ` + shot ${gnot(b.shot)}` : ''} · clock {humanDuration(b.clock)} · pot {gnot(b.pot)}
        </Text>
      ))}
    </Card>
  );
}

export function Roster({ pool, me }: { pool: Pool; me: string }) {
  if (!pool.roster.length) return null;
  return (
    <Card>
      <Text style={styles.h}>Boopers · what they've earned here</Text>
      {[...pool.roster].sort((a, b) => b.earned - a.earned).map((m) => (
        <Text key={m.addr} style={styles.t}>
          {flagEmoji(m.flag)} {m.addr === me ? 'you' : shortAddr(m.addr)} · put in {gnot(m.paid)} · earned {gnot(m.earned)}
        </Text>
      ))}
    </Card>
  );
}

export function Shots({ pool }: { pool: Pool }) {
  if (!pool.shotlog.length) return null;
  return (
    <Card>
      <Text style={styles.h}>Shots at this bubble</Text>
      {pool.shotlog.map((s) => (
        <Text key={s.n} style={styles.t}>
          #{s.n} {shortAddr(s.bidder)} · {gnot(s.paid)} · {(s.bps / 100).toFixed(2)}% ·{' '}
          {!s.resolved ? 'pending' : s.void ? 'void' : s.hit ? 'HIT' : 'miss'}
        </Text>
      ))}
    </Card>
  );
}

export function Rules({ pool }: { pool: Pool }) {
  return (
    <Card>
      <Text style={styles.h}>Rules</Text>
      <Text style={styles.t}>
        Every boop feeds the pot and resets the {humanDuration(pool.window)} clock. The Nth boop costs {gnot(pool.basePrice)}·√N.
        Pay k× the price and your boop's clock is only 1/k of the window (down to a tenth, never under five minutes).
        When the clock runs out, the last booper takes the pot.
        {pool.life ? ` The pool's last day is ${humanDuration(pool.life)} after its first boop.` : ''}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  h: { color: colors.fg, fontWeight: '700', marginBottom: space.xs },
  t: { color: colors.muted },
});

export const SectionGap = () => <View style={{ height: space.m }} />;
