import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Share, StyleSheet, Text } from 'react-native';

import type { Pool, RealmInfo } from '@/chain/parse';
import { parsePoolKey } from '@/chain/realms';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Countdown } from '@/components/countdown';
import { useNow } from '@/hooks/use-now';
import { isPlayBlocked, NOPLAY_TEXT, usePresence } from '@/offchain/presence';
import { remaining, resetsIn } from '@/session/status';
import { useServices, useSession } from '@/state/app-services';
import { settingsStore, useSettings } from '@/state/settings';
import { colors, space } from '@/theme';
import { shortAddr } from '@/utils/address';
import { flagEmoji } from '@/utils/flag';
import { gnot } from '@/utils/gnot';
import { shareText, shareUrl } from '@/utils/share';

import { BoopPanel, type BoopChoice } from './boop-panel';
import { checkFresh } from './boop-quote';
import { History, Roster, Rules, Shots, Split } from './sections';
import { txMessage } from './tx-message';
import { flagSuggestions } from './flag-suggestions';
import { createTxRunner } from './tx-runner';

export function PoolScreen({ poolKey }: { poolKey: string }) {
  const k = useMemo(() => parsePoolKey(poolKey), [poolKey]);
  const { game } = useServices();
  const active = useSession((s) => s.active);
  const status = useSession((s) => s.status);
  const refresh = useSession((s) => s.refresh);
  const country = usePresence((s) => s.country);
  const flag = useSettings((s) => s.flag);
  const ref = useSettings((s) => s.ref);
  const now = useNow();
  const [pool, setPool] = useState<Pool | null>(null);
  const [realm, setRealm] = useState<RealmInfo | undefined>();
  const [msg, setMsg] = useState(''); // the last action's outcome
  const [loadError, setLoadError] = useState(''); // the last refresh's failure, cleared by the next good one
  const [busy, setBusy] = useState(false);
  const chainId = useSettings((s) => s.chainId);
  // a session made on another network is not "you" here
  const me = active && active.chainId === chainId ? active.master : '';

  const load = useCallback(async () => {
    if (!k) return;
    try {
      const [p, r] = await Promise.all([game.pool(k.version, k.id), game.realm(k.version).catch(() => undefined)]);
      setPool(p);
      setRealm((before) => r ?? before); // a realm read that failed once keeps the shot prices on screen
      setLoadError('');
    } catch (e) {
      setLoadError(String((e as Error).message ?? e));
    }
  }, [game, k]);

  // every 10 s while the screen is shown, and at once on coming back to it
  useFocusEffect(
    useCallback(() => {
      void load();
      const t = setInterval(load, 10000);
      return () => clearInterval(t);
    }, [load]),
  );

  // one runner for the screen's life: it keeps the transaction in flight across renders
  const [runner] = useState(() => createTxRunner(setBusy));
  const reload = () => Promise.all([load(), refresh().catch(() => undefined)]);

  if (!k) return <Text style={styles.warn}>Unknown pool {poolKey}</Text>;
  if (!pool) return <Text style={styles.muted}>{loadError || 'loading…'}</Text>;

  /** `f` may return a sentence instead of signing (nothing sent, e.g. the price moved). */
  const run = (label: string, f: () => Promise<unknown>) =>
    runner(async () => {
      setMsg(`${label}…`);
      try {
        const said = await f();
        setMsg(typeof said === 'string' ? said : `${label} — done`);
      } catch (e) {
        setMsg(txMessage(e, now, (await refresh().catch(() => null)) ?? status));
      }
    }, reload);

  const effectiveRef = ref && ref !== me ? ref : '';
  const onBoop = (c: BoopChoice) =>
    run('boop', async () => {
      // the amount comes from the pool on screen: sign it only if the chain still asks that price
      const fresh = await game.pool(pool.version, pool.id);
      const stale = checkFresh(pool, fresh);
      if (stale) {
        setPool(fresh);
        return stale;
      }
      if (c.flag) settingsStore.getState().setFlag(c.flag);
      await game.bid(active!, pool, { ref: effectiveRef, flag: c.flag, boost: c.boost, shot: c.shot });
    });

  const closedUnpaid = pool.over && !pool.paid && !pool.cancelled;
  const canCancel = !!active && pool.creator === me && pool.bids === 0 && !pool.cancelled;
  const live = !pool.over && !pool.cancelled;
  const blocked = isPlayBlocked(country);
  const suggestions = flagSuggestions(country, pool.teams);
  const elsewhere = !!active && active.chainId !== chainId;
  const budget = status && !elsewhere ? { left: remaining(status, now), refillsIn: resetsIn(status, now) } : undefined;

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Card>
        <Text style={styles.name}>{pool.name}</Text>
        <Text style={styles.pot}>{gnot(pool.pot)}</Text>
        <Text style={styles.muted}>
          v{pool.version} · {pool.bids} boops · {pool.bidders} boopers · creator {shortAddr(pool.creator)}
        </Text>
        {pool.lastBidder ? (
          <Text style={styles.t}>{flagEmoji(pool.flag)} {pool.lastBidder === me ? 'you are' : `${shortAddr(pool.lastBidder)} is`} on top</Text>
        ) : null}
        {live && pool.bids > 0 ? <Countdown until={pool.deadline} /> : null}
        {pool.life && pool.bids > 0 ? <Text style={styles.muted}>winner&apos;s share {(pool.liveBps / 100).toFixed(0)}%</Text> : null}
        {pool.cancelled ? <Text style={styles.warn}>cancelled</Text> : null}
        {pool.over ? <Text style={styles.t}>{pool.popped ? 'popped' : 'won'} by {shortAddr(pool.lastBidder)}{pool.paid ? '' : ' — unclaimed'}</Text> : null}
      </Card>

      {live ? (
        <Card>
          {blocked ? (
            <Text style={styles.warn}>{NOPLAY_TEXT}</Text>
          ) : !active ? (
            <Link href="/session" style={styles.link}>Set up a session to play →</Link>
          ) : elsewhere ? (
            <>
              <Text style={styles.t}>
                Your session is for {active.chainId}. Switch back to it in Settings, or get a session for {chainId}.
              </Text>
              <Link href="/session" style={styles.link}>Get a session for {chainId} →</Link>
            </>
          ) : (
            <BoopPanel
              pool={pool} realm={realm} me={me} hasRef={!!effectiveRef} defaultFlag={flag || country}
              suggestions={suggestions} busy={busy} budget={budget} onBoop={onBoop}
            />
          )}
        </Card>
      ) : null}

      {closedUnpaid && active ? <Button title="claim" disabled={busy} onPress={() => run('claim', () => game.claim(active, pool))} /> : null}
      {canCancel ? <Button kind="danger" title="cancel this pool" disabled={busy} onPress={() => run('cancel', () => game.cancel(active!, pool))} /> : null}
      {msg ? <Text style={styles.msg}>{msg}</Text> : null}
      {loadError ? <Text style={styles.warn}>Could not refresh this pool: {loadError}</Text> : null}

      <Button
        kind="secondary" title="share"
        onPress={() => {
          const url = shareUrl(pool.key, me || ref);
          void Share.share({ message: shareText(pool.name, pool.pot, url) });
        }}
      />
      <Split pool={pool} />
      <History pool={pool} me={me} />
      <Roster pool={pool} me={me} />
      <Shots pool={pool} />
      <Rules pool={pool} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
  name: { color: colors.fg, fontSize: 20, fontWeight: '800' },
  pot: { color: colors.accent, fontSize: 28, fontWeight: '900' },
  t: { color: colors.fg },
  muted: { color: colors.muted, padding: space.l },
  warn: { color: colors.accent },
  link: { color: colors.ring, fontWeight: '700' },
  msg: { color: colors.fg },
});
