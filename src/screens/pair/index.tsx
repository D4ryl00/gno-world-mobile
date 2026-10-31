import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStore, type StoreApi } from 'zustand';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Countdown } from '@/components/countdown';
import { Page } from '@/components/page';
import { useNow } from '@/hooks/use-now';
import type { ChatIdentity } from '@/offchain/chat/identity';
import type { SyncState } from '@/offchain/sync/store';
import { colors, radius, space } from '@/theme';
import { humanDuration } from '@/utils/gnot';

// the site's words (app-rooms.js syncAccept), and ours where the app departs from it
export const CONFIRM = 'This code came from another device. Your rooms and their keys will be shared with it, and its rooms come here.';
export const LEAVES = 'This device leaves its current pairing.';
export const SPENT = 'not paired — that code is used up now; get another on the other device to try again';

/** Resolves true on "Continue". */
const confirmPair = (paired: boolean) =>
  new Promise<boolean>((resolve) => {
    Alert.alert('Pair with this device?', `${CONFIRM}${paired ? ` ${LEAVES}` : ''} Continue?`, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'Continue', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });

export function PairScreen({ store, identity }: { store: StoreApi<SyncState>; identity: ChatIdentity }) {
  const s = useStore(store);
  const [typed, setTyped] = useState('');
  const [outcome, setOutcome] = useState('');
  const reserved = identity.nameKey ? identity.reservedName : '';

  const pair = async () => {
    setOutcome('');
    const key = await store.getState().open(typed);
    if (!key) return;
    if (!(await confirmPair(store.getState().paired))) {
      setOutcome(SPENT);
      return;
    }
    const words = await store.getState().use(key);
    if (words) {
      setOutcome(words);
      setTyped('');
    }
  };
  const stop = () =>
    Alert.alert('Stop syncing?', 'This device stops syncing; the others keep on.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Stop', style: 'destructive', onPress: () => void store.getState().stop() },
    ]);

  return (
    <Page style={styles.page}>
      <Card>
        {s.paired ? (
          <>
            <Text style={styles.text}>Paired — rooms and reserved name stay the same on your other devices</Text>
            <SyncAge lastSync={s.lastSync} failing={s.failing} />
            <Button title="Stop" kind="danger" onPress={stop} />
          </>
        ) : (
          <Text style={styles.text}>
            Your rooms and your reserved name live in this app. Pair it with gno.world in a browser to have them on both.
          </Text>
        )}
      </Card>

      <Card>
        <Text style={styles.h}>Get a code</Text>
        {s.code ? <CodeShown code={s.code.code} until={s.code.until} /> : null}
        <Button
          title={s.busy === 'offer' ? 'Making a code…' : s.code ? 'Get another code' : 'Get a code'}
          disabled={!!s.busy}
          onPress={() => void store.getState().offer()}
        />
        {s.offerError ? <Text style={styles.bad}>{s.offerError}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.h}>Enter a code</Text>
        <TextInput
          accessibilityLabel="pairing code"
          style={styles.input}
          value={typed}
          onChangeText={(t) => {
            setTyped(t);
            setOutcome('');
            if (store.getState().acceptError) store.getState().clearError();
          }}
          placeholder="a code from the other device"
          placeholderTextColor={colors.muted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={7}
        />
        <Button title={s.busy === 'accept' ? 'Pairing…' : 'Pair'} disabled={!!s.busy || !typed.trim()} onPress={() => void pair()} />
        {s.acceptError ? <Text style={styles.bad}>{s.acceptError}</Text> : null}
        {outcome ? <Text style={styles.text}>{outcome}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.h}>Name</Text>
        <Text style={styles.text}>{reserved ? `${reserved} ✓` : "no reserved name — the other device's comes along when you pair"}</Text>
        {s.said && s.said.words !== outcome ? <Text style={styles.muted}>{s.said.words}</Text> : null}
      </Card>

      <Card>
        <Text style={styles.h}>Rooms ({s.rooms.length})</Text>
        {s.rooms.map((r) => (
          <Text key={r.id} style={styles.text}>{`${r.name}${r.key ? ' 🔑' : ''}${r.irc ? ' · IRC' : ''}`}</Text>
        ))}
        <Text style={styles.muted}>They are the channels of the Chat tab.</Text>
      </Card>
    </Page>
  );
}

function CodeShown({ code, until }: { code: string; until: number }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text selectable accessibilityLabel={`code ${code.split('').join(' ')}`} style={styles.code}>{code}</Text>
      <Text style={styles.muted}>On the other device: /pair → enter this code</Text>
      <Countdown until={Math.floor(until / 1000)} overText="expired — get another" />
    </View>
  );
}

function SyncAge({ lastSync, failing }: { lastSync: number; failing: boolean }) {
  const now = useNow();
  if (failing) return <Text style={styles.bad}>sync failed — retrying</Text>;
  if (!lastSync) return null;
  const ago = now - Math.floor(lastSync / 1000);
  return <Text style={styles.muted}>{ago < 10 ? 'last synced just now' : `last synced ${humanDuration(ago)} ago`}</Text>;
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.l },
  h: { color: colors.fg, fontWeight: '700', fontSize: 16 },
  text: { color: colors.fg },
  muted: { color: colors.muted, fontSize: 12 },
  bad: { color: colors.bad },
  code: { color: colors.accent, fontSize: 36, fontWeight: '700', letterSpacing: 8, fontVariant: ['tabular-nums'], fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  input: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.m, letterSpacing: 4 },
});
