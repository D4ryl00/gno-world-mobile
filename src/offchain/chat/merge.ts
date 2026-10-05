import type { ChatLine, ChatOlderReply, ChatPollReply, ChatYou, Typing } from './types';

/** Lines kept in memory; older ones come back by scrolling up. */
export const MAX_LINES = 500;

export interface ChatView {
  /** ascending id */
  lines: ChatLine[];
  pins: ChatLine[];
  typing: Typing[];
  here: number;
  you: ChatYou | null;
  /** the long-poll cursor */
  since: number;
  gen: number | null;
  /** older history may exist */
  more: boolean;
}

export const EMPTY_VIEW: ChatView = { lines: [], pins: [], typing: [], here: 0, you: null, since: 0, gen: null, more: true };

const byId = (a: ChatLine, b: ChatLine) => a.id - b.id;

function upsertAll(lines: ChatLine[], add: ChatLine[]): ChatLine[] {
  if (!add.length) return lines;
  const m = new Map(lines.map((l) => [l.id, l]));
  for (const l of add) m.set(l.id, l);
  return [...m.values()].sort(byId);
}

/** The server restarted its log: everything held is stale. */
export const genChanged = (v: ChatView, r: ChatPollReply) => v.gen !== null && r.gen !== null && r.gen !== v.gen;

export function applyPoll(v: ChatView, r: ChatPollReply): ChatView {
  const held = new Set(v.lines.map((l) => l.id));
  const gone = new Set(r.gone);
  let lines = upsertAll(v.lines, [...r.msgs, ...r.upd.filter((l) => held.has(l.id))]).filter((l) => !gone.has(l.id));
  const trimmed = lines.length > MAX_LINES;
  if (trimmed) lines = lines.slice(lines.length - MAX_LINES);
  const newest = r.msgs.reduce((m, l) => Math.max(m, l.id), 0);
  return {
    lines,
    pins: r.pins,
    typing: r.typing,
    here: r.here ?? v.here,
    you: r.you ?? v.you,
    since: Math.max(v.since, newest, r.next ?? 0),
    gen: r.gen ?? v.gen,
    more: trimmed ? true : v.more,
  };
}

export function applyOlder(v: ChatView, r: ChatOlderReply): ChatView {
  return { ...v, lines: upsertAll(v.lines, r.msgs), more: r.more && r.msgs.length > 0 };
}

export const upsertLine = <V extends ChatView>(v: V, l: ChatLine): V => ({ ...v, lines: upsertAll(v.lines, [l]) });

export const removeLine = <V extends ChatView>(v: V, id: number): V => ({ ...v, lines: v.lines.filter((l) => l.id !== id) });

export function patchLine<V extends ChatView>(v: V, id: number, p: Partial<ChatLine>): V {
  const i = v.lines.findIndex((l) => l.id === id);
  if (i < 0) return v;
  const lines = v.lines.slice();
  lines[i] = { ...lines[i], ...p };
  return { ...v, lines };
}

/** As on the site: the server's tag for this client, or a line this app posted. */
export const isMine = (l: ChatLine, you: ChatYou | null, mine: readonly number[]) =>
  (!!you?.tag && l.tag === you.tag) || mine.includes(l.id);

export const unreadCount = (v: { lines: ChatLine[]; you: ChatYou | null }, lastSeen: number, mine: readonly number[]) =>
  v.lines.filter((l) => l.id > lastSeen && !isMine(l, v.you, mine)).length;
