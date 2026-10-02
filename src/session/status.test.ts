import { FakeChainApi } from '@/chain/fake-api';
import { expiresSoon, missingPaths, pollSession, querySession, remaining, resetsIn } from '@/session/status';
import { bytesToHex, decodeAddress } from '@/utils/bech32';

const M = 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5';
const S = 'g1jyh59tr2t4yjmwajjax9mye369gkkujv7tegkk';
const k = `${bytesToHex(decodeAddress(M))}/${bytesToHex(decodeAddress(S))}`;
const info = {
  expiresAt: 2000000000n, spendLimit: [{ denom: 'ugnot', amount: 5000000n }], spendPeriod: 3600n,
  spendUsed: [{ denom: 'ugnot', amount: 4900600n }], spendReset: 1790853462n, allowPaths: ['bank/send'],
};

test('querySession maps the account and says null when absent', async () => {
  const api = new FakeChainApi();
  expect(await querySession(api, M, S)).toBeNull();
  api.sessions.set(k, info);
  expect(await querySession(api, M, S)).toEqual({
    expiresAt: 2000000000, spendLimit: 5000000, spendUsed: 4900600, spendReset: 1790853462, spendPeriod: 3600,
    allowPaths: ['bank/send'],
  });
});

test('remaining budget follows the chain reset rule', () => {
  const s = { expiresAt: 2e9, spendLimit: 5000000, spendUsed: 4900600, spendReset: 1790853462, spendPeriod: 3600, allowPaths: [] };
  expect(remaining(s, 1790853462 + 10)).toBe(99400);
  expect(resetsIn(s, 1790853462 + 10)).toBe(3590);
  expect(remaining(s, 1790853462 + 3600)).toBe(5000000);
  expect(resetsIn(s, 1790853462 + 3600)).toBe(0);
  expect(remaining({ ...s, spendPeriod: 0 }, 1e10)).toBe(99400);
});

test('expiresSoon', () => {
  const s = { expiresAt: 1000 + 2 * 86400, spendLimit: 0, spendUsed: 0, spendReset: 0, spendPeriod: 0, allowPaths: [] };
  expect(expiresSoon(s, 1000)).toBe(true);
  expect(expiresSoon({ ...s, expiresAt: 1000 + 10 * 86400 }, 1000)).toBe(false);
  expect(expiresSoon({ ...s, expiresAt: 0 }, 1000)).toBe(false);
});

test('querySession handles missing sessions: ErrUnknownAddress, unknown master address, session not found', async () => {
  const api = new FakeChainApi();

  // Test: [unknown] ErrUnknownAddress format (gnoclient on Android)
  api.querySessionAccount = async () => {
    throw new Error('[unknown] ErrUnknownAddress(#118)');
  };
  expect(await querySession(api, M, S)).toBeNull();

  // Test: iOS bridge error format
  api.querySessionAccount = async () => {
    throw new Error('UnexpectedException: invoke bridge method error: unknown: ErrUnknownAddress(#118) (at ExpoModulesCore/Promise.swift:56)');
  };
  expect(await querySession(api, M, S)).toBeNull();

  // Test: unknown master address (gnoclient native format)
  api.querySessionAccount = async () => {
    throw new Error(`std.ErrUnknownAddress("unknown master address: ${M} or session address: ${S}")`);
  };
  expect(await querySession(api, M, S)).toBeNull();

  // Test: session not found (fake API format)
  api.querySessionAccount = async () => {
    throw new Error('session not found');
  };
  expect(await querySession(api, M, S)).toBeNull();
});

test('querySession rethrows unrelated errors', async () => {
  const api = new FakeChainApi();

  // Test: rpc method not found
  api.querySessionAccount = async () => {
    throw new Error('[unavailable] rpc method not found');
  };
  await expect(querySession(api, M, S)).rejects.toThrow(/rpc method not found/);

  // Test: network request failed
  api.querySessionAccount = async () => {
    throw new Error('network request failed');
  };
  await expect(querySession(api, M, S)).rejects.toThrow(/network request failed/);
});

test('pollSession waits for presence, then for absence, and can be aborted', async () => {
  const api = new FakeChainApi();
  let ticks = 0;
  const sleep = async () => {
    if (++ticks === 2) api.sessions.set(k, info);
  };
  const st = await pollSession(api, M, S, 'present', { intervalMs: 1, signal: { aborted: false }, sleep });
  expect(st?.spendLimit).toBe(5000000);

  const sleep2 = async () => void api.sessions.delete(k);
  expect(await pollSession(api, M, S, 'absent', { intervalMs: 1, signal: { aborted: false }, sleep: sleep2 })).toBeNull();

  const signal = { aborted: false };
  const p = pollSession(api, M, S, 'present', { intervalMs: 1, signal, sleep: async () => void (signal.aborted = true) });
  await expect(p).rejects.toThrow(/cancelled/);
});

describe('missingPaths', () => {
  const need = ['vm/exec:gno.land/r/a/bubblerumble5', 'vm/exec:gno.land/r/a/bubble'];
  const st = (allowPaths: string[]) => ({ expiresAt: 0, spendLimit: 0, spendUsed: 0, spendReset: 0, spendPeriod: 0, allowPaths });
  test('lists the needed entries the session does not cover', () => {
    expect(missingPaths(st(need), need)).toEqual([]);
    expect(missingPaths(st(['vm/exec:gno.land/r/a/bubblerumble5']), need)).toEqual(['vm/exec:gno.land/r/a/bubble']);
    expect(missingPaths(st(['bank/send']), need)).toEqual(need);
  });
  test('follows the chain grammar: *, a bare vm/exec, and path prefixes on a "/" boundary', () => {
    expect(missingPaths(st(['*']), need)).toEqual([]);
    expect(missingPaths(st(['vm/exec']), need)).toEqual([]);
    expect(missingPaths(st(['vm/exec:gno.land/r/a']), need)).toEqual([]);
    expect(missingPaths(st(['vm/exec:gno.land/r/a/bubble']), need)).toEqual(['vm/exec:gno.land/r/a/bubblerumble5']);
  });
});
