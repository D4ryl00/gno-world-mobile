import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runAll } from './teardown.ts';

test('every step runs even when one fails; the errors come back in order', async () => {
  const ran: string[] = [];
  const errors = await runAll(['a', 'b', 'c'], async (s) => {
    ran.push(s);
    if (s !== 'b') throw new Error(`${s} broke`);
  });
  assert.deepEqual(ran, ['a', 'b', 'c']);
  assert.deepEqual(errors, ['a broke', 'c broke']);
});

test('nothing to undo, nothing to report', async () => {
  assert.deepEqual(await runAll([], async () => undefined), []);
});
