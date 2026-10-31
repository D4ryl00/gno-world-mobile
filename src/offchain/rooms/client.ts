import type { ChatIdentity } from '@/offchain/chat/identity';
import { displayName } from '@/offchain/chat/identity-store';
import { parsePollReply } from '@/offchain/chat/parse';
import type { ChatPollReply } from '@/offchain/chat/types';
import { OffchainError, type Offchain } from '@/offchain/http';
import { ROOM_ID } from '@/offchain/sync/rooms';

export interface RoomInfo { id: string; name: string; listed: boolean; here: number; made: number }
export interface ListedRoom { id: string; name: string; here: number; made: number }

/** The rooms routes of gno.world (M2b-2 spec §3); a room's lines go through the chat client. */
export interface RoomsClient {
  make(name: string, listed: boolean): Promise<{ id: string; name: string; key: string }>;
  /** 'gone': no such room (the link is wrong, or it was quiet for a month) */
  info(id: string): Promise<RoomInfo | 'gone'>;
  /** the listed rooms, oldest first: the server's order follows who is there, and would reshuffle the tabs */
  listPublic(): Promise<ListedRoom[]>;
  setRoom(id: string, key: string, p: { name: string } | { listed: boolean }): Promise<{ name?: string }>;
  dropRoom(id: string, key: string): Promise<void>;
  invite(id: string, key: string, to: string, tag: string): Promise<{ to: string }>;
  /** what a room got since a mark, without waiting: unread counts */
  scan(id: string, since: number): Promise<ChatPollReply>;
}

type Obj = Record<string, unknown>;
const str = (x: unknown) => (typeof x === 'string' ? x : '');
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

export function createRoomsClient(oc: Offchain, identity: () => Promise<ChatIdentity>): RoomsClient {
  const named = async (h: Record<string, string> = {}) => {
    const id = await identity();
    return { id, headers: id.nameKey ? { ...h, 'X-Name-Key': id.nameKey } : h };
  };
  return {
    make: async (name, listed) => {
      const { headers } = await named();
      const r = await oc.post<Obj>('/api/room', { name, public: listed }, { headers });
      if (!ROOM_ID.test(str(r?.id)) || !str(r?.key)) throw new OffchainError(0, str(r?.error) || 'the server answered without the room');
      return { id: str(r.id), name: str(r.name) || name, key: str(r.key) };
    },
    info: async (id) => {
      try {
        const r = await oc.get<Obj>(`/api/room?id=${id}`);
        return { id: str(r?.id) || id, name: str(r?.name), listed: r?.public === true, here: num(r?.here), made: num(r?.made) };
      } catch (e) {
        if (e instanceof OffchainError && e.status === 404) return 'gone';
        throw e;
      }
    },
    listPublic: async () => {
      const r = await oc.get<Obj>('/api/rooms');
      const rooms = (Array.isArray(r?.rooms) ? r.rooms : [])
        .map((x) => (x && typeof x === 'object' ? (x as Obj) : {}))
        .filter((x) => ROOM_ID.test(str(x.id)))
        .map((x): ListedRoom => ({ id: str(x.id), name: str(x.name), here: num(x.here), made: num(x.made) }));
      return rooms.sort((a, b) => a.made - b.made || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },
    setRoom: async (id, key, p) => {
      const { headers } = await named({ 'X-Room-Key': key });
      const body = 'name' in p ? { name: p.name } : { public: p.listed };
      const r = await oc.post<Obj>(`/api/room?id=${id}`, body, { headers });
      return str(r?.name) ? { name: str(r.name) } : {};
    },
    dropRoom: async (id, key) => {
      const { headers } = await named({ 'X-Room-Key': key });
      await oc.del(`/api/room?id=${id}`, { headers });
    },
    invite: async (id, key, to, tag) => {
      const { id: me, headers } = await named({ 'X-Room-Key': key });
      const r = await oc.post<Obj>(`/api/room/invite?room=${id}`, { to, tag, name: displayName(me) }, { headers });
      return { to: str(r?.to) || to };
    },
    scan: async (id, since) => parsePollReply(await oc.get<unknown>(`/api/chat?since=${since}&wait=0&limit=200&room=${id}`)),
  };
}
