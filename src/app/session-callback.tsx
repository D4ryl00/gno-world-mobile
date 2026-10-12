import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { parseReplyEntries } from '@/session/gnoconnect';
import { useServices } from '@/state/app-services';

export default function SessionCallback() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { session, chat } = useServices();
  useEffect(() => {
    const entries: [string, string][] = Object.entries(params).flatMap(([k, v]) =>
      (Array.isArray(v) ? v : [v]).map((x) => [k, String(x)] as [string, string]),
    );
    const reply = parseReplyEntries(entries);
    void (async () => {
      // the chat's challenge comes back here too: its state says whose it is
      if (reply && (await chat.getState().onProofReply(reply).catch(() => false))) {
        router.replace('/chat');
        return;
      }
      if (reply) await session.getState().onReply(reply).catch(() => undefined);
      router.replace('/session');
    })();
    // a reply is handled once, on arrival; this screen leaves at once and never sees new params
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
