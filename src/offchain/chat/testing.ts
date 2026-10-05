import type { ChatLine, ChatPollReply } from './types';

/** Test builders. */
export const line = (id: number, p: Partial<ChatLine> = {}): ChatLine => ({
  id, t: 1_790_000_000 + id, name: 'someone', tag: 'bbbb', cc: '', body: `line ${id}`, rx: {}, rxwho: {},
  edited: false, pinned: false, reserved: false, av: '', bot: false, clip: '', ...p,
});

export const reply = (p: Partial<ChatPollReply> = {}): ChatPollReply => ({
  msgs: [], gone: [], upd: [], next: null, gen: 1, pins: [], typing: [], here: 3, you: { cc: 'FR', tag: 'aaaa' }, ...p,
});
