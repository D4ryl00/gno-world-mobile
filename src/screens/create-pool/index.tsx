import { router } from 'expo-router';
import { useState, useRef } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/button';
import { Field } from '@/components/field';
import { isPlayBlocked, NOPLAY_TEXT, usePresence } from '@/offchain/presence';
import { txMessage } from '@/screens/pool/tx-message';
import { useServices, useSession } from '@/state/app-services';
import { colors, space } from '@/theme';
import { gnot } from '@/utils/gnot';

import { validatePoolForm } from './form';

export function CreatePoolScreen() {
  const { game } = useServices();
  const active = useSession((s) => s.active);
  const blocked = usePresence((s) => isPlayBlocked(s.country));
  const [v, setV] = useState({ name: '', window: '12h', base: '1', life: '', seed: '0' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const { form, error } = validatePoolForm(v);
  const inFlightRef = useRef(false);
  const set = (k: keyof typeof v) => (t: string) => setV({ ...v, [k]: t });

  if (blocked) return <Text style={styles.warn}>{NOPLAY_TEXT}</Text>;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.muted}>The seed comes out of your account. Nth boop costs base·√N. You earn 5% of every boop.</Text>
      <Field label="Name" value={v.name} onChangeText={set('name')} />
      <Field label="Window (e.g. 90m, 12h, 2d)" value={v.window} onChangeText={set('window')} />
      <Field label="Base price (GNOT)" value={v.base} onChangeText={set('base')} keyboardType="decimal-pad" />
      <Field label="Life from the first boop (optional, e.g. 3d)" value={v.life} onChangeText={set('life')} />
      <Field label="Seed (GNOT, optional)" value={v.seed} onChangeText={set('seed')} keyboardType="decimal-pad" />
      {error ? <Text style={styles.warn}>{error}</Text> : <Text style={styles.muted}>first boop {gnot(form!.basePrice)}</Text>}
      <Button
        title={active ? 'create' : 'set up a session first'} disabled={!form || !active || busy}
        onPress={async () => {
          if (inFlightRef.current) return;
          inFlightRef.current = true;
          setBusy(true);
          try {
            await game.createPool(active!, form!);
            router.back();
          } catch (e) {
            setMsg(txMessage(e, Math.floor(Date.now() / 1000)));
          } finally {
            setBusy(false);
            inFlightRef.current = false;
          }
        }}
      />
      {msg ? <Text style={styles.warn}>{msg}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
  muted: { color: colors.muted },
  warn: { color: colors.accent, padding: space.l },
});
