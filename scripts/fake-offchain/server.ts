// A stand-in for gno.world's chat, written from the site's public JS (2026-10-05): the M2a endpoints and
// their rules, and /pair's sync routes (read 2026-10-13), in memory. The name rules were read again on 2026-10-12 (a wallet proof or a boop from the last 3
// minutes; one name a wallet). For the e2e tests and the simulator; never a reference for the real server.
import { createHash, createPublicKey, ECDH, randomBytes, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { bech32 } from 'bech32';

export const REACTIONS = ['👍', '🔥', '❤️', '😂', '🤔', '🤝', '👎'];
const WINDOW = 900; // edit and take-back, seconds
const OTHER = 'fake-someone-else';

interface Line {
  id: number; t: number; name: string; tag: string; cc: string; body: string;
  re?: { id: number; name: string; body: string };
  rxBy: Record<string, string[]>; // emoji -> client ids
  rxNames: Record<string, string[]>;
  ed?: boolean; pinned?: boolean; v?: boolean; av?: string; bot?: boolean;
  poll?: { q: string; opts: string[]; votes: number[] };
  voters?: Record<string, number>;
  author: string;
  changedAt: number;
}

export interface FakeOptions { host?: string; now?: () => number; maxWait?: number; gen?: number }
export interface FakeServer {
  url: string;
  close(): Promise<void>;
  /** the room is gone (404 everywhere), as one quiet for a month */
  vanish(roomId: string): void;
  /** long polls waiting right now, by room ('' is Public) */
  waiting(): string[];
}

interface Log { lines: Line[]; gone: { id: number; at: number }[]; typing: Map<string, { name: string; n: number; until: number }> }
const newLog = (): Log => ({ lines: [], gone: [], typing: new Map() });
interface Room { id: string; name: string; key: string; listed: boolean; made: number; vanished: boolean; log: Log }
interface Dm { room: string; name: string; from: string; kind: 'room'; at: number }
// the site's words (M2b-2 spec §3)
const NO_SUCH_ROOM = 'no such room — the link may be wrong, or the room was quiet for a month and is gone';
const NOT_MAKER = 'only the room\'s maker can do that';
const ROOM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
const newRoomId = () => [...randomBytes(20)].map((b) => ROOM_CHARS[b % 64]).join('');

const tagOf = (bid: string) => createHash('sha256').update(bid).digest('hex').slice(0, 4);
const fold = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '');
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
const CODE_LIFE = 600; // seconds
const BAD_CODE = 'a code is six letters and digits';
const BOOP_PROVES = 180; // seconds a boop proves the wallet, as the site says

const addressOf = (pub: Buffer) =>
  bech32.encode('g', bech32.toWords(createHash('ripemd160').update(createHash('sha256').update(pub).digest()).digest()));

/** The site's proof check as seen from outside: the key's address must be addr, the phrase one handed out. */
function proofError(body: Record<string, any>, addr: string, challenges: Set<string>): string {
  try {
    const pub = Buffer.from(String(body.pub), 'base64');
    if (pub.length !== 33) return 'that key is not a key';
    const owner = addressOf(pub);
    if (owner !== addr) return `that signature does not prove this wallet: that key belongs to ${owner.slice(0, 8)}`;
    const doc = JSON.parse(String(body.doc));
    const msg = doc?.msgs?.[0]?.value;
    const words = Buffer.from(String(msg?.data ?? ''), 'base64').toString('utf8');
    if (msg?.signer !== addr || !challenges.has(words)) return 'that phrase is not one this box handed out';
    const un = ECDH.convertKey(pub, 'secp256k1', undefined, undefined, 'uncompressed') as Buffer;
    const key = createPublicKey({
      key: { kty: 'EC', crv: 'secp256k1', x: un.subarray(1, 33).toString('base64url'), y: un.subarray(33).toString('base64url') },
      format: 'jwk',
    });
    if (!verify('sha256', Buffer.from(String(body.doc)), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(String(body.sig), 'base64'))) {
      return 'that signature does not check out';
    }
    challenges.delete(words); // a phrase is good once
    return '';
  } catch {
    return 'that proof is unreadable';
  }
}

function wire(l: Line) {
  const rx: Record<string, number> = {};
  const rxwho: Record<string, string[]> = {};
  for (const [e, bids] of Object.entries(l.rxBy)) if (bids.length) {
    rx[e] = bids.length;
    rxwho[e] = l.rxNames[e] ?? [];
  }
  return {
    id: l.id, t: l.t, name: l.name, tag: l.tag, ...(l.cc ? { cc: l.cc } : {}), body: l.body,
    ...(l.re ? { re: l.re } : {}), ...(Object.keys(rx).length ? { rx, rxwho } : {}),
    ...(l.ed ? { ed: true } : {}), ...(l.pinned ? { pinned: true } : {}), ...(l.v ? { v: true } : {}),
    ...(l.av ? { av: l.av } : {}), ...(l.bot ? { bot: true } : {}), ...(l.poll ? { poll: l.poll } : {}),
  };
}

export async function startFakeServer(port = 0, o: FakeOptions = {}): Promise<FakeServer> {
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  const maxWait = o.maxWait ?? 55;
  let seq = 0;
  // a new run is a new log, as a real server's reset: clients that knew the old one reload
  let gen = o.gen ?? Date.now() % 1_000_000_000;
  const pub = newLog();
  const rooms = new Map<string, Room>();
  // who last polled under a name: invitations go to them (the site's "whoever last spoke as bob")
  const spokeAs = new Map<string, string>();
  const dms = new Map<string, Dm[]>();
  const pollers = new Map<number, string>();
  let pollSeq = 0;
  const names = new Map<string, { name: string; key: string; addr: string }>();
  const boops = new Map<string, { addr: string; at: number }>();
  const challenges = new Set<string>();
  const avatars = new Map<string, { key: string; bytes: Buffer; type: string }>();
  const pairs = new Map<string, { blob: string; until: number }>();
  const records = new Map<string, { v: number; text: string }>();
  const groups: string[] = [];
  const waiters = new Set<() => void>();
  let failNext: { status: number; retryAfter: number } | null = null;

  const wake = () => {
    for (const w of [...waiters]) w();
    waiters.clear();
  };
  const add = (p: Partial<Line> & { name: string; body: string; author: string }, log: Log = pub) => {
    const id = ++seq;
    const l: Line = { id, t: now(), tag: p.author === OTHER ? 'zzzz' : tagOf(p.author), cc: 'FR', rxBy: {}, rxNames: {}, changedAt: id, ...p };
    log.lines.push(l);
    wake();
    return l;
  };
  const touch = (l: Line) => {
    l.changedAt = ++seq;
    wake();
  };

  // seed: what a first page shows on the site
  const hello = add({ name: 'jae', body: 'welcome to the chat — be kind', author: OTHER, pinned: true });
  add({ name: 'jarvis', body: 'on it — the workshop reads this now', author: 'fake-bot', bot: true, tag: 'jrvs', re: { id: hello.id, name: 'jae', body: hello.body } });
  add({ name: 'cat', body: 'which pool tonight?', author: OTHER, poll: { q: 'which pool tonight?', opts: ['the big one', 'rapid fire'], votes: [2, 1] } });
  const liked = add({ name: 'bob', body: 'gl everyone', author: OTHER });
  liked.rxBy['🔥'] = [OTHER];
  liked.rxNames['🔥'] = ['cat'];

  const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
    res.end(JSON.stringify(body));
  };
  const sendText = (res: ServerResponse, status: number, text: string, headers: Record<string, string> = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
    res.end(text);
  };
  const readBody = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve, reject) => {
      const parts: Buffer[] = [];
      req.on('data', (c: Buffer) => parts.push(c));
      req.on('end', () => resolve(Buffer.concat(parts)));
      req.on('error', reject);
    });
  const jsonOf = (b: Buffer): Record<string, any> => {
    try {
      const v = JSON.parse(b.toString('utf8') || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  };

  const page = (log: Log, bid: string, since: number, limit: number, room?: Room) => {
    const t = now();
    for (const [k, v] of log.typing) if (v.until <= t) log.typing.delete(k);
    const msgs = since === 0 ? log.lines.slice(-limit) : log.lines.filter((l) => l.id > since).slice(0, limit);
    return {
      msgs: msgs.map(wire),
      upd: since === 0 ? [] : log.lines.filter((l) => l.id <= since && l.changedAt > since).map(wire),
      gone: log.gone.filter((g) => g.at > since).map((g) => g.id),
      next: seq, gen, now: t, here: room ? 2 : 3, you: { cc: 'FR', tag: tagOf(bid) },
      pins: log.lines.filter((l) => l.pinned).map(wire),
      typing: [...log.typing.entries()].filter(([k]) => k !== bid).map(([, v]) => ({ name: v.name, n: v.n })),
      ...(room ? { name: room.name } : { dm: dms.get(bid) ?? [] }),
      build: 'fake',
    };
  };
  const hasNews = (p: ReturnType<typeof page>) => p.msgs.length + p.upd.length + p.gone.length > 0;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://fake');
      const q = url.searchParams;
      const bid = String(req.headers['x-bid'] ?? 'nobid');
      const key = String(req.headers['x-name-key'] ?? '');
      const route = `${req.method} ${url.pathname}`;
      const raw = await readBody(req);
      const body = jsonOf(raw);
      // a room's chat: room= on most routes, X-Room on react and vote
      const roomId = q.get('room') ?? String(req.headers['x-room'] ?? '');
      const where = roomId ? rooms.get(roomId) : undefined;
      if (roomId && url.pathname.startsWith('/api/chat') && (!where || where.vanished)) return send(res, 404, { error: NO_SUCH_ROOM });
      const log = where?.log ?? pub;
      const maker = !!where && String(req.headers['x-room-key'] ?? '') === where.key;

      if (route === 'GET /api/chat') {
        if (failNext) {
          const f = failNext;
          failNext = null;
          return send(res, f.status, { error: 'busy' }, { 'Retry-After': String(f.retryAfter) });
        }
        if (q.has('before')) {
          const before = Number(q.get('before'));
          const limit = Number(q.get('limit') ?? 100);
          const older = log.lines.filter((l) => l.id < before);
          return send(res, 200, { msgs: older.slice(-limit).map(wire), more: older.length > limit });
        }
        const since = Number(q.get('since') ?? 0);
        const limit = Number(q.get('limit') ?? 80);
        const wait = Math.min(Number(q.get('wait') ?? 0), maxWait);
        if (q.get('name')) spokeAs.set(fold(String(q.get('name'))), bid);
        let p = page(log, bid, since, limit, where);
        if (!hasNews(p) && wait > 0) {
          await new Promise<void>((resolve) => {
            const n = ++pollSeq;
            pollers.set(n, roomId);
            const done = () => {
              pollers.delete(n);
              resolve();
            };
            const timer = setTimeout(done, wait * 1000);
            const early = () => {
              clearTimeout(timer);
              done();
            };
            waiters.add(early);
            // a client that gave up (a stopped loop) no longer waits
            res.on('close', early);
          });
          if (res.destroyed) return;
          p = page(log, bid, since, limit, where);
        }
        return send(res, 200, p);
      }

      if (route === 'POST /api/chat') {
        const text = String(body.body ?? '').trim();
        if (!text || text.length > 2000) return send(res, 400, { error: 'say something (2000 characters at most)' });
        const name = String(body.name ?? '').trim() || 'anon';
        const owner = names.get(fold(name));
        if (owner && owner.key !== key) return send(res, 403, { error: `"${name}" is reserved — pick another name` });
        const re = log.lines.find((l) => l.id === Number(body.re));
        const av = typeof body.av === 'string' && avatars.get(body.av)?.key === body.avkey ? body.av : undefined;
        const l = add({
          name: owner ? owner.name : name, body: text, author: bid, v: !!owner, av,
          re: re ? { id: re.id, name: re.name, body: re.body.slice(0, 80) } : undefined,
        }, log);
        log.typing.delete(bid);
        return send(res, 200, { msg: wire(l) });
      }

      if (route === 'PATCH /api/chat') {
        const l = log.lines.find((x) => x.id === Number(q.get('id')));
        if (!l) return send(res, 404, { error: 'no such line' });
        if (l.author !== bid || now() - l.t >= WINDOW) return send(res, 403, { error: 'only your own line, under fifteen minutes old' });
        const text = String(body.body ?? '').trim();
        if (!text) return send(res, 400, { error: 'say something' });
        l.body = text;
        l.ed = true;
        touch(l);
        return send(res, 200, { msg: wire(l) });
      }

      if (route === 'POST /api/chat/pin') {
        if (!maker) return send(res, 403, { error: NOT_MAKER });
        const l = log.lines.find((x) => x.id === Number(q.get('id')));
        if (!l) return send(res, 404, { error: 'no such line' });
        l.pinned = q.get('on') !== '0';
        touch(l);
        return send(res, 200, { pins: log.lines.filter((x) => x.pinned).map(wire), msg: wire(l) });
      }

      if (route === 'DELETE /api/chat') {
        if (!maker) return send(res, 403, { error: NOT_MAKER });
        const i = log.lines.findIndex((x) => x.id === Number(q.get('id')));
        if (i < 0) return send(res, 404, { error: 'no such line' });
        const [l] = log.lines.splice(i, 1);
        log.gone.push({ id: l.id, at: ++seq });
        wake();
        return send(res, 200, { ok: true });
      }

      if (route === 'POST /api/chat/withdraw') {
        const l = log.lines.at(-1);
        if (!l || l.author !== bid || now() - l.t >= WINDOW) return send(res, 200, { deleted: 0 });
        log.lines.pop();
        log.gone.push({ id: l.id, at: ++seq });
        wake();
        return send(res, 200, { deleted: l.id });
      }

      if (route === 'POST /api/chat/react') {
        const l = log.lines.find((x) => x.id === Number(body.id));
        const emoji = String(body.emoji ?? '');
        if (!REACTIONS.includes(emoji)) return send(res, 400, { error: 'not a reaction' });
        if (!l) return send(res, 404, { error: 'no such line' });
        const by = (l.rxBy[emoji] ??= []);
        const who = (l.rxNames[emoji] ??= []);
        const i = by.indexOf(bid);
        if (i >= 0) {
          by.splice(i, 1);
          who.splice(i, 1);
        } else {
          by.push(bid);
          who.push(String(body.name ?? 'anon'));
        }
        touch(l);
        const w = wire(l);
        return send(res, 200, { rx: w.rx ?? {}, mine: i < 0 });
      }

      if (route === 'POST /api/chat/vote') {
        const l = log.lines.find((x) => x.id === Number(body.id));
        const opt = Number(body.opt);
        if (!l?.poll || !(opt >= 0 && opt < l.poll.opts.length)) return send(res, 400, { error: 'no such option' });
        l.voters ??= {};
        const prev = l.voters[bid];
        if (prev !== undefined) l.poll.votes[prev]--;
        l.poll.votes[opt]++;
        l.voters[bid] = opt;
        touch(l);
        return send(res, 200, { mine: opt, poll: l.poll });
      }

      if (route === 'POST /api/chat/typing') {
        const n = Number(body.n) || 0;
        if (n > 0) log.typing.set(bid, { name: String(body.name ?? 'anon'), n, until: now() + 6 });
        else log.typing.delete(bid);
        wake();
        return send(res, 200, {});
      }

      if (route === 'POST /api/room' && !q.has('id')) {
        const name = String(body.name ?? '').trim().slice(0, 120);
        if (!name) return send(res, 400, { error: 'a room needs a name' });
        const r: Room = { id: newRoomId(), name, key: randomBytes(16).toString('hex'), listed: body.public === true, made: now(), vanished: false, log: newLog() };
        rooms.set(r.id, r);
        return send(res, 200, { id: r.id, name: r.name, key: r.key });
      }
      if (url.pathname === '/api/room' || url.pathname === '/api/room/invite') {
        const r = rooms.get(q.get('id') ?? q.get('room') ?? '');
        if (!r || r.vanished) return send(res, 404, { error: NO_SUCH_ROOM });
        if (req.method === 'GET') return send(res, 200, { id: r.id, name: r.name, public: r.listed, here: 2, made: r.made, announce: '' });
        if (String(req.headers['x-room-key'] ?? '') !== r.key) return send(res, 403, { error: NOT_MAKER });
        if (route === 'DELETE /api/room') {
          rooms.delete(r.id);
          wake();
          return send(res, 200, { ok: true });
        }
        if (route === 'POST /api/room/invite') {
          const to = String(body.to ?? '').trim();
          const who = spokeAs.get(fold(to));
          if (!who) return send(res, 404, { error: `nobody spoke as ${to} lately` });
          const list = dms.get(who) ?? [];
          list.push({ room: r.id, name: r.name, from: String(body.name ?? 'anon'), kind: 'room', at: now() });
          dms.set(who, list);
          wake();
          return send(res, 200, { to });
        }
        if (typeof body.name === 'string') {
          r.name = body.name.trim().slice(0, 120) || r.name;
          wake();
          return send(res, 200, { name: r.name });
        }
        if (typeof body.public === 'boolean') r.listed = body.public;
        return send(res, 200, {});
      }
      if (route === 'GET /api/rooms') {
        return send(res, 200, {
          rooms: [...rooms.values()].filter((r) => r.listed && !r.vanished)
            .map((r) => ({ id: r.id, name: r.name, slug: r.name.toLowerCase(), here: 2, voice: 0, made: r.made, lat: 0, lon: 0 })),
        });
      }

      if (route === 'POST /api/bubble/boop') {
        const addr = String(body.addr ?? '');
        if (!/^g1[0-9a-z]{38}$/.test(addr) || !(Number(body.pool) > 0) || !(Number(body.n) > 0)) return send(res, 400, { error: 'bad boop report' });
        boops.set(bid, { addr, at: now() });
        return send(res, 200, { ok: true });
      }

      if (route === 'GET /api/name/challenge') {
        const words = `fake: prove this wallet is yours · ${randomBytes(12).toString('base64url')}`;
        challenges.add(words);
        return send(res, 200, { words });
      }

      if (route === 'POST /api/name') {
        const addr = String(body.addr ?? '');
        if (!/^g1[0-9a-z]{38}$/.test(addr)) return send(res, 400, { error: 'connect your wallet first' });
        const held = [...names.values()].find((e) => e.addr === addr);
        if (held) return send(res, 409, { error: `this wallet holds the name ${held.name} already — one name a wallet` });
        const boop = boops.get(bid);
        if (!(boop?.addr === addr && now() - boop.at <= BOOP_PROVES)) {
          if (!body.doc) {
            return send(res, 409, { error: 'Connect your wallet and let it sign the phrase this page asks for — a boop from the last 3 minutes does the same.' });
          }
          const why = proofError(body, addr, challenges);
          if (why) return send(res, 409, { error: why });
        }
        const name = String(body.name ?? '').trim();
        if (!name || name.length > 32) return send(res, 400, { error: 'a name of 1 to 32 characters' });
        const taken = names.get(fold(name));
        if (taken && taken.addr !== addr) return send(res, 409, { error: 'that name or a look-alike is taken' });
        const entry = { name, key: randomBytes(16).toString('hex'), addr };
        names.set(fold(name), entry);
        return send(res, 200, entry);
      }
      if (route === 'GET /api/name') {
        if (q.has('addr')) return send(res, 200, { name: [...names.values()].find((e) => e.addr === q.get('addr'))?.name ?? '' });
        const e = names.get(fold(q.get('name') ?? ''));
        const mine = !!e && !!key && key === e.key;
        return send(res, 200, e ? { name: e.name, reserved: true, by: e.addr, mine, ...(mine ? { addr: e.addr } : {}) } : { name: q.get('name') ?? '' });
      }
      if (route === 'DELETE /api/name') {
        const e = [...names.entries()].find(([, v]) => key && v.key === key);
        if (!e) return send(res, 404, { error: 'no reserved name for this key' });
        names.delete(e[0]);
        return send(res, 200, { ok: true });
      }

      if (route === 'POST /api/avatar') {
        const type = String(req.headers['content-type'] ?? '');
        if (!type.startsWith('image/')) return send(res, 400, { error: 'a picture, please' });
        if (raw.length === 0 || raw.length > 2_000_000) return send(res, 400, { error: 'a picture under 2 MB' });
        const id = randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8);
        const k = randomBytes(8).toString('hex');
        avatars.set(id, { key: k, bytes: raw, type });
        return send(res, 200, { id, key: k });
      }
      const av = /^\/api\/avatar\/([a-z0-9]+)\.jpg$/.exec(url.pathname);
      if (req.method === 'GET' && av) {
        const a = avatars.get(av[1]);
        if (!a) return send(res, 404, { error: 'no such picture' });
        res.writeHead(200, { 'Content-Type': a.type });
        return res.end(a.bytes);
      }

      if (route === 'POST /api/sync/pair') {
        const code = String(body.code ?? '');
        const blob = String(body.blob ?? '');
        if (!CODE_RE.test(code)) return send(res, 400, { error: BAD_CODE });
        if (!blob || blob.length > 4096) return send(res, 400, { error: 'no key to hand over' });
        const had = pairs.get(code);
        if (had && had.until > now()) return send(res, 409, { error: 'that code is in use' });
        pairs.set(code, { blob, until: now() + CODE_LIFE });
        return send(res, 200, { ok: true });
      }
      const pairCode = /^\/api\/sync\/pair\/([^/]*)$/.exec(url.pathname);
      if (req.method === 'GET' && pairCode) {
        const code = decodeURIComponent(pairCode[1]);
        if (!CODE_RE.test(code)) return send(res, 400, { error: BAD_CODE });
        const p = pairs.get(code);
        pairs.delete(code); // a code works once
        if (!p || p.until <= now()) return send(res, 404, { error: 'no such code — it may have been used, or it is older than ten minutes' });
        return send(res, 200, { blob: p.blob });
      }
      const sync = /^\/api\/sync\/([0-9a-f]{64})$/.exec(url.pathname);
      if (sync && req.method === 'GET') {
        const r = records.get(sync[1]);
        return r ? sendText(res, 200, r.text, { ETag: String(r.v) }) : send(res, 404, { error: 'nothing here yet' });
      }
      if (sync && req.method === 'PUT') {
        const v = records.get(sync[1])?.v ?? 0;
        if (String(req.headers['if-match'] ?? '') !== String(v)) return send(res, 412, { error: 'changed meanwhile — read it again' });
        if (raw.length === 0 || raw.length > 65536) return send(res, 400, { error: 'a sealed record of 64 KB at most' });
        records.set(sync[1], { v: v + 1, text: raw.toString('utf8') });
        return send(res, 200, { ok: true }, { ETag: String(v + 1) });
      }
      if (url.pathname.startsWith('/api/sync/')) return sendText(res, 404, '404 page not found');
      if (route === 'POST /presence') {
        const g = q.get('g');
        if (g && !groups.includes(g)) groups.push(g);
        return send(res, 200, { you: 'FR', count: 3 });
      }
      // the Home tab: fixed prices and a fixed crowd
      if (route === 'GET /api/prices') {
        const days = Number(q.get('days')) || 1;
        const at = Math.floor(Date.now() / 1000);
        const step = (days * 86400) / 59;
        const series = Array.from({ length: 60 }, (_, i) => [Math.round(at - (59 - i) * step), Number((0.0582 + 0.002 * Math.sin(i / 6) * (1 - i / 59)).toFixed(5))]);
        // every third point traded nothing, as on the real chart
        const volumes = series.map(([t], i) => [t, i % 3 ? Math.round(100 + 900 * Math.abs(Math.cos(i))) : 0]);
        return send(res, 200, { coin: 'gnot', name: 'GNOT', days, now: 0.0582, at, change: -0.31, cap: 11487970.4, supply: 1333000000, fdv: 77713900, series, volumes });
      }
      if (route === 'GET /api/where') {
        const spots = [{ cc: 'FR', lat: 48.75, lon: 2.25, n: 2 }, { cc: 'FR', lat: 45.75, lon: 4.75, n: 1 }, { cc: 'ES', lat: 40.5, lon: -3.75, n: 1 }];
        return send(res, 200, { by_country: [{ cc: 'FR', n: 3 }, { cc: 'ES', n: 1 }], count: 5, elsewhere: 1, geo: true, spots });
      }

      // test-only routes
      if (route === 'POST /__test/say') {
        const l = add({ name: String(body.name ?? 'zed'), body: String(body.body ?? 'hi'), author: OTHER, pinned: !!body.pinned, bot: !!body.bot });
        return send(res, 200, { msg: wire(l) });
      }
      if (route === 'POST /__test/name') {
        const name = String(body.name ?? '');
        names.set(fold(name), { name, key: String(body.key ?? ''), addr: String(body.addr ?? '') });
        return send(res, 200, { ok: true });
      }
      if (route === 'GET /__test/presence') return send(res, 200, { groups });
      if (route === 'POST /__test/gen') {
        gen++;
        wake();
        return send(res, 200, { gen });
      }
      if (route === 'POST /__test/fail') {
        failNext = { status: Number(body.status) || 503, retryAfter: Number(body.retryAfter) || 1 };
        return send(res, 200, {});
      }
      if (route === 'POST /__test/age') {
        const l = pub.lines.find((x) => x.id === Number(body.id));
        if (l) l.t -= Number(body.seconds) || 0;
        return send(res, 200, {});
      }
      return send(res, 404, { error: `no route ${route}` });
    } catch (e) {
      return send(res, 500, { error: String(e) });
    }
  });

  await new Promise<void>((resolve) => server.listen(port, o.host ?? '127.0.0.1', resolve));
  const addr = server.address();
  const actual = typeof addr === 'object' && addr ? addr.port : port;
  return {
    url: `http://${o.host ?? '127.0.0.1'}:${actual}`,
    vanish: (roomId) => {
      const r = rooms.get(roomId);
      if (r) r.vanished = true;
      wake();
    },
    waiting: () => [...pollers.values()],
    close: () =>
      new Promise<void>((resolve) => {
        wake();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
