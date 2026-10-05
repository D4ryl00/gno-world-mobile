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

export function createIdentityStore(s: SecretStore): IdentityStore {
  const fields = Object.keys(KEYS) as (keyof ChatIdentity)[];
  const load = async (): Promise<ChatIdentity> => {
    const values = await Promise.all(fields.map((f) => s.get(KEYS[f])));
    return Object.fromEntries(fields.map((f, i) => [f, values[i] ?? ''])) as unknown as ChatIdentity;
  };
  return {
    load,
    save: async (p) => {
      for (const f of fields) if (p[f] !== undefined) await s.set(KEYS[f], p[f]!);
      return load();
    },
  };
}
