import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { dragArgs, Sim } from './sim.ts';

const dir = () => mkdtempSync(join(tmpdir(), 'sim-'));

test('a recorder that already died: stopRecording returns, and the capture knows it died', async () => {
  const sim = new Sim('none', dir(), { recordCmd: ['bash', '-c', 'echo "Recording started" >&2; sleep 0.2; exit 3'] });
  await sim.startRecording(join(dir(), 'x.mp4'));
  await new Promise((r) => setTimeout(r, 600));
  assert.match(sim.recorderDied() ?? '', /exited \(3\)/);
  const t = Date.now();
  await sim.stopRecording();
  assert.ok(Date.now() - t < 1000);
});

test('a live recorder is stopped and not reported as died', async () => {
  const sim = new Sim('none', dir(), { recordCmd: ['bash', '-c', 'echo "Recording started" >&2; trap "exit 0" INT; while true; do sleep 0.1; done'] });
  await sim.startRecording(join(dir(), 'x.mp4'));
  assert.equal(sim.recorderDied(), null);
  await sim.stopRecording();
});

test('a companion that cannot start (its port is taken) fails connect at once, naming it', async () => {
  const sim = new Sim('none', dir(), { companionCmd: ['bash', '-c', 'exit 1'] });
  const t = Date.now();
  await assert.rejects(sim.connect(), /idb_companion exited \(1\) before answering on port 10982/);
  assert.ok(Date.now() - t < 5000);
});

test('a drag is a slow swipe, one point at a time: the app sees a hold, then the finger sliding', () => {
  assert.deepEqual(dragArgs(100, 300, 300, 310, 5), ['ui', 'swipe', '100', '300', '300', '310', '--duration', '5', '--delta', '1']);
});
