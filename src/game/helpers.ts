// Shared queries over GameState — used by handlers, the UI and the AI.

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

export function getPlayer(state: GameState, playerId: PlayerId): PlayerState {
  const p = state.players.find((pl) => pl.id === playerId);
  if (!p) throw new Error(`unknown player ${playerId}`);
  return p;
}

export function actingPlayerId(state: GameState): PlayerId {
  return state.playerOrder[state.currentPlayerIndex]!;
}

/** Every played bird of a player, with its location. */
export function playedBirds(p: PlayerState): { ref: BirdRef; bird: PlayedBird }[] {
  const out: { ref: BirdRef; bird: PlayedBird }[] = [];
  for (const h of HABITATS) {
    p.board[h].forEach((b, index) => out.push({ ref: { habitat: h, index }, bird: b }));
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
  return HABITATS.reduce((n, h) => n + p.board[h].length, 0);
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

/** Does `nest` satisfy a required nest filter? 'wild' nest counts as every type. */
export function nestMatches(nest: NestType, want: NestType | 'any' | 'other'): boolean {
  if (want === 'any' || want === 'other') return true;
  return nest === want || nest === 'wild';
}

/** Birds the player may lay an egg on under `nest` filter. */
export function eggTargets(
  state: GameState,
  playerId: PlayerId,
  nest: NestType | 'any' | 'other',
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
  row[ref.index] = { ...b, eggs: Math.min(b.eggs + n, bird(b.cardId).eggLimit + overLimit) };
  return { ...p, board: { ...p.board, [ref.habitat]: row } };
}

export function appendLog(state: GameState, msg: string): GameState {
  return { ...state, log: [...state.log, { seq: state.log.length, msg }] };
}

/** The player's leftmost empty slot index for a habitat action = birds in row. */
export function actionSlot(p: PlayerState, habitat: Habitat): number {
  return Math.min(p.board[habitat].length, ROW_SIZE - 1);
}
