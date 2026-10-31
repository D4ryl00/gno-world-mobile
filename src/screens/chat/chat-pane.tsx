import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, StyleSheet, Text } from 'react-native';
import { useStore, type StoreApi } from 'zustand';

import { useNow } from '@/hooks/use-now';
import { isMine } from '@/offchain/chat/merge';
import type { IdentityState } from '@/offchain/chat/identity-store';
import type { ChatState } from '@/offchain/chat/store';
import type { ChatLine } from '@/offchain/chat/types';
import { colors, space } from '@/theme';

import { ChatLineRow } from './chat-line';
import { Composer, type ComposerHandle } from './composer';
import { LineMenu } from './line-menu';
import { canEdit, canWithdraw, typingText } from './line-model';
import { Pins } from './pins';

const NO_REACTIONS: string[] = [];

export function ChatPane({ store, identity, offchainUrl, onOpenIdentity, identityOpen, placeholder, canModerate }: {
  store: StoreApi<ChatState>; identity: StoreApi<IdentityState>; offchainUrl: string; onOpenIdentity?: () => void;
  /** the name sheet is showing */
  identityOpen?: boolean;
  placeholder?: string;
  /** the app holds the room's maker key: lines can be pinned and removed */
  canModerate?: boolean;
}) {
  const s = useStore(store);
  const me = useStore(identity, (i) => i.identity);
  const now = useNow(15000);
  const list = useRef<FlatList<ChatLine>>(null);
  const [reply, setReply] = useState<ChatLine | null>(null);
  const [editing, setEditing] = useState<ChatLine | null>(null);
  const [menuFor, setMenuFor] = useState<ChatLine | null>(null);
  const composer = useRef<ComposerHandle>(null);
  const heldBack = useRef(false); // Send pressed without a name: the sheet is open for it

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
  const myName = me.reservedName || me.name;
  // the held-back line goes out when the sheet closes with a name (not as soon as one is saved: "Reserve" saves the
  // name, then reserves it — the line must carry the key); closing it without a name drops the line
  useEffect(() => {
    if (!heldBack.current || identityOpen) return;
    heldBack.current = false;
    if (myName) composer.current?.send();
  }, [myName, identityOpen]);
  const typing = typingText(s.typing, myName);

  return (
    // padding on Android too: with edge-to-edge (android/gradle.properties) the window keeps its size under the keyboard
    <KeyboardAvoidingView style={styles.root} behavior="padding">
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
        ref={composer}
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
        onNeedName={() => {
          heldBack.current = true;
          onOpenIdentity?.();
        }}
        onDismissError={() => store.getState().clearError()}
        bottomInset={0}
        placeholder={placeholder}
      />
      <LineMenu
        line={menuFor}
        canEdit={!!menuFor && canEdit(menuFor, mine(menuFor), now)}
        canWithdraw={!!menuFor && canWithdraw(menuFor, newestId, mine(menuFor), now)}
        onClose={() => setMenuFor(null)}
        onReply={(l) => {
          setEditing(null); // one at a time: a reply sent while still editing would overwrite the edited line
          setReply(l);
          composer.current?.focus();
        }}
        onEdit={(l) => {
          setReply(null);
          setEditing(l);
          composer.current?.focus();
        }}
        onReact={(l, e) => void store.getState().react(l.id, e)}
        onWithdraw={() => void store.getState().withdraw()}
        onPin={canModerate ? (l, on) => void store.getState().pin(l.id, on) : undefined}
        onDelete={canModerate ? (l) => void store.getState().deleteLine(l.id) : undefined}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  down: { color: colors.bad, textAlign: 'center', paddingBottom: space.xs },
});
