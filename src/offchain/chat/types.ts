/** The line a reply answers, as the server quotes it. */
export interface ChatQuote { id: number; name: string; body: string }

export interface ChatPoll { q: string; opts: string[]; votes: number[] }

export interface ChatAttachment { kind: string; url: string; name: string }

export interface ChatLine {
  id: number;
  /** seconds */
  t: number;
  name: string;
  /** from the sender's connection; rotates daily */
  tag: string;
  cc: string;
  body: string;
  re?: ChatQuote;
  rx: Record<string, number>;
  rxwho: Record<string, string[]>;
  /** the wire's `ed` */
  edited: boolean;
  pinned: boolean;
  /** the wire's `v`: a reserved name */
  reserved: boolean;
  av: string;
  bot: boolean;
  poll?: ChatPoll;
  att?: ChatAttachment;
  clip: string;
}

export interface Typing { name: string; n: number }

/** The server's view of this client. */
export interface ChatYou { cc: string; tag: string }

export interface ChatPollReply {
  msgs: ChatLine[];
  gone: number[];
  upd: ChatLine[];
  next: number | null;
  gen: number | null;
  pins: ChatLine[];
  typing: Typing[];
  here: number | null;
  you: ChatYou | null;
}

export interface ChatOlderReply { msgs: ChatLine[]; more: boolean }
