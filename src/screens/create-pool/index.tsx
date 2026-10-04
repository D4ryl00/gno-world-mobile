import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { ChainError } from '@/chain/errors';
import { Button } from '@/components/button';
import { Page } from '@/components/page';
import { Field } from '@/components/field';
import { isPlayBlocked, NOPLAY_TEXT, usePresence } from '@/offchain/presence';
import { txMessage } from '@/screens/pool/tx-message';
import { createTxRunner } from '@/screens/pool/tx-runner';
import { useServices, useSession } from '@/state/app-services';
import { colors, space } from '@/theme';
import { gnot } from '@/utils/gnot';

import { findCreated, validatePoolForm } from './form';

/** Leaves the modal, for a pool when given; a deep link that opened it directly has nothing to go back to. */
const leave = (poolKey?: string) => {
  if (poolKey) router.replace({ pathname: '/pool/[key]', params: { key: poolKey } });
  else if (router.canGoBack()) router.back();
  else router.replace('/');
};

export function CreatePoolScreen() {
  const { game } = useServices();
  const active = useSession((s) => s.active);
  const blocked = usePresence((s) => isPlayBlocked(s.country));
  const [v, setV] = useState({ name: '', window: '12h', base: '1', life: '', seed: '0' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false); // the pool may exist: never offer to create it twice
  const { form, error } = validatePoolForm(v);
  const [runner] = useState(() => createTxRunner(setBusy)); // one transaction at a time, as on the pool screen
  const set = (k: keyof typeof v) => (t: string) => setV((prev) => ({ ...prev, [k]: t }));

  if (blocked) return <Text style={styles.warn}>{NOPLAY_TEXT}</Text>;
  return (
    <Page style={styles.page}>
      <Text style={styles.muted}>The seed comes out of your account. Nth boop costs base·√N. You earn 5% of every boop.</Text>
      <Field label="Name" value={v.name} onChangeText={set('name')} />
      <Field label="Window (e.g. 90m, 12h, 2d)" value={v.window} onChangeText={set('window')} />
      <Field label="Base price (GNOT)" value={v.base} onChangeText={set('base')} keyboardType="decimal-pad" />
      <Field label="Life from the first boop (optional, e.g. 3d)" value={v.life} onChangeText={set('life')} />
      <Field label="Seed (GNOT, optional)" value={v.seed} onChangeText={set('seed')} keyboardType="decimal-pad" />
      {error ? <Text style={styles.warn}>{error}</Text> : <Text style={styles.muted}>first boop {gnot(form!.basePrice)}</Text>}
      <Button
        title={active ? 'create' : 'set up a session first'} disabled={!form || !active || busy || sent}
        onPress={() =>
          void runner(async () => {
            try {
              await game.createPool(active!, form!);
              setSent(true);
              // land on the new pool when the realm already lists it, else on the list (it shows up there)
              const created = await game.realm(5).then((r) => findCreated(r.pools, active!.master, form!.name)).catch(() => undefined);
              leave(created);
            } catch (e) {
              const m = txMessage(e, Math.floor(Date.now() / 1000));
              setMsg(m);
              if (e instanceof ChainError && e.kind === 'unknown-outcome') {
                // probably created: back to the list, where the new pool shows up, with the warning kept on screen
                setSent(true);
                leave();
                Alert.alert('New pool', m);
              }
            }
          }, async () => undefined)
        }
      />
      {msg ? <Text style={styles.warn}>{msg}</Text> : null}
    </Page>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
  muted: { color: colors.muted },
  warn: { color: colors.accent, padding: space.l },
});
