import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readDurations, readTerminal, readTimeline } from './files.ts';

const dir = mkdtempSync(join(tmpdir(), 'demo-files-'));
const put = (name: string, body: string) => {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

const timeline = {
  video: { width: 1206, height: 2622, duration: 120.5 },
  screen: { width: 402, height: 874 },
  marks: [{ id: 'connect.open', t: 3.2, box: { x: 10, y: 20, w: 100, h: 44 } }, { id: 'connect.back', t: 9 }],
};

test('readTimeline returns a valid timeline', () => {
  assert.deepEqual(readTimeline(put('t.json', JSON.stringify(timeline))), timeline);
});

test('readTimeline names the file when it is missing', () => {
  assert.throws(() => readTimeline(join(dir, 'nope.json')), /nope\.json: missing — run npm run demo:capture/);
});

test('readTimeline names the file and the field when a mark is malformed', () => {
  const bad = { ...timeline, marks: [{ id: 'x', t: 'soon' }] };
  assert.throws(() => readTimeline(put('bad.json', JSON.stringify(bad))), /bad\.json: marks\[0\]\.t is not a number/);
});

test('readTimeline rejects broken JSON with the file name', () => {
  assert.throws(() => readTimeline(put('broken.json', '{')), /broken\.json: not JSON/);
});

test('readDurations returns the narration lengths', () => {
  const d = { intro: { file: 'voice/intro-1a2b3c4d.wav', seconds: 3.4 } };
  assert.deepEqual(readDurations(put('d.json', JSON.stringify(d))), d);
});

test('readDurations rejects a non-positive length', () => {
  assert.throws(() => readDurations(put('d0.json', JSON.stringify({ intro: { file: 'a.wav', seconds: 0 } }))), /d0\.json: intro\.seconds/);
});

test('readTerminal reads JSON lines and skips blank ones', () => {
  const p = put('term.jsonl', '{"t":1.5,"text":"Waiting"}\n\n{"t":2,"text":"Done."}\n');
  assert.deepEqual(readTerminal(p), [{ t: 1.5, text: 'Waiting' }, { t: 2, text: 'Done.' }]);
});

test('readTerminal returns nothing when the file does not exist', () => {
  assert.deepEqual(readTerminal(join(dir, 'none.jsonl')), []);
});
