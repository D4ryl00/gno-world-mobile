import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { promote } from './promote.ts';

test('a finished capture replaces the last one; until then the last one stays', () => {
  const out = mkdtempSync(join(tmpdir(), 'out-'));
  const final = join(out, 'capture');
  const next = join(out, 'capture.new');
  mkdirSync(final);
  writeFileSync(join(final, 'timeline.json'), 'old');
  mkdirSync(next);
  writeFileSync(join(next, 'timeline.json'), 'new');
  assert.equal(readFileSync(join(final, 'timeline.json'), 'utf8'), 'old'); // a run in progress touches nothing
  promote(next, final);
  assert.equal(readFileSync(join(final, 'timeline.json'), 'utf8'), 'new');
  assert.equal(existsSync(next), false);
});
