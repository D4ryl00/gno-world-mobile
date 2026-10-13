import type { Box, CaptionCue, Durations, Edl, EdlScene, Script, TermChunk, Timeline, ZoomKey } from './types.ts';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const MAX_RATE = 4;
const PRE = 0.3;
const POST = 0.8;
const VOICE_DELAY = 6; // frames

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The camera that frames `box` on a screen of `screen` points. */
export function zoomFor(box: Box, screen: { width: number; height: number }) {
  const scale = clamp(Math.min((0.55 * screen.width) / box.w, (0.35 * screen.height) / box.h), 1, 2.2);
  const half = 0.5 / scale;
  return {
    scale,
    cx: clamp((box.x + box.w / 2) / screen.width, half, 1 - half),
    cy: clamp((box.y + box.h / 2) / screen.height, half, 1 - half),
  };
}

const captionsOver = (texts: string[], duration: number): CaptionCue[] => {
  const each = Math.floor(duration / Math.max(texts.length, 1));
  return texts.map((text, i) => ({ text, from: i * each, duration: i === texts.length - 1 ? duration - i * each : each }));
};

export function buildEdl(script: Script, timeline: Timeline, durations: Durations, terminal: TermChunk[]): Edl {
  const marks = new Map(timeline.marks.map((m) => [m.id, m]));
  const scenes: EdlScene[] = [];
  let from = 0;
  for (const s of script.scenes) {
    const voice = s.voice ? durations[s.id] : undefined;
    if (s.voice && !voice) throw new Error(`scene ${s.id}: no narration in durations.json — run npm run demo:voice`);
    const voiceS = voice?.seconds ?? 0;
    let duration: number;
    let clip: EdlScene['clip'];
    let zoom: ZoomKey[] = [{ f: 0, scale: 1, cx: 0.5, cy: 0.5 }];
    let term: EdlScene['terminal'];
    if (s.show === 'phone' || s.show === 'phone+terminal') {
      const ids = (s.steps ?? []).filter((st) => st.mark).map((st) => `${s.id}.${st.id}`);
      const own = ids.map((id) => {
        const m = marks.get(id);
        if (!m) throw new Error(`scene ${s.id}: no mark ${id} in timeline.json — capture again`);
        return m;
      });
      if (!own.length) throw new Error(`scene ${s.id}: a phone scene needs at least one marked step`);
      const start = Math.max(0, Math.round((own[0].t - PRE) * 1000) / 1000);
      const end = Math.min(timeline.video.duration, Math.round((own[own.length - 1].t + POST) * 1000) / 1000);
      const raw = end - start;
      const target = Math.max(voiceS + 0.6, 3);
      const rate = raw > target ? Math.min(raw / target, MAX_RATE) : 1;
      const played = raw / rate;
      const total = Math.max(target, played);
      duration = Math.round(total * FPS);
      clip = { start, end, rate, holdFrames: Math.max(0, duration - Math.round(played * FPS)) };
      const toFrame = (t: number) => Math.round(((t - start) / rate) * FPS);
      for (const z of s.zoomOn ?? []) {
        const m = marks.get(`${s.id}.${z}`);
        if (m?.box) zoom.push({ f: toFrame(m.t), ...zoomFor(m.box, timeline.screen) });
      }
      zoom = zoom.sort((a, b) => a.f - b.f);
      if (s.show === 'phone+terminal') {
        term = terminal.filter((c) => c.t >= start && c.t <= end).map((c) => ({ f: toFrame(c.t), text: c.text }));
      }
    } else {
      duration = Math.round(Math.max(voiceS + 1, 4) * FPS);
    }
    scenes.push({
      id: s.id, show: s.show, from, duration, card: s.card, clip, zoom,
      captions: captionsOver(s.captions, duration),
      voice: voice ? { src: voice.file, from: VOICE_DELAY } : undefined,
      terminal: term,
      gnoweb: s.show === 'browser' ? timeline.gnoweb : undefined,
    });
    from += duration;
  }
  return { fps: FPS, width: WIDTH, height: HEIGHT, durationInFrames: from, video: timeline.video, screen: timeline.screen, scenes };
}
