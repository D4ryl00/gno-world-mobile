import type { StateStorage } from 'zustand/middleware';

import { createSettingsStore, DEFAULT_SETTINGS, matchingPreset, validateOffchainUrl, validateRemote, watchHydration } from '@/state/settings';

const memory = (): StateStorage => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
};

test('defaults', () => {
  const s = createSettingsStore(memory()).getState();
  expect(s.chainId).toBe('gnoland-1');
  expect(s.remote).toBe('https://rpc.gno.land:443');
  expect(s.offchainUrl).toBe('https://bubblerumble.net');
  expect(DEFAULT_SETTINGS.ref).toBe('');
});

test('validation', () => {
  expect(validateRemote('https://rpc.gno.land:443')).toBeNull();
  expect(validateRemote('http://127.0.0.1:26657')).toBeNull();
  expect(validateRemote('rpc.gno.land')).toMatch(/http/);
  expect(validateOffchainUrl('https://bubblerumble.net')).toBeNull();
  expect(validateOffchainUrl('https://example.org/')).toBeNull();
  expect(validateOffchainUrl('ftp://x')).toMatch(/http/);
});

test('offchain URL is stored without a trailing slash', () => {
  const st = createSettingsStore(memory());
  st.getState().setOffchainUrl('https://example.org/');
  expect(st.getState().offchainUrl).toBe('https://example.org');
});

test('the first referrer sticks; self and invalid ones are ignored', () => {
  const st = createSettingsStore(memory());
  const me = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
  st.getState().setRefOnce(me, me);
  expect(st.getState().ref).toBe('');
  st.getState().setRefOnce('nope');
  expect(st.getState().ref).toBe('');
  st.getState().setRefOnce('g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr');
  st.getState().setRefOnce('g1r9mekllcz0fqdt0w2lstckw9exxtvzpqy5hazp');
  expect(st.getState().ref).toBe('g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr');
});

test('flags are validated', () => {
  const st = createSettingsStore(memory());
  st.getState().setFlag('fr');
  expect(st.getState().flag).toBe('FR');
  st.getState().setFlag('XYZ');
  expect(st.getState().flag).toBe('FR');
  st.getState().setFlag('');
  expect(st.getState().flag).toBe('');
});

test('watchHydration calls onDone immediately if hydration already finished', () => {
  const onDone = jest.fn();
  const p = {
    hasHydrated: () => true,
    onFinishHydration: jest.fn(() => () => {}),
  };
  watchHydration(p, onDone);
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('watchHydration subscribes and calls onDone when hydration finishes', () => {
  const onDone = jest.fn();
  let listener: (() => void) | undefined;
  const p = {
    hasHydrated: () => false,
    onFinishHydration: jest.fn((fn: () => void) => {
      listener = fn;
      return () => {};
    }),
  };
  watchHydration(p, onDone);
  expect(onDone).not.toHaveBeenCalled();
  expect(listener).toBeDefined();
  if (listener) listener();
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('watchHydration returns an unsubscribe function', () => {
  const onDone = jest.fn();
  const unsubscribeMock = jest.fn();
  const p = {
    hasHydrated: () => false,
    onFinishHydration: jest.fn(() => unsubscribeMock),
  };
  const unsubscribe = watchHydration(p, onDone);
  expect(unsubscribe).toBe(unsubscribeMock);
});

const settle = () => new Promise((r) => setTimeout(r, 0));

test('onSettled is called after a successful rehydrate', async () => {
  const onSettled = jest.fn();
  createSettingsStore(memory(), onSettled);
  await settle();
  expect(onSettled).toHaveBeenCalledTimes(1);
});

test('onSettled is called and defaults are kept when the storage read rejects', async () => {
  const onSettled = jest.fn();
  const failing: StateStorage = { getItem: () => Promise.reject(new Error('disk')), setItem: () => {}, removeItem: () => {} };
  const st = createSettingsStore(failing, onSettled);
  await settle();
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(st.getState().chainId).toBe(DEFAULT_SETTINGS.chainId);
});

test('onSettled is called and defaults are kept when the stored JSON is corrupt', async () => {
  const onSettled = jest.fn();
  const corrupt: StateStorage = { getItem: () => '{not json', setItem: () => {}, removeItem: () => {} };
  const st = createSettingsStore(corrupt, onSettled);
  await settle();
  expect(onSettled).toHaveBeenCalledTimes(1);
  expect(st.getState().remote).toBe(DEFAULT_SETTINGS.remote);
});

describe('matchingPreset', () => {
  it('names the preset the fields spell, ignoring surrounding spaces', () => {
    expect(matchingPreset('gnoland-1', 'https://rpc.gno.land:443')?.label).toBe('gno.land (mainnet)');
    expect(matchingPreset(' dev ', 'http://127.0.0.1:26657 ')?.label).toBe('Local gnodev');
  });
  it('is undefined for a custom network', () => {
    expect(matchingPreset('dev', 'http://10.0.2.2:26657')).toBeUndefined();
    expect(matchingPreset('test11', 'https://rpc.gno.land:443')).toBeUndefined();
  });
});

test('setNetwork refuses an empty chain or an endpoint that is no URL', () => {
  const st = createSettingsStore(memory());
  st.getState().setNetwork('', 'http://127.0.0.1:26657');
  st.getState().setNetwork('dev', 'nope');
  expect(st.getState().chainId).toBe('gnoland-1');
  expect(st.getState().remote).toBe('https://rpc.gno.land:443');
  st.getState().setNetwork(' dev ', ' http://127.0.0.1:26657 ');
  expect(st.getState()).toMatchObject({ chainId: 'dev', remote: 'http://127.0.0.1:26657' });
});

test('settings survive a restart', async () => {
  const storage = memory();
  const first = createSettingsStore(storage);
  first.getState().setNetwork('dev', 'http://127.0.0.1:26657');
  first.getState().setFlag('fr');
  first.getState().setRefOnce('g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr');
  const second = createSettingsStore(storage);
  await new Promise<void>((resolve) => watchHydration(second.persist, resolve));
  expect(second.getState()).toMatchObject({
    chainId: 'dev', remote: 'http://127.0.0.1:26657', flag: 'FR', ref: 'g1leu8d2vsplhehcfkjg50mwgdpxdkt8tztu95wr',
  });
});
