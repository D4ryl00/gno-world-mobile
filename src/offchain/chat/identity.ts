import type { SecretStore } from '@/session/keys';

/** The chat's local secrets, as on the site. '' means none. */
export interface ChatIdentity {
  name: string;
  /** the reserved name's key (X-Name-Key) */
  nameKey: string;
  reservedName: string;
  av: string;
  avkey: string;
}

export const NO_IDENTITY: ChatIdentity = { name: '', nameKey: '', reservedName: '', av: '', avkey: '' };

const KEYS: Record<keyof ChatIdentity, string> = {
  name: 'br.chat.name', nameKey: 'br.chat.namekey', reservedName: 'br.chat.reserved', av: 'br.chat.av', avkey: 'br.chat.avkey',
};

export interface IdentityStore {
  load(): Promise<ChatIdentity>;
  save(p: Partial<ChatIdentity>): Promise<ChatIdentity>;
}

/** The fields a server hands out (a reservation, a picture): kept apart for each server. */
const PER_SERVER: readonly (keyof ChatIdentity)[] = ['nameKey', 'reservedName', 'av', 'avkey'];

/** A server URL as a SecureStore key part: only letters, digits, "." and "-" pass; any other character is "_" + hex. */
const keyPart = (scope: string) => scope.replace(/[^A-Za-z0-9.-]/g, (c) => `_${c.charCodeAt(0).toString(16)}`);

/**
 * With a scope (the off-chain server's URL) the reserved name, its key and the avatar are stored per server, so a
 * name key never goes to a server that did not issue it; the free name is the same everywhere.
 */
export function createIdentityStore(s: SecretStore, scope?: () => string): IdentityStore {
  const fields = Object.keys(KEYS) as (keyof ChatIdentity)[];
  const keyOf = (f: keyof ChatIdentity) => (scope && PER_SERVER.includes(f) ? `${KEYS[f]}.${keyPart(scope())}` : KEYS[f]);
  const load = async (): Promise<ChatIdentity> => {
    const values = await Promise.all(fields.map((f) => s.get(keyOf(f))));
    return Object.fromEntries(fields.map((f, i) => [f, values[i] ?? ''])) as unknown as ChatIdentity;
  };
  return {
    load,
    save: async (p) => {
      for (const f of fields) if (p[f] !== undefined) await s.set(keyOf(f), p[f]!);
      return load();
    },
  };
}
