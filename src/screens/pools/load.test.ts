import type { AllPools } from '@/chain/game-client';
import type { Pool } from '@/chain/parse';
import { createSerialLoader, loadNotice } from '@/screens/pools/load';

const all = (pools: number, failed: number[]) =>
  // pools only ever come from a version that answered
  ({ pools: Array.from({ length: pools }, () => ({}) as Pool), realms: pools ? { 5: {} } : {}, failed }) as unknown as AllPools;

test('nothing loaded with failures is an error', () => {
  expect(loadNotice(all(0, [5, 4]))).toEqual({ error: 'the node did not answer' });
});

test('a version answering with no pools is not "the node did not answer" (gnodev with only v5)', () => {
  const onlyV5 = { pools: [], realms: { 5: {} }, failed: [4, 3, 2, 1] } as unknown as AllPools;
  expect(loadNotice(onlyV5)).toEqual({ notice: 'Could not load v4, v3, v2, v1 — pull to retry.' });
});

test('some loaded with failures is a notice naming the versions', () => {
  expect(loadNotice(all(2, [3, 1]))).toEqual({ notice: 'Could not load v3, v1 — pull to retry.' });
});

test('no failures is neither', () => {
  expect(loadNotice(all(2, []))).toEqual({});
  expect(loadNotice(all(0, []))).toEqual({});
});

test('serial loader coalesces concurrent calls and runs again after settling', async () => {
  let release!: () => void;
  const fn = jest.fn(() => new Promise<void>((r) => { release = r; }));
  const load = createSerialLoader(fn);
  const a = load();
  const b = load();
  expect(a).toBe(b);
  expect(fn).toHaveBeenCalledTimes(1);
  release();
  await a;
  const c = load();
  expect(fn).toHaveBeenCalledTimes(2);
  release();
  await c;
});

test('serial loader frees the slot when the load rejects', async () => {
  const fn = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined);
  const load = createSerialLoader(fn);
  await expect(load()).rejects.toThrow('x');
  await expect(load()).resolves.toBeUndefined();
});
