/** Plays every step, whatever happens to the ones before; returns what went wrong, in order. */
export async function runAll<T>(steps: T[], play: (s: T) => Promise<unknown>): Promise<string[]> {
  const errors: string[] = [];
  for (const s of steps) {
    try {
      await play(s);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return errors;
}
