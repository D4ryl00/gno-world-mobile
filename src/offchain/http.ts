import type { SecretStore } from '@/session/keys';

export class OffchainError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'OffchainError';
  }
}

export interface Offchain {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
}

export function createOffchain(d: {
  baseUrl: () => string;
  bid: () => Promise<string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Offchain {
  const f = d.fetch ?? fetch;
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), d.timeoutMs ?? 10000);
    try {
      // the timeout covers the browser id too (it comes from the secure store)
      const bid = await new Promise<string>((resolve, reject) => {
        ctrl.signal.addEventListener('abort', () => reject(new Error('timed out')));
        d.bid().then(resolve, reject);
      });
      const headers: Record<string, string> = { 'X-Bid': bid };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const res = await f(d.baseUrl().replace(/\/+$/, '') + path, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new OffchainError(res.status, (data as { error?: string })?.error || `HTTP ${res.status}`);
      return data as T;
    } catch (e) {
      if (e instanceof OffchainError) throw e;
      throw new OffchainError(0, `server unreachable (${(e as Error)?.message ?? e})`);
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
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
