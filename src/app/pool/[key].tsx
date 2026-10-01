import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { PoolScreen } from '@/screens/pool';
import { settingsStore } from '@/state/settings';

export default function PoolRoute() {
  const { key, ref } = useLocalSearchParams<{ key: string; ref?: string }>();
  useEffect(() => {
    if (ref) settingsStore.getState().setRefOnce(ref);
  }, [ref]);
  return <PoolScreen poolKey={key} />;
}
