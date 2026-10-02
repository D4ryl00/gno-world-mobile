import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Pool, RealmInfo } from '@/chain/parse';
import { caps } from '@/chain/realms';
import { Button } from '@/components/button';
import { BOOST_LABELS, BOOSTS, clockFor, gasFor } from '@/game/pricing';
import { oddsBps, shotFor, shotPause, type ShotInputs } from '@/game/shots';
import { colors, radius, space } from '@/theme';
import { flagEmoji, isFlag } from '@/utils/flag';
import { gnot, humanDuration } from '@/utils/gnot';

export interface BoopChoice { flag: string; boost: number; shot: number }

export function BoopPanel({
  pool, realm, me, hasRef, defaultFlag, suggestions, busy, onBoop,
}: {
  pool: Pool; realm?: RealmInfo; me: string; hasRef: boolean; defaultFlag: string; suggestions: string[];
  busy: boolean; onBoop: (c: BoopChoice) => void;
}) {
  const [flag, setFlag] = useState(defaultFlag);
  const [boostIdx, setBoostIdx] = useState(0);
  const [shotBps, setShotBps] = useState(0);
  const c = caps(pool.version);
  const bid = pool.nextPrice * BOOSTS[boostIdx];

  const inputs = useMemo<ShotInputs>(() => ({
    version: pool.version, pot: pool.pot, bids: pool.bids, liveBps: pool.liveBps,
    roster: pool.roster.map((m) => ({ addr: m.addr, paid: m.paid })), me, hasRef,
    revealTip: realm?.split.revealTip ?? 20000, minShot: realm?.split.minShot ?? 100000,
  }), [pool, me, hasRef, realm]);
  const pause = c.shots && realm
    ? shotPause(inputs, {
        shotsOn: realm.shotsOn, commitsFree: realm.commitsFree, keeperSeen: realm.keeperSeen,
        keeperFresh: realm.split.keeperFresh ?? 300, liveFloor: realm.split.liveFloor ?? 2500, now: realm.now,
      })
    : 'shots are not sold on this bubble';
  const shot = useMemo(() => (shotBps && !pause ? shotFor(inputs, shotBps, bid) : 0), [shotBps, pause, bid, inputs]);
  const odds = shot ? oddsBps(inputs, bid, shot) : 0;
  const gas = gasFor('Bid', pool);
  const clock = clockFor(pool.window, pool.nextPrice, bid);

  return (
    <View style={styles.box}>
      {c.flags ? (
        <View style={styles.row}>
          <Text style={styles.label}>play under</Text>
          <TextInput
            style={styles.flagInput} value={flag} maxLength={2} autoCapitalize="characters"
            onChangeText={(t) => setFlag(t.toUpperCase())} placeholder="FR" placeholderTextColor={colors.muted}
          />
          <Text style={styles.flagEmoji}>{flagEmoji(flag)}</Text>
          {suggestions.filter(isFlag).slice(0, 6).map((cc) => (
            <Pressable key={cc} onPress={() => setFlag(cc)}><Text style={styles.chip}>{flagEmoji(cc)}</Text></Pressable>
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
          {shot ? <Text style={styles.muted}>{(odds / 100).toFixed(2)}% to pop it · {gnot(shot)} · revealed ~20 s after your boop</Text> : null}
        </>
      ) : null}
      <Text style={styles.muted}>
        clock {humanDuration(clock)} · fee ~{gnot(gas.fee)} · total {gnot(bid + shot + gas.fee)} (+ storage)
      </Text>
      <Button
        title={`${shot ? 'boop & shoot' : 'boop'} ${gnot(bid + shot)}`}
        disabled={busy || (flag !== '' && !isFlag(flag))}
        onPress={() => onBoop({ flag: isFlag(flag) ? flag : '', boost: BOOSTS[boostIdx], shot })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.s },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s },
  label: { color: colors.muted, fontSize: 12 },
  muted: { color: colors.muted },
  flagInput: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, padding: space.s, width: 56, textAlign: 'center' },
  flagEmoji: { fontSize: 22 },
  chip: { color: colors.fg, borderColor: colors.line, borderWidth: 1, borderRadius: radius.s, paddingVertical: space.xs, paddingHorizontal: space.m },
  chipOn: { borderColor: colors.ring, color: colors.ring },
});
