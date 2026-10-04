export type Coin = { denom: string; amount: bigint };

export interface SessionAccountInfo {
  expiresAt: bigint;
  spendLimit: Coin[];
  spendPeriod: bigint;
  spendUsed: Coin[];
  spendReset: bigint;
  allowPaths: string[];
}

/** The part of gnonative's GnoNativeApi the dapp uses (GnoNativeApi satisfies it). */
export interface ChainApi {
  setRemote(remote: string): Promise<unknown>;
  setChainID(chainId: string): Promise<unknown>;
  render(packagePath: string, args: string): Promise<string>;
  call(
    packagePath: string,
    fnc: string,
    args: string[],
    gasFee: string,
    gasWanted: bigint,
    signerAddress: Uint8Array,
    send?: Coin[],
  ): Promise<AsyncIterable<{ hash: Uint8Array; height: bigint }>>;
  queryAccount(address: Uint8Array): Promise<{ accountInfo?: { coins: Coin[] } }>;
  querySessionAccount(master: Uint8Array, session: Uint8Array): Promise<{ accountInfo?: SessionAccountInfo }>;
  generateRecoveryPhrase(): Promise<string>;
  createAccount(name: string, mnemonic: string, password: string): Promise<{ address: Uint8Array; pubKey: Uint8Array } | undefined>;
  activateAccount(nameOrBech32: string, master?: Uint8Array): Promise<{ hasPassword: boolean }>;
  deleteAccount(nameOrBech32: string, password: string | undefined, skipPassword: boolean): Promise<unknown>;
  setPassword(password: string, address: Uint8Array): Promise<unknown>;
  signBytes(address: Uint8Array, data: Uint8Array): Promise<{ signature: Uint8Array; pubKey: Uint8Array }>;
}

export const ugnot = (coins: Coin[] | undefined) =>
  Number((coins ?? []).filter((c) => c.denom === 'ugnot').reduce((t, c) => t + c.amount, 0n));

/** Compile-time guard: fails to typecheck if GnoNativeApi stops satisfying ChainApi. */
export const gnoNativeSatisfiesChainApi: import('@gnolang/gnonative').GnoNativeApi extends ChainApi ? true : never = true;
