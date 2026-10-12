import { proofFromReply } from './name-proof';
import { PROOF, proofReply as reply } from './testing';

const ADDR = PROOF.addr;

test('the reply becomes what gno.world takes', () => {
  expect(proofFromReply(reply(), ADDR)).toEqual({ doc: PROOF.doc, sig: PROOF.sig, pub: PROOF.pub, addr: ADDR });
});

test('a reply without a proof, or for another account, is refused', () => {
  expect(() => proofFromReply(reply({ signed: '' }), ADDR)).toThrow(/cannot prove/);
  expect(() => proofFromReply(reply({ address: 'g1other' }), ADDR)).toThrow(/g1other/);
  expect(() => proofFromReply(reply({ pubkey: 'gpub1nope' }), ADDR)).toThrow();
});

test('a key of another kind is refused', () => {
  // an ed25519 gpub (another type URL)
  const ed = 'gpub1pggj7ard9eg82cjtv4u52epjx56nzwgjyg9zqpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc87zxnnh';
  expect(() => proofFromReply(reply({ pubkey: ed }), ADDR)).toThrow(/unknown kind of key/);
});
