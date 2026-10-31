import type { ChatClient } from '@/offchain/chat/client';
import { NO_IDENTITY, type ChatIdentity } from '@/offchain/chat/identity';
import { createIdentityState, displayName } from '@/offchain/chat/identity-store';
import { PROOF, proofReply } from '@/offchain/chat/testing';
import { OffchainError } from '@/offchain/http';
import type { WalletReply } from '@/session/gnoconnect';

function harness(_answers: unknown[], opts: { identity?: ChatIdentity; kv?: Map<string, string>; noWallet?: boolean } = {}) {
  const kv = opts.kv ?? new Map<string, string>();
  let ident: ChatIdentity = opts.identity ?? NO_IDENTITY;
  const client = {
    reserveName: jest.fn(),
    nameChallenge: jest.fn(),
    proveName: jest.fn(),
    releaseName: jest.fn(),
    uploadAvatar: jest.fn(),
  };
  const opened: string[] = [];
  const wallet = {
    open: async (url: string) => void opened.push(url),
    randomHex: () => 'feedfacefeedface',
    network: () => ({ chainId: 'gnoland-1', remote: 'https://rpc.gno.land:443' }),
  };
  const store = createIdentityState({
    client: client as unknown as ChatClient,
    identity: { load: async () => ident, save: async (p) => (ident = { ...ident, ...p }) },
    kv: { getItem: async (k) => kv.get(k) ?? null, setItem: async (k, v) => void kv.set(k, v) },
    wallet: opts.noWallet ? undefined : wallet,
  });
  return { store, client, kv, opened, setIdentity: (i: ChatIdentity) => (ident = i) };
}

test('the display name is the reserved name, else the free one, else anon', () => {
  expect(displayName({ ...NO_IDENTITY, name: 'bob', reservedName: 'Ann' })).toBe('Ann');
  expect(displayName({ ...NO_IDENTITY, name: 'bob' })).toBe('bob');
  expect(displayName(NO_IDENTITY)).toBe('anon');
});
test('reserving saves the key; releasing clears it', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockResolvedValueOnce({ name: 'Ann', key: 'k', addr: 'g1x' });
  expect(await h.store.getState().reserveName('g1x')).toBe(true);
  expect(h.client.reserveName).toHaveBeenCalledWith('ann', 'g1x');
  expect(h.store.getState().identity).toMatchObject({ name: 'Ann', reservedName: 'Ann', nameKey: 'k' });
  h.client.releaseName.mockResolvedValueOnce(undefined);
  expect(await h.store.getState().releaseName()).toBe(true);
  expect(h.store.getState().identity).toMatchObject({ reservedName: '', nameKey: '' });
});

test('a release the server does not know (404) still clears the local name', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'Ann', reservedName: 'Ann', nameKey: 'k' } });
  await h.store.ready;
  h.client.releaseName.mockRejectedValueOnce(new OffchainError(404, 'no reserved name for this key'));
  expect(await h.store.getState().releaseName()).toBe(true);
  expect(h.store.getState().identity.nameKey).toBe('');
});

test('setName is refused while a name is reserved', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'Ann', reservedName: 'Ann', nameKey: 'k' } });
  await h.store.ready;
  await h.store.getState().setName('bob');
  expect(h.store.getState().identity.name).toBe('Ann');
  const free = harness([]);
  await free.store.ready;
  await free.store.getState().setName('  bob ');
  expect(free.store.getState().identity.name).toBe('bob');
});

test('an avatar upload keeps its id and key', async () => {
  const h = harness([]);
  await h.store.ready;
  h.client.uploadAvatar.mockResolvedValueOnce({ id: 'a1', key: 'ak' });
  expect(await h.store.getState().setAvatar(new Uint8Array([1]), 'image/jpeg')).toBe(true);
  expect(h.store.getState().identity).toMatchObject({ av: 'a1', avkey: 'ak' });
});

test('restart reads the identity of the new server: a reservation made elsewhere is not shown', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann', reservedName: 'ann', nameKey: 'k' } });
  await h.store.ready;
  expect(h.store.getState().identity.reservedName).toBe('ann');
  h.setIdentity({ ...NO_IDENTITY, name: 'ann' }); // what the identity store holds for the new server
  h.store.getState().restart();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.store.getState().identity).toEqual({ ...NO_IDENTITY, name: 'ann' });
});

test('a refused reservation is the sheet\'s error, until cleared', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(400, 'a name of 1 to 32 characters'));
  await h.store.getState().reserveName('g1x');
  expect(h.store.getState().identityError).toBe('a name of 1 to 32 characters');
  h.store.getState().clearIdentityError();
  expect(h.store.getState().identityError).toBe('');
});

const ADDR = PROOF.addr;
const okReply = (o: Partial<WalletReply> = {}) => proofReply({ state: 'feedfacefeedface', ...o });

/** A store whose reservation is waiting for the wallet. */
async function provingHarness() {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(409, 'Connect your wallet and let it sign the phrase'));
  h.client.nameChallenge.mockResolvedValueOnce('gno.world: prove this wallet is yours · tok');
  await h.store.getState().reserveName(ADDR);
  return h;
}

test('a 409 has the wallet sign the phrase, then the proof reserves the name', async () => {
  const h = await provingHarness();
  expect(h.store.getState().proving).toEqual({ state: 'feedfacefeedface', name: 'ann', identity: ADDR, chainId: 'gnoland-1' });
  expect(h.store.getState().identityError).toBe('');
  expect(h.opened).toHaveLength(1);
  const q = new URL(h.opened[0].replace('land.gno.gnokey://', 'https://x/')).searchParams;
  expect([q.get('challenge'), q.get('signer'), q.get('chainid'), q.get('state')])
    .toEqual(['gno.world: prove this wallet is yours · tok', ADDR, 'gnoland-1', 'feedfacefeedface']);

  h.client.proveName.mockResolvedValueOnce({ name: 'Ann', key: 'k', addr: ADDR });
  expect(await h.store.getState().onProofReply(okReply())).toBe(true);
  expect(h.client.proveName).toHaveBeenCalledWith('ann', { doc: PROOF.doc, sig: PROOF.sig, pub: PROOF.pub, addr: ADDR });
  expect(h.store.getState().identity).toMatchObject({ reservedName: 'Ann', nameKey: 'k' });
  expect(h.store.getState().proving).toBeNull();
});

test('a reservation that needs no proof does not open the wallet', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockResolvedValueOnce({ name: 'Ann', key: 'k', addr: ADDR });
  expect(await h.store.getState().reserveName(ADDR)).toBe(true);
  expect(h.opened).toHaveLength(0);
});

test('without a wallet, a 409 says the signature is coming instead of the server\'s words', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' }, noWallet: true });
  await h.store.ready;
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(409, 'Connect your wallet and let it sign the phrase'));
  expect(await h.store.getState().reserveName(ADDR)).toBe(false);
  expect(h.store.getState().walletSoon).toBe(true);
  expect(h.store.getState().identityError).toBe('');
  expect(h.client.nameChallenge).not.toHaveBeenCalled();

  // the next try (here a refusal of another kind) and closing the sheet forget it
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(400, 'a name is 1 to 32 characters'));
  await h.store.getState().reserveName(ADDR);
  expect(h.store.getState().walletSoon).toBe(false);
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(409, 'sign the phrase'));
  await h.store.getState().reserveName(ADDR);
  h.store.getState().clearIdentityError();
  expect(h.store.getState().walletSoon).toBe(false);
});

test('a reply with another state is not the chat\'s', async () => {
  const h = await provingHarness();
  expect(await h.store.getState().onProofReply(okReply({ state: 'other' }))).toBe(false);
  expect(h.client.proveName).not.toHaveBeenCalled();
  expect(h.store.getState().proving).not.toBeNull();
  const idle = harness([]);
  expect(await idle.store.getState().onProofReply(okReply())).toBe(false);
});

test('a wallet that cannot prove says how to boop instead', async () => {
  const h = await provingHarness();
  expect(await h.store.getState().onProofReply(okReply({ signed: '', signature: '' }))).toBe(true);
  expect(h.store.getState().identityError).toMatch(/Boop from this app, then reserve within 3 minutes/);
  expect(h.client.proveName).not.toHaveBeenCalled();
  expect(h.store.getState().proving).toBeNull();
});

test('a proof for another account is not sent', async () => {
  const h = await provingHarness();
  expect(await h.store.getState().onProofReply(okReply({ address: 'g1other' }))).toBe(true);
  expect(h.store.getState().identityError).toMatch(/g1other/);
  expect(h.client.proveName).not.toHaveBeenCalled();
});

test('a refusal after the signature is the sheet\'s error', async () => {
  const h = await provingHarness();
  h.client.proveName.mockRejectedValueOnce(new OffchainError(409, 'this wallet holds the name remi already'));
  expect(await h.store.getState().onProofReply(okReply())).toBe(true);
  expect(h.store.getState().identityError).toBe('this wallet holds the name remi already');
  expect(h.store.getState().identity.nameKey).toBe('');
  expect(h.store.getState().proving).toBeNull();
});

test('a cancelled or refused wallet answer ends the wait', async () => {
  const h = await provingHarness();
  expect(await h.store.getState().onProofReply(okReply({ status: 'cancelled' }))).toBe(true);
  expect(h.store.getState().proving).toBeNull();
  expect(h.store.getState().identityError).toBe('');
  const g = await provingHarness();
  expect(await g.store.getState().onProofReply(okReply({ status: 'error', code: 'signer_unavailable' }))).toBe(true);
  expect(g.store.getState().identityError).toBe(
    'The wallet could not sign as this identity: its computer could not sign (run gnokey-pair with a gnokey that has sign-data), or the wallet does not hold this identity.',
  );
});

test('a challenge the server will not give leaves nothing waiting', async () => {
  const h = harness([], { identity: { ...NO_IDENTITY, name: 'ann' } });
  await h.store.ready;
  h.client.reserveName.mockRejectedValueOnce(new OffchainError(409, 'sign the phrase'));
  h.client.nameChallenge.mockRejectedValueOnce(new OffchainError(503, 'busy'));
  expect(await h.store.getState().reserveName(ADDR)).toBe(false);
  expect(h.store.getState().proving).toBeNull();
  expect(h.store.getState().identityError).toBe('busy');
  expect(h.opened).toHaveLength(0);
});

test('cancelling stops waiting for the wallet', async () => {
  const h = await provingHarness();
  h.store.getState().cancelProving();
  expect(h.store.getState().proving).toBeNull();
  expect(await h.store.getState().onProofReply(okReply())).toBe(false);
});

// The minutes at the computer are long: the OS may evict the app meanwhile. The
// wallet's answer then reaches a new store, which must still know what it asked.
test('a proof that comes back to a relaunched app still reserves the name', async () => {
  const h = await provingHarness();
  const relaunched = harness([], { identity: { ...NO_IDENTITY, name: 'ann' }, kv: h.kv });
  await relaunched.store.ready;
  expect(relaunched.store.getState().proving).toEqual(h.store.getState().proving);
  relaunched.client.proveName.mockResolvedValueOnce({ name: 'Ann', key: 'k', addr: ADDR });
  expect(await relaunched.store.getState().onProofReply(okReply())).toBe(true);
  expect(relaunched.client.proveName).toHaveBeenCalledWith('ann', { doc: PROOF.doc, sig: PROOF.sig, pub: PROOF.pub, addr: ADDR });

  const again = harness([], { kv: h.kv });
  await again.store.ready;
  expect(again.store.getState().proving).toBeNull(); // answered: nothing left to wait for
});

test('a proof given up on is forgotten across launches', async () => {
  const h = await provingHarness();
  h.store.getState().cancelProving();
  const relaunched = harness([], { kv: h.kv });
  await relaunched.store.ready;
  expect(relaunched.store.getState().proving).toBeNull();
});

test('reloadIdentity shows what the identity store holds now (a name that came by /pair)', async () => {
  const h = harness([]);
  await h.store.ready;
  h.setIdentity({ ...NO_IDENTITY, name: 'remi', reservedName: 'remi', nameKey: 'a'.repeat(32) });
  await h.store.getState().reloadIdentity();
  expect(h.store.getState().identity).toMatchObject({ reservedName: 'remi', nameKey: 'a'.repeat(32) });
});
