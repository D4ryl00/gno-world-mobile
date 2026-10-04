import { bytesToHex } from '@/utils/bech32';

import type { ChainApi, Coin, SessionAccountInfo } from './api';

/** In-memory ChainApi for unit tests. */
export class FakeChainApi implements ChainApi {
  renders = new Map<string, string>();
  calls: { pkg: string; fnc: string; args: string[]; gasFee: string; gasWanted: bigint; signerHex: string; send?: Coin[] }[] = [];
  failNextCall: Error | null = null;
  /** the next call's stream ends without a result */
  emptyNextCall = false;
  sessions = new Map<string, SessionAccountInfo>(); // key: masterHex/sessionHex
  balances = new Map<string, Coin[]>();
  keys = new Map<string, { address: Uint8Array; pubKey: Uint8Array; password: string }>();
  activated = new Map<string, { master?: string; password?: string }>(); // by key name
  signed: { addressHex: string; data: string }[] = [];
  deleted: string[] = [];
  private n = 0;

  async setRemote() {}
  async setChainID() {}
  async render(pkg: string, args: string) {
    const r = this.renders.get(`${pkg}:${args}`);
    if (r === undefined) throw new Error(`no render for ${pkg}:${args}`);
    return r;
  }
  async call(pkg: string, fnc: string, args: string[], gasFee: string, gasWanted: bigint, signer: Uint8Array, send?: Coin[]) {
    if (this.failNextCall) {
      const e = this.failNextCall;
      this.failNextCall = null;
      throw e;
    }
    this.calls.push({ pkg, fnc, args, gasFee, gasWanted, signerHex: bytesToHex(signer), send });
    const empty = this.emptyNextCall;
    this.emptyNextCall = false;
    return (async function* () {
      if (!empty) yield { hash: new Uint8Array([0xab, 0xcd]), height: 7n };
    })();
  }
  async queryAccount(address: Uint8Array) {
    return { accountInfo: { coins: this.balances.get(bytesToHex(address)) ?? [] } };
  }
  async querySessionAccount(master: Uint8Array, session: Uint8Array) {
    const s = this.sessions.get(`${bytesToHex(master)}/${bytesToHex(session)}`);
    if (!s) throw new Error('session not found');
    return { accountInfo: s };
  }
  async generateRecoveryPhrase() {
    return `phrase-${++this.n}`;
  }
  async createAccount(name: string, _mnemonic: string, password: string) {
    const i = ++this.n;
    const address = new Uint8Array(20).fill(i);
    const pubKey = new Uint8Array(38).fill(i);
    this.keys.set(name, { address, pubKey, password });
    return { address, pubKey };
  }
  async activateAccount(name: string, master?: Uint8Array) {
    const prev = this.activated.get(name) ?? {};
    this.activated.set(name, { ...prev, master: master ? bytesToHex(master) : undefined });
    return { hasPassword: !!prev.password };
  }
  async deleteAccount(name: string) {
    this.deleted.push(name);
    this.keys.delete(name);
    this.activated.delete(name);
    return {};
  }
  async setPassword(password: string, address: Uint8Array) {
    for (const [name, k] of this.keys)
      if (bytesToHex(k.address) === bytesToHex(address)) {
        if (k.password !== password) throw new Error('decryption failed');
        this.activated.set(name, { ...this.activated.get(name), password });
      }
  }
  async signBytes(address: Uint8Array, data: Uint8Array) {
    this.signed.push({ addressHex: bytesToHex(address), data: new TextDecoder().decode(data) });
    return { signature: new Uint8Array(64).fill(7), pubKey: new Uint8Array(38) };
  }
}
