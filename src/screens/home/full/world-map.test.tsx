import { render, screen } from '@testing-library/react-native';

import { WorldMap } from '@/screens/home/full/world-map';

test('one dot per place, bigger for more people', async () => {
  await render(
    <WorldMap
      width={360}
      spots={[
        { cc: 'FR', lat: 48.5, lon: 1.5, n: 1 },
        { cc: 'FR', lat: 48.75, lon: 2.25, n: 3 },
      ]}
    />,
  );
  const dots = screen.getAllByTestId('map-spot');
  expect(dots).toHaveLength(2);
  expect(Number(dots[1].props.r)).toBeGreaterThan(Number(dots[0].props.r));
  expect(screen.getByTestId('map-land')).toBeTruthy();
});

test('no places, no dots', async () => {
  await render(<WorldMap width={360} spots={[]} />);
  expect(screen.queryAllByTestId('map-spot')).toHaveLength(0);
  expect(screen.getByTestId('map-land')).toBeTruthy();
});

test('a crowded place does not cover its region', async () => {
  await render(<WorldMap width={360} spots={[{ cc: 'FR', lat: 48.5, lon: 1.5, n: 100 }]} />);
  expect(Number(screen.getByTestId('map-spot').props.r)).toBeLessThanOrEqual(6);
});
