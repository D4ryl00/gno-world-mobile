import type { StateStorage } from 'zustand/middleware';

import { createSettingsStore, DEFAULT_SETTINGS, validateOffchainUrl, validateRemote } from '@/state/settings';

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
