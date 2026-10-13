import type { ChatIdentity } from '@/offchain/chat/identity';

export type NameIssue = 'none' | 'same' | 'taken' | 'kept' | 'refused' | 'unknown';

export interface SyncedName {
  name: string;
  key: string;
}

/** What a name that came in amounts to; take: the name this app adopts. */
export interface NameOutcome {
  issue: NameIssue;
  name: string;
  /** this app's reserved name before ('' when none) */
  had: string;
  take?: SyncedName;
}

export const NAME_KEY = /^[0-9a-f]{32,64}$/;

/** The reserved name this app hands to the paired devices (the site's syncNameOut). */
export const nameOut = (id: ChatIdentity): SyncedName | undefined =>
  id.reservedName && NAME_KEY.test(id.nameKey) ? { name: id.reservedName, key: id.nameKey } : undefined;

/**
 * The site's syncNameIn: the server says whether the key holds the name (true, false, or null when it could not say)
 * before this app takes it; a reserved name this app still holds is kept.
 */
export async function nameIn(
  incoming: unknown, local: ChatIdentity, check: (name: string, key: string) => Promise<boolean | null>,
): Promise<NameOutcome> {
  const t = (incoming && typeof incoming === 'object' ? incoming : {}) as { name?: unknown; key?: unknown };
  if (!NAME_KEY.test(String(t.key ?? '')) || !t.name) return { issue: 'none', name: '', had: '' };
  const key = String(t.key);
  const name = String(t.name).slice(0, 40);
  const had = local.nameKey ? local.reservedName : '';
  if (local.nameKey === key) return { issue: 'same', name, had };
  const take = { name, key };
  const yes = await check(name, key);
  if (had) {
    if (yes === null) return { issue: 'unknown', name, had };
    if (yes === false) return { issue: 'refused', name, had };
    if (had.toLowerCase() === name.toLowerCase()) return { issue: 'taken', name, had, take };
    if ((await check(had, local.nameKey)) !== false) return { issue: 'kept', name, had };
    return { issue: 'taken', name, had, take };
  }
  if (yes === false) return { issue: 'refused', name, had };
  return { issue: yes === null ? 'unknown' : 'taken', name, had, take };
}

/** The site's syncPairWords, word for word. */
export function pairWords(issue: NameIssue, name: string, had: string): string {
  const a = name || 'the name';
  const n = 'paired — your chat rooms are the same on both devices';
  const o = had && had.toLowerCase() !== name.toLowerCase() ? had : '';
  switch (issue) {
    case 'taken':
      return `${n}, and the name ${a} is yours here too ✓${o ? ` — it replaces ${o}, whose key the box no longer honoured` : ''}`;
    case 'same':
      return `${n}; this device already had the name ${a} ✓`;
    case 'kept':
      return `${n}. This device keeps its own name ${o}; the other device's name ${a} stays there`;
    case 'refused':
      return `${n}, but the name ${a} did NOT come along: the device the code came from holds an old key for it. /dm jae there to free the name, reserve it again there, then pair once more`;
    case 'unknown':
      return `${n}; the name ${a} could not be checked with the box just now — it is checked again within two minutes`;
    default:
      return `${n}. The other device holds no reserved name, so none came along`;
  }
}
