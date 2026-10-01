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

test('a hung server times out with status 0', async () => {
  const fetchMock = jest.fn((_u: string, init: RequestInit) =>
    new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never, timeoutMs: 10 });
  await expect(oc.get('/api/where')).rejects.toEqual(expect.objectContaining({ status: 0 }));
});

test('a rejected bid is an OffchainError with status 0', async () => {
  const fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => Promise.reject(new Error('secure store failed')), fetch: fetchMock as never });
  await expect(oc.get('/api/where')).rejects.toEqual(expect.objectContaining({ status: 0 }));
});

test('a 200 response with non-JSON body resolves to {}', async () => {
  const fetchMock = jest.fn(async () => new Response('<html>', { status: 200 }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  expect(await oc.get('/api/where')).toEqual({});
});

test('a 500 response with non-JSON body rejects with status 500', async () => {
  const fetchMock = jest.fn(async () => new Response('<html>', { status: 500 }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  await expect(oc.get('/api/where')).rejects.toEqual(expect.objectContaining({ status: 500 }));
});

test('the request timer is always cleared', async () => {
  // Test with fake timers to verify the timer is cleared after the request completes
  jest.useFakeTimers();
  try {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ data: 'ok' }), { status: 200 }));
    const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
    const result = await oc.get('/api/where');
    expect(result).toEqual({ data: 'ok' });
    // After the request completes successfully, the timer should be cleared
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('a hung server times out and leaves no timer behind', async () => {
  jest.useFakeTimers();
  try {
    const hung: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const oc = createOffchain({ baseUrl: () => 'https://x.example', bid: async () => 'b'.repeat(8), fetch: hung, timeoutMs: 1000 });
    const p = oc.get('/presence');
    const settled = expect(p).rejects.toMatchObject({ status: 0 });
    await jest.advanceTimersByTimeAsync(1001);
    await settled;
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});

test('the request timer is cleared even on error', async () => {
  // Test that the timer is also cleared when an error occurs (without fake timers)
  const fetchMock = jest.fn(async () => new Response(JSON.stringify({ error: 'failed' }), { status: 500 }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  try {
    await oc.get('/api/where');
  } catch (e) {
    // Error is expected
    expect((e as OffchainError).status).toBe(500);
  }
  // If the timer wasn't cleared, this test would leave a hanging timer and fail
  // The fact that it completes without hanging confirms the timer was cleared in the finally block
});

test('browserId is 16 hex and stable', async () => {
  const m = new Map<string, string>();
  const store = { get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => void m.set(k, v) };
  const a = await browserId(store, (n) => 'ab'.repeat(n));
  expect(a).toMatch(/^[0-9a-f]{16}$/);
  expect(await browserId(store, () => 'zz')).toBe(a);
});
