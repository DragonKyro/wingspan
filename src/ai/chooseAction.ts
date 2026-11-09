// Heuristic AI: pick the next action for `playerId`.
// Pure — no React, no store imports. Returns one Action at a time; the caller
// (AIDriver / tests) applies it via the engine and asks again.

import { bird, bonusCard } from '@/game/cards';
import {
  FOREST_DICE,
  GRASSLAND_EGGS,
  OCEANIA_FOREST_DICE,
  OCEANIA_GRASSLAND_EGGS,
  OCEANIA_WETLAND_CARDS,
  WETLAND_CARDS,
} from '@/game/constants';
import {
  actingPlayerId,
  actionSlot,
  birdCount,
  canPayFood,
  columnEggCost,
  getPlayer,
  isOceania,
  payFoodPlan,
  playedBirds,
  rowFull,
  totalFood,
} from '@/game/helpers';
import type {
  Action,
  BirdCard,
  FoodType,
  GameState,
  Habitat,
  PlayerId,
  PlayerState,
} from '@/game/types';
import { BASE_FOODS } from '@/game/types';
import { resolveHeadAction } from './choices';

// === scoring helpers ===

/** Rough worth of a bird card: points dominate; engine value from power +
 *  egg capacity and a wide habitat choice help. */
function cardValue(c: BirdCard, round: number): number {
  let v = c.points * 1.5;
  if (c.powerColor === 'brown') v += round <= 1 ? 4 : 2.5;
  else if (c.powerColor === 'pink') v += 2;
  else if (c.powerColor === 'yellow' || c.powerColor === 'white') v += 1.5;
  else if (c.powerColor === 'teal') v += round >= 2 ? 2.5 : 1;
  v += Math.min(c.eggLimit, 4) * 0.5;
  v += (c.habitats.length - 1) * 0.5;
  const cost = costUnits(c);
  v -= cost * 0.7;
  return v;
}

function costUnits(c: BirdCard): number {
  if (c.cost.kind === 'none') return 0;
  if (c.cost.kind === 'any') return c.cost.count;
  if (c.cost.kind === 'or') return 1;
  return c.cost.items.reduce((n, i) => n + i.count, 0);
}

/** Where `card` can live, preferring the habitat whose action row pays more. */
function bestHabitat(p: PlayerState, card: BirdCard): Habitat | null {
  const open = card.habitats.filter((h) => !rowFull(p, h));
  if (open.length === 0) return null;
  // Forest pays more dice with more birds; same for the others — prefer the
  // row where the bird's eggs are most needed: fewest birds so far.
  open.sort((a, b) => p.board[a].length - p.board[b].length);
  return open[0]!;
}

/** Can the player actually pay for `card` in `habitat` (food + column eggs)? */
function canPlayIn(p: PlayerState, card: BirdCard, habitat: Habitat): boolean {
  if (!canPayFood(p.food, card.cost)) return false;
  const eggsNeeded = columnEggCost(p.board[habitat].length);
  return totalEggsAvail(p) >= eggsNeeded;
}

function totalEggsAvail(p: PlayerState): number {
  return playedBirds(p).reduce((n, { bird: b }) => n + b.eggs, 0);
}

/** Build the egg payments for a column cost, spending from fattest birds. */
function eggPayments(p: PlayerState, count: number): { habitat: Habitat; index: number }[] {
  const out: { habitat: Habitat; index: number }[] = [];
  let need = count;
  const rows = [...playedBirds(p)].sort((a, b) => b.bird.eggs - a.bird.eggs);
  for (const { ref, bird: b } of rows) {
    while (b.eggs - out.filter((x) => x.habitat === ref.habitat && x.index === ref.index).length > 0 && need > 0) {
      out.push({ habitat: ref.habitat, index: ref.index });
      need--;
    }
    if (need <= 0) break;
  }
  return out;
}

// === setup ===

function setupAction(state: GameState, playerId: PlayerId): Action | null {
  if (!state.setupRemaining.includes(playerId)) return null;
  const p = getPlayer(state, playerId);
  // Keep birds we can afford to play soon: sort by value, keep the best while
  // still leaving ~2 food. Keep bonus card that matches our kept birds.
  const ranked = [...p.hand].sort((a, b) => cardValue(bird(b), 0) - cardValue(bird(a), 0));
  const keepBirds: number[] = [];
  let foodLeft = BASE_FOODS.length; // 5 base food tokens
  for (const id of ranked) {
    const c = bird(id);
    const affordableSoon = canPayFood(
      {
        invertebrate: Math.max(0, foodLeft - 1),
        seed: Math.max(0, foodLeft - 1),
        fish: Math.max(0, foodLeft - 1),
        fruit: Math.max(0, foodLeft - 1),
        rodent: Math.max(0, foodLeft - 1),
        nectar: 0,
      },
      c.cost,
    );
    if (keepBirds.length === 0 || affordableSoon) {
      keepBirds.push(id);
      foodLeft--;
    }
    if (keepBirds.length >= 3) break;
  }
  // Never keep zero birds (illegal: 5 birds kept ⇒ 0 food discarded... actually
  // keeping 0 is legal but awful); keep at least the best bird.
  if (keepBirds.length === 0) keepBirds.push(ranked[0]!);
  const discardFood = BASE_FOODS.slice(0, keepBirds.length);
  const keepBonus = bestBonusCard(p.bonusHand, keepBirds);
  return {
    type: 'keepSetup',
    playerId,
    keepBirds,
    keepBonus,
    discardFood,
  };
}

/** Which kept bonus card our kept birds already score best on. */
function bestBonusCard(ids: number[], keptBirds: number[]): number {
  // Flag coverage: a kept bird already counts toward a bonus card when its
  // flags include the card's name.
  let best = ids[0]!;
  let bestScore = -1;
  for (const id of ids) {
    const name = bonusNameOf(id);
    const score = keptBirds.filter((bid) => bird(bid).bonusFlags.includes(name)).length;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function bonusNameOf(id: number): string {
  return bonusCard(id).name;
}

// === main turn ===

function mainAction(state: GameState, playerId: PlayerId): Action | null {
  const p = getPlayer(state, playerId);
  if (p.actionCubes <= 0) return null;

  // 1. Best playable bird.
  const playable: { card: BirdCard; habitat: Habitat; value: number }[] = [];
  for (const id of p.hand) {
    const c = bird(id);
    const h = bestHabitat(p, c);
    if (h && canPlayIn(p, c, h)) {
      playable.push({ card: c, habitat: h, value: cardValue(c, state.round) });
    }
  }
  playable.sort((a, b) => b.value - a.value);

  // 2. Decide between playing and gathering.
  const birds = birdCount(p);
  const round = state.round;
  const handGood = playable.length > 0;

  // Early game: build the engine. Food gates plays; cards gate selection.
  const food = totalFood(p);
  const wantFood = playable.length === 0 ? food < 4 : false;

  if (handGood && !wantFood && (birds <= 2 || round >= 1 || playable[0]!.value > 6)) {
    const best = playable[0]!;
    const col = p.board[best.habitat].length;
    return {
      type: 'playBird',
      playerId,
      cardId: best.card.id,
      habitat: best.habitat,
      eggPayments: eggPayments(p, columnEggCost(col)),
      foodPayments: payFoodPlan(p.food, best.card.cost)!,
    };
  }

  // 3. Resource actions by need.
  const wantCards = p.hand.length <= (round >= 2 ? 1 : 2);
  if (wantFood || (!wantCards && food <= 1)) return gainFoodAction(state, playerId, p);
  if (wantCards) return drawCardsAction(state, playerId, p);
  if (handGood) {
    // Can't decide between: play the best anyway if we have the food.
    const best = playable[0]!;
    const col = p.board[best.habitat].length;
    return {
      type: 'playBird',
      playerId,
      cardId: best.card.id,
      habitat: best.habitat,
      eggPayments: eggPayments(p, columnEggCost(col)),
      foodPayments: payFoodPlan(p.food, best.card.cost)!,
    };
  }
  // Default: lay eggs (points), else draw.
  if (birds > 0) return layEggsAction(state, playerId, p);
  return drawCardsAction(state, playerId, p);
}

function gainFoodAction(state: GameState, playerId: PlayerId, p: PlayerState): Action {
  const oceania = isOceania(state);
  const slot = actionSlot(p, 'forest', oceania);
  const count = (oceania ? OCEANIA_FOREST_DICE[slot]! : FOREST_DICE[slot]!);
  const allSame =
    state.feederIn.length > 0 && state.feederIn.every((f) => f === state.feederIn[0]);
  // Indices into the live feeder shrink as dice are taken: die 0 every time
  // takes the leftmost `count` dice. `take` is only consulted for split
  // faces, so always pass one — a mid-action refill can put a split face in
  // front without the AI knowing.
  const picks = Array.from({ length: count }, () => ({ die: 0, take: 'seed' as FoodType }));
  return { type: 'gainFood', playerId, reroll: allSame || undefined, picks };
}

function layEggsAction(state: GameState, playerId: PlayerId, p: PlayerState): Action {
  const oceania = isOceania(state);
  const slot = actionSlot(p, 'grassland', oceania);
  const count = (oceania ? OCEANIA_GRASSLAND_EGGS[slot]! : GRASSLAND_EGGS[slot]!);
  // Spread eggs toward the goal tile when it cares about nests.
  const placements: { habitat: Habitat; index: number }[] = [];
  const candidates = playedBirds(p)
    .map(({ ref, bird: b }) => ({ ref, room: bird(b.cardId).eggLimit - b.eggs }))
    .filter((x) => x.room > 0)
    .sort((a, b) => a.room - b.room); // fill empties first (all birds w/ eggs bonus)
  for (const c of candidates) {
    while (placements.filter((x) => x.habitat === c.ref.habitat && x.index === c.ref.index).length < c.room && placements.length < count) {
      placements.push(c.ref);
    }
    if (placements.length >= count) break;
  }
  return { type: 'layEggs', playerId, placements };
}

function drawCardsAction(state: GameState, playerId: PlayerId, p: PlayerState): Action {
  const oceania = isOceania(state);
  const slot = actionSlot(p, 'wetland', oceania);
  const count = (oceania ? OCEANIA_WETLAND_CARDS[slot]! : WETLAND_CARDS[slot]!);
  const picks: ('deck' | number)[] = [];
  const trayRanked = state.tray
    .map((id, i) => ({ id, i }))
    .filter((x): x is { id: number; i: number } => x.id != null)
    .sort((a, b) => cardValue(bird(b.id), state.round) - cardValue(bird(a.id), state.round));
  for (const t of trayRanked) {
    if (picks.length >= count) break;
    picks.push(t.i);
  }
  while (picks.length < count) picks.push('deck');
  return { type: 'drawCards', playerId, picks };
}

// === public API ===

/** The next action the AI takes for `playerId`, or null when it has none. */
export function chooseAction(state: GameState, playerId: PlayerId): Action | null {
  // Head pending step is ours? Answer it.
  const resolve = resolveHeadAction(state, playerId);
  if (resolve) return resolve;
  if (state.pending.length > 0) return null;

  switch (state.phase) {
    case 'setup':
      return setupAction(state, playerId);
    case 'main': {
      if (actingPlayerId(state) !== playerId) return null;
      if (state.activation && state.activation.remaining.length > 0) {
        return { type: 'activatePower', playerId };
      }
      if (state.turnTookAction) {
        return { type: 'endTurn', playerId };
      }
      const action = mainAction(state, playerId);
      if (action) return action;
      return { type: 'endTurn', playerId };
    }
    case 'roundEnd':
    case 'gameEnd':
    case 'gameOver':
      return null;
  }
}
