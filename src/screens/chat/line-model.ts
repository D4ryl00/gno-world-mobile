import type { ChatLine, ChatPoll, Typing } from '@/offchain/chat/types';

/** The site's window to edit or take back a line, seconds. */
export const EDIT_WINDOW = 900;

export const canEdit = (l: ChatLine, mine: boolean, nowSec: number) => mine && !l.poll && nowSec - l.t < EDIT_WINDOW;

export const canWithdraw = (l: ChatLine, newestId: number, mine: boolean, nowSec: number) =>
  mine && l.id === newestId && nowSec - l.t < EDIT_WINDOW;

export function ago(t: number, nowSec: number): string {
  const s = Math.max(0, nowSec - t);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const URL_RE = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;

export function splitLinks(body: string): { text: string; url?: string }[] {
  const out: { text: string; url?: string }[] = [];
  let at = 0;
  for (const m of body.matchAll(URL_RE)) {
    if (m.index! > at) out.push({ text: body.slice(at, m.index) });
    out.push({ text: m[0], url: m[0] });
    at = m.index! + m[0].length;
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out;
}

/** What stands for an attachment or a voice message until M2c shows them. */
export function placeholder(l: ChatLine): string | null {
  if (l.clip) return '🎤 voice message';
  if (!l.att) return null;
  if (l.att.kind === 'image') return '📎 picture';
  if (l.att.kind === 'video') return '📎 video';
  return `📎 file${l.att.name ? ` · ${l.att.name}` : ''}`;
}

/** The site's words: three typists at most, dots for the length so far. */
export function typingText(typing: Typing[], myName: string): string {
  const me = myName.trim().toLowerCase();
  return typing
    .filter((t) => t.name.trim().toLowerCase() !== me)
    .slice(0, 3)
    .map((t) => `${t.name} is typing ${t.n < 40 ? '·' : t.n < 200 ? '··' : '···'}${t.n >= 200 ? ' a long one' : ''}`)
    .join(' · ');
}

export function pollBars(p: ChatPoll, mine: number | undefined) {
  const total = p.votes.reduce((a, b) => a + (b || 0), 0);
  return {
    total,
    bars: p.opts.map((label, i) => {
      const count = p.votes[i] || 0;
      return { label, count, pct: total ? Math.round((100 * count) / total) : 0, mine: mine === i };
    }),
  };
}
