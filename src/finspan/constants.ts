// Board layout and scoring constants for Finspan.
//
// NOTE on the ocean mat: the rulebook describes the dive-site bonus mechanic
// but not the exact printed icon grid. The mapping below is a reconstruction
// from the rulebook's sample dive turn (purple column: egg bonuses, bottom
// bonus 1 egg), tutorial videos (blue column: card draws, bottom bonus =
// recover a card from your discard pile), and each site's stated specialty
// (blue = cards, purple = eggs, green = hatching/moving young & schools).
// Forage positions: Showy Bristlemouth is confirmed in the purple twilight
// slot by the sample dive; Catalina Goby (purple sunlight) and Glasshead
// Grenadier (blue midnight) follow the printed-mat layout. Starting tokens:
// eggs on Bristlemouth + Grenadier slots, young on Catalina Goby slot.

import type { Benefit } from './types';

/** Forage pseudo-card ids (see data/fish.json). */
export const FORAGE_CATALINA_GOBY = 900;
export const FORAGE_SHOWY_BRISTLEMOUTH = 901;
export const FORAGE_GLASSHEAD_GRENADIER = 902;

/** Initial ocean layout: forage fish and starting tokens.
 *  [forageId, row, col, startingEggs, startingYoung] */
export const INITIAL_OCEAN: [number, number, number, number, number][] = [
  // Catalina Goby — purple dive site, middle sunlight row. Starts with 1 young.
  [FORAGE_CATALINA_GOBY, 1, 1, 0, 1],
  // Showy Bristlemouth — purple dive site, twilight row. Starts with 1 egg.
  [FORAGE_SHOWY_BRISTLEMOUTH, 3, 1, 1, 0],
  // Glasshead Grenadier — blue dive site, upper midnight row. Starts with 1 egg.
  [FORAGE_GLASSHEAD_GRENADIER, 4, 0, 1, 0],
];

/** Printed dive-site bonuses per column. `zones` are the checkpoint benefits
 *  (sunlight top, above twilight, above midnight) granted when the site has
 *  >=1 fish in that zone; `bottom` is the once-per-week bonus for the first
 *  diver reaching the bottom of that site. */
export const DIVE_BONUSES: { zones: [Benefit, Benefit, Benefit]; bottom: Benefit }[] = [
  // Blue site (left): draw cards; bottom = recover a card from your discard pile.
  { zones: ['drawCard', 'drawCard', 'drawCard'], bottom: 'recoverCard' },
  // Purple site (center): eggs; bottom = 1 egg.
  { zones: ['egg', 'egg', 'egg'], bottom: 'egg' },
  // Green site (right): hatch eggs / move young & schools; bottom = move.
  { zones: ['hatch', 'hatch', 'move'], bottom: 'move' },
];

/** S&R: each dive site may hold at most 6 coral. */
export const MAX_CORAL = 6;

/** S&R: end-game bonus points for a complete reef (6 coral) per site. */
export const REEF_COMPLETION_BONUS = [6, 8, 5]; // blue, purple, green

/** S&R: the item each dive site's reef section asks you to discard to place
 *  1 coral during a dive — blue = egg, purple = young, green = card. */
export const REEF_DISCARD_ITEMS: ('egg' | 'young' | 'card')[] = ['egg', 'young', 'card'];

/** Points each school token is worth at the end of the game. */
export const SCHOOL_POINTS = 6;
/** Points per consumed fish (cards and forage). */
export const CONSUMED_POINTS = 1;
/** Points per egg and per young. */
export const TOKEN_POINTS = 1;
/** S&R: points per coral token. */
export const CORAL_POINTS = 1;

/** Young on one slot that instantly form a school. */
export const SCHOOL_SIZE = 3;

/** Cards dealt at setup: 2 starter fish + 3 main fish per player. */
export const SETUP_STARTER_CARDS = 2;
export const SETUP_MAIN_CARDS = 3;
