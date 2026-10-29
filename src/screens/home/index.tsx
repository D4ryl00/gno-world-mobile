import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet } from 'react-native';

import { fetchPrices, fetchWhere, PRICES_EVERY_MS, WHERE_EVERY_MS, type PriceDays } from '@/offchain/home';
import { useServices } from '@/state/app-services';
import { colors, space } from '@/theme';

import { ChatCard } from './chat-card';
import { HereCard } from './here-card';
import { PriceCard } from './price-card';
import { usePoll } from './use-poll';

export function HomeScreen() {
  const { offchain } = useServices();
  const [days, setDays] = useState<PriceDays>(1);
  const prices = usePoll(() => fetchPrices(offchain, days), PRICES_EVERY_MS, String(days));
  const where = usePoll(() => fetchWhere(offchain), WHERE_EVERY_MS);
  const [refreshing, setRefreshing] = useState(false);

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={
        <RefreshControl
          tintColor={colors.fg}
          refreshing={refreshing}
          onRefresh={async () => {
            setRefreshing(true);
            await Promise.all([prices.refresh(), where.refresh()]);
            setRefreshing(false);
          }}
        />
      }>
      <PriceCard
        data={prices.data} stale={prices.stale} failed={prices.failed} days={days} onDays={setDays}
        onOpen={() => router.push({ pathname: '/home/price', params: { days: String(days) } })}
      />
      <HereCard data={where.data} failed={where.failed} onOpen={() => router.push('/home/here')} />
      <ChatCard />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: space.l, gap: space.m },
});
