import { walletErrorText } from '@/screens/session/wallet-error';

test('network_declined names the network the app is on', () => {
  const t = walletErrorText('network_declined', 'create', 'dev');
  expect(t.title).toBe('No session yet');
  expect(t.message).toMatch(/gnokey-mobile is on another network/);
  expect(t.message).toMatch(/"dev"/);
});

test('each operation has its own title', () => {
  expect(walletErrorText('tx_failed', 'replace', 'dev').title).toBe('Session not renewed');
  expect(walletErrorText('tx_failed', 'revoke', 'dev').title).toBe('Session not revoked');
});

test('every GnoConnect code reads as a sentence, never as the raw code', () => {
  for (const code of [
    'signer_unavailable', 'invalid_request', 'invalid_proof', 'stale_request', 'session_expired',
    'session_not_found', 'session_limit', 'tx_failed', 'network_declined',
  ]) {
    const { message } = walletErrorText(code, 'create', 'gnoland-1');
    expect(message).not.toContain(code);
    expect(message.length).toBeGreaterThan(20);
  }
});

test('an unknown code still explains, and keeps the code for support', () => {
  expect(walletErrorText('weird_thing', 'create', 'dev').message).toMatch(/gnokey-mobile reported an error \(weird_thing\)/);
  expect(walletErrorText('', 'create', 'dev').message).toMatch(/gnokey-mobile reported an error\./);
});
