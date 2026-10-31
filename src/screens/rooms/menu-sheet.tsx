import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, space } from '@/theme';

/** `stay`: the action closes the sheet itself, or shows something else in it */
export interface MenuItem { label: string; onPress(): void; danger?: boolean; detail?: string; stay?: boolean }

/**
 * A bottom sheet of actions, closed by a tap outside it or after an action. `children`, when given, show instead of
 * the items: what an action asks or says stays in this sheet, since iOS drops an alert, a second modal or a share
 * sheet asked for while a sheet is closing.
 */
export function MenuSheet({ title, items, visible, onClose, children }: {
  title?: string; items: MenuItem[]; visible: boolean; onClose(): void; children?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Rename and Invite… type in it: the sheet rises above the keyboard (padding on Android too: edge-to-edge keeps
          the window full size) */}
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
          {/* a tap inside the sheet stays there (a Pressable here would hide the items from VoiceOver) */}
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
            {children ?? items.map((it) => (
              <Pressable
                key={it.label} accessibilityRole="button" accessibilityLabel={it.label} style={styles.item}
                onPress={() => {
                  if (!it.stay) onClose();
                  it.onPress();
                }}>
                <Text style={[styles.label, it.danger && { color: colors.bad }]}>{it.label}</Text>
                {it.detail ? <Text style={styles.detail}>{it.detail}</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.m, borderTopRightRadius: radius.m, padding: space.l, paddingBottom: space.xl, gap: space.xs },
  title: { color: colors.fg, fontWeight: '700', marginBottom: space.s },
  item: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: space.m, borderBottomColor: colors.line, borderBottomWidth: 1 },
  label: { color: colors.fg, fontSize: 16 },
  detail: { color: colors.muted },
});
