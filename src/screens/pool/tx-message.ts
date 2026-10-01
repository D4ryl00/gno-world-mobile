import { ChainError } from '@/chain/errors';
import { resetsIn, type SessionStatus } from '@/session/status';
import { humanDuration } from '@/utils/gnot';

export function txMessage(e: unknown, now: number, status?: SessionStatus): string {
  if (!(e instanceof ChainError)) return String((e as Error)?.message ?? e);
  switch (e.kind) {
    case 'budget': {
      const left = status ? resetsIn(status, now) : 0;
      return left > 0
        ? `Session budget used up — it refills in ${humanDuration(left)}.`
        : 'Session budget used up — raise it from the Session tab.';
    }
    case 'expired':
      return 'Your session has expired — renew it from the Session tab.';
    case 'unknown-session':
      return 'Your session was revoked or is unknown to the chain — make a new one from the Session tab.';
    case 'not-allowed':
      return 'Your session does not cover this realm — renew it from the Session tab.';
    case 'funds':
      return 'Your account is out of GNOT — top it up from the Session tab.';
    case 'network':
      return 'The node did not answer — try again.';
    default:
      return e.message;
  }
}
