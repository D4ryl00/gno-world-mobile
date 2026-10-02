import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { colors } from '@/theme';

const icon =
  (name: SymbolViewProps['name']) =>
  ({ color, size }: { color: ColorValue; size: number }) => <SymbolView name={name} tintColor={color} size={size} />;

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.fg,
        tabBarStyle: { backgroundColor: colors.bg, borderTopColor: colors.line },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Pools', tabBarIcon: icon({ ios: 'bubbles.and.sparkles', android: 'bubble_chart' }) }} />
      <Tabs.Screen name="session" options={{ title: 'Session', tabBarIcon: icon({ ios: 'key.fill', android: 'key' }) }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon({ ios: 'gearshape.fill', android: 'settings' }) }} />
    </Tabs>
  );
}
