export interface Grant {
  /** ugnot per period */
  spendPerPeriod: number;
  /** seconds; the budget resets after this */
  period: number;
  /** seconds of lifetime from inclusion */
  expires: number;
}

export const DEFAULT_GRANT: Grant = { spendPerPeriod: 5_000_000, period: 3600, expires: 30 * 86400 };

/** A key in gnonative's keybase that is, or will be, a session key. Bech32 strings. */
export interface SessionKey {
  keyName: string;
  address: string;
  pubkey: string;
}

/** A session confirmed on chain for `master` on `chainId`. */
export interface ActiveSession extends SessionKey {
  master: string;
  chainId: string;
}
