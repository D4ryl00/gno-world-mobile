import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { defaults, pick } from './which.ts';

const dir = mkdtempSync(join(tmpdir(), 'demo-which-'));
writeFileSync(join(dir, 'script.ts'), '');
writeFileSync(join(dir, 'beta.ts'), '');

test('without DEMO, the first demo: script.ts and out/', () => {
  assert.deepEqual(pick(undefined, dir), { name: 'script', file: join(dir, 'script.ts'), out: join(dir, 'out') });
  assert.deepEqual(pick('', dir), pick(undefined, dir));
  assert.deepEqual(pick('script', dir), pick(undefined, dir));
});

test('DEMO=beta: beta.ts and out-beta/', () => {
  assert.deepEqual(pick('beta', dir), { name: 'beta', file: join(dir, 'beta.ts'), out: join(dir, 'out-beta') });
});

test('an unknown DEMO names the file it looked for', () => {
  assert.throws(() => pick('nope', dir), /no demo script demo\/nope\.ts/);
});

test('a script that names nothing gets the first demo\'s target, device, build and bounds', () => {
  assert.deepEqual(defaults({ voice: 'af_heart', setup: [], scenes: [] }), {
    target: 'local',
    device: { name: 'gnoworld-demo', type: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', runtime: 'com.apple.CoreSimulator.SimRuntime.iOS-26-5' },
    app: 'build/Build/Products/Release-iphonesimulator/gnoworld.app',
    teardown: [],
    check: { min: 90, max: 135 },
    output: 'gnoworld-demo.mp4',
  });
});

test('what a script names wins', () => {
  const d = defaults({ voice: 'af_heart', setup: [], scenes: [], target: 'production', check: { min: 60, max: 110 }, output: 'b.mp4' });
  assert.equal(d.target, 'production');
  assert.deepEqual(d.check, { min: 60, max: 110 });
  assert.equal(d.output, 'b.mp4');
  assert.equal(d.device.name, 'gnoworld-demo');
});
