import { useState } from 'react';

import { useServices, useSession } from '@/state/app-services';
import { useSettings } from '@/state/settings';

import { ChatPane } from './chat-pane';
import { IdentitySheet } from './identity-sheet';

export function ChatScreen() {
  const { chat } = useServices();
  const offchainUrl = useSettings((s) => s.offchainUrl);
  const active = useSession((s) => s.active);
  const [sheet, setSheet] = useState(false);
  return (
    <>
      <ChatPane store={chat} offchainUrl={offchainUrl} onOpenIdentity={() => setSheet(true)} identityOpen={sheet} />
      <IdentitySheet store={chat} visible={sheet} onClose={() => setSheet(false)} offchainUrl={offchainUrl} identity={active?.master ?? ''} />
    </>
  );
}
