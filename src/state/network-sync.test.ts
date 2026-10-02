import { createNetworkSync, type Network } from '@/state/network-sync';

const MAIN: Network = { chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' };
const DEV: Network = { chainId: 'dev', remote: 'http://127.0.0.1:26657' };

function setup(applyImpl?: (n: Network) => Promise<void>) {
  const log: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const sync = createNetworkSync({
    initial: MAIN,
    pause: () => void log.push('pause'),
    apply:
      applyImpl ??
      (async (n) => {
        log.push(`apply:${n.chainId}`);
        await gate;
        log.push(`applied:${n.chainId}`);
      }),
    changed: async () => void log.push(`changed:${sync.current().chainId}`),
  });
  return { sync, log, release };
}

test('the store sees the new network only once gnonative has switched to it', async () => {
  const { sync, log, release } = setup();
  const done = sync.set(DEV);
  await Promise.resolve();
  await Promise.resolve();
  expect(log).toEqual(['pause', 'apply:dev']);
  expect(sync.current()).toEqual(MAIN); // gnonative may still be on the old chain
  release();
  await done;
  expect(sync.current()).toEqual(DEV);
  expect(log).toEqual(['pause', 'apply:dev', 'applied:dev', 'changed:dev']);
});

test('setting the network already in use does nothing', async () => {
  const { sync, log } = setup();
  await sync.set({ ...MAIN });
  expect(log).toEqual([]);
});

test('quick successive switches are applied one after the other', async () => {
  const log: string[] = [];
  const sync = createNetworkSync({
    initial: MAIN,
    pause: () => void log.push('pause'),
    apply: async (n) => {
      log.push(`apply:${n.chainId}`);
      await new Promise((r) => setTimeout(r, 5));
    },
    changed: async () => void log.push(`changed:${sync.current().chainId}`),
  });
  void sync.set(DEV);
  await sync.set(MAIN);
  expect(log).toEqual(['pause', 'apply:dev', 'changed:dev', 'pause', 'apply:gnoland-1', 'changed:gnoland-1']);
  expect(sync.current()).toEqual(MAIN);
});

test('a failed switch still moves on (the settings are what the user chose) and later switches still run', async () => {
  const log: string[] = [];
  let fail = true;
  const sync = createNetworkSync({
    initial: MAIN,
    pause: () => undefined,
    apply: async (n) => {
      log.push(`apply:${n.chainId}`);
      if (fail) throw new Error('bridge down');
    },
    changed: async () => void log.push(`changed:${sync.current().chainId}`),
  });
  await sync.set(DEV);
  fail = false;
  await sync.set(MAIN);
  expect(log).toEqual(['apply:dev', 'changed:dev', 'apply:gnoland-1', 'changed:gnoland-1']);
});
