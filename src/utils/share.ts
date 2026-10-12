import { gnot } from './gnot';

/** gno.world shows the pools only to visitors who came through a `#rumble/` link; the referrer rides after `&`. */
export const shareUrl = (poolKey: string, ref: string) =>
  `https://gno.world/#rumble/${poolKey}${ref ? `&ref=${ref}` : ''}`;

export const shareText = (name: string, pot: number, url: string) =>
  `I'm in the "${name}" bubble on gno.world — ${gnot(pot)} in the pot. Every boop after mine pays me. Boop over me: ${url}`;
