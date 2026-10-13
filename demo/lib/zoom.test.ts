import assert from 'node:assert/strict';
import { test } from 'node:test';

import { originFor } from './zoom.ts';

// What CSS shows at scale s around origin o: the source interval [o - o/s, o + (1 - o)/s].
const view = (o: number, s: number) => [o - o / s, o + (1 - o) / s];

test('the origin centres the view on c', () => {
  const [a, b] = view(originFor(0.4, 2), 2);
  assert.ok(Math.abs((a + b) / 2 - 0.4) < 1e-9);
});

test('a centre near an edge keeps the view inside the screen', () => {
  const [a] = view(originFor(0.5 / 2.2, 2.2), 2.2);
  assert.ok(Math.abs(a) < 1e-9);
  const [, b] = view(originFor(1 - 0.5 / 2.2, 2.2), 2.2);
  assert.ok(Math.abs(b - 1) < 1e-9);
  assert.equal(originFor(0.01, 2), 0);
});

test('no zoom: the origin is the middle', () => {
  assert.equal(originFor(0.3, 1), 0.5);
});
