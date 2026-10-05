export type Version = 1 | 2 | 3 | 4 | 5 | 6;

export const NAMESPACE = 'gno.land/r/g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr';
export const REALMS: Record<Version, string> = {
  1: `${NAMESPACE}/bubblerumble`,
  2: `${NAMESPACE}/bubblerumble2`,
  3: `${NAMESPACE}/bubblerumble3`,
  4: `${NAMESPACE}/bubblerumble4`,
  5: `${NAMESPACE}/bubblerumble5`,
  6: `${NAMESPACE}/bubblerumble6`,
};
export const BUBBLE_REALM = `${NAMESPACE}/bubble`;
export const WBUBBLE_REALM = `${NAMESPACE}/wbubble`;
/** Where pools are created and teams are read; the site switched to it on 2026-10-03. */
export const CURRENT_VERSION: Version = 6;
export const VERSIONS: Version[] = [6, 5, 4, 3, 2, 1];

export const SESSION_ALLOW_PATHS = [
  ...VERSIONS.map((v) => `vm/exec:${REALMS[v]}`),
  `vm/exec:${BUBBLE_REALM}`,
  `vm/exec:${WBUBBLE_REALM}`,
];

export const poolKey = (v: Version, id: number) => `v${v}-${id}`;

export function parsePoolKey(key: string): { version: Version; id: number } | null {
  const m = /^v([1-6])-(\d+)$/.exec(key);
  return m ? { version: Number(m[1]) as Version, id: Number(m[2]) } : null;
}

/** Bid's arguments: v3+ (id, ref, flag, shot), v2 (id, ref, flag), v1 (id). */
export function bidArgs(v: Version, id: number, ref: string, flag: string, shot: number): string[] {
  if (v >= 3) return [String(id), ref, flag, String(shot)];
  if (v === 2) return [String(id), ref, flag];
  return [String(id)];
}

export const caps = (v: Version) => ({
  shots: v >= 4,
  withdraw: v >= 3,
  me: v >= 2,
  flags: v >= 2,
  poolJson: v >= 3,
});
