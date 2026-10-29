import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { Prices } from '@/offchain/home';
import { colors } from '@/theme';

import { formatPrice, labelAnchor, niceTicks, priceScale, timeTicks } from '../format';
import { useCrosshair } from './use-crosshair';

const AXIS_W = 46; // the price labels on the right
const TIME_H = 18; // the time labels at the bottom
const TOP = 8;
const VOL_SHARE = 0.2; // volume bars take the bottom fifth, under the line (the site leaves the line 26% above them)

const axisLabel = (p: number) => formatPrice(p).slice(1);

/**
 * The full-screen price chart: line and area, price axis right, time axis below, volume bars at the bottom. Hold and
 * slide to pick a point: `onPick` gets its index (null when the finger lifts), `picked` draws the crosshair on it.
 */
export function PriceChart({ data, color, picked = null, onPick }: {
  data: Prices; color: string; picked?: number | null; onPick?(i: number | null): void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const drawn = useMemo(() => {
    const { width, height } = size;
    if (!width || !height || data.series.length < 2) return null;
    const right = width - AXIS_W;
    const bottom = height - TIME_H;
    const volH = (bottom - TOP) * VOL_SHARE;
    const scale = priceScale(data.series, { left: 0, right, top: TOP, bottom: bottom - volH - 4 });
    const line = data.series.map(([t, p], i) => `${i ? 'L' : 'M'}${scale.x(t).toFixed(1)} ${scale.y(p).toFixed(1)}`).join('');
    const base = bottom - volH - 4;
    const area = `${line}L${right} ${base}L0 ${base}Z`;
    const maxVol = Math.max(0, ...data.volumes.map(([, v]) => v));
    const bars = maxVol
      ? data.volumes
          .filter(([, v]) => v > 0)
          .map(([t, v]) => `M${scale.x(t).toFixed(1)} ${bottom}V${(bottom - (v / maxVol) * volH).toFixed(1)}`)
          .join('')
      : '';
    const barW = Math.max(1, (right / Math.max(1, data.volumes.length)) * 0.7);
    const prices = niceTicks(scale.min, scale.max, 5);
    // the period of the data drawn: while another period loads, these are still the old one's
    const times = timeTicks(data.series[0][0], data.series[data.series.length - 1][0], data.days);
    return { scale, line, area, bars, barW, prices, times, right, bottom };
  }, [size, data]);
  const { responder } = useCrosshair({ onPick: (px) => onPick?.(px === null || !drawn ? null : drawn.scale.nearestIndex(px)) });
  const point = drawn && picked !== null ? data.series[picked] : undefined;

  return (
    <View testID="full-chart" style={styles.box} onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} {...responder}>
      {drawn && (
        // touches go to the view, so the finger's x is in the view's frame
        <Svg width={size.width} height={size.height} pointerEvents="none">
          {drawn.prices.map((p) => (
            <Line key={`g${p}`} x1={0} x2={drawn.right} y1={drawn.scale.y(p)} y2={drawn.scale.y(p)} stroke="#ffffff10" />
          ))}
          {drawn.prices.map((p) => (
            <SvgText key={`p${p}`} x={drawn.right + 4} y={drawn.scale.y(p) + 3} fill={colors.muted} fontSize={10}>{axisLabel(p)}</SvgText>
          ))}
          {drawn.times.map(({ t, label }) => (
            <SvgText key={`t${t}`} x={drawn.scale.x(t)} y={size.height - 4} fill={colors.muted} fontSize={10} textAnchor={labelAnchor(drawn.scale.x(t), label, drawn.right)}>{label}</SvgText>
          ))}
          <Path testID="vol-bars" d={drawn.bars} stroke={color} strokeOpacity={0.35} strokeWidth={drawn.barW} />
          <Path d={drawn.area} fill={color} fillOpacity={0.08} />
          <Path d={drawn.line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
          {point && (
            <>
              <Line x1={drawn.scale.x(point[0])} x2={drawn.scale.x(point[0])} y1={TOP} y2={drawn.bottom} stroke={colors.fg} strokeOpacity={0.6} strokeDasharray="3 3" />
              <Line x1={0} x2={drawn.right} y1={drawn.scale.y(point[1])} y2={drawn.scale.y(point[1])} stroke={colors.fg} strokeOpacity={0.6} strokeDasharray="3 3" />
              <Circle cx={drawn.scale.x(point[0])} cy={drawn.scale.y(point[1])} r={4} fill={color} />
              <Rect x={drawn.right} y={drawn.scale.y(point[1]) - 8} width={AXIS_W} height={16} rx={3} fill={colors.fg} />
              <SvgText x={drawn.right + 4} y={drawn.scale.y(point[1]) + 4} fill={colors.bg} fontSize={10}>{axisLabel(point[1])}</SvgText>
            </>
          )}
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1 },
});
