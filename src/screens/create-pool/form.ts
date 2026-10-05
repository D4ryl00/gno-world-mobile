import type { PoolForm } from '@/chain/game-client';
import type { Pool } from '@/chain/parse';
import { CURRENT_VERSION } from '@/chain/realms';
import { parseDuration, toUgnot } from '@/utils/gnot';

// bubblerumble6's CreatePool bounds
const MIN_WINDOW = 10, MAX_WINDOW = 30 * 86400;
const MIN_BASE = 1000, MAX_BASE = 1_000_000_000_000;

export function validatePoolForm(i: { name: string; window: string; base: string; seed: string }): { form?: PoolForm; error?: string } {
  try {
    const name = i.name.trim();
    if (name.length < 1 || name.length > 40) return { error: 'name must be 1-40 characters' };
    if (/[\u0000-\u001f\u007f]/.test(name)) return { error: 'name has control characters' };
    const window = parseDuration(i.window);
    if (window < MIN_WINDOW || window > MAX_WINDOW) return { error: 'window must be between 10s and 30d' };
    const basePrice = toUgnot(i.base);
    if (basePrice < MIN_BASE || basePrice > MAX_BASE) return { error: 'base price must be between 0.001 and 1,000,000 GNOT' };
    return { form: { name, window, basePrice, seed: toUgnot(i.seed) } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The pool a CreatePool just made: the newest current-realm pool with that creator and name (CreatePool returns no id here). */
export function findCreated(pools: Pool[], creator: string, name: string): string | undefined {
  return pools
    .filter((p) => p.version === CURRENT_VERSION && p.creator === creator && p.name === name)
    .sort((a, b) => b.id - a.id)[0]?.key;
}
