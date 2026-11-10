// Official Wingspan Automa solo mode (Base + European, Oceania, Asia, Americas).

import { bird, BONUS_BY_ID, BONUS_CARDS, goalTile, hummingbird } from './cards';
import { HUM_LADDER } from './constants';
import { DUET_MAP, duetCriterionMatch, duetNeighbors } from './duetMap';
import type {
  AutomaCard,
  AutomaDifficulty,
  BirdCard,
  DieFace,
  FoodCost,
  FoodType,
  GameState,
  HumGroup,
} from './types';
import { BASE_FOODS, HUM_GROUPS } from './types';

// === Automa decision deck (10 base cards + 1 expert card: Automubon Society) ===

const ORDER_A: DieFace[] = ['split', 'fruit', 'fish', 'seed', 'invertebrate', 'rodent'];
const ORDER_B: DieFace[] = ['rodent', 'invertebrate', 'seed', 'fish', 'fruit', 'split'];
const ORDER_C: DieFace[] = ['invertebrate', 'seed', 'fruit', 'fish', 'rodent', 'split'];
const ORDER_D: DieFace[] = ['seed', 'invertebrate', 'fish', 'fruit', 'split', 'rodent'];
const ORDER_E: DieFace[] = ['fish', 'rodent', 'split', 'invertebrate', 'seed', 'fruit'];
const ORDER_F: DieFace[] = ['fruit', 'split', 'rodent', 'fish', 'seed', 'invertebrate'];

export const AUTOMA_CARDS: AutomaCard[] = [
  {
    id: 1,
    removeAfterRound: 1,
    rounds: [
      [{ kind: 'drawCards' }, { kind: 'placeGoalCube' }],
      [{ kind: 'gainFood', order: ORDER_C }, { kind: 'activatePink' }],
      [{ kind: 'playBird' }, { kind: 'layEggs', count: 1 }],
      [{ kind: 'layEggs', count: 3 }, { kind: 'placeGoalCube' }],
    ],
  },
  {
    id: 2,
    removeAfterRound: 2,
    rounds: [
      [{ kind: 'layEggs', count: 1 }, { kind: 'placeGoalCube' }],
      [{ kind: 'drawCards' }, { kind: 'placeGoalCube' }],
      [{ kind: 'gainFood', order: ORDER_D }, { kind: 'activatePink' }],
      [{ kind: 'playBird' }, { kind: 'layEggs', count: 2 }],
    ],
  },
  {
    id: 3,
    removeAfterRound: 3,
    rounds: [
      [{ kind: 'gainFood', order: ORDER_E }, { kind: 'activatePink' }],
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
      [{ kind: 'drawCards' }, { kind: 'placeGoalCube' }],
      [{ kind: 'gainFood', order: ORDER_F }, { kind: 'placeGoalCube' }],
    ],
  },
  {
    // Pictured on bird_automa_p01.png
    id: 4,
    removeAfterRound: null,
    rounds: [
      [{ kind: 'layEggs', count: 1 }],
      [{ kind: 'gainFood', order: ORDER_A }, { kind: 'activatePink' }],
      [{ kind: 'layEggs', count: 3 }, { kind: 'removeGoalCube' }],
      [{ kind: 'drawCards' }, { kind: 'removeGoalCube' }],
    ],
  },
  {
    // Pictured on bird_automa_p03.png
    id: 5,
    removeAfterRound: null,
    rounds: [
      [{ kind: 'playBird' }],
      [{ kind: 'layEggs', count: 2 }, { kind: 'removeGoalCube' }],
      [{ kind: 'drawCards' }, { kind: 'removeGoalCube' }],
      [{ kind: 'gainFood', order: ORDER_B }, { kind: 'activatePink' }],
    ],
  },
  {
    id: 6,
    removeAfterRound: null,
    rounds: [
      [{ kind: 'drawCards' }],
      [{ kind: 'playBird' }, { kind: 'layEggs', count: 1 }],
      [{ kind: 'gainFood', order: ORDER_A }, { kind: 'placeGoalCube' }],
      [{ kind: 'layEggs', count: 3 }, { kind: 'activatePink' }],
    ],
  },
  {
    id: 7,
    removeAfterRound: null,
    rounds: [
      [{ kind: 'gainFood', order: ORDER_B }, { kind: 'placeGoalCube' }],
      [{ kind: 'layEggs', count: 2 }, { kind: 'activatePink' }],
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
      [{ kind: 'playBird' }, { kind: 'layEggs', count: 1 }],
    ],
  },
  {
    id: 8,
    removeAfterRound: null,
    rounds: [
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
      [{ kind: 'drawCards' }],
      [{ kind: 'layEggs', count: 2 }, { kind: 'activatePink' }],
      [{ kind: 'gainFood', order: ORDER_C }, { kind: 'placeGoalCube' }],
    ],
  },
  {
    id: 9,
    removeAfterRound: null,
    rounds: [
      [{ kind: 'gainFood', order: ORDER_D }],
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
      [{ kind: 'playBird' }, { kind: 'layEggs', count: 2 }],
      [{ kind: 'drawCards' }, { kind: 'placeGoalCube' }],
    ],
  },
  {
    id: 10,
    removeAfterRound: null,
    rounds: [
      [{ kind: 'drawCards' }, { kind: 'activatePink' }],
      [{ kind: 'gainFood', order: ORDER_E }, { kind: 'placeGoalCube' }],
      [{ kind: 'gainFood', order: ORDER_F }, { kind: 'placeGoalCube' }],
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
    ],
  },
  {
    id: 11,
    name: 'Automubon Society',
    removeAfterRound: null,
    expert: true,
    rounds: [
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
      [{ kind: 'playBird' }, { kind: 'placeGoalCube' }],
    ],
  },
];

export const AUTOMA_CARD_BY_ID = new Map<number, AutomaCard>(
  AUTOMA_CARDS.map((c) => [c.id, c]),
);

export function automaCard(id: number): AutomaCard {
  const c = AUTOMA_CARD_BY_ID.get(id);
  if (!c) throw new Error(`unknown Automa card ${id}`);
  return c;
}

/** Initial Automa deck card IDs (10 base cards + optional 11th Automubon Society). */
export function automaDeckIds(automubonSociety = false): number[] {
  return AUTOMA_CARDS.filter((c) => !c.expert || automubonSociety).map((c) => c.id);
}

/** Points per face-down bird by difficulty level (Eaglet=3, Eagle=4, Eagle-eyed=5). */
export function automaFaceDownVp(difficulty: AutomaDifficulty): number {
  switch (difficulty) {
    case 'eaglet':
      return 3;
    case 'eagle':
      return 4;
    case 'eagleEyed':
      return 5;
  }
}

// === Bonus card eligibility & bird matching ===

/** Bonus cards excluded from Automa's setup draw (not single-card `% of cards`
 *  bonuses, or explicitly excluded by the Automa rulebook: Breeding Manager &
 *  Backyard Birder). */
const AUTOMA_INELIGIBLE_BONUS_IDS = new Set<number>([
  1001, // Backyard Birder (explicitly excluded by Automa rulebook)
  1006, // Breeding Manager (explicitly excluded by Automa rulebook)
  1008, // Citizen Scientist (depends on tucked cards in play, not printed card)
  1031, // [Fan Made] Caprimulgiform Specialist
  1036, // Mechanical Engineer (sets of 4 nest types, not a single-card criterion)
]);

/** True when `bonusCardId` can be drawn by the Automa from the standard bonus deck. */
export function isAutomaBonusEligible(bonusCardId: number): boolean {
  const b = BONUS_BY_ID.get(bonusCardId);
  if (!b) return false;
  if (b.name.startsWith('[automa]')) return false;
  if (AUTOMA_INELIGIBLE_BONUS_IDS.has(bonusCardId)) return false;
  // Asia `% of cards` bonus cards (Endangered Species Protector 1040, Small Clutch Specialist 1046).
  if (bonusCardId === 1040 || bonusCardId === 1046) return true;
  return Boolean((b as { automa?: boolean }).automa);
}

export function automaBonusCardsInSets(sets: string[]): number[] {
  return BONUS_CARDS.filter((b) => sets.includes(b.set) && isAutomaBonusEligible(b.id)).map(
    (b) => b.id,
  );
}

function costTotal(cost: FoodCost): number {
  if (cost.kind === 'none') return 0;
  if (cost.kind === 'any') return cost.count;
  if (cost.kind === 'or') return 1;
  return cost.items.reduce((n, i) => n + i.count, 0);
}

/** Does `card` satisfy the Automa's bonus card requirement? */
export function birdMatchesAutomaBonus(
  card: BirdCard,
  bonusCardId: number,
  difficulty: AutomaDifficulty = 'eagle',
): boolean {
  const b = BONUS_BY_ID.get(bonusCardId);
  if (!b) return false;
  if (card.bonusFlags.includes(b.name)) return true;

  switch (b.name) {
    case 'Omnivore Specialist':
      return (
        card.cost.kind === 'any' ||
        (card.cost.kind === 'and' && card.cost.items.some((i) => i.food === 'any'))
      );
    case 'Diet Specialist':
      return costTotal(card.cost) === 3;
    case 'Small Clutch Specialist':
      return card.eggLimit <= 2;
    case 'Endangered Species Protector':
      return card.bonusPower;
    case 'Citizen Scientist':
      return card.flocking;
    case 'Backyard Birder':
      return card.points < 4;
    case '[automa] Autwitcher':
      return card.points === 3 || card.points === 4;
    case '[automa] RASPB Life Fellow':
      return card.points >= 5 && card.points <= 7;
    case '[automa] Avid Asian Avian Admirer': {
      const lo = difficulty === 'eaglet' ? 2 : difficulty === 'eagle' ? 3 : 4;
      return card.points === lo || card.points === lo + 1;
    }
    case '[automa] Rare Species Lister': {
      const lo = difficulty === 'eaglet' ? 4 : difficulty === 'eagle' ? 5 : 6;
      return card.points >= lo && card.points <= lo + 2;
    }
    case '[automa] Charm Champion':
      return (
        card.name.toLowerCase().includes('hummingbird') ||
        (card.powerText?.toLowerCase().includes('hummingbird') ?? false)
      );
    default:
      return false;
  }
}

/** Select which matching tray cards the Automa keeps face-up vs discards during
 *  its "Play a Bird" action. Standard bonus cards keep 1 card with the highest
 *  printed VP and discard the remaining matching tray cards. */
export function selectAutomaTrayBirds(
  tray: (number | null)[],
  bonusCardId: number,
  difficulty: AutomaDifficulty = 'eagle',
): { keep: number[]; discard: number[]; matchedIndices: number[] } {
  const matched: { id: number; index: number; points: number }[] = [];
  tray.forEach((id, index) => {
    if (id != null && birdMatchesAutomaBonus(bird(id), bonusCardId, difficulty)) {
      matched.push({ id, index, points: bird(id).points });
    }
  });
  if (matched.length === 0) {
    return { keep: [], discard: [], matchedIndices: [] };
  }
  const b = BONUS_BY_ID.get(bonusCardId);
  const preferLowest =
    b?.name === '[automa] Avid Asian Avian Admirer' ||
    b?.name === '[automa] Rare Species Lister';
  const keepCount =
    b?.name === '[automa] Autwitcher' || b?.name === '[automa] Avid Asian Avian Admirer'
      ? 2
      : 1;

  const sorted = [...matched].sort((a, c) =>
    preferLowest ? a.points - c.points || a.index - c.index : c.points - a.points || a.index - c.index,
  );
  const keep = sorted.slice(0, keepCount).map((m) => m.id);
  const discard = sorted.slice(keepCount).map((m) => m.id);
  const matchedIndices = matched.map((m) => m.index);
  return { keep, discard, matchedIndices };
}

// === End-of-Round Goal Base Values (Rounds 1..4) ===

export const AUTOMA_GOAL_BASE: Record<number, [number, number, number, number]> = {
  // Core goal tiles
  2000: [1, 1, 2, 3], // [bird] in [forest]
  2001: [1, 1, 2, 3], // [bird] in [grassland]
  2002: [1, 1, 2, 3], // [bird] in [wetland]
  2007: [0, 1, 2, 2], // [bowl] [bird] with [egg]
  2009: [0, 1, 2, 2], // [cavity] [bird] with [egg]
  2010: [1, 3, 4, 5], // [egg] in [bowl]
  2011: [1, 3, 4, 5], // [egg] in [cavity]
  2012: [1, 3, 4, 5], // [egg] in [forest]
  2013: [1, 3, 4, 5], // [egg] in [grassland]
  2014: [1, 3, 4, 5], // [egg] in [ground]
  2015: [1, 3, 4, 5], // [egg] in [platform]
  2016: [1, 3, 4, 5], // [egg] in [wetland]
  2017: [0, 1, 2, 2], // [ground] [bird] with [egg]
  2018: [0, 1, 2, 2], // [platform] [bird] with [egg]
  2023: [-1, 0, 0, 1], // sets of [egg][egg][egg] in [wetland][grassland][forest]
  2024: [3, 5, 8, 10], // total [bird]

  // European expansion goal tiles
  2003: [2, 2, 3, 4], // [bird] in one row
  2004: [2, 3, 4, 4], // [bird] with no [egg]
  2005: [0, 1, 2, 3], // [bird] worth >4 [feather]
  2006: [0, 1, 2, 2], // birds with tucked cards
  2008: [2, 2, 3, 3], // [card] in hand
  2019: [1, 1, 1, 1], // [wild] in personal supply
  2020: [2, 4, 6, 7], // brown powers
  2021: [0, 0, 1, 2], // filled columns
  2022: [4, 8, 12, 16], // food cost of played [bird]
  2025: [0, 1, 2, 3], // white & no powers

  // Oceania expansion goal tiles
  2026: [2, 2, 2, 2], // cubes on "play a bird"
  2027: [1, 2, 4, 5], // beak pointing left
  2028: [1, 2, 4, 5], // beak pointing right
  2029: [2, 3, 5, 6], // [bird] worth <=3 [feather]
  2030: [1, 3, 4, 6], // [fruit] + [seed] in food cost
  2031: [1, 3, 4, 6], // [invertebrate] in food cost
  2032: [0, 1, 2, 3], // [rodent] + [fish] in food cost
  2033: [0, 0, 0, 0], // no goal

  // Asia Duet goal tiles
  2034: [1, 2, 3, 4], // [duet_token] in [forest]
  2035: [1, 2, 3, 4], // [duet_token] in [grassland]
  2036: [1, 2, 3, 4], // [duet_token] in [wetland]
  2037: [1, 2, 2, 3], // [duet_token] in any one horizontal row
  2038: [1, 2, 3, 4], // [duet_token] not on edge of map
  2039: [1, 2, 3, 4], // [duet_token] on nest spaces
  2040: [1, 2, 3, 4], // [duet_token] on food spaces
  2041: [1, 2, 3, 5], // [duet_token] on edge of map
  2042: [0, 2, 4, 6], // [duet_token] on pairs of matching symbols
  2043: [1, 1, 2, 2], // fewest [duet_token] on bonus spaces
  2044: [1, 2, 3, 4], // horizontal rows with >=1 [duet_token]
  2045: [2, 4, 6, 8], // total [duet_token] on map

  // Americas expansion goal tiles
  2046: [1, 3, 4, 5], // Birds worth EVEN points
  2047: [1, 2, 4, 5], // Birds worth ODD points
  2048: [2, 4, 5, 6], // Different point values on birds
  2049: [1, 3, 6, 10], // Hummingbird Points
  2050: [6, 12, 18, 24], // Total of egg limits
  2051: [1, 2, 3, 4], // [bee]
  2052: [1, 2, 3, 4], // [brilliant]
  2053: [1, 2, 3, 4], // [emerald]
  2054: [1, 2, 3, 4], // [mango]
  2055: [1, 2, 3, 4], // [topaz]
};

/** Base value for `tileId` in `round` (0-indexed: 0..3). */
export function automaGoalBase(tileId: number, round: number): number {
  const r = Math.max(0, Math.min(3, round));
  const row = AUTOMA_GOAL_BASE[tileId];
  if (row) return row[r]!;
  const tile = goalTile(tileId);
  switch (tile.goal.kind) {
    case 'birdsInHabitat':
      return [1, 1, 2, 3][r]!;
    case 'eggsInHabitat':
    case 'eggsInNest':
      return [1, 3, 4, 5][r]!;
    case 'nestBirdsWithEggs':
      return [0, 1, 2, 2][r]!;
    case 'totalBirds':
      return [3, 5, 8, 10][r]!;
    case 'setsOfThreeEggs':
      return [-1, 0, 0, 1][r]!;
    case 'noGoal':
      return 0;
    default:
      return [1, 2, 3, 4][r]!;
  }
}

/** Total goal units the Automa scores at the end of the current round:
 *  `automaGoalBase(tileId, round) + automa.goalCubes` (capped at 5 for
 *  `birdsInHabitat`, and 0 when `<= 0`). */
export function automaGoalScore(state: GameState, tileId: number): number {
  const tile = goalTile(tileId);
  if (tile.goal.kind === 'noGoal') return 0;
  const raw = automaGoalBase(tileId, state.round) + (state.automa?.goalCubes ?? 0);
  if (raw <= 0) return 0;
  if (tile.goal.kind === 'birdsInHabitat' || tile.goal.kind === 'birdsInOneRow') {
    return Math.min(5, raw);
  }
  return raw;
}

// === Expansion helpers for Automa turns ===

function cardFoods(card: BirdCard): FoodType[] {
  if (card.cost.kind === 'none') return [];
  if (card.cost.kind === 'any') return [...BASE_FOODS];
  if (card.cost.kind === 'or') return card.cost.foods.filter((f) => f !== 'nectar');
  const out: FoodType[] = [];
  for (const item of card.cost.items) {
    if (item.food === 'any' || item.food === 'nectar') return [...BASE_FOODS];
    out.push(item.food);
  }
  return out;
}

/** Asia Duet Automa: place 1 Automa duet token on the Duet map when the Automa
 *  plays a bird. Prefers unclaimed spaces matching the bird that are adjacent
 *  to existing Automa tokens (growing its contiguous group). */
export function placeAutomaDuetToken(state: GameState, cardId: number | null): GameState {
  if (!state.duet) return state;
  const map = state.duet.map;
  const automaId = state.playerOrder[1] ?? 'p2';
  const unclaimed: number[] = [];
  for (let i = 0; i < map.length; i++) {
    if (map[i] == null) unclaimed.push(i);
  }
  if (unclaimed.length === 0) return state;

  let candidates = unclaimed;
  if (cardId != null) {
    const c = bird(cardId);
    const foods = cardFoods(c);
    const matching = unclaimed.filter((i) => {
      const sp = DUET_MAP[i]!;
      return c.habitats.includes(sp.habitat) && duetCriterionMatch(sp.criterion, c, foods);
    });
    if (matching.length > 0) candidates = matching;
  }

  // Score candidate spaces: adjacent to existing Automa tokens > bonus space > index.
  const scoreSpace = (i: number): number => {
    const adjAutoma = duetNeighbors(i).filter((n) => map[n] === automaId).length;
    const bonus = DUET_MAP[i]!.bonus != null ? 1 : 0;
    return adjAutoma * 10 + bonus;
  };
  candidates.sort((a, b) => scoreSpace(b) - scoreSpace(a) || a - b);
  const chosen = candidates[0]!;
  const nextMap = [...map];
  nextMap[chosen] = automaId;
  return { ...state, duet: { ...state.duet, map: nextMap } };
}

/** Americas Hummingbird Automa: take/discard the top hummingbird from a garden
 *  slot and advance the Automa's hummingbird track in that hummingbird's group. */
export function advanceAutomaHummingbird(state: GameState): GameState {
  if (!state.automa) return state;
  const automaId = state.playerOrder[1] ?? 'p2';
  let s = state;
  let group: HumGroup | null = null;

  const slotIdx = s.humGarden.findIndex((slot) => slot.length > 0);
  if (slotIdx >= 0) {
    const slot = [...s.humGarden[slotIdx]!];
    const humId = slot.pop()!;
    group = hummingbird(humId).group;
    const garden = s.humGarden.map((g, i) => (i === slotIdx ? slot : g));
    s = { ...s, humGarden: garden, humDiscard: [...s.humDiscard, humId] };
  } else {
    // Fallback: advance the lowest-positioned group on the Automa's track.
    group = [...HUM_GROUPS].sort(
      (a, b) => (s.automa!.humTrack[a] ?? 0) - (s.automa!.humTrack[b] ?? 0),
    )[0]!;
  }

  const curTrack = { ...s.automa!.humTrack };
  const maxPos = HUM_LADDER.length - 1;
  const targetGroup =
    curTrack[group] < maxPos
      ? group
      : (HUM_GROUPS.find((g) => curTrack[g] < maxPos) ?? group);
  if (curTrack[targetGroup] < maxPos) {
    curTrack[targetGroup] += 1;
  }

  return {
    ...s,
    automa: { ...s.automa!, humTrack: curTrack },
    players: s.players.map((pl) =>
      pl.id === automaId ? { ...pl, humTrack: { ...curTrack } } : pl,
    ),
  };
}
