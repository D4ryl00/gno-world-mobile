import { buildSessionLink, canonicalPayload, grantsKey, parseReplyURL, signLink } from '@/session/gnoconnect';

const GPUB = 'gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pqwy7ynrtu4aum2869uhjarjtsuer63evxrrm3d4sa3w6mkyzefv8yhklkkx';

// The vector the Go reference implementation (tm2 crypto) produced and verified on 2026-10-01. Its host line was
// updated from `createsession` to `connect` when the session hosts were folded into `connect`; the payload
// construction itself did not change.
const GO_LINK =
  'land.gno.gnokey://connect?pubkey=' + GPUB +
  '&allow=vm%2Fexec%3Agno.land%2Fr%2Ffoo&allow=bank%2Fsend&spend=5000000ugnot&period=3600&expires=2592000' +
  '&chainid=dev&callback=https%3A%2F%2Fexample.com%2Fcb%3Fx%3D1&state=ab%2Bc%3D&iat=1790841600';
const GO_PAYLOAD = [
  'gnoconnect-session-v1',
  'host=connect',
  'allow=bank/send',
  'allow=vm/exec:gno.land/r/foo',
  'callback=https://example.com/cb?x=1',
  'chainid=dev',
  'expires=2592000',
  'iat=1790841600',
  'period=3600',
  `pubkey=${GPUB}`,
  'spend=5000000ugnot',
  'state=ab+c=',
].join('\n');

test('canonical payload matches the Go reference', () => {
  expect(canonicalPayload(GO_LINK)).toBe(GO_PAYLOAD);
  expect(canonicalPayload(GO_LINK + '&sig=AAAA&oldsig=BBBB')).toBe(GO_PAYLOAD);
  expect(canonicalPayload(GO_LINK.replace('://connect', '://Connect'))).toBe(GO_PAYLOAD);
});

test('a line break in a value is refused', () => {
  expect(() => canonicalPayload('land.gno.gnokey://disconnect?state=a%0Ab')).toThrow(/control/);
});

test('buildSessionLink → canonicalPayload round trip, and signatures are appended', async () => {
  const link = buildSessionLink({
    host: 'connect', pubkey: GPUB, allow: ['vm/exec:gno.land/r/foo', 'bank/send'],
    grant: { spendPerPeriod: 5000000, period: 3600, expires: 2592000 },
    chainid: 'dev', callback: 'https://example.com/cb?x=1', state: 'ab+c=', iat: 1790841600,
  });
  expect(canonicalPayload(link)).toBe(GO_PAYLOAD);
  const seen: string[] = [];
  const signed = await signLink(link, async (d) => {
    seen.push(new TextDecoder().decode(d));
    return new Uint8Array([251, 255]);
  });
  expect(seen).toEqual([GO_PAYLOAD]);
  expect(signed).toBe(link + '&sig=-_8');
});

test('renewal links are a connect that carries old, signer and both signatures', async () => {
  const link = buildSessionLink({
    host: 'connect', pubkey: GPUB, old: 'gpub1old', allow: ['bank/send'],
    grant: { spendPerPeriod: 1, period: 0, expires: 60 }, chainid: 'dev', signer: 'g1me',
    callback: 'gno.world://session-callback', state: 's', iat: 1,
  });
  expect(link).toMatch(/^land\.gno\.gnokey:\/\/connect\?pubkey=gpub1/);
  expect(link).toContain('old=gpub1old');
  expect(link).toContain('signer=g1me');
  const signed = await signLink(link, async () => new Uint8Array([1]), async () => new Uint8Array([2]));
  expect(signed.endsWith('&sig=AQ&oldsig=Ag')).toBe(true);
});

test('disconnect links name the key and the identity, nothing else', () => {
  expect(
    buildSessionLink({ host: 'disconnect', pubkey: GPUB, chainid: 'dev', signer: 'g1me', callback: 'gno.world://session-callback', state: 's', iat: 1 }),
  ).toBe(`land.gno.gnokey://disconnect?pubkey=${GPUB}&chainid=dev&signer=g1me&callback=gno.world%3A%2F%2Fsession-callback&state=s&iat=1`);
});

test('parse a success reply; repeated allow kept; last occurrence wins', () => {
  const r = parseReplyURL(
    'gno.world://session-callback?status=error&status=success&address=g1me&session=g1s&expires_at=1793433600' +
      '&allow=vm%2Fexec%3Agno.land%2Fr%2Ffoo&allow=bank%2Fsend&spend=5000000ugnot&period=3600&chainid=dev&revoked=g1old&state=ab%2Bc%3D',
  );
  expect(r).toMatchObject({
    status: 'success', address: 'g1me', session: 'g1s', expiresAt: 1793433600, period: 3600,
    allow: ['vm/exec:gno.land/r/foo', 'bank/send'], revoked: 'g1old', state: 'ab+c=',
  });
});

test('a reply grants the key only when its session is the key address', () => {
  const ok = parseReplyURL('gno.world://session-callback?status=success&address=g1me&session=g1s&state=x')!;
  expect(grantsKey(ok, 'g1s')).toBe(true);
  expect(grantsKey(ok, 'g1other')).toBe(false); // e.g. the wallet's own delegated key in an identity-only answer
  expect(grantsKey(parseReplyURL('gno.world://session-callback?status=success&address=g1me&state=x')!, 'g1s')).toBe(false);
  expect(grantsKey(parseReplyURL('gno.world://session-callback?status=error&session=g1s&state=x')!, 'g1s')).toBe(false);
});

test('fragment replies (https callbacks) parse too; junk is null', () => {
  expect(parseReplyURL('https://x.example/cb#status=cancelled&state=s')).toMatchObject({ status: 'cancelled', state: 's' });
  expect(parseReplyURL('https://x.example/cb?status=error&state=q#status=cancelled&state=s')).toMatchObject({ status: 'cancelled', state: 's' });
  expect(parseReplyURL('gno.world://session-callback?status=maybe')).toBeNull();
});

test('malformed escape sequences in callback URLs return null (attacker-controlled)', () => {
  expect(parseReplyURL('gno.world://session-callback?status=success&state=%zz')).toBeNull();
  expect(parseReplyURL('gno.world://session-callback?status=success&state=%ff')).toBeNull();
  expect(parseReplyURL('gno.world://session-callback?status=success&state=%')).toBeNull();
});

test('a custom-scheme reply is read from the query, where the wallet writes it', () => {
  expect(parseReplyURL('gno.world://session-callback?status=success&state=a#status=error&state=b')).toMatchObject({
    status: 'success', state: 'a',
  });
});

test('the canonical order is by code point, as UTF-8 bytes order them', () => {
  // UTF-16 code units put U+1F600 (a surrogate pair, 0xD83D…) before U+E000; UTF-8 puts it after.
  const p = canonicalPayload('land.gno.gnokey://disconnect?k=%F0%9F%98%80&k=%EE%80%80');
  expect(p.split('\n').slice(2)).toEqual(['k=\uE000', 'k=\u{1F600}']);
});

test('control characters, C1 included, and = in a name are refused', () => {
  expect(() => canonicalPayload('land.gno.gnokey://disconnect?state=a%C2%85b')).toThrow(/control/);
  expect(() => canonicalPayload('land.gno.gnokey://disconnect?st%7Fate=a')).toThrow(/control/);
  expect(() => canonicalPayload('land.gno.gnokey://disconnect?a%3Db=c')).toThrow(/=/);
});

test('something that is not a link is refused', () => {
  expect(() => canonicalPayload('connect?state=a')).toThrow(/not a link/);
  expect(parseReplyURL('status=success&state=a')).toBeNull();
});

describe('buildSessionLink keeps to the protocol', () => {
  const ok = {
    host: 'connect' as const, pubkey: GPUB, allow: ['bank/send'], grant: { spendPerPeriod: 1, period: 3600, expires: 60 },
    chainid: 'dev', callback: 'gno.world://session-callback', state: 's', iat: 1,
  };
  it('accepts a well-formed grant', () => expect(() => buildSessionLink(ok)).not.toThrow());
  it('refuses old equal to pubkey', () => expect(() => buildSessionLink({ ...ok, old: GPUB, signer: 'g1me' })).toThrow(/old/));
  it('refuses old without signer', () => expect(() => buildSessionLink({ ...ok, old: 'gpub1old' })).toThrow(/signer/));
  it('refuses 0 or 9 allow entries on a grant', () => {
    expect(() => buildSessionLink({ ...ok, allow: [] })).toThrow(/allow/);
    expect(() => buildSessionLink({ ...ok, allow: Array(9).fill('bank/send') })).toThrow(/allow/);
  });
  it('refuses an empty or a 257-character state', () => {
    expect(() => buildSessionLink({ ...ok, state: '' })).toThrow(/state/);
    expect(() => buildSessionLink({ ...ok, state: 'x'.repeat(257) })).toThrow(/state/);
  });
  it('refuses out-of-range period and expires', () => {
    expect(() => buildSessionLink({ ...ok, grant: { ...ok.grant, period: 2592001 } })).toThrow(/period/);
    expect(() => buildSessionLink({ ...ok, grant: { ...ok.grant, expires: 0 } })).toThrow(/expires/);
    expect(() => buildSessionLink({ ...ok, grant: { ...ok.grant, expires: 126144001 } })).toThrow(/expires/);
  });
  it('refuses a disconnect without signer, or with old or allow', () => {
    const d = { host: 'disconnect' as const, pubkey: GPUB, chainid: 'dev', signer: 'g1me', callback: ok.callback, state: 's', iat: 1 };
    expect(() => buildSessionLink(d)).not.toThrow();
    expect(() => buildSessionLink({ ...d, signer: undefined })).toThrow(/signer/);
    expect(() => buildSessionLink({ ...d, old: 'gpub1old' })).toThrow(/old/);
    expect(() => buildSessionLink({ ...d, allow: ['bank/send'] })).toThrow(/allow/);
  });
});

test('signatures are appended whole, sig then oldsig, base64url without padding', async () => {
  const link = buildSessionLink({
    host: 'connect', pubkey: GPUB, old: 'gpub1old', allow: ['bank/send'], grant: { spendPerPeriod: 1, period: 0, expires: 60 },
    chainid: 'dev', signer: 'g1me', callback: 'gno.world://session-callback', state: 's', iat: 1,
  });
  const a = new Uint8Array(64).map((_, i) => i * 4); // covers - and _ in base64url
  const b = new Uint8Array(64).fill(0xff);
  const signed = await signLink(link, async () => a, async () => b);
  const tail = signed.slice(link.length);
  const m = /^&sig=([A-Za-z0-9_-]+)&oldsig=([A-Za-z0-9_-]+)$/.exec(tail);
  expect(m).not.toBeNull();
  expect(Buffer.from(m![1], 'base64url')).toEqual(Buffer.from(a));
  expect(Buffer.from(m![2], 'base64url')).toEqual(Buffer.from(b));
});
