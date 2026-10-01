import { useState } from 'react';
import { Text, View } from 'react-native';

import { Button } from '@/components/button';
import { Field } from '@/components/field';
import type { Grant } from '@/session/types';
import { colors, space } from '@/theme';
import { gnot } from '@/utils/gnot';

import { grantFromInput } from './grant';

export function GrantForm({ submitLabel, initial, onSubmit }: { submitLabel: string; initial?: Grant; onSubmit: (g: Grant) => void }) {
  const [perHour, setPerHour] = useState(String((initial?.spendPerPeriod ?? 5_000_000) / 1_000_000));
  const [days, setDays] = useState(String((initial?.expires ?? 2_592_000) / 86400));
  const { grant, error } = grantFromInput(perHour, days);
  return (
    <View style={{ gap: space.m }}>
      <Field label="Budget per hour (GNOT) — boops, shots, gas and storage all count" value={perHour} onChangeText={setPerHour} keyboardType="decimal-pad" />
      <Field label="Valid for (days)" value={days} onChangeText={setDays} keyboardType="number-pad" />
      {grant ? (
        <Text style={{ color: colors.muted }}>
          At most {gnot(grant.spendPerPeriod)} per hour, {gnot((grant.spendPerPeriod * grant.expires) / grant.period)} over {days} days.
          Only Bubble Rumble's realms. Revocable at any time.
        </Text>
      ) : (
        <Text style={{ color: colors.bad }}>{error}</Text>
      )}
      <Button title={submitLabel} disabled={!grant} onPress={() => grant && onSubmit(grant)} />
    </View>
  );
}
