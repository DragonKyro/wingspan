// Resolves pending steps (the sub-choices powers and actions queue) and runs
// the `then` continuation tags that chain compound powers.

import { bird, BIRD_BY_ID, hummingbird } from './cards';
import { finishEndOfTurnDiscards, finishTurnAfterPinks } from './actions';
import { DUET_MAP, duetEligibleSpaces, duetFoodsFor } from './duetMap';
import {
  addEggs,
  eggRoom,
  addFood,
  adjacentRefs,
  appendLog,
  birdAt,
  discountFoodCost,
  eggStepTargets,
  eggsInHabitat,
  getPlayer,
  isAutoma,
  isDuet,
  isGoalDouble,
  isSideways,
  nestMatches,
  payFoodPlan,
  playEggCost,
  playedBirds,
  playerToLeft,
  playerToRight,
  recordFoodGain,
  sameRef,
  spendFood,
  totalEggs,
  totalFood,
  wingspanOf,
} from './helpers';
import {
  cacheOnBird,
  costHasFood,
  drawBonusKeep,
  drawBonusKeep1,
  drawBonusPool,
  drawBonusToHand,
  drawCardsChoice,
  feederAllSameFace,
  takeAllMatching,
  drawFromDeck,
  drawHumCard,
  drawToPool,
  faceCovers,
  feederReset,
  firePinkTriggers,
  foodIconsInCost,
  grantHumBenefit,
  grantSupplyFood,
  hasPowerImpl,
  moveHumToken,
  offerPoolPlay,
  placeFromPool,
  poolHabitats,
  POWER_IMPLS,
  pushPending,
  queueHumAction,
  queueRowHumAction,
  refillFeeder,
  refillTray,
  resetTray,
  rollDice,
  runPower,
  setPlayer,
  takeDieFromFeeder,
  takeTrayCard,
  tuckCardOnBird,
  tuckFromDeck,
} from './powers';
import { bonusCardVp } from './scoring';
import type {
  BirdRef,
  Choice,
  FoodType,
  GameState,
  Habitat,
  HumGroup,
  PendingStep,
  PlayerId,
  PlayedBird,
} from './types';
import { BASE_FOODS, FOOD_TYPES, HABITATS } from './types';

// === feasibility pruning ===

/** Number of valid answers a pending step currently has (0 ⇒ auto-drop). */
function feasible(state: GameState, step: PendingStep): number {
  if (isAutoma(state, step.playerId)) return 0;
  const p = getPlayer(state, step.playerId);
  switch (step.kind) {
    case 'pickDie': {
      // Unrestricted: taking the last die refills the feeder, so every die can
      // be had. Restricted: the matching dice — or the whole count when an
      // all-same-face reset could turn some up.
      if (!step.faces) return state.feederIn.length > 0 ? step.count : 0;
      const ok = state.feederIn.filter((f) => step.faces!.some((w) => faceCovers(f, w))).length;
      if (ok === 0) return feederAllSameFace(state) ? step.count : 0;
      return Math.min(step.count, ok);
    }
    case 'chooseSupplyFood':
      // The supply is unlimited — the full count is always feasible.
      return step.count;
    case 'chooseBirdForEgg': {
      const targets = eggStepTargets(state, step);
      if (targets.length === 0) return 0;
      // Capacity counts repeats: a bird may take several eggs up to its limit.
      let room = 0;
      for (const t of targets) {
        const b = p.board[t.habitat]?.[t.index];
        if (b) room += Math.max(0, bird(b.cardId).eggLimit + (step.overLimit ?? 0) - b.eggs);
      }
      return Math.min(step.count, room);
    }
    case 'chooseBirdForEggDiscard': {
      const eggs = playedBirds(p).filter(
        ({ ref, bird: b }) =>
          b.eggs > 0 &&
          !(step.exclude && sameRef(ref, step.exclude)) &&
          (!step.habitat || ref.habitat === step.habitat),
      );
      let avail = eggs.reduce((n, { bird: b }) => n + b.eggs, 0);
      if (step.moveTo) {
        const t = p.board[step.moveTo.habitat]?.[step.moveTo.index];
        if (!t || t.ghost) return 0;
        avail = Math.min(avail, Math.max(0, bird(t.cardId).eggLimit - t.eggs));
      }
      return Math.min(step.count, avail);
    }
    case 'chooseHandDiscard':
      return Math.min(step.count, p.hand.length);
    case 'chooseHandTuck': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b) return 0;
      if (step.wingspanLt != null) {
        return p.hand.some((id) => wingspanOf(bird(id)) < step.wingspanLt!) ? 1 : 0;
      }
      return p.hand.length > 0 ? 1 : 0;
    }
    case 'chooseCardDiscard': {
      const inTray = step.fromTray
        ? state.tray.filter((id): id is number => id != null).filter((id) => step.costFoods.some((f) => costHasFood(bird(id), [f]))).length
        : 0;
      const inHand = step.fromHand
        ? p.hand.filter((id) => step.costFoods.some((f) => costHasFood(bird(id), [f]))).length
        : 0;
      return Math.min(1, inTray + inHand);
    }
    case 'chooseCachedDiscard': {
      const n = playedBirds(p).reduce((m, { bird: b }) => m + b.cached.length, 0);
      return Math.min(step.count, n);
    }
    case 'chooseDrawnCard':
      return step.cardIds.length >= (step.keep ?? 1) ? step.cardIds.length : 0;
    case 'chooseBonusCards':
      return step.cardIds.length >= step.keep ? 1 : 0;
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
        if (step.excludeIds?.includes(i)) return false;
        const c = bird(b.cardId);
        if (c.powerColor !== 'brown' || !c.powerText || !hasPowerImpl(c.id)) return false;
        if (step.predatorOnly && !c.predator) return false;
        return true;
      });
      return targets.length || step.optional ? 1 : 0;
    }
    case 'chooseAdditionalPlay': {
      let habitats =
        step.habitat === 'any'
          ? HABITATS
          : [step.habitat === 'same' ? step.sourceBird?.habitat : step.habitat];
      if (step.column != null) {
        habitats = habitats.filter((h) => h && p.board[h].length === step.column);
      }
      const ok = habitats.some((habitat) => {
        if (!habitat) return false;
        if (p.board[habitat].length >= 5) return false;
        const baseEggs = playEggCost(p, habitat);
        const discEggs = Math.max(0, baseEggs - (step.eggDiscount ?? 0));
        const totalEggsOnMat = totalEggs(p);
        return p.hand.some((id) => {
          const c = bird(id);
          if (!c.habitats.includes(habitat)) return false;
          if (totalEggsOnMat >= discEggs && payFoodPlan(p.food, c.cost) !== null) return true;
          if (
            step.foodDiscount &&
            totalEggsOnMat >= baseEggs &&
            payFoodPlan(p.food, discountFoodCost(c.cost, step.foodDiscount)) !== null
          ) {
            return true;
          }
          return false;
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
      if (step.other && state.players.length < 2) return step.optional ? 1 : 0;
      return 1;
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
    case 'chooseCardDraw':
      return state.tray.some((id) => id != null) || state.deck.length > 0 || state.discard.length > 0 ? step.count : 0;
    case 'choosePowerOrder':
      return step.birds.length > 0 ? 1 : 0;
    case 'deferredEffect':
      return 1; // expanded by dropImpossiblePending, never answered
    case 'choosePoolPlay':
      return 1;
    case 'chooseDieRemove':
      return Math.min(step.count, state.feederIn.length);
    case 'chooseBirds': {
      const eligible = chooseBirdsEligible(state, step);
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

    // === oceania expansion steps ===
    case 'chooseCopyPower': {
      const target = getPlayer(state, step.target);
      const habitats = step.habitat === 'any' ? HABITATS : [step.habitat];
      return habitats.some((h) => target.board[h].some(isCopyableBrown)) ? 1 : 0;
    }
    case 'chooseTrayCardEx': {
      if (state.tray.some((id) => id != null && trayCardMatches(step, id))) return 1;
      if (step.mayResetTray && (state.deck.length > 0 || state.discard.length > 0)) return 1;
      return 0;
    }
    case 'chooseTuckOrHand': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      return b && p.hand.includes(step.cardId) ? 1 : 0;
    }
    case 'chooseCacheFromSupply': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b || b.ghost) return 0;
      const avail =
        step.food === 'any'
          ? step.options
            ? step.options.reduce((n, f) => n + p.food[f], 0)
            : totalFood(p)
          : p.food[step.food];
      return Math.min(step.count, avail);
    }

    // === asia expansion steps ===
    case 'chooseDuetSpace':
      // The reset space is always a legal placement.
      return 1;
    case 'chooseResources': {
      // All-or-nothing: either the full count can be paid, or the step (and
      // its "if you do" continuation) drops — same as declining.
      const total = totalFood(p) + totalEggs(p) + p.hand.length;
      return total >= step.count ? step.count : 0;
    }
    case 'chooseTrayDiscard':
      return state.tray.some((id) => id != null) ? 1 : 0;
    case 'moveBirdToPlayer': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b || b.ghost) return 0;
      const row = p.board[step.bird.habitat];
      if (row.slice(step.bird.index + 1).some((x) => !x.ghost)) return 0;
      const target = getPlayer(state, step.target);
      const card = bird(b.cardId);
      return card.habitats.some((h) => target.board[h].length < 5) ? 1 : 0;
    }
    case 'confirm':
      return 1;
    case 'chooseHandPick':
      return Math.max(step.optional ? 1 : 0, Math.min(step.count, p.hand.length));
    case 'choosePoolTuck': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b || b.ghost || step.cardIds.length === 0) return 0;
      if (step.cardIds.length < (step.min ?? step.count)) return 0;
      return Math.min(step.count, step.cardIds.length);
    }
    case 'chooseCopyPlayed':
      return copyPlayedTargets(state, step.playerId).length > 0 ? 1 : 0;
    case 'chooseReroll':
      return state.feederIn.length > 0 ? 1 : 0;
    case 'drawUpTo':
      return 1;

    // === americas expansion steps ===
    case 'chooseHumSource':
      if (p.humBoard[step.habitat] != null) return 0; // the space filled up since this was queued
      return humSourceOptions(state, step).length > 0 ? 1 : 0;
    case 'chooseHumCover':
      return p.humBoard[step.habitat] != null ? 1 : 0;
    case 'chooseHumColumn':
      if (step.down) return step.groups.some((g) => p.humTrack[g] > 0) ? 1 : 0;
      return step.groups.length > 0 ? 1 : 0;
    case 'chooseHumHabitat':
      return humHabitatOptions(state, step).length > 0 ? 1 : 0;
  }
}

/** The birds eligible under a chooseBirds step's filters. */
/** A live bird whose brown power can be copied (Tūī / Lyrebird). */
export function isCopyableBrown(b: { ghost?: boolean; cardId: number }): boolean {
  if (b.ghost) return false;
  const c = bird(b.cardId);
  return c.powerColor === 'brown' && !!c.powerText && hasPowerImpl(c.id);
}

/** Neighbours' birds with a copyable white (when played) power. */
export function copyPlayedTargets(state: GameState, playerId: PlayerId): { player: PlayerId; bird: BirdRef }[] {
  const neighbors = new Set<PlayerId>();
  for (const n of [playerToLeft(state, playerId), playerToRight(state, playerId)]) {
    if (n) neighbors.add(n);
  }
  const out: { player: PlayerId; bird: BirdRef }[] = [];
  for (const n of neighbors) {
    for (const { ref, bird: b } of playedBirds(getPlayer(state, n))) {
      const c = bird(b.cardId);
      if (c.powerColor === 'white' && c.powerText && hasPowerImpl(c.id)) out.push({ player: n, bird: ref });
    }
  }
  return out;
}

export function chooseBirdsEligible(
  state: GameState,
  step: Extract<PendingStep, { kind: 'chooseBirds' }>,
): BirdRef[] {
  const p = getPlayer(state, step.playerId);
  const adjacent = step.adjacentTo ? new Set(adjacentRefs(p, step.adjacentTo).map((r) => `${r.habitat}:${r.index}`)) : null;
  return playedBirds(p)
    .filter(({ ref, bird: b }) => {
      if (step.habitat && ref.habitat !== step.habitat) return false;
      if (step.exclude && sameRef(ref, step.exclude)) return false;
      if (step.nest && !nestMatches(bird(b.cardId).nest, step.nest)) return false;
      if (step.eggsMin != null && b.eggs < step.eggsMin) return false;
      if (step.costFood && !costHasFood(bird(b.cardId), [step.costFood])) return false;
      if (adjacent && !adjacent.has(`${ref.habitat}:${ref.index}`)) return false;
      if (step.hasEggs && b.eggs <= 0) return false;
      if (step.hasCached && b.cached.length === 0) return false;
      if (step.needRoom && b.eggs >= bird(b.cardId).eggLimit) return false;
      return true;
    })
    .map(({ ref }) => ref);
}

/** Legal attract sources: garden slot indices with a pickable top card,
 *  plus 'deck' (not for group-named attracts — a blind draw can't target
 *  a group). A hummingbird the player returned this turn can't be re-attracted. */
export function humSourceOptions(
  state: GameState,
  step: Extract<PendingStep, { kind: 'chooseHumSource' }>,
): (number | 'deck')[] {
  const p = getPlayer(state, step.playerId);
  const out: (number | 'deck')[] = [];
  state.humGarden.forEach((slot, i) => {
    const id = slot[slot.length - 1];
    if (id == null) return;
    if (step.groups && !step.groups.includes(hummingbird(id).group)) return;
    if (p.humReturned.includes(id)) return;
    out.push(i);
  });
  if (!step.groups && (state.humDeck.length > 0 || state.humDiscard.length > 0)) {
    out.push('deck');
  }
  return out;
}

/** The rows a chooseHumHabitat step may legally pick. */
function humHabitatOptions(
  state: GameState,
  step: Extract<PendingStep, { kind: 'chooseHumHabitat' }>,
): Habitat[] {
  const p = getPlayer(state, step.playerId);
  return HABITATS.filter((h) => {
    if (step.exclude === h) return false;
    const occupied = p.humBoard[h] != null;
    const canAttract =
      !occupied &&
      humSourceOptions(state, { kind: 'chooseHumSource', playerId: step.playerId, habitat: h, groups: step.groups })
        .length > 0;
    const canReturn =
      occupied &&
      (!step.groups || step.groups.includes(hummingbird(p.humBoard[h]!).group));
    if (step.mode === 'attract') return canAttract;
    if (step.mode === 'return') return canReturn;
    return canAttract || canReturn;
  });
}

/** Does a tray card satisfy a chooseTrayCardEx step's filters? */
export function trayCardMatches(step: Extract<PendingStep, { kind: 'chooseTrayCardEx' }>, id: number): boolean {
  const c = bird(id);
  if (step.nests && !step.nests.includes(c.nest)) return false;
  if (step.wingspanLt != null && c.wingspan !== '*' && c.wingspan >= step.wingspanLt) return false;
  if (step.costFoods && !costHasFood(c, step.costFoods)) return false;
  return true;
}

/** Drop pending steps that have no legal answer (their `then` goes with them). */
export function dropImpossiblePending(state: GameState): GameState {
  let s = state;
  for (;;) {
    s = retargetLazyHumHead(s);
    const head = s.pending[0];
    if (head?.kind === 'deferredEffect') {
      s = continueEffect({ ...s, pending: s.pending.slice(1) }, head.playerId, head, { kind: 'boolean', yes: true }, null);
      continue;
    }
    if (!head || feasible(s, head) > 0) break;
    s = { ...s, pending: s.pending.slice(1) };
  }
  // Show the UI and AI the count the board can actually deliver, so the
  // prompt never asks for more than resolveChoice will accept.
  return clampHead(s);
}

/** The row's owed hummingbird action is queued before the brown powers that
 *  may precede it have resolved (e.g. an "any habitat" hummingbird power on
 *  the same row). Re-decide attract vs return against the board as it is
 *  when the step comes up: an empty space attracts, an occupied one returns. */
function retargetLazyHumHead(state: GameState): GameState {
  const head = state.pending[0];
  if (!head || (head.kind !== 'chooseHumSource' && head.kind !== 'chooseHumCover') || !head.lazy) {
    return state;
  }
  const occupied = getPlayer(state, head.playerId).humBoard[head.habitat] != null;
  let next: PendingStep | null = null;
  if (head.kind === 'chooseHumSource' && occupied) {
    next = { kind: 'chooseHumCover', playerId: head.playerId, habitat: head.habitat, lazy: true, then: head.then };
  } else if (head.kind === 'chooseHumCover' && !occupied) {
    next = { kind: 'chooseHumSource', playerId: head.playerId, habitat: head.habitat, lazy: true, then: head.then };
  }
  return next ? { ...state, pending: [next, ...state.pending.slice(1)] } : state;
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
  let s = dropImpossiblePending(state); // also clamps the head step's count
  const step = s.pending[0];
  if (!step) throw new Error('nothing to resolve');
  if (step.playerId !== playerId) throw new Error('not your choice');
  s = { ...s, pending: s.pending.slice(1) };
  let lastGained: FoodType | null = null;

  switch (step.kind) {
    case 'pickDie': {
      if (choice.kind !== 'dice') throw new Error('expected dice');
      if (choice.reroll && choice.picks.length === 0) {
        // Reset an all-same-face feeder, then pick from the new dice.
        if (!feederAllSameFace(s)) throw new Error('can only reroll when all dice show the same face');
        s = feederReset(s, playerId);
        return dropImpossiblePending({ ...s, pending: [step, ...s.pending] });
      }
      if (choice.picks.length > step.count) throw new Error(`pick at most ${step.count} dice`);
      // "About to gain food for any reason" — the all-same-face reroll also
      // applies to power-driven die picks.
      if (choice.reroll) {
        if (!(s.feederIn.length > 0 && s.feederIn.every((d) => d === s.feederIn[0]))) {
          throw new Error('can only reroll when all dice show the same face');
        }
        // Americas: the all-same-face reroll IS a feeder reset for pink watches.
        s = feederReset(s, playerId);
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
        // Dice deferred from the gain-food action fire its "gained food" pinks.
        if (lastGained && step.then?.effect === 'actionFoodPinks') {
          s = firePinkTriggers(s, playerId, { kind: 'gainFood', food: lastGained });
        }
      }
      // Fewer picks than the count (and not a decline): the rest stay queued,
      // picked once the player sees the feeder (e.g. after it refilled).
      if (choice.picks.length > 0 && choice.picks.length < step.count) {
        return dropImpossiblePending({ ...s, pending: [{ ...step, count: step.count - choice.picks.length }, ...s.pending] });
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
        for (const f of choice.foods) s = grantSupplyFood(s, playerId, f);
      }
      break;
    }
    case 'chooseBirdForEgg': {
      if (choice.kind !== 'birds') throw new Error('expected birds');
      if (choice.birds.length === 0 && step.optional) break;
      if (choice.birds.length > step.count) throw new Error(`at most ${step.count} birds`);
      if (!step.optional && choice.birds.length !== step.count) {
        throw new Error(`choose ${step.count} birds`);
      }
      // Track per-ref placements so repeats can't exceed a bird's room.
      const planned = new Map<string, number>();
      for (const ref of choice.birds) {
        if (step.onlyBird) {
          if (!sameRef(ref, step.onlyBird)) throw new Error('eggs go on this bird');
        } else {
          const ok = eggStepTargets(s, step).some((t) => sameRef(t, ref));
          if (!ok) throw new Error('that bird cannot take an egg');
        }
        const key = `${ref.habitat}:${ref.index}`;
        planned.set(key, (planned.get(key) ?? 0) + 1);
      }
      for (const [key, n] of planned) {
        const [hab, idx] = key.split(':');
        const ref: BirdRef = { habitat: hab as Habitat, index: +idx };
        const b = birdAt(s, playerId, ref);
        if (b.eggs + n > bird(b.cardId).eggLimit + (step.overLimit ?? 0)) {
          throw new Error('over the egg limit');
        }
        s = setPlayer(s, addEggs(getPlayer(s, playerId), ref, n, step.overLimit ?? 0));
      }
      break;
    }
    case 'chooseBirdForEggDiscard': {
      if (choice.kind !== 'birds') throw new Error('expected birds');
      if (choice.birds.length === 0 && step.optional) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      if (choice.birds.length !== step.count) throw new Error(`choose ${step.count} birds`);
      const discards = new Map<string, number>(); // eggs taken so far per bird
      for (const ref of choice.birds) {
        const b = birdAt(s, playerId, ref);
        const key = `${ref.habitat}:${ref.index}`;
        const taken = (discards.get(key) ?? 0) + 1;
        discards.set(key, taken);
        if (b.eggs < taken) throw new Error('that bird has no eggs');
        if (step.exclude && sameRef(ref, step.exclude)) throw new Error('not that bird');
        if (step.habitat && ref.habitat !== step.habitat) throw new Error(`must be in the ${step.habitat}`);
      }
      for (const ref of choice.birds) {
        const p = getPlayer(s, playerId);
        const row = [...p.board[ref.habitat]];
        row[ref.index] = { ...row[ref.index]!, eggs: row[ref.index]!.eggs - 1 };
        s = setPlayer(s, { ...p, board: { ...p.board, [ref.habitat]: row } });
      }
      if (step.moveTo) {
        // Americas egg-moving powers: the discarded eggs land on this bird.
        const t = birdAt(s, playerId, step.moveTo);
        const room = bird(t.cardId).eggLimit - t.eggs;
        const n = Math.min(room, choice.birds.length);
        if (n > 0) s = setPlayer(s, addEggs(getPlayer(s, playerId), step.moveTo, n));
      }
      break;
    }
    case 'chooseHandDiscard': {
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      if (choice.cardIds.length === 0 && step.optional) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      // Optional steps are "discard up to N" — partial discards are legal.
      if (choice.cardIds.length > step.count || (!step.optional && choice.cardIds.length !== step.count)) {
        throw new Error(`discard ${step.count} cards`);
      }
      if (choice.cardIds.length === 0) throw new Error(`discard ${step.count} cards`);
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
      if (step.wingspanLt != null && wingspanOf(bird(id)) >= step.wingspanLt) {
        throw new Error('wingspan too large');
      }
      s = setPlayer(s, { ...p, hand: p.hand.filter((x) => x !== id) });
      s = tuckCardOnBird(s, playerId, step.bird, id);
      s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      break;
    }
    case 'chooseCardDiscard': {
      // Americas: discard a bird card (tray or hand) that shows one of
      // `costFoods` in its printed food cost.
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      if (choice.cardIds.length === 0 && step.optional) {
        return dropImpossiblePending(s);
      }
      if (choice.cardIds.length !== 1) throw new Error('discard 1 card');
      const id = choice.cardIds[0]!;
      const inTray = s.tray.includes(id);
      const inHand = getPlayer(s, playerId).hand.includes(id);
      if (step.fromTray && inTray) {
        s = { ...s, tray: s.tray.map((x) => (x === id ? null : x)) };
      } else if (step.fromHand && inHand) {
        const p = getPlayer(s, playerId);
        s = setPlayer(s, { ...p, hand: p.hand.filter((x) => x !== id) });
      } else {
        throw new Error('card is not discardable here');
      }
      if (!step.costFoods.some((f) => costHasFood(bird(id), [f]))) {
        throw new Error('no matching food in its cost');
      }
      s = { ...s, discard: [...s.discard, id] };
      break;
    }
    case 'chooseCachedDiscard': {
      // Discard `count` cached food from any of your birds (cacheAssign picks).
      if (choice.kind !== 'cacheAssign') throw new Error('expected cacheAssign');
      if (choice.items.length === 0 && step.optional) {
        return dropImpossiblePending(s);
      }
      if (choice.items.length !== step.count) throw new Error(`discard ${step.count}`);
      for (const item of choice.items) {
        const b = getPlayer(s, playerId).board[item.bird.habitat]?.[item.bird.index];
        if (!b || b.ghost || !b.cached.includes(item.food)) {
          throw new Error('not cached there');
        }
      }
      let pl = getPlayer(s, playerId);
      for (const item of choice.items) {
        const row = [...pl.board[item.bird.habitat]];
        const b = row[item.bird.index]!;
        const at = b.cached.indexOf(item.food);
        row[item.bird.index] = { ...b, cached: b.cached.filter((_, i) => i !== at) };
        pl = { ...pl, board: { ...pl.board, [item.bird.habitat]: row } };
      }
      s = setPlayer(s, pl);
      break;
    }
    case 'chooseDrawnCard': {
      const keep = step.keep ?? 1;
      if (choice.kind !== 'handCards' || choice.cardIds.length !== keep) {
        throw new Error(`pick ${keep} card${keep > 1 ? 's' : ''}`);
      }
      for (const id of choice.cardIds) {
        if (!step.cardIds.includes(id)) throw new Error('not among the drawn cards');
      }
      const p = getPlayer(s, playerId);
      s = setPlayer(s, { ...p, hand: [...p.hand, ...choice.cardIds] });
      if (step.discardRest) {
        const rest = step.cardIds.filter((id) => !choice.cardIds.includes(id));
        s = { ...s, discard: [...s.discard, ...rest] };
      }
      break;
    }
    case 'chooseBonusCards': {
      if (choice.kind !== 'bonusCards') throw new Error('expected bonusCards');
      if (choice.cardIds.length !== step.keep) throw new Error(`keep ${step.keep}`);
      for (const id of choice.cardIds) {
        if (!step.cardIds.includes(id)) throw new Error('not among the drawn cards');
      }
      if (step.fromDiscard) {
        // Oceania Wrybill: the pool IS the discarded-bonus pile; the kept card
        // leaves it, the rest stay there.
        const p = getPlayer(s, playerId);
        const kept = new Set(choice.cardIds);
        s = {
          ...setPlayer(s, { ...p, bonusHand: [...p.bonusHand, ...choice.cardIds] }),
          bonusDiscard: s.bonusDiscard.filter((id) => !kept.has(id)),
        };
      } else if (step.copyFrom) {
        // Asia Adjutants: the picked card is recorded as a copy — the
        // neighbour's hand is untouched and the copy scores at game end.
        const p = getPlayer(s, playerId);
        s = setPlayer(s, { ...p, copiedBonus: [...p.copiedBonus, ...choice.cardIds] });
      } else if (step.fromHand) {
        // Asia "score a bonus card now": the pick stays in the hand (it is
        // identified via the continuation, not by hand membership).
        break;
      } else {
        const discarded = step.cardIds.filter((id) => !choice.cardIds.includes(id));
        const p = getPlayer(s, playerId);
        s = {
          ...setPlayer(s, {
            ...p,
            bonusHand: [...p.bonusHand.filter((id) => !step.cardIds.includes(id)), ...choice.cardIds],
          }),
          bonusDiscard: [...s.bonusDiscard, ...discarded],
        };
      }
      break;
    }
    case 'discardBonusCards': {
      if (choice.kind !== 'bonusCards') throw new Error('expected bonusCards');
      if (choice.cardIds.length === 0 && step.optional && !step.upTo) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      if (step.upTo ? choice.cardIds.length > step.count : choice.cardIds.length !== step.count) {
        throw new Error(step.upTo ? `discard at most ${step.count}` : `discard ${step.count}`);
      }
      let p = getPlayer(s, playerId);
      for (const id of choice.cardIds) {
        if (!p.bonusHand.includes(id)) throw new Error('card not in hand');
        p = { ...p, bonusHand: p.bonusHand.filter((x) => x !== id) };
      }
      s = { ...setPlayer(s, p), bonusDiscard: [...s.bonusDiscard, ...choice.cardIds] };
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
      const nextTargetRow = [...p.board[choice.habitat], b];
      s = setPlayer(s, {
        ...p,
        board: { ...p.board, [step.bird.habitat]: row, [choice.habitat]: nextTargetRow },
        // Americas p.9: if a moving bird lands on a Hornero placeholder egg and
        // another empty spot remains in that habitat, the placeholder slides to
        // the next empty spot; if the row is now full, the placeholder is lost.
        horneroEggs:
          nextTargetRow.length >= 5
            ? p.horneroEggs.filter((h) => h !== choice.habitat)
            : p.horneroEggs,
      });
      break;
    }
    case 'chooseFirstPlayer': {
      if (choice.kind !== 'player') throw new Error('expected player');
      // 'gainDie': each non-Automa player clockwise from the chosen one picks a die.
      const startIdx = s.playerOrder.indexOf(choice.playerId);
      if (startIdx < 0) throw new Error('unknown player');
      const steps: PendingStep[] = s.playerOrder
        .map((_, i) => s.playerOrder[(startIdx + i) % s.playerOrder.length]!)
        .filter((pid) => !isAutoma(s, pid))
        .map((pid) => ({
          kind: 'pickDie',
          playerId: pid,
          count: 1,
        }));
      s = { ...s, pending: [...steps, ...s.pending] };
      break;
    }
    case 'chooseRepeatPower': {
      if (choice.kind === 'boolean') {
        // 'Activate any or all in any order' — boolean declines stop the chain.
        if (choice.yes || !step.optional) throw new Error('expected repeatTarget');
        return dropImpossiblePending(s);
      }
      if (choice.kind !== 'repeatTarget') throw new Error('expected repeatTarget');
      const target = choice.bird;
      const b = birdAt(s, playerId, target);
      if (target.habitat !== step.habitat) throw new Error('must be in the same habitat');
      const source = step.then?.bird;
      if (source && source.habitat === target.habitat && source.index === target.index) {
        throw new Error('pick another bird');
      }
      if (step.excludeIds?.includes(target.index)) throw new Error('already activated');
      const card = bird(b.cardId);
      if (card.powerColor !== 'brown' || !card.powerText) throw new Error('not a brown power');
      if (step.predatorOnly && !card.predator) throw new Error('not a predator');
      // A repeat power reached through this one (Gray Catbird -> Northern
      // Mockingbird -> ...) may not loop back to a bird already used in the
      // chain, or two repeaters in one row would trigger each other forever.
      const chain = [...(step.excludeIds ?? []), ...(source ? [source.index] : []), target.index];
      const queued = new Set(s.pending);
      s = runPower(s, playerId, target);
      s = {
        ...s,
        pending: s.pending.map((st) =>
          st.kind === 'chooseRepeatPower' && !queued.has(st) && st.habitat === step.habitat
            ? { ...st, excludeIds: [...new Set([...(st.excludeIds ?? []), ...chain])] }
            : st,
        ),
      };
      break;
    }
    case 'chooseAdditionalPlay': {
      if (choice.kind !== 'handCards' || choice.cardIds.length > 1) throw new Error('pick 1 card');
      if (choice.cardIds.length === 0) {
        if (!step.optional) throw new Error('pick 1 card');
        break; // declined
      }
      const cardId = choice.cardIds[0]!;
      const p0 = getPlayer(s, playerId);
      let habitat: Habitat;
      if (step.habitat === 'same') habitat = step.sourceBird!.habitat;
      else if (step.habitat === 'any') {
        if (step.column != null) {
          // 'Play another bird in this column': the row must currently have
          // exactly `column` birds so the new bird lands in that column with
          // no empty spaces to its left.
          const fits = HABITATS.filter(
            (h) => p0.board[h].length === step.column && bird(cardId).habitats.includes(h),
          );
          if (choice.habitat != null) {
            if (!fits.includes(choice.habitat)) throw new Error('not this column');
            habitat = choice.habitat;
          } else if (fits.length === 1) {
            habitat = fits[0]!;
          } else {
            habitat = autoPickHabitat(p0, cardId, step.eggDiscount ?? 0, step.foodDiscount);
            if (p0.board[habitat].length !== step.column) {
              throw new Error('pick a habitat in this column');
            }
          }
        } else {
          habitat = choice.habitat ?? autoPickHabitat(p0, cardId, step.eggDiscount ?? 0, step.foodDiscount);
        }
      } else habitat = step.habitat;
      s = playAdditionalBird(s, playerId, cardId, habitat, step.eggDiscount ?? 0, step.foodDiscount, {
        foodPayments: choice.foodPayments,
        eggPayments: choice.eggPayments,
        ignore: choice.ignore,
      });
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
      p = spendFood(p, [choice.give]);
      // Oceania: a nectar given away counts toward this bird's habitat row.
      if (choice.give === 'nectar' && step.spentHabitat) {
        p = {
          ...p,
          nectarSpent: {
            ...p.nectarSpent,
            [step.spentHabitat]: p.nectarSpent[step.spentHabitat] + 1,
          },
        };
      }
      s = setPlayer(s, p);
      s = grantSupplyFood(s, playerId, choice.to);
      break;
    }
    case 'chooseCacheGained': {
      if (choice.kind !== 'boolean') throw new Error('expected boolean');
      if (choice.yes) s = cacheOnBird(s, playerId, step.bird, step.food);
      break;
    }
    case 'choosePlayer': {
      if (choice.kind === 'boolean') {
        // Optional player-picks may be declined (the "if you do" then fails).
        if (choice.yes || !step.optional) throw new Error('expected player');
        return dropImpossiblePending(s);
      }
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
      // Oceania: nectar discarded by a power counts toward the bird's habitat.
      const nectarSpent = choice.foods.filter((f) => f === 'nectar').length;
      if (nectarSpent > 0 && step.spentHabitat) {
        pl = {
          ...pl,
          nectarSpent: {
            ...pl.nectarSpent,
            [step.spentHabitat]: pl.nectarSpent[step.spentHabitat] + nectarSpent,
          },
        };
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
      s = grantSupplyFood(s, playerId, f);
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
      // `peek` = pick-only (the continuation moves the card itself).
      if (!step.peek) s = takeTrayCard(s, playerId, idx);
      break;
    }
    case 'choosePoolPlay': {
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      if (choice.cardIds.length === 0) {
        s = { ...s, discard: [...s.discard, ...step.cardIds] }; // played none
        break;
      }
      const id = choice.cardIds[0]!;
      if (!step.cardIds.includes(id)) throw new Error('not one of the drawn cards');
      const fits = poolHabitats(s, playerId, id);
      const hab = choice.habitat ?? (fits.length === 1 ? fits[0] : undefined);
      if (!hab || !fits.includes(hab)) throw new Error('pick a habitat with room for this bird');
      s = placeFromPool(s, playerId, step.cardIds, id, hab);
      break;
    }
    case 'choosePowerOrder': {
      if (choice.kind !== 'repeatTarget') throw new Error('pick the bird whose power runs next');
      const pick = choice.bird;
      if (!step.birds.some((b) => b.habitat === pick.habitat && b.index === pick.index)) throw new Error('not one of your waiting powers');
      const key = step.queue === 'roundEnd' ? 'roundEndQueue' : 'gameEndQueue';
      const q = s[key] ?? [];
      const at = q.findIndex((e) => e.playerId === playerId && e.bird.habitat === pick.habitat && e.bird.index === pick.index);
      if (at >= 0) s = { ...s, [key]: [...q.slice(0, at), ...q.slice(at + 1)] };
      s = runPower(s, playerId, pick);
      break;
    }
    case 'chooseCardDraw': {
      if (choice.kind !== 'trayPick' || choice.mode) throw new Error('pick a tray card or the deck');
      if (choice.cardId != null) {
        const idx = s.tray.indexOf(choice.cardId);
        if (idx < 0) throw new Error('that card is not on the tray');
        s = takeTrayCard(s, playerId, idx);
      } else {
        s = drawFromDeck(s, playerId, 1);
      }
      // One card per answer; the continuation runs after the last.
      if (step.count > 1) return dropImpossiblePending({ ...s, pending: [{ ...step, count: step.count - 1 }, ...s.pending] });
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
      // An emptied feeder refills = a reset for americas pink watches.
      if (s.feederIn.length === 0) s = feederReset(s, playerId);
      break;
    }
    case 'chooseBirds': {
      if (choice.kind !== 'birds') throw new Error('expected birds');
      if (choice.birds.length < step.min || choice.birds.length > step.max) {
        throw new Error(`choose ${step.min}-${step.max} birds`);
      }
      const seen = new Set<string>();
      const eligible = chooseBirdsEligible(s, step);
      for (const ref of choice.birds) {
        const key = `${ref.habitat}:${ref.index}`;
        if (seen.has(key)) throw new Error('duplicate bird');
        seen.add(key);
        if (!eligible.some((e) => sameRef(e, ref))) {
          throw new Error('that bird does not qualify');
        }
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
      for (const pid of s.playerOrder) {
        // 'missing': only players who don't already have the food gain it.
        if (step.missing && getPlayer(s, pid).food[f] > 0) continue;
        s = grantSupplyFood(s, pid, f);
      }
      break;
    }
    case 'chooseOption': {
      if (choice.kind !== 'option') throw new Error('expected option');
      if (!step.options.includes(choice.option)) throw new Error('not an option');
      if (choice.option === 'gainDie') {
        s = pushPending(s, { kind: 'pickDie', playerId, count: 1 });
      } else if (choice.option === 'drawCard') {
        s = drawCardsChoice(s, playerId, 1);
      } else if (choice.option === 'layEgg') {
        s = pushPending(s, { kind: 'chooseBirdForEgg', playerId, count: 1, nest: 'any' });
      } else if (choice.option === 'gainFruit') {
        s = grantSupplyFood(s, playerId, 'fruit');
      } else if (choice.option === 'fruitToNectar') {
        // Mistletoebird: discard 1 fruit to gain 1 nectar.
        const p = getPlayer(s, playerId);
        if (p.food.fruit <= 0) throw new Error("you don't have fruit");
        s = setPlayer(s, spendFood(p, ['fruit']));
        s = grantSupplyFood(s, playerId, 'nectar');
      } else if (choice.option === 'selfEggs2') {
        // Red-Winged Parrot: lay 2 eggs on the bird whose power gave nectar.
        const ref = step.then?.bird;
        if (!ref) throw new Error('missing source bird');
        s = setPlayer(s, addEggs(getPlayer(s, playerId), ref, 2));
      } else if (choice.option === 'trayCard') {
        s = pushPending(s, { kind: 'chooseTrayCard', playerId });
      } else if (choice.option === 'gainSeed') {
        s = grantSupplyFood(s, playerId, 'seed');
      } else if (choice.option === 'tuckDeckCard') {
        const ref = step.then?.bird;
        if (ref) {
          s = tuckFromDeck(s, playerId, ref, 1);
          s = firePinkTriggers(s, playerId, { kind: 'tuck' });
        }
      } else if (choice.option === 'asiaCacheWild') {
        // House Crow: cache a wild food here, then tuck a deck card.
        const ref = step.then?.bird;
        if (ref) {
          s = pushPending(s, {
            kind: 'chooseCacheFromSupply',
            playerId,
            bird: ref,
            count: 1,
            food: 'any',
            then: { effect: 'asiaDeckTuck', bird: ref },
          });
        }
      } else if (choice.option === 'asiaTuckHand') {
        // House Crow: tuck a hand card here, then tuck a deck card.
        const ref = step.then?.bird;
        if (ref) {
          s = pushPending(s, {
            kind: 'chooseHandTuck',
            playerId,
            bird: ref,
            optional: true,
            then: { effect: 'asiaDeckTuck', bird: ref },
          });
        }
      // === americas options ===
      } else if (choice.option === 'selfEgg1') {
        const ref = step.then?.bird;
        if (ref) s = setPlayer(s, addEggs(getPlayer(s, playerId), ref, 1));
      } else if (choice.option === 'tuck3Hand') {
        const ref = step.then?.bird;
        if (ref) {
          s = pushPending(s, { kind: 'assignHandTucks', playerId, targets: [ref, ref, ref] });
        }
      } else if (choice.option === 'takeDieNow') {
        s = pushPending(s, { kind: 'pickDie', playerId, count: 1, faces: ['invertebrate'] });
      } else if (choice.option === 'resetThenDie') {
        s = feederReset(s, playerId);
        s = pushPending(s, { kind: 'pickDie', playerId, count: 1, faces: ['invertebrate'] });
      } else if (choice.option === 'moveEggsIn') {
        const ref = step.then?.bird;
        if (ref) {
          s = pushPending(s, {
            kind: 'chooseBirdForEggDiscard',
            playerId,
            count: 3,
            exclude: ref,
            moveTo: ref,
            optional: true,
          });
        }
      } else if (choice.option === 'moveEggsOut') {
        const ref = step.then?.bird;
        if (ref) {
          s = pushPending(s, {
            kind: 'chooseBirds',
            playerId,
            min: 0,
            max: 3,
            exclude: ref,
            needRoom: true,
            then: { effect: 'amEggsOut', bird: ref },
          });
        }
      } else if (choice.option === 'tuckHand') {
        const ref = step.then?.bird;
        if (ref) {
          s = pushPending(s, { kind: 'chooseHandTuck', playerId, bird: ref, optional: true });
        }
      } else if (choice.option === 'untuckDraw3') {
        const ref = step.then?.bird;
        if (ref) {
          const pl = getPlayer(s, playerId);
          const b = pl.board[ref.habitat]?.[ref.index];
          if (b && b.tucked.length > 0) {
            const removed = b.tucked[0]!;
            const row = [...pl.board[ref.habitat]];
            row[ref.index] = { ...b, tucked: b.tucked.slice(1) };
            s = setPlayer(s, { ...pl, board: { ...pl.board, [ref.habitat]: row } });
            s = { ...s, discard: [...s.discard, removed] };
            s = drawFromDeck(s, playerId, 3);
          }
        }
      } else if (choice.option === 'tuckHandDraw') {
        const ref = step.then?.bird;
        if (ref) {
          s = pushPending(s, {
            kind: 'chooseHandTuck',
            playerId,
            bird: ref,
            optional: true,
            then: { effect: 'drawCards', n: [1] },
          });
        }
      } else if (choice.option === 'resetTrayTuckDraw') {
        const ref = step.then?.bird;
        s = resetTray(s);
        if (ref) {
          s = pushPending(s, {
            kind: 'chooseHandTuck',
            playerId,
            bird: ref,
            optional: true,
            then: { effect: 'drawCards', n: [1] },
          });
        }
      } else if (choice.option === 'traySwap') {
        s = pushPending(s, {
          kind: 'chooseHandPick',
          playerId,
          count: 1,
          optional: true,
          then: { effect: 'amTraySwap1' },
        });
      } else if (choice.option === 'allLayEgg') {
        s = pushPending(
          s,
          ...s.playerOrder.map(
            (pid): PendingStep => ({ kind: 'chooseBirdForEgg', playerId: pid, count: 1, nest: 'any' }),
          ),
        );
      } else if (choice.option === 'allDrawCard') {
        for (const pid of s.playerOrder) s = drawFromDeck(s, pid, 1);
      } else if (choice.option === 'skip') {
        // decline — nothing happens
      } else {
        // 'gain2Dice'
        s = pushPending(s, { kind: 'pickDie', playerId, count: 2 });
      }
      break;
    }

    // === oceania expansion steps ===
    case 'chooseCopyPower': {
      if (choice.kind !== 'repeatTarget') throw new Error('expected repeatTarget');
      const target = choice.bird;
      const tp = getPlayer(s, step.target);
      const b = tp.board[target.habitat]?.[target.index];
      if ((step.habitat !== 'any' && target.habitat !== step.habitat) || !b || b.ghost) {
        throw new Error('no bird at that space');
      }
      const card = bird(b.cardId);
      if (card.powerColor !== 'brown' || !card.powerText) throw new Error('not a brown power');
      const fn = POWER_IMPLS[card.powerText];
      if (!fn) throw new Error('that power cannot be copied');
      // The copied power runs as the copying bird's own (tag.bird), so
      // "this bird" and the player's identity resolve to the copier.
      const source = step.then?.bird;
      if (!source) throw new Error('missing copying bird');
      s = fn(s, playerId, source);
      break;
    }
    case 'chooseTrayCardEx': {
      if (choice.kind !== 'trayPick') throw new Error('expected trayPick');
      if (choice.mode === 'reset' || choice.mode === 'refill') {
        if (!step.mayResetTray) throw new Error('cannot reset the tray here');
        s = choice.mode === 'reset' ? resetTray(s) : refillTray(s);
        // Re-queue the pick against the new tray (reset allowed only once).
        return dropImpossiblePending(pushPending(s, { ...step, mayResetTray: false }));
      }
      if (choice.cardId == null) throw new Error('pick a tray card');
      const idx = s.tray.indexOf(choice.cardId);
      if (idx < 0) throw new Error('that card is not on the tray');
      if (!trayCardMatches(step, choice.cardId)) throw new Error('that card does not qualify');
      s = takeTrayCard(s, playerId, idx);
      if (step.destination === 'tuck' && step.bird) {
        const p = getPlayer(s, playerId);
        s = setPlayer(s, { ...p, hand: p.hand.filter((id) => id !== choice.cardId) });
        s = tuckCardOnBird(s, playerId, step.bird, choice.cardId);
        s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      }
      break;
    }
    case 'chooseTuckOrHand': {
      if (choice.kind !== 'boolean') throw new Error('expected boolean');
      if (choice.yes) {
        const p = getPlayer(s, playerId);
        if (!p.hand.includes(step.cardId)) throw new Error('card not in hand');
        s = setPlayer(s, { ...p, hand: p.hand.filter((id) => id !== step.cardId) });
        s = tuckCardOnBird(s, playerId, step.bird, step.cardId);
        s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      }
      break;
    }
    case 'chooseCacheFromSupply': {
      if (choice.kind !== 'supplyFood') throw new Error('expected supplyFood');
      if (choice.foods.length === 0 && step.optional) {
        if (step.then?.effect === 'promoCanadaJay') break;
        return dropImpossiblePending(s);
      }
      if (choice.foods.length > step.count) throw new Error(`at most ${step.count}`);
      if (!step.optional && choice.foods.length !== step.count) {
        throw new Error(`choose ${step.count}`);
      }
      let pl = getPlayer(s, playerId);
      for (const f of choice.foods) {
        if (step.food !== 'any' && f !== step.food) throw new Error(`must cache ${step.food}`);
        if (step.options && !step.options.includes(f)) throw new Error(`${f} is not an option`);
        if (pl.food[f] <= 0) throw new Error(`you don't have ${f}`);
        pl = spendFood(pl, [f]);
      }
      s = setPlayer(s, pl);
      for (const f of choice.foods) s = cacheOnBird(s, playerId, step.bird, f);
      break;
    }

    // === asia / duet expansion steps ===
    case 'chooseDuetSpace': {
      if (choice.kind !== 'duetSpace') throw new Error('expected duetSpace');
      const duet = s.duet;
      if (!duet) throw new Error('not a duet game');
      if (choice.space === 'reset') {
        s = { ...s, duet: { ...duet, reset: [...duet.reset, playerId] } };
        break;
      }
      const card = bird(step.cardId);
      const eligible = duetEligibleSpaces(
        duet.map,
        card,
        step.habitat,
        duetFoodsFor(card, step.foods),
      );
      if (!eligible.includes(choice.space)) throw new Error('that space does not match');
      const map = [...duet.map];
      map[choice.space] = playerId;
      s = { ...s, duet: { ...duet, map } };
      const bonus = DUET_MAP[choice.space]!.bonus;
      if (bonus === 'food') {
        s = pushPending(s, { kind: 'pickDie', playerId, count: 1 });
      } else if (bonus === 'egg') {
        s = pushPending(s, { kind: 'chooseBirdForEgg', playerId, count: 1, nest: 'any' });
      } else if (bonus === 'card') {
        s = pushPending(s, { kind: 'chooseOption', playerId, options: ['trayCard', 'drawCard'] });
      }
      break;
    }
    case 'chooseResources': {
      if (choice.kind !== 'resources') throw new Error('expected resources');
      const n = choice.foods.length + choice.eggs.length + choice.cards.length;
      if (n === 0 && step.optional) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      if (n !== step.count) throw new Error(`choose ${step.count} resources`);
      let pl = getPlayer(s, playerId);
      for (const f of choice.foods) {
        if (pl.food[f] <= 0) throw new Error(`you don't have ${f}`);
        pl = spendFood(pl, [f]);
      }
      for (const ref of choice.eggs) {
        const b = pl.board[ref.habitat]?.[ref.index];
        if (!b || b.ghost || b.eggs <= 0) throw new Error('no egg on that bird');
      }
      for (const ref of choice.eggs) {
        const row = [...pl.board[ref.habitat]];
        row[ref.index] = { ...row[ref.index]!, eggs: row[ref.index]!.eggs - 1 };
        pl = { ...pl, board: { ...pl.board, [ref.habitat]: row } };
      }
      for (const id of choice.cards) {
        if (!pl.hand.includes(id)) throw new Error('card not in hand');
        pl = { ...pl, hand: pl.hand.filter((x) => x !== id) };
      }
      s = { ...setPlayer(s, pl), discard: [...s.discard, ...choice.cards] };
      break;
    }
    case 'chooseTrayDiscard': {
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      const ids = [...new Set(choice.cardIds)];
      for (const id of ids) {
        if (!s.tray.includes(id)) throw new Error('that card is not on the tray');
      }
      s = {
        ...s,
        tray: s.tray.map((id) => (id != null && ids.includes(id) ? null : id)),
        discard: [...s.discard, ...ids],
      };
      s = refillTray(s);
      break;
    }
    case 'moveBirdToPlayer': {
      if (choice.kind !== 'habitat') throw new Error('expected habitat');
      const pl = getPlayer(s, playerId);
      const row = pl.board[step.bird.habitat];
      const me = row?.[step.bird.index];
      if (!me || me.ghost) throw new Error('bird is gone');
      if (row.slice(step.bird.index + 1).some((x) => !x.ghost)) {
        throw new Error('there are birds to its right');
      }
      const target = getPlayer(s, step.target);
      const card = bird(me.cardId);
      if (!card.habitats.includes(choice.habitat)) throw new Error('cannot live there');
      if (target.board[choice.habitat].length >= 5) throw new Error('row is full');
      // Only the card moves — its eggs, caches and tucked cards are discarded.
      const ghostAfter = row[step.bird.index + 1]?.ghost ? 1 : 0;
      const newRow = row.filter(
        (_, i) => i !== step.bird.index && i !== step.bird.index + ghostAfter,
      );
      s = setPlayer(s, { ...pl, board: { ...pl.board, [step.bird.habitat]: newRow } });
      const t = getPlayer(s, step.target);
      const nextTargetRow = [
        ...t.board[choice.habitat],
        { cardId: me.cardId, eggs: 0, tucked: [], cached: [] },
      ];
      s = setPlayer(s, {
        ...t,
        board: {
          ...t.board,
          [choice.habitat]: nextTargetRow,
        },
        horneroEggs:
          nextTargetRow.length >= 5
            ? t.horneroEggs.filter((h) => h !== choice.habitat)
            : t.horneroEggs,
      });
      s = { ...s, discard: [...s.discard, ...me.tucked] };
      break;
    }
    case 'confirm': {
      if (choice.kind !== 'boolean') throw new Error('expected boolean');
      if (!choice.yes) {
        if (step.then?.effect === 'takeAllReroll') {
          // Declined the optional reset: take all from the feeder as it is.
          const want = FOOD_TYPES[step.then.ids?.[0] ?? -1];
          return dropImpossiblePending(want ? takeAllMatching(s, playerId, want) : s);
        }
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      break;
    }
    case 'chooseHandPick': {
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      if (choice.cardIds.length === 0 && step.optional) {
        return dropImpossiblePending(s); // declined — the "if you do" fails
      }
      if (choice.cardIds.length !== step.count) throw new Error(`pick ${step.count} cards`);
      const pl = getPlayer(s, playerId);
      for (const id of choice.cardIds) {
        if (!pl.hand.includes(id)) throw new Error('card not in hand');
      }
      break;
    }
    case 'choosePoolTuck': {
      if (choice.kind !== 'handCards') throw new Error('expected handCards');
      const n = Math.min(step.count, step.cardIds.length);
      const lo = Math.min(step.min ?? n, n);
      if (choice.cardIds.length < lo || choice.cardIds.length > n) {
        throw new Error(`tuck ${lo}-${n} cards`);
      }
      for (const id of choice.cardIds) {
        if (!step.cardIds.includes(id)) throw new Error('not from the pool');
      }
      const rest = step.cardIds.filter((id) => !choice.cardIds.includes(id));
      for (const id of choice.cardIds) s = tuckCardOnBird(s, playerId, step.bird, id);
      if (choice.cardIds.length > 0) s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      if (step.rest === 'hand') {
        const pl = getPlayer(s, playerId);
        s = setPlayer(s, { ...pl, hand: [...pl.hand, ...rest] });
      } else {
        s = { ...s, discard: [...s.discard, ...rest] };
      }
      break;
    }
    case 'chooseCopyPlayed': {
      if (choice.kind !== 'playedTarget') throw new Error('expected playedTarget');
      const left = playerToLeft(s, playerId);
      const right = playerToRight(s, playerId);
      if (choice.player !== left && choice.player !== right) {
        throw new Error('not a neighbour');
      }
      const tp = getPlayer(s, choice.player);
      const b = tp.board[choice.bird.habitat]?.[choice.bird.index];
      if (!b || b.ghost) throw new Error('no bird at that space');
      const card = bird(b.cardId);
      if (card.powerColor !== 'white' || !card.powerText) throw new Error('not a white power');
      const fn = POWER_IMPLS[card.powerText];
      if (!fn) throw new Error('that power cannot be copied');
      const source = step.then?.bird;
      if (!source) throw new Error('missing copying bird');
      s = fn(s, playerId, source);
      break;
    }
    case 'chooseReroll': {
      // Pick feeder dice to reroll (empty pick = stop), up to tag.n[0] times.
      if (choice.kind !== 'dice') throw new Error('expected dice');
      const rollsLeft = step.then?.n?.[0] ?? 0;
      for (const pick of choice.picks) {
        const face = s.feederIn[pick.die];
        if (face == null) throw new Error('no such die');
        const { s: s1, faces } = rollDice(s, 1);
        s = s1;
        const next = [...s.feederIn];
        next[pick.die] = faces[0]!;
        s = { ...s, feederIn: next, feederOut: [...s.feederOut, face] };
      }
      if (choice.picks.length > 0 && rollsLeft > 1) {
        const tag = step.then!;
        return dropImpossiblePending(
          pushPending(s, { ...step, then: { ...tag, n: [rollsLeft - 1] } }),
        );
      }
      break;
    }
    case 'drawUpTo': {
      if (choice.kind !== 'boolean') throw new Error('expected boolean');
      let pool = step.pool;
      if (choice.yes && step.left > 0) {
        const { s: s1, ids } = drawToPool(s, 1);
        s = s1;
        pool = [...pool, ...ids];
        if (step.left - 1 > 0 && ids.length > 0) {
          return dropImpossiblePending(
            pushPending(s, { ...step, left: step.left - 1, pool }),
          );
        }
      }
      // Stop (yes exhausted or declined): under the cap → tuck them all,
      // otherwise discard the drawn pool. A negative cap encodes a point-value
      // cap (Luzon Bleeding-Heart: total point value < 6).
      const rawCap = step.then?.n?.[0] ?? 0;
      const cap = Math.abs(rawCap);
      const total =
        rawCap < 0
          ? pool.reduce((sum, id) => sum + bird(id).points, 0)
          : pool.reduce((sum, id) => sum + wingspanOf(bird(id)), 0);
      if (pool.length > 0 && total < cap) {
        for (const id of pool) s = tuckCardOnBird(s, playerId, step.bird, id);
        s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      } else {
        s = { ...s, discard: [...s.discard, ...pool] };
      }
      return dropImpossiblePending(s); // evaluated here — skip the tag
    }

    // === americas expansion steps ===
    case 'chooseHumSource': {
      if (choice.kind !== 'humPick') throw new Error('expected humPick');
      const legal = humSourceOptions(s, step);
      let humId: number;
      if (choice.source === 'deck') {
        if (!legal.includes('deck')) throw new Error('cannot draw from the hummingbird deck');
        const r = drawHumCard(s);
        if (r.id == null) throw new Error('hummingbird deck is empty');
        s = r.s;
        humId = r.id;
      } else {
        if (!legal.includes(choice.source)) throw new Error('not a pickable hummingbird');
        const slot = [...s.humGarden[choice.source]!];
        humId = slot.pop()!;
        const garden = s.humGarden.map((g, i) => (i === choice.source ? slot : g));
        s = { ...s, humGarden: garden };
      }
      // Place it on the row's hummingbird space and grant its benefit.
      const pl = getPlayer(s, playerId);
      if (pl.humBoard[step.habitat] != null) throw new Error('that space is occupied');
      s = setPlayer(s, { ...pl, humBoard: { ...pl.humBoard, [step.habitat]: humId } });
      s = grantHumBenefit(s, playerId, step.habitat, humId);
      break;
    }
    case 'chooseHumCover': {
      // Return the hummingbird: it covers the top card of a garden slot, then
      // its group (and the covered card's group) each advance 1 space.
      if (choice.kind !== 'humCover') throw new Error('expected humCover');
      if (choice.slot < 0 || choice.slot >= s.humGarden.length) throw new Error('no such garden slot');
      const pl = getPlayer(s, playerId);
      const humId = pl.humBoard[step.habitat];
      if (humId == null) throw new Error('no hummingbird there');
      const covered = s.humGarden[choice.slot]![s.humGarden[choice.slot]!.length - 1] ?? null;
      const garden = s.humGarden.map((g, i) => (i === choice.slot ? [...g, humId] : g));
      s = { ...s, humGarden: garden };
      s = setPlayer(s, {
        ...pl,
        humBoard: { ...pl.humBoard, [step.habitat]: null },
        humReturned: [...pl.humReturned, humId],
      });
      const groups = new Set<HumGroup>([hummingbird(humId).group]);
      if (covered != null) groups.add(hummingbird(covered).group);
      s = pushPending(s, { kind: 'chooseHumColumn', playerId, groups: [...groups] });
      break;
    }
    case 'chooseHumColumn': {
      if (choice.kind !== 'humColumn') throw new Error('expected humColumn');
      if (!step.groups.includes(choice.group)) throw new Error('not an option');
      if (step.down && getPlayer(s, playerId).humTrack[choice.group] <= 0) {
        throw new Error('that token cannot move down');
      }
      s = moveHumToken(s, playerId, choice.group, step.down);
      break;
    }
    case 'chooseHumHabitat': {
      if (choice.kind === 'boolean') {
        if (choice.yes || !step.optional) throw new Error('expected habitat');
        return dropImpossiblePending(s); // declined
      }
      if (choice.kind !== 'habitat') throw new Error('expected habitat');
      if (!humHabitatOptions(s, step).includes(choice.habitat)) {
        throw new Error('not a valid row');
      }
      s = queueHumAction(s, playerId, choice.habitat, step.groups);
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
    case 'actionFoodPinks':
      return s;
    case 'poolPlayFishCache': {
      // "If it has [fish] in its food cost, cache 2 [fish] from the supply on this bird."
      const id = choice.kind === 'handCards' ? choice.cardIds[0] : undefined;
      if (id == null || !tag.bird || !costHasFood(bird(id), ['fish'])) return s;
      return cacheOnBird(cacheOnBird(s, playerId, tag.bird, 'fish'), playerId, tag.bird, 'fish');
    }
    case 'magentaPetrelStart': {
      const p = getPlayer(s, playerId);
      if (!tag.bird || p.bonusHand.length === 0) return s;
      return pushPending(s, {
        kind: 'chooseBonusCards', playerId, cardIds: p.bonusHand, keep: 1, fromHand: true,
        then: { effect: 'promoMagentaPetrel1', bird: tag.bird },
      });
    }
    case 'rustyBlackbird': {
      // Draw as many new bonus cards as were discarded, plus 1.
      const n = (choice.kind === 'bonusCards' ? choice.cardIds.length : 0) + 1;
      const drawn = drawBonusToHand(s, playerId, n);
      return drawn.ids.length > 0 ? firePinkTriggers(drawn.s, playerId, { kind: 'drawBonus' }) : drawn.s;
    }
    case 'fernbirdEgg': {
      const id = tag.ids?.[0];
      const p = getPlayer(s, playerId);
      if (id == null || !tag.bird || !p.hand.includes(id)) return s;
      const b = p.board[tag.bird.habitat]?.[tag.bird.index];
      if (!b || eggRoom(b) <= 0) return s;
      const out = setPlayer(s, addEggs({ ...p, hand: p.hand.filter((x) => x !== id) }, tag.bird, 1));
      return { ...out, discard: [...out.discard, id] };
    }
    case 'starlingCopy': {
      const id = tag.ids?.[0];
      const text = id != null ? bird(id).powerText : undefined;
      const fn = text ? POWER_IMPLS[text] : undefined;
      return fn && tag.bird ? fn(s, playerId, tag.bird) : s;
    }
    case 'endTurnPinksDone':
      return finishTurnAfterPinks(s);
    case 'siskinGive': {
      // An opponent chose to give the actor 1 food: the actor gains it, the
      // giver lays 2 eggs on their birds, and the end-of-power check counts it.
      const actor = s.playerOrder[tag.n?.[0] ?? 0]!;
      const given = choice.kind === 'supplyFood' ? choice.foods : [];
      if (given.length === 0) return s;
      for (const f of given) s = grantSupplyFood(s, actor, f);
      s = {
        ...s,
        pending: s.pending.map((x) =>
          x.kind === 'deferredEffect' && x.then.effect === 'siskinTuck' && x.playerId === actor
            ? { ...x, then: { ...x.then, n: [(x.then.n?.[0] ?? 0) + 1] } }
            : x,
        ),
      };
      return pushPending(s, { kind: 'chooseBirdForEgg', playerId, count: 2, nest: 'any', optional: true });
    }
    case 'siskinTuck': {
      // "If you receive fewer than 3 [wild], also tuck 2 [card] from the deck behind this bird."
      if ((tag.n?.[0] ?? 0) >= 3 || !tag.bird) return s;
      s = tuckFromDeck(s, playerId, tag.bird, 2);
      return firePinkTriggers(s, playerId, { kind: 'tuck' });
    }
    case 'giveBonusLeft': {
      // The bonus card a player picked goes to the player on their left.
      const to = s.playerOrder[tag.n?.[0] ?? -1];
      const ids = choice.kind === 'bonusCards' ? choice.cardIds : [];
      if (!to || ids.length === 0) return s;
      const tp = getPlayer(s, to);
      return {
        ...setPlayer(s, { ...tp, bonusHand: [...tp.bonusHand, ...ids] }),
        bonusDiscard: s.bonusDiscard.filter((id) => !ids.includes(id)),
      };
    }
    case 'takeAllReroll': {
      const want = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!want) return s;
      return takeAllMatching(feederReset(s, playerId), playerId, want);
    }
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
      return grantSupplyFood(s, playerId, f);
    }
    case 'supplyFoodChoice': {
      const foods = (tag.ids ?? []).map((i) => FOOD_TYPES[i]!).filter(Boolean);
      if (!foods.length) return s;
      return pushPending(s, { kind: 'chooseSupplyFood', playerId, count: 1, options: foods });
    }
    case 'supplyWild':
      return pushPending(s, { kind: 'chooseSupplyFood', playerId, count: tag.n?.[0] ?? 1, options: 'any' });
    case 'drawCards': // "draw ... from the deck"
      return drawFromDeck(s, playerId, tag.n?.[0] ?? 1);
    case 'drawCardsChoice': // a plain "draw": tray or deck
      return drawCardsChoice(s, playerId, tag.n?.[0] ?? 1);
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
        const p = getPlayer(s, s.playerOrder[(actorIdx - offset + 1 + s.playerOrder.length) % s.playerOrder.length] ?? playerId);
        return setPlayer(s, { ...p, hand: [...p.hand, remaining[0]!] });
      }
      const nextPid = s.playerOrder[(actorIdx + 1) % s.playerOrder.length]!;
      if (isAutoma(s, nextPid)) {
        // Automa does not participate in draft; actor keeps the extra card(s), discard rest.
        const keep = remaining[0]!;
        const rest = remaining.slice(1);
        const p = getPlayer(s, playerId);
        return {
          ...setPlayer(s, { ...p, hand: [...p.hand, keep] }),
          discard: [...s.discard, ...rest],
        };
      }
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
        eggDiscount: tag.n?.[0] ?? 0,
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
      return n > 0 ? drawCardsChoice(s, playerId, n) : s;
    }
    case 'drawIfTucked': {
      const n = choice.kind === 'handCards' ? choice.cardIds.length : 0;
      return n > 0 ? drawCardsChoice(s, playerId, 1) : s;
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
      const n = isAutoma(s, choice.playerId)
        ? (s.automa?.goalCubes ?? 0)
        : playedBirds(getPlayer(s, choice.playerId)).filter(
            ({ bird: b }) => BIRD_BY_ID.get(b.cardId)!.predator,
          ).length;
      for (let i = 0; i < n; i++) s = cacheOnBird(s, playerId, tag.bird, 'rodent');
      return s;
    }
    case 'eggsPerCube': {
      if (choice.kind !== 'player' || !tag.bird) return s;
      const h = HABITATS[tag.n?.[0] ?? -1];
      if (!h) return s;
      const n = isAutoma(s, choice.playerId)
        ? (s.automa?.goalCubes ?? 0)
        : getPlayer(s, choice.playerId).roundCubes[h];
      if (n <= 0) return s;
      return setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, n));
    }
    case 'cacheWildPerCube': {
      if (choice.kind !== 'player') return s;
      const h = HABITATS[tag.n?.[0] ?? -1];
      if (!h) return s;
      const n = isAutoma(s, choice.playerId)
        ? (s.automa?.goalCubes ?? 0)
        : getPlayer(s, choice.playerId).roundCubes[h];
      if (n <= 0) return s;
      return pushPending(s, { kind: 'chooseCacheOnBirds', playerId, count: n, food: 'any' });
    }
    case 'tuckPerCube': {
      if (choice.kind !== 'player' || !tag.bird) return s;
      const h = HABITATS[tag.n?.[0] ?? -1];
      if (!h) return s;
      const n = isAutoma(s, choice.playerId)
        ? (s.automa?.goalCubes ?? 0)
        : getPlayer(s, choice.playerId).roundCubes[h];
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
      if (isAutoma(s, victim)) {
        // European Automa rule: can only steal from Automa if it has any cubes
        // on this round's goal tile (do not remove cubes). Gain comes from the
        // supply and Automa gains nothing.
        if ((s.automa?.goalCubes ?? 0) <= 0) {
          return appendLog(s, `${victim}: Automa has no cubes on the goal tile`);
        }
        if (fIdx < 0) {
          return pushPending(s, {
            kind: 'chooseSupplyFood',
            playerId,
            count: 1,
            options: 'any',
          });
        }
        const food = FOOD_TYPES[fIdx]!;
        return tag.bird
          ? cacheOnBird(s, playerId, tag.bird, food)
          : grantSupplyFood(s, playerId, food);
      }
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

    // === oceania continuations ===
    case 'copyPower':
      // chooseCopyPower already ran the copied power.
      return s;
    case 'cacheLastGained': {
      if (!tag.bird || !lastGained) return s;
      return cacheOnBird(s, playerId, tag.bird, lastGained);
    }
    case 'giveSupplyFood': {
      // The chosen player gains the food (the actor gives nothing up).
      if (choice.kind !== 'player') return s;
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!f) return s;
      return grantSupplyFood(s, choice.playerId, f);
    }
    case 'giveRodentLayEggs': {
      // "You may give [the rodent] to another player; if you do, lay up to 3 eggs."
      if (choice.kind !== 'player' || !tag.bird) return s;
      const giver = getPlayer(s, playerId);
      if (giver.food.rodent > 0) {
        s = setPlayer(s, spendFood(giver, ['rodent']));
        s = grantSupplyFood(s, choice.playerId, 'rodent');
      }
      return pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId,
        count: 3,
        nest: 'any',
        onlyBird: tag.bird,
        optional: true,
      });
    }
    case 'giveNectar': {
      // Give 1 nectar to the chosen player, then pick 2 eggs on this bird or 2 dice.
      if (choice.kind !== 'player' || !tag.bird) return s;
      const giver = getPlayer(s, playerId);
      if (giver.food.nectar <= 0) return s;
      s = setPlayer(s, spendFood(giver, ['nectar']));
      s = grantSupplyFood(s, choice.playerId, 'nectar');
      return pushPending(s, {
        kind: 'chooseOption',
        playerId,
        options: ['selfEggs2', 'gain2Dice'],
        then: { effect: 'parrotDone', bird: tag.bird },
      });
    }
    case 'galahReset': {
      // The chosen player resets the feeder and gains a seed if there is one;
      // the actor tucks 2 deck cards behind this bird.
      if (choice.kind !== 'player' || !tag.bird) return s;
      let out = feederReset(s, choice.playerId);
      const idx = out.feederIn.findIndex((f) => faceCovers(f, 'seed'));
      if (idx >= 0) out = takeDieFromFeeder(out, choice.playerId, idx, 'seed');
      out = tuckFromDeck(out, playerId, tag.bird, 2);
      return firePinkTriggers(out, playerId, { kind: 'tuck' });
    }
    case 'trayTuck': {
      if (!tag.bird) return s;
      return pushPending(s, {
        kind: 'chooseTrayCardEx',
        playerId,
        destination: 'tuck',
        bird: tag.bird,
      });
    }
    case 'selfEggsUpTo': {
      if (!tag.bird) return s;
      return pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId,
        count: tag.n?.[0] ?? 1,
        nest: 'any',
        onlyBird: tag.bird,
        optional: true,
      });
    }
    case 'kiwiDraw': {
      // Draw 4 bonus cards, keep 2, discard the rest.
      const { s: out, ids: pool } = drawBonusPool(s, 4);
      if (pool.length === 0) return out;
      return pushPending(out, {
        kind: 'chooseBonusCards',
        playerId,
        cardIds: pool,
        keep: Math.min(2, pool.length),
      });
    }
    case 'hornbillTuck': {
      // Discard all eggs from the chosen cavity bird; tuck 2x that many cards.
      if (choice.kind !== 'birds' || choice.birds.length === 0 || !tag.bird) return s;
      const target = choice.birds[0]!;
      const p = getPlayer(s, playerId);
      const n = p.board[target.habitat]?.[target.index]?.eggs ?? 0;
      if (n <= 0) return s;
      const row = [...p.board[target.habitat]];
      row[target.index] = { ...row[target.index]!, eggs: 0 };
      s = setPlayer(s, { ...p, board: { ...p.board, [target.habitat]: row } });
      s = tuckFromDeck(s, playerId, tag.bird, n * 2);
      return firePinkTriggers(s, playerId, { kind: 'tuck' });
    }
    case 'cassowarySwap': {
      // Discard a forest bird and slide this bird into its slot.
      if (choice.kind !== 'birds' || choice.birds.length === 0 || !tag.bird) return s;
      const target = choice.birds[0]!;
      const meRef = tag.bird;
      const p = getPlayer(s, playerId);
      const row = p.board.forest;
      const victim = row[target.index];
      const me = row[meRef.index];
      if (!victim || !me || victim.ghost || me.ghost) return s;
      const gone = [victim.cardId, ...victim.tucked];
      const ghostIdx = row[target.index + 1]?.ghost ? target.index + 1 : -1;
      const next = [...row];
      next[target.index] = { ...me };
      const removeIdxs = [meRef.index, ...(ghostIdx >= 0 ? [ghostIdx] : [])].sort((a, b) => b - a);
      for (const idx of removeIdxs) {
        if (idx !== target.index) next.splice(idx, 1);
      }
      const insertAt = next.findIndex((b) => b.cardId === me.cardId && !b.ghost);
      s = setPlayer(s, { ...p, board: { ...p.board, forest: next } });
      s = { ...s, discard: [...s.discard, ...gone] };
      s = setPlayer(s, addEggs(getPlayer(s, playerId), { habitat: 'forest', index: insertAt }, 4));
      s = grantSupplyFood(s, playerId, 'fruit');
      return grantSupplyFood(s, playerId, 'fruit');
    }
    case 'gainPerFood': {
      const n = choice.kind === 'supplyFood' ? choice.foods.length : 0;
      return n > 0 ? grantSupplyFood(s, playerId, 'nectar', n) : s;
    }
    case 'selfEggsPerFood': {
      if (!tag.bird) return s;
      const n = choice.kind === 'supplyFood' ? choice.foods.length : 0;
      return n > 0 ? setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, n)) : s;
    }
    case 'drawPerFood': {
      const n = choice.kind === 'supplyFood' ? choice.foods.length : 0;
      return n > 0 ? drawFromDeck(s, playerId, n) : s;
    }
    case 'giveOtherCard': {
      // The un-kept drawn card goes to another player.
      if (choice.kind !== 'handCards' || !tag.ids) return s;
      const other = tag.ids.filter((id) => !choice.cardIds.includes(id));
      if (other.length === 0) return s;
      return pushPending(s, {
        kind: 'choosePlayer',
        playerId,
        other: true,
        then: { effect: 'giveCardTo', ids: other },
      });
    }
    case 'giveCardTo': {
      if (choice.kind !== 'player' || !tag.ids?.length) return s;
      const p = getPlayer(s, playerId);
      const moving = tag.ids.filter((id) => p.hand.includes(id));
      if (moving.length === 0) return s;
      s = setPlayer(s, { ...p, hand: p.hand.filter((id) => !moving.includes(id)) });
      if (isAutoma(s, choice.playerId)) {
        return { ...s, discard: [...s.discard, ...moving] };
      }
      const v = getPlayer(s, choice.playerId);
      return setPlayer(s, { ...v, hand: [...v.hand, ...moving] });
    }
    case 'poolTuckOrHand': {
      // Keep the pick (tuck it or keep in hand); the rest of the pool discards.
      if (choice.kind !== 'handCards' || !tag.ids || !tag.bird) return s;
      const chosen = choice.cardIds[0];
      const rest = tag.ids.filter((id) => id !== chosen);
      s = { ...s, discard: [...s.discard, ...rest] };
      if (chosen == null) return s;
      return pushPending(s, {
        kind: 'chooseTuckOrHand',
        playerId,
        bird: tag.bird,
        cardId: chosen,
      });
    }
    case 'keaDraw': {
      // 1 pre-drawn bonus card + 1 per discarded food; keep 1 of the pool.
      const n = choice.kind === 'supplyFood' ? choice.foods.length : 0;
      const { s: out, ids } = drawBonusPool(s, n);
      const pool = [...(tag.ids ?? []), ...ids];
      if (pool.length === 0) return out;
      return pushPending(out, { kind: 'chooseBonusCards', playerId, cardIds: pool, keep: 1 });
    }
    case 'allGainFoodType': {
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!f) return s;
      for (const pid of s.playerOrder) s = grantSupplyFood(s, pid, f);
      return s;
    }
    case 'noisyMiner': {
      // Actor may lay up to 2 on this bird; each other player may lay 1 egg.
      if (!tag.bird) return s;
      const steps: PendingStep[] = [
        {
          kind: 'chooseBirdForEgg',
          playerId,
          count: 2,
          nest: 'any',
          onlyBird: tag.bird,
          optional: true,
        },
        ...s.playerOrder
          .filter((pid) => pid !== playerId)
          .map(
            (pid): PendingStep => ({
              kind: 'chooseBirdForEgg',
              playerId: pid,
              count: 1,
              nest: 'any',
              optional: true,
            }),
          ),
      ];
      return { ...s, pending: [...steps, ...s.pending] };
    }
    case 'gainIfTucked': {
      const n = choice.kind === 'handCards' ? choice.cardIds.length : 0;
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (n <= 0 || !f) return s;
      return grantSupplyFood(s, playerId, f);
    }
    case 'allGainChosen':
      // The chooseFoodType step already granted every player the food.
      return s;
    case 'theyLayYouDraw': {
      if (choice.kind !== 'player') return s;
      s = pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId: choice.playerId,
        count: 1,
        nest: 'any',
      });
      return drawFromDeck(s, playerId, tag.n?.[0] ?? 1);
    }
    case 'bothDraw': {
      if (choice.kind !== 'player') return s;
      s = drawFromDeck(s, playerId, tag.n?.[0] ?? 1);
      return drawFromDeck(s, choice.playerId, tag.n?.[0] ?? 1);
    }
    case 'bothGainSupply': {
      if (choice.kind !== 'player') return s;
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!f) return s;
      s = grantSupplyFood(s, playerId, f);
      return grantSupplyFood(s, choice.playerId, f);
    }
    case 'bothLayEgg': {
      if (choice.kind !== 'player') return s;
      const steps: PendingStep[] = [playerId, choice.playerId].map(
        (pid): PendingStep => ({ kind: 'chooseBirdForEgg', playerId: pid, count: 1, nest: 'any' }),
      );
      return { ...s, pending: [...steps, ...s.pending] };
    }

    // === asia continuations ===
    case 'asiaRiskyRoll': {
      // Roll n[0] dice (roll n[1]+1 of 3); a hit caches 1 of the matching food
      // and offers another roll; a miss returns the n[2] food cached by this
      // power chain.
      if (!tag.bird) return s;
      const dice = tag.n?.[0] ?? 1;
      const wants = (tag.ids ?? []).map((i) => FOOD_TYPES[i]!).filter(Boolean);
      if (wants.length === 0) return s;
      const { s: s1, faces } = rollDice(s, dice);
      s = appendLog(s1, `${playerId}: rolled ${faces.join(', ')}`);
      const hit = wants.find((w) => faces.some((f) => faceCovers(f, w)));
      const rolls = (tag.n?.[1] ?? 0) + 1;
      if (hit) {
        s = cacheOnBird(s, playerId, tag.bird, hit);
        s = firePinkTriggers(s, playerId, { kind: 'predatorSuccess' });
        if (rolls < 3) {
          return pushPending(s, {
            kind: 'confirm',
            playerId,
            then: { ...tag, n: [dice, rolls, (tag.n?.[2] ?? 0) + 1] },
          });
        }
        return s;
      }
      const cached = tag.n?.[2] ?? 0;
      if (cached > 0) {
        const p = getPlayer(s, playerId);
        const row = [...p.board[tag.bird.habitat]];
        const b = row[tag.bird.index];
        if (b) {
          row[tag.bird.index] = {
            ...b,
            cached: b.cached.slice(0, Math.max(0, b.cached.length - cached)),
          };
          s = setPlayer(s, { ...p, board: { ...p.board, [tag.bird.habitat]: row } });
        }
      }
      return s;
    }
    case 'asiaCacheSupplyOn': {
      // Spend `food` from the supply to cache it on the picked bird.
      if (choice.kind !== 'birds' || choice.birds.length === 0) return s;
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!f) return s;
      const p = getPlayer(s, playerId);
      if (p.food[f] <= 0) return s;
      s = setPlayer(s, spendFood(p, [f]));
      return cacheOnBird(s, playerId, choice.birds[0]!, f);
    }
    case 'asiaTrayCheck': {
      // Lay 1 egg if a discarded tray bird matched (0 = grassland, 1 = predator).
      if (!tag.bird || choice.kind !== 'handCards') return s;
      const mode = tag.n?.[0] ?? 0;
      const hit = choice.cardIds.some((id) => {
        const c = bird(id);
        return mode === 0 ? c.habitats.includes('grassland') : c.predator;
      });
      if (!hit) return s;
      return setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, 1));
    }
    case 'asiaPool5': {
      // Pool of 5: 1 went to hand via chooseDrawnCard; now tuck 1 of the rest.
      if (choice.kind !== 'handCards' || !tag.ids || !tag.bird) return s;
      const kept = choice.cardIds[0];
      const rest = tag.ids.filter((id) => id !== kept);
      if (rest.length === 0) return s;
      return pushPending(s, {
        kind: 'chooseDrawnCard',
        playerId,
        cardIds: rest,
        then: { effect: 'asiaPool5Tuck', ids: rest, bird: tag.bird, n: tag.n },
      });
    }
    case 'asiaPool5Tuck': {
      // Tuck the pick (it's in hand now); then give 1 away or discard the rest.
      if (choice.kind !== 'handCards' || !tag.bird || !tag.ids) return s;
      const id = choice.cardIds[0];
      if (id == null) return s;
      const rest = tag.ids.filter((x) => x !== id);
      const p = getPlayer(s, playerId);
      s = setPlayer(s, { ...p, hand: p.hand.filter((x) => x !== id) });
      s = tuckCardOnBird(s, playerId, tag.bird, id);
      s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      if (rest.length === 0) return s;
      if ((tag.n?.[0] ?? 0) === 1) {
        // Give 1 of the remaining cards to another player; discard the rest.
        const give = rest[0]!;
        s = { ...s, discard: [...s.discard, ...rest.slice(1)] };
        return pushPending(s, {
          kind: 'choosePlayer',
          playerId,
          other: true,
          then: { effect: 'asiaGivePool', ids: [give] },
        });
      }
      return { ...s, discard: [...s.discard, ...rest] };
    }
    case 'asiaGivePool': {
      if (choice.kind !== 'player' || !tag.ids?.length) return s;
      if (isAutoma(s, choice.playerId)) {
        return { ...s, discard: [...s.discard, ...tag.ids] };
      }
      const v = getPlayer(s, choice.playerId);
      return setPlayer(s, { ...v, hand: [...v.hand, ...tag.ids] });
    }
    case 'asiaGivePick': {
      // "Give 1 hand card to another player" — the card was picked (still in
      // hand); now pick the receiving player.
      if (choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      return pushPending(s, {
        kind: 'choosePlayer',
        playerId,
        other: true,
        then: { effect: 'asiaGiveTo', ids: [choice.cardIds[0]!], bird: tag.bird, n: tag.n },
      });
    }
    case 'asiaGiveTo': {
      if (choice.kind !== 'player' || !tag.ids?.length) return s;
      const id = tag.ids[0]!;
      const p = getPlayer(s, playerId);
      if (!p.hand.includes(id)) return s;
      s = setPlayer(s, { ...p, hand: p.hand.filter((x) => x !== id) });
      if (isAutoma(s, choice.playerId)) {
        s = { ...s, discard: [...s.discard, id] };
      } else {
        const v = getPlayer(s, choice.playerId);
        s = setPlayer(s, { ...v, hand: [...v.hand, id] });
      }
      if ((tag.n?.[0] ?? 0) === 0) return drawFromDeck(s, playerId, 2);
      return tag.bird ? setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, 2)) : s;
    }
    case 'asiaScoreBonusNow': {
      // Score the picked hand bonus card now: cache 1 food per point on the
      // bird. ids[0] = -1 → any food, else the fixed type. n[0] = 1 → the card
      // is discarded and replaced (still scored once now, not at game end).
      if (choice.kind !== 'bonusCards' || !tag.bird) return s;
      const id = choice.cardIds[0];
      if (id == null) return s;
      const vp = bonusCardVp(getPlayer(s, playerId), id);
      if ((tag.n?.[0] ?? 0) === 1) {
        const p = getPlayer(s, playerId);
        s = setPlayer(s, { ...p, bonusHand: p.bonusHand.filter((x) => x !== id) });
        s = drawBonusToHand({ ...s, bonusDiscard: [...s.bonusDiscard, id] }, playerId, 1).s;
      }
      if (vp <= 0) return s;
      const fIdx = tag.ids?.[0] ?? -1;
      return pushPending(s, {
        kind: 'chooseSupplyFood',
        playerId,
        count: vp,
        options: fIdx >= 0 ? [FOOD_TYPES[fIdx]!] : 'any',
        cache: tag.bird,
      });
    }
    case 'asiaDrawBonus21': {
      // Draw 2 bonus cards, keep 1 (queued for an "other players may" payer).
      const { s: out, ids: pool } = drawBonusPool(s, 2);
      if (pool.length === 0) return out;
      return pushPending(out, { kind: 'chooseBonusCards', playerId, cardIds: pool, keep: 1 });
    }
    case 'asiaEagleEval': {
      // After the reroll chain: ≥3 rodents in the feeder → draw 2 bonus keep 1;
      // then reset the birdfeeder.
      const n = s.feederIn.filter((f) => f === 'rodent').length;
      if (n >= 3) {
        const drawn = drawBonusPool(s, 2);
        s = drawn.s;
        if (drawn.ids.length > 0) {
          s = pushPending(s, { kind: 'chooseBonusCards', playerId, cardIds: drawn.ids, keep: 1 });
        }
      }
      s = { ...s, feederOut: [...s.feederOut, ...s.feederIn], feederIn: [] };
      return refillFeeder(s);
    }
    case 'asiaCrowCache': {
      // Cache 1 wild (own supply) on the picked bird, then may tuck a hand card.
      if (choice.kind !== 'birds' || choice.birds.length === 0 || !tag.bird) return s;
      return pushPending(s, {
        kind: 'chooseCacheFromSupply',
        playerId,
        bird: choice.birds[0]!,
        count: 1,
        food: 'any',
        then: { effect: 'asiaCrowTuck', bird: tag.bird },
      });
    }
    case 'asiaCrowTuck': {
      if (!tag.bird) return s;
      return pushPending(s, { kind: 'chooseHandTuck', playerId, bird: tag.bird, optional: true });
    }
    case 'asiaTuckCacheForest': {
      // On the picked forest bird: may tuck a hand card AND may cache a fruit.
      if (choice.kind !== 'birds' || choice.birds.length === 0) return s;
      const ref = choice.birds[0]!;
      return pushPending(
        s,
        { kind: 'chooseHandTuck', playerId, bird: ref, optional: true },
        {
          kind: 'chooseCacheFromSupply',
          playerId,
          bird: ref,
          count: 1,
          food: 'fruit',
          optional: true,
        },
      );
    }
    case 'asiaPickDieISF':
      return pushPending(s, {
        kind: 'pickDie',
        playerId,
        count: 1,
        faces: ['invertebrate', 'seed', 'fruit'],
      });
    case 'selfEggIfTucked': {
      const n = choice.kind === 'handCards' ? choice.cardIds.length : 0;
      if (n <= 0 || !tag.bird) return s;
      return setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, 1));
    }
    case 'asiaMoveCachedFish': {
      // Cormorant: move 1 fish cached on this bird back to the supply.
      if (!tag.bird) return s;
      const p = getPlayer(s, playerId);
      const b = p.board[tag.bird.habitat]?.[tag.bird.index];
      if (!b || !b.cached.includes('fish')) return s;
      const ci = b.cached.indexOf('fish');
      const row = [...p.board[tag.bird.habitat]];
      row[tag.bird.index] = { ...b, cached: b.cached.filter((_, i) => i !== ci) };
      s = setPlayer(s, { ...p, board: { ...p.board, [tag.bird.habitat]: row } });
      return grantSupplyFood(s, playerId, 'fish');
    }
    case 'asiaDeckTuck': {
      if (!tag.bird) return s;
      s = tuckFromDeck(s, playerId, tag.bird, 1);
      return firePinkTriggers(s, playerId, { kind: 'tuck' });
    }

    // === americas continuations ===
    case 'humEachPlayer': {
      // choice.playerId = who starts; queue an optional hum action per player.
      if (choice.kind !== 'player') return s;
      const mode = tag.n?.[0] === 0 ? 'attract' : tag.n?.[0] === 1 ? 'return' : 'either';
      const start = s.playerOrder.indexOf(choice.playerId);
      if (start < 0) return s;
      const steps = s.playerOrder.map(
        (_, i): PendingStep => ({
          kind: 'chooseHumHabitat',
          playerId: s.playerOrder[(start + i) % s.playerOrder.length]!,
          mode,
          optional: true,
        }),
      );
      return pushPending(s, ...steps);
    }
    case 'humAttractAny':
      return pushPending(s, { kind: 'chooseHumHabitat', playerId, mode: 'attract' });
    case 'humReturnAny':
      return pushPending(s, { kind: 'chooseHumHabitat', playerId, mode: 'return' });
    case 'humReturnRow': {
      if (!tag.bird) return s;
      return queueHumAction(s, playerId, tag.bird.habitat);
    }
    case 'humActionAny':
      return pushPending(s, { kind: 'chooseHumHabitat', playerId, mode: 'either' });
    case 'humDownTuck': {
      if (!tag.bird) return s;
      const out = tuckFromDeck(s, playerId, tag.bird, 2);
      return firePinkTriggers(out, playerId, { kind: 'tuck' });
    }
    case 'poolTuckHum': {
      // The hummingbird cards rest-discarded by choosePoolTuck belong in the
      // hummingbird discard pile, not the bird discard pile.
      const rest = (tag.ids ?? []).length - (choice.kind === 'handCards' ? choice.cardIds.length : 0);
      if (rest <= 0) return s;
      const moved = s.discard.slice(s.discard.length - rest);
      return {
        ...s,
        discard: s.discard.slice(0, s.discard.length - rest),
        humDiscard: [...s.humDiscard, ...moved],
      };
    }
    case 'amCacheAllGain': {
      const f = choice.kind === 'supplyFood' ? choice.foods[0] : null;
      if (!f) return s;
      let out = s;
      for (const pid of out.playerOrder) out = grantSupplyFood(out, pid, f);
      return out;
    }
    case 'amSeriema': {
      // Reset the feeder, gain all seeds showing, cache a rodent if shown.
      if (!tag.bird) return s;
      let out = appendLog(feederReset(s, playerId), `${playerId}: reset the birdfeeder`);
      const seeds = out.feederIn.filter((f) => faceCovers(f, 'seed')).length;
      if (seeds > 0) out = grantSupplyFood(out, playerId, 'seed', seeds);
      if (out.feederIn.some((f) => faceCovers(f, 'rodent'))) {
        out = cacheOnBird(out, playerId, tag.bird, 'rodent');
      }
      return out;
    }
    case 'amDraw2PoolTuck': {
      if (!tag.bird) return s;
      const { s: s1, ids } = drawToPool(s, 2);
      if (ids.length === 0) return s1;
      return pushPending(s1, {
        kind: 'choosePoolTuck',
        playerId,
        cardIds: ids,
        count: 2,
        min: 0,
        bird: tag.bird,
        rest: 'hand',
      });
    }
    case 'amSungrebe1': {
      // Drew 1 for the first egg; offer a second egg discard for 2 more.
      const out = drawFromDeck(s, playerId, 1);
      return pushPending(out, {
        kind: 'chooseBirdForEggDiscard',
        playerId,
        count: 1,
        optional: true,
        then: { effect: 'drawCards', n: [2] },
      });
    }
    case 'amSeedeater1': {
      // Left/right neighbours in the same row get 1 egg each; then offer a
      // second seed discard for 1 egg on this bird.
      if (!tag.bird) return s;
      let p = getPlayer(s, playerId);
      for (const di of [-1, 1]) {
        const b = p.board[tag.bird.habitat]?.[tag.bird.index + di];
        if (b && !b.ghost && b.eggs < bird(b.cardId).eggLimit) {
          p = addEggs(p, { habitat: tag.bird.habitat, index: tag.bird.index + di }, 1);
        }
      }
      const out = setPlayer(s, p);
      return pushPending(out, {
        kind: 'chooseFoodDiscard',
        playerId,
        count: 1,
        options: ['seed'],
        optional: true,
        then: { effect: 'selfEgg', bird: tag.bird },
      });
    }
    case 'amCacheInv':
      if (!tag.bird) return s;
      return cacheOnBird(s, playerId, tag.bird, 'invertebrate');
    case 'amCacheInvOrRodent':
      if (!tag.bird) return s;
      return pushPending(s, {
        kind: 'chooseSupplyFood',
        playerId,
        count: 1,
        options: ['invertebrate', 'rodent'],
        cache: tag.bird,
      });
    case 'amGainCatchUp': {
      const f = choice.kind === 'supplyFood' ? choice.foods[0] : null;
      if (!f) return s;
      const mine = getPlayer(s, playerId).food[f];
      let out = s;
      for (const pid of out.playerOrder) {
        if (pid !== playerId && getPlayer(out, pid).food[f] < mine) {
          out = grantSupplyFood(out, pid, f);
        }
      }
      return out;
    }
    case 'amGiveInvGain2': {
      if (choice.kind !== 'player') return s;
      const me = getPlayer(s, playerId);
      if (me.food.invertebrate <= 0) return appendLog(s, `${playerId}: no invertebrate to give`);
      let out = setPlayer(s, spendFood(me, ['invertebrate']));
      out = setPlayer(out, addFood(getPlayer(out, choice.playerId), 'invertebrate'));
      return grantSupplyFood(out, playerId, 'invertebrate', 2);
    }
    case 'supplyFoodList':
      return pushPending(s, {
        kind: 'chooseSupplyFood',
        playerId,
        count: 1,
        options: [...BASE_FOODS],
      });
    case 'amCacheEach': {
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!f || choice.kind !== 'birds') return s;
      let out = s;
      for (const ref of choice.birds) out = cacheOnBird(out, playerId, ref, f);
      return out;
    }
    case 'amTuckEachDraw': {
      if (choice.kind !== 'birds' || choice.birds.length === 0) return s;
      return pushPending(s, {
        kind: 'assignHandTucks',
        playerId,
        targets: choice.birds,
        then: { effect: 'drawPerTucked' },
      });
    }
    case 'amCopyGrassland': {
      if (choice.kind !== 'player' || !tag.bird) return s;
      return pushPending(s, {
        kind: 'chooseCopyPower',
        playerId,
        target: choice.playerId,
        habitat: 'grassland',
        then: { effect: 'copyPower', bird: tag.bird },
      });
    }
    case 'amCopyRight': {
      const t = playerToRight(s, playerId);
      if (t == null || !tag.bird) return s;
      return pushPending(s, {
        kind: 'chooseCopyPower',
        playerId,
        target: t,
        habitat: 'any',
        then: { effect: 'copyPower', bird: tag.bird },
      });
    }
    case 'amCubeMove': {
      // The action cube moved to the new habitat with the bird: continue the
      // activation there (remaining brown powers) and take that row's
      // hummingbird action when it drains.
      if (choice.kind !== 'habitat') return s;
      const h = choice.habitat;
      const p = getPlayer(s, playerId);
      const lastIdx = p.board[h].length - 1;
      const remaining: number[] = [];
      for (let i = lastIdx - 1; i >= 0; i--) {
        const b = p.board[h][i]!;
        if (b.ghost) continue;
        const c = bird(b.cardId);
        if (c.powerColor === 'brown' && c.powerText && hasPowerImpl(c.id)) remaining.push(i);
      }
      const next: GameState = {
        ...s,
        activation: remaining.length ? { habitat: h, remaining } : null,
        humAction: s.humAction != null ? h : s.humAction,
      };
      return next.turnTookAction && next.activation == null ? queueRowHumAction(next, playerId) : next;
    }
    case 'amRepeatAll': {
      // Re-offer the row's brown powers until declined (ids = used indexes).
      if (choice.kind !== 'repeatTarget' || !tag.bird) return s;
      const used = [...(tag.ids ?? []), choice.bird.index];
      return pushPending(s, {
        kind: 'chooseRepeatPower',
        playerId,
        habitat: tag.bird.habitat,
        excludeIds: used,
        optional: true,
        then: { ...tag, ids: used },
      });
    }
    case 'amSunbittern': {
      // The non-kept cards discard; the power's owner may tuck 1 of them
      // instead (choosePoolTuck discards the remainder via `rest`).
      if (choice.kind !== 'handCards') return s;
      const rest = (tag.ids ?? []).filter((id) => !choice.cardIds.includes(id));
      if (tag.bird && rest.length > 0) {
        return pushPending(s, {
          kind: 'choosePoolTuck',
          playerId,
          cardIds: rest,
          count: 1,
          min: 0,
          bird: tag.bird,
          rest: 'discard',
        });
      }
      return { ...s, discard: [...s.discard, ...rest] };
    }
    case 'amWarbler': {
      // The picker's kept card stays in hand; the other comes to the actor's
      // pool. After every other player drew-and-kept, the actor draws 2 more
      // and keeps 2 of the whole pool.
      if (choice.kind !== 'handCards' || step.kind !== 'chooseDrawnCard') return s;
      const gift = step.cardIds.filter((id) => !choice.cardIds.includes(id));
      const gifts = [...(tag.ids ?? []), ...gift];
      const actorIdx = tag.n?.[1] ?? 0;
      const actor = s.playerOrder[actorIdx]!;
      const others = s.playerOrder.filter((x) => x !== actor);
      const next = tag.n?.[0] ?? 1;
      if (next < others.length) {
        const { s: s1, ids } = drawToPool(s, 2);
        if (ids.length === 0) {
          return pushPending(s1, {
            kind: 'chooseDrawnCard',
            playerId: actor,
            cardIds: gifts,
            keep: Math.min(2, gifts.length),
            discardRest: true,
          });
        }
        return pushPending(s1, {
          kind: 'chooseDrawnCard',
          playerId: others[next]!,
          cardIds: ids,
          then: { effect: 'amWarbler', ids: gifts, n: [next + 1, actorIdx] },
        });
      }
      const { s: s1, ids } = drawToPool(s, 2);
      return pushPending(s1, {
        kind: 'chooseDrawnCard',
        playerId: actor,
        cardIds: [...gifts, ...ids],
        keep: Math.min(2, gifts.length + ids.length),
        discardRest: true,
      });
    }
    case 'amBonusDraft': {
      // n[0] = offset (from the actor) of the player who just chose; pass the
      // remaining pool clockwise; the actor keeps the last card.
      if (choice.kind !== 'bonusCards') return s;
      const remaining = (tag.ids ?? []).filter((id) => !choice.cardIds.includes(id));
      const actorIdx = tag.n?.[1] ?? 0;
      const nextOffset = (tag.n?.[0] ?? 0) + 1;
      if (nextOffset >= s.playerOrder.length || remaining.length === 0) {
        const p = getPlayer(s, s.playerOrder[actorIdx]!);
        return setPlayer(s, { ...p, bonusHand: [...p.bonusHand, ...remaining] });
      }
      const nextPid = s.playerOrder[(actorIdx + nextOffset) % s.playerOrder.length]!;
      if (isAutoma(s, nextPid)) {
        const p = getPlayer(s, s.playerOrder[actorIdx]!);
        const keep = remaining.slice(0, 1);
        const rest = remaining.slice(1);
        return {
          ...setPlayer(s, { ...p, bonusHand: [...p.bonusHand, ...keep] }),
          bonusDiscard: [...s.bonusDiscard, ...rest],
        };
      }
      return pushPending(s, {
        kind: 'chooseBonusCards',
        playerId: nextPid,
        cardIds: remaining,
        keep: 1,
        then: { effect: 'amBonusDraft', ids: remaining, n: [nextOffset, actorIdx] },
      });
    }
    case 'amTraySwap1': {
      if (choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      return pushPending(s, {
        kind: 'chooseTrayCard',
        playerId,
        peek: true,
        then: { effect: 'amTraySwap2', ids: [choice.cardIds[0]!] },
      });
    }
    case 'amTraySwap2': {
      // Swap the picked hand card (tag.ids[0]) with the picked tray card.
      const handId = tag.ids?.[0];
      const trayId = choice.kind === 'handCards' ? choice.cardIds[0] : undefined;
      if (handId == null || trayId == null) return s;
      const p = getPlayer(s, playerId);
      if (!p.hand.includes(handId)) return s;
      const tray = s.tray.map((id) => (id === trayId ? handId : id));
      const out = setPlayer(s, {
        ...p,
        hand: p.hand.map((id) => (id === handId ? trayId : id)),
      });
      return { ...out, tray };
    }
    case 'amEggsOut': {
      // Move up to 3 eggs from this bird onto the chosen birds (1 each).
      if (choice.kind !== 'birds' || !tag.bird) return s;
      let p = getPlayer(s, playerId);
      const src0 = p.board[tag.bird.habitat]?.[tag.bird.index];
      if (!src0 || src0.eggs <= 0) return s;
      let moved = 0;
      for (const ref of choice.birds) {
        if (moved >= src0.eggs) break;
        const b = p.board[ref.habitat]?.[ref.index];
        if (!b || b.ghost || b.eggs >= bird(b.cardId).eggLimit) continue;
        const tgtRow = [...p.board[ref.habitat]];
        tgtRow[ref.index] = { ...b, eggs: b.eggs + 1 };
        p = { ...p, board: { ...p.board, [ref.habitat]: tgtRow } };
        moved++;
      }
      const src = p.board[tag.bird.habitat]?.[tag.bird.index];
      if (src && moved > 0) {
        const row = [...p.board[tag.bird.habitat]];
        row[tag.bird.index] = { ...src, eggs: Math.max(0, src.eggs - moved) };
        p = { ...p, board: { ...p.board, [tag.bird.habitat]: row } };
      }
      return setPlayer(s, p);
    }
    case 'optionBird':
      // Marker tag — chooseOption already applied the option's effect.
      return s;

    // === promo continuations ===
    case 'promoWigeonBirds': {
      if (choice.kind !== 'birds' || choice.birds.length === 0) return s;
      return pushPending(s, {
        kind: 'chooseHandTuck',
        playerId,
        bird: choice.birds[0]!,
        optional: true,
        then: tag.bird ? { effect: 'promoWigeonDeckTuck', bird: tag.bird } : undefined,
      });
    }
    case 'promoWigeonDeckTuck': {
      if (!tag.bird) return s;
      const out = tuckFromDeck(s, playerId, tag.bird, 1);
      return firePinkTriggers(out, playerId, { kind: 'tuck' });
    }
    case 'promoBaliStarling': {
      if (choice.kind !== 'boolean' || !choice.yes) return s;
      const lastId = tag.ids?.[0];
      const left = (tag.n?.[0] ?? 1) - 1;
      let out = s;
      if (lastId != null) {
        const p = getPlayer(out, playerId);
        out = {
          ...setPlayer(out, { ...p, bonusHand: p.bonusHand.filter((x) => x !== lastId) }),
          bonusDiscard: [...out.bonusDiscard, lastId],
        };
      }
      const drawn = drawBonusToHand(out, playerId, 1);
      const newId = drawn.ids[0];
      if (newId == null) return out;
      out = firePinkTriggers(drawn.s, playerId, { kind: 'drawBonus' });
      if (left <= 0 || out.bonusDeck.length === 0) return out;
      return pushPending(out, {
        kind: 'confirm',
        playerId,
        then: { effect: 'promoBaliStarling', ids: [newId], n: [left] },
      });
    }
    case 'promoRosyFinch': {
      if (choice.kind !== 'bonusCards' || !tag.bird || !tag.ids) return s;
      const other = tag.ids.find((id) => !choice.cardIds.includes(id));
      if (other == null) return s;
      const vp = bonusCardVp(getPlayer(s, playerId), other);
      if (vp <= 0) return s;
      return setPlayer(s, addEggs(getPlayer(s, playerId), tag.bird, vp));
    }
    case 'promoPlayFromTray': {
      if (choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      const cardId = choice.cardIds[0]!;
      const idx = s.tray.indexOf(cardId);
      if (idx < 0) return s;
      const p0 = getPlayer(s, playerId);
      const card = bird(cardId);
      const hab = card.habitats.find(
        (h) =>
          p0.board[h].length < 5 &&
          totalEggsAvail(p0) >= playEggCost(p0, h) &&
          payFoodPlan(p0.food, card.cost) != null,
      );
      if (!hab) return s;
      const tray = [...s.tray];
      tray[idx] = null;
      const out = setPlayer({ ...s, tray }, { ...p0, hand: [...p0.hand, cardId] });
      return playAdditionalBird(out, playerId, cardId, hab, 0);
    }
    case 'promoBonusIfPlayed': {
      if (choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      const { s: out, ids } = drawBonusToHand(s, playerId, 1);
      return ids.length === 0 ? out : firePinkTriggers(out, playerId, { kind: 'drawBonus' });
    }
    case 'promoBrahminyStarling': {
      if (!tag.bird || choice.kind !== 'supplyFood' || choice.foods.length === 0) return s;
      let out = tuckFromDeck(s, playerId, tag.bird, choice.foods.length);
      out = firePinkTriggers(out, playerId, { kind: 'tuck' });
      return pushPending(out, { kind: 'pickDie', playerId, count: 1 });
    }
    case 'promoActivateIfBrown': {
      if (choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      const p = getPlayer(s, playerId);
      const row = p.board.forest;
      const idx = row.length - 1;
      const b = row[idx];
      if (!b || b.ghost) return s;
      const c = bird(b.cardId);
      if (c.powerColor !== 'brown' || !c.powerText) return s;
      return runPower(s, playerId, { habitat: 'forest', index: idx });
    }
    case 'promoCactusWren': {
      if (choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      const nest = bird(choice.cardIds[0]!).nest;
      if (nest === 'none') return s;
      return pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId,
        count: 2,
        nest: nest === 'wild' ? 'any' : nest,
        optional: true,
      });
    }
    case 'promoCanadaJay': {
      if (!tag.bird) return s;
      const b = getPlayer(s, playerId).board[tag.bird.habitat]?.[tag.bird.index];
      const cachedTypes = b ? [...new Set(b.cached)] : [];
      if (cachedTypes.length === 0) return s;
      return pushPending(s, { kind: 'chooseSupplyFood', playerId, count: 1, options: cachedTypes });
    }
    case 'promoCommonEider': {
      if (!tag.bird || choice.kind !== 'birds' || choice.birds.length === 0) return s;
      const target = choice.birds[0]!;
      let p = getPlayer(s, playerId);
      const src = p.board[tag.bird.habitat]?.[tag.bird.index];
      const dst = p.board[target.habitat]?.[target.index];
      if (!src || src.eggs <= 0 || !dst || dst.eggs >= bird(dst.cardId).eggLimit) return s;
      const srcRow = [...p.board[tag.bird.habitat]];
      srcRow[tag.bird.index] = { ...src, eggs: src.eggs - 1 };
      p = { ...p, board: { ...p.board, [tag.bird.habitat]: srcRow } };
      p = addEggs(p, target, 1);
      return drawFromDeck(setPlayer(s, p), playerId, 1);
    }
    case 'promoTragopan1': {
      if (!tag.bird || choice.kind !== 'supplyFood' || choice.foods.length === 0) return s;
      return pushPending(s, {
        kind: 'choosePlayer',
        playerId,
        other: true,
        then: {
          effect: 'promoTragopan2',
          bird: tag.bird,
          ids: [FOOD_TYPES.indexOf(choice.foods[0]!)],
        },
      });
    }
    case 'promoTragopan2': {
      if (!tag.bird || choice.kind !== 'player') return s;
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      let out = s;
      if (f) out = grantSupplyFood(out, choice.playerId, f);
      return setPlayer(out, addEggs(getPlayer(out, playerId), tag.bird, 2));
    }
    case 'promoReturnRestToDeck': {
      if (choice.kind !== 'handCards' || !tag.ids) return s;
      const rest = tag.ids.filter((id) => !choice.cardIds.includes(id));
      return { ...s, deck: [...s.deck, ...rest] };
    }
    case 'promoDovekie': {
      if (choice.kind !== 'player') return s;
      const target = getPlayer(s, choice.playerId);
      const n = playedBirds(target).filter(({ bird: b }) => bird(b.cardId).powerColor === 'yellow').length;
      if (n <= 0) return s;
      const { s: s1, ids } = drawToPool(s, n);
      if (ids.length === 0) return s1;
      return offerPoolPlay(s1, playerId, ids);
    }
    case 'promoWhipPoorWill': {
      const paid = choice.kind === 'supplyFood' ? choice.foods.length : 0;
      return drawBonusKeep(s, playerId, 2, paid >= 2 ? 2 : 1);
    }
    case 'promoGoldenPlover':
      return pushPending(s, {
        kind: 'chooseFirstPlayer',
        playerId,
        effect: 'gainDie',
        then: { effect: 'eachPlayerDie' },
      });
    case 'promoDrawTopDiscard': {
      if (s.discard.length === 0) return s;
      const id = s.discard[s.discard.length - 1]!;
      const p = getPlayer(s, playerId);
      return {
        ...setPlayer(s, { ...p, hand: [...p.hand, id] }),
        discard: s.discard.slice(0, -1),
      };
    }
    case 'promoGardenWarbler': {
      if (!tag.bird || choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      let p = getPlayer(s, playerId);
      p = addEggs(p, tag.bird, 1);
      const newIdx = p.board[tag.bird.habitat].length - 1;
      if (newIdx >= 0 && newIdx !== tag.bird.index) {
        p = addEggs(p, { habitat: tag.bird.habitat, index: newIdx }, 1);
      }
      return setPlayer(s, p);
    }
    case 'promoCacheFishPerBonus': {
      if (!tag.bird || choice.kind !== 'bonusCards' || choice.cardIds.length === 0) return s;
      const n = (tag.n?.[0] ?? 3) * choice.cardIds.length;
      let out = s;
      for (let i = 0; i < n; i++) out = cacheOnBird(out, playerId, tag.bird, 'fish');
      return out;
    }
    case 'promoForestEgg':
      return pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId,
        count: 1,
        nest: 'any',
        habitat: 'forest',
        optional: true,
      });
    case 'promoTuckOrHandReturnDeck': {
      if (choice.kind !== 'handCards' || !tag.ids || !tag.bird) return s;
      const chosen = choice.cardIds[0];
      const rest = tag.ids.filter((id) => id !== chosen);
      s = { ...s, deck: [...s.deck, ...rest] };
      if (chosen == null) return s;
      return pushPending(s, {
        kind: 'chooseTuckOrHand',
        playerId,
        bird: tag.bird,
        cardId: chosen,
      });
    }
    case 'promoTuckTrayUpTo2': {
      if (!tag.bird) return s;
      return pushPending(
        s,
        { kind: 'chooseTrayCardEx', playerId, destination: 'tuck', bird: tag.bird },
        { kind: 'chooseTrayCardEx', playerId, destination: 'tuck', bird: tag.bird },
      );
    }
    case 'promoPrairieChicken': {
      if (choice.kind !== 'bonusCards' || !tag.ids) return s;
      const revealed = tag.ids.find((id) => !choice.cardIds.includes(id));
      if (revealed == null) return s;
      return {
        ...s,
        bonusDiscard: s.bonusDiscard.filter((id) => id !== revealed),
        players: s.players.map((pl) => ({
          ...pl,
          copiedBonus: [...pl.copiedBonus, revealed],
        })),
      };
    }
    case 'promoMagentaPetrel1': {
      if (!tag.bird || choice.kind !== 'bonusCards' || choice.cardIds.length === 0) return s;
      return pushPending(s, {
        kind: 'choosePlayer',
        playerId,
        other: true,
        then: { effect: 'promoMagentaPetrel2', bird: tag.bird, ids: [choice.cardIds[0]!] },
      });
    }
    case 'promoMagentaPetrel2': {
      if (!tag.bird || choice.kind !== 'player' || !tag.ids?.length) return s;
      const gift = tag.ids[0]!;
      const p = getPlayer(s, playerId);
      if (!p.bonusHand.includes(gift)) return s;
      let out = setPlayer(s, { ...p, bonusHand: p.bonusHand.filter((x) => x !== gift) });
      const tp = getPlayer(out, choice.playerId);
      out = setPlayer(out, { ...tp, bonusHand: [...tp.bonusHand, gift] });
      const drawn = drawBonusToHand(out, playerId, 2);
      out = drawn.ids.length > 0 ? firePinkTriggers(drawn.s, playerId, { kind: 'drawBonus' }) : drawn.s;
      return setPlayer(out, addEggs(getPlayer(out, playerId), tag.bird, 1));
    }
    case 'promoMedShearwater': {
      return drawBonusKeep1(drawFromDeck(s, playerId, 1), playerId, 4);
    }
    case 'promoDabchick': {
      if (choice.kind !== 'handCards' || !tag.ids) return s;
      const rest = tag.ids.filter((id) => !choice.cardIds.includes(id));
      const toDeck = rest.slice(0, 1);
      const toDiscard = rest.slice(1);
      return {
        ...s,
        deck: [...s.deck, ...toDeck],
        discard: [...s.discard, ...toDiscard],
      };
    }
    case 'promoFairyTern': {
      if (!tag.bird) return s;
      const n = choice.kind === 'bonusCards' ? choice.cardIds.length * 3 : 0;
      let out = s;
      for (let i = 0; i < n; i++) out = cacheOnBird(out, playerId, tag.bird, 'fish');
      const drawn = drawBonusToHand(out, playerId, 1);
      return drawn.ids.length > 0 ? firePinkTriggers(drawn.s, playerId, { kind: 'drawBonus' }) : drawn.s;
    }
    case 'promoCacheRodent':
      return tag.bird ? cacheOnBird(s, playerId, tag.bird, 'rodent') : s;
    case 'promoDraw1BonusChain': {
      const drawn = drawBonusToHand(s, playerId, 1);
      if (drawn.ids.length === 0) return s;
      const out = firePinkTriggers(drawn.s, playerId, { kind: 'drawBonus' });
      const left = (tag.n?.[0] ?? 1) - 1;
      if (left <= 0 || out.bonusDeck.length === 0) return out;
      return pushPending(out, {
        kind: 'discardBonusCards',
        playerId,
        count: 1,
        optional: true,
        then: { effect: 'promoDraw1BonusChain', n: [left] },
      });
    }
    case 'promoCachePerTuckedCost': {
      const ref = step.kind === 'chooseHandTuck' ? step.bird : tag.bird;
      const f = FOOD_TYPES[tag.ids?.[0] ?? -1];
      if (!ref || !f || choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      const n = foodIconsInCost(bird(choice.cardIds[0]!), f);
      let out = s;
      for (let i = 0; i < n; i++) out = cacheOnBird(out, playerId, ref, f);
      return out;
    }
    case 'promoQupanuaq': {
      const n = choice.kind === 'handCards' ? choice.cardIds.length : 0;
      if (n <= 0) return s;
      return drawBonusKeep1(s, playerId, n);
    }
    case 'promoGain1Die':
      return pushPending(s, { kind: 'pickDie', playerId, count: 1 });
    case 'promoBonusDraftEach': {
      if (choice.kind !== 'bonusCards') return s;
      const remaining = (tag.ids ?? []).filter((id) => !choice.cardIds.includes(id));
      const actorIdx = tag.n?.[1] ?? 0;
      const nextOffset = (tag.n?.[0] ?? 0) + 1;
      if (nextOffset >= s.playerOrder.length || remaining.length === 0) return s;
      const nextPid = s.playerOrder[(actorIdx + nextOffset) % s.playerOrder.length]!;
      if (isAutoma(s, nextPid)) {
        return { ...s, bonusDiscard: [...s.bonusDiscard, ...remaining] };
      }
      return pushPending(s, {
        kind: 'chooseBonusCards',
        playerId: nextPid,
        cardIds: remaining,
        keep: 1,
        then: { effect: 'promoBonusDraftEach', ids: remaining, n: [nextOffset, actorIdx] },
      });
    }
    case 'promoSandwichTern': {
      if (!tag.bird || choice.kind !== 'player') return s;
      const p = getPlayer(s, playerId);
      if (p.food.fish <= 0) return s;
      let out = setPlayer(s, spendFood(p, ['fish']));
      out = grantSupplyFood(out, choice.playerId, 'fish');
      out = tuckFromDeck(out, playerId, tag.bird, 1);
      out = firePinkTriggers(out, playerId, { kind: 'tuck' });
      return setPlayer(out, addEggs(getPlayer(out, playerId), tag.bird, 1));
    }
    case 'promoShorePlover': {
      const n = choice.kind === 'supplyFood' ? choice.foods.length * 2 : 0;
      const { s: out, ids } = drawBonusPool(s, n);
      const pool = [...(tag.ids ?? []), ...ids];
      if (pool.length === 0) return out;
      return pushPending(out, { kind: 'chooseBonusCards', playerId, cardIds: pool, keep: 1 });
    }
    case 'promoSaddleback': {
      if (!tag.bird || choice.kind !== 'handCards' || choice.cardIds.length === 0) return s;
      const playedCard = bird(choice.cardIds[0]!);
      let out = s;
      if (playedCard.cost.kind === 'and') {
        for (const item of playedCard.cost.items) {
          const f: FoodType = item.food === 'any' ? 'seed' : item.food;
          for (let i = 0; i < item.count; i++) out = cacheOnBird(out, playerId, tag.bird, f);
        }
      } else if (playedCard.cost.kind === 'or' && playedCard.cost.foods[0]) {
        out = cacheOnBird(out, playerId, tag.bird, playedCard.cost.foods[0]);
      } else if (playedCard.cost.kind === 'any') {
        for (let i = 0; i < playedCard.cost.count; i++) {
          out = cacheOnBird(out, playerId, tag.bird, 'seed');
        }
      }
      return out;
    }
    case 'promoStitchbird': {
      if (!tag.bird) return s;
      const { s: s1, ids } = drawToPool(s, 1);
      const id = ids[0];
      if (id == null) return s1;
      const out: GameState = { ...s1, discard: [...s1.discard, id] };
      const c = bird(id);
      const eggs = c.beakLeft === true || c.id === 91 ? 2 : 1;
      return setPlayer(out, addEggs(getPlayer(out, playerId), tag.bird, eggs));
    }
    case 'promoSuluHornbill': {
      if (choice.kind !== 'player') return s;
      const target = getPlayer(s, choice.playerId);
      const n = playedBirds(target).filter(({ bird: b }) => bird(b.cardId).bonusPower).length;
      if (n <= 0) return s;
      const { s: out, ids: pool } = drawBonusPool(s, n);
      if (pool.length === 0) return out;
      return pushPending(out, { kind: 'chooseBonusCards', playerId, cardIds: pool, keep: 1 });
    }
    case 'promoTaiwanMagpie': {
      if (!tag.bird) return s;
      return pushPending(
        s,
        { kind: 'pickDie', playerId, count: 1, then: { effect: 'cacheLastGained', bird: tag.bird } },
        { kind: 'pickDie', playerId, count: 1 },
      );
    }
    case 'promoGiveOtherBonus': {
      if (choice.kind !== 'bonusCards' || !tag.ids || s.players.length < 2) return s;
      const other = tag.ids.find((id) => !choice.cardIds.includes(id));
      if (other == null) return s;
      return pushPending(s, {
        kind: 'choosePlayer',
        playerId,
        other: true,
        then: { effect: 'promoGiveBonusTo', ids: [other] },
      });
    }
    case 'promoGiveBonusTo': {
      if (choice.kind !== 'player' || !tag.ids?.length) return s;
      const gift = tag.ids[0]!;
      if (isAutoma(s, choice.playerId)) return s;
      const tp = getPlayer(s, choice.playerId);
      return {
        ...setPlayer(s, { ...tp, bonusHand: [...tp.bonusHand, gift] }),
        bonusDiscard: s.bonusDiscard.filter((id) => id !== gift),
      };
    }
    case 'promoJackdawDice': {
      const n = choice.kind === 'supplyFood' ? choice.foods.length : 0;
      if (n <= 0) return s;
      return pushPending(s, { kind: 'pickDie', playerId, count: n });
    }
    case 'promoDeckTuckPerCube': {
      if (!tag.bird || choice.kind !== 'player') return s;
      const h = HABITATS[tag.n?.[0] ?? -1];
      if (!h) return s;
      const n = isAutoma(s, choice.playerId)
        ? (s.automa?.goalCubes ?? 0)
        : getPlayer(s, choice.playerId).roundCubes[h];
      if (n <= 0) return s;
      const out = tuckFromDeck(s, playerId, tag.bird, n);
      return firePinkTriggers(out, playerId, { kind: 'tuck' });
    }
    default:
      return s;
  }
}

/** First habitat where `cardId` can be legally played by `p` right now. */
function autoPickHabitat(
  p: ReturnType<typeof getPlayer>,
  cardId: number,
  eggDiscount = 0,
  foodDiscount?: FoodType,
): Habitat {
  const card = bird(cardId);
  for (const h of card.habitats) {
    if (p.board[h].length >= 5) continue;
    const baseEggs = playEggCost(p, h);
    const discEggs = Math.max(0, baseEggs - eggDiscount);
    const totalEggsOnMat = totalEggsAvail(p);
    if (totalEggsOnMat >= discEggs && payFoodPlan(p.food, card.cost) != null) return h;
    if (
      foodDiscount &&
      totalEggsOnMat >= baseEggs &&
      payFoodPlan(p.food, discountFoodCost(card.cost, foodDiscount)) != null
    ) {
      return h;
    }
  }
  throw new Error('no habitat can take this bird');
}

/** Play an additional bird from a "play additional bird" power: normal food
 *  + column egg cost, no cube, when-played powers and pink triggers fire. */
function playAdditionalBird(
  state: GameState,
  playerId: PlayerId,
  cardId: number,
  habitat: 'forest' | 'grassland' | 'wetland',
  eggDiscount = 0,
  foodDiscount?: FoodType,
  pay: { foodPayments?: FoodType[]; eggPayments?: BirdRef[]; ignore?: 'food' | 'egg' } = {},
): GameState {
  const p = getPlayer(state, playerId);
  const card = bird(cardId);
  if (!p.hand.includes(cardId)) throw new Error('card not in hand');
  if (!card.habitats.includes(habitat)) throw new Error(`this bird can't live in the ${habitat}`);
  if (p.board[habitat].length >= 5) throw new Error('row is full');
  const slot = p.board[habitat].length;
  const baseEggCost = playEggCost(p, habitat);
  const discEggCost = Math.max(0, baseEggCost - eggDiscount);
  const discFoodCost = discountFoodCost(card.cost, foodDiscount);
  const fullPaid = payFoodPlan(p.food, card.cost);
  const discPaid = foodDiscount ? payFoodPlan(p.food, discFoodCost) : null;
  // "You may ignore 1 [food] or 1 [egg] in its cost": the player's pick
  // (`pay.ignore`); by default, the food discount when it's needed to afford
  // the food or the column egg cost is 0.
  const ignoreFood =
    foodDiscount != null &&
    (pay.ignore === 'food' ||
      (pay.ignore == null &&
        !!discPaid &&
        totalEggsAvail(p) >= baseEggCost &&
        (!fullPaid || baseEggCost === 0 || discPaid.length < fullPaid.length)));
  const foodCost = ignoreFood ? discFoodCost : card.cost;
  let paid: FoodType[] | null = ignoreFood ? discPaid : fullPaid;
  const eggCost = ignoreFood ? baseEggCost : discEggCost;
  if (pay.foodPayments) {
    // The player's own tokens (2-for-1 and nectar as wild allowed).
    const have = { ...p.food };
    for (const f of pay.foodPayments) {
      if ((have[f] ?? 0) <= 0) throw new Error(`you don't have ${f}`);
      have[f]--;
    }
    const counts: Record<FoodType, number> = { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 };
    for (const f of pay.foodPayments) counts[f]++;
    if (payFoodPlan(counts, foodCost) === null) throw new Error('food payment does not cover the cost');
    paid = pay.foodPayments;
  }
  if (!paid) throw new Error('cannot afford the food cost');
  if (eggCost > 0 && totalEggsAvail(p) < eggCost) throw new Error('not enough eggs for the column');

  let pl = spendFood(p, paid!);
  if (pay.eggPayments) {
    // "Discarding eggs from any birds on your player mat" — the player's picks.
    if (pay.eggPayments.length !== eggCost) throw new Error(`pay ${eggCost} egg(s)`);
    for (const r of pay.eggPayments) {
      const row = [...pl.board[r.habitat]];
      const b = row[r.index];
      if (!b || b.ghost || b.eggs <= 0) throw new Error('no egg on that bird');
      row[r.index] = { ...b, eggs: b.eggs - 1 };
      pl = { ...pl, board: { ...pl.board, [r.habitat]: row } };
    }
  } else {
    // Default: eggs from the birds in board order.
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
    horneroEggs: pl.horneroEggs.filter((h) => h !== habitat),
  };
  let s = setPlayer(state, pl);
  const ref: BirdRef = { habitat, index: slot };
  if (isDuet(s)) {
    for (let i = 0; i < (isGoalDouble(card) ? 2 : 1); i++) {
      s = pushPending(s, {
        kind: 'chooseDuetSpace',
        playerId,
        cardId: card.id,
        habitat,
        foods: paid,
      });
    }
  }
  if (card.powerColor === 'white' && card.powerText) {
    s = runPower(s, playerId, ref);
  }
  // EE rulebook: a bird with a round-end power played during round-end
  // resolution (e.g. by Yellowhammer) triggers its power when played.
  if (s.phase === 'roundEnd' && card.powerColor === 'teal' && card.powerText) {
    s = runPower(s, playerId, ref);
  }
  // "Play a bird ... If it has a 'game end' power, you may use it" (yellow
  // powers resolving at game end). Played earlier, its yellow power waits for
  // the game-end queue like any other (running it now would fire it twice).
  if (card.powerColor === 'yellow' && card.powerText && s.phase === 'gameEnd') {
    s = runPower(s, playerId, ref);
  }
  s = firePinkTriggers(s, playerId, { kind: 'playBird', habitat, cardId });
  return s;
}

function totalEggsAvail(p: { board: Record<Habitat, PlayedBird[]> }): number {
  return HABITATS.reduce((n, h) => n + p.board[h].reduce((m, b) => m + b.eggs, 0), 0);
}
