// Greedy answers for pending steps. Every chooser returns a valid Choice or
// a 'decline' (only for optional steps where taking is impossible/worse).

import { fish } from '../cards';
import {
  allSlots,
  canAffordCost,
  getPlayer,
  legalSlots,
  matchesCardFilter,
  matchesSlotFilter,
  slotAt,
  topFish,
  validateMove,
} from '../helpers';
import { MAX_CORAL } from '../constants';
import type { Choice, GameState, PendingStep, SlotRef } from '../types';

function cheapestCards(p: { hand: number[] }, n: number): number[] {
  return [...p.hand].sort((a, b) => fish(a).points - fish(b).points).slice(0, n);
}

/** Slots ordered by how much we'd like a young there: 2 young (forms a
 *  school) > 1 young > fish slots > empty. */
function youngTargetOrder(p: ReturnType<typeof getPlayer>): SlotRef[] {
  const slots = [...allSlots(p.ocean)].map((x) => x.ref);
  const rank = (r: SlotRef) => {
    const s = slotAt(p.ocean, r);
    if (!s.school && s.young === 2) return 0;
    if (!s.school && s.young === 1) return 1;
    if (s.stack.length > 0) return 2;
    return 3;
  };
  return slots.sort((a, b) => rank(a) - rank(b));
}

export function chooseForPending(state: GameState, step: PendingStep): Choice {
  const p = getPlayer(state, step.playerId);
  const slots = [...allSlots(p.ocean)];

  switch (step.kind) {
    case 'confirmBenefit':
      return { kind: 'confirm' };
    case 'chooseEffectOrder':
      return { kind: 'index', index: 0 };
    case 'chooseGameEndAbility':
      return { kind: 'slots', slots: [step.slots[0]!] };
    case 'deferredEffects':
      return { kind: 'decline' }; // never at the head (expanded by dropInfeasible)
    case 'chooseEggTargets': {
      const ok = slots
        .filter(
          ({ ref, slot }) =>
            slot.stack.length > 0 && slot.eggs === 0 &&
            (!step.filter || matchesSlotFilter(p.ocean, ref, step.filter)),
        )
        .map((x) => x.ref);
      if (ok.length < step.count) return { kind: 'decline' };
      return { kind: 'slots', slots: ok.slice(0, step.count) };
    }
    case 'chooseHatch': {
      const ok = slots.filter(({ slot }) => slot.eggs > 0).map((x) => x.ref);
      if (ok.length < step.count) return { kind: 'decline' };
      return { kind: 'slots', slots: ok.slice(0, step.count) };
    }
    case 'chooseYoungSlots': {
      return { kind: 'slots', slots: youngTargetOrder(p).slice(0, step.count) };
    }
    case 'chooseMove': {
      // Prefer moving a young onto a 2-young slot (forms a school); else move
      // any young/school one slot along a row or column.
      for (const { ref, slot } of slots) {
        if (slot.young <= 0) continue;
        for (const { ref: to, slot: ts } of slots) {
          if (ts.young === 2 && !ts.school) {
            const v = validateMove(p.ocean, ref, to, 'young');
            if (v.ok) return { kind: 'move', from: ref, to, token: 'young' };
          }
        }
      }
      for (const { ref, slot } of slots) {
        for (const token of ['young', 'school'] as const) {
          if (token === 'young' && slot.young <= 0) continue;
          if (token === 'school' && !slot.school) continue;
          for (const { ref: to } of slots) {
            const v = validateMove(p.ocean, ref, to, token);
            if (v.ok) return { kind: 'move', from: ref, to, token };
          }
        }
      }
      return { kind: 'decline' };
    }
    case 'chooseHandDiscard': {
      const n = Math.min(step.count, p.hand.length);
      return { kind: 'handCards', cardIds: cheapestCards(p, n) };
    }
    case 'chooseEggRemoval': {
      const ok = slots.filter(({ slot }) => slot.eggs > 0).map((x) => x.ref);
      return { kind: 'slots', slots: ok.slice(0, step.count) };
    }
    case 'chooseYoungRemoval': {
      // Prefer removing lone young (keep 2-young slots for schools).
      const ok = slots
        .filter(({ slot }) => slot.young > 0)
        .sort((a, b) => a.slot.young - b.slot.young)
        .map((x) => x.ref);
      const out: SlotRef[] = [];
      for (const r of ok) {
        while (out.filter((x) => x.row === r.row && x.col === r.col).length < slotAt(p.ocean, r).young) {
          out.push(r);
          if (out.length >= step.count) return { kind: 'slots', slots: out };
        }
      }
      return { kind: 'slots', slots: out.slice(0, step.count) };
    }
    case 'chooseSchoolRemoval': {
      const ok = slots.filter(({ slot }) => slot.school).map((x) => x.ref);
      return { kind: 'slots', slots: ok.slice(0, step.count) };
    }
    case 'chooseConsume': {
      // Tuck the cheapest hand cards under the (fixed or best) eligible fish.
      const ontoSlots = step.onto ? [step.onto] : slots.map((x) => x.ref);
      for (const onto of ontoSlots) {
        const top = topFish(slotAt(p.ocean, onto));
        if (!top) continue;
        const tuckable = cheapestCards(p, p.hand.length).filter((id) => fish(id).length < top.length);
        if (tuckable.length >= step.count) {
          return { kind: 'consume', onto, cardIds: tuckable.slice(0, step.count) };
        }
      }
      return { kind: 'decline' };
    }
    case 'choosePlayFromHand': {
      // Play the highest-point affordable card that fits anywhere legal.
      const candidates = p.hand
        .map((id) => fish(id))
        .filter((c) => !c.forage)
        .filter((c) => !step.filter || matchesCardFilter(c, step.filter))
        .filter((c) => step.free || canAffordCost(p, c))
        .sort((a, b) => b.points - a.points);
      for (const c of candidates) {
        const spots = legalSlots(p.ocean, c, { restrict: step.restrict, ignoreConsume: step.free });
        if (spots.length === 0) continue;
        const ref = spots[0]!;
        if (step.free) {
          return { kind: 'playFromHand', cardId: c.id, row: ref.row, col: ref.col };
        }
        // Satisfy costs greedily.
        const discardCardIds = cheapestCards({ hand: p.hand.filter((x) => x !== c.id) }, c.cost.cards);
        const eggSlots = slots.filter(({ slot }) => slot.eggs > 0).map((x) => x.ref).slice(0, c.cost.eggs);
        const youngSlots: SlotRef[] = [];
        for (const { ref, slot } of slots) {
          for (let i = 0; i < slot.young && youngSlots.length < c.cost.young; i++) youngSlots.push(ref);
        }
        const schoolSlots = slots.filter(({ slot }) => slot.school).map((x) => x.ref).slice(0, c.cost.schools);
        return {
          kind: 'playFromHand',
          cardId: c.id,
          row: ref.row,
          col: ref.col,
          discardCardIds,
          eggSlots,
          youngSlots,
          schoolSlots,
        };
      }
      return { kind: 'decline' };
    }
    case 'chooseCoralSite': {
      // Grow the site closest to completion (worth the reef bonus).
      let best = -1;
      let bestCount = -1;
      p.ocean.corals.forEach((c, i) => {
        if (c < MAX_CORAL && c > bestCount) {
          best = i;
          bestCount = c;
        }
      });
      if (best < 0) return { kind: 'decline' };
      return { kind: 'site', col: best };
    }
    case 'chooseReefDiscard': {
      // Take the coral whenever the item is expendable — a coral is worth at
      // least as much as the discarded egg/young, and reefs unlock more.
      if (step.item === 'egg') {
        const r = slots.find(({ slot }) => slot.eggs > 0)?.ref;
        return r ? { kind: 'reefDiscard', use: true, eggSlot: r } : { kind: 'reefDiscard', use: false };
      }
      if (step.item === 'young') {
        // Prefer the fewest-young slot so 2-young pairs keep their school.
        const r = slots
          .filter(({ slot }) => slot.young > 0)
          .sort((a, b) => a.slot.young - b.slot.young)[0]?.ref;
        return r ? { kind: 'reefDiscard', use: true, youngSlot: r } : { kind: 'reefDiscard', use: false };
      }
      const id = cheapestCards(p, 1)[0];
      return id != null ? { kind: 'reefDiscard', use: true, cardId: id } : { kind: 'reefDiscard', use: false };
    }
    case 'chooseRecover': {
      const ids = [...p.discard].sort((a, b) => fish(b).points - fish(a).points).slice(0, step.count);
      return { kind: 'handCards', cardIds: ids };
    }
    case 'chooseUnSchool': {
      const schoolRef = slots.find(({ slot }) => slot.school)?.ref;
      if (!schoolRef) return { kind: 'decline' };
      const targets = youngTargetOrder(p)
        .filter((r) => !(r.row === schoolRef.row && r.col === schoolRef.col));
      return { kind: 'unSchool', schoolSlot: schoolRef, youngSlots: targets.slice(0, 4) };
    }
  }
}
