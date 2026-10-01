import { Text } from 'react-native';

import { useNow } from '@/hooks/use-now';
import { colors } from '@/theme';
import { humanDuration } from '@/utils/gnot';

export function Countdown({ until, overText = 'closed' }: { until: number; overText?: string }) {
  const now = useNow();
  const left = until - now;
  const color = left <= 0 ? colors.muted : left < 300 ? colors.bad : colors.accent;
  return <Text style={{ color, fontVariant: ['tabular-nums'] }}>{left <= 0 ? overText : `${humanDuration(left)} left`}</Text>;
}
