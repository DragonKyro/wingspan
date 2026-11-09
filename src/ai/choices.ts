// Greedy answers for pending steps — used by the AI and by tests that need
// to push through sub-choices without caring about quality.

import { bird } from '@/game/cards';
import {
  columnEggCost,
  eggStepTargets,
  eggsInHabitat,
  getPlayer,
  nestMatches,
  payFoodPlan,
  playedBirds,
  totalEggs,
} from '@/game/helpers';
import { faceCovers } from '@/game/powers';
import type { BirdRef, Choice, FoodType, GameState, PendingStep, PlayerId } from '@/game/types';
import { FOOD_TYPES, HABITATS } from '@/game/types';

/** A legal (if unremarkable) answer to `step`, or null when unanswerable. */
export function greedyChoice(state: GameState, step: PendingStep): Choice | null {
  const p = getPlayer(state, step.playerId);
  switch (step.kind) {
    case 'pickDie': {
      // The feeder shrinks as dice are taken: each pick's index is against
      // the feeder at that moment (the k-th pick's index drops by k).
      const chosen = state.feederIn
        .map((face, die) => ({ die, face }))
        .filter(({ face }) => !step.faces || step.faces.some((w) => faceCovers(face, w)))
        .slice(0, step.count);
      if (chosen.length < step.count) return null;
      const picks = chosen.map(({ die, face }, k) => ({
        die: die - k,
        take: face === 'split' ? ('seed' as const) : face === 'nectar' ? ('seed' as const) : undefined,
      }));
      return { kind: 'dice', picks };
    }
    case 'chooseSupplyFood': {
      const foods = Array.from({ length: step.count }, (_, i) =>
        step.options === 'any' ? 'seed' : step.options[i % step.options.length]!,
      );
      return { kind: 'supplyFood', foods };
    }
    case 'chooseBirdForEgg': {
      const targets = eggStepTargets(state, step);
      if (targets.length < step.count) {
        return step.optional ? { kind: 'birds', birds: targets } : null;
      }
      return { kind: 'birds', birds: targets.slice(0, step.count) };
    }
    case 'chooseBirdForEggDiscard': {
      const targets: { habitat: (typeof HABITATS)[number]; index: number }[] = [];
      for (const h of HABITATS) {
        if (step.habitat && h !== step.habitat) continue;
        p.board[h].forEach((b, index) => {
          if (
            b.eggs > 0 &&
            (!step.exclude || step.exclude.habitat !== h || step.exclude.index !== index)
          ) {
            targets.push({ habitat: h, index });
          }
        });
      }
      if (targets.length < step.count) {
        return step.optional ? { kind: 'birds', birds: [] } : null;
      }
      return { kind: 'birds', birds: targets.slice(0, step.count) };
    }
    case 'chooseHandDiscard':
      if (p.hand.length < step.count) return null;
      return { kind: 'handCards', cardIds: p.hand.slice(0, step.count) };
    case 'chooseHandTuck':
      if (p.hand.length === 0) return null;
      return { kind: 'handCards', cardIds: [p.hand[0]!] };
    case 'chooseDrawnCard':
      if (step.cardIds.length === 0) return null;
      // Keep the highest-point bird.
      const best = [...step.cardIds].sort((a, b) => bird(b).points - bird(a).points)[0]!;
      return { kind: 'handCards', cardIds: [best] };
    case 'chooseBonusCards':
      if (step.cardIds.length < step.keep) return null;
      return { kind: 'bonusCards', cardIds: step.cardIds.slice(0, step.keep) };
    case 'discardBonusCards':
      if (p.bonusHand.length < step.count) return null;
      return { kind: 'bonusCards', cardIds: p.bonusHand.slice(0, step.count) };
    case 'moveBirdHabitat': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b) return null;
      const to = bird(b.cardId).habitats.find(
        (h) => h !== step.bird.habitat && p.board[h].length < 5,
      );
      return to ? { kind: 'habitat', habitat: to } : null;
    }
    case 'chooseFirstPlayer':
      return { kind: 'player', playerId: step.playerId };
    case 'chooseRepeatPower': {
      const source = step.then?.bird;
      const idx = p.board[step.habitat].findIndex((b, i) => {
        if (source && source.habitat === step.habitat && source.index === i) return false;
        const c = bird(b.cardId);
        return c.powerColor === 'brown' && !!c.powerText && (!step.predatorOnly || c.predator);
      });
      if (idx < 0) return null;
      return { kind: 'repeatTarget', bird: { habitat: step.habitat, index: idx } };
    }
    case 'chooseAdditionalPlay': {
      const habitats =
        step.habitat === 'any'
          ? HABITATS
          : [step.habitat === 'same' ? step.sourceBird?.habitat : step.habitat];
      for (const habitat of habitats) {
        if (!habitat) continue;
        if (totalEggs(p) < Math.max(0, columnEggCost(p.board[habitat].length) - (step.eggDiscount ?? 0))) continue;
        const cardId = p.hand.find(
          (id) => bird(id).habitats.includes(habitat) && payFoodPlan(p.food, bird(id).cost) != null,
        );
        if (cardId != null) {
          return { kind: 'handCards', cardIds: [cardId], habitat };
        }
      }
      return step.optional ? { kind: 'handCards', cardIds: [] } : null;
    }
    case 'chooseCacheFood':
      return { kind: 'supplyFood', foods: Array.from({ length: step.count }, () => 'seed' as const) };
    case 'chooseWildTrade': {
      const give = FOOD_TYPES.find((f) => p.food[f] > 0);
      if (!give) return null;
      return { kind: 'wildTrade', give, to: 'invertebrate' };
    }
    case 'chooseCacheGained':
      return { kind: 'boolean', yes: true };

    // === european expansion steps ===
    case 'choosePlayer': {
      if (!step.other) return { kind: 'player', playerId: step.playerId };
      const victim = state.playerOrder.find((pid) => pid !== step.playerId);
      if (victim) return { kind: 'player', playerId: victim };
      return step.optional ? { kind: 'boolean', yes: false } : null;
    }
    case 'chooseHabitat': {
      if (!step.noEggs) return { kind: 'habitat', habitat: 'forest' };
      // Most eggs we can lay: the fullest habitat that currently has none.
      const best = [...HABITATS].sort(
        (a, b) =>
          playedBirds(p).filter(({ ref }) => ref.habitat === b).length -
          playedBirds(p).filter(({ ref }) => ref.habitat === a).length,
      );
      const pick = best.find((h) => eggsInHabitat(p, h) === 0);
      return pick ? { kind: 'habitat', habitat: pick } : null;
    }
    case 'chooseFoodDiscard': {
      const foods: FoodType[] = [];
      const owned = (Object.keys(p.food) as (keyof typeof p.food)[]).filter(
        (f) => p.food[f] > 0 && (step.options === 'any' || step.options.includes(f)),
      );
      if (!step.optional && owned.length < step.count) return null;
      const n = step.optional ? Math.min(step.count, owned.length) : step.count;
      for (let i = 0; i < n; i++) foods.push(owned[i % owned.length]!);
      return { kind: 'supplyFood', foods };
    }
    case 'chooseFoodSteal': {
      const victim = getPlayer(state, step.from);
      const f =
        step.food !== 'any'
          ? step.food
          : (Object.keys(victim.food) as (keyof typeof victim.food)[]).find((x) => victim.food[x] > 0);
      if (!f || victim.food[f] <= 0) return null;
      return { kind: 'supplyFood', foods: [f] };
    }
    case 'chooseTrayCard': {
      const idx = state.tray.findIndex(
        (id) => id != null && (!step.habitat || bird(id).habitats.includes(step.habitat)),
      );
      if (idx < 0) return null;
      return { kind: 'handCards', cardIds: [state.tray[idx]!] };
    }
    case 'chooseDieRemove': {
      const picks = state.feederIn.slice(0, step.count).map((face, i) => ({
        die: i - i, // feeder shrinks as dice are removed
        take: face === 'split' ? ('seed' as const) : undefined,
      }));
      if (picks.length < step.count) return null;
      return { kind: 'dice', picks };
    }
    case 'chooseBirds': {
      const eligible: BirdRef[] = playedBirds(p)
        .filter(({ ref, bird: b }) => {
          if (step.habitat && ref.habitat !== step.habitat) return false;
          if (step.exclude && step.exclude.habitat === ref.habitat && step.exclude.index === ref.index) {
            return false;
          }
          if (step.nest && !nestMatches(bird(b.cardId).nest, step.nest)) return false;
          if (step.eggsMin != null && b.eggs < step.eggsMin) return false;
          return true;
        })
        .map(({ ref }) => ref);
      if (eligible.length < step.min) return null;
      return { kind: 'birds', birds: eligible.slice(0, step.max) };
    }
    case 'assignHandTucks': {
      const n = Math.min(step.targets.length, p.hand.length);
      if (n === 0) return { kind: 'handCards', cardIds: [] };
      return { kind: 'handCards', cardIds: p.hand.slice(0, n) };
    }
    case 'chooseCacheOnBirds': {
      const first = playedBirds(p)[0];
      if (!first) return null;
      return {
        kind: 'cacheAssign',
        items: Array.from({ length: step.count }, () => ({
          bird: first.ref,
          food: step.food === 'any' ? ('seed' as const) : step.food,
        })),
      };
    }
    case 'chooseFoodType':
      return { kind: 'supplyFood', foods: ['seed'] };
    case 'chooseOption':
      return { kind: 'option', option: step.options[0]! };

    // === oceania expansion steps ===
    case 'chooseCopyPower': {
      const target = getPlayer(state, step.target);
      const idx = target.board[step.habitat].findIndex((b) => {
        if (b.ghost) return false;
        const c = bird(b.cardId);
        return c.powerColor === 'brown' && !!c.powerText;
      });
      if (idx < 0) return null;
      return { kind: 'repeatTarget', bird: { habitat: step.habitat, index: idx } };
    }
    case 'chooseTrayCardEx': {
      const idx = state.tray.findIndex((id) => {
        if (id == null) return false;
        const c = bird(id);
        if (step.nests && !step.nests.includes(c.nest)) return false;
        if (step.wingspanLt != null && c.wingspan >= step.wingspanLt) return false;
        return true;
      });
      if (idx >= 0) return { kind: 'trayPick', cardId: state.tray[idx]! };
      // No qualifying card: reset the tray when allowed.
      if (step.mayResetTray && (state.deck.length > 0 || state.discard.length > 0)) {
        return { kind: 'trayPick', mode: 'reset' };
      }
      return null;
    }
    case 'chooseTuckOrHand':
      // Tucking is at worst neutral (it's a bonus point); the AI tucks.
      return { kind: 'boolean', yes: true };
    case 'chooseCacheFromSupply': {
      const owned = (Object.keys(p.food) as (keyof typeof p.food)[]).filter(
        (f) => p.food[f] > 0 && (step.food === 'any' || f === step.food),
      );
      const n = step.optional ? Math.min(step.count, owned.length) : step.count;
      if (owned.length === 0 || n <= 0) {
        return step.optional ? { kind: 'supplyFood', foods: [] } : null;
      }
      const foods: FoodType[] = [];
      for (let i = 0; i < n; i++) foods.push(owned[i % owned.length]!);
      return { kind: 'supplyFood', foods };
    }
  }
}

/** The resolveChoice action for the head pending step, or null. */
export function resolveHeadAction(
  state: GameState,
  playerId: PlayerId,
): { type: 'resolveChoice'; playerId: PlayerId; choice: Choice } | null {
  const head = state.pending[0];
  if (!head || head.playerId !== playerId) return null;
  const choice = greedyChoice(state, head);
  if (!choice) return null;
  return { type: 'resolveChoice', playerId, choice };
}
