import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';

import { nameIn, nameOut, pairWords } from './name';

const K = 'a'.repeat(32);
const MINE = 'b'.repeat(32);
const me = (p: Partial<ChatIdentity> = {}): ChatIdentity => ({ ...NO_IDENTITY, ...p });
const answers = (m: Record<string, boolean | null>) => async (name: string, key: string) => m[`${name}:${key}`] ?? null;

test.each([
  ['nothing valid came', { name: 'remi', key: 'short' }, me(), {}, { issue: 'none' }],
  ['no name came', { name: '', key: K }, me(), {}, { issue: 'none' }],
  ['the same key', { name: 'remi', key: K }, me({ reservedName: 'remi', nameKey: K }), {}, { issue: 'same', name: 'remi' }],
  ['mine, check unknown', { name: 'remi', key: K }, me({ reservedName: 'ann', nameKey: MINE }), {}, { issue: 'unknown', name: 'remi', had: 'ann' }],
  ['mine, refused', { name: 'remi', key: K }, me({ reservedName: 'ann', nameKey: MINE }), { [`remi:${K}`]: false }, { issue: 'refused', had: 'ann' }],
  ['mine, same name', { name: 'Remi', key: K }, me({ reservedName: 'remi', nameKey: MINE }), { [`Remi:${K}`]: true }, { issue: 'taken', take: { name: 'Remi', key: K } }],
  ['mine still good: kept', { name: 'remi', key: K }, me({ reservedName: 'ann', nameKey: MINE }), { [`remi:${K}`]: true, [`ann:${MINE}`]: true }, { issue: 'kept', had: 'ann' }],
  ['mine unknown: kept', { name: 'remi', key: K }, me({ reservedName: 'ann', nameKey: MINE }), { [`remi:${K}`]: true }, { issue: 'kept' }],
  ['mine refused: taken', { name: 'remi', key: K }, me({ reservedName: 'ann', nameKey: MINE }), { [`remi:${K}`]: true, [`ann:${MINE}`]: false }, { issue: 'taken', take: { name: 'remi', key: K }, had: 'ann' }],
  ['none here, refused', { name: 'remi', key: K }, me(), { [`remi:${K}`]: false }, { issue: 'refused', had: '' }],
  ['none here, yes', { name: 'remi', key: K }, me(), { [`remi:${K}`]: true }, { issue: 'taken', take: { name: 'remi', key: K } }],
  ['none here, unknown: taken all the same', { name: 'remi', key: K }, me(), {}, { issue: 'unknown', take: { name: 'remi', key: K } }],
  ['a reserved name without its key is no name', { name: 'remi', key: K }, me({ reservedName: 'ann' }), { [`remi:${K}`]: true }, { issue: 'taken', had: '' }],
])('%s', async (_, incoming, local, m, want) => {
  expect(await nameIn(incoming, local, answers(m as Record<string, boolean | null>))).toMatchObject(want);
});

test('a long name is cut at 40 before it is checked and taken', async () => {
  const got = await nameIn({ name: 'n'.repeat(50), key: K }, me(), async () => true);
  expect(got.take).toEqual({ name: 'n'.repeat(40), key: K });
});

test('what goes out: the reserved name with a 32 to 64 hex key, nothing otherwise', () => {
  expect(nameOut(me({ reservedName: 'remi', nameKey: K }))).toEqual({ name: 'remi', key: K });
  expect(nameOut(me({ reservedName: 'remi', nameKey: 'c'.repeat(64) }))).toEqual({ name: 'remi', key: 'c'.repeat(64) });
  expect(nameOut(me({ reservedName: 'remi', nameKey: 'k' }))).toBeUndefined();
  expect(nameOut(me({ nameKey: K }))).toBeUndefined();
});

test("the site's words", () => {
  const n = 'paired — your chat rooms are the same on both devices';
  expect(pairWords('taken', 'remi', '')).toBe(`${n}, and the name remi is yours here too ✓`);
  expect(pairWords('taken', 'remi', 'ann')).toBe(`${n}, and the name remi is yours here too ✓ — it replaces ann, whose key the box no longer honoured`);
  expect(pairWords('taken', 'remi', 'Remi')).toBe(`${n}, and the name remi is yours here too ✓`);
  expect(pairWords('same', 'remi', '')).toBe(`${n}; this device already had the name remi ✓`);
  expect(pairWords('kept', 'remi', 'ann')).toBe(`${n}. This device keeps its own name ann; the other device's name remi stays there`);
  expect(pairWords('refused', 'remi', '')).toBe(`${n}, but the name remi did NOT come along: the device the code came from holds an old key for it. /dm jae there to free the name, reserve it again there, then pair once more`);
  expect(pairWords('unknown', 'remi', '')).toBe(`${n}; the name remi could not be checked with the box just now — it is checked again within two minutes`);
  expect(pairWords('none', '', '')).toBe(`${n}. The other device holds no reserved name, so none came along`);
});
