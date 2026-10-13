import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

import type { Offchain } from './http';

export const NOPLAY_TEXT = 'Due to US regulations, play is not offered to visitors from the United States.';
export const isPlayBlocked = (country: string) => country === 'US';

export interface PresenceReply { you: string; count: number }

/** group: the first 16 hex of the /pair sync id, so the server counts paired devices once ('' when not paired). */
export async function sendPresence(oc: Offchain, pid: string, group = ''): Promise<PresenceReply> {
  const r = await oc.post<unknown>(`/presence?id=${encodeURIComponent(pid)}${group ? `&g=${group}` : ''}`);
  const o = (r && typeof r === 'object' ? r : {}) as { you?: unknown; count?: unknown };
  return {
    you: typeof o.you === 'string' ? o.you : '',
    count: typeof o.count === 'number' ? o.count : 0,
  };
}

interface PresenceState {
  country: string;
  count: number;
  reachable: boolean;
  update(p: Partial<Pick<PresenceState, 'country' | 'count' | 'reachable'>>): void;
}

export const presenceStore = createStore<PresenceState>()((set) => ({
  country: '',
  count: 0,
  reachable: true,
  update: (p) => set(p),
}));

export const usePresence = <T>(sel: (s: PresenceState) => T) => useStore(presenceStore, sel);
