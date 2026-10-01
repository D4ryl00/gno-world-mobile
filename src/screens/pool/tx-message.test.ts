import { ChainError } from '@/chain/errors';
import { txMessage } from '@/screens/pool/tx-message';

const st = { expiresAt: 2e9, spendLimit: 5000000, spendUsed: 5000000, spendReset: 1000, spendPeriod: 3600, allowPaths: [] };

test('each failure kind tells the player what to do', () => {
  expect(txMessage(new ChainError('budget', 'x'), 1100, st)).toBe('Session budget used up — it refills in 58m 20s.');
  expect(txMessage(new ChainError('expired', 'x'), 0)).toMatch(/expired.*Session tab/);
  expect(txMessage(new ChainError('unknown-session', 'x'), 0)).toMatch(/revoked.*Session tab/);
  expect(txMessage(new ChainError('funds', 'x'), 0)).toMatch(/top it up/);
  expect(txMessage(new ChainError('realm', 'pool is closed'), 0)).toBe('pool is closed');
  expect(txMessage(new ChainError('wrong-chain', 'this session was made on dev'), 0)).toBe('this session was made on dev');
  expect(txMessage(new Error('boom'), 0)).toBe('boom');
});
