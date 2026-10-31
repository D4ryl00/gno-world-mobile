import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';

import { Card } from '@/components/card';
import { useNow } from '@/hooks/use-now';
import { ChannelTabs } from '@/screens/channels/channel-tabs';
import { useHomeTabs } from '@/screens/channels/use-home-tabs';
import { ago, placeholder } from '@/screens/chat/line-model';
import { colors, space } from '@/theme';

import { CARD_HEIGHT } from './layout';

const FIRST = 3; // until the card is measured
const GAP = space.s;

export function ChatCard() {
  const { channels, current, name, store, select } = useHomeTabs();
  // the whole array, sliced here: a selector returning a new array re-renders forever under zustand 5
  const lines = useStore(store, (s) => s.lines);
  const phase = useStore(store, (s) => s.phase);
  const now = useNow(30000);
  const [room, setRoom] = useState(0);
  const [lineHeight, setLineHeight] = useState(0);
  // as many of the newest lines as the card has room for, one kept for the unreachable note
  const fit = room && lineHeight ? Math.floor((room + GAP) / (lineHeight + GAP)) : FIRST;
  const last = lines.slice(-Math.max(1, fit - (phase === 'unreachable' ? 1 : 0)));
  // lines are not kept between launches: until the first poll, an empty list says nothing
  const status =
    phase === 'unreachable'
      ? 'chat unreachable — retrying'
      : last.length
        ? null
        : phase === 'live'
          ? 'nothing said yet'
          : 'loading…';
  // the button's label is all a screen reader says: the lines go in it
  const label = [`Chat, ${name}`, ...last.map((l) => `${l.name}: ${placeholder(l) ?? l.body}, ${ago(l.t, now)}`), status].filter(Boolean).join('. ');
  const open = () => router.navigate('/home/chat');
  // the tabs switch the card; the rest of it opens the chat full screen
  return (
    <Card style={styles.card}>
      <Pressable accessible={false} onPress={open} style={({ pressed }) => [styles.head, pressed && styles.pressed]}>
        <Text style={styles.label}>CHAT</Text>
        <Text style={styles.label}>›</Text>
      </Pressable>
      <View style={styles.tabs}>
        <ChannelTabs channels={channels} current={current} onSelect={select} />
      </View>
      <Pressable
        accessibilityRole="button" accessibilityLabel={label} accessibilityHint="Opens the chat to read" onPress={open}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
        <View testID="chat-card-lines" style={styles.lines} onLayout={(e) => setRoom(e.nativeEvent.layout.height)}>
          {last.map((l, i) => (
            <View
              key={l.id}
              testID="chat-card-line"
              style={styles.line}
              onLayout={i === 0 ? (e) => setLineHeight(e.nativeEvent.layout.height) : undefined}>
              <Text testID="chat-card-name" style={styles.name} numberOfLines={1}>{l.name}</Text>
              <Text style={styles.body1} numberOfLines={1}>{placeholder(l) ?? l.body}</Text>
              <Text style={styles.age}>{ago(l.t, now)}</Text>
            </View>
          ))}
          {status && <Text style={styles.age}>{status}</Text>}
        </View>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  card: { height: CARD_HEIGHT },
  head: { flexDirection: 'row', justifyContent: 'space-between' },
  // the row runs to the card's edges
  tabs: { marginHorizontal: -space.l },
  body: { flex: 1 },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  lines: { flex: 1, gap: GAP, overflow: 'hidden' },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: space.s },
  body1: { color: colors.fg, flex: 1 },
  name: { color: colors.accent, fontWeight: '600', maxWidth: '40%' },
  age: { color: colors.muted, fontSize: 11 },
});
