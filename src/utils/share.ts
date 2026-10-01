import { gnot } from './gnot';

export const shareUrl = (poolKey: string, ref: string) =>
  `https://bubblerumble.net/${ref ? `?ref=${ref}` : ''}#${poolKey}`;

export const shareText = (name: string, pot: number, url: string) =>
  `I'm in the "${name}" bubble on Bubble Rumble — ${gnot(pot)} in the pot. Every boop after mine pays me. Boop over me: ${url}`;
