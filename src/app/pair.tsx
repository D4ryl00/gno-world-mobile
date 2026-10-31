import { PairScreen } from '@/screens/pair';
import { useIdentity, useServices } from '@/state/app-services';

export default function PairRoute() {
  const { sync } = useServices();
  const identity = useIdentity((c) => c.identity);
  return <PairScreen store={sync} identity={identity} />;
}
