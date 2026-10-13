import { loadFont } from '@remotion/google-fonts/Inter';
import type { ReactNode } from 'react';
import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import { terminalText } from '../lib/terminal-text.ts';
import type { CaptionCue, ZoomKey } from '../lib/types.ts';

export const { fontFamily: font } = loadFont();
export const C = { bg: '#06090e', panel: '#0d141c', green: '#3ddc84', white: '#f2fff7', muted: '#8a9aa8', line: '#1c2834' };

/** The camera: eases from one key to the next over 12 frames. */
export function zoomAt(keys: ZoomKey[], f: number) {
  let i = 0;
  while (i + 1 < keys.length && keys[i + 1].f <= f) i++;
  const cur = keys[i];
  const prev = keys[Math.max(0, i - 1)];
  const k = i === 0 ? 1 : interpolate(f, [cur.f, cur.f + 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic) });
  const mix = (a: number, b: number) => a + (b - a) * k;
  return { scale: mix(prev.scale, cur.scale), cx: mix(prev.cx, cur.cx), cy: mix(prev.cy, cur.cy) };
}

/** An iPhone-shaped frame holding `children` (the screen, at its own aspect ratio), height in px. */
export const PhoneFrame = ({ height, aspect, children }: { height: number; aspect: number; children: ReactNode }) => {
  const width = height * aspect;
  return (
    <div style={{ width: width + 28, height: height + 28, borderRadius: 64, background: '#1b1f24', padding: 14, boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}>
      <div style={{ width, height, borderRadius: 52, overflow: 'hidden', position: 'relative', background: '#000' }}>{children}</div>
    </div>
  );
};

export const Captions = ({ cues }: { cues: CaptionCue[] }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cue = cues.find((c) => f >= c.from && f < c.from + c.duration);
  if (!cue) return null;
  const pop = spring({ frame: f - cue.from, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 56 }}>
      <div style={{
        maxWidth: 1100, padding: '18px 34px', borderRadius: 18, background: 'rgba(13,20,28,.92)', border: `2px solid ${C.green}`,
        color: C.white, fontSize: 40, fontWeight: 700, textAlign: 'center', opacity: pop, transform: `translateY(${(1 - pop) * 20}px)`,
      }}>
        {cue.text}
      </div>
    </AbsoluteFill>
  );
};

export const Terminal = ({ lines }: { lines: { f: number; text: string }[] }) => {
  const f = useCurrentFrame();
  const shown = terminalText(lines.filter((l) => l.f <= f).map((l) => l.text).join(''));
  return (
    <div style={{ width: 760, height: 620, borderRadius: 16, background: '#0b0f14', border: `1px solid ${C.line}`, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,.5)' }}>
      <div style={{ height: 40, background: '#151b22', display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 16 }}>
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 12, height: 12, borderRadius: 6, background: c }} />)}
        <div style={{ color: C.muted, fontSize: 18, marginLeft: 16 }}>gnokey-pair — your computer</div>
      </div>
      <pre style={{ margin: 0, padding: 20, color: C.white, fontSize: 19, lineHeight: 1.35, fontFamily: 'Menlo, monospace', whiteSpace: 'pre-wrap' }}>{shown}</pre>
    </div>
  );
};

export const Logo = ({ size }: { size: number }) => <Img src={staticFile('brand/gno-icon.svg')} style={{ width: size, height: size }} />;
