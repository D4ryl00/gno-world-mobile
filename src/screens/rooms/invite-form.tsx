import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/button';
import { useServices } from '@/state/app-services';
import { colors, radius, space } from '@/theme';

const TAG = /^[0-9a-f]{4}$/;

/** The maker invites someone by the name they last spoke under; the tag tells two of the same name apart. */
export function InviteForm({ id }: { id: string }) {
  const { rooms } = useServices();
  const [to, setTo] = useState('');
  const [tag, setTag] = useState('');
  const [said, setSaid] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const t = tag.trim().toLowerCase();
    if (t && !TAG.test(t)) return setSaid('a tag is four letters 0-9 and a-f');
    setBusy(true);
    setSaid(await rooms.getState().invite(id, to.trim(), t));
    setBusy(false);
  };
  return (
    <View style={styles.form}>
      <TextInput style={styles.input} value={to} onChangeText={setTo} placeholder="their name" autoCapitalize="none" placeholderTextColor={colors.muted} />
      <TextInput
        style={styles.input} value={tag} onChangeText={setTag} placeholder="tag" autoCapitalize="none" maxLength={4}
        placeholderTextColor={colors.muted}
      />
      <Text style={styles.muted}>with two bobs, add the four-letter tag</Text>
      <Button title="Invite" disabled={busy || !to.trim()} onPress={() => void send()} />
      {said ? <Text style={styles.text}>{said}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.m },
  input: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.m },
  muted: { color: colors.muted },
  text: { color: colors.fg },
});
