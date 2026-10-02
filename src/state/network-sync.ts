export interface Network {
  chainId: string;
  remote: string;
}

/**
 * Keeps one answer to "which network is gnonative on?". The settings change first; gnonative switches
 * later and asynchronously. Until it has, the old network stays current, so the session store never
 * reads a chain through a node that belongs to another one. Switches run one after the other.
 */
export function createNetworkSync(d: {
  /** gnonative's network when the app started (the provider is configured from the settings) */
  initial: Network;
  /** point gnonative at `n` (setRemote, setChainID) */
  apply(n: Network): Promise<void>;
  /** stop anything that reads the chain while the switch is in progress */
  pause(): void;
  /** the switch is done: resume what depends on the network */
  changed(): Promise<void>;
}) {
  let applied: Network = { ...d.initial };
  let queue: Promise<void> = Promise.resolve();
  return {
    current: (): Network => applied,
    set(n: Network): Promise<void> {
      queue = queue.then(async () => {
        if (n.chainId === applied.chainId && n.remote === applied.remote) return;
        d.pause();
        await d.apply(n).catch(() => undefined);
        applied = { chainId: n.chainId, remote: n.remote };
        await d.changed().catch(() => undefined);
      });
      return queue;
    },
  };
}
