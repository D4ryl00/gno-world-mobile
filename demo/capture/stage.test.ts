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
