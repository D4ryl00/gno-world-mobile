import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { roomLink } from '@/offchain/rooms/link';
import { useRooms, useServices } from '@/state/app-services';
import { useSettings } from '@/state/settings';
import { colors, radius, space } from '@/theme';

const SEARCH_FROM = 9;

/** The ＋ sheet, as the site's: make a room, join one by its link, or open a listed one. The room opens in Chat. */
export function NewRoomSheet() {
  const { rooms, chatChannel } = useServices();
  const offchainUrl = useSettings((s) => s.offchainUrl);
  const book = useRooms((s) => s.book);
  const listed = useRooms((s) => s.listed);
  const listedError = useRooms((s) => s.listedError);
  const [name, setName] = useState('');
  const [listIt, setListIt] = useState(false);
  const [link, setLink] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void rooms.getState().refreshListed();
  }, [rooms]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/chat');
  };
  const openInChat = (id: string) => {
    chatChannel.getState().select(id);
    rooms.getState().open(id);
    close();
  };
  const run = async (f: () => Promise<{ id: string } | { error: string }>, then?: (id: string) => Promise<unknown>) => {
    setBusy(true);
    setError('');
    const r = await f();
    if ('error' in r) {
      setBusy(false);
      return setError(r.error);
    }
    // busy until the sheet goes: Make stays in reach above the share sheet, and a second press makes a second room
    if (!then) return openInChat(r.id);
    // over this sheet, before it closes: iOS drops a share sheet asked for while the sheet is going away
    chatChannel.getState().select(r.id);
    rooms.getState().open(r.id);
    await then(r.id).catch(() => undefined);
    close();
  };

  const joined = new Set(book.rooms.map((r) => r.id));
  const all = listed ?? [];
  const shown = all.length >= SEARCH_FROM && search.trim()
    ? all.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase()))
    : all;
  return (
    // the form sheet's header sits over the content: the scroll view insets itself under it
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">
      <Text style={styles.h}>Make a room</Text>
      <TextInput
        style={styles.input} value={name} onChangeText={setName} placeholder="a name for a new room" maxLength={120}
        placeholderTextColor={colors.muted}
      />
      <View style={styles.row}>
        <Text style={styles.text}>List it publicly, for anyone to join</Text>
        <Switch value={listIt} onValueChange={setListIt} />
      </View>
      <Button
        title="Make" disabled={busy || !name.trim()}
        // the link goes out once the room is open: what the site does after making one
        onPress={() => void run(() => rooms.getState().make(name.trim(), listIt), (id) => Share.share({ message: roomLink(offchainUrl, id) }))}
      />

      <Text style={styles.h}>Join</Text>
      <TextInput
        style={styles.input} value={link} onChangeText={setLink} placeholder="or paste a room's link" autoCapitalize="none"
        autoCorrect={false} placeholderTextColor={colors.muted}
      />
      <Button title="Join" kind="secondary" disabled={busy || !link.trim()} onPress={() => void run(() => rooms.getState().join(link))} />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.h}>Public rooms</Text>
      {all.length >= SEARCH_FROM ? (
        <TextInput style={styles.input} value={search} onChangeText={setSearch} placeholder="search" placeholderTextColor={colors.muted} />
      ) : null}
      {listedError ? <Text style={styles.muted}>could not be listed right now</Text> : null}
      {!listedError && listed && !all.length ? <Text style={styles.muted}>none right now — make one and list it</Text> : null}
      {shown.map((r) => {
        const here = r.here ? `${r.here} here` : 'empty';
        return (
          <Pressable
            key={r.id} accessibilityRole="button" accessibilityLabel={`${r.name}, ${here}${joined.has(r.id) ? ', open' : ''}`}
            onPress={() => openInChat(r.id)} style={styles.listed}>
            <Text style={styles.name} numberOfLines={1}>{r.name}</Text>
            <Text style={styles.muted}>{here}</Text>
            {joined.has(r.id) ? <Text style={styles.open}>open</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
  h: { color: colors.fg, fontSize: 16, fontWeight: '700', marginTop: space.m },
  input: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.m },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.m },
  text: { color: colors.fg, flex: 1 },
  error: { color: colors.bad },
  muted: { color: colors.muted },
  listed: { flexDirection: 'row', alignItems: 'center', gap: space.s, paddingVertical: space.s, borderBottomColor: colors.line, borderBottomWidth: 1 },
  name: { color: colors.fg, flex: 1 },
  open: { color: colors.accent },
});
