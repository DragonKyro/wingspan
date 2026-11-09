// Fixed game constants (base-game player mat values).

import type { FoodType, Habitat } from './types';

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

/** Max birds per habitat row. */
export const ROW_SIZE = 5;

/** Setup: birds dealt, bonus cards dealt (keep 1), food (one of each base type). */
export const SETUP_BIRDS = 5;
export const SETUP_BONUS = 2;
export const SETUP_FOOD: FoodType[] = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'];

/** Blue-side goal board points by [playerCount][rank]. */
export const GOAL_POINTS: Record<number, number[]> = {
  2: [4, 1],
  3: [5, 3, 0],
  4: [6, 4, 2, 1],
  5: [6, 5, 4, 3, 2],
};

/** Feeder size. */
export const FEEDER_SIZE = 5;

export const HABITAT_OF_ACTION: Record<string, Habitat> = {
  gainFood: 'forest',
  layEggs: 'grassland',
  drawCards: 'wetland',
};
