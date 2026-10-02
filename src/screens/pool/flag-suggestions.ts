/** Flags to offer under the boop panel: the player's country, then the pool's teams — each code once. */
export const flagSuggestions = (country: string, teams: Record<string, unknown>): string[] =>
  [...new Set([country, ...Object.keys(teams)])].filter(Boolean);
