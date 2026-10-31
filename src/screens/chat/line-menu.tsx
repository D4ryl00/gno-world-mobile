import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { REACTIONS } from '@/offchain/chat/client';
import type { ChatLine } from '@/offchain/chat/types';
import { colors, radius, space } from '@/theme';

export function LineMenu({ line, canEdit, canWithdraw, onClose, onReply, onEdit, onReact, onWithdraw, onPin, onDelete }: {
  line: ChatLine | null; canEdit: boolean; canWithdraw: boolean; onClose: () => void;
  onReply: (l: ChatLine) => void; onEdit: (l: ChatLine) => void; onReact: (l: ChatLine, emoji: string) => void; onWithdraw: () => void;
  /** the room's maker: pin or unpin, remove for everyone */
  onPin?: (l: ChatLine, on: boolean) => void; onDelete?: (l: ChatLine) => void;
}) {
  // Delete asks here, in the menu: iOS drops an alert raised while the menu is closing
  const [confirming, setConfirming] = useState<ChatLine | null>(null);
  const close = () => {
    setConfirming(null);
    onClose();
  };
  const pick = (f: () => void) => () => {
    f();
    close();
  };
  return (
    <Modal visible={!!line} transparent animationType="fade" onRequestClose={close}>
      {/* not one accessible element: each item stays reachable by VoiceOver/TalkBack */}
      <Pressable style={styles.backdrop} onPress={close} accessible={false}>
        {line && confirming === line && onDelete ? (
          <View style={styles.sheet}>
            <Text style={styles.ask}>Delete this line for everyone?</Text>
            <Item label="Delete for everyone" danger onPress={pick(() => onDelete(line))} />
            <Item label="Cancel" onPress={() => setConfirming(null)} />
          </View>
        ) : line ? (
          <View style={styles.sheet}>
            <View style={styles.emojis}>
              {REACTIONS.map((e) => (
                <Pressable key={e} accessibilityRole="button" accessibilityLabel={`react ${e}`} onPress={pick(() => onReact(line, e))}>
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              ))}
            </View>
            <Item label="Reply" onPress={pick(() => onReply(line))} />
            {canEdit ? <Item label="Edit" onPress={pick(() => onEdit(line))} /> : null}
            {canWithdraw ? <Item label="Take back" danger onPress={pick(onWithdraw)} /> : null}
            {onPin ? <Item label={line.pinned ? 'Unpin' : 'Pin'} onPress={pick(() => onPin(line, !line.pinned))} /> : null}
            {onDelete ? <Item label="Delete" danger onPress={() => setConfirming(line)} /> : null}
          </View>
        ) : null}
      </Pressable>
    </Modal>
  );
}

function Item({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.item}>
      <Text style={[styles.itemText, danger && { color: colors.bad }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.m, borderTopRightRadius: radius.m, padding: space.l, gap: space.s },
  emojis: { flexDirection: 'row', justifyContent: 'space-between' },
  emoji: { fontSize: 26 },
  item: { paddingVertical: space.m },
  itemText: { color: colors.fg, fontSize: 16 },
  ask: { color: colors.fg, fontWeight: '700' },
});
