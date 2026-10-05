import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStore, type StoreApi } from 'zustand';

import { Button } from '@/components/button';
import { avatarUrl } from '@/offchain/chat/client';
import type { ChatState } from '@/offchain/chat/store';
import { colors, radius, space } from '@/theme';

export function IdentitySheet({ store, visible, onClose, offchainUrl, canReserve }: {
  store: StoreApi<ChatState>; visible: boolean; onClose: () => void; offchainUrl: string; canReserve: boolean;
}) {
  const identity = useStore(store, (s) => s.identity);
  const error = useStore(store, (s) => s.error);
  const [name, setName] = useState(identity.name);
  const [busy, setBusy] = useState(false);
  // the saved name (e.g. as the server spelled it on reserving) refills the field
  const [savedName, setSavedName] = useState(identity.name);
  if (identity.name !== savedName) {
    setSavedName(identity.name);
    setName(identity.name);
  }
  const reserved = !!identity.reservedName;
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true);
    await f();
    setBusy(false);
  };

  const pickPhoto = () =>
    run(async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return;
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      const a = r.canceled ? null : r.assets?.[0];
      if (!a) return;
      const blob = await (await fetch(a.uri)).blob();
      await store.getState().setAvatar(blob, a.mimeType ?? 'image/jpeg');
    });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* the sheet rises above the keyboard: its field and buttons stay in sight */}
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
          <Pressable style={styles.sheet} onPress={() => undefined} accessible={false}>
            <Text style={styles.h}>You in the chat</Text>
            <View style={styles.row}>
              {identity.av ? <Image source={{ uri: avatarUrl(offchainUrl, identity.av) }} style={styles.av} /> : <View style={styles.av} />}
              <Button kind="secondary" title="Choose a photo" disabled={busy} onPress={() => void pickPhoto()} />
            </View>
            <TextInput
              accessibilityLabel="name" style={styles.input} value={name} onChangeText={setName} editable={!reserved}
              placeholder="anon" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} maxLength={32}
            />
            {reserved ? (
              <View style={styles.row}>
                <Text style={styles.ok}>✓ yours</Text>
                <Button kind="secondary" title="Release" disabled={busy} onPress={() => void run(() => store.getState().releaseName())} />
              </View>
            ) : (
              <>
                <Button title="Save name" disabled={busy || !name.trim()} onPress={() => void run(() => store.getState().setName(name))} />
                <Button kind="secondary" title="Reserve this name" disabled={busy || !canReserve || !name.trim()}
                  onPress={() => void run(async () => {
                    await store.getState().setName(name);
                    await store.getState().reserveName();
                  })} />
                <Text style={styles.muted}>
                  {canReserve
                    ? 'A reserved name is yours alone and your lines carry a ✓. The server ties it to the account that booped from this app: boop once first.'
                    : 'Reserving needs a session (Session tab) and one boop from this app.'}
                </Text>
              </>
            )}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button kind="secondary" title="Done" onPress={onClose} />
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#000a', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.m, borderTopRightRadius: radius.m, padding: space.l, gap: space.m },
  h: { color: colors.fg, fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.m },
  av: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.line },
  input: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.m },
  ok: { color: colors.ring, fontWeight: '600' },
  muted: { color: colors.muted, fontSize: 12 },
  error: { color: colors.bad },
});
