import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { HomeScreen } from '@/screens/home';
import { settingsStore } from '@/state/settings';

export default function HomeRoute() {
  // links that open the app on '/' carry the referrer
  const { ref } = useLocalSearchParams<{ ref?: string }>();
  useEffect(() => {
    if (ref) settingsStore.getState().setRefOnce(ref);
  }, [ref]);
  return <HomeScreen />;
}
