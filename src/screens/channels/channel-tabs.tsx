import { Fragment, useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { colors, space } from '@/theme';

/** A channel in a row of tabs: Public (id '') or a room. */
export interface Channel {
  id: string;
  name: string;
  /** the app holds the room's maker key */
  keyed?: boolean;
  unread?: number;
}

/** The row of channels over a chat: one pill each, the current one marked. */
export function ChannelTabs({ channels, current, onSelect, separatorAfter, onAdd, onLongPress }: {
  channels: Channel[]; current: string; onSelect(id: string): void;
  /** the divider goes after this index: rooms joined, then rooms listed */
  separatorAfter?: number;
  onAdd?(): void;
  /** never for Public, which stays */
  onLongPress?(id: string): void;
}) {
  const scroll = useRef<ScrollViewInstance>(null);
  const xs = useRef<Record<string, number>>({});
  const show = (x: number) => scroll.current?.scrollTo({ x: Math.max(0, x - space.l), animated: true });
  // the current pill stays in view when it changes from elsewhere (a link, Write in …)
  useEffect(() => {
    const x = xs.current[current];
    if (x !== undefined) show(x);
  }, [current]);
  return (
    <ScrollView testID="channel-tabs" ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} style={styles.bar}>
      {channels.map((c, i) => {
        const on = c.id === current;
        const label = `${c.name}${c.unread ? `, ${c.unread} unread` : ''}`;
        return (
          <Fragment key={c.id || 'public'}>
            <Pressable
              accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: on }}
              onPress={() => onSelect(c.id)}
              onLongPress={() => (c.id ? onLongPress?.(c.id) : undefined)}
              onLayout={(e) => {
                const { x } = e.nativeEvent.layout;
                // the first time it is measured (a cold start on a room far along the row)
                if (on && xs.current[c.id] === undefined) show(x);
                xs.current[c.id] = x;
              }}
              style={[styles.pill, on && styles.on]}>
              <Text style={[styles.name, on && styles.onText]} numberOfLines={1}>{c.keyed ? `🔑 ${c.name}` : c.name}</Text>
              {c.unread ? <Text style={styles.badge}>{c.unread > 99 ? '99+' : c.unread}</Text> : null}
            </Pressable>
            {separatorAfter === i && i < channels.length - 1 ? <View testID="channel-separator" style={styles.sep} /> : null}
          </Fragment>
        );
      })}
      {onAdd ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Add a channel" onPress={onAdd} style={[styles.pill, styles.add]}>
          <Text style={styles.onText}>＋</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // a list under it takes the rest of the column; the row never shrinks
  bar: { flexGrow: 0, flexShrink: 0 },
  row: { gap: space.s, alignItems: 'center', paddingHorizontal: space.l, paddingVertical: space.xs },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs, maxWidth: 110,
    borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: space.m, paddingVertical: space.xs,
  },
  on: { borderColor: colors.accent },
  name: { color: colors.muted, fontSize: 13, flexShrink: 1 },
  onText: { color: colors.accent, fontSize: 13 },
  badge: { color: '#fff', backgroundColor: colors.bad, borderRadius: 8, paddingHorizontal: 5, fontSize: 10, overflow: 'hidden' },
  add: { borderStyle: 'dashed' },
  sep: { width: 1, height: 18, backgroundColor: colors.line },
});
