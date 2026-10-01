import { createTxRunner } from '@/screens/pool/tx-runner';

const deferred = () => {
  let resolve!: () => void;
  let reject!: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test('a second run while one is in flight does nothing', async () => {
  const gate = deferred();
  const action = jest.fn(() => gate.promise);
  const run = createTxRunner({ setBusy: jest.fn(), reload: async () => undefined });
  const first = run(action);
  await run(action);
  expect(action).toHaveBeenCalledTimes(1);
  gate.resolve();
  await first;
  await run(action);
  expect(action).toHaveBeenCalledTimes(2);
});

test('busy is released only after the reload resolved', async () => {
  const gate = deferred();
  const calls: string[] = [];
  const run = createTxRunner({
    setBusy: (b) => calls.push(`busy:${b}`),
    reload: async () => { calls.push('reload'); await gate.promise; calls.push('reloaded'); },
  });
  const done = run(async () => { calls.push('action'); });
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(['busy:true', 'action', 'reload']);
  gate.resolve();
  await done;
  expect(calls).toEqual(['busy:true', 'action', 'reload', 'reloaded', 'busy:false']);
});

test('busy is released when the action or the reload rejects', async () => {
  const setBusy = jest.fn();
  const reload = jest.fn().mockRejectedValue(new Error('down'));
  const run = createTxRunner({ setBusy, reload });
  await run(async () => { throw new Error('boom'); }).catch(() => undefined);
  expect(setBusy).toHaveBeenLastCalledWith(false);
  setBusy.mockClear();
  await run(async () => undefined);
  expect(reload).toHaveBeenCalledTimes(2);
  expect(setBusy).toHaveBeenLastCalledWith(false);
});
