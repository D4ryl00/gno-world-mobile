import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { PoolsScreen } from '@/screens/pools';
import { settingsStore } from '@/state/settings';

export default function PoolsRoute() {
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  useEffect(() => {
    if (ref) settingsStore.getState().setRefOnce(ref);
  }, [ref]);
  return <PoolsScreen />;
}
