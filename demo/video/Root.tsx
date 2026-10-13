import { Composition } from 'remotion';

import type { Edl } from '../lib/types.ts';
import { Demo } from './Demo.tsx';

const EMPTY: Edl = { fps: 30, width: 1920, height: 1080, durationInFrames: 30, video: { width: 1206, height: 2622, duration: 1 }, screen: { width: 402, height: 874 }, scenes: [] };

export const Root = () => (
  <Composition
    id="Demo"
    component={Demo}
    defaultProps={EMPTY}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={30}
    calculateMetadata={({ props }) => ({ durationInFrames: props.durationInFrames, fps: props.fps, width: props.width, height: props.height })}
  />
);
