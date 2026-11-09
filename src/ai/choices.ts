// Greedy answers for pending steps — used by the AI and by tests that need
// to push through sub-choices without caring about quality.

import { bird } from '@/game/cards';
import { eggTargets, getPlayer } from '@/game/helpers';
import { faceCovers } from '@/game/powers';
import type { Choice, GameState, PendingStep, PlayerId } from '@/game/types';
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
      const targets = eggTargets(state, step.playerId, step.nest, step.exclude, step.overLimit ?? 0);
      if (targets.length < step.count) return null;
      return { kind: 'birds', birds: targets.slice(0, step.count) };
    }
    case 'chooseBirdForEggDiscard': {
      const targets: { habitat: (typeof HABITATS)[number]; index: number }[] = [];
      for (const h of HABITATS) {
        p.board[h].forEach((b, index) => {
          if (
            b.eggs > 0 &&
            (!step.exclude || step.exclude.habitat !== h || step.exclude.index !== index)
          ) {
            targets.push({ habitat: h, index });
          }
        });
      }
      if (targets.length < step.count) return null;
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
      const habitat = step.habitat === 'same' ? step.sourceBird?.habitat : step.habitat;
      if (!habitat) return null;
      const cardId = p.hand.find((id) => bird(id).habitats.includes(habitat));
      if (cardId == null) return null;
      return { kind: 'handCards', cardIds: [cardId] };
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
