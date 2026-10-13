// gno.world's /pair as the site runs it (app-rooms.js, read 2026-10-13: roomsSave … syncAccept), replayed in Node with
// WebCrypto — the reference the app's sync is checked against, in the e2e and on devices (browser.mjs). Never shipped.
import { webcrypto } from 'node:crypto';

const crypto = webcrypto as unknown as Crypto;
const SYNCCODE = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const ROOMRE = /^[A-Za-z0-9_-]{20}$/;
const hexOf = (t: Uint8Array) => [...t].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (t: string) => new Uint8Array(t.match(/../g)!.map((x) => parseInt(x, 16)));
const syncB64 = (t: Uint8Array) => Buffer.from(t).toString('base64');
const syncUnb64 = (t: string) => new Uint8Array(Buffer.from(t, 'base64'));

export interface SiteRoom { id: string; name: string; key: string; at: number; irc?: boolean }

export class SiteBrowser {
  store = new Map<string, string>();
  SYNC: { key: CryptoKey | null; id: string | null; v: number; left: Record<string, number>; pushing: boolean; nameP: Promise<string> | null; nameLast: { o: string; name: string; have: string } | null } =
    { key: null, id: null, v: 0, left: {}, pushing: false, nameP: null, nameLast: null };

  private base: string;

  // a plain field, not a parameter property: Node runs this file with --experimental-strip-types
  constructor(base: string) {
    this.base = base;
  }

  private get localStorage() {
    const m = this.store;
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k) };
  }
  private fetch(path: string, init?: RequestInit) {
    return fetch(this.base + path, init);
  }
  private syncSoon() {
    // the site pushes 1.5 s later; here the caller pushes
  }

  /** the reserved name this browser holds, as the site keeps it */
  reserve(name: string, key: string) {
    this.localStorage.setItem('br.namekey', key);
    this.localStorage.setItem('br.namekeyname', name);
    this.localStorage.setItem('br.name', name);
  }
  chatReservedName() {
    return (this.localStorage.getItem('br.namekey') && this.localStorage.getItem('br.namekeyname')) || '';
  }

  roomsKnown(): SiteRoom[] {
    try {
      const t = JSON.parse(this.localStorage.getItem('br.rooms') || '[]');
      return Array.isArray(t) ? t.filter((x) => x && ROOMRE.test(x.id)) : [];
    } catch {
      return [];
    }
  }
  roomsSave(t: SiteRoom[]) {
    let e = 0;
    let a = 0;
    const n = (t || []).filter((x) => x && (x.key ? ++a <= 200 : ++e <= 30));
    this.localStorage.setItem('br.rooms', JSON.stringify(n));
  }
  roomRemember(t: { id: string; name?: string; key?: string; irc?: boolean }) {
    const e = this.roomsKnown();
    const a = e.find((x) => x.id === t.id) || ({} as Partial<SiteRoom>);
    this.roomsSave([
      { id: t.id, name: t.name || a.name || 'private room', key: t.key || a.key || '', at: Date.now(), irc: !(!t.irc && !a.irc) || undefined },
      ...e.filter((x) => x.id !== t.id),
    ]);
    if (this.SYNC.left && this.SYNC.left[t.id]) {
      delete this.SYNC.left[t.id];
      this.localStorage.setItem('br.syncleft', JSON.stringify(this.SYNC.left));
    }
    this.syncSoon();
  }
  roomForget(t: string) {
    this.roomsSave(this.roomsKnown().filter((x) => x.id !== t));
    this.SYNC.left[t] = Date.now();
    this.localStorage.setItem('br.syncleft', JSON.stringify(this.SYNC.left));
    this.syncSoon();
  }

  async syncUse(t: Uint8Array<ArrayBuffer>, e: boolean) {
    this.SYNC.key = await crypto.subtle.importKey('raw', t, 'AES-GCM', false, ['encrypt', 'decrypt']);
    this.SYNC.id = hexOf(new Uint8Array(await crypto.subtle.digest('SHA-256', t)));
    this.localStorage.setItem('br.synckey', hexOf(t));
    this.SYNC.left = JSON.parse(this.localStorage.getItem('br.syncleft') || '{}');
    this.SYNC.nameP = null;
    await this.syncPull();
    if (e) {
      try {
        await this.SYNC.nameP;
      } catch {
        // as the site: the name's outcome does not hold the push back
      }
      await this.syncPush();
    }
  }
  syncStop() {
    this.SYNC.key = null;
    this.SYNC.id = null;
    this.SYNC.v = 0;
    this.localStorage.removeItem('br.synckey');
  }
  async syncSeal(t: unknown, e = this.SYNC.key!) {
    const a = crypto.getRandomValues(new Uint8Array(12));
    const n = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: a }, e, new TextEncoder().encode(JSON.stringify(t))));
    const o = new Uint8Array(12 + n.length);
    o.set(a);
    o.set(n, 12);
    return o;
  }
  async syncOpen(t: Uint8Array, e = this.SYNC.key!) {
    const a = new Uint8Array(t);
    const n = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: a.slice(0, 12) }, e, a.slice(12));
    return JSON.parse(new TextDecoder().decode(n));
  }
  syncNameOut() {
    const t = this.localStorage.getItem('br.namekey');
    const e = this.localStorage.getItem('br.namekeyname');
    return /^[0-9a-f]{32,64}$/.test(t || '') && e ? { name: e, key: t } : undefined;
  }
  async syncNameIn(t: { name?: string; key?: string } | undefined): Promise<string> {
    const e = (o: string, name?: string, have?: string) => {
      this.SYNC.nameLast = { o, name: name || '', have: have || '' };
      return o;
    };
    if (!t || !/^[0-9a-f]{32,64}$/.test(String(t.key || '')) || !t.name) return e('none');
    const a = this.chatReservedName();
    const n = String(t.key);
    const o = String(t.name).slice(0, 40);
    const r = this.localStorage.getItem('br.namekey') || '';
    if (r === n) return e('same', o);
    const c = () => {
      this.localStorage.setItem('br.namekey', n);
      this.localStorage.setItem('br.namekeyname', o);
      this.localStorage.setItem('br.name', o);
      this.localStorage.removeItem('br.nameaddr');
    };
    const s = async (name: string, key: string) => {
      try {
        const res = await this.fetch('/api/name?name=' + encodeURIComponent(name), { headers: { 'X-Name-Key': key } });
        if (!res.ok) return null;
        const j = await res.json();
        return !(!j || j.mine !== true);
      } catch {
        return null;
      }
    };
    const i = await s(o, n);
    return a
      ? i === null ? e('unknown', o, a)
        : i === false ? e('refused', o, a)
        : a.toLowerCase() === o.toLowerCase() ? (c(), e('taken', o, a))
        : (await s(a, r)) !== false ? e('kept', o, a)
        : (c(), e('taken', o, a))
      : i === false ? e('refused', o)
      : (c(), e(i === null ? 'unknown' : 'taken', o));
  }
  syncPairWords(t: string) {
    const e = this.SYNC.nameLast || { name: '', have: '' };
    const a = e.name || 'the name';
    const n = 'paired — your chat rooms are the same on both devices';
    const o = e.have && e.have.toLowerCase() !== (e.name || '').toLowerCase() ? e.have : '';
    switch (t) {
      case 'taken': return n + ', and the name ' + a + ' is yours here too ✓' + (o ? ' — it replaces ' + o + ', whose key the box no longer honoured' : '');
      case 'same': return n + '; this device already had the name ' + a + ' ✓';
      case 'kept': return n + '. This device keeps its own name ' + o + "; the other device's name " + a + ' stays there';
      case 'refused': return n + ', but the name ' + a + ' did NOT come along: the device the code came from holds an old key for it. /dm jae there to free the name, reserve it again there, then pair once more';
      case 'unknown': return n + '; the name ' + a + ' could not be checked with the box just now — it is checked again within two minutes';
      default: return n + '. The other device holds no reserved name, so none came along';
    }
  }
  syncMerge(t: { rooms?: SiteRoom[]; left?: Record<string, number>; name?: { name?: string; key?: string } }) {
    this.SYNC.nameP = this.syncNameIn(t.name);
    const e: Record<string, number> = { ...this.SYNC.left };
    for (const [a, n] of Object.entries(t.left || {})) if (ROOMRE.test(a)) e[a] = Math.max(e[a] || 0, Number(n) || 0);
    const a = new Map<string, SiteRoom>();
    for (const x of [...this.roomsKnown(), ...(Array.isArray(t.rooms) ? t.rooms : [])]) {
      if (!x || !ROOMRE.test(x.id)) continue;
      const had = a.get(x.id);
      if (had) {
        if ((Number(x.at) || 0) > had.at) {
          had.at = Number(x.at) || 0;
          had.name = String(x.name || had.name).slice(0, 40);
        }
        if (!had.key && x.key) had.key = String(x.key);
      } else a.set(x.id, { id: x.id, name: String(x.name || 'private room').slice(0, 40), key: String(x.key || ''), at: Number(x.at) || 0 });
    }
    const n = [...a.values()].filter((x) => !(e[x.id] > x.at)).sort((x, y) => y.at - x.at);
    this.SYNC.left = e;
    this.localStorage.setItem('br.syncleft', JSON.stringify(e));
    this.roomsSave(n);
  }
  async syncPull() {
    if (!this.SYNC.key) return false;
    try {
      const t = await this.fetch('/api/sync/' + this.SYNC.id);
      if (t.status === 404) {
        this.SYNC.v = 0;
        return true;
      }
      if (!t.ok) return false;
      this.SYNC.v = Number(t.headers.get('ETag')) || 0;
      this.syncMerge(await this.syncOpen(syncUnb64((await t.text()).trim())));
      await this.SYNC.nameP;
      return true;
    } catch {
      return false;
    }
  }
  async syncPush() {
    if (!this.SYNC.key || this.SYNC.pushing) return;
    this.SYNC.pushing = true;
    try {
      for (let i = 0; i < 3; i++) {
        const t = await this.syncSeal({ rooms: this.roomsKnown(), left: this.SYNC.left, name: this.syncNameOut(), at: Date.now() });
        const e = await this.fetch('/api/sync/' + this.SYNC.id, { method: 'PUT', headers: { 'If-Match': String(this.SYNC.v), 'Content-Type': 'text/plain' }, body: syncB64(t) });
        if (e.ok) {
          this.SYNC.v = Number(e.headers.get('ETag')) || this.SYNC.v + 1;
          return;
        }
        if (e.status !== 412) return;
        await this.syncPull();
      }
    } catch {
      // as the site: the next change tries again
    } finally {
      this.SYNC.pushing = false;
    }
  }
  async syncCodeKey(t: string) {
    const e = await crypto.subtle.importKey('raw', new TextEncoder().encode(t), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: new TextEncoder().encode('bubblerumble rooms ' + t), iterations: 2e5, hash: 'SHA-256' },
      e, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
  }
  async syncStart() {
    await this.syncUse(crypto.getRandomValues(new Uint8Array(32)), true);
  }
  async syncOffer() {
    if (this.SYNC.key) await this.syncPush();
    else await this.syncStart();
    const t = unhex(this.localStorage.getItem('br.synckey')!);
    for (let i = 0; i < 3; i++) {
      const e = [...crypto.getRandomValues(new Uint8Array(6))].map((x) => SYNCCODE[x % 31]).join('');
      const a = await this.syncCodeKey(e);
      const n = crypto.getRandomValues(new Uint8Array(12));
      const o = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: n }, a, t));
      const r = new Uint8Array(12 + o.length);
      r.set(n);
      r.set(o, 12);
      const c = await this.fetch('/api/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: e, blob: syncB64(r) }) });
      if (c.ok) return e;
      if (c.status !== 409) {
        const j = await c.json().catch(() => ({}));
        throw new Error(j.error || 'could not make a code (' + c.status + ')');
      }
    }
    throw new Error('could not make a code');
  }
  async syncAccept(t: string) {
    if ((t = t.toUpperCase().replace(/[^A-Z2-9]/g, '')).length !== 6) throw new Error('a code is six letters and digits');
    const e = await this.fetch('/api/sync/pair/' + t);
    const a = await e.json().catch(() => ({}));
    if (!e.ok) throw new Error(a.error || 'no such code');
    const n = syncUnb64(a.blob);
    const o = await this.syncCodeKey(t);
    let r: Uint8Array<ArrayBuffer>;
    try {
      r = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: n.slice(0, 12) }, o, n.slice(12)));
    } catch {
      throw new Error('that code did not open the key');
    }
    if (r.length !== 32) throw new Error('that code did not open the key');
    await this.syncUse(r, true);
    let c = 'none';
    try {
      c = await (this.SYNC.nameP || Promise.resolve('none'));
    } catch {
      // as the site: no outcome reads as none
    }
    return this.syncPairWords(c);
  }
}
