import { OffchainError, type Offchain } from '@/offchain/http';

import type { ChatIdentity } from './identity';
import type { NameProof } from './name-proof';
import { parseLine, parseOlderReply, parsePoll, parsePollReply, parseRx } from './parse';
import type { ChatLine, ChatOlderReply, ChatPoll, ChatPollReply } from './types';

/** The site's CHATRX: what the server accepts. */
export const REACTIONS: readonly string[] = ['👍', '🔥', '❤️', '😂', '🤔', '🤝', '👎'];

export interface PollQuery {
  since: number; wait: number; limit: number; gen: number | null;
  /** the display name: the server learns who to deliver invitations to from it */
  name: string;
}

/** The room a client talks to: '' is Public; `key` is the maker's key, '' when not the maker. */
export interface RoomAccess { room: string; key: () => string }

export interface ChatClient {
  poll(q: PollQuery, o: { timeoutMs: number; signal: AbortSignal }): Promise<ChatPollReply>;
  older(before: number): Promise<ChatOlderReply>;
  post(name: string, body: string, re?: number): Promise<ChatLine>;
  edit(id: number, body: string): Promise<ChatLine>;
  /** the line taken back, or null when the server took none */
  withdraw(): Promise<number | null>;
  react(id: number, emoji: string, name: string): Promise<{ rx: Record<string, number>; mine: boolean }>;
  vote(id: number, opt: number): Promise<{ mine: number; poll: ChatPoll | undefined }>;
  typing(name: string, n: number): Promise<void>;
  /** the maker pins or unpins a line (X-Room-Key) */
  pin(id: number, on: boolean): Promise<{ pins: ChatLine[] }>;
  /** the maker removes a line (X-Room-Key) */
  deleteLine(id: number): Promise<void>;
  /** POST /api/name for the wallet `addr`: a 409 asks for its proof (nameChallenge, then proveName) */
  reserveName(name: string, addr: string): Promise<{ name: string; key: string; addr: string }>;
  /** the phrase the wallet signs (GET /api/name/challenge) */
  nameChallenge(): Promise<string>;
  /** POST /api/name with the wallet's proof */
  proveName(name: string, proof: NameProof): Promise<{ name: string; key: string; addr: string }>;
  releaseName(): Promise<void>;
  uploadAvatar(body: Blob | Uint8Array, contentType: string): Promise<{ id: string; key: string }>;
  /** the site's report after a boop (POST /api/bubble/boop) */
  reportBoop(addr: string, pool: number, n: number, v: number): Promise<void>;
}

type Obj = Record<string, unknown>;
const str = (x: unknown) => (typeof x === 'string' ? x : '');

export const avatarUrl = (baseUrl: string, id: string) => `${baseUrl.replace(/\/+$/, '')}/api/avatar/${id}.jpg`;

export function createChatClient(oc: Offchain, identity: () => Promise<ChatIdentity>, access?: RoomAccess): ChatClient {
  const room = access?.room ?? '';
  // the site's room=: last in the query, after whatever the route takes
  const q = (path: string) => (room ? `${path}${path.includes('?') ? '&' : '?'}room=${room}` : path);
  const keyed = async () => {
    const id = await identity();
    return { id, headers: id.nameKey ? { 'X-Name-Key': id.nameKey } : ({} as Record<string, string>) };
  };
  /** react and vote name the room in a header, as the site does */
  const inRoom = (h: Record<string, string>) => (room ? { ...h, 'X-Room': room } : h);
  const asMaker = async () => {
    const { headers } = await keyed();
    return { ...headers, 'X-Room-Key': access?.key() ?? '' };
  };
  const pins = (x: unknown) => (Array.isArray(x) ? x.map(parseLine).filter((l): l is ChatLine => l !== null) : []);
  const reserved = (r: Obj, name: string) => {
    if (!str(r?.key)) throw new OffchainError(0, 'the server answered without the name key');
    return { name: str(r.name) || name, key: str(r.key), addr: str(r.addr) };
  };
  const lineOf = (r: Obj): ChatLine => {
    const l = parseLine(r?.msg);
    if (!l) throw new OffchainError(0, 'the chat answered without the line');
    return l;
  };
  return {
    poll: async (p, o) => {
      const gen = p.gen !== null ? `&gen=${p.gen}` : '';
      const name = p.name ? `&name=${encodeURIComponent(p.name.slice(0, 96))}` : '';
      return parsePollReply(await oc.get<unknown>(q(`/api/chat?since=${p.since}&wait=${p.wait}&limit=${p.limit}${gen}${name}`), o));
    },
    older: async (before) => parseOlderReply(await oc.get<unknown>(q(`/api/chat?before=${before}&limit=100`))),
    post: async (name, body, re) => {
      const { id, headers } = await keyed();
      const payload = { name, body, ...(re ? { re } : {}), ...(id.av ? { av: id.av, avkey: id.avkey } : {}) };
      return lineOf(await oc.post<Obj>(q('/api/chat'), payload, { headers }));
    },
    edit: async (lineId, body) => {
      const { headers } = await keyed();
      return lineOf(await oc.patch<Obj>(q(`/api/chat?id=${lineId}`), { body }, { headers }));
    },
    withdraw: async () => {
      const { headers } = await keyed();
      const r = await oc.post<Obj>(q('/api/chat/withdraw'), undefined, { headers });
      return typeof r?.deleted === 'number' && r.deleted > 0 ? r.deleted : null;
    },
    react: async (lineId, emoji, name) => {
      const { headers } = await keyed();
      const r = await oc.post<Obj>('/api/chat/react', { id: lineId, emoji, name }, { headers: inRoom(headers) });
      return { rx: parseRx(r?.rx), mine: r?.mine === true };
    },
    vote: async (lineId, opt) => {
      const { headers } = await keyed();
      const r = await oc.post<Obj>('/api/chat/vote', { id: lineId, opt }, { headers: inRoom(headers) });
      return { mine: typeof r?.mine === 'number' ? r.mine : -1, poll: parsePoll(r?.poll) };
    },
    typing: async (name, n) => {
      await oc.post(q('/api/chat/typing'), { name, n });
    },
    pin: async (lineId, on) => {
      const r = await oc.post<Obj>(q(`/api/chat/pin?id=${lineId}${on ? '' : '&on=0'}`), undefined, { headers: await asMaker() });
      return { pins: pins(r?.pins) };
    },
    deleteLine: async (lineId) => {
      await oc.del(q(`/api/chat?id=${lineId}`), { headers: await asMaker() });
    },
    reserveName: async (name, addr) => {
      const { headers } = await keyed();
      return reserved(await oc.post<Obj>('/api/name', { name, addr }, { headers }), name);
    },
    nameChallenge: async () => {
      const words = str((await oc.get<Obj>('/api/name/challenge'))?.words);
      if (!words) throw new OffchainError(0, 'the server answered without a phrase');
      return words;
    },
    proveName: async (name, proof) => {
      const { headers } = await keyed();
      return reserved(await oc.post<Obj>('/api/name', { name, ...proof }, { headers }), name);
    },
    releaseName: async () => {
      const { headers } = await keyed();
      await oc.del('/api/name', { headers });
    },
    uploadAvatar: async (body, contentType) => {
      const { headers } = await keyed();
      const r = await oc.post<Obj>('/api/avatar', undefined, { headers, raw: { body, contentType } });
      if (!str(r?.id)) throw new OffchainError(0, 'the server answered without the picture id');
      return { id: str(r.id), key: str(r.key) };
    },
    reportBoop: async (addr, pool, n, v) => {
      const { headers } = await keyed();
      await oc.post('/api/bubble/boop', { addr, pool, n, v }, { headers });
    },
  };
}
