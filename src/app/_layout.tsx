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
          <Stack.Screen name="pair" options={{ title: 'Pair with a browser', headerBackTitle: 'Chat' }} />
          <Stack.Screen name="rooms/new" options={{ title: 'New room', presentation: 'formSheet' }} />
          <Stack.Screen name="session-callback" options={{ headerShown: false }} />
          {/* Home's cards, full screen: an iOS sheet you swipe down to close; not the price, whose crosshair a sheet
              would steal (iOS drags a sheet, even a locked one, on any downward slide) — it closes with ✕ */}
          <Stack.Screen name="home/price" options={{ presentation: 'fullScreenModal', headerShown: false }} />
          <Stack.Screen name="home/here" options={{ presentation: 'modal', headerShown: false }} />
          <Stack.Screen name="home/chat" options={{ presentation: 'modal', headerShown: false }} />
        </Stack>
      </AppServices>
    </GnoNativeProvider>
  );
}
