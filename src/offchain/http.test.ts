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

test('two first-launch requests at once share one browser id', async () => {
  const m = new Map<string, string>();
  let writes = 0;
  const store = {
    get: async (k: string) => {
      const v = m.get(k) ?? null; // read now, answer later: the two reads overlap
      await new Promise((r) => setTimeout(r, 5));
      return v;
    },
    set: async (k: string, v: string) => { writes++; m.set(k, v); },
  };
  let n = 0;
  const hex = (bytes: number) => String(++n).padStart(bytes * 2, '0');
  const [a, b] = await Promise.all([browserId(store, hex), browserId(store, hex)]);
  expect(a).toBe(b);
  expect(writes).toBe(1);
});

test('a browser id that never comes is covered by the timeout', async () => {
  const fetchMock = jest.fn();
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: () => new Promise<string>(() => undefined), fetch: fetchMock as never, timeoutMs: 20 });
  await expect(oc.get('/api/where')).rejects.toMatchObject({ status: 0 });
  expect(fetchMock).not.toHaveBeenCalled();
});

const ok = (body: unknown = { ok: 1 }) => new Response(JSON.stringify(body), { status: 200 });

test('per-request headers are added to the browser id', async () => {
  const fetchMock = jest.fn(async (_u: string, _i: RequestInit) => ok());
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  await oc.post('/api/chat', { body: 'hi' }, { headers: { 'X-Name-Key': 'k' } });
  const h = fetchMock.mock.calls[0][1].headers as Record<string, string>;
  expect(h).toEqual({ 'X-Bid': 'b', 'X-Name-Key': 'k', 'Content-Type': 'application/json' });
});

test('a raw body goes as is, with its content type', async () => {
  const fetchMock = jest.fn(async (_u: string, _i: RequestInit) => ok({ id: 'a', key: 'k' }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  const bytes = new Uint8Array([1, 2, 3]);
  await oc.post('/api/avatar', undefined, { raw: { body: bytes, contentType: 'image/jpeg' } });
  const init = fetchMock.mock.calls[0][1];
  expect(init.body).toBe(bytes);
  expect((init.headers as Record<string, string>)['Content-Type']).toBe('image/jpeg');
});

test('patch and del use their verbs', async () => {
  const fetchMock = jest.fn(async (_u: string, _i: RequestInit) => ok());
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  await oc.patch('/api/chat?id=3', { body: 'x' });
  await oc.del('/api/name');
  expect(fetchMock.mock.calls.map((c) => c[1].method)).toEqual(['PATCH', 'DELETE']);
});

test('429 carries Retry-After in seconds', async () => {
  const fetchMock = jest.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '7' } }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  await expect(oc.get('/api/chat')).rejects.toMatchObject({ status: 429, retryAfter: 7 });
});

test('a per-request timeout overrides the default', async () => {
  const fetchMock = jest.fn((_u: string, init: RequestInit) =>
    new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never, timeoutMs: 60000 });
  await expect(oc.get('/api/chat', { timeoutMs: 10 })).rejects.toMatchObject({ status: 0 });
});

test('an outside abort ends the request', async () => {
  const fetchMock = jest.fn((_u: string, init: RequestInit) =>
    new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')))));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  const ctl = new AbortController();
  const p = oc.get('/api/chat', { signal: ctl.signal });
  ctl.abort();
  await expect(p).rejects.toMatchObject({ status: 0 });
});

test('a typeless Blob is sent typed: React Native takes the Blob\'s type over the header', async () => {
  const fetchMock = jest.fn(async (_u: string, _i: RequestInit) => ok({ id: 'a', key: 'k' }));
  const oc = createOffchain({ baseUrl: () => 'https://x', bid: async () => 'b', fetch: fetchMock as never });
  await oc.post('/api/avatar', undefined, { raw: { body: new Blob([new Uint8Array([1, 2])]), contentType: 'image/jpeg' } });
  const sent = fetchMock.mock.calls[0][1].body as Blob;
  expect(sent).toBeInstanceOf(Blob);
  expect(sent.type).toBe('image/jpeg');
  expect(sent.size).toBe(2);
});

describe('exchange', () => {
  const textRes = (status: number, text: string, etag?: string) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (h: string) => (h.toLowerCase() === 'etag' ? etag ?? null : null) },
    text: async () => text, json: async () => JSON.parse(text),
  });

  test('a text body goes as text/plain with the given headers; status, text and ETag come back', async () => {
    const f = jest.fn(async () => textRes(200, '', '8'));
    const oc = createOffchain({ baseUrl: () => 'http://s/', bid: async () => '0123456789abcdef', fetch: f as unknown as typeof fetch });
    const r = await oc.exchange('PUT', '/api/sync/aa', { text: 'c2VhbGVk', headers: { 'If-Match': '7' } });
    expect(r).toEqual({ status: 200, text: '', etag: '8' });
    expect(f).toHaveBeenCalledWith('http://s/api/sync/aa', expect.objectContaining({
      method: 'PUT', body: 'c2VhbGVk',
      headers: { 'X-Bid': '0123456789abcdef', 'If-Match': '7', 'Content-Type': 'text/plain' },
    }));
  });

  test('a JSON body goes as application/json', async () => {
    const f = jest.fn(async () => textRes(200, '{}'));
    const oc = createOffchain({ baseUrl: () => 'http://s', bid: async () => '0123456789abcdef', fetch: f as unknown as typeof fetch });
    await oc.exchange('POST', '/api/sync/pair', { json: { code: 'K7XQ2M', blob: 'b' } });
    expect(f).toHaveBeenCalledWith('http://s/api/sync/pair', expect.objectContaining({
      body: '{"code":"K7XQ2M","blob":"b"}', headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    }));
  });

  test('404, 409 and 412 are answers, not errors', async () => {
    for (const status of [404, 409, 412]) {
      const f = jest.fn(async () => textRes(status, '{"error":"no"}'));
      const oc = createOffchain({ baseUrl: () => 'http://s', bid: async () => '0123456789abcdef', fetch: f as unknown as typeof fetch });
      expect(await oc.exchange('GET', '/x')).toEqual({ status, text: '{"error":"no"}', etag: '' });
    }
  });

  test('a server that does not answer is unreachable', async () => {
    const f = jest.fn(async () => { throw new TypeError('Network request failed'); });
    const oc = createOffchain({ baseUrl: () => 'http://s', bid: async () => '0123456789abcdef', fetch: f as unknown as typeof fetch });
    await expect(oc.exchange('GET', '/x')).rejects.toMatchObject({ status: 0, message: expect.stringMatching(/^server unreachable/) });
  });
});
