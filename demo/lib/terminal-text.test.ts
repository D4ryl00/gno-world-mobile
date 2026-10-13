import assert from 'node:assert/strict';
import { test } from 'node:test';

import { terminalText } from './terminal-text.ts';

test('keeps the words, drops the QR in block characters and in ANSI colours, and the colour codes', () => {
  const raw = [
    'On your phone, choose "Send to my computer" and scan this code, or type it:\r',
    '\r',
    '\x1b[30;107m                                     \x1b[0m\r',
    '\x1b[30;107m  █▀▀▀▀▀█ ▄▀ █▀▀▀▀▀█  \x1b[0m\r',
    '  █ ███ █ ▀▄ █ ███ █  \r',
    '\r',
    '    7-torpedo-shamrock\r',
    '\r',
    '\r',
    '\r',
    'Sign? [y/N] \x1b[1my\x1b[0m',
  ].join('\n');
  assert.equal(terminalText(raw), [
    'On your phone, choose "Send to my computer" and scan this code, or type it:',
    '',
    '    7-torpedo-shamrock',
    '',
    'Sign? [y/N] y',
  ].join('\n'));
});

test('shows the last 22 lines', () => {
  const raw = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  const shown = terminalText(raw).split('\n');
  assert.equal(shown.length, 22);
  assert.equal(shown[0], 'line 8');
});
