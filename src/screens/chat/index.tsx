import { useServices } from '@/state/app-services';
import { useSettings } from '@/state/settings';

import { ChatPane } from './chat-pane';

export function ChatScreen() {
  const { chat } = useServices();
  const offchainUrl = useSettings((s) => s.offchainUrl);
  return <ChatPane store={chat} offchainUrl={offchainUrl} />;
}
