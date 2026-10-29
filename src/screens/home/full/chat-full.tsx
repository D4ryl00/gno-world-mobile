import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useStore } from 'zustand';

import { useNow } from '@/hooks/use-now';
import { isMine } from '@/offchain/chat/merge';
import type { ChatLine } from '@/offchain/chat/types';
import { ChatLineRow } from '@/screens/chat/chat-line';
import { useServices } from '@/state/app-services';
import { useSettings } from '@/state/settings';
import { colors, space } from '@/theme';

import { FullHeader, useBottomGap } from './full-header';

const NO_REACTIONS: string[] = [];
const nothing = () => {};

/** The chat to read: the Chat tab's lines, live, with nothing to write, react or vote with. */
export function ChatFull() {
  const { chat } = useServices();
  const s = useStore(chat);
  const offchainUrl = useSettings((st) => st.offchainUrl);
  const now = useNow(15000);
  const bottom = useBottomGap();
  const list = useRef<FlatList<ChatLine>>(null);
  // newest first for the inverted list, as the Chat tab
  const data = useMemo(() => [...s.lines].reverse(), [s.lines]);
  const newestId = s.lines.at(-1)?.id ?? 0;

  // read here is read: the Chat tab's badge clears
  useFocusEffect(
    useCallback(() => {
      if (newestId) chat.getState().markSeen();
    }, [chat, newestId]),
  );

  const jumpTo = useCallback((id: number) => {
    const lines = chat.getState().lines;
    const i = lines.findIndex((l) => l.id === id);
    if (i >= 0) list.current?.scrollToIndex({ index: lines.length - 1 - i, viewPosition: 0.5 });
  }, [chat]);
  const renderItem = useCallback(({ item }: { item: ChatLine }) => (
    <ChatLineRow
      readOnly line={item} mine={isMine(item, s.you, s.mine)} now={now} offchainUrl={offchainUrl}
      myReactions={s.myReactions[item.id] ?? NO_REACTIONS} myVote={s.myVotes[item.id]}
      onLongPress={nothing} onJump={jumpTo} onReact={nothing} onVote={nothing}
    />
  ), [s.you, s.mine, s.myReactions, s.myVotes, now, offchainUrl, jumpTo]);

  return (
    <View style={styles.root}>
      <FullHeader title="CHAT" right={<Text style={styles.here}>{s.here} here</Text>} />
      {s.phase === 'unreachable' ? <Text style={styles.down}>chat unreachable — retrying</Text> : null}
      <FlatList
        ref={list}
        testID="chat-full-list"
        inverted
        data={data}
        keyExtractor={(l) => String(l.id)}
        onEndReached={() => void chat.getState().loadOlder()}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={({ index }) => list.current?.scrollToOffset({ offset: index * 80, animated: true })}
        renderItem={renderItem}
      />
      <Pressable accessibilityRole="button" onPress={() => router.dismissTo('/chat')} style={[styles.foot, { paddingBottom: bottom }]}>
        <Text style={styles.write}>Write in Chat ›</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  here: { color: colors.fg },
  down: { color: colors.bad, textAlign: 'center', paddingBottom: space.xs },
  foot: { borderTopColor: colors.line, borderTopWidth: 1, paddingTop: space.m, alignItems: 'center' },
  write: { color: colors.accent, fontWeight: '600' },
});
