import { poolKey, type Version } from './realms';

export interface BidEntry { n: number; bidder: string; flag: string; price: number; shot: number; clock: number; pot: number; at: number }
export interface Member { addr: string; flag: string; paid: number; earned: number }
export interface ShotEntry { n: number; bidder: string; paid: number; take: number; bps: number; revealAt: number; revealBy: number; resolved: boolean; hit: boolean; void: boolean }

export interface Pool {
  key: string; version: Version; id: number; name: string; creator: string;
  window: number; life: number; basePrice: number; seed: number; pot: number;
  bids: number; nextPrice: number; lastBidder: string; lastBidAt: number; firstBidAt: number;
  deadline: number; lastDay: number; liveBps: number; clock: number; createdAt: number;
  over: boolean; popped: boolean; paid: boolean; cancelled: boolean;
  bidders: number; shots: number; misses: number; pending: number;
  flag: string; teams: Record<string, number>;
  creatorPaid: number; divPaid: number; refPaid: number; treasuryPaid: number;
  winnerPaid: number; teamPaid: number; sharedPaid: number;
  history: BidEntry[]; roster: Member[]; shotlog: ShotEntry[];
}

export interface RealmInfo {
  version: Version; now: number; shotsOn: boolean; keeperSeen: number; commitsFree: number;
  split: Record<string, number>; pools: Pool[];
}

export interface Me {
  addr: string; referrer: string; recruits: number; flag: string; bids: number; paid: number;
  divEarned: number; refEarned: number; won: number; shots: number; hits: number; owed: number; withdrawn: number;
}

export type Teams = Record<string, { paid: number; won: number; players: number }>;

type Obj = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const bool = (v: unknown) => v === true;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const numMap = (v: unknown) =>
  Object.fromEntries(Object.entries(obj(v)).filter(([, n]) => typeof n === 'number')) as Record<string, number>;

const hex = (h: string) => parseInt(h, 16);
const u4 = (n: number) => '\\u' + n.toString(16).padStart(4, '0');

/**
 * JSON.parse that also accepts the escapes Go's strconv.Quote emits and JSON lacks:
 * \xHH (a raw byte, kept as U+00HH) and \UHHHHHHHH (an astral rune, rewritten as a surrogate pair).
 */
export function parseJSONLoose(raw: string): unknown {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') {
      out += c;
      continue;
    }
    const n = raw[i + 1];
    if (n === 'x' && /^[0-9a-fA-F]{2}$/.test(raw.slice(i + 2, i + 4))) {
      out += u4(hex(raw.slice(i + 2, i + 4)));
      i += 3;
    } else if (n === 'U' && /^[0-9a-fA-F]{8}$/.test(raw.slice(i + 2, i + 10))) {
      const cp = hex(raw.slice(i + 2, i + 10)) - 0x10000;
      out += cp < 0 ? u4(cp + 0x10000) : u4(0xd800 + (cp >> 10)) + u4(0xdc00 + (cp & 0x3ff));
      i += 9;
    } else {
      out += c + (n ?? '');
      i += 1;
    }
  }
  return JSON.parse(out);
}

function load(raw: string, what: string): Obj {
  try {
    return obj(parseJSONLoose(raw));
  } catch (e) {
    throw new Error(`${what}: unreadable answer (${(e as Error).message})`);
  }
}

function toPool(o: Obj, v: Version): Pool {
  const lastBidAt = num(o.lastBidAt);
  const clock = num(o.clock);
  return {
    key: poolKey(v, num(o.id)), version: v, id: num(o.id), name: str(o.name), creator: str(o.creator),
    window: num(o.window), life: num(o.life), basePrice: num(o.basePrice), seed: num(o.seed), pot: num(o.pot),
    bids: num(o.bids), nextPrice: num(o.nextPrice), lastBidder: str(o.lastBidder), lastBidAt,
    firstBidAt: num(o.firstBidAt),
    deadline: num(o.deadline, lastBidAt > 0 ? lastBidAt + clock : 0),
    lastDay: num(o.lastDay), liveBps: num(o.liveBps, 10000), clock, createdAt: num(o.createdAt),
    over: bool(o.over), popped: bool(o.popped), paid: bool(o.paid), cancelled: bool(o.cancelled),
    bidders: num(o.bidders), shots: num(o.shots), misses: num(o.misses), pending: num(o.pending),
    flag: str(o.flag), teams: numMap(o.teams),
    creatorPaid: num(o.creatorPaid), divPaid: num(o.divPaid), refPaid: num(o.refPaid),
    treasuryPaid: num(o.treasuryPaid), winnerPaid: num(o.winnerPaid), teamPaid: num(o.teamPaid),
    sharedPaid: num(o.sharedPaid),
    history: arr(o.history).map((h) => ({
      n: num(h.n), bidder: str(h.bidder), flag: str(h.flag), price: num(h.price), shot: num(h.shot),
      clock: num(h.clock), pot: num(h.pot), at: num(h.at),
    })),
    roster: arr(o.roster).map((m) => ({ addr: str(m.addr), flag: str(m.flag), paid: num(m.paid), earned: num(m.earned) })),
    shotlog: arr(o.shotlog).map((s) => ({
      n: num(s.n), bidder: str(s.bidder), paid: num(s.paid), take: num(s.take), bps: num(s.bps),
      revealAt: num(s.revealAt), revealBy: num(s.revealBy),
      resolved: bool(s.resolved), hit: bool(s.hit), void: bool(s.void),
    })),
  };
}

export function parseRealm(raw: string, v: Version): RealmInfo {
  const o = load(raw, `realm v${v}`);
  return {
    version: v, now: num(o.now), shotsOn: bool(o.shotsOn), keeperSeen: num(o.keeperSeen),
    commitsFree: num(o.commitsFree), split: numMap(o.split), pools: arr(o.pools).map((p) => toPool(p, v)),
  };
}

export const parsePool = (raw: string, v: Version): Pool => toPool(load(raw, `pool v${v}`), v);

export function parseMe(raw: string): Me {
  const o = load(raw, 'player');
  return {
    addr: str(o.addr), referrer: str(o.referrer), recruits: num(o.recruits), flag: str(o.flag),
    bids: num(o.bids), paid: num(o.paid), divEarned: num(o.divEarned), refEarned: num(o.refEarned),
    won: num(o.won), shots: num(o.shots), hits: num(o.hits), owed: num(o.owed), withdrawn: num(o.withdrawn),
  };
}

export function parseTeams(raw: string): Teams {
  const o = load(raw, 'teams');
  return Object.fromEntries(
    Object.entries(o).map(([cc, t]) => {
      const x = obj(t);
      return [cc, { paid: num(x.paid), won: num(x.won), players: num(x.players) }];
    }),
  );
}
