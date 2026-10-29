import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { unreadCount } from '@/offchain/chat/merge';
import { chatTabLabel } from '@/screens/chat/line-model';
import { useChat } from '@/state/app-services';
import { colors } from '@/theme';

const icon = (name: SymbolViewProps['name']) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <SymbolView name={name} tintColor={color} size={size} />;
  };

export default function TabsLayout() {
  const unread = useChat((s) => unreadCount(s, s.lastSeen, s.mine));
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
      <Tabs.Screen name="index" options={{ title: 'gno.world', tabBarLabel: 'Home', tabBarIcon: icon({ ios: 'house.fill', android: 'home' }) }} />
      <Tabs.Screen name="pools" options={{ title: 'Pools', tabBarIcon: icon({ ios: 'bubbles.and.sparkles', android: 'bubble_chart' }) }} />
      <Tabs.Screen
        name="chat"
        options={{
          title: 'Chat', headerShown: false, tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarAccessibilityLabel: chatTabLabel(unread),
          tabBarIcon: icon({ ios: 'bubble.left.and.bubble.right.fill', android: 'forum' }),
        }}
      />
      <Tabs.Screen name="session" options={{ title: 'Session', tabBarIcon: icon({ ios: 'key.fill', android: 'key' }) }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon({ ios: 'gearshape.fill', android: 'settings' }) }} />
    </Tabs>
  );
}
