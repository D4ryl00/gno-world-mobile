import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { roomLink } from '@/offchain/rooms/link';
import { useRooms, useServices } from '@/state/app-services';
import { useSettings } from '@/state/settings';
import { colors, radius, space } from '@/theme';

import { InviteForm } from './invite-form';
import { MenuSheet, type MenuItem } from './menu-sheet';

type Mode = 'menu' | 'rename' | 'invite' | 'delete' | 'said';

/**
 * The ⋯ of the Chat tab: the room's actions (the maker's need its key), and pairing. `id` '' is Public. What an action
 * asks or answers shows in this same sheet (see MenuSheet).
 */
export function RoomMenu({ id, visible, onClose, onLeft }: { id: string; visible: boolean; onClose(): void; onLeft(): void }) {
  const { rooms } = useServices();
  const offchainUrl = useSettings((s) => s.offchainUrl);
  const key = useRooms((s) => s.book.rooms.find((r) => r.id === id)?.key ?? '');
  const joined = useRooms((s) => s.book.rooms.some((r) => r.id === id));
  const name = useRooms((s) => s.book.rooms.find((r) => r.id === id)?.name || s.listed?.find((r) => r.id === id)?.name || 'this room');
  // kept with the room it is about: another room's says nothing here
  const [listedOf, setListedOf] = useState<{ id: string; on: boolean } | null>(null);
  const listed = listedOf?.id === id ? listedOf.on : null;
  const [mode, setMode] = useState<Mode>('menu');
  const [newName, setNewName] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  // whether it is listed is the server's to say, for this room: nothing until it answers
  useEffect(() => {
    if (!visible || !key) return;
    let on = true;
    void rooms.getState().roomInfo(id).then((r) => {
      if (on && r && r !== 'gone') setListedOf({ id, on: r.listed });
    });
    return () => {
      on = false;
    };
  }, [visible, key, id, rooms]);
  const close = () => {
    setMode('menu');
    onClose();
  };
  const say = (words: string) => {
    setSaid(words);
    setMode('said');
  };

  const items: MenuItem[] = [];
  if (id) {
    items.push({
      label: 'Share link', stay: true,
      // over this sheet, which closes after: iOS drops a share sheet asked for while a sheet closes
      onPress: () => void Share.share({ message: roomLink(offchainUrl, id) }).catch(() => undefined).then(close),
    });
    if (key) items.push({ label: 'Invite…', stay: true, onPress: () => setMode('invite') });
    // a listed room read but not joined has no label of its own, and nothing to leave
    if (joined) items.push({ label: 'Rename', stay: true, onPress: () => (setNewName(name), setMode('rename')) });
    if (key) {
      items.push({
        label: 'Listed publicly', detail: listed === null ? undefined : listed ? 'on' : 'off', stay: true,
        onPress: () => {
          if (listed === null) return;
          void rooms.getState().setListed(id, !listed).then((err) => (err ? say(err) : setListedOf({ id, on: !listed })));
        },
      });
      items.push({ label: 'Delete room', danger: true, stay: true, onPress: () => setMode('delete') });
    }
    if (joined) items.push({ label: 'Leave', onPress: () => void rooms.getState().leave(id).then(onLeft) });
  }
  items.push({ label: 'Pair with a browser', onPress: () => router.push('/pair') });

  return (
    <MenuSheet title={id ? name : undefined} items={items} visible={visible} onClose={close}>
      {mode === 'rename' ? (
        <View style={styles.form}>
          <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="a new name" placeholderTextColor={colors.muted} />
          <Button
            title="Save" disabled={busy || !newName.trim()}
            onPress={async () => {
              setBusy(true);
              say(await rooms.getState().rename(id, newName.trim()));
              setBusy(false);
            }}
          />
          <Button title="Cancel" kind="secondary" onPress={() => setMode('menu')} />
        </View>
      ) : mode === 'invite' ? (
        <View style={styles.form}>
          <InviteForm id={id} />
          <Button title="Done" kind="secondary" onPress={close} />
        </View>
      ) : mode === 'delete' ? (
        <View style={styles.form}>
          <Text style={styles.text}>Delete this room for everyone? It cannot be undone.</Text>
          <Button
            title="Delete room" kind="danger" disabled={busy}
            onPress={async () => {
              setBusy(true);
              const err = await rooms.getState().drop(id);
              setBusy(false);
              if (err) return say(err);
              close();
              onLeft();
            }}
          />
          <Button title="Cancel" kind="secondary" onPress={() => setMode('menu')} />
        </View>
      ) : mode === 'said' ? (
        <View style={styles.form}>
          <Text style={styles.text}>{said}</Text>
          <Button title="OK" kind="secondary" onPress={close} />
        </View>
      ) : undefined}
    </MenuSheet>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.m },
  input: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.m },
  text: { color: colors.fg },
});
