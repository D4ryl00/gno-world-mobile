export interface ShotInputs {
  version: number;
  pot: number;
  bids: number;
  liveBps: number;
  roster: { addr: string; paid: number }[];
  me: string;
  hasRef: boolean;
  revealTip: number;
  minShot: number;
}

export interface ShotRealmInfo {
  shotsOn: boolean;
  commitsFree: number;
  keeperSeen: number;
  keeperFresh: number;
  liveFloor: number;
  now: number;
}

const SHOT_FAIR = 8000;
const SHOT_MAX_BPS = 100;

export const shotTip = (p: ShotInputs) => (p.version >= 4 ? p.revealTip || 20000 : 0);

/** The site's takeFor: what a pop would pay this player now, after a bid of `bid` and a shot of `shot`. */
export function takeFor(p: ShotInputs, bid: number, shot: number): number {
  const a =
    p.pot +
    Math.floor(bid * (p.version >= 5 ? 0.5 : 0.55)) +
    (p.hasRef ? 0 : Math.floor(0.1 * bid)) +
    (p.bids === 0 ? Math.floor(0.3 * bid) : 0) +
    shot -
    shotTip(p);
  const others = p.roster.filter((m) => m.addr !== p.me);
  if (!others.length) return a;
  const mine = p.roster.find((m) => m.addr === p.me);
  const s = p.bids > 0 ? p.liveBps : 10000;
  const i = a - Math.floor(0.35 * a);
  const l = i - Math.floor((i * s) / 10000);
  const c = p.roster.reduce((t, m) => t + m.paid, 0) + bid;
  const d = c - ((mine ? mine.paid : 0) + bid);
  return a - Math.floor((l * d) / Math.max(1, c));
}

const shotPrize = (p: ShotInputs, bid: number, shot: number) =>
  p.version >= 4 ? takeFor(p, bid, shot) : Math.min(p.pot, 1e7);

/** The shot that buys `bps` (25, 50 or 100) basis points with a bid of `bid`. */
export function shotFor(p: ShotInputs, bps: number, bid: number): number {
  if (p.version < 4) return Math.ceil((bps * shotPrize(p, bid, 0)) / SHOT_FAIR);
  let a = 0;
  for (let n = 0; n < 3; n++) a = Math.ceil((bps * shotPrize(p, bid, a)) / SHOT_FAIR) + shotTip(p);
  return Math.max(a, p.minShot || 100000);
}

/** Chance in basis points that `shot` pops the bubble. */
export function oddsBps(p: ShotInputs, bid: number, shot: number): number {
  if (shot <= 0) return 0;
  return Math.min(
    SHOT_MAX_BPS,
    Math.floor((SHOT_FAIR * Math.max(0, shot - shotTip(p))) / Math.max(1, shotPrize(p, bid, shot))),
  );
}

/** Why shots cannot be sold right now, or "" when they can (v4+ only). */
export function shotPause(p: ShotInputs, info: ShotRealmInfo): string {
  if (p.version < 4) return '';
  if (!info.shotsOn) return 'shots are off';
  if (!info.commitsFree) return 'the keeper has no commitments left — shots are paused, back soon';
  if (!info.keeperSeen || info.now - info.keeperSeen > (info.keeperFresh || 300))
    return 'the keeper has not been seen for a while — shots are paused';
  if (p.bids > 0 && p.liveBps < (info.liveFloor || 2500))
    return "the winner's share has slid under a quarter — no more shots on this bubble";
  return '';
}
