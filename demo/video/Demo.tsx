import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';

import type { Edl } from '../lib/types.ts';
import { C, font } from './parts.tsx';
import { SceneView } from './scenes.tsx';

export const Demo = (edl: Edl) => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: font }}>
    {edl.scenes.map((s) => (
      <Sequence key={s.id} from={s.from} durationInFrames={s.duration} name={s.id}>
        <SceneView scene={s} edl={edl} />
        {s.voice ? (
          <Sequence from={s.voice.from}>
            <Audio src={staticFile(s.voice.src)} />
          </Sequence>
        ) : null}
      </Sequence>
    ))}
  </AbsoluteFill>
);
