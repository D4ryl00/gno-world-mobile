import { renameSync, rmSync } from 'node:fs';

/** A capture is written to `next` and replaces `final` only once it is complete: a failed run keeps the last one. */
export function promote(next: string, final: string) {
  rmSync(final, { recursive: true, force: true });
  renameSync(next, final);
}
