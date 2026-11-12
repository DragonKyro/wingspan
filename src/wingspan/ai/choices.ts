// Greedy answers for pending steps — used by the AI and by tests that need
// to push through sub-choices without caring about quality.

import { bird, hummingbird } from '@/wingspan/cards';
import { duetEligibleSpaces, duetFoodsFor } from '@/wingspan/duetMap';
import {
  discountFoodCost,
  eggStepTargets,
  eggsInHabitat,
  getPlayer,
  payFoodPlan,
  playEggCost,
  playedBirds,
  totalEggs,
  wingspanOf,
} from '@/wingspan/helpers';
import { costHasFood, faceCovers } from '@/wingspan/powers';
import {
  chooseBirdsEligible,
  copyPlayedTargets,
  humSourceOptions,
  isCopyableBrown,
  trayCardMatches,
} from '@/wingspan/resolve';
import type { BirdRef, Choice, FoodType, GameState, PendingStep, PlayerId } from '@/wingspan/types';
import { FOOD_TYPES, HABITATS } from '@/wingspan/types';

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
      if (chosen.length === 0) {
        // Nothing matching: reset an all-same-face feeder, else take nothing.
        const same = state.feederIn.length > 0 && state.feederIn.every((f) => f === state.feederIn[0]);
        return { kind: 'dice', picks: [], reroll: same || undefined };
      }
      // Fewer showing than the count: take these; the rest are picked after any refill.
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
      // Each bird may take several eggs up to its (possibly over-) limit.
      // `onlyBird` steps already list the bird once per egg that fits, so
      // expand each distinct bird exactly once.
      const expanded: BirdRef[] = [];
      const seen = new Set<string>();
      for (const t of targets) {
        const key = `${t.habitat}:${t.index}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const b = p.board[t.habitat]?.[t.index];
        if (!b) continue;
        const room = Math.max(
          0,
          bird(b.cardId).eggLimit + (step.overLimit ?? 0) - b.eggs,
        );
        for (let i = 0; i < room; i++) expanded.push(t);
      }
      if (expanded.length === 0) {
        return step.optional ? { kind: 'birds', birds: [] } : null;
      }
      return { kind: 'birds', birds: expanded.slice(0, step.count) };
    }
    case 'chooseBirdForEggDiscard': {
      // One entry per egg (a bird may be listed once per egg it holds),
      // spreading across birds first so no bird is drained needlessly.
      const targets: { habitat: (typeof HABITATS)[number]; index: number; nth: number }[] = [];
      for (const h of HABITATS) {
        if (step.habitat && h !== step.habitat) continue;
        p.board[h].forEach((b, index) => {
          if (step.exclude && step.exclude.habitat === h && step.exclude.index === index) return;
          for (let nth = 0; nth < b.eggs; nth++) targets.push({ habitat: h, index, nth });
        });
      }
      if (targets.length < step.count) {
        return step.optional ? { kind: 'birds', birds: [] } : null;
      }
      targets.sort((a, b) => a.nth - b.nth);
      return {
        kind: 'birds',
        birds: targets.slice(0, step.count).map(({ habitat, index }) => ({ habitat, index })),
      };
    }
    case 'chooseHandDiscard': {
      if (p.hand.length === 0) {
        return step.optional ? { kind: 'handCards', cardIds: [] } : null;
      }
      if (!step.optional && p.hand.length < step.count) return null;
      return { kind: 'handCards', cardIds: p.hand.slice(0, Math.min(step.count, p.hand.length)) };
    }
    case 'chooseHandTuck': {
      const id =
        step.wingspanLt != null
          ? p.hand.find((x) => wingspanOf(bird(x)) < step.wingspanLt!)
          : p.hand[0];
      if (id == null) {
        return step.optional ? { kind: 'handCards', cardIds: [] } : null;
      }
      return { kind: 'handCards', cardIds: [id] };
    }
    case 'chooseCardDiscard': {
      // Prefer a qualifying tray card (it costs nothing from the hand).
      const trayPick = step.fromTray
        ? state.tray.find((id) => id != null && step.costFoods.some((f) => costHasFood(bird(id!), [f])))
        : undefined;
      const handPick = step.fromHand
        ? p.hand.find((id) => step.costFoods.some((f) => costHasFood(bird(id), [f])))
        : undefined;
      const pick = trayPick ?? handPick;
      if (pick == null) {
        return step.optional ? { kind: 'handCards', cardIds: [] } : null;
      }
      return { kind: 'handCards', cardIds: [pick] };
    }
    case 'chooseCachedDiscard': {
      const items: { bird: BirdRef; food: FoodType }[] = [];
      for (const { ref, bird: b } of playedBirds(p)) {
        for (const food of b.cached) {
          if (items.length < step.count) items.push({ bird: ref, food });
        }
      }
      if (items.length < step.count) {
        return step.optional ? { kind: 'cacheAssign', items: [] } : null;
      }
      return { kind: 'cacheAssign', items };
    }
    case 'chooseDrawnCard': {
      const keep = step.keep ?? 1;
      if (step.cardIds.length < keep) return null;
      // Keep the highest-point birds.
      const best = [...step.cardIds]
        .sort((a, b) => bird(b).points - bird(a).points)
        .slice(0, keep);
      return { kind: 'handCards', cardIds: best };
    }
    case 'chooseBonusCards':
      if (step.cardIds.length < step.keep) return null;
      return { kind: 'bonusCards', cardIds: step.cardIds.slice(0, step.keep) };
    case 'discardBonusCards':
      // "Up to": the Fairy Tern's discards pay off (3 fish each); otherwise keep them.
      if (step.upTo) {
        const n = step.then?.effect === 'promoFairyTern' ? Math.min(step.count, p.bonusHand.length) : 0;
        return { kind: 'bonusCards', cardIds: p.bonusHand.slice(0, n) };
      }
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
        if (step.excludeIds?.includes(i)) return false;
        const c = bird(b.cardId);
        return c.powerColor === 'brown' && !!c.powerText && (!step.predatorOnly || c.predator);
      });
      if (idx < 0) {
        return step.optional ? { kind: 'boolean', yes: false } : null;
      }
      return { kind: 'repeatTarget', bird: { habitat: step.habitat, index: idx } };
    }
    case 'chooseAdditionalPlay': {
      let habitats =
        step.habitat === 'any'
          ? HABITATS
          : [step.habitat === 'same' ? step.sourceBird?.habitat : step.habitat];
      if (step.column != null) {
        habitats = habitats.filter((h) => h && p.board[h].length === step.column);
      }
      for (const habitat of habitats) {
        if (!habitat || p.board[habitat].length >= 5) continue;
        const baseEggs = playEggCost(p, habitat);
        const discEggs = Math.max(0, baseEggs - (step.eggDiscount ?? 0));
        const totalEggsOnMat = totalEggs(p);
        const cardId = p.hand.find((id) => {
          const c = bird(id);
          if (!c.habitats.includes(habitat)) return false;
          if (totalEggsOnMat >= discEggs && payFoodPlan(p.food, c.cost) != null) return true;
          if (
            step.foodDiscount &&
            totalEggsOnMat >= baseEggs &&
            payFoodPlan(p.food, discountFoodCost(c.cost, step.foodDiscount)) != null
          ) {
            return true;
          }
          return false;
        });
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
    case 'choosePoolPlay': {
      const ranked = [...step.cardIds].sort((a, b) => bird(b).points - bird(a).points);
      for (const id of ranked) {
        const p = getPlayer(state, step.playerId);
        const hab = bird(id).habitats.find((h) => p.board[h].length < 5);
        if (hab) return { kind: 'handCards', cardIds: [id], habitat: hab };
      }
      return { kind: 'handCards', cardIds: [] };
    }
    case 'deferredEffect':
      return { kind: 'boolean', yes: true }; // never at the head (run by dropImpossiblePending)
    case 'choosePowerOrder':
      return { kind: 'repeatTarget', bird: step.birds[0]! };
    case 'chooseCardDraw': {
      // The most valuable face-up bird, else the deck.
      let best = -1;
      let bestPts = 2;
      state.tray.forEach((id, i) => {
        if (id != null && bird(id).points > bestPts) {
          bestPts = bird(id).points;
          best = i;
        }
      });
      return best >= 0 ? { kind: 'trayPick', cardId: state.tray[best]! } : { kind: 'trayPick' };
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
      const eligible = chooseBirdsEligible(state, step);
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
      const habitats = step.habitat === 'any' ? HABITATS : [step.habitat];
      for (const h of habitats) {
        const idx = target.board[h].findIndex(isCopyableBrown);
        if (idx >= 0) return { kind: 'repeatTarget', bird: { habitat: h, index: idx } };
      }
      return null;
    }
    case 'chooseTrayCardEx': {
      const idx = state.tray.findIndex((id) => id != null && trayCardMatches(step, id));
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
        (f) =>
          p.food[f] > 0 &&
          (step.food === 'any' ? !step.options || step.options.includes(f) : f === step.food),
      );
      const n = step.optional ? Math.min(step.count, owned.length) : step.count;
      if (owned.length === 0 || n <= 0) {
        return step.optional ? { kind: 'supplyFood', foods: [] } : null;
      }
      const foods: FoodType[] = [];
      for (let i = 0; i < n; i++) foods.push(owned[i % owned.length]!);
      return { kind: 'supplyFood', foods };
    }

    // === asia / duet expansion steps ===
    case 'chooseDuetSpace': {
      if (!state.duet) return null;
      const card = bird(step.cardId);
      const eligible = duetEligibleSpaces(
        state.duet.map,
        card,
        step.habitat,
        duetFoodsFor(card, step.foods),
      );
      if (eligible.length === 0) return { kind: 'duetSpace', space: 'reset' };
      return { kind: 'duetSpace', space: eligible[0]! };
    }
    case 'chooseResources': {
      // Spend supply food first, then eggs, then hand cards.
      const foods: FoodType[] = [];
      const eggs: BirdRef[] = [];
      const cards: number[] = [];
      let need = step.count;
      for (const f of FOOD_TYPES) {
        while (need > 0 && p.food[f] > foods.filter((x) => x === f).length) {
          foods.push(f);
          need--;
        }
      }
      for (const { ref, bird: b } of playedBirds(p)) {
        while (need > 0 && b.eggs > eggs.filter((r) => r.habitat === ref.habitat && r.index === ref.index).length) {
          eggs.push(ref);
          need--;
        }
      }
      for (const id of p.hand) {
        if (need <= 0) break;
        cards.push(id);
        need--;
      }
      if (need > 0) {
        return step.optional
          ? { kind: 'resources', foods: [], eggs: [], cards: [] }
          : null;
      }
      return { kind: 'resources', foods, eggs, cards };
    }
    case 'chooseTrayDiscard': {
      // Discard the whole tray — maximises the chance of a match.
      const ids = state.tray.filter((id): id is number => id != null);
      return { kind: 'handCards', cardIds: ids };
    }
    case 'moveBirdToPlayer': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b) return null;
      const target = getPlayer(state, step.target);
      const to = bird(b.cardId).habitats.find((h) => target.board[h].length < 5);
      return to ? { kind: 'habitat', habitat: to } : null;
    }
    case 'confirm':
      if (step.then?.effect === 'takeAllReroll') {
        // Reset only if the showing face isn't the wanted food.
        const want = FOOD_TYPES[step.then.ids?.[0] ?? -1];
        const face = state.feederIn[0];
        return { kind: 'boolean', yes: !(want && face && faceCovers(face, want)) };
      }
      return { kind: 'boolean', yes: true };
    case 'chooseHandPick': {
      if (p.hand.length < step.count) {
        return step.optional ? { kind: 'handCards', cardIds: [] } : null;
      }
      return { kind: 'handCards', cardIds: p.hand.slice(0, step.count) };
    }
    case 'choosePoolTuck': {
      const n = Math.min(step.count, step.cardIds.length);
      return { kind: 'handCards', cardIds: step.cardIds.slice(0, n) };
    }
    case 'chooseCopyPlayed': {
      const t = copyPlayedTargets(state, step.playerId)[0];
      return t ? { kind: 'playedTarget', player: t.player, bird: t.bird } : null;
    }
    case 'chooseReroll': {
      // Reroll everything that isn't a rodent (the eagle's target face).
      const picks = state.feederIn
        .map((face, die) => ({ die, face }))
        .filter(({ face }) => face !== 'rodent')
        .map(({ die }) => ({ die }));
      return { kind: 'dice', picks };
    }
    case 'drawUpTo': {
      const rawCap = step.then?.n?.[0] ?? 0;
      if (rawCap < 0) {
        const cap = Math.abs(rawCap);
        const total = step.pool.reduce((n, id) => n + bird(id).points, 0);
        return { kind: 'boolean', yes: step.left > 0 && total + 2 < cap };
      }
      const total = step.pool.reduce((n, id) => n + wingspanOf(bird(id)), 0);
      // Keep drawing while there's a comfortable margin under the cap.
      return { kind: 'boolean', yes: step.left > 0 && total + 40 <= rawCap };
    }

    // === americas expansion steps ===
    case 'chooseHumSource': {
      // Garden slots come before the blind deck draw: prefer a face-up pick.
      const source = humSourceOptions(state, step)[0];
      return source == null ? null : { kind: 'humPick', source };
    }
    case 'chooseHumCover': {
      const humId = p.humBoard[step.habitat];
      if (humId == null) return null;
      const myGroup = hummingbird(humId).group;
      // Covering a different group's top card advances two track columns.
      const diff = state.humGarden.findIndex((slot) => {
        const top = slot[slot.length - 1];
        return top != null && hummingbird(top).group !== myGroup;
      });
      const empty = state.humGarden.findIndex((slot) => slot.length === 0);
      const slot = diff >= 0 ? diff : empty >= 0 ? empty : 0;
      return { kind: 'humCover', slot };
    }
    case 'chooseHumColumn': {
      const options = step.down
        ? step.groups.filter((g) => p.humTrack[g] > 0)
        : step.groups;
      if (options.length === 0) return null;
      return { kind: 'humColumn', group: options[0]! };
    }
    case 'chooseHumHabitat': {
      // Prefer attracting (benefits) over returning; attract rows first.
      const attractable = (h: (typeof HABITATS)[number]) => {
        if (step.exclude === h || p.humBoard[h] != null) return false;
        const visible = state.humGarden.some((slot) => {
          const id = slot[slot.length - 1];
          return (
            id != null &&
            !p.humReturned.includes(id) &&
            (!step.groups || step.groups.includes(hummingbird(id).group))
          );
        });
        const deckOk =
          !step.groups && (state.humDeck.length > 0 || state.humDiscard.length > 0);
        return visible || deckOk;
      };
      const returnable = (h: (typeof HABITATS)[number]) => {
        if (step.exclude === h) return false;
        const id = p.humBoard[h];
        return id != null && (!step.groups || step.groups.includes(hummingbird(id).group));
      };
      let pick: (typeof HABITATS)[number] | undefined;
      if (step.mode === 'attract') pick = HABITATS.find(attractable);
      else if (step.mode === 'return') pick = HABITATS.find(returnable);
      else pick = HABITATS.find(attractable) ?? HABITATS.find(returnable);
      if (!pick) {
        return step.optional ? { kind: 'boolean', yes: false } : null;
      }
      return { kind: 'habitat', habitat: pick };
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
