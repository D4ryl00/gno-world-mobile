export type ChainErrorKind =
  | 'budget' | 'expired' | 'unknown-session' | 'not-allowed' | 'funds'
  | 'realm' | 'network' | 'wrong-chain' | 'no-session' | 'other';

export class ChainError extends Error {
  constructor(public kind: ChainErrorKind, message: string, public raw?: unknown) {
    super(message);
    this.name = 'ChainError';
  }
}

const RULES: [RegExp, ChainErrorKind][] = [
  [/session spend limit (would be )?exceeded|session has no spend limit/i, 'budget'],
  [/session expired/i, 'expired'],
  [/unknown session|session not found/i, 'unknown-session'],
  // gnonative: the signer key was never activated on this phone (restore could not unlock it)
  [/ErrNoActiveAccount/, 'unknown-session'],
  [/not permitted by session AllowPaths/i, 'not-allowed'],
  [/insufficient (funds|coins)/i, 'funds'],
  // gnonative drops the chain's detail for SessionNotAllowedError; for this app's own calls the realistic cause is the spend limit.
  [/session not allowed error/i, 'budget'],
  [/ECONNREFUSED|unreachable|network request failed|failed to fetch|timed? ?out|unable to connect/i, 'network'],
];

const REALM_TEXT =
  /(pool is closed|pool was cancelled|send at least [^\n,]+(?:, got [^\n,]+)?|name must be [^\n]+?(?=\n|$)|name has control characters|window must be [^\n]+?(?=\n|$)|base price must be [^\n]+?(?=\n|$)|life must be [^\n]+?(?=\n|$)|shot must be [^\n]+?(?=\n|$)|must be a direct user call|nothing to (?:claim|withdraw)[^\n]*|only ugnot is accepted|bad pool id)/i;

export function classifyError(e: unknown): ChainError {
  if (e instanceof ChainError) return e;
  const msg = String((e as { message?: unknown })?.message ?? e);
  for (const [re, kind] of RULES) if (re.test(msg)) return new ChainError(kind, msg.split('\n')[0], e);
  const realm = REALM_TEXT.exec(msg);
  if (realm) return new ChainError('realm', realm[1].trim(), e);
  return new ChainError('other', msg.split('\n')[0], e);
}
