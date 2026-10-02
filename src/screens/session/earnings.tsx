import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';

import type { Me } from '@/chain/parse';
import { caps, VERSIONS, type Version } from '@/chain/realms';
import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { txMessage } from '@/screens/pool/tx-message';
import { createTxRunner } from '@/screens/pool/tx-runner';
import type { ActiveSession } from '@/session/types';
import { useServices } from '@/state/app-services';
import { colors, space } from '@/theme';
import { gnot } from '@/utils/gnot';

export function Earnings({ session }: { session: ActiveSession }) {
  const { game } = useServices();
  const [mes, setMes] = useState<Partial<Record<Version, Me>>>({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const load = useCallback(async () => {
    const out: Partial<Record<Version, Me>> = {};
    await Promise.all(VERSIONS.filter((v) => caps(v).me).map(async (v) => {
      const m = await game.me(v, session.master).catch(() => null);
      if (m && (m.bids || m.owed || m.won)) out[v] = m;
    }));
    if (mounted.current) setMes(out);
  }, [game, session.master]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // One withdraw at a time; the buttons stay disabled until the earnings are reloaded.
  const [runner] = useState(() => createTxRunner(setBusy)); // setBusy after unmount is a no-op

  const rows = VERSIONS.filter((v) => mes[v]);
  return (
    <Card>
      <Text style={{ color: colors.fg, fontWeight: '700' }}>Your earnings</Text>
      {!rows.length ? <Text style={{ color: colors.muted }}>No boops yet.</Text> : null}
      {rows.map((v) => {
        const m = mes[v]!;
        return (
          <View key={v} style={{ gap: space.xs }}>
            <Text style={{ color: colors.fg }}>
              v{v} · {m.bids} boops · put in {gnot(m.paid)} · dividends {gnot(m.divEarned)} · invites {gnot(m.refEarned)} · won {gnot(m.won)}
            </Text>
            {caps(v).withdraw && m.owed > 0 ? (
              <Button
                title={`withdraw ${gnot(m.owed)}`}
                disabled={busy}
                onPress={() =>
                  void runner(async () => {
                    try {
                      await game.withdraw(session, v);
                      if (mounted.current) setMsg(`withdrew ${gnot(m.owed)}`);
                    } catch (e) {
                      if (mounted.current) setMsg(txMessage(e, Math.floor(Date.now() / 1000)));
                    }
                  }, load)
                }
              />
            ) : null}
          </View>
        );
      })}
      {msg ? <Text style={{ color: colors.fg }}>{msg}</Text> : null}
    </Card>
  );
}
