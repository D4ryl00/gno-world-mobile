import { AbsoluteFill, Freeze, Img, OffthreadVideo, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

import type { Edl, EdlScene } from '../lib/types.ts';
import { originFor } from '../lib/zoom.ts';
import { C, Captions, Logo, PhoneFrame, Terminal, zoomAt } from './parts.tsx';

const Screen = ({ scene, edl }: { scene: EdlScene; edl: Edl }) => {
  const f = useCurrentFrame();
  const c = scene.clip!;
  const z = zoomAt(scene.zoom, f);
  const played = scene.duration - c.holdFrames;
  const video = (
    <OffthreadVideo src={staticFile('capture/sim.mp4')} trimBefore={Math.round(c.start * edl.fps)} playbackRate={c.rate} muted
      style={{ width: '100%', height: '100%' }} />
  );
  return (
    <div style={{ width: '100%', height: '100%', transform: `scale(${z.scale})`, transformOrigin: `${originFor(z.cx, z.scale) * 100}% ${originFor(z.cy, z.scale) * 100}%` }}>
      <Sequence durationInFrames={played}>{video}</Sequence>
      {c.holdFrames > 0 ? (
        <Sequence from={played}>
          <Freeze frame={played - 1}>{video}</Freeze>
        </Sequence>
      ) : null}
    </div>
  );
};

const PhoneScene = ({ scene, edl }: { scene: EdlScene; edl: Edl }) => {
  const aspect = edl.video.width / edl.video.height;
  const withTerminal = scene.show === 'phone+terminal';
  return (
    // the bottom strip is the captions'
    <AbsoluteFill style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 80, paddingBottom: 130 }}>
      <PhoneFrame height={860} aspect={aspect}><Screen scene={scene} edl={edl} /></PhoneFrame>
      {withTerminal ? <Terminal lines={scene.terminal ?? []} /> : null}
    </AbsoluteFill>
  );
};

const Card = ({ scene }: { scene: EdlScene }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const k = spring({ frame: f, fps, config: { damping: 200 } });
  const card = scene.card!;
  return (
    <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', gap: 28, opacity: k }}>
      <Logo size={180} />
      <div style={{ color: C.white, fontSize: 96, fontWeight: 800, letterSpacing: -2 }}>{card.title}</div>
      {card.sub ? <div style={{ color: C.green, fontSize: 48, fontWeight: 700 }}>{card.sub}</div> : null}
      {(card.lines ?? []).map((l) => <div key={l} style={{ color: C.muted, fontSize: 40 }}>{l}</div>)}
    </AbsoluteFill>
  );
};

const Browser = ({ scene }: { scene: EdlScene }) => (
  <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', paddingBottom: 130 }}>
    <div style={{ width: 1280, borderRadius: 14, overflow: 'hidden', border: `1px solid ${C.line}`, boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}>
      <div style={{ height: 46, background: '#151b22', display: 'flex', alignItems: 'center', paddingLeft: 20, color: C.muted, fontSize: 20 }}>
        127.0.0.1:8888 — gnoweb, local chain
      </div>
      {scene.gnoweb ? <Img src={staticFile(scene.gnoweb)} style={{ width: 1280, display: 'block' }} /> : null}
    </div>
  </AbsoluteFill>
);

export const SceneView = ({ scene, edl }: { scene: EdlScene; edl: Edl }) => (
  <AbsoluteFill>
    {scene.show === 'card' ? <Card scene={scene} /> : scene.show === 'browser' ? <Browser scene={scene} /> : <PhoneScene scene={scene} edl={edl} />}
    <Captions cues={scene.captions} />
  </AbsoluteFill>
);
