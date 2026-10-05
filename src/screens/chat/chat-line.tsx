import * as Linking from 'expo-linking';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { avatarUrl } from '@/offchain/chat/client';
import type { ChatLine } from '@/offchain/chat/types';
import { colors, radius, space } from '@/theme';
import { flagEmoji } from '@/utils/flag';

import { ago, placeholder, pollBars, rxWho, splitLinks } from './line-model';

export function ChatLineRow({ line, mine, now, offchainUrl, myReactions, myVote, onLongPress, onJump, onReact, onVote }: {
  line: ChatLine; mine: boolean; now: number; offchainUrl: string; myReactions: string[]; myVote: number | undefined;
  onLongPress: () => void; onJump: (id: number) => void; onReact: (emoji: string) => void; onVote: (opt: number) => void;
}) {
  const extra = placeholder(line);
  const [who, setWho] = useState<string | null>(null);
  const poll = line.poll ? pollBars(line.poll, myVote) : null;
  return (
    // not one accessible element: poll options, reactions and links stay reachable on their own
    <Pressable onLongPress={onLongPress} delayLongPress={300} accessible={false} style={[styles.row, mine && styles.mine]}>
      {line.av ? <Image source={{ uri: avatarUrl(offchainUrl, line.av) }} style={styles.av} /> : <View style={styles.av} />}
      <View style={styles.main}>
        <Text style={styles.who} numberOfLines={1}>
          {line.bot ? '🤖' : flagEmoji(line.cc)} <Text style={styles.name}>{line.name}</Text>
          {line.reserved ? <Text style={styles.check}> ✓</Text> : null}
          <Text style={styles.meta}> ·{line.tag} {ago(line.t, now)}{line.edited ? ' · edited' : ''}</Text>
        </Text>
        {line.re ? (
          <Pressable onPress={() => onJump(line.re!.id)}>
            <Text style={styles.quote} numberOfLines={2}>↩ {line.re.name} {line.re.body || 'a line since removed'}</Text>
          </Pressable>
        ) : null}
        {poll ? (
          <View style={styles.poll}>
            <Text style={styles.body}>📊 {line.poll!.q}</Text>
            {poll.bars.map((b, i) => (
              <Pressable key={i} accessibilityRole="button" onPress={() => onVote(i)} style={[styles.opt, b.mine && styles.optMine]}>
                <View style={[styles.optFill, { width: `${b.pct}%` }]} />
                <Text style={styles.optText}>{b.label} · {b.count}{poll.total ? ` · ${b.pct}%` : ''}</Text>
              </Pressable>
            ))}
            <Text style={styles.meta}>{poll.total} vote{poll.total === 1 ? '' : 's'}</Text>
          </View>
        ) : (
          <Text style={styles.body}>
            {splitLinks(line.body).map((p, i) =>
              p.url ? <Text key={i} style={styles.link} onPress={() => void Linking.openURL(p.url!)}>{p.text}</Text> : p.text)}
          </Text>
        )}
        {extra ? <Text style={styles.meta}>{extra}</Text> : null}
        {Object.keys(line.rx).length ? (
          <View style={styles.rxRow}>
            {Object.entries(line.rx).map(([e, n]) => (
              <Pressable key={e} accessibilityRole="button" accessibilityLabel={`${e} ${n}${rxWho(line, e) ? `, ${rxWho(line, e)}` : ''}`}
                accessibilityHint="hold to see who" onPress={() => onReact(e)} onLongPress={() => setWho(who === e ? null : e)}
                style={[styles.rx, myReactions.includes(e) && styles.rxMine]}>
                <Text style={styles.rxText}>{e} {n}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {who && rxWho(line, who) ? <Text style={styles.meta}>{who} {rxWho(line, who)}</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.s, paddingHorizontal: space.l, paddingVertical: space.s },
  mine: { backgroundColor: colors.card },
  av: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.line },
  main: { flex: 1, gap: 2 },
  who: { color: colors.muted, fontSize: 12 },
  name: { color: colors.fg, fontWeight: '600' },
  check: { color: colors.ring },
  meta: { color: colors.muted, fontSize: 12 },
  quote: { color: colors.muted, fontSize: 12, borderLeftColor: colors.line, borderLeftWidth: 2, paddingLeft: space.s },
  body: { color: colors.fg },
  link: { color: colors.idle, textDecorationLine: 'underline' },
  poll: { gap: space.xs },
  opt: { borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, overflow: 'hidden' },
  optMine: { borderColor: colors.accent },
  optFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.line },
  optText: { color: colors.fg, padding: space.s },
  rxRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  rx: { borderColor: colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: space.s, paddingVertical: 2 },
  rxMine: { borderColor: colors.accent },
  rxText: { color: colors.fg },
});
