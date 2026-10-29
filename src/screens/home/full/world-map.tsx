import Svg, { Circle, Path } from 'react-native-svg';

import type { Spot } from '@/offchain/home';
import { colors } from '@/theme';

import { LAND_PATH } from './world-land';

// x = longitude, y = −latitude, from 84° N down to 60° S (no Antarctica)
const VIEW = { x: -180, y: -84, w: 360, h: 144 };

/** Radius in map degrees; the square root and the cap keep a crowded place from covering its neighbours. */
const radius = (n: number) => Math.min(6, 1.5 + 1.5 * Math.sqrt(n));

export function WorldMap({ spots, width }: { spots: Spot[]; width: number }) {
  return (
    <Svg width={width} height={(width * VIEW.h) / VIEW.w} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}>
      <Path testID="map-land" d={LAND_PATH} fill={colors.line} />
      {spots.map((s, i) => (
        <Circle key={i} testID="map-spot" cx={s.lon} cy={-s.lat} r={radius(s.n)} fill={colors.accent} fillOpacity={0.85} />
      ))}
    </Svg>
  );
}
