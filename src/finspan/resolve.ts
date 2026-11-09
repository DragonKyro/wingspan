// Resolves the head PendingStep against a player's Choice. Steps that became
// impossible are auto-dropped (feasible()). A resolved step pops; count>1
// steps where each choice performs a single unit (moves, coral placements,
// un-schools) decrement and stay at the head. Steps whose choice already
// supplies all `count` items (egg targets, hatches, discards, consumes,
// removals) pop immediately.

import { fish } from './cards';
import {
  addEgg,
  addYoung,
  allSlots,
  applyMove,
  applyPayments,
  canAffordCost,
  drawFromDeck,
  getPlayer,
  hatchAt,
  legalSlots,
  matchesCardFilter,
  matchesSlotFilter,
  placeCoral,
  placeFish,
  placementError,
  recoverCards,
  removeEgg,
  removeSchool,
  removeYoung,
  sameRef,
  setPlayer,
  slotAt,
  topFish,
  tuckUnderFish,
  validatePayments,
} from './helpers';
import { fireAbility } from './powers';
import type {
  Choice,
  GameState,
  PendingStep,
  PlayerId,
  SlotRef,
} from './types';
import { MAX_CORAL } from './constants';

// === feasibility ===

/** Can this step ever be satisfied right now? Used to auto-drop dead steps. */
export function feasible(state: GameState, step: PendingStep): boolean {
  const p = getPlayer(state, step.playerId);
  const slots = [...allSlots(p.ocean)];
  switch (step.kind) {
    case 'chooseEggTargets': {
      const ok = slots.filter(
        ({ ref, slot }) =>
          slot.stack.length > 0 && slot.eggs === 0 &&
          (!step.filter || matchesSlotFilter(p.ocean, ref, step.filter)),
      );
      return ok.length >= step.count;
    }
    case 'chooseHatch':
      return slots.filter(({ slot }) => slot.eggs > 0).length >= step.count;
    case 'chooseYoungSlots':
      return true; // any slot is a legal young target
    case 'chooseMove':
      return slots.some(({ slot }) => slot.young > 0 || slot.school);
    case 'chooseHandDiscard':
      return step.optional ? true : p.hand.length >= step.count;
    case 'chooseEggRemoval':
      return slots.reduce((a, { slot }) => a + slot.eggs, 0) >= step.count;
    case 'chooseYoungRemoval':
      return slots.reduce((a, { slot }) => a + slot.young, 0) >= step.count;
    case 'chooseSchoolRemoval':
      return slots.filter(({ slot }) => slot.school).length >= step.count;
    case 'chooseConsume': {
      for (const id of p.hand) {
        const c = fish(id);
        for (const { ref, slot } of slots) {
          if (step.onto && !sameRef(ref, step.onto)) continue;
          const top = topFish(slot);
          if (top && c.length < top.length) return true;
        }
      }
      return false;
    }
    case 'choosePlayFromHand': {
      for (const id of p.hand) {
        const c = fish(id);
        if (c.forage) continue;
        if (step.filter && !matchesCardFilter(c, step.filter)) continue;
        if (!step.free && !canAffordCost(p, c)) continue;
        const opts = { restrict: step.restrict, ignoreConsume: step.free };
        if (legalSlots(p.ocean, c, opts).length > 0) return true;
      }
      return false;
    }
    case 'chooseCoralSite':
      return p.ocean.corals.some((c) => c < MAX_CORAL);
    case 'chooseReefDiscard': {
      if (p.ocean.corals[step.col]! >= MAX_CORAL) return false;
      const slots2 = [...allSlots(p.ocean)];
      return (
        (step.item === 'egg' && slots2.some((x) => x.slot.eggs > 0)) ||
        (step.item === 'young' && slots2.some((x) => x.slot.young > 0)) ||
        (step.item === 'card' && p.hand.length > 0)
      );
    }
    case 'chooseRecover':
      return p.discard.length > 0 || state.deck.length > 0;
    case 'chooseUnSchool':
      return slots.some(({ slot }) => slot.school);
  }
}

/** Drop leading pending steps that can never be satisfied. */
export function dropInfeasible(state: GameState): GameState {
  let s = state;
  while (s.pending.length && !feasible(s, s.pending[0]!)) {
    s = { ...s, pending: s.pending.slice(1) };
  }
  return s;
}

// === choice resolution ===

function pop(state: GameState): GameState {
  return { ...state, pending: state.pending.slice(1) };
}

function decrement(state: GameState, step: PendingStep & { count: number }): GameState {
  if (step.count <= 1) return pop(state);
  const next = { ...step, count: step.count - 1 } as PendingStep;
  return { ...state, pending: [next, ...state.pending.slice(1)] };
}

export function resolveChoice(state: GameState, playerId: PlayerId, choice: Choice): GameState {
  let s = dropInfeasible(state);
  const step = s.pending[0];
  if (!step) throw new Error('no pending step to resolve');
  if (step.playerId !== playerId) throw new Error(`waiting on ${step.playerId}, not ${playerId}`);

  if (choice.kind === 'decline') {
    if (!('optional' in step && step.optional)) throw new Error('this choice is required');
    return pop(s);
  }

  let p = getPlayer(s, playerId);

  switch (step.kind) {
    case 'chooseEggTargets': {
      if (choice.kind !== 'slots') break;
      if (choice.slots.length !== step.count) throw new Error(`pick ${step.count} fish`);
      // A slot holds at most 1 egg; a duplicate slot can never be satisfied.
      if (new Set(choice.slots.map((r) => `${r.row},${r.col}`)).size !== choice.slots.length)
        throw new Error('duplicate egg target slot');
      for (const ref of choice.slots) {
        const slot = slotAt(p.ocean, ref);
        if (slot.stack.length === 0 || slot.eggs > 0) throw new Error('invalid egg target');
        if (step.filter && !matchesSlotFilter(p.ocean, ref, step.filter))
          throw new Error('egg target fails filter');
      }
      for (const ref of choice.slots) p = addEgg(p, ref);
      s = setPlayer(s, p);
      return pop(s); // the choice supplies all `count` targets at once
    }
    case 'chooseHatch': {
      if (choice.kind !== 'slots') break;
      if (choice.slots.length !== step.count) throw new Error(`pick ${step.count} egg(s)`);
      if (new Set(choice.slots.map((r) => `${r.row},${r.col}`)).size !== choice.slots.length)
        throw new Error('duplicate hatch slot');
      for (const ref of choice.slots) p = hatchAt(p, ref);
      s = setPlayer(s, p);
      return pop(s);
    }
    case 'chooseYoungSlots': {
      if (choice.kind !== 'slots') break;
      if (choice.slots.length !== step.count) throw new Error(`pick ${step.count} slot(s)`);
      if (step.distinct && new Set(choice.slots.map((r) => `${r.row},${r.col}`)).size !== step.count)
        throw new Error('young must go to different slots');
      for (const ref of choice.slots) p = addYoung(p, ref);
      s = setPlayer(s, p);
      return pop(s);
    }
    case 'chooseMove': {
      if (choice.kind !== 'move') break;
      p = applyMove(p, choice.from, choice.to, choice.token);
      s = setPlayer(s, p);
      return decrement(s, step); // one move per choice
    }
    case 'chooseHandDiscard': {
      if (choice.kind !== 'handCards') break;
      if (step.optional) {
        if (choice.cardIds.length > step.count) throw new Error('too many cards');
      } else if (choice.cardIds.length !== step.count) {
        throw new Error(`discard ${step.count} card(s)`);
      }
      if (new Set(choice.cardIds).size !== choice.cardIds.length)
        throw new Error('duplicate card ids');
      for (const id of choice.cardIds) {
        if (!p.hand.includes(id)) throw new Error('card not in hand');
      }
      p = {
        ...p,
        hand: p.hand.filter((id) => !choice.cardIds.includes(id)),
        discard: [...p.discard, ...choice.cardIds],
      };
      s = setPlayer(s, p);
      return pop(s);
    }
    case 'chooseEggRemoval': {
      if (choice.kind !== 'slots' || choice.slots.length !== step.count) break;
      if (new Set(choice.slots.map((r) => `${r.row},${r.col}`)).size !== choice.slots.length)
        throw new Error('duplicate egg slot');
      for (const ref of choice.slots) p = removeEgg(p, ref);
      return pop(setPlayer(s, p));
    }
    case 'chooseYoungRemoval': {
      if (choice.kind !== 'slots' || choice.slots.length !== step.count) break;
      // The same slot may legitimately appear twice only if it holds enough
      // young — verify per-slot counts up front.
      const need = new Map<string, number>();
      for (const ref of choice.slots) {
        const key = `${ref.row},${ref.col}`;
        need.set(key, (need.get(key) ?? 0) + 1);
        if (slotAt(p.ocean, ref).young < need.get(key)!) throw new Error('not enough young on that slot');
      }
      for (const ref of choice.slots) p = removeYoung(p, ref);
      return pop(setPlayer(s, p));
    }
    case 'chooseSchoolRemoval': {
      if (choice.kind !== 'slots' || choice.slots.length !== step.count) break;
      if (new Set(choice.slots.map((r) => `${r.row},${r.col}`)).size !== choice.slots.length)
        throw new Error('duplicate school slot');
      for (const ref of choice.slots) p = removeSchool(p, ref);
      return pop(setPlayer(s, p));
    }
    case 'chooseConsume': {
      if (choice.kind !== 'consume') break;
      if (choice.cardIds.length !== step.count) throw new Error(`tuck ${step.count} card(s)`);
      if (step.onto && !sameRef(choice.onto, step.onto)) throw new Error('must consume with the stated fish');
      const slot = slotAt(p.ocean, choice.onto);
      const top = topFish(slot);
      if (!top) throw new Error('no fish there');
      if (new Set(choice.cardIds).size !== choice.cardIds.length)
        throw new Error('duplicate card ids');
      for (const id of choice.cardIds) {
        if (!p.hand.includes(id)) throw new Error('card not in hand');
        if (fish(id).length >= top.length) throw new Error('consumed fish must be shorter');
      }
      for (const id of choice.cardIds) {
        p = tuckUnderFish(p, choice.onto, id);
        p = { ...p, hand: p.hand.filter((x) => x !== id) };
      }
      s = setPlayer(s, p);
      return pop(s); // the choice supplies all `count` consumed fish at once
    }
    case 'choosePlayFromHand': {
      if (choice.kind !== 'playFromHand') break;
      const card = fish(choice.cardId);
      if (card.forage || !p.hand.includes(choice.cardId)) throw new Error('card not in hand');
      if (step.filter && !matchesCardFilter(card, step.filter)) throw new Error('card fails restriction');
      const ref: SlotRef = { row: choice.row, col: choice.col };
      const err = placementError(p.ocean, card, ref, {
        restrict: step.restrict,
        ignoreConsume: step.free,
      });
      if (err) throw new Error(`illegal placement: ${err}`);
      if (!step.free) {
        validatePayments(p, card, choice);
        p = applyPayments(p, card, choice);
      }
      p = { ...p, hand: p.hand.filter((id) => id !== choice.cardId) };
      p = placeFish(p, card, ref);
      s = setPlayer(s, p);
      s = pop(s);
      if (card.abilityType === 'WhenPlayed' && card.ability) {
        s = fireAbility(s, playerId, card.ability, ref, `${card.name} (when played)`);
      }
      return s;
    }
    case 'chooseCoralSite': {
      if (choice.kind !== 'site') break;
      if (choice.col < 0 || choice.col > 2) throw new Error('invalid site');
      if (p.ocean.corals[choice.col]! >= MAX_CORAL) throw new Error('site is full');
      p = placeCoral(p, choice.col);
      return decrement(setPlayer(s, p), step);
    }
    case 'chooseReefDiscard': {
      if (choice.kind !== 'reefDiscard') break;
      if (!choice.use) return pop(s);
      if (step.item === 'egg') {
        if (!choice.eggSlot) throw new Error('choose an egg to discard');
        p = removeEgg(p, choice.eggSlot);
      } else if (step.item === 'young') {
        if (!choice.youngSlot) throw new Error('choose a young to discard');
        p = removeYoung(p, choice.youngSlot);
      } else {
        if (choice.cardId == null || !p.hand.includes(choice.cardId)) throw new Error('choose a card to discard');
        p = { ...p, hand: p.hand.filter((id) => id !== choice.cardId), discard: [...p.discard, choice.cardId] };
      }
      p = placeCoral(p, step.col);
      return pop(setPlayer(s, p));
    }
    case 'chooseRecover': {
      if (choice.kind !== 'handCards') break;
      if (choice.cardIds.length > step.count) throw new Error('too many cards');
      for (const id of choice.cardIds) {
        if (!p.discard.includes(id)) throw new Error('card not in discard pile');
      }
      s = recoverCards(s, playerId, choice.cardIds);
      const short = step.count - choice.cardIds.length;
      if (short > 0) s = drawFromDeck(s, playerId, short);
      return pop(s);
    }
    case 'chooseUnSchool': {
      if (choice.kind !== 'unSchool') break;
      if (choice.schoolSlot == null) throw new Error('choose a school to discard');
      if (choice.youngSlots.length !== 4) throw new Error('place young in 4 different slots');
      const keys = new Set(choice.youngSlots.map((r) => `${r.row},${r.col}`));
      if (keys.size !== 4) throw new Error('young must go to different slots');
      p = removeSchool(p, choice.schoolSlot);
      for (const ref of choice.youngSlots) p = addYoung(p, ref);
      return decrement(setPlayer(s, p), step);
    }
  }

  throw new Error(`choice ${choice.kind} does not match pending ${step.kind}`);
}
