import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { parseReplyEntries } from '@/session/gnoconnect';
import { useServices } from '@/state/app-services';

export default function SessionCallback() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  const { session } = useServices();
  useEffect(() => {
    const entries: [string, string][] = Object.entries(params).flatMap(([k, v]) =>
      (Array.isArray(v) ? v : [v]).map((x) => [k, String(x)] as [string, string]),
    );
    const reply = parseReplyEntries(entries);
    if (reply) void session.getState().onReply(reply);
    router.replace('/session');
  }, []);
  return null;
}
