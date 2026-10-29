import { useLocalSearchParams } from 'expo-router';

import { PRICE_DAYS, type PriceDays } from '@/offchain/home';
import { PriceFull } from '@/screens/home/full/price-full';

export default function PriceRoute() {
  const { days } = useLocalSearchParams<{ days?: string }>();
  // a link with another period (or none) opens on 1 day
  const d = PRICE_DAYS.find((p) => String(p) === days) ?? (1 as PriceDays);
  return <PriceFull initialDays={d} />;
}
