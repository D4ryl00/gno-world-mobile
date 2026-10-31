import { ROOM_ID } from '@/offchain/sync/rooms';

/** The room a pasted text names: a gno.world room link (`…#r/<id>`, extras like `&ref=` ignored) or a bare id. */
export function parseRoomLink(text: string): string | null {
  const t = text.trim();
  const id = /#r\/([^&?#\s]+)/.exec(t)?.[1] ?? t;
  return ROOM_ID.test(id) ? id : null;
}

/** The site's link to a room. */
export const roomLink = (baseUrl: string, id: string) => `${baseUrl.replace(/\/+$/, '')}/#r/${id}`;
