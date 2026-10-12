import type { WalletReply } from '@/session/gnoconnect';

import type { ChatLine, ChatPollReply } from './types';

/** Test builders. */
export const line = (id: number, p: Partial<ChatLine> = {}): ChatLine => ({
  id, t: 1_790_000_000 + id, name: 'someone', tag: 'bbbb', cc: '', body: `line ${id}`, rx: {}, rxwho: {},
  edited: false, pinned: false, reserved: false, av: '', bot: false, clip: '', ...p,
});

export const reply = (p: Partial<ChatPollReply> = {}): ChatPollReply => ({
  msgs: [], gone: [], upd: [], next: null, gen: 1, pins: [], typing: [], here: 3, you: { cc: 'FR', tag: 'aaaa' }, ...p,
});

/**
 * test1 (gnoland's default test mnemonic) proving "hello" on gnoland-1: its real gpub as `gnokey list` prints it, and
 * the signature cosmjs (Adena's stack) made over the document — the vectors of gno's std/signdata_test.go.
 */
export const PROOF = {
  addr: 'g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5',
  gpub: 'gpub1pgfj7ard9eg82cjtv4u4xetrwqer2dntxyfzxz3pq0skzdkmzu0r9h6gny6eg8c9dc303xrrudee6z4he4y7cs5rnjwmyf40yaj',
  pub: 'A+FhNtsXHjLfSJk1lB8FbiL4mGPjc50Kt81J7EKDnJ2y',
  doc: '{"account_number":"0","chain_id":"gnoland-1","fee":{"amount":[],"gas":"0"},"memo":"","msgs":[{"type":"sign/MsgSignData","value":{"data":"aGVsbG8=","signer":"g1jg8mtutu9khhfwc4nxmuhcpftf0pajdhfvsqf5"}}],"sequence":"0"}',
  signed: 'eyJhY2NvdW50X251bWJlciI6IjAiLCJjaGFpbl9pZCI6Imdub2xhbmQtMSIsImZlZSI6eyJhbW91bnQiOltdLCJnYXMiOiIwIn0sIm1lbW8iOiIiLCJtc2dzIjpbeyJ0eXBlIjoic2lnbi9Nc2dTaWduRGF0YSIsInZhbHVlIjp7ImRhdGEiOiJhR1ZzYkc4PSIsInNpZ25lciI6Imcxamc4bXR1dHU5a2hoZndjNG54bXVoY3BmdGYwcGFqZGhmdnNxZjUifX1dLCJzZXF1ZW5jZSI6IjAifQ',
  signature: '8hpjD4_il8opyBcDRI3Uax7RawxfahpY7agfp3fbv8V0OI1lPGBmIJ7epkRjGfFbyl57udqJHErR3q79qmwEZg',
  sig: '8hpjD4/il8opyBcDRI3Uax7RawxfahpY7agfp3fbv8V0OI1lPGBmIJ7epkRjGfFbyl57udqJHErR3q79qmwEZg==',
};

/** A wallet's success reply to a challenge, carrying PROOF. */
export const proofReply = (o: Partial<WalletReply> = {}): WalletReply => ({
  status: 'success', code: '', state: 's', address: PROOF.addr, session: '', expiresAt: 0, allow: [], spend: '', period: 0,
  chainid: 'gnoland-1', hash: '', revoked: '', pubkey: PROOF.gpub, signed: PROOF.signed, signature: PROOF.signature, ...o,
});
