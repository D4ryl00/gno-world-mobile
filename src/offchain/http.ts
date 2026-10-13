import type { SecretStore } from '@/session/keys';

export class OffchainError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) {
    super(message);
    this.name = 'OffchainError';
  }
}

export interface RequestOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** aborts the request from outside (the chat loop stopping) */
  signal?: AbortSignal;
  /** a raw body (an avatar's bytes) instead of JSON */
  raw?: { body: Blob | Uint8Array; contentType: string };
}

/** A reply read as text, whatever its status: the sync routes answer 404, 409 and 412 as part of their protocol. */
export interface TextReply {
  status: number;
  text: string;
  etag: string;
}

export interface Offchain {
  get<T>(path: string, o?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, o?: RequestOptions): Promise<T>;
  patch<T>(path: string, body: unknown, o?: RequestOptions): Promise<T>;
  del<T>(path: string, o?: RequestOptions): Promise<T>;
  exchange(method: 'GET' | 'POST' | 'PUT', path: string, o?: RequestOptions & { text?: string; json?: unknown }): Promise<TextReply>;
}

interface Body {
  payload?: BodyInit;
  type?: string;
}

export function createOffchain(d: {
  baseUrl: () => string;
  bid: () => Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Offchain {
  const f = d.fetch ?? fetch;
  async function call<T>(method: string, path: string, body: Body, o: RequestOptions, read: (res: Response) => Promise<T>): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? d.timeoutMs ?? 10000);
    const outside = () => ctrl.abort();
    if (o.signal?.aborted) ctrl.abort();
    o.signal?.addEventListener('abort', outside);
    try {
      // the timeout covers the browser id too (it comes from the secure store)
      const bid = await new Promise<string>((resolve, reject) => {
        ctrl.signal.addEventListener('abort', () => reject(new Error('timed out')));
        d.bid().then(resolve, reject);
      });
      const headers: Record<string, string> = { 'X-Bid': bid, ...o.headers };
      if (body.type) headers['Content-Type'] = body.type;
      const res = await f(d.baseUrl().replace(/\/+$/, '') + path, { method, headers, body: body.payload, signal: ctrl.signal });
      return await read(res);
    } catch (e) {
      if (e instanceof OffchainError) throw e;
      throw new OffchainError(0, `server unreachable (${(e as Error)?.message ?? e})`);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', outside);
    }
  }
  function jsonBody(body: unknown, o: RequestOptions): Body {
    if (o.raw) {
      const b = o.raw.body;
      // React Native sends a Blob with its own type, whatever the header says: give it the right one
      const payload = (typeof Blob !== 'undefined' && b instanceof Blob && b.type !== o.raw.contentType
        ? new Blob([b], { type: o.raw.contentType })
        : b) as BodyInit;
      return { payload, type: o.raw.contentType };
    }
    return body !== undefined ? { payload: JSON.stringify(body), type: 'application/json' } : {};
  }
  const request = <T>(method: string, path: string, body?: unknown, o: RequestOptions = {}): Promise<T> =>
    call(method, path, jsonBody(body, o), o, async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const retry = Number(res.headers?.get?.('Retry-After')) || undefined;
        throw new OffchainError(res.status, (data as { error?: string })?.error || `HTTP ${res.status}`, retry);
      }
      return data as T;
    });
  return {
    get: (path, o) => request('GET', path, undefined, o),
    post: (path, body, o) => request('POST', path, body, o),
    patch: (path, body, o) => request('PATCH', path, body, o),
    del: (path, o) => request('DELETE', path, undefined, o),
    exchange: (method, path, o = {}) =>
      call(
        method, path,
        o.text !== undefined ? { payload: o.text, type: 'text/plain' } : o.json !== undefined ? { payload: JSON.stringify(o.json), type: 'application/json' } : {},
        o,
        async (res) => ({ status: res.status, text: await res.text().catch(() => ''), etag: res.headers?.get?.('ETag') ?? '' }),
      ),
  };
}

const BID_KEY = 'br.bid';

const inFlightIds = new WeakMap<SecretStore, Promise<string>>();

/** The site's per-browser id (X-Bid): 16 hex, kept in the secure store. Concurrent first calls share one id. */
export function browserId(store: SecretStore, randomHex: (n: number) => string): Promise<string> {
  const running = inFlightIds.get(store);
  if (running) return running;
  const promise = (async () => {
    const have = await store.get(BID_KEY);
    if (have && /^[0-9a-f]{16}$/.test(have)) return have;
    const id = randomHex(8);
    await store.set(BID_KEY, id);
    return id;
  })();
  inFlightIds.set(store, promise);
  // once settled, the next call reads the store again (a failure is not remembered)
  void promise.finally(() => inFlightIds.delete(store)).catch(() => undefined);
  return promise;
}
