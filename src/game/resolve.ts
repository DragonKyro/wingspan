// Resolves pending steps (the sub-choices powers and actions queue) and runs
// the `then` continuation tags that chain compound powers.

import { bird, BIRD_BY_ID } from './cards';
import { finishEndOfTurnDiscards } from './actions';
import {
  addEggs,
  addFood,
  appendLog,
  birdAt,
  columnEggCost,
  eggTargets,
  eggsInHabitat,
  getPlayer,
  isSideways,
  payFoodPlan,
  playedBirds,
  recordFoodGain,
  sameRef,
  spendFood,
  totalEggs,
  totalFood,
} from './helpers';
import {
  cacheOnBird,
  drawFromDeck,
  faceCovers,
  firePinkTriggers,
  hasPowerImpl,
  pushPending,
  refillFeeder,
  runPower,
  setPlayer,
  takeDieFromFeeder,
  takeTrayCard,
  tuckCardOnBird,
  tuckFromDeck,
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
      // The supply is unlimited — the full count is always feasible.
      return step.count;
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
      const habitats =
        step.habitat === 'any'
          ? HABITATS
          : [step.habitat === 'same' ? step.sourceBird?.habitat : step.habitat];
      const ok = habitats.some((habitat) => {
        if (!habitat) return false;
        if (p.board[habitat].length >= 5) return false;
        if (totalEggs(p) < columnEggCost(p.board[habitat].length)) return false;
        return p.hand.some((id) => {
          const c = bird(id);
          return c.habitats.includes(habitat) && payFoodPlan(p.food, c.cost) !== null;
        });
      });
      return ok ? 1 : 0;
    }
    case 'chooseCacheFood':
      return step.count;
    case 'chooseWildTrade':
      return Object.values(p.food).some((n) => n > 0) ? 1 : 0;
    case 'chooseCacheGained': {
      return p.board[step.bird.habitat]?.[step.bird.index] ? 1 : 0;
    }
    case 'choosePlayer':
      return step.other && state.players.length < 2 ? 0 : 1;
    case 'chooseHabitat':
      if (!step.noEggs) return 1;
      return HABITATS.some((h) => eggsInHabitat(p, h) === 0) ? 1 : 0;
    case 'chooseFoodDiscard': {
      const avail =
        step.options === 'any'
          ? totalFood(p)
          : step.options.reduce((n, f) => n + p.food[f], 0);
      return Math.min(step.count, avail);
    }
    case 'chooseFoodSteal': {
      const victim = getPlayer(state, step.from);
      if (step.food === 'any') return totalFood(victim) > 0 ? 1 : 0;
      return victim.food[step.food] > 0 ? 1 : 0;
    }
    case 'chooseTrayCard':
      return state.tray.some(
        (id) => id != null && (!step.habitat || bird(id).habitats.includes(step.habitat)),
      )
        ? 1
        : 0;
    case 'chooseDieRemove':
      return Math.min(step.count, state.feederIn.length);
    case 'chooseBirds': {
      const eligible = playedBirds(p).filter(
        ({ ref }) => !step.habitat || ref.habitat === step.habitat,
      );
      return eligible.length >= step.min ? 1 : 0;
    }
    case 'assignHandTucks': {
      if (p.hand.length === 0 || step.targets.length === 0) return 0;
      return step.targets.every((t) => {
        const b = p.board[t.habitat]?.[t.index];
        return b != null && !b.ghost;
      })
        ? 1
        : 0;
    }
    case 'chooseCacheOnBirds':
      return playedBirds(p).length > 0 ? step.count : 0;
    case 'chooseFoodType':
      return 1;
    case 'chooseOption':
      return step.options.length > 0 ? 1 : 0;
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
      // "About to gain food for any reason" — the all-same-face reroll also
      // applies to power-driven die picks.
      if (choice.reroll) {
        if (!(s.feederIn.length > 0 && s.feederIn.every((d) => d === s.feederIn[0]))) {
          throw new Error('can only reroll when all dice show the same face');
        }
        s = refillFeeder(s);
      }
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
        for (const f of choice.foods) p = recordFoodGain(addFood(p, f), f);
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
      if (choice.birds.length === 0 && step.optional) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
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
      if (choice.cardIds.length === 0 && step.optional) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
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
      if (choice.kind !== 'handCards' || choice.cardIds.length > 1) throw new Error('pick 1 card');
      if (choice.cardIds.length === 0) {
        if (!step.optional) throw new Error('pick 1 card');
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      const p = getPlayer(s, playerId);
      const id = choice.cardIds[0]!;
      if (!p.hand.includes(id)) throw new Error('card not in hand');
      s = setPlayer(s, { ...p, hand: p.hand.filter((x) => x !== id) });
      s = tuckCardOnBird(s, playerId, step.bird, id);
      s = firePinkTriggers(s, playerId, { kind: 'tuck' });
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
      if (choice.kind !== 'handCards' || choice.cardIds.length > 1) throw new Error('pick 1 card');
      if (choice.cardIds.length === 0) {
        if (!step.optional) throw new Error('pick 1 card');
        break; // declined
      }
      const cardId = choice.cardIds[0]!;
      let habitat: Habitat;
      if (step.habitat === 'same') habitat = step.sourceBird!.habitat;
      else if (step.habitat === 'any') {
        habitat = choice.habitat ?? autoPickHabitat(getPlayer(s, playerId), cardId);
      } else habitat = step.habitat;
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
    case 'choosePlayer': {
      if (choice.kind !== 'player') throw new Error('expected player');
      if (!s.playerOrder.includes(choice.playerId)) throw new Error('unknown player');
      if (step.other && choice.playerId === playerId) throw new Error('choose another player');
      break;
    }
    case 'chooseHabitat': {
      if (choice.kind !== 'habitat') throw new Error('expected habitat');
      if (step.noEggs && eggsInHabitat(getPlayer(s, playerId), choice.habitat) > 0) {
        throw new Error('that habitat has eggs on it');
      }
      break;
    }
    case 'chooseFoodDiscard': {
      if (choice.kind !== 'supplyFood') throw new Error('expected supplyFood');
      if (choice.foods.length > step.count) throw new Error(`at most ${step.count}`);
      if (choice.foods.length === 0 && step.optional) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      if (!step.optional && choice.foods.length !== step.count) {
        throw new Error(`choose ${step.count} foods`);
      }
      let pl = getPlayer(s, playerId);
      for (const f of choice.foods) {
        if (step.options !== 'any' && !step.options.includes(f)) {
          throw new Error(`${f} is not an option`);
        }
        if (pl.food[f] <= 0) throw new Error(`you don't have ${f}`);
        pl = spendFood(pl, [f]);
      }
      s = setPlayer(s, pl);
      break;
    }
    case 'chooseFoodSteal': {
      if (choice.kind !== 'supplyFood' || choice.foods.length !== 1) {
        throw new Error('pick 1 food to steal');
      }
      const f = choice.foods[0]!;
      if (step.food !== 'any' && f !== step.food) throw new Error(`must steal ${step.food}`);
      const victim = getPlayer(s, step.from);
      if (victim.food[f] <= 0) throw new Error('they do not have that food');
      s = setPlayer(s, spendFood(victim, [f]));
      s = setPlayer(s, recordFoodGain(addFood(getPlayer(s, playerId), f), f));
      break;
    }
    case 'chooseTrayCard': {
      if (choice.kind !== 'handCards' || choice.cardIds.length !== 1) {
        throw new Error('pick 1 tray card');
      }
      const cardId = choice.cardIds[0]!;
      const idx = s.tray.indexOf(cardId);
      if (idx < 0) throw new Error('that card is not on the tray');
      if (step.habitat && !bird(cardId).habitats.includes(step.habitat)) {
        throw new Error(`this bird can't live in the ${step.habitat}`);
      }
      s = takeTrayCard(s, playerId, idx);
      break;
    }
    case 'chooseDieRemove': {
      if (choice.kind !== 'dice' || choice.picks.length !== step.count) {
        throw new Error(`remove ${step.count} dice`);
      }
      for (const pick of choice.picks) {
        const face = s.feederIn[pick.die];
        if (face == null) throw new Error('no such die');
        s = {
          ...s,
          feederIn: s.feederIn.filter((_, i) => i !== pick.die),
          feederOut: [...s.feederOut, face],
        };
      }
      if (s.feederIn.length === 0) s = refillFeeder(s);
      break;
    }
    case 'chooseBirds': {
      if (choice.kind !== 'birds') throw new Error('expected birds');
      if (choice.birds.length < step.min || choice.birds.length > step.max) {
        throw new Error(`choose ${step.min}-${step.max} birds`);
      }
      const seen = new Set<string>();
      const pl = getPlayer(s, playerId);
      for (const ref of choice.birds) {
        const key = `${ref.habitat}:${ref.index}`;
        if (seen.has(key)) throw new Error('duplicate bird');
        seen.add(key);
        if (step.habitat && ref.habitat !== step.habitat) {
          throw new Error(`must be in the ${step.habitat}`);
        }
        const b = pl.board[ref.habitat]?.[ref.index];
        if (!b || b.ghost) throw new Error('no bird at that space');
      }
      break;
    }
    case 'assignHandTucks': {
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      if (choice.cardIds.length > step.targets.length) {
        throw new Error(`at most ${step.targets.length} cards`);
      }
      let pl = getPlayer(s, playerId);
      for (const id of choice.cardIds) {
        if (!pl.hand.includes(id)) throw new Error('card not in hand');
        pl = { ...pl, hand: pl.hand.filter((x) => x !== id) };
      }
      s = setPlayer(s, pl);
      for (let i = 0; i < choice.cardIds.length; i++) {
        const t = step.targets[i]!;
        const b = getPlayer(s, playerId).board[t.habitat]?.[t.index];
        if (!b || b.ghost) throw new Error('target bird is gone');
        s = tuckCardOnBird(s, playerId, t, choice.cardIds[i]!);
      }
      if (choice.cardIds.length > 0) {
        s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      }
      break;
    }
    case 'chooseCacheOnBirds': {
      if (choice.kind !== 'cacheAssign') throw new Error('expected cacheAssign');
      if (choice.items.length !== step.count) throw new Error(`assign ${step.count} caches`);
      const pl = getPlayer(s, playerId);
      for (const item of choice.items) {
        const b = pl.board[item.bird.habitat]?.[item.bird.index];
        if (!b || b.ghost) throw new Error('no bird at that space');
        if (step.food !== 'any' && item.food !== step.food) {
          throw new Error(`must cache ${step.food}`);
        }
        s = cacheOnBird(s, playerId, item.bird, item.food);
      }
      break;
    }
    case 'chooseFoodType': {
      if (choice.kind !== 'supplyFood' || choice.foods.length !== 1) {
        throw new Error('pick 1 food type');
      }
      const f = choice.foods[0]!;
      s = {
        ...s,
        players: s.players.map((x) => recordFoodGain(addFood(x, f), f)),
      };
      break;
    }
    case 'chooseOption': {
      if (choice.kind !== 'option') throw new Error('expected option');
      if (!step.options.includes(choice.option)) throw new Error('not an option');
      if (choice.option === 'gainDie') {
        s = pushPending(s, { kind: 'pickDie', playerId, count: 1 });
      } else if (choice.option === 'drawCard') {
        s = drawFromDeck(s, playerId, 1);
      } else {
        s = pushPending(s, { kind: 'chooseBirdForEgg', playerId, count: 1, nest: 'any' });
      }
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
      return setPlayer(s, recordFoodGain(addFood(getPlayer(s, playerId), f), f));
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

    // === european continuations ===
    case 'playAdditional': {
      const idx = tag.ids?.[0] ?? -1;
      const habitat = idx >= HABITATS.length ? 'any' : HABITATS[idx];
      if (!habitat) return s;
      return pushPending(s, {
        kind: 'chooseAdditionalPlay',
        playerId,
        habitat,
        optional: true,
      });
    }
    case 'selfEggs': {
      if (!tag.bird) return s;
      return setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, tag.n?.[0] ?? 1));
    }
    case 'assignTucks':
    case 'assignTucksDraw': {
      if (choice.kind !== 'birds' || choice.birds.length === 0) return s;
      return pushPending(s, {
        kind: 'assignHandTucks',
        playerId,
        targets: choice.birds,
        then: tag.effect === 'assignTucksDraw' ? { effect: 'drawIfTucked' } : undefined,
      });
    }
    case 'cacheSeedEach': {
      if (choice.kind !== 'birds') return s;
      for (const ref of choice.birds) {
        const p = getPlayer(s, playerId);
        if (p.food.seed <= 0) break;
        s = setPlayer(s, spendFood(p, ['seed']));
        s = cacheOnBird(s, playerId, ref, 'seed');
      }
      return s;
    }
    case 'drawPerTucked': {
      const n = choice.kind === 'handCards' ? choice.cardIds.length : 0;
      return n > 0 ? drawFromDeck(s, playerId, n) : s;
    }
    case 'drawIfTucked': {
      const n = choice.kind === 'handCards' ? choice.cardIds.length : 0;
      return n > 0 ? drawFromDeck(s, playerId, 1) : s;
    }
    case 'tuckChosenKeepRest': {
      // chooseDrawnCard already put the pick in hand: move it to the bird's
      // tucked cards and give the player the rest of the drawn pool.
      if (choice.kind !== 'handCards' || !tag.bird || !tag.ids) return s;
      const chosen = choice.cardIds[0];
      if (chosen == null) return s;
      const rest = tag.ids.filter((id) => id !== chosen);
      const p = getPlayer(s, playerId);
      s = setPlayer(s, { ...p, hand: [...p.hand.filter((id) => id !== chosen), ...rest] });
      s = tuckCardOnBird(s, playerId, tag.bird, chosen);
      return firePinkTriggers(s, playerId, { kind: 'tuck' });
    }
    case 'keepDiscardRest': {
      if (choice.kind !== 'handCards' || !tag.ids) return s;
      const keep = new Set(choice.cardIds);
      const rest = tag.ids.filter((id) => !keep.has(id));
      return { ...s, discard: [...s.discard, ...rest] };
    }
    case 'cachePerPredator': {
      if (choice.kind !== 'player' || !tag.bird) return s;
      const target = getPlayer(s, choice.playerId);
      const n = playedBirds(target).filter(
        ({ bird: b }) => BIRD_BY_ID.get(b.cardId)!.predator,
      ).length;
      for (let i = 0; i < n; i++) s = cacheOnBird(s, playerId, tag.bird, 'rodent');
      return s;
    }
    case 'eggsPerCube': {
      if (choice.kind !== 'player' || !tag.bird) return s;
      const h = HABITATS[tag.n?.[0] ?? -1];
      if (!h) return s;
      const n = getPlayer(s, choice.playerId).roundCubes[h];
      if (n <= 0) return s;
      return setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, n));
    }
    case 'cacheWildPerCube': {
      if (choice.kind !== 'player') return s;
      const h = HABITATS[tag.n?.[0] ?? -1];
      if (!h) return s;
      const n = getPlayer(s, choice.playerId).roundCubes[h];
      if (n <= 0) return s;
      return pushPending(s, { kind: 'chooseCacheOnBirds', playerId, count: n, food: 'any' });
    }
    case 'tuckPerCube': {
      if (choice.kind !== 'player' || !tag.bird) return s;
      const h = HABITATS[tag.n?.[0] ?? -1];
      if (!h) return s;
      const n = getPlayer(s, choice.playerId).roundCubes[h];
      if (n <= 0) return s;
      return pushPending(s, {
        kind: 'assignHandTucks',
        playerId,
        targets: Array.from({ length: n }, () => tag.bird!),
        then: { effect: 'drawPerTucked' },
      });
    }
    case 'tuckDeckPerFood': {
      if (!tag.bird) return s;
      const n = choice.kind === 'supplyFood' ? choice.foods.length : 0;
      if (n <= 0) return s;
      s = tuckFromDeck(s, playerId, tag.bird, n);
      return firePinkTriggers(s, playerId, { kind: 'tuck' });
    }
    case 'stealResolve': {
      if (choice.kind !== 'player') return s;
      const victim = choice.playerId;
      const fIdx = tag.ids?.[0] ?? -1;
      const vp = getPlayer(s, victim);
      if (fIdx < 0) {
        // Steal "[wild]": the thief picks which food type to take.
        return pushPending(s, {
          kind: 'chooseFoodSteal',
          playerId,
          from: victim,
          food: 'any',
          then: { effect: 'stealDone', ids: [s.playerOrder.indexOf(victim)] },
        });
      }
      const food = FOOD_TYPES[fIdx]!;
      if (vp.food[food] <= 0) {
        return appendLog(s, `${victim}: no ${food} to steal`);
      }
      s = setPlayer(s, spendFood(vp, [food]));
      if (tag.bird) {
        s = cacheOnBird(s, playerId, tag.bird, food);
      } else {
        s = setPlayer(s, recordFoodGain(addFood(getPlayer(s, playerId), food), food));
      }
      // The stolen-from player gains 1 die from the birdfeeder.
      return pushPending(s, { kind: 'pickDie', playerId: victim, count: 1 });
    }
    case 'stealDone': {
      const victim = s.playerOrder[tag.ids?.[0] ?? -1];
      if (!victim) return s;
      return pushPending(s, { kind: 'pickDie', playerId: victim, count: 1 });
    }
    case 'eggEachHabitat': {
      if (choice.kind !== 'habitat') return s;
      let p = getPlayer(s, playerId);
      for (const { ref } of playedBirds(p)) {
        if (ref.habitat === choice.habitat) p = addEggs(p, ref, 1);
      }
      return setPlayer(s, p);
    }
    default:
      return s;
  }
}

/** First habitat where `cardId` can be legally played by `p` right now. */
function autoPickHabitat(p: ReturnType<typeof getPlayer>, cardId: number): Habitat {
  const card = bird(cardId);
  for (const h of card.habitats) {
    if (p.board[h].length >= 5) continue;
    if (totalEggsAvail(p) < columnEggCost(p.board[h].length)) continue;
    if (payFoodPlan(p.food, card.cost) == null) continue;
    return h;
  }
  throw new Error('no habitat can take this bird');
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
  const eggCost = columnEggCost(slot);
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
  // European sideways birds cover a second space when there's room.
  const coversTwo = isSideways(card) && slot <= 3;
  const newRow = [...pl.board[habitat], { cardId, eggs: 0, tucked: [], cached: [] }];
  if (coversTwo) {
    newRow.push({ cardId, eggs: 0, tucked: [], cached: [], ghost: true });
  }
  pl = {
    ...pl,
    hand: pl.hand.filter((id) => id !== cardId),
    board: { ...pl.board, [habitat]: newRow },
  };
  let s = setPlayer(state, pl);
  const ref: BirdRef = { habitat, index: slot };
  if (card.powerColor === 'white' && card.powerText) {
    s = runPower(s, playerId, ref);
  }
  // EE rulebook: a bird with a round-end power played during round-end
  // resolution (e.g. by Yellowhammer) triggers its power when played.
  if (s.phase === 'roundEnd' && card.powerColor === 'teal' && card.powerText) {
    s = runPower(s, playerId, ref);
  }
  return s;
}

function totalEggsAvail(p: { board: Record<Habitat, PlayedBird[]> }): number {
  return HABITATS.reduce((n, h) => n + p.board[h].reduce((m, b) => m + b.eggs, 0), 0);
}
