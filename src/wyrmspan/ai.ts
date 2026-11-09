// Greedy heuristic AI: resolves pending choices sensibly, otherwise prefers
// entice > excavate > explore > pass.

import { dragonCard, isDragonCard, parseIcons } from './cards';
import { dragonCost, excavateEggCost, exploreCost, nextEmptySpace } from './actions';
import { INCOME_SECTIONS, incomeSectionIndex } from './guild';
import { allDragons, canPay, player } from './helpers';
import type { Action, ChoiceAnswer, GameState, PlayerId, Resource } from './types';
import { RESOURCES } from './types';

export function chooseAction(state: GameState, playerId: PlayerId): Action | null {
  const p = player(state, playerId);
  const head = state.pending[0];
  if (head) {
    if (head.playerId !== playerId) return null;
    return { type: 'resolveChoice', playerId, answer: answerFor(state, playerId) };
  }
  if (state.phase !== 'main' || state.turn !== playerId || p.passed) return null;

  // Prefer enticing a playable dragon we can afford.
  for (const id of p.hand.filter(isDragonCard)) {
    const card = dragonCard(id);
    const cave = card.caves.map(caveIndex).find((c) => p.caves[c]!.spaces.some((sp) => sp.excavated && !sp.dragon));
    if (cave !== undefined && canPay(p, dragonCost(id))) {
      return { type: 'entice', playerId, cave, cardId: id };
    }
  }
  // Then excavate if we hold a cave card and can pay.
  const caveCards = p.hand.filter((c) => !isDragonCard(c));
  if (caveCards.length) {
    for (let cave = 0; cave < 3; cave++) {
      const idx = nextEmptySpace(p, cave);
      if (idx < 0) continue;
      const eggs = excavateEggCost(idx);
      const cost = [
        { kind: 'coin', count: 1 } as const,
        ...(eggs ? [{ kind: 'egg', count: eggs } as const] : []),
      ];
      if (canPay(p, cost as never)) {
        return { type: 'excavate', playerId, cave, cardId: caveCards[0]! };
      }
    }
  }
  // Then explore the cave with the most dragons, if affordable and under the
  // 3-explores-per-cave-per-round cap.
  const caveNames = ['crimson', 'golden', 'amethyst'] as const;
  let bestCave = -1;
  let bestCount = 0;
  for (let cave = 0; cave < 3; cave++) {
    if (p.explores[caveNames[cave]!] >= 3) continue;
    const n = p.caves[cave]!.spaces.filter((sp) => sp.dragon).length;
    if (n > bestCount && canPay(p, exploreCost(p, cave) as never)) {
      bestCount = n;
      bestCave = cave;
    }
  }
  if (bestCave >= 0) return { type: 'explore', playerId, cave: bestCave };
  return { type: 'pass', playerId };
}

function caveIndex(name: string): number {
  return name === 'Crimson Cavern' ? 0 : name === 'Golden Grotto' ? 1 : 2;
}

/** Greedy answers for the head pending step of `playerId`. */
export function answerFor(state: GameState, playerId: PlayerId): ChoiceAnswer {
  const p = player(state, playerId);
  const head = state.pending[0];
  if (!head) return { kind: 'decline' };
  switch (head.kind) {
    case 'setupCards':
      return { kind: 'cards', cardIds: head.offer.slice(0, head.keep) };
    case 'setupResources':
      return { kind: 'resources', resources: ['meat', 'gold', 'crystal'] };
    case 'chooseResource':
      if (head.mode === 'gain') return { kind: 'resources', resources: Array(head.count).fill('meat') as Resource[] };
      if (head.mode === 'pay' || head.mode === 'discard') {
        const owned = RESOURCES.filter((r) => p.resources[r] > 0);
        return { kind: 'resources', resources: Array(head.count).fill(owned[0] ?? 'meat') as Resource[] };
      }
      return { kind: 'decline' };
    case 'chooseEggSpot': {
      const spots: ChoiceAnswer = {
        kind: 'eggSpots',
        spots: [],
      };
      const list = (spots as { spots: ({ kind: 'dragon'; pos: [number, number] } | { kind: 'nest' })[] }).spots;
      for (const d of allDragons(p)) {
        if (list.length >= head.count) break;
        if (d.dragon.eggs < dragonCard(d.dragon.cardId).capacity) {
          list.push({ kind: 'dragon', pos: [d.cave, d.space] });
        }
      }
      // Overflow onto the printed mat nests (only for 'any' targets).
      if (head.target.kind === 'any') {
        while (list.length < head.count && p.nestEggs + list.filter((x) => x.kind === 'nest').length < 2) {
          list.push({ kind: 'nest' });
        }
      }
      return list.length || !head.optional ? spots : { kind: 'decline' };
    }
    case 'chooseEggPayment': {
      const spots: { kind: 'dragon'; pos: [number, number] }[] = [];
      for (const d of allDragons(p)) {
        if (spots.length >= head.count) break;
        if (d.dragon.eggs > 0) spots.push({ kind: 'dragon', pos: [d.cave, d.space] });
      }
      return { kind: 'eggSpots', spots };
    }
    case 'chooseCache': {
      const res: Resource[] = Array(head.count).fill('meat');
      const pos = allDragons(p)[0];
      return pos
        ? ({ kind: 'dragons', positions: [[pos.cave, pos.space]] } as ChoiceAnswer)
        : ({ kind: 'resources', resources: res } as ChoiceAnswer);
    }
    case 'chooseTuck': {
      const pos = allDragons(p)[0];
      if (!pos) return { kind: 'decline' };
      const cards = p.hand.filter(isDragonCard).slice(0, head.count);
      if (!cards.length) return head.upTo ? { kind: 'decline' } : { kind: 'dragons', positions: [[pos.cave, pos.space]] };
      return {
        kind: 'assignTucks',
        assignments: cards.map((cardId) => ({ cardId, pos: [pos.cave, pos.space] as [number, number] })),
      };
    }
    case 'choosePay':
      return canPay(p, head.tiers[0]!.cost) ? { kind: 'option', index: 0 } : { kind: 'decline' };
    case 'chooseHandCards': {
      const pool = p.hand.filter((id) => head.what === 'any' || (head.what === 'dragon') === isDragonCard(id));
      return { kind: 'cards', cardIds: pool.slice(0, head.count) };
    }
    case 'chooseDisplay': {
      const key = head.deck === 'dragon' ? 'dragonDisplay' : 'caveDisplay';
      const i = state[key].findIndex((c) => c !== null);
      return { kind: 'index', index: Math.max(0, i) };
    }
    case 'distributeCards':
      return { kind: 'indexes', indexes: head.cardIds.map((_, i) => i) };
    case 'chooseAbility':
      return { kind: 'indexes', indexes: head.candidates.map((_, i) => i).slice(0, head.count) };
    case 'chooseExcavate': {
      const pool = head.source === 'hand' ? p.hand.filter((c) => !isDragonCard(c)) : state.caveDisplay.filter((c) => c !== null);
      if (!pool.length && head.source !== 'deck') return { kind: 'decline' };
      const cave = [0, 1, 2].find((c) => p.caves[c]!.spaces.some((sp) => !sp.excavated));
      if (cave === undefined) return { kind: 'decline' };
      return { kind: 'index', index: 0 * 3 + cave };
    }
    case 'choosePlayDragon': {
      const pool = p.hand.filter(isDragonCard);
      if (!pool.length) return { kind: 'decline' };
      return { kind: 'index', index: 0 };
    }
    case 'chooseGuildSquare':
      return { kind: 'index', index: 0 };
    case 'chooseOption':
      return { kind: 'option', index: 0 };
    case 'chooseTrain': {
      // Pinned choice (e.g. the fledgling the adventurer just walked over):
      // train it — trainAt no-ops if the next box can't be paid.
      if (head.pos) return { kind: 'dragon', pos: head.pos };
      const fl = allDragons(p).find((d) => {
        const c = dragonCard(d.dragon.cardId);
        // The track length is the number of cost ICONS, not the string length.
        const track = c.trainingTrack ? parseIcons(c.trainingTrack).length : 0;
        return c.size === 'Fledgling' && track > 0 && (d.dragon.training ?? 0) < track;
      });
      if (!fl) return { kind: 'decline' };
      return { kind: 'dragon', pos: [fl.cave, fl.space] };
    }
    case 'chooseSwap': {
      const ds = allDragons(p).slice(0, 2);
      if (ds.length < 2) return { kind: 'decline' };
      return { kind: 'dragons', positions: ds.map((d) => [d.cave, d.space] as [number, number]) };
    }
    case 'opponentMay':
      return { kind: 'confirm' };
    case 'discardDown': {
      const excessCards = Math.max(0, p.hand.length - 9);
      const excessRes = Math.max(0, RESOURCES.reduce((a, r) => a + p.resources[r], 0) - 9);
      if (excessCards > 0) return { kind: 'cards', cardIds: p.hand.slice(0, excessCards) };
      // Discard excess resources (dump the most plentiful first).
      const toDrop: Resource[] = [];
      const order = [...RESOURCES].sort((a, b) => p.resources[b] - p.resources[a]);
      let remaining = excessRes;
      for (const r of order) {
        const n = Math.min(remaining, p.resources[r]);
        for (let i = 0; i < n; i++) toDrop.push(r);
        remaining -= n;
        if (remaining <= 0) break;
      }
      return { kind: 'resources', resources: toDrop };
    }
    case 'oncePerRoundPick':
      return { kind: 'index', index: 0 };
    case 'payDragonCost':
      return { kind: 'option', index: 0 };
    case 'chooseIncomeSpace': {
      // Greedy: prefer more coins, then more total items.
      const section = INCOME_SECTIONS[incomeSectionIndex(state.round)]!;
      let best = 0;
      let bestScore = -1;
      head.options.forEach((sp, i) => {
        const items = section[sp]!.items;
        const coins = items.reduce((a, it) => a + (it.kind === 'coin' ? it.count : 0), 0);
        const stuff = items.reduce((a, it) => a + it.count, 0);
        const score = coins * 10 + stuff;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      return { kind: 'index', index: best };
    }
    case 'chooseBenefits':
      return { kind: 'indexes', indexes: head.options.map((_, i) => i).slice(0, head.count) };
  }
}
