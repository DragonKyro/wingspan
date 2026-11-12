// Wingspan Asia — the Duet Map.
//
// The physical map is a fixed 6×6 arrangement of spaces grouped into three
// regions: forest (top 2 rows), wetland (middle), grassland (bottom). The
// exact printed layout is not public data in this repo, so the layout below
// follows the official constraints: each region has 12 spaces with its own
// criterion mix, 3 bonus spaces granting the region's resource (forest = food
// die, grassland = egg, wetland = card), and edge/interior spaces for the
// goal tiles. The criterion counts per region match the official map:
//   forest:    bowl×2, cavity×2, platform, seed, fruit, invertebrate×2, rodent,
//              wingspan<50, beak-left
//   wetland:   platform×2, ground×2, cavity, fish×2, invertebrate, seed,
//              beak-left, beak-right, wingspan≥50
//   grassland: bowl, cavity, ground, seed×2, invertebrate×2, fruit, rodent,
//              wingspan<50, wingspan≥50, beak-right
// (Counts from the rulebook's duet-mode section and the published map image.)

import type { BirdCard, DuetCriterion, DuetSpace, FoodType, Habitat } from './types';
import { BASE_FOODS } from './types';
import { wingspanOf } from './helpers';

const N = (nest: 'bowl' | 'cavity' | 'ground' | 'platform'): DuetCriterion => ({ type: 'nest', nest });
const F = (food: 'invertebrate' | 'seed' | 'fish' | 'fruit' | 'rodent'): DuetCriterion => ({
  type: 'food',
  food,
});
const WS = (lt50: boolean): DuetCriterion => ({ type: 'wingspan', lt50 });
const BEAK = (left: boolean): DuetCriterion => ({ type: 'beak', left });

type GridEntry = { h: Habitat; c: DuetCriterion; b?: 'food' | 'egg' | 'card' };

/** Exact 6×6 Duet Map layout from the Wingspan Asia rulebook (pages 1, 10, 14):
 *  forest (green, upper-left), wetland (blue, lower-left), grassland (yellow, right),
 *  with the printed food/egg/card bonus spaces at their exact coordinates. */
const GRID: GridEntry[][] = [
  [
    { h: 'forest', c: N('cavity'), b: 'food' },
    { h: 'forest', c: WS(true), b: 'card' },
    { h: 'forest', c: F('seed') },
    { h: 'forest', c: N('platform') },
    { h: 'forest', c: N('bowl'), b: 'egg' },
    { h: 'grassland', c: WS(false) },
  ],
  [
    { h: 'forest', c: F('fruit') },
    { h: 'forest', c: F('invertebrate') },
    { h: 'forest', c: N('cavity') },
    { h: 'forest', c: F('invertebrate') },
    { h: 'forest', c: BEAK(true), b: 'egg' },
    { h: 'grassland', c: F('rodent'), b: 'card' },
  ],
  [
    { h: 'wetland', c: N('platform') },
    { h: 'forest', c: F('rodent') },
    { h: 'forest', c: N('bowl'), b: 'food' },
    { h: 'wetland', c: BEAK(true) },
    { h: 'grassland', c: F('invertebrate') },
    { h: 'grassland', c: N('cavity') },
  ],
  [
    { h: 'wetland', c: N('platform'), b: 'card' },
    { h: 'wetland', c: F('fish') },
    { h: 'wetland', c: F('seed'), b: 'card' },
    { h: 'wetland', c: BEAK(false) },
    { h: 'grassland', c: N('ground') },
    { h: 'grassland', c: F('invertebrate') },
  ],
  [
    { h: 'wetland', c: N('ground'), b: 'egg' },
    { h: 'wetland', c: WS(false) },
    { h: 'wetland', c: N('cavity') },
    { h: 'grassland', c: WS(true) },
    { h: 'grassland', c: N('bowl') },
    { h: 'grassland', c: F('fruit'), b: 'card' },
  ],
  [
    { h: 'wetland', c: F('fish'), b: 'card' },
    { h: 'wetland', c: WS(false), b: 'food' },
    { h: 'wetland', c: F('invertebrate') },
    { h: 'grassland', c: F('seed') },
    { h: 'grassland', c: BEAK(false) },
    { h: 'grassland', c: F('seed'), b: 'food' },
  ],
];

export const DUET_MAP: DuetSpace[] = GRID.flatMap((row) =>
  row.map((e) => ({ habitat: e.h, criterion: e.c, bonus: e.b ?? null })),
);

// === geometry ===

export const DUET_ROWS = 6;
export const DUET_COLS = 6;
const rowOf = (i: number) => Math.floor(i / DUET_COLS);
const colOf = (i: number) => i % DUET_COLS;

/** Hex-grid neighbours in a 6×6 staggered (odd-r) layout. */
export function duetNeighbors(i: number): number[] {
  const r = rowOf(i);
  const c = colOf(i);
  const odd = r % 2 === 1;
  const out: number[] = [];
  const push = (rr: number, cc: number) => {
    if (rr >= 0 && rr < DUET_ROWS && cc >= 0 && cc < DUET_COLS) out.push(rr * DUET_COLS + cc);
  };
  push(r, c - 1);
  push(r, c + 1);
  push(r - 1, odd ? c : c - 1);
  push(r - 1, odd ? c + 1 : c);
  push(r + 1, odd ? c : c - 1);
  push(r + 1, odd ? c + 1 : c);
  return out;
}

/** Edge spaces (outer ring) — used by the "on edge" / "not on edge" goals. */
export function duetIsEdge(i: number): boolean {
  return rowOf(i) === 0 || rowOf(i) === DUET_ROWS - 1 || colOf(i) === 0 || colOf(i) === DUET_COLS - 1;
}

// === matching ===

/** Does `card` (played into `habitat`, with `foods` actually spent on its
 *  cost) qualify for the space's symbol? */
export function duetCriterionMatch(
  criterion: DuetCriterion,
  card: BirdCard,
  foods: FoodType[],
): boolean {
  switch (criterion.type) {
    case 'nest':
      return card.nest === criterion.nest || card.nest === 'wild';
    case 'food':
      return foods.includes(criterion.food);
    case 'wingspan':
      if (card.wingspan === '*') return true;
      return criterion.lt50 ? wingspanOf(card) < 50 : wingspanOf(card) >= 50;
    case 'beak':
      // Common Loon (id 91) depicts two birds facing opposite directions.
      if (card.id === 91) return true;
      return card.beakLeft === criterion.left;
  }
}

/** The food types a just-played bird may claim on food-symbol spaces: the
 *  food types it eats that were actually paid (2-for-1 / nectar-wild count as
 *  the required food, so all listed types qualify when a substitute was used).
 *  Per Asia p.14: nectar spent as wild counts as the food it replaced; nectar
 *  spent for a required nectar cost counts as any food on the Duet map. */
export function duetFoodsFor(card: BirdCard, paid: FoodType[]): FoodType[] {
  const cost = card.cost;
  if (cost.kind === 'none') return [];
  const paidBase = [...new Set(paid.filter((f) => f !== 'nectar'))];
  const paidNectar = paid.includes('nectar');
  if (cost.kind === 'any') return paidNectar ? [...BASE_FOODS] : paidBase;
  if (cost.kind === 'or') {
    if (paidNectar) {
      return cost.foods.includes('nectar')
        ? [...BASE_FOODS]
        : cost.foods.filter((f) => f !== 'nectar');
    }
    const hit = paidBase.filter((f) => cost.foods.includes(f));
    if (hit.length > 0) return hit;
    return cost.foods.includes('nectar') ? [...BASE_FOODS] : cost.foods.slice();
  }
  if (cost.items.some((i) => i.food === 'nectar')) return [...BASE_FOODS];
  const hasAny = cost.items.some((i) => i.food === 'any');
  if (hasAny && paidNectar) return [...BASE_FOODS];
  const listed = cost.items
    .filter((i) => i.food !== 'any' && i.food !== 'nectar')
    .map((i) => i.food as FoodType);
  return hasAny ? [...new Set([...listed, ...paidBase])] : listed;
}

/** Spaces where the player's token may be placed for this bird. */
export function duetEligibleSpaces(
  map: (string | null)[],
  card: BirdCard,
  habitat: Habitat,
  foods: FoodType[],
): number[] {
  return DUET_MAP.map((s, i) => ({ s, i }))
    .filter(
      ({ s, i }) =>
        map[i] == null && s.habitat === habitat && duetCriterionMatch(s.criterion, card, foods),
    )
    .map(({ i }) => i);
}

// === duet goal tiles ===

/** The six double-sided duet goal tiles (goals.json ids). */
export const DUET_TILE_PAIRS: [number, number][] = [
  [2034, 2042], // forest ↔ symbol pairs
  [2035, 2045], // grassland ↔ total tokens
  [2036, 2043], // wetland ↔ fewest on bonus
  [2037, 2044], // most in one row ↔ rows with ≥1
  [2038, 2041], // interior ↔ edge
  [2039, 2040], // nest spaces ↔ food spaces
];

/** Points the round-goal winner takes in duet mode (rounds 1-4). */
export const DUET_GOAL_POINTS = [2, 3, 4, 5];

/** Goal tiles where FEWER tokens wins ("fewest on bonus spaces"). */
export const DUET_LOWER_IS_BETTER = new Set([2043]);

/** Flock-mode goal board: per round, 1st-5th place points (friendly ties). */
export const FLOCK_GOAL_POINTS = [
  [5, 2, 1, 0, 0],
  [6, 3, 2, 1, 0],
  [7, 4, 3, 2, 1],
  [8, 5, 4, 3, 2],
];
