import { fireEvent, render, screen } from '@testing-library/react-native';

import type { Prices } from '@/offchain/home';
import { PriceChart } from '@/screens/home/full/price-chart';

test('the time labels follow the period of the data drawn, not the one being loaded', async () => {
  const t0 = new Date(2026, 9, 28, 13, 24).getTime() / 1000;
  const data: Prices = {
    days: 1, now: 0.058, change: 0, cap: 0, fdv: 0, supply: 0, volumes: [],
    series: [[t0, 0.058], [t0 + 43200, 0.059], [t0 + 86400, 0.058]],
  };
  const view = await render(<PriceChart data={data} color="#fff" />);
  await fireEvent(screen.getByTestId('full-chart'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 300 } } });
  // svg text is not host text: read the spans' content
  const labels = view.container.queryAll((n) => n.type === 'RNSVGTSpan').map((n) => n.props.content);
  expect(labels).toEqual(expect.arrayContaining(['18:00', '00:00', '06:00', '12:00']));
});
