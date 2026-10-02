import type { AllPools } from '@/chain/game-client';

export function loadNotice(all: AllPools): { error?: string; notice?: string } {
  if (all.failed.length === 0) return {};
  // nothing answered at all; an empty list from a version that did answer is just an empty list
  if (Object.keys(all.realms).length === 0) return { error: 'the node did not answer' };
  return { notice: `Could not load ${all.failed.map((v) => `v${v}`).join(', ')} — pull to retry.` };
}

/**
 * Concurrent calls join the running promise instead of starting another. The work is passed on each call, so a
 * screen can create this once and still run its latest closure.
 */
export function createSerial(): (fn: () => Promise<void>) => Promise<void> {
  let running: Promise<void> | null = null;
  return (fn) => {
    if (!running) {
      running = fn().finally(() => {
        running = null;
      });
    }
    return running;
  };
}
