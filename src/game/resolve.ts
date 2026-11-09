// Resolves pending steps (the sub-choices powers and actions queue) and runs
// the `then` continuation tags that chain compound powers.

import { bird } from './cards';
import { finishEndOfTurnDiscards } from './actions';
import {
  addEggs,
  addFood,
  birdAt,
  eggTargets,
  getPlayer,
  payFoodPlan,
  playedBirds,
  sameRef,
  spendFood,
} from './helpers';
import {
  cacheOnBird,
  drawFromDeck,
  faceCovers,
  hasPowerImpl,
  pushPending,
  runPower,
  setPlayer,
  takeDieFromFeeder,
  tuckCardOnBird,
} from './powers';
import type {
  BirdRef,
  Choice,
  FoodType,
  GameState,
  Habitat,
  PendingStep,
  PlayerId,
  PlayedBird,
} from './types';
import { FOOD_TYPES, HABITATS } from './types';

// === feasibility pruning ===

/** Number of valid answers a pending step currently has (0 ⇒ auto-drop). */
function feasible(state: GameState, step: PendingStep): number {
  const p = getPlayer(state, step.playerId);
  switch (step.kind) {
    case 'pickDie': {
      const ok = state.feederIn.filter((f) =>
        step.faces ? step.faces.some((w) => faceCovers(f, w)) : true,
      ).length;
      return Math.min(step.count, ok);
    }
    case 'chooseSupplyFood':
      return step.count > 0 ? 1 : 0;
    case 'chooseBirdForEgg': {
      const targets = eggTargets(state, step.playerId, step.nest, step.exclude, step.overLimit ?? 0);
      if (targets.length === 0) return 0;
      return Math.min(step.count, targets.length);
    }
    case 'chooseBirdForEggDiscard': {
      const eggs = playedBirds(p).filter(
        ({ ref, bird: b }) => b.eggs > 0 && !(step.exclude && sameRef(ref, step.exclude)),
      );
      return Math.min(step.count, eggs.reduce((n, { bird: b }) => n + b.eggs, 0));
    }
    case 'chooseHandDiscard':
      return Math.min(step.count, p.hand.length);
    case 'chooseHandTuck': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      return p.hand.length > 0 && b ? 1 : 0;
    }
    case 'chooseDrawnCard':
      return step.cardIds.length;
    case 'chooseBonusCards':
      return step.cardIds.length > step.keep ? 1 : 0;
    case 'discardBonusCards':
      return Math.min(step.count, p.bonusHand.length);
    case 'moveBirdHabitat': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b) return 0;
      const card = bird(b.cardId);
      return card.habitats.some((h) => h !== step.bird.habitat && p.board[h].length < 5) ? 1 : 0;
    }
    case 'chooseFirstPlayer':
      return 1;
    case 'chooseRepeatPower': {
      const source = step.then?.bird;
      const targets = p.board[step.habitat].filter((b, i) => {
        if (source && source.habitat === step.habitat && source.index === i) return false;
        const c = bird(b.cardId);
        if (c.powerColor !== 'brown' || !c.powerText || !hasPowerImpl(c.id)) return false;
        if (step.predatorOnly && !c.predator) return false;
        return true;
      });
      return targets.length ? 1 : 0;
    }
    case 'chooseAdditionalPlay': {
      const habitat = step.habitat === 'same' ? step.sourceBird?.habitat : step.habitat;
      if (!habitat) return 0;
      if (p.board[habitat].length >= 5) return 0;
      return p.hand.some((id) => bird(id).habitats.includes(habitat)) ? 1 : 0;
    }
    case 'chooseCacheFood':
      return step.count > 0 ? 1 : 0;
    case 'chooseWildTrade':
      return Object.values(p.food).some((n) => n > 0) ? 1 : 0;
    case 'chooseCacheGained': {
      return p.board[step.bird.habitat]?.[step.bird.index] ? 1 : 0;
    }
  }
}

/** Drop pending steps that have no legal answer (their `then` goes with them). */
export function dropImpossiblePending(state: GameState): GameState {
  let s = state;
  while (s.pending.length > 0 && feasible(s, s.pending[0]!) === 0) {
    s = { ...s, pending: s.pending.slice(1) };
  }
  return s;
}

/** Clamp `count` on the head step to what the board can actually deliver. */
function clampHead(state: GameState): GameState {
  const head = state.pending[0];
  if (!head) return state;
  const avail = feasible(state, head);
  if ('count' in head && avail < head.count) {
    return { ...state, pending: [{ ...head, count: Math.max(1, avail) }, ...state.pending.slice(1)] };
  }
  return state;
}

// === the resolver ===

export function resolveChoice(state: GameState, playerId: PlayerId, choice: Choice): GameState {
  let s = dropImpossiblePending(state);
  s = clampHead(s);
  const step = s.pending[0];
  if (!step) throw new Error('nothing to resolve');
  if (step.playerId !== playerId) throw new Error('not your choice');
  s = { ...s, pending: s.pending.slice(1) };
  let lastGained: FoodType | null = null;

  switch (step.kind) {
    case 'pickDie': {
      if (choice.kind !== 'dice') throw new Error('expected dice');
      if (choice.picks.length !== step.count) throw new Error(`pick ${step.count} dice`);
      for (const pick of choice.picks) {
        const face = s.feederIn[pick.die];
        if (face == null) throw new Error('no such die');
        if (step.faces && !step.faces.some((w) => faceCovers(face, w))) {
          throw new Error('that die is not a valid choice');
        }
        const before = getPlayer(s, playerId);
        s = takeDieFromFeeder(s, playerId, pick.die, pick.take);
        const after = getPlayer(s, playerId);
        lastGained = (Object.keys(after.food) as FoodType[]).find((f) => after.food[f] > before.food[f]) ?? null;
      }
      break;
    }
    case 'chooseSupplyFood': {
      if (choice.kind !== 'supplyFood') throw new Error('expected supplyFood');
      if (choice.foods.length !== step.count) throw new Error(`choose ${step.count} foods`);
      for (const f of choice.foods) {
        if (step.options !== 'any' && !step.options.includes(f)) throw new Error(`${f} is not an option`);
      }
      if (step.cache) {
        for (const f of choice.foods) s = cacheOnBird(s, playerId, step.cache, f);
      } else {
        let p = getPlayer(s, playerId);
        for (const f of choice.foods) p = addFood(p, f);
        s = setPlayer(s, p);
      }
      break;
    }
    case 'chooseBirdForEgg': {
      if (choice.kind !== 'birds') throw new Error('expected birds');
      if (choice.birds.length > step.count) throw new Error(`at most ${step.count} birds`);
      if (!step.optional && choice.birds.length !== step.count) {
        throw new Error(`choose ${step.count} birds`);
      }
      for (const ref of choice.birds) {
        const ok = eggTargets(s, playerId, step.nest, step.exclude, step.overLimit ?? 0).some((t) =>
          sameRef(t, ref),
        );
        if (!ok) throw new Error('that bird cannot take an egg');
      }
      for (const ref of choice.birds) {
        s = setPlayer(s, addEggs(getPlayer(s, playerId), ref, 1, step.overLimit ?? 0));
      }
      break;
    }
    case 'chooseBirdForEggDiscard': {
      if (choice.kind !== 'birds') throw new Error('expected birds');
      if (choice.birds.length !== step.count) throw new Error(`choose ${step.count} birds`);
      for (const ref of choice.birds) {
        const b = birdAt(s, playerId, ref);
        if (b.eggs <= 0) throw new Error('that bird has no eggs');
        if (step.exclude && sameRef(ref, step.exclude)) throw new Error('not that bird');
      }
      for (const ref of choice.birds) {
        const p = getPlayer(s, playerId);
        const row = [...p.board[ref.habitat]];
        row[ref.index] = { ...row[ref.index]!, eggs: row[ref.index]!.eggs - 1 };
        s = setPlayer(s, { ...p, board: { ...p.board, [ref.habitat]: row } });
      }
      break;
    }
    case 'chooseHandDiscard': {
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      if (choice.cardIds.length !== step.count) throw new Error(`discard ${step.count} cards`);
      let p = getPlayer(s, playerId);
      for (const id of choice.cardIds) {
        if (!p.hand.includes(id)) throw new Error('card not in hand');
        p = { ...p, hand: p.hand.filter((x) => x !== id) };
      }
      s = { ...setPlayer(s, p), discard: [...s.discard, ...choice.cardIds] };
      break;
    }
    case 'chooseHandTuck': {
      if (choice.kind !== 'handCards' || choice.cardIds.length !== 1) throw new Error('pick 1 card');
      const p = getPlayer(s, playerId);
      const id = choice.cardIds[0]!;
      if (!p.hand.includes(id)) throw new Error('card not in hand');
      s = setPlayer(s, { ...p, hand: p.hand.filter((x) => x !== id) });
      s = tuckCardOnBird(s, playerId, step.bird, id);
      break;
    }
    case 'chooseDrawnCard': {
      if (choice.kind !== 'handCards' || choice.cardIds.length !== 1) throw new Error('pick 1 card');
      const id = choice.cardIds[0]!;
      if (!step.cardIds.includes(id)) throw new Error('not among the drawn cards');
      const p = getPlayer(s, playerId);
      s = setPlayer(s, { ...p, hand: [...p.hand, id] });
      break;
    }
    case 'chooseBonusCards': {
      if (choice.kind !== 'bonusCards') throw new Error('expected bonusCards');
      if (choice.cardIds.length !== step.keep) throw new Error(`keep ${step.keep}`);
      for (const id of choice.cardIds) {
        if (!step.cardIds.includes(id)) throw new Error('not among the drawn cards');
      }
      const discarded = step.cardIds.filter((id) => !choice.cardIds.includes(id));
      const p = getPlayer(s, playerId);
      s = {
        ...setPlayer(s, {
          ...p,
          bonusHand: [...p.bonusHand.filter((id) => !step.cardIds.includes(id)), ...choice.cardIds],
        }),
        bonusDeck: [...s.bonusDeck, ...discarded],
      };
      break;
    }
    case 'discardBonusCards': {
      if (choice.kind !== 'bonusCards') throw new Error('expected bonusCards');
      if (choice.cardIds.length !== step.count) throw new Error(`discard ${step.count}`);
      let p = getPlayer(s, playerId);
      for (const id of choice.cardIds) {
        if (!p.bonusHand.includes(id)) throw new Error('card not in hand');
        p = { ...p, bonusHand: p.bonusHand.filter((x) => x !== id) };
      }
      s = { ...setPlayer(s, p), bonusDeck: [...s.bonusDeck, ...choice.cardIds] };
      break;
    }
    case 'moveBirdHabitat': {
      if (choice.kind !== 'habitat') throw new Error('expected habitat');
      const p = getPlayer(s, playerId);
      const row = [...p.board[step.bird.habitat]];
      const b = row[step.bird.index];
      if (!b) throw new Error('bird is gone');
      const card = bird(b.cardId);
      if (!card.habitats.includes(choice.habitat)) throw new Error('cannot live there');
      if (choice.habitat === step.bird.habitat) throw new Error('pick another habitat');
      if (p.board[choice.habitat].length >= 5) throw new Error('row is full');
      row.splice(step.bird.index, 1);
      s = setPlayer(s, {
        ...p,
        board: { ...p.board, [step.bird.habitat]: row, [choice.habitat]: [...p.board[choice.habitat], b] },
      });
      break;
    }
    case 'chooseFirstPlayer': {
      if (choice.kind !== 'player') throw new Error('expected player');
      // 'gainDie': each player clockwise from the chosen one picks a die.
      const startIdx = s.playerOrder.indexOf(choice.playerId);
      if (startIdx < 0) throw new Error('unknown player');
      const steps: PendingStep[] = s.playerOrder.map((_, i) => ({
        kind: 'pickDie',
        playerId: s.playerOrder[(startIdx + i) % s.playerOrder.length]!,
        count: 1,
      }));
      s = { ...s, pending: [...steps, ...s.pending] };
      break;
    }
    case 'chooseRepeatPower': {
      if (choice.kind !== 'repeatTarget') throw new Error('expected repeatTarget');
      const target = choice.bird;
      const b = birdAt(s, playerId, target);
      if (target.habitat !== step.habitat) throw new Error('must be in the same habitat');
      const source = step.then?.bird;
      if (source && source.habitat === target.habitat && source.index === target.index) {
        throw new Error('pick another bird');
      }
      const card = bird(b.cardId);
      if (card.powerColor !== 'brown' || !card.powerText) throw new Error('not a brown power');
      if (step.predatorOnly && !card.predator) throw new Error('not a predator');
      s = runPower(s, playerId, target);
      break;
    }
    case 'chooseAdditionalPlay': {
      if (choice.kind !== 'handCards' || choice.cardIds.length !== 1) throw new Error('pick 1 card');
      const cardId = choice.cardIds[0]!;
      const habitat = step.habitat === 'same' ? step.sourceBird!.habitat : step.habitat;
      s = playAdditionalBird(s, playerId, cardId, habitat);
      break;
    }
    case 'chooseCacheFood': {
      if (choice.kind !== 'supplyFood') throw new Error('expected supplyFood');
      if (choice.foods.length > step.count) throw new Error(`at most ${step.count}`);
      if (!step.optional && choice.foods.length !== step.count) throw new Error(`choose ${step.count}`);
      for (const f of choice.foods) s = cacheOnBird(s, playerId, step.bird, f);
      break;
    }
    case 'chooseWildTrade': {
      if (choice.kind !== 'wildTrade') throw new Error('expected wildTrade');
      let p = getPlayer(s, playerId);
      if (p.food[choice.give] <= 0) throw new Error(`you don't have ${choice.give}`);
      p = addFood(spendFood(p, [choice.give]), choice.to);
      s = setPlayer(s, p);
      break;
    }
    case 'chooseCacheGained': {
      if (choice.kind !== 'boolean') throw new Error('expected boolean');
      if (choice.yes) s = cacheOnBird(s, playerId, step.bird, step.food);
      break;
    }
  }

  // Continuation tags.
  s = continueEffect(s, playerId, step, choice, lastGained);
  return dropImpossiblePending(s);
}

/** Run the `then` continuation of a resolved step. */
function continueEffect(
  state: GameState,
  playerId: PlayerId,
  step: PendingStep,
  choice: Choice,
  lastGained: FoodType | null,
): GameState {
  const tag = step.then;
  if (!tag) return state;
  let s = state;
  switch (tag.effect) {
    case 'feederGain':
      return s;
    case 'gainThenCache': {
      if (!tag.bird || !lastGained) return s;
      return pushPending(s, {
        kind: 'chooseCacheGained',
        playerId,
        bird: tag.bird,
        food: lastGained,
      });
    }
    case 'supplyFood': {
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!f) return s;
      return setPlayer(s, addFood(getPlayer(s, playerId), f));
    }
    case 'supplyFoodChoice': {
      const foods = (tag.ids ?? []).map((i) => FOOD_TYPES[i]!).filter(Boolean);
      if (!foods.length) return s;
      return pushPending(s, { kind: 'chooseSupplyFood', playerId, count: 1, options: foods });
    }
    case 'supplyWild':
      return pushPending(s, { kind: 'chooseSupplyFood', playerId, count: tag.n?.[0] ?? 1, options: 'any' });
    case 'drawCards':
      return drawFromDeck(s, playerId, tag.n?.[0] ?? 1);
    case 'selfEgg':
      if (!tag.bird) return s;
      return setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, 1));
    case 'anyEgg':
      return pushPending(s, { kind: 'chooseBirdForEgg', playerId, count: 1, nest: 'any' });
    case 'endTurnDiscardsDone':
      return finishEndOfTurnDiscards(s, playerId);
    case 'oystercatcher': {
      // ids = remaining pool before this pick; n[0] = next picker index offset.
      const picked = choice.kind === 'handCards' ? choice.cardIds[0] : undefined;
      const remaining = (tag.ids ?? []).filter((id) => id !== picked);
      const offset = tag.n?.[0] ?? 1;
      const actorIdx = s.playerOrder.indexOf(playerId);
      if (remaining.length === 0) return s;
      // If every player picked, the actor keeps the leftover.
      if (remaining.length === 1 && offset >= s.playerOrder.length) {
        const p = getPlayer(s, s.playerOrder[(actorIdx - offset + 1) % s.playerOrder.length] ?? playerId);
        return setPlayer(s, { ...p, hand: [...p.hand, remaining[0]!] });
      }
      const nextPid = s.playerOrder[(actorIdx + 1) % s.playerOrder.length]!;
      return pushPending(s, {
        kind: 'chooseDrawnCard',
        playerId: nextPid,
        cardIds: remaining,
        then: { effect: 'oystercatcher', ids: remaining, n: [offset + 1] },
      });
    }
    case 'eachPlayerDie':
    case 'repeatPower':
      return s;
    default:
      return s;
  }
}

/** Play an additional bird from a "play additional bird" power: normal food
 *  + column egg cost, no cube, when-played powers and pink triggers fire. */
function playAdditionalBird(state: GameState, playerId: PlayerId, cardId: number, habitat: 'forest' | 'grassland' | 'wetland'): GameState {
  const p = getPlayer(state, playerId);
  const card = bird(cardId);
  if (!p.hand.includes(cardId)) throw new Error('card not in hand');
  if (!card.habitats.includes(habitat)) throw new Error(`this bird can't live in the ${habitat}`);
  if (p.board[habitat].length >= 5) throw new Error('row is full');
  const slot = p.board[habitat].length;
  const eggCost = slot >= 1 ? (slot >= 3 ? 2 : 1) : 0; // columns 2-3: 1, 4-5: 2
  const paid = payFoodPlan(p.food, card.cost);
  if (!paid) throw new Error('cannot afford the food cost');
  if (eggCost > 0 && totalEggsAvail(p) < eggCost) throw new Error('not enough eggs for the column');

  let pl = spendFood(p, paid!);
  // Auto-pay eggs from birds with the most eggs.
  let need = eggCost;
  for (const h of HABITATS) {
    const row = [...pl.board[h]];
    for (let i = 0; i < row.length && need > 0; i++) {
      while (row[i]!.eggs > 0 && need > 0) {
        row[i] = { ...row[i]!, eggs: row[i]!.eggs - 1 };
        need--;
      }
    }
    pl = { ...pl, board: { ...pl.board, [h]: row } };
  }
  const nectarPaid = paid.filter((f) => f === 'nectar').length;
  if (nectarPaid > 0) {
    pl = { ...pl, nectarSpent: { ...pl.nectarSpent, [habitat]: pl.nectarSpent[habitat] + nectarPaid } };
  }
  pl = {
    ...pl,
    hand: pl.hand.filter((id) => id !== cardId),
    board: { ...pl.board, [habitat]: [...pl.board[habitat], { cardId, eggs: 0, tucked: [], cached: [] }] },
  };
  let s = setPlayer(state, pl);
  const ref: BirdRef = { habitat, index: pl.board[habitat].length - 1 };
  if ((card.powerColor === 'white' || card.powerColor === 'yellow') && card.powerText) {
    s = runPower(s, playerId, ref);
  }
  return s;
}

function totalEggsAvail(p: { board: Record<Habitat, PlayedBird[]> }): number {
  return HABITATS.reduce((n, h) => n + p.board[h].reduce((m, b) => m + b.eggs, 0), 0);
}
