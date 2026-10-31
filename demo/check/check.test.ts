import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Edl } from '../lib/types.ts';
import { checkEdl } from './check.ts';

const edl = (scenes: Edl['scenes'], total = 3600): Edl => ({
  fps: 30, width: 1920, height: 1080, durationInFrames: total, video: { width: 1206, height: 2622, duration: 200 },
  screen: { width: 402, height: 874 }, scenes,
});
const scene = (id: string, duration: number, captions: string[] = []) => ({
  id, show: 'card' as const, from: 0, duration, zoom: [], voice: { src: `voice/${id}.wav`, from: 6 },
  captions: captions.map((text) => ({ text, from: 0, duration })),
});

test('a fine edit has no problem', () => {
  assert.deepEqual(checkEdl(edl([scene('a', 300)]), { a: { file: 'voice/a.wav', seconds: 5 } }), []);
});

test('the total must be between 1 min 30 and 2 min 15', () => {
  assert.match(checkEdl(edl([scene('a', 300)], 30 * 60), { a: { file: 'x', seconds: 5 } })[0], /total 60\.0 s/);
});

test('a voice longer than its scene is reported', () => {
  assert.match(checkEdl(edl([scene('a', 100)]), { a: { file: 'x', seconds: 5 } })[0], /scene a: the voice .* runs past/);
});

test('a caption too long for one line pair is reported', () => {
  const long = 'x'.repeat(70);
  assert.match(checkEdl(edl([scene('a', 300, [long])]), { a: { file: 'x', seconds: 5 } })[0], /scene a: caption .* 70 characters/);
});

test('a script can set its own bounds', () => {
  const d = { a: { file: 'x', seconds: 5 } };
  assert.match(checkEdl(edl([scene('a', 300)], 30 * 50), d, { min: 60, max: 110 })[0], /total 50\.0 s is outside 60–110 s/);
  assert.deepEqual(checkEdl(edl([scene('a', 300)], 30 * 75), d, { min: 60, max: 110 }), []);
});
