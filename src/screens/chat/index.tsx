import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';

import { useServices, useSession } from '@/state/app-services';
import { useSettings } from '@/state/settings';

import { ChatPane } from './chat-pane';
import { IdentitySheet } from './identity-sheet';

export function ChatScreen() {
  const { chat } = useServices();
  const offchainUrl = useSettings((s) => s.offchainUrl);
  const active = useSession((s) => s.active);
  // `identity=1`: back from the wallet with a proof, its outcome is on the sheet
  // (Android may have rebuilt this screen, and the sheet with it, meanwhile)
  const { identity: askIdentity } = useLocalSearchParams<{ identity?: string }>();
  const [sheet, setSheet] = useState(false);
  const [asked, setAsked] = useState<string>();
  if (askIdentity !== asked) {
    setAsked(askIdentity);
    if (askIdentity === '1') setSheet(true);
  }
  // spent: the next proof asks again
  useEffect(() => {
    if (askIdentity === '1') router.setParams({ identity: undefined });
  }, [askIdentity]);
  return (
    <>
      <ChatPane store={chat} offchainUrl={offchainUrl} onOpenIdentity={() => setSheet(true)} identityOpen={sheet} />
      <IdentitySheet store={chat} visible={sheet} onClose={() => setSheet(false)} offchainUrl={offchainUrl} identity={active?.master ?? ''} />
    </>
  );
}
