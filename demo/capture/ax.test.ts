import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { centre, find, parseDescribeAll } from './ax.ts';

const raw = JSON.stringify([
  { AXLabel: 'Session', AXValue: null, type: 'Button', enabled: true, frame: { x: 200, y: 800, width: 80, height: 49 } },
  { AXLabel: null, AXValue: 'http://127.0.0.1:8787', type: 'TextField', enabled: true, frame: { x: 16, y: 300, width: 370, height: 44 } },
  { AXLabel: 'boop 0.10 GNOT', AXValue: null, type: 'Button', enabled: false, frame: { x: 16, y: 600, width: 370, height: 50 } },
  { AXLabel: 'boop 0.10 GNOT', AXValue: null, type: 'Button', enabled: true, frame: { x: 16, y: 700, width: 370, height: 50 } },
]);

test('parses labels, values, types, state and boxes', () => {
  const [s, f] = parseDescribeAll(raw);
  assert.deepEqual(s, { label: 'Session', value: '', type: 'Button', enabled: true, box: { x: 200, y: 800, w: 80, h: 49 } });
  assert.equal(f.label, '');
  assert.equal(f.value, 'http://127.0.0.1:8787');
});

test('a string matches a label exactly, then a value', () => {
  const els = parseDescribeAll(raw);
  assert.equal(find(els, 'Session')?.type, 'Button');
  assert.equal(find(els, 'Sess'), undefined);
  assert.equal(find(els, 'http://127.0.0.1:8787')?.type, 'TextField');
});

test('a RegExp matches a label or a value; enabled picks the live one', () => {
  const els = parseDescribeAll(raw);
  assert.equal(find(els, /^boop /)?.enabled, false);
  assert.equal(find(els, /^boop /, { enabled: true })?.box.y, 700);
  assert.equal(find(els, /8787/)?.type, 'TextField');
});

test('centre is the middle of the box', () => {
  assert.deepEqual(centre({ x: 10, y: 20, w: 100, h: 40 }), [60, 40]);
});

test('the real Settings app tree parses', () => {
  const els = parseDescribeAll(readFileSync(new URL('./fixtures/settings-app.json', import.meta.url), 'utf8'));
  assert.ok(els.length > 0);
  assert.ok(els.every((e) => Number.isFinite(e.box.w)));
});

test('the keyboard bounds what a tap can reach; without it, the screen does', async () => {
  const { isKey, visibleBottom } = await import('./ax.ts');
  const els = parseDescribeAll(JSON.stringify([
    { AXLabel: 'Done', type: 'Button', enabled: true, frame: { x: 318, y: 82, width: 64, height: 36 } },
    { AXLabel: 'q', type: 'Button', enabled: true, frame: { x: 6, y: 590, width: 30, height: 42 } },
    { AXLabel: 'return', type: 'Button', enabled: true, frame: { x: 300, y: 752, width: 90, height: 42 } },
  ]));
  assert.equal(isKey(els[1]), true);
  assert.equal(isKey(els[2]), true);
  assert.equal(isKey(els[0]), false);
  assert.equal(visibleBottom(els), 530);
  assert.equal(visibleBottom(els.slice(0, 1)), 874 - 60);
});
