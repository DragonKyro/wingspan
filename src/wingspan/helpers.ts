// Shared queries over GameState — used by handlers, the UI and the AI.

import * as shared from '../shared/state';
import { bird } from './cards';
import { COLUMN_EGG_COST, ROW_SIZE } from './constants';
import type {
  BirdRef,
  FoodCost,
  FoodType,
  GameState,
  Habitat,
  NestType,
  PlayedBird,
  PlayerId,
  PlayerState,
} from './types';
import { BASE_FOODS, HABITATS } from './types';

export const getPlayer: (state: GameState, playerId: PlayerId) => PlayerState = shared.getPlayer;

export function actingPlayerId(state: GameState): PlayerId {
  return state.playerOrder[state.currentPlayerIndex]!;
}

/** Every real played bird of a player, with its location. Covered spaces
 *  (ghost placeholders from sideways birds) are not birds and are skipped. */
export function playedBirds(p: PlayerState): { ref: BirdRef; bird: PlayedBird }[] {
  const out: { ref: BirdRef; bird: PlayedBird }[] = [];
  for (const h of HABITATS) {
    p.board[h].forEach((b, index) => {
      if (!b.ghost) out.push({ ref: { habitat: h, index }, bird: b });
    });
  }
  return out;
}

export function birdAt(state: GameState, playerId: PlayerId, ref: BirdRef): PlayedBird {
  const p = getPlayer(state, playerId);
  const b = p.board[ref.habitat]?.[ref.index];
  if (!b) throw new Error(`no bird at ${ref.habitat}:${ref.index} for ${playerId}`);
  return b;
}

export function sameRef(a: BirdRef, b: BirdRef): boolean {
  return a.habitat === b.habitat && a.index === b.index;
}

export function totalEggs(p: PlayerState): number {
  return playedBirds(p).reduce((n, { bird }) => n + bird.eggs, 0);
}

export function totalCached(p: PlayerState): number {
  return playedBirds(p).reduce((n, { bird }) => n + bird.cached.length, 0);
}

export function totalTucked(p: PlayerState): number {
  return playedBirds(p).reduce((n, { bird }) => n + bird.tucked.length, 0);
}

export function totalFood(p: PlayerState): number {
  return (Object.keys(p.food) as FoodType[]).reduce((n, f) => n + p.food[f], 0);
}

export function birdCount(p: PlayerState): number {
  return playedBirds(p).length;
}

/** Egg capacity remaining on a bird. */
export function eggRoom(b: PlayedBird): number {
  return Math.max(0, bird(b.cardId).eggLimit - b.eggs);
}

/** Can this bird ever hold eggs? (nest 'none' birds can't.) */
export function canHoldEggs(cardId: number): boolean {
  const c = bird(cardId);
  return c.nest !== 'none' && c.eggLimit > 0;
}

/** Can `p` place an egg on `ref`, optionally ignoring `overLimit` of the cap? */
export function eggTargetOk(p: PlayerState, ref: BirdRef, overLimit = 0): boolean {
  const b = p.board[ref.habitat]?.[ref.index];
  if (!b) return false;
  return bird(b.cardId).eggLimit + overLimit - b.eggs > 0;
}

/** Does `nest` satisfy a required nest filter? 'wild' nest counts as every type.
 *  `want` may be a list — the bird qualifies if its nest matches any entry. */
export function nestMatches(nest: NestType, want: NestType | 'any' | 'other' | NestType[]): boolean {
  if (want === 'any' || want === 'other') return true;
  if (Array.isArray(want)) return want.some((w) => nest === w) || nest === 'wild';
  return nest === want || nest === 'wild';
}

/** Birds the player may lay an egg on under `nest` filter. */
export function eggTargets(
  state: GameState,
  playerId: PlayerId,
  nest: NestType | 'any' | 'other' | NestType[],
  exclude?: BirdRef,
  overLimit = 0,
): BirdRef[] {
  const p = getPlayer(state, playerId);
  return playedBirds(p)
    .filter(({ ref, bird: b }) => {
      if (exclude && sameRef(ref, exclude)) return false;
      if (!eggTargetOk(p, ref, overLimit)) return false;
      return nestMatches(bird(b.cardId).nest, nest);
    })
    .map(({ ref }) => ref);
}

/** Targets for a chooseBirdForEgg pending step, honoring the Oceania
 *  extensions (onlyBird / adjacentTo / wingspanLt). With `onlyBird` the same
 *  ref is returned once per egg that still fits so callers may repeat it. */
export function eggStepTargets(
  state: GameState,
  step: {
    playerId: PlayerId;
    count: number;
    nest: NestType | 'any' | 'other' | NestType[];
    exclude?: BirdRef;
    overLimit?: number;
    onlyBird?: BirdRef;
    adjacentTo?: BirdRef;
    wingspanLt?: number;
    columnOf?: BirdRef;
    habitat?: Habitat;
    eggsMax?: number;
  },
): BirdRef[] {
  const p = getPlayer(state, step.playerId);
  const over = step.overLimit ?? 0;
  if (step.onlyBird) {
    const b = p.board[step.onlyBird.habitat]?.[step.onlyBird.index];
    if (!b || b.ghost || !eggTargetOk(p, step.onlyBird, over)) return [];
    const room = bird(b.cardId).eggLimit + over - b.eggs;
    return Array.from({ length: Math.min(step.count, room) }, () => step.onlyBird!);
  }
  let refs = eggTargets(state, step.playerId, step.nest, step.exclude, over);
  if (step.habitat) {
    refs = refs.filter((r) => r.habitat === step.habitat);
  }
  if (step.adjacentTo) {
    const adj = adjacentRefs(p, step.adjacentTo);
    refs = refs.filter((r) => adj.some((a) => sameRef(a, r)));
  }
  if (step.wingspanLt != null) {
    refs = refs.filter((r) => {
      const b = p.board[r.habitat]?.[r.index];
      return b != null && wingspanOf(bird(b.cardId)) < step.wingspanLt!;
    });
  }
  if (step.eggsMax != null) {
    refs = refs.filter((r) => {
      const b = p.board[r.habitat]?.[r.index];
      return b != null && b.eggs <= step.eggsMax!;
    });
  }
  if (step.columnOf) {
    // "Another bird in this column": same index, any other habitat.
    refs = refs.filter(
      (r) => r.index === step.columnOf!.index && r.habitat !== step.columnOf!.habitat,
    );
  }
  return refs;
}

/** Eggs the player can still spend from (any bird with ≥1 egg). */
export function eggSources(p: PlayerState): BirdRef[] {
  return playedBirds(p)
    .filter(({ bird: b }) => b.eggs > 0)
    .map(({ ref }) => ref);
}

/**
 * Can `food` pay `cost`? Implements the 2-for-1 rule (any 2 tokens = any 1
 * needed food) and nectar as a substitute for any specific type.
 */
export function canPayFood(food: Record<FoodType, number>, cost: FoodCost): boolean {
  return payFoodPlan(food, cost) !== null;
}

/** Reduce `cost` by 1 unit of `discount` (or 1 wild if `discount` is present). */
export function discountFoodCost(cost: FoodCost, discount?: FoodType): FoodCost {
  if (!discount || cost.kind === 'none') return cost;
  if (cost.kind === 'any') {
    return cost.count <= 1 ? { kind: 'none' } : { kind: 'any', count: cost.count - 1 };
  }
  if (cost.kind === 'or') {
    return cost.foods.includes(discount) ? { kind: 'none' } : cost;
  }
  const idx = cost.items.findIndex((i) => i.food === discount);
  if (idx < 0) return cost;
  const items = cost.items
    .map((item, i) => (i === idx ? { ...item, count: item.count - 1 } : item))
    .filter((item) => item.count > 0);
  return items.length === 0 ? { kind: 'none' } : { kind: 'and', items };
}

/** The tokens a payment uses; null when impossible (used to auto-build payments). */
export function payFoodPlan(food: Record<FoodType, number>, cost: FoodCost): FoodType[] | null {
  if (cost.kind === 'none') return [];
  const have = { ...food };
  const take = (f: FoodType, n: number) => {
    if (have[f] < n) return false;
    have[f] -= n;
    return true;
  };
  const paid: FoodType[] = [];

  if (cost.kind === 'any') {
    const total = BASE_FOODS.concat('nectar' as FoodType).reduce((n, f) => n + have[f], 0);
    if (total < cost.count) return null;
    for (const f of BASE_FOODS.concat('nectar' as FoodType)) {
      const n = Math.min(have[f], cost.count - paid.length);
      for (let i = 0; i < n; i++) paid.push(f);
      have[f] -= n;
    }
    return paid;
  }

  if (cost.kind === 'or') {
    for (const f of cost.foods) {
      if (take(f, 1)) return [f];
    }
    // Nectar is wild (Oceania): 1 nectar covers the pick-one cost directly.
    if (!cost.foods.includes('nectar') && take('nectar', 1)) return ['nectar'];
    // 2-for-1 fallback: any 2 tokens as one listed type.
    const total = (Object.keys(have) as FoodType[]).reduce((n, f) => n + have[f], 0);
    if (total < 2) return null;
    for (const f of Object.keys(have) as FoodType[]) {
      while (have[f] > 0 && paid.length < 2) {
        have[f]--;
        paid.push(f);
      }
    }
    return paid;
  }

  // 'and': satisfy specific needs (own type or nectar), then 'any' units, then 2-for-1.
  let anyNeed = 0;
  for (const item of cost.items) {
    if (item.food === 'any') {
      anyNeed += item.count;
      continue;
    }
    let need = item.count;
    const own = Math.min(have[item.food], need);
    have[item.food] -= own;
    need -= own;
    for (let i = 0; i < own; i++) paid.push(item.food);
    if (need > 0) {
      const n = Math.min(have.nectar, need);
      have.nectar -= n;
      need -= n;
      for (let i = 0; i < n; i++) paid.push('nectar');
    }
    if (need > 0) {
      // 2-for-1: spend 2 leftover tokens per missing unit.
      const cost2 = need * 2;
      const leftover = (Object.keys(have) as FoodType[]).reduce((n, f) => n + have[f], 0);
      if (leftover < cost2) return null;
      let took = 0;
      for (const f of Object.keys(have) as FoodType[]) {
        while (have[f] > 0 && took < cost2) {
          have[f]--;
          took++;
          paid.push(f);
        }
      }
    }
  }
  const leftover = (Object.keys(have) as FoodType[]).reduce((n, f) => n + have[f], 0);
  if (leftover < anyNeed) return null;
  let took = 0;
  for (const f of Object.keys(have) as FoodType[]) {
    while (have[f] > 0 && took < anyNeed) {
      have[f]--;
      took++;
      paid.push(f);
    }
  }
  return paid;
}

/** Eggs needed to play into column `col` (0-indexed). */
export function columnEggCost(col: number): number {
  return COLUMN_EGG_COST[col] ?? 0;
}

/** Eggs the player must pay to play their next bird into `habitat`: the
 *  column cost, less 1 when an Americas Rufous Hornero placeholder egg sits
 *  on that row. The single source of truth for the engine, AI, and UI. */
export function playEggCost(p: PlayerState, habitat: Habitat): number {
  const cost = columnEggCost(p.board[habitat].length);
  return cost > 0 && p.horneroEggs.includes(habitat) ? cost - 1 : cost;
}

/** The slot (column index) the next bird in `habitat` will occupy. */
export function nextSlot(p: PlayerState, habitat: Habitat): number {
  return p.board[habitat].length;
}

/** True when the habitat row is full. */
export function rowFull(p: PlayerState, habitat: Habitat): boolean {
  return p.board[habitat].length >= ROW_SIZE;
}

export function addFood(p: PlayerState, f: FoodType, n = 1): PlayerState {
  return { ...p, food: { ...p.food, [f]: p.food[f] + n } };
}

/** Record a food type gained (european "already gained this turn" powers). */
export function recordFoodGain(p: PlayerState, f: FoodType): PlayerState {
  if (p.gainedThisTurn.includes(f)) return p;
  return { ...p, gainedThisTurn: [...p.gainedThisTurn, f] };
}

/** Eggs sitting on the player's birds in `habitat` (goal/teal-power queries). */
export function eggsInHabitat(p: PlayerState, habitat: Habitat): number {
  return p.board[habitat].reduce((n, b) => n + (b.ghost ? 0 : b.eggs), 0);
}

export function spendFood(p: PlayerState, foods: FoodType[]): PlayerState {
  const food = { ...p.food };
  for (const f of foods) {
    if (food[f] <= 0) throw new Error(`cannot spend ${f}`);
    food[f]--;
  }
  return { ...p, food };
}

export function addEggs(p: PlayerState, ref: BirdRef, n: number, overLimit = 0): PlayerState {
  const row = [...p.board[ref.habitat]];
  const b = row[ref.index];
  if (!b) throw new Error('no bird at ref');
  const laid = Math.min(b.eggs + n, bird(b.cardId).eggLimit + overLimit) - b.eggs;
  row[ref.index] = {
    ...b,
    eggs: Math.min(b.eggs + n, bird(b.cardId).eggLimit + overLimit),
    eggsGainedThisTurn: (b.eggsGainedThisTurn ?? 0) + laid,
  };
  return { ...p, board: { ...p.board, [ref.habitat]: row } };
}

export function appendLog(state: GameState, msg: string): GameState {
  return { ...state, log: [...state.log, { seq: state.log.length, msg }] };
}

/** The player's leftmost empty benefit slot index for a habitat action.
 *  The Oceania mat has a sixth benefit box reached when the row is full. */
export function actionSlot(p: PlayerState, habitat: Habitat, oceania = false): number {
  return Math.min(p.board[habitat].length, oceania ? ROW_SIZE : ROW_SIZE - 1);
}

/** Does this game use the Oceania expansion (mat, nectar, cards)? */
export function isOceania(state: GameState): boolean {
  return state.settings.sets.includes('oceania');
}

/** Does this game use the Americas expansion (hummingbird subsystem)? */
export function isAmericas(state: GameState): boolean {
  return state.settings.sets.includes('americas');
}

/** Hummingbird ids sitting on the player's mat (one per row, max 3). */
export function humIdsOnMat(p: PlayerState): number[] {
  return HABITATS.map((h) => p.humBoard[h]).filter((id): id is number => id != null);
}

/** Empty benefit spaces in a habitat row, counting the hummingbird space
 *  when it is empty (americas rules: an empty hummingbird space counts as
 *  an empty space for powers that count empty spaces). */
export function emptySlots(state: GameState, p: PlayerState, habitat: Habitat): number {
  return (
    ROW_SIZE - p.board[habitat].length +
    (isAmericas(state) && p.humBoard[habitat] == null ? 1 : 0)
  );
}

/** Birds orthogonally adjacent to `ref` on the player's own mat (the slots
 *  immediately left/right and above/below — americas "adjacent" powers). */
export function adjacentRefs(p: PlayerState, ref: BirdRef): BirdRef[] {
  const hi = HABITATS.indexOf(ref.habitat);
  const out: BirdRef[] = [];
  const push = (h: Habitat, index: number) => {
    const b = p.board[h]?.[index];
    if (b && !b.ghost) out.push({ habitat: h, index });
  };
  push(ref.habitat, ref.index - 1);
  push(ref.habitat, ref.index + 1);
  if (hi > 0) push(HABITATS[hi - 1]!, ref.index);
  if (hi < HABITATS.length - 1) push(HABITATS[hi + 1]!, ref.index);
  return out;
}

/** Asia 2-player duet mode (duet map + duet goal tiles). */
export function isDuet(state: GameState): boolean {
  return state.settings.mode === 'duet';
}

/** Asia flock mode (6-7 players, flock goal board). */
export function isFlock(state: GameState): boolean {
  return state.settings.mode === 'flock';
}

/** Solo mode against the Automa (or true when `playerId` is the Automa seat). */
export function isAutoma(state: GameState, playerId?: PlayerId): boolean {
  if (!state.automa) return false;
  if (playerId == null) return true;
  return playerId === (state.playerOrder[1] ?? 'p2');
}

/** Wingspan as a number for power/bonus comparisons. Flightless birds are
 *  printed '*' — they count as 0 (see Oceania appendix: e.g. they qualify
 *  for "wingspan less than Xcm" and never for "over Xcm"). */
export function wingspanOf(card: { wingspan: number | '*' }): number {
  return typeof card.wingspan === 'number' ? card.wingspan : 0;
}

/** The player immediately after `playerId` in turn order ("to your left"). */
export function playerToLeft(state: GameState, playerId: PlayerId): PlayerId | null {
  const i = state.playerOrder.indexOf(playerId);
  if (i < 0 || state.playerOrder.length < 2) return null;
  return state.playerOrder[(i + 1) % state.playerOrder.length]!;
}

/** The player immediately before `playerId` in turn order ("to your right"). */
export function playerToRight(state: GameState, playerId: PlayerId): PlayerId | null {
  const i = state.playerOrder.indexOf(playerId);
  if (i < 0 || state.playerOrder.length < 2) return null;
  return state.playerOrder[(i - 1 + state.playerOrder.length) % state.playerOrder.length]!;
}

// === european expansion power-text predicates ===

/** Sideways bird: covers 2 habitat spaces when played (pays the lower egg cost). */
export function isSideways(card: { powerText: string | null }): boolean {
  return card.powerText?.startsWith('Place this bird sideways') ?? false;
}

/** Predator that may be played on top of another bird instead of paying costs. */
export function isCoverBird(card: { powerText: string | null }): boolean {
  return card.powerText?.startsWith('Instead of paying any costs') ?? false;
}

/** Predator that may pay 1 hand card per [rodent] in its cost (cards tuck behind it). */
export function isCardCostBird(card: { powerText: string | null }): boolean {
  return card.powerText?.startsWith('For each [rodent] in this bird') ?? false;
}

/** Round-end power: this bird counts double toward the goal when it qualifies. */
export function isGoalDouble(card: { powerText: string | null }): boolean {
  return (
    card.powerText ===
    'This bird counts double toward the end-of-round goal, if it qualifies for the goal.'
  );
}

/** Build a play-bird payment for `cardId` out of `p`'s supply, cached food on
 *  birds, and (for european card-cost predators) hand cards covering [rodent]
 *  items. Prefers supply food, then cached, then the fewest hand cards needed.
 *  Returns null when the card is unaffordable by every means. */
export function autoPayBird(
  p: PlayerState,
  cardId: number,
): {
  foodPayments: FoodType[];
  cachedFoodPayments?: { bird: BirdRef; food: FoodType }[];
  cardPayments?: number[];
} | null {
  const card = bird(cardId);
  const cached: { bird: BirdRef; food: FoodType }[] = [];
  const pool = { ...p.food };
  for (const { ref, bird: b } of playedBirds(p)) {
    for (const f of b.cached) {
      pool[f]++;
      cached.push({ bird: ref, food: f });
    }
  }
  const planFor = (cost: FoodCost) => {
    const plan = payFoodPlan(pool, cost);
    if (!plan) return null;
    const supply = { ...p.food };
    const cacheLeft = cached.slice();
    const foodPayments: FoodType[] = [];
    const cachedFoodPayments: { bird: BirdRef; food: FoodType }[] = [];
    for (const f of plan) {
      if (supply[f] > 0) {
        supply[f]--;
        foodPayments.push(f);
      } else {
        const idx = cacheLeft.findIndex((x) => x.food === f);
        if (idx < 0) return null;
        cachedFoodPayments.push(cacheLeft[idx]!);
        cacheLeft.splice(idx, 1);
      }
    }
    return { foodPayments, cachedFoodPayments };
  };
  const straight = planFor(card.cost);
  if (straight) {
    return {
      foodPayments: straight.foodPayments,
      cachedFoodPayments: straight.cachedFoodPayments.length ? straight.cachedFoodPayments : undefined,
    };
  }
  // European "1 card per [rodent]" predator: cover rodent items with hand cards.
  if (!isCardCostBird(card) || card.cost.kind !== 'and') return null;
  const others = p.hand.filter((id) => id !== cardId);
  const rodents = card.cost.items
    .filter((i) => i.food === 'rodent')
    .reduce((n, i) => n + i.count, 0);
  for (let n = 1; n <= Math.min(rodents, others.length); n++) {
    let left = n;
    const items = card.cost.items
      .map((i) => {
        if (i.food !== 'rodent') return i;
        const u = Math.min(left, i.count);
        left -= u;
        return { ...i, count: i.count - u };
      })
      .filter((i) => i.count > 0);
    const eff: FoodCost = items.length ? { kind: 'and', items } : { kind: 'none' };
    const plan = planFor(eff);
    if (plan) {
      return {
        foodPayments: plan.foodPayments,
        cachedFoodPayments: plan.cachedFoodPayments.length ? plan.cachedFoodPayments : undefined,
        cardPayments: others.slice(0, n),
      };
    }
  }
  return null;
}
