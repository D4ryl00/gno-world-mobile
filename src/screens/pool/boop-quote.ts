import type { Pool, RealmInfo } from '@/chain/parse';
import { caps } from '@/chain/realms';
import { BOOSTS, clockFor, gasFor } from '@/game/pricing';
import { oddsBps, shotFor, shotPause, type ShotInputs } from '@/game/shots';
import { gnot } from '@/utils/gnot';

export interface QuoteInput { pool: Pool; realm?: RealmInfo; me: string; hasRef: boolean; boostIdx: number; shotBps: number }

export interface Quote {
  bid: number;
  shot: number;
  /** basis points */
  odds: number;
  gas: { wanted: number; fee: number };
  /** seconds the boop puts on the clock */
  clock: number;
  /** what leaves the account, storage aside */
  total: number;
  /** why shots cannot be bought now, '' when they can (v4+) */
  pause: string;
}

/** What a boop with these choices costs and buys: the numbers the boop panel shows and the screen signs. */
export function boopQuote({ pool, realm, me, hasRef, boostIdx, shotBps }: QuoteInput): Quote {
  const bid = pool.nextPrice * BOOSTS[boostIdx];
  const inputs: ShotInputs = {
    version: pool.version, pot: pool.pot, bids: pool.bids, liveBps: pool.liveBps,
    roster: pool.roster.map((m) => ({ addr: m.addr, paid: m.paid })), me, hasRef,
    revealTip: realm?.split.revealTip ?? 20000, minShot: realm?.split.minShot ?? 100000,
  };
  let pause = '';
  if (caps(pool.version).shots)
    pause = realm
      ? shotPause(inputs, {
          shotsOn: realm.shotsOn, commitsFree: realm.commitsFree, keeperSeen: realm.keeperSeen,
          keeperFresh: realm.split.keeperFresh ?? 300, liveFloor: realm.split.liveFloor ?? 2500, now: realm.now,
        })
      : 'loading shot prices…';
  const shot = caps(pool.version).shots && shotBps && !pause ? shotFor(inputs, shotBps, bid) : 0;
  const gas = gasFor('Bid', pool);
  return {
    bid, shot, odds: shot ? oddsBps(inputs, bid, shot) : 0, gas,
    clock: clockFor(pool.window, pool.nextPrice, bid), total: bid + shot + gas.fee, pause,
  };
}

/** Why a boop priced on `shown` must not be signed now that the chain says `fresh`, or null when it may. */
export function checkFresh(shown: Pool, fresh: Pool): string | null {
  if (fresh.cancelled) return 'This pool was cancelled meanwhile. Nothing was sent.';
  if (fresh.over) return 'This pool closed meanwhile. Nothing was sent.';
  if (fresh.nextPrice !== shown.nextPrice)
    return `Someone booped first: the next boop now costs ${gnot(fresh.nextPrice)} (it was ${gnot(shown.nextPrice)}). Check and boop again. Nothing was sent.`;
  return null;
}
