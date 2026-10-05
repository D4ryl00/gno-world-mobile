import { gasFor } from '@/game/pricing';
import { missingPaths, querySession } from '@/session/status';
import type { ActiveSession } from '@/session/types';
import { bytesToHex, decodeAddress } from '@/utils/bech32';

import type { ChainApi } from './api';
import { ChainError, classifyError } from './errors';
import { parseMe, parsePool, parseRealm, parseTeams, type Me, type Pool, type RealmInfo, type Teams } from './parse';
import { bidArgs, caps, CURRENT_VERSION, REALMS, VERSIONS, type Version } from './realms';

const SESSION_NOT_ALLOWED = /session not allowed error/i;

export interface TxResult { hash: string; height: number }
export interface BidOptions { ref: string; flag: string; boost: number; shot: number }
export interface PoolForm { name: string; window: number; basePrice: number; seed: number }
export interface AllPools { pools: Pool[]; realms: Partial<Record<Version, RealmInfo>>; failed: Version[] }

export class GameClient {
  constructor(private api: ChainApi, private chainId: () => string) {}

  async realm(v: Version): Promise<RealmInfo> {
    return parseRealm(await this.api.render(REALMS[v], 'json'), v);
  }

  async allPools(): Promise<AllPools> {
    const res = await Promise.allSettled(VERSIONS.map((v) => this.realm(v)));
    const out: AllPools = { pools: [], realms: {}, failed: [] };
    res.forEach((r, i) => {
      const v = VERSIONS[i];
      if (r.status === 'fulfilled') {
        out.realms[v] = r.value;
        out.pools.push(...r.value.pools);
      } else out.failed.push(v);
    });
    return out;
  }

  async pool(v: Version, id: number): Promise<Pool> {
    if (caps(v).poolJson) return parsePool(await this.api.render(REALMS[v], `json/${id}`), v);
    const p = (await this.realm(v)).pools.find((x) => x.id === id);
    if (!p) throw new ChainError('other', `no pool v${v}-${id} on this network`);
    return p;
  }

  async me(v: Version, addr: string): Promise<Me | null> {
    if (!caps(v).me) return null;
    return parseMe(await this.api.render(REALMS[v], `me/${addr}`));
  }

  async teams(): Promise<Teams> {
    return parseTeams(await this.api.render(REALMS[CURRENT_VERSION], 'teams'));
  }

  bid(s: ActiveSession, p: Pool, o: BidOptions): Promise<TxResult> {
    const shot = caps(p.version).shots ? o.shot : 0;
    const sent = p.nextPrice * o.boost + shot;
    return this.exec(s, p.version, 'Bid', bidArgs(p.version, p.id, o.ref, o.flag, shot), sent, gasFor('Bid', p));
  }

  claim(s: ActiveSession, p: Pool) {
    return this.exec(s, p.version, 'Claim', [String(p.id)], 0, gasFor('Claim', p));
  }

  cancel(s: ActiveSession, p: Pool) {
    return this.exec(s, p.version, 'Cancel', [String(p.id)], 0, gasFor('Cancel', p));
  }

  async withdraw(s: ActiveSession, v: Version) {
    if (!caps(v).withdraw) throw new ChainError('other', `v${v} has no Withdraw: its payouts were sent directly`);
    return this.exec(s, v, 'Withdraw', [], 0, gasFor('Withdraw'));
  }

  createPool(s: ActiveSession, f: PoolForm) {
    const args = [f.name, String(f.window), String(f.basePrice)];
    return this.exec(s, CURRENT_VERSION, 'CreatePool', args, f.seed, gasFor('CreatePool'));
  }

  private async exec(
    s: ActiveSession, v: Version, fnc: string, args: string[], send: number, gas: { wanted: number; fee: number },
  ): Promise<TxResult> {
    if (s.chainId !== this.chainId())
      throw new ChainError(
        'wrong-chain',
        `Your session is for ${s.chainId}. Switch back to it in Settings, or get a session for ${this.chainId()} from the Session tab.`,
      );
    try {
      const stream = await this.api.call(
        REALMS[v], fnc, args, `${gas.fee}ugnot`, BigInt(gas.wanted), decodeAddress(s.address),
        send > 0 ? [{ denom: 'ugnot', amount: BigInt(send) }] : undefined,
      );
      let last: { hash: Uint8Array; height: bigint } | undefined;
      for await (const r of stream) last = r;
      // broadcast, but nothing came back: it may or may not have landed
      if (!last) throw new ChainError('unknown-outcome', 'the node returned no result for the transaction');
      return { hash: bytesToHex(last.hash), height: Number(last.height) };
    } catch (e) {
      throw await this.refine(classifyError(e), s, v);
    }
  }

  /** gnonative passes on only "session not allowed error" (see errors.ts): when the session on chain does not cover
   *  the realm (a session from before v6, say), that is the cause, not the budget. */
  private async refine(e: ChainError, s: ActiveSession, v: Version): Promise<ChainError> {
    if (e.kind !== 'budget' || !SESSION_NOT_ALLOWED.test(e.message)) return e;
    const st = await querySession(this.api, s.master, s.address).catch(() => null);
    return st && missingPaths(st, [`vm/exec:${REALMS[v]}`]).length > 0 ? new ChainError('not-allowed', e.message, e.raw) : e;
  }
}
