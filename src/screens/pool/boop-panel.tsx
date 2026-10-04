import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Pool, RealmInfo } from '@/chain/parse';
import { caps } from '@/chain/realms';
import { Button } from '@/components/button';
import { BOOST_LABELS, BOOSTS } from '@/game/pricing';
import { colors, radius, space } from '@/theme';
import { flagEmoji, isFlag } from '@/utils/flag';
import { gnot, humanDuration } from '@/utils/gnot';

import { boopQuote } from './boop-quote';

export interface BoopChoice { flag: string; boost: number; shot: number }

/** The session's budget for this boop: what is left this hour and when it refills (seconds), when known. */
export interface Budget { left: number; refillsIn: number }

export function BoopPanel({
  pool, realm, me, hasRef, defaultFlag, suggestions, busy, budget, onBoop,
}: {
  pool: Pool; realm?: RealmInfo; me: string; hasRef: boolean; defaultFlag: string; suggestions: string[];
  busy: boolean; budget?: Budget; onBoop: (c: BoopChoice) => void;
}) {
  // the flag follows the default (settings, then country) until the user picks one
  const [picked, setPicked] = useState<string | null>(null);
  const flag = picked ?? defaultFlag;
  const [boostIdx, setBoostIdx] = useState(0);
  const [shotBps, setShotBps] = useState(0);
  const c = caps(pool.version);
  const { bid, shot, odds, gas, clock, total, pause } = useMemo(
    () => boopQuote({ pool, realm, me, hasRef, boostIdx, shotBps }),
    [pool, realm, me, hasRef, boostIdx, shotBps],
  );
  // flags exist from v2 on: elsewhere the field is hidden, so it must not block or be sent
  const badFlag = c.flags && flag !== '' && !isFlag(flag);
  const overBudget = budget !== undefined && total > budget.left;

  return (
    <View style={styles.box}>
      {c.flags ? (
        <View style={styles.row}>
          <Text style={styles.label}>play under</Text>
          <TextInput
            style={styles.flagInput} value={flag} maxLength={2} autoCapitalize="characters"
            onChangeText={(t) => setPicked(t.toUpperCase())} placeholder="FR" placeholderTextColor={colors.muted}
          />
          <Text style={styles.flagEmoji}>{flagEmoji(flag)}</Text>
          {suggestions.filter(isFlag).slice(0, 6).map((cc) => (
            <Pressable key={cc} onPress={() => setPicked(cc)}><Text style={styles.chip}>{flagEmoji(cc)}</Text></Pressable>
          ))}
        </View>
      ) : null}
      <Text style={styles.label}>your clock</Text>
      <View style={styles.row}>
        {BOOST_LABELS.map((l, i) => (
          <Pressable key={l} onPress={() => setBoostIdx(i)}>
            <Text style={[styles.chip, i === boostIdx && styles.chipOn]}>{l}</Text>
          </Pressable>
        ))}
      </View>
      {c.shots ? (
        <>
          <Text style={styles.label}>shoot it</Text>
          {pause ? <Text style={styles.muted}>{pause}</Text> : (
            <View style={styles.row}>
              {[0, 25, 50, 100].map((b) => (
                <Pressable key={b} onPress={() => setShotBps(b)}>
                  <Text style={[styles.chip, b === shotBps && styles.chipOn]}>{b === 0 ? 'no shot' : `${(b / 100).toFixed(2)}%`}</Text>
                </Pressable>
              ))}
            </View>
          )}
          {shot ? <Text style={styles.muted}>{(odds / 100).toFixed(2)}% to pop it · {gnot(shot)} · revealed a few blocks after your boop</Text> : null}
        </>
      ) : null}
      <Text style={styles.muted}>
        clock {humanDuration(clock)} · fee ~{gnot(gas.fee)} · total {gnot(total)} (+ storage)
      </Text>
      {overBudget ? (
        <Text style={styles.warn}>
          Your session has {gnot(budget.left)} left this hour
          {budget.refillsIn > 0 ? ` (it refills in ${humanDuration(budget.refillsIn)})` : ''}: not enough for this boop.
          Pick a smaller one, or raise the budget from the Session tab.
        </Text>
      ) : null}
      <Button
        title={`${shot ? 'boop & shoot' : 'boop'} ${gnot(bid + shot)}`}
        disabled={busy || badFlag || overBudget}
        onPress={() => onBoop({ flag: c.flags && isFlag(flag) ? flag : '', boost: BOOSTS[boostIdx], shot })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.s },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s },
  label: { color: colors.muted, fontSize: 12 },
  muted: { color: colors.muted },
  warn: { color: colors.accent },
  flagInput: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.s, width: 56, textAlign: 'center' },
  flagEmoji: { fontSize: 22 },
  chip: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, paddingVertical: space.xs, paddingHorizontal: space.m },
  chipOn: { borderColor: colors.ring, color: colors.ring },
});
