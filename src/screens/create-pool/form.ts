import type { PoolForm } from '@/chain/game-client';
import { parseDuration, toUgnot } from '@/utils/gnot';

// bubblerumble5's CreatePool bounds
const MIN_WINDOW = 10, MAX_WINDOW = 30 * 86400, MIN_LIFE = 3600, MAX_LIFE = 30 * 86400;
const MIN_BASE = 1000, MAX_BASE = 1_000_000_000_000;

export function validatePoolForm(i: { name: string; window: string; base: string; life: string; seed: string }): { form?: PoolForm; error?: string } {
  try {
    const name = i.name.trim();
    if (name.length < 1 || name.length > 40) return { error: 'name must be 1-40 characters' };
    if (/[\u0000-\u001f\u007f]/.test(name)) return { error: 'name has control characters' };
    const window = parseDuration(i.window);
    if (window < MIN_WINDOW || window > MAX_WINDOW) return { error: 'window must be between 10s and 30d' };
    const basePrice = toUgnot(i.base);
    if (basePrice < MIN_BASE || basePrice > MAX_BASE) return { error: 'base price must be between 0.001 and 1,000,000 GNOT' };
    const life = i.life.trim() ? parseDuration(i.life) : 0;
    if (life !== 0 && (life < MIN_LIFE || life > MAX_LIFE)) return { error: 'life must be between 1h and 30d' };
    if (life !== 0 && life < window) return { error: 'life must be at least the window' };
    return { form: { name, window, basePrice, life, seed: toUgnot(i.seed) } };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
