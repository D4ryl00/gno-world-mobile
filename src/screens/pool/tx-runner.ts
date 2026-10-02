/** One transaction at a time; `reload` comes with each run so a screen can create this once and pass its latest one. */
export function createTxRunner(setBusy: (busy: boolean) => void) {
  let inFlight = false;
  return async (action: () => Promise<unknown>, reload: () => Promise<unknown>): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    setBusy(true);
    try {
      await action();
    } finally {
      try {
        await reload();
      } catch {
        // the screen keeps showing the last pool it had
      }
      setBusy(false);
      inFlight = false;
    }
  };
}
