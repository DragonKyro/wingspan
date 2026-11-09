// Fixed game constants (base-game player mat values).

import type { FoodType, Habitat, HumGroup } from './types';

/** Action cubes each player gets per round (rounds 1-4). */
export const CUBES_PER_ROUND = [8, 7, 6, 5];

/** Food gained per forest slot (leftmost empty). */
export const FOREST_DICE = [1, 1, 2, 2, 3];
/** Eggs laid per grassland slot. */
export const GRASSLAND_EGGS = [2, 2, 3, 3, 4];
/** Cards drawn per wetland slot. */
export const WETLAND_CARDS = [1, 1, 2, 2, 3];

/** Slots (0-indexed) offering the optional trade:
 *  forest — discard a bird card for +1 die
 *  grassland — pay 1 food for +1 egg
 *  wetland — discard an egg for +1 card. */
export const TRADE_SLOTS = [3, 4];

/** Egg cost to play a bird per column (0-indexed): cols 2-3 = 1, cols 4-5 = 2. */
export const COLUMN_EGG_COST = [0, 1, 1, 2, 2];

// === Oceania player mat ===
// The Oceania mat has six benefit boxes per row (the last is used when the
// row is full of birds); slot = min(row length, 5).

/** Oceania forest: dice gained per slot. */
export const OCEANIA_FOREST_DICE = [1, 2, 2, 2, 3, 3];
/** Oceania forest slots allowing "discard a bird card for +1 die". */
export const OCEANIA_FOREST_TRADE_SLOTS = [0, 2, 3, 5];
/** Oceania forest slots allowing "pay any 1 food to reset the birdfeeder". */
export const OCEANIA_FOREST_RESET_SLOTS = [1, 3];

/** Oceania grassland: eggs per slot. */
export const OCEANIA_GRASSLAND_EGGS = [1, 2, 2, 2, 3, 4];
/** Oceania grassland slots allowing a trade for +1 egg. */
export const OCEANIA_EGG_TRADE_SLOTS = [0, 2, 3, 4];
/** Oceania grassland slot allowing TWO trades (each +1 egg). */
export const OCEANIA_EGG_DOUBLE_TRADE_SLOT = 3;

/** Oceania wetland: cards per slot. */
export const OCEANIA_WETLAND_CARDS = [1, 2, 2, 2, 3, 4];
/** Oceania wetland slots allowing "discard an egg or nectar for +1 card". */
export const OCEANIA_CARD_TRADE_SLOTS = [0, 2, 3, 4];
/** Oceania wetland slots allowing "pay any 1 food to reset the tray". */
export const OCEANIA_WETLAND_RESET_SLOTS = [1, 3];

/** Oceania end-game nectar majority: points per rank within a habitat. */
export const NECTAR_POINTS = [5, 2];

/** Max birds per habitat row. */
export const ROW_SIZE = 5;

/** Setup: birds dealt, bonus cards dealt (keep 1), food (one of each base type). */
export const SETUP_BIRDS = 5;
export const SETUP_BONUS = 2;
export const SETUP_FOOD: FoodType[] = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'];

/** Green-side (ranked) goal board points by [round][rank]; 4th+ = 0. */
export const GOAL_POINTS: number[][] = [
  [4, 1],
  [5, 2, 1],
  [6, 3, 2],
  [7, 4, 3],
];

/** Feeder size. */
export const FEEDER_SIZE = 5;

export const HABITAT_OF_ACTION: Record<string, Habitat> = {
  gainFood: 'forest',
  layEggs: 'grassland',
  drawCards: 'wetland',
};

// === Americas expansion (hummingbirds) ===

/** Face-up hummingbird garden slots (each a stack; returned birds cover). */
export const HUM_GARDEN_SLOTS = 5;

/** Point values along a hummingbird track column — index is the token
 *  position, [0] is the START space. The printed per-player tracks vary
 *  slightly; the engine uses this canonical ladder for every column. */
export const HUM_LADDER = [-3, 0, 1, 2, 3, 4, 6, 8, 10];

/** Token positions (indices into HUM_LADDER) bearing a hummingbird icon:
 *  landing there grants another hummingbird action. Canonical layout. */
export const HUM_BONUS_SPACES: Record<HumGroup, number[]> = {
  bee: [3, 6],
  brilliant: [4, 7],
  emerald: [3, 6],
  mango: [4, 7],
  topaz: [3, 6],
};
