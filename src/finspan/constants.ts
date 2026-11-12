// Board layout and scoring constants for Finspan.
//
// Verified against the official Finspan and Sharks & Reefs rulebook pages
// (fish_p01.png..p12.png, sharks_p01.png..p08.png):
//   * INITIAL_OCEAN (fish_p03.png, fish_p07.png, fish_p08.png, fish_p10.png):
//     - Catalina Goby (1 cm) at row 1, col 2 (green sunlight), starts with 1 egg.
//     - Starting young slot at row 2, col 1 (purple sunlight, open slot), starts with 1 young.
//     - Showy Bristlemouth (3 cm) at row 3, col 1 (purple twilight), starts with 0 tokens.
//     - Glasshead Grenadier (9 cm) at row 4, col 0 (blue midnight), starts with 1 egg.
//   * DIVE_BONUSES (fish_p07.png, fish_p10.png):
//     - Blue (left): zones ['drawCard', 'drawCard', 'drawCard'], bottom 'recoverCard'.
//     - Purple (center): zones ['egg', 'egg', 'egg'], bottom 'egg'.
//     - Green (right): zones ['hatch', 'hatch', 'move'], bottom 'move'.
//   * REEF_OVERLAY_SIDES (sharks_p01.png, sharks_p03.png..p06.png):
//     All 5 double-sided coral reef overlays (10 sides: 5 with coral-shaped
//     outlines, 5 with circular outlines) print ['egg', 'young', 'card'] for
//     the [blue, purple, green] dive sites, with completion bonuses [6, 8, 5].

import type { Benefit } from './types';

/** Forage pseudo-card ids (see data/fish.json). */
export const FORAGE_CATALINA_GOBY = 900;
export const FORAGE_SHOWY_BRISTLEMOUTH = 901;
export const FORAGE_GLASSHEAD_GRENADIER = 902;

/** Initial ocean layout: forage fish and starting tokens.
 *  [forageId | null, row, col, startingEggs, startingYoung] */
export const INITIAL_OCEAN: [number | null, number, number, number, number][] = [
  // Catalina Goby — green dive site, middle sunlight row. Starts with 1 egg.
  [FORAGE_CATALINA_GOBY, 1, 2, 1, 0],
  // Starting young slot — purple dive site, bottom sunlight row (open slot). Starts with 1 young.
  [null, 2, 1, 0, 1],
  // Showy Bristlemouth — purple dive site, twilight row. Starts with no tokens.
  [FORAGE_SHOWY_BRISTLEMOUTH, 3, 1, 0, 0],
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

/** S&R: end-game bonus points for a complete reef (6 coral) per site.
 *  Confirmed by the S&R rulebook: "Score 6 points for blue (left), 8 points
 *  for purple (center), and 5 points for green (right)." */
export const REEF_COMPLETION_BONUS = [6, 8, 5]; // blue, purple, green

/** S&R: the 5 double-sided coral reef overlays (10 sides total: 5 with
 *  coral-shaped token outlines, 5 with circular token outlines — see
 *  sharks_p01.png, sharks_p03.png..p06.png). Every printed overlay side shows
 *  the same per-site discard items: blue = 'egg', purple = 'young', green = 'card'. */
export const REEF_OVERLAY_SIDES: ('egg' | 'young' | 'card')[][] = Array.from(
  { length: 10 },
  () => ['egg', 'young', 'card'],
);

/** Default per-site discard items on a printed S&R coral reef overlay. */
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
