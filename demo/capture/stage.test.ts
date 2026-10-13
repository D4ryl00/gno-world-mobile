import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { test } from 'node:test';

import { busyPorts } from './stage.ts';

test('busyPorts names the ports something already listens on', async () => {
  const srv = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const port = (srv.address() as { port: number }).port;
  assert.deepEqual(await busyPorts([port, 1]), [port]);
  srv.close();
});

test('the busy-port message says how to find who listens', async () => {
  const { busyMessage } = await import('./stage.ts');
  assert.match(busyMessage([26657, 10982]), /ports 26657, 10982 already in use[\s\S]*lsof -nP -iTCP:26657 -sTCP:LISTEN/);
});

test('the idb companion port is one of the ports checked', async () => {
  const { PORTS } = await import('./stage.ts');
  const { IDB_PORT } = await import('./sim.ts');
  assert.ok(Object.values(PORTS).includes(IDB_PORT));
});

test('a program that cannot start is reported by name, not left to crash the process', async () => {
  const { spawnLogged } = await import('./stage.ts');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const failed = await new Promise<string>((resolve) => {
    spawnLogged(mkdtempSync(join(tmpdir(), 'logs-')), 'relay', '/nonexistent/twist', [], {}, resolve);
  });
  assert.match(failed, /^relay: .*ENOENT/);
});
