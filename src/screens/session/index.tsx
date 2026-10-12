import * as Clipboard from 'expo-clipboard';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { ugnot } from '@/chain/api';
import { SESSION_ALLOW_PATHS } from '@/chain/realms';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Page } from '@/components/page';
import { CommandBlock } from '@/components/command-block';
import { Field } from '@/components/field';
import { useNow } from '@/hooks/use-now';
import { revokeCommand } from '@/session/fallback';
import { expiresSoon, missingPaths, remaining, resetsIn } from '@/session/status';
import { useServices, useSession } from '@/state/app-services';
import { useSettings } from '@/state/settings';
import { colors, space } from '@/theme';
import { shortAddr } from '@/utils/address';
import { decodeAddress } from '@/utils/bech32';
import { gnot, humanDuration } from '@/utils/gnot';

import { Earnings } from './earnings';
import { activeCard, errorActions, initialGrant } from './grant';
import { GrantForm } from './grant-form';
import { walletErrorText } from './wallet-error';

export function SessionScreen() {
  const { api } = useServices();
  const chainId = useSettings((x) => x.chainId);
  const s = useSession((x) => x);
  const refresh = useSession((x) => x.refresh);
  const walletError = useSession((x) => x.walletError);
  const takeWalletError = useSession((x) => x.takeWalletError);
  // the account whose balance is shown: only while its session is active on this network
  const shown = s.phase === 'active' && s.active?.chainId === chainId ? s.active.master : '';
  const now = useNow(1000);
  const [master, setMaster] = useState('');
  const [masterErr, setMasterErr] = useState('');
  const [renewing, setRenewing] = useState(false);
  const [topUp, setTopUp] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!shown) return;
    let alive = true;
    const tick = async () => {
      void refresh().catch(() => undefined);
      const acc = await api.queryAccount(decodeAddress(shown)).catch(() => null);
      if (alive) setBalance(acc ? ugnot(acc.accountInfo?.coins) : null);
    };
    void tick();
    const t = setInterval(tick, 15000);
    return () => {
      alive = false;
      clearInterval(t);
      setBalance(null);
    };
  }, [shown, api, refresh]);

  // the wallet answered with an error: the request is over (the store is back on the form or the session);
  // tell the user once, in words
  useEffect(() => {
    const w = walletError && takeWalletError(); // taken once, even if this effect runs twice
    if (!w) return;
    const { title, message } = walletErrorText(w.code, w.op, chainId);
    Alert.alert(title, message);
  }, [walletError, takeWalletError, chainId]);

  const page = (body: ReactNode) => <Page style={styles.page}>{body}</Page>;

  if (s.phase === 'error') {
    const can = errorActions(s.error, !!s.active);
    return page(
      <Card>
        <Text style={styles.warn}>{s.error}</Text>
        {can.forget ? <Button kind="danger" title="Forget this session on this phone" onPress={s.forget} /> : null}
        {can.retry ? <Button title="Retry" onPress={() => void s.restore().catch(() => undefined)} /> : null}
        {can.back ? <Button kind="secondary" title="Back" onPress={s.cancel} /> : null}
      </Card>,
    );
  }

  if (s.phase === 'waiting-wallet')
    return page(
      <Card>
        <Text style={styles.h}>Waiting for gnokey-mobile…</Text>
        <Text style={styles.muted}>
          Approve the request there; it will ask your computer to sign. If gnokey-mobile only shares your account, this
          app shows the command to run instead.
        </Text>
        <Button kind="secondary" title="Use a computer instead" onPress={s.useDesktop} />
        <Button kind="danger" title="Cancel" onPress={s.cancel} />
      </Card>,
    );

  // The desktop route: the command stays visible while the chain is watched. The address is asked only when no
  // one gave it (no wallet installed, or the user left the wallet); after an identity-only `connect` answer, or for a
  // renewal or a revocation, it is already known and the app is already watching.
  if ((s.phase === 'desktop' || s.phase === 'waiting-chain') && s.pending?.via === 'desktop')
    return page(
      <Card>
        <Text style={styles.h}>Run this on your computer</Text>
        <Text style={styles.muted}>
          With gnokey and your account&apos;s key (YOUR_KEY is its name).
          {s.pending.master ? ` Account ${shortAddr(s.pending.master)}.` : ''}
        </Text>
        <CommandBlock command={s.command ?? ''} />
        {s.phase === 'desktop' ? (
          <>
            <Field label="Your account address (g1…)" value={master} onChangeText={setMaster} error={masterErr} />
            <Button kind="secondary" title="Paste" onPress={async () => setMaster((await Clipboard.getStringAsync()).trim())} />
            <Button
              title="I ran it"
              onPress={async () => {
                setMasterErr('');
                try {
                  await s.submitMaster(master);
                } catch (e) {
                  setMasterErr((e as Error).message);
                }
              }}
            />
          </>
        ) : (
          <Text style={styles.muted}>Waiting for the chain…</Text>
        )}
        <Button kind="danger" title="Cancel" onPress={s.cancel} />
      </Card>,
    );

  if (s.phase === 'waiting-chain')
    return page(
      <Card>
        <Text style={styles.h}>Waiting for the chain…</Text>
        <Text style={styles.muted}>The session appears a few seconds after the transaction lands.</Text>
        <Button kind="danger" title="Cancel" onPress={s.cancel} />
      </Card>,
    );

  if (s.phase === 'active' && s.active) {
    const st = s.status;
    const card = activeCard(s.active.chainId, chainId, !!st);
    if (card === 'other-chain')
      return page(
        <Card>
          <Text style={styles.h}>Session on another network</Text>
          <Text style={styles.t}>
            This session was made on {s.active.chainId}. Switch to that network in Settings to use it.
          </Text>
          <Text style={styles.muted}>
            Your session on {s.active.chainId} stays valid on that chain until it expires; this phone will forget it. You
            can revoke it from your wallet.
          </Text>
          <GrantForm submitLabel={`Get a session for ${chainId}`} onSubmit={(g) => void s.begin('create', g)} />
        </Card>,
      );
    return page(
      <>
        <Card>
          <Text style={styles.h}>Session active</Text>
          <Text style={styles.t}>Account {shortAddr(s.active.master)} on {s.active.chainId}</Text>
          {!st ? <Text style={styles.muted}>Could not read the session from the chain — retrying.</Text> : null}
          {st ? (
            <>
              <Text style={styles.t}>
                {gnot(remaining(st, now))} of {gnot(st.spendLimit)} left this hour
                {resetsIn(st, now) > 0 ? ` · refills in ${humanDuration(resetsIn(st, now))}` : ''}
              </Text>
              <Text style={expiresSoon(st, now) ? styles.warn : styles.muted}>
                {st.expiresAt ? `expires in ${humanDuration(st.expiresAt - now)}` : 'no expiry'}
              </Text>
              {missingPaths(st, SESSION_ALLOW_PATHS).length > 0 ? (
                <Text style={styles.warn}>
                  {"This session does not cover all of gno.world's realms — some actions will be refused. Renew it to grant them."}
                </Text>
              ) : null}
            </>
          ) : null}
          {balance !== null ? <Text style={styles.muted}>account balance {gnot(balance)}</Text> : null}
          <Button kind="secondary" title="Renew / change the budget" onPress={() => setRenewing(!renewing)} />
          {renewing ? (
            <GrantForm
              submitLabel="Renew the session" initial={initialGrant(st, now)}
              onSubmit={(g) => { setRenewing(false); void s.begin('replace', g); }}
            />
          ) : null}
          <Button kind="secondary" title="Top up" onPress={() => setTopUp(!topUp)} />
          {topUp ? (
            <>
              <Text selectable style={styles.t}>{s.active.master}</Text>
              <Text style={styles.muted}>Send GNOT to this address from any wallet or exchange.</Text>
              <QRCode value={s.active.master} size={200} backgroundColor="#fff" color="#000" />
            </>
          ) : null}
          <Button
            kind="danger" title="Revoke"
            onPress={() =>
              Alert.alert('Revoke this session?', 'gno.world will no longer play from this phone until you get a new session.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Revoke', style: 'destructive', onPress: () => void s.revoke() },
              ])
            }
          />
        </Card>
        {s.previous ? <PreviousSession /> : null}
        <Earnings session={s.active} />
      </>,
    );
  }

  return page(
    <Card>
      <Text style={styles.h}>Play from this phone</Text>
      <Text style={styles.muted}>
        gno.world gets its own key, which your account authorises once, with a budget and an expiry. Boops are then
        signed here, without opening a wallet each time. Your account key never leaves your computer.
      </Text>
      <GrantForm submitLabel="Get a session from gnokey-mobile" onSubmit={(g) => void s.begin('create', g)} />
    </Card>,
  );
}

/** A renewal left the old session on chain (its revoke did not go through): it can still spend until revoked. */
function PreviousSession() {
  const previous = useSession((x) => x.previous)!;
  const dismissPrevious = useSession((x) => x.dismissPrevious);
  const remote = useSettings((x) => x.remote);
  const [note, setNote] = useState('');
  return (
    <Card>
      <Text style={styles.h}>Your previous session is still active</Text>
      <Text style={styles.muted}>
        The renewal created the new session, but the old one was not revoked. It can still spend its budget until it
        expires. Revoke it with gnokey:
      </Text>
      <CommandBlock command={revokeCommand(previous.pubkey, { chainId: previous.chainId, remote })} />
      <Button
        kind="secondary" title="I revoked it"
        onPress={async () => setNote((await dismissPrevious()) ? '' : 'It is still on chain — run the command first.')}
      />
      {note ? <Text style={styles.warn}>{note}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.l },
  h: { color: colors.fg, fontSize: 18, fontWeight: '800' },
  t: { color: colors.fg },
  muted: { color: colors.muted },
  warn: { color: colors.accent },
});
