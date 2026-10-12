import { OffchainError, type Offchain } from '@/offchain/http';

import type { ChatIdentity } from './identity';
import type { NameProof } from './name-proof';
import { parseLine, parseOlderReply, parsePoll, parsePollReply, parseRx } from './parse';
import type { ChatLine, ChatOlderReply, ChatPoll, ChatPollReply } from './types';

/** The site's CHATRX: what the server accepts. */
export const REACTIONS: readonly string[] = ['👍', '🔥', '❤️', '😂', '🤔', '🤝', '👎'];

export interface PollQuery { since: number; wait: number; limit: number; gen: number | null }

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

export function createChatClient(oc: Offchain, identity: () => Promise<ChatIdentity>): ChatClient {
  const keyed = async () => {
    const id = await identity();
    return { id, headers: id.nameKey ? { 'X-Name-Key': id.nameKey } : ({} as Record<string, string>) };
  };
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
    poll: async (q, o) => {
      const gen = q.gen !== null ? `&gen=${q.gen}` : '';
      const r = await oc.get<unknown>(`/api/chat?since=${q.since}&wait=${q.wait}&limit=${q.limit}${gen}`, o);
      return parsePollReply(r);
    },
    older: async (before) => parseOlderReply(await oc.get<unknown>(`/api/chat?before=${before}&limit=100`)),
    post: async (name, body, re) => {
      const { id, headers } = await keyed();
      const payload = { name, body, ...(re ? { re } : {}), ...(id.av ? { av: id.av, avkey: id.avkey } : {}) };
      return lineOf(await oc.post<Obj>('/api/chat', payload, { headers }));
    },
    edit: async (lineId, body) => {
      const { headers } = await keyed();
      return lineOf(await oc.patch<Obj>(`/api/chat?id=${lineId}`, { body }, { headers }));
    },
    withdraw: async () => {
      const { headers } = await keyed();
      const r = await oc.post<Obj>('/api/chat/withdraw', undefined, { headers });
      return typeof r?.deleted === 'number' && r.deleted > 0 ? r.deleted : null;
    },
    react: async (lineId, emoji, name) => {
      const { headers } = await keyed();
      const r = await oc.post<Obj>('/api/chat/react', { id: lineId, emoji, name }, { headers });
      return { rx: parseRx(r?.rx), mine: r?.mine === true };
    },
    vote: async (lineId, opt) => {
      const { headers } = await keyed();
      const r = await oc.post<Obj>('/api/chat/vote', { id: lineId, opt }, { headers });
      return { mine: typeof r?.mine === 'number' ? r.mine : -1, poll: parsePoll(r?.poll) };
    },
    typing: async (name, n) => {
      await oc.post('/api/chat/typing', { name, n });
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
