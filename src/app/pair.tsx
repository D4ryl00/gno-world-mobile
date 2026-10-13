import { PairScreen } from '@/screens/pair';
import { useChat, useServices } from '@/state/app-services';

export default function PairRoute() {
  const { sync } = useServices();
  const identity = useChat((c) => c.identity);
  return <PairScreen store={sync} identity={identity} />;
}
