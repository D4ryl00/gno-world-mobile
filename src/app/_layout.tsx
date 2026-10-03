import { GnoNativeProvider } from '@gnolang/gnonative';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import { AppServices } from '@/state/app-services';
import { settingsStore, useSettingsHydrated } from '@/state/settings';
import { colors } from '@/theme';

export default function RootLayout() {
  const hydrated = useSettingsHydrated();
  if (!hydrated) return null;
  const { remote, chainId } = settingsStore.getState();
  return (
    <GnoNativeProvider config={{ remote, chain_id: chainId }}>
      <AppServices>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerTintColor: colors.fg,
            contentStyle: { backgroundColor: colors.bg },
          }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="pool/[key]" options={{ title: 'Bubble', headerBackTitle: 'Pools' }} />
          <Stack.Screen name="create" options={{ title: 'New pool', presentation: 'modal' }} />
          <Stack.Screen name="session-callback" options={{ headerShown: false }} />
        </Stack>
      </AppServices>
    </GnoNativeProvider>
  );
}
