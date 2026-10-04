import type { Grant, SessionKey } from './types';

export interface CommandContext {
  chainId: string;
  remote: string;
  /** the identity's key name in the user's gnokey; YOUR_KEY by default, as on the site */
  keyName?: string;
  /** inserted before the key name (e.g. -home <dir> -insecure-password-stdin in tests) */
  extraFlags?: string[];
  /** -gas-fee; by default 10000ugnot: mainnet asks 1 ugnot per 1000 gas, so 5× the floor for 2000000 gas */
  gasFee?: string;
  gasWanted?: number;
}

const q = (s: string) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export const expiresArg = (seconds: number) => (seconds % 86400 === 0 ? `${seconds / 86400}d` : `${seconds}s`);

function tail(ctx: CommandContext): string[] {
  return [
    '-gas-fee', ctx.gasFee ?? '10000ugnot', '-gas-wanted', String(ctx.gasWanted ?? 2000000), '-broadcast',
    '-chainid', ctx.chainId, '-remote', ctx.remote, ...(ctx.extraFlags ?? []), ctx.keyName ?? 'YOUR_KEY',
  ];
}

export function createCommand(key: SessionKey, grant: Grant, allow: string[], ctx: CommandContext): string {
  const parts = [
    'gnokey', 'maketx', 'session', 'create', '-pubkey', key.pubkey, '-expires-at', expiresArg(grant.expires),
    ...allow.flatMap((a) => ['-allow-paths', a]),
    '-spend-limit', `${grant.spendPerPeriod}ugnot`, '-spend-period', String(grant.period), ...tail(ctx),
  ];
  return parts.map(q).join(' ');
}

export function revokeCommand(pubkey: string, ctx: CommandContext): string {
  return ['gnokey', 'maketx', 'session', 'revoke', '-pubkey', pubkey, ...tail(ctx)].map(q).join(' ');
}

/** No atomic replace from a single gnokey command: create the new session first, then revoke the old one. */
export function replaceCommand(newKey: SessionKey, grant: Grant, allow: string[], oldPubkey: string, ctx: CommandContext): string {
  return `${createCommand(newKey, grant, allow, ctx)} && ${revokeCommand(oldPubkey, ctx)}`;
}
