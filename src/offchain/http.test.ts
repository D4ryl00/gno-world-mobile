import { browserId, createOffchain, OffchainError } from '@/offchain/http';

test('requests go to the configured base with the browser id header', async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const fetchMock = jest.fn(async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 });
  });
  const oc = createOffchain({ baseUrl: () => 'https://example.org', bid: async () => '0123456789abcdef', fetch: fetchMock as never });
  expect(await oc.post('/presence?id=x', undefined)).toEqual({ ok: 1 });
  expect(seen[0].url).toBe('https://example.org/presence?id=x');
  expect((seen[0].init.headers as Record<string, string>)['X-Bid']).toBe('0123456789abcdef');
  expect(seen[0].init.method).toBe('POST');
});

test('HTTP errors carry the status and the server message', async () => {
  const fetchMock = jest.fn(async () => new Response(JSON.stringify({ error: 'slow down' }), { status: 429 }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  await expect(oc.get('/api/where')).rejects.toEqual(new OffchainError(429, 'slow down'));
});

test('a hung server times out', async () => {
  const fetchMock = jest.fn((_u: string, init: RequestInit) =>
    new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never, timeoutMs: 10 });
  await expect(oc.get('/api/where')).rejects.toBeInstanceOf(OffchainError);
});

test('browserId is 16 hex and stable', async () => {
  const m = new Map<string, string>();
  const store = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v) };
  const a = await browserId(store, (n) => 'ab'.repeat(n));
  expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(await browserId(store, () => 'zz')).toBe(a);
});
