import { OffchainError, type Offchain, type TextReply } from '@/offchain/http';

import { createSyncClient } from './client';

const reply = (status: number, text = '', etag = ''): TextReply => ({ status, text, etag });
const with_ = (...replies: TextReply[]) => {
  const exchange = jest.fn();
  for (const r of replies) exchange.mockResolvedValueOnce(r);
  return { exchange, client: createSyncClient({ exchange } as unknown as Offchain) };
};
const ID = 'f'.repeat(64);

test('a code is posted as JSON; 409 means the code is in use; another refusal keeps its words', async () => {
  const { exchange, client } = with_(reply(200, '{}'), reply(409, '{"error":"in use"}'), reply(429, '{"error":"slow down"}'));
  expect(await client.pairPost('K7XQ2M', 'blob')).toBe('ok');
  expect(exchange).toHaveBeenCalledWith('POST', '/api/sync/pair', { json: { code: 'K7XQ2M', blob: 'blob' } });
  expect(await client.pairPost('K7XQ2M', 'blob')).toBe('taken');
  await expect(client.pairPost('K7XQ2M', 'blob')).rejects.toEqual(new OffchainError(429, 'slow down'));
});

test("a code's blob comes back; an unknown code says the server's words", async () => {
  const gone = 'no such code — it may have been used, or it is older than ten minutes';
  const { exchange, client } = with_(reply(200, '{"blob":"b64"}'), reply(404, JSON.stringify({ error: gone })), reply(200, '{}'));
  expect(await client.pairGet('K7XQ2M')).toBe('b64');
  expect(exchange).toHaveBeenCalledWith('GET', '/api/sync/pair/K7XQ2M', { headers: { 'Cache-Control': 'no-store' } });
  await expect(client.pairGet('K7XQ2M')).rejects.toEqual(new OffchainError(404, gone));
  await expect(client.pairGet('K7XQ2M')).rejects.toMatchObject({ message: 'no such code' });
});

test('pull: 404 is version 0 and nothing; otherwise the text and the ETag as the version', async () => {
  const { exchange, client } = with_(reply(404, '{"error":"nothing here yet"}'), reply(200, 'c2VhbGVk\n', '7'), reply(200, 'x', ''), reply(500, 'oops'));
  expect(await client.pull(ID)).toEqual({ version: 0, blob: null });
  expect(exchange).toHaveBeenCalledWith('GET', `/api/sync/${ID}`, { headers: { 'Cache-Control': 'no-store' } });
  expect(await client.pull(ID)).toEqual({ version: 7, blob: 'c2VhbGVk' });
  expect(await client.pull(ID)).toEqual({ version: 0, blob: 'x' });
  await expect(client.pull(ID)).rejects.toMatchObject({ status: 500, message: 'sync read failed (500)' });
});

test('push: text with If-Match; the ETag is the new version (or the old one plus one); 412 is not ok', async () => {
  const { exchange, client } = with_(reply(200, '{}', '8'), reply(200, '{}', ''), reply(412, '{}'));
  expect(await client.push(ID, 7, 'blob')).toEqual({ ok: true, version: 8 });
  expect(exchange).toHaveBeenCalledWith('PUT', `/api/sync/${ID}`, { text: 'blob', headers: { 'If-Match': '7' } });
  expect(await client.push(ID, 7, 'blob')).toEqual({ ok: true, version: 8 });
  expect(await client.push(ID, 7, 'blob')).toEqual({ ok: false });
});

test('the name check: mine true, mine false or absent, and null when the server could not say', async () => {
  const { exchange, client } = with_(reply(200, '{"mine":true}'), reply(200, '{"mine":false}'), reply(200, '{"name":"x"}'), reply(503, ''), reply(200, 'nope'));
  expect(await client.checkName('remi', 'k')).toBe(true);
  expect(exchange).toHaveBeenCalledWith('GET', '/api/name?name=remi', { headers: { 'X-Name-Key': 'k', 'Cache-Control': 'no-store' } });
  expect(await client.checkName('remi', 'k')).toBe(false);
  expect(await client.checkName('remi', 'k')).toBe(false);
  expect(await client.checkName('remi', 'k')).toBeNull();
  expect(await client.checkName('remi', 'k')).toBeNull();
  exchange.mockRejectedValueOnce(new OffchainError(0, 'server unreachable'));
  expect(await client.checkName('remi', 'k')).toBeNull();
});
