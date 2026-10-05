import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore, type StoreApi } from 'zustand';

import { useNow } from '@/hooks/use-now';
import { isMine } from '@/offchain/chat/merge';
import type { ChatState } from '@/offchain/chat/store';
import type { ChatLine } from '@/offchain/chat/types';
import { colors, space } from '@/theme';

import { ChatLineRow } from './chat-line';
import { Composer } from './composer';
import { LineMenu } from './line-menu';
import { canEdit, canWithdraw, typingText } from './line-model';
import { Pins } from './pins';

const NO_REACTIONS: string[] = [];

export function ChatPane({ store, offchainUrl, onOpenIdentity }: {
  store: StoreApi<ChatState>; offchainUrl: string; onOpenIdentity?: () => void;
}) {
  const s = useStore(store);
  const insets = useSafeAreaInsets();
  const now = useNow(15000);
  const list = useRef<FlatList<ChatLine>>(null);
  const [reply, setReply] = useState<ChatLine | null>(null);
  const [editing, setEditing] = useState<ChatLine | null>(null);
  const [menuFor, setMenuFor] = useState<ChatLine | null>(null);

  // newest first for the inverted list
  const data = useMemo(() => [...s.lines].reverse(), [s.lines]);
  const newestId = s.lines.at(-1)?.id ?? 0;
  const mine = useCallback((l: ChatLine) => isMine(l, s.you, s.mine), [s.you, s.mine]);

  // while the tab is shown, what arrives is seen
  useFocusEffect(
    useCallback(() => {
      if (newestId) store.getState().markSeen();
    }, [store, newestId]),
  );

  const openMenu = useCallback((l: ChatLine) => setMenuFor(l), []);
  const react = useCallback((l: ChatLine, e: string) => void store.getState().react(l.id, e), [store]);
  const vote = useCallback((l: ChatLine, i: number) => void store.getState().vote(l.id, i), [store]);
  // reads the store, not `data`: stays the same function while lines arrive
  const jumpTo = useCallback((id: number) => {
    const lines = store.getState().lines;
    const i = lines.findIndex((l) => l.id === id);
    if (i >= 0) list.current?.scrollToIndex({ index: lines.length - 1 - i, viewPosition: 0.5 });
  }, [store]);
  const renderItem = useCallback(({ item }: { item: ChatLine }) => (
    <ChatLineRow
      line={item} mine={mine(item)} now={now} offchainUrl={offchainUrl}
      myReactions={s.myReactions[item.id] ?? NO_REACTIONS} myVote={s.myVotes[item.id]}
      onLongPress={openMenu} onJump={jumpTo} onReact={react} onVote={vote}
    />
  ), [mine, now, offchainUrl, s.myReactions, s.myVotes, openMenu, jumpTo, react, vote]);
  const myName = s.identity.reservedName || s.identity.name;
  const typing = typingText(s.typing, myName);

  return (
    // padding on Android too: with edge-to-edge (android/gradle.properties) the window keeps its size under the keyboard
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <View style={[styles.header, { paddingTop: insets.top + space.s }]}>
        <Text style={styles.title}>Chat · {s.here} here</Text>
        <Pressable accessibilityRole="button" onPress={onOpenIdentity} style={styles.you}>
          <Text style={styles.youText}>{myName || 'you'}{s.identity.reservedName ? ' ✓' : ''}</Text>
        </Pressable>
      </View>
      {s.phase === 'unreachable' ? <Text style={styles.down}>server unreachable — retrying</Text> : null}
      <Pins pins={s.pins} onJump={jumpTo} />
      <FlatList
        ref={list}
        inverted
        data={data}
        keyExtractor={(l) => String(l.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onEndReached={() => void store.getState().loadOlder()}
        onEndReachedThreshold={0.5}
        onScrollToIndexFailed={({ index }) => list.current?.scrollToOffset({ offset: index * 80, animated: true })}
        renderItem={renderItem}
      />
      <Composer
        reply={reply} editing={editing} typing={typing} error={s.error}
        onCancel={() => {
          setReply(null);
          setEditing(null);
        }}
        onChange={(n) => store.getState().signalTyping(n)}
        onSend={async (text) => {
          const st = store.getState();
          const ok = editing ? await st.edit(editing.id, text) : await st.send(text, reply?.id);
          if (ok) {
            setReply(null);
            setEditing(null);
          }
          return ok;
        }}
        needsName={!myName}
        onNeedName={onOpenIdentity}
        onDismissError={() => store.getState().clearError()}
        bottomInset={0}
      />
      <LineMenu
        line={menuFor}
        canEdit={!!menuFor && canEdit(menuFor, mine(menuFor), now)}
        canWithdraw={!!menuFor && canWithdraw(menuFor, newestId, mine(menuFor), now)}
        onClose={() => setMenuFor(null)}
        onReply={(l) => {
          setEditing(null); // one at a time: a reply sent while still editing would overwrite the edited line
          setReply(l);
        }}
        onEdit={(l) => {
          setReply(null);
          setEditing(l);
        }}
        onReact={(l, e) => void store.getState().react(l.id, e)}
        onWithdraw={() => void store.getState().withdraw()}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, paddingBottom: space.s },
  title: { color: colors.fg, fontSize: 17, fontWeight: '700' },
  you: { borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: space.m, paddingVertical: space.xs },
  youText: { color: colors.fg },
  down: { color: colors.bad, textAlign: 'center', paddingBottom: space.xs },
});
