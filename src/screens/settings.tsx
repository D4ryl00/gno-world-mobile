import Constants from 'expo-constants';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Field } from '@/components/field';
import { useSession } from '@/state/app-services';
import { matchingPreset, NETWORK_PRESETS, settingsStore, useSettings, validateOffchainUrl, validateRemote } from '@/state/settings';
import { colors, space } from '@/theme';

export function SettingsScreen() {
  const s = useSettings((x) => x);
  const active = useSession((x) => x.active);
  const [chainId, setChainId] = useState(s.chainId);
  const [remote, setRemote] = useState(s.remote);
  const [offchain, setOffchain] = useState(s.offchainUrl);
  const remoteErr = validateRemote(remote);
  const offchainErr = validateOffchainUrl(offchain);
  const preset = matchingPreset(chainId, remote);
  const dirty = chainId !== s.chainId || remote !== s.remote || offchain !== s.offchainUrl;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Text style={styles.h}>Network</Text>
        <View style={styles.row}>
          {NETWORK_PRESETS.map((p) => (
            <Button
              key={p.chainId} kind="secondary" title={p.label} selected={preset?.chainId === p.chainId}
              onPress={() => { setChainId(p.chainId); setRemote(p.remote); }} />
          ))}
        </View>
        <Field label="Chain ID" value={chainId} onChangeText={setChainId} />
        <Field label="RPC endpoint" value={remote} onChangeText={setRemote} error={remoteErr} />
        {active && active.chainId !== chainId ? (
          <Text style={styles.warn}>Your session was made on {active.chainId}; it will not sign on {chainId}.</Text>
        ) : null}
      </Card>
      <Card>
        <Text style={styles.h}>Off-chain server</Text>
        <Text style={styles.muted}>Chat, presence and the rest of the site&apos;s services. The official server is bubblerumble.net.</Text>
        <Field label="Server URL" value={offchain} onChangeText={setOffchain} error={offchainErr} />
      </Card>
      <Button
        title="Save" disabled={!dirty || !!remoteErr || !!offchainErr || !chainId.trim()}
        onPress={() => {
          settingsStore.getState().setNetwork(chainId, remote);
          settingsStore.getState().setOffchainUrl(offchain);
        }}
      />
      <Text style={styles.muted}>Bubble Rumble mobile {Constants.expoConfig?.version ?? ''}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.l },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s },
  h: { color: colors.fg, fontSize: 16, fontWeight: '700' },
  muted: { color: colors.muted },
  warn: { color: colors.accent },
});
