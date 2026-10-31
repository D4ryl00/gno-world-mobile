import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputInstance } from 'react-native';

import type { ChatLine } from '@/offchain/chat/types';
import { colors, radius, space } from '@/theme';

export interface ComposerHandle {
  focus(): void;
  /** sends what the field holds, as the send button does */
  send(): void;
}

export function Composer({ ref, reply, editing, typing, error, needsName, onNeedName, onCancel, onChange, onSend, onDismissError, bottomInset, placeholder = 'say something' }: {
  ref?: Ref<ComposerHandle>;
  reply: ChatLine | null; editing: ChatLine | null; typing: string; error: string; needsName: boolean;
  onNeedName?: () => void; onCancel: () => void; onChange: (n: number) => void;
  onSend: (text: string) => Promise<boolean>; onDismissError: () => void; bottomInset: number;
  /** names the channel written in */
  placeholder?: string;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  // a line picked for editing fills the field once, and leaving the edit empties it (state adjusted while rendering)
  const [shown, setShown] = useState<ChatLine | null>(null);
  if (editing !== shown) {
    setShown(editing);
    setText(editing ? editing.body : '');
  }
  const strip = editing ? 'editing your line' : reply ? `replying to ${reply.name}: ${reply.body}` : '';
  const send = async () => {
    if (needsName && onNeedName) return onNeedName();
    setBusy(true);
    const ok = await onSend(text); // a refused line keeps its text
    setBusy(false);
    if (ok) {
      setText('');
      onChange(0);
    }
  };
  const input = useRef<TextInputInstance>(null);
  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus(), send: () => void send() }));
  return (
    <View style={[styles.box, { paddingBottom: space.s + bottomInset }]}>
      {typing ? <Text style={styles.typing} numberOfLines={1}>{typing}</Text> : null}
      {error ? (
        <Pressable onPress={onDismissError}>
          <Text style={styles.error}>{error}</Text>
        </Pressable>
      ) : null}
      {strip ? (
        <View style={styles.strip}>
          <Text style={styles.stripText} numberOfLines={1}>{strip}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="cancel" onPress={() => {
            onCancel();
            if (editing) setText('');
          }}>
            <Text style={styles.stripText}>✕</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
        <TextInput
          ref={input} style={styles.input} value={text} multiline placeholder={placeholder} placeholderTextColor={colors.muted}
          onChangeText={(t) => {
            setText(t);
            onChange(t.length);
          }}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={editing ? 'save' : 'send'} disabled={busy || !text.trim()} onPress={() => void send()}
          style={[styles.send, (busy || !text.trim()) && styles.dim]}>
          <Text style={styles.sendText}>{editing ? 'save' : 'send'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderTopColor: colors.line, borderTopWidth: 1, paddingHorizontal: space.l, paddingTop: space.s, gap: space.xs, backgroundColor: colors.bg },
  typing: { color: colors.muted, fontSize: 12 },
  error: { color: colors.bad, fontSize: 12 },
  strip: { flexDirection: 'row', justifyContent: 'space-between', gap: space.s },
  stripText: { color: colors.muted, fontSize: 12, flexShrink: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.s },
  input: { flex: 1, color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.s, maxHeight: 120 },
  send: { backgroundColor: colors.ring, borderRadius: radius.m, paddingHorizontal: space.l, paddingVertical: space.s },
  sendText: { color: '#000', fontWeight: '600' },
  dim: { opacity: 0.5 },
});
