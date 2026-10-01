export function createTxRunner({ setBusy, reload }: { setBusy: (busy: boolean) => void; reload: () => Promise<unknown> }) {
  let inFlight = false;
  return async (action: () => Promise<unknown>): Promise<void> => {
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
