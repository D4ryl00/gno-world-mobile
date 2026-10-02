import { flagSuggestions } from '@/screens/pool/flag-suggestions';

test("the player's country first, then the pool's teams, each once", () => {
  expect(flagSuggestions('FR', { FR: 1, DE: 2 })).toEqual(['FR', 'DE']);
  expect(flagSuggestions('', { DE: 2, FR: 1 })).toEqual(['DE', 'FR']);
  expect(flagSuggestions('US', {})).toEqual(['US']);
});
