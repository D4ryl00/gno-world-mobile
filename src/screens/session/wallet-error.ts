import type { Pending } from '@/session/store';

const TITLES: Record<Pending['op'], string> = {
  create: 'No session yet',
  replace: 'Session not renewed',
  revoke: 'Session not revoked',
};

/** What to tell the user when gnokey-mobile answers a session request with an error code (GnoConnect). */
export function walletErrorText(code: string, op: Pending['op'], chainId: string): { title: string; message: string } {
  const title = TITLES[op];
  switch (code) {
    case 'network_declined':
      return {
        title,
        message: `gnokey-mobile is on another network and did not switch. Bubble Rumble is on "${chainId}": switch gnokey-mobile to it — or this app in Settings — then try again.`,
      };
    case 'signer_unavailable':
      return { title, message: 'gnokey-mobile cannot sign for this account right now. Open gnokey-mobile, check the account, then try again.' };
    case 'invalid_request':
      return { title, message: 'gnokey-mobile could not read the request. Make sure both apps are up to date, then try again.' };
    case 'invalid_proof':
      return { title, message: "gnokey-mobile could not verify this app's key. Try again." };
    case 'stale_request':
      return { title, message: 'The request expired before gnokey-mobile opened it. Try again.' };
    case 'session_expired':
      return { title, message: 'This key belongs to a session that has expired. Get a new session.' };
    case 'session_not_found':
      return { title, message: 'gnokey-mobile could not find this session on the chain. It may already be revoked.' };
    case 'session_limit':
      return { title, message: 'Your account already has the maximum number of sessions. Revoke old ones in gnokey-mobile, then try again.' };
    case 'tx_failed':
      return { title, message: 'The transaction failed on the chain. Try again.' };
    default:
      return { title, message: code ? `gnokey-mobile reported an error (${code}).` : 'gnokey-mobile reported an error.' };
  }
}
