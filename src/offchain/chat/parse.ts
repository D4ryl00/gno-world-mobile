import type { ChatLine, ChatOlderReply, ChatPoll, ChatPollReply, Typing } from './types';

const num = (x: unknown, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const obj = (x: unknown): Record<string, unknown> =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const byId = (a: ChatLine, b: ChatLine) => a.id - b.id;

export function parseRx(x: unknown): Record<string, number> {
  const rx: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(x))) if (num(v) > 0) rx[k] = num(v);
  return rx;
}

export function parsePoll(x: unknown): ChatPoll | undefined {
  const p = obj(x);
  if (!Array.isArray(p.opts)) return undefined;
  return { q: str(p.q), opts: arr(p.opts).map(str), votes: arr(p.votes).map((v) => num(v)) };
}

/** A server line; null when it has no usable id. Unknown fields are ignored. */
export function parseLine(x: unknown): ChatLine | null {
  const o = obj(x);
  const id = num(o.id);
  if (!(id > 0)) return null;
  const re = obj(o.re);
  const att = obj(o.att);
  const rxwho: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(obj(o.rxwho))) rxwho[k] = arr(v).filter((s): s is string => typeof s === 'string');
  return {
    id, t: num(o.t), name: str(o.name), tag: str(o.tag), cc: str(o.cc), body: str(o.body),
    re: num(re.id) > 0 ? { id: num(re.id), name: str(re.name), body: str(re.body) } : undefined,
    rx: parseRx(o.rx), rxwho,
    edited: o.ed === true, pinned: o.pinned === true, reserved: o.v === true, av: str(o.av), bot: o.bot === true,
    poll: parsePoll(o.poll),
    att: str(att.url) ? { kind: str(att.kind), url: str(att.url), name: str(att.name) } : undefined,
    clip: str(o.clip),
  };
}

const lines = (x: unknown) => arr(x).map(parseLine).filter((l): l is ChatLine => l !== null);
const orNull = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function parsePollReply(x: unknown): ChatPollReply {
  const o = obj(x);
  const you = obj(o.you);
  const typing: Typing[] = arr(o.typing).map(obj)
    .filter((t) => str(t.name) !== '')
    .map((t) => ({ name: str(t.name), n: num(t.n) }));
  return {
    msgs: lines(o.msgs).sort(byId),
    gone: arr(o.gone).map((n) => num(n)).filter((n) => n > 0),
    upd: lines(o.upd),
    next: orNull(o.next),
    gen: orNull(o.gen),
    pins: lines(o.pins),
    typing,
    here: orNull(o.here),
    you: typeof you.tag === 'string' ? { cc: str(you.cc), tag: str(you.tag) } : null,
  };
}

export function parseOlderReply(x: unknown): ChatOlderReply {
  const o = obj(x);
  return { msgs: lines(o.msgs).sort(byId), more: o.more === true };
}
