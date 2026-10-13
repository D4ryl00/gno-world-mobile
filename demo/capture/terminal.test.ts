import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Computer } from './terminal.ts';

const fake = new URL('./fixtures/fake-pair.sh', import.meta.url).pathname;
const log = () => join(mkdtempSync(join(tmpdir(), 'term-')), 'terminal.jsonl');

test('reads the code, answers the review and the password, and logs with the clock', async () => {
  const file = log();
  let t = 10;
  const c = new Computer({ bin: fake, args: [], clock: () => (t += 0.5), log: file });
  await c.start();
  assert.equal(await c.code(), '7-guitarist-revenge');
  await c.expect(/Sign\? \[y\/N\] $/);
  c.send('y\n');
  await c.expect(/Enter password/);
  c.send('\n');
  await c.done();
  const lines = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(lines.every((l) => typeof l.t === 'number' && l.t > 10));
  assert.match(lines.map((l) => l.text).join(''), /Included in block 12/);
});

test('an unexpected question fails with the last lines instead of hanging', async () => {
  const c = new Computer({ bin: fake, args: [], clock: () => 0, log: log(), env: { FAKE_PAIR: 'unexpected' } });
  await c.start();
  await c.code();
  await assert.rejects(c.expect(/Sign\? \[y\/N\] $/, 3000), /gnokey-pair asked something else[\s\S]*No -remote given/);
  c.kill();
});
