import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildEdl, FPS, MAX_RATE, zoomFor } from './fit.ts';
import type { Script, Timeline } from './types.ts';

const screen = { width: 402, height: 874 };
const timeline = (marks: Timeline['marks']): Timeline => ({ video: { width: 1206, height: 2622, duration: 300 }, screen, marks });
const phone = (id: string, steps: string[], extra: Partial<Script['scenes'][number]> = {}): Script['scenes'][number] => ({
  id, show: 'phone', captions: ['one', 'two'], voice: 'words', steps: steps.map((s) => ({ id: s, do: { pause: 0 }, mark: true })), ...extra,
});
const script = (scenes: Script['scenes']): Script => ({ voice: 'af_heart', setup: [], scenes });

test('a card lasts its voice plus a second, at least four seconds', () => {
  const s = script([{ id: 'title', show: 'card', captions: [], voice: 'hi', card: { title: 'gno.world' } }]);
  const e = buildEdl(s, timeline([]), { title: { file: 'voice/title.wav', seconds: 5 } }, []);
  assert.equal(e.scenes[0].duration, 6 * FPS);
  const short = buildEdl(s, timeline([]), { title: { file: 'voice/title.wav', seconds: 1 } }, []);
  assert.equal(short.scenes[0].duration, 4 * FPS);
});

test('a long clip plays faster to fit the voice', () => {
  const s = script([phone('connect', ['a', 'b'])]);
  // clip: 10 - 0.3 .. 30 + 0.8 = 20.9 s; target: 6 + 0.6 = 6.6 s → rate ≈ 3.17
  const e = buildEdl(s, timeline([{ id: 'connect.a', t: 10 }, { id: 'connect.b', t: 30 }]), { connect: { file: 'v.wav', seconds: 6 } }, []);
  const c = e.scenes[0].clip!;
  assert.equal(c.start, 9.7);
  assert.equal(c.end, 30.8);
  assert.ok(Math.abs(c.rate - 21.1 / 6.6) < 1e-9);
  assert.equal(c.holdFrames, 0);
  assert.equal(e.scenes[0].duration, Math.round(6.6 * FPS));
});

test('a clip too long even at the top speed lengthens the scene', () => {
  const s = script([phone('play', ['a', 'b'])]);
  const e = buildEdl(s, timeline([{ id: 'play.a', t: 0.3 }, { id: 'play.b', t: 80 }]), { play: { file: 'v.wav', seconds: 3 } }, []);
  assert.equal(e.scenes[0].clip!.rate, MAX_RATE);
  assert.equal(e.scenes[0].duration, Math.round((80.8 / MAX_RATE) * FPS));
});

test('a short clip plays at normal speed and holds its last frame', () => {
  const s = script([phone('chat', ['a'])]);
  const e = buildEdl(s, timeline([{ id: 'chat.a', t: 5 }]), { chat: { file: 'v.wav', seconds: 8 } }, []);
  const c = e.scenes[0].clip!;
  assert.equal(c.rate, 1);
  assert.equal(e.scenes[0].duration, Math.round(8.6 * FPS));
  assert.equal(c.holdFrames, e.scenes[0].duration - Math.round((c.end - c.start) * FPS));
});

test('scenes follow each other and the voice starts six frames in', () => {
  const s = script([
    { id: 'title', show: 'card', captions: [], voice: 'hi', card: { title: 'x' } },
    phone('chat', ['a']),
  ]);
  const e = buildEdl(s, timeline([{ id: 'chat.a', t: 5 }]), { title: { file: 't.wav', seconds: 3 }, chat: { file: 'c.wav', seconds: 3 } }, []);
  assert.equal(e.scenes[1].from, e.scenes[0].duration);
  assert.deepEqual(e.scenes[1].voice, { src: 'c.wav', from: 6 });
  assert.equal(e.durationInFrames, e.scenes[0].duration + e.scenes[1].duration);
});

test('captions share the scene in order', () => {
  const s = script([phone('chat', ['a'])]);
  const e = buildEdl(s, timeline([{ id: 'chat.a', t: 5 }]), { chat: { file: 'c.wav', seconds: 5.4 } }, []);
  const [a, b] = e.scenes[0].captions;
  assert.equal(a.text, 'one');
  assert.equal(a.from, 0);
  assert.equal(b.from, a.duration);
  assert.equal(a.duration + b.duration, e.scenes[0].duration);
});

test('a missing mark names the scene and the mark', () => {
  const s = script([phone('connect', ['a', 'b'])]);
  assert.throws(() => buildEdl(s, timeline([{ id: 'connect.a', t: 1 }]), { connect: { file: 'v.wav', seconds: 3 } }, []),
    /scene connect: no mark connect\.b in timeline\.json — capture again/);
});

test('zoom fits a small button, never below 1 or above 2.2, and stays inside the screen', () => {
  const corner = zoomFor({ x: 0, y: 0, w: 40, h: 30 }, screen);
  assert.equal(corner.scale, 2.2);
  // the view is 1/2.2 of the screen wide: its centre cannot be nearer the edge than half of that
  assert.ok(Math.abs(corner.cx - 0.5 / 2.2) < 1e-9);
  assert.ok(Math.abs(corner.cy - 0.5 / 2.2) < 1e-9);
  const wide = zoomFor({ x: 0, y: 300, w: 402, h: 400 }, screen);
  assert.equal(wide.scale, 1);
  assert.equal(wide.cx, 0.5);
});

test('zoom keys land on the frame where their step happens', () => {
  const s = script([phone('connect', ['a', 'b'], { zoomOn: ['b'] })]);
  const e = buildEdl(s, timeline([{ id: 'connect.a', t: 10 }, { id: 'connect.b', t: 12, box: { x: 100, y: 700, w: 200, h: 50 } }]),
    { connect: { file: 'v.wav', seconds: 10 } }, []);
  const [first, second] = e.scenes[0].zoom;
  assert.deepEqual(first, { f: 0, scale: 1, cx: 0.5, cy: 0.5 });
  // clip starts at 9.7 and plays at 1×: 12 s is (12 - 9.7) s into the scene
  assert.equal(second.f, Math.round(2.3 * FPS));
  assert.ok(second.scale > 1);
});

test('terminal output inside the clip is mapped to scene frames', () => {
  const s = script([phone('connect', ['a', 'b'], { show: 'phone+terminal' })]);
  const e = buildEdl(s, timeline([{ id: 'connect.a', t: 10 }, { id: 'connect.b', t: 14 }]), { connect: { file: 'v.wav', seconds: 10 } },
    [{ t: 5, text: 'before' }, { t: 11, text: 'Sign? [y/N] ' }, { t: 40, text: 'after' }]);
  assert.deepEqual(e.scenes[0].terminal, [{ f: Math.round(1.3 * FPS), text: 'Sign? [y/N] ' }]);
});
