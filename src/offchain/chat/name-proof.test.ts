import { proofFromReply } from './name-proof';
import { PROOF, proofReply as reply } from './testing';

const ADDR = PROOF.addr;

test('the reply becomes what gno.world takes', () => {
  expect(proofFromReply(reply(), ADDR, 'gnoland-1')).toEqual({ doc: PROOF.doc, sig: PROOF.sig, pub: PROOF.pub, addr: ADDR });
});

test('a reply without a proof, or for another account, is refused', () => {
  expect(() => proofFromReply(reply({ signed: '' }), ADDR, 'gnoland-1')).toThrow(/cannot prove/);
  expect(() => proofFromReply(reply({ address: 'g1other' }), ADDR, 'gnoland-1')).toThrow(/g1other/);
  expect(() => proofFromReply(reply({ pubkey: 'gpub1nope' }), ADDR, 'gnoland-1')).toThrow();
});

test('a key of another kind is refused', () => {
  // an ed25519 gpub (another type URL)
  const ed = 'gpub1pggj7ard9eg82cjtv4u52epjx56nzwgjyg9zqpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc87zxnnh';
  expect(() => proofFromReply(reply({ pubkey: ed }), ADDR, 'gnoland-1')).toThrow(/unknown kind of key/);
});

test('a proof for another chain than the one asked is refused, by name', () => {
  expect(() => proofFromReply(reply({ chainid: 'test5' }), ADDR, 'gnoland-1')).toThrow(/test5, not gnoland-1/);
});
