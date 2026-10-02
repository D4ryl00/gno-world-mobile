import { gasFor } from '@/game/pricing';
import type { ActiveSession } from '@/session/types';
import { bytesToHex, decodeAddress } from '@/utils/bech32';

import type { ChainApi } from './api';
import { ChainError, classifyError } from './errors';
import { parseMe, parsePool, parseRealm, parseTeams, type Me, type Pool, type RealmInfo, type Teams } from './parse';
import { bidArgs, caps, REALMS, VERSIONS, type Version } from './realms';

export interface TxResult { hash: string; height: number }
export interface BidOptions { ref: string; flag: string; boost: number; shot: number }
export interface PoolForm { name: string; window: number; basePrice: number; life: number; seed: number }
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
    if (!p) throw new Error(`no pool v${v}-${id}`);
    return p;
  }

  async me(v: Version, addr: string): Promise<Me | null> {
    if (!caps(v).me) return null;
    return parseMe(await this.api.render(REALMS[v], `me/${addr}`));
  }

  async teams(): Promise<Teams> {
    return parseTeams(await this.api.render(REALMS[5], 'teams'));
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
    const args = [f.name, String(f.window), String(f.basePrice), String(f.life)];
    return this.exec(s, 5, 'CreatePool', args, f.seed, gasFor('CreatePool'));
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
      return { hash: last ? bytesToHex(last.hash) : '', height: last ? Number(last.height) : 0 };
    } catch (e) {
      throw classifyError(e);
    }
  }
}
