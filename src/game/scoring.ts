// Round-goal unit counting and end-of-game scoring.

import { bonusCard, BIRD_BY_ID, goalTile } from './cards';
import {
  birdCount,
  playedBirds,
  totalCached,
  totalEggs,
  totalFood,
  totalTucked,
} from './helpers';
import type { GameState, PlayerId, PlayerState, ScoreBreakdown } from './types';
import { HABITATS } from './types';

/** Units a player has for a goal tile (ranked comparison happens in actions.ts). */
export function goalScore(state: GameState, playerId: PlayerId, tileId: number): number {
  const tile = goalTile(tileId);
  const p = state.players.find((x) => x.id === playerId)!;
  const g = tile.goal;
  switch (g.kind) {
    case 'birdsInHabitat':
      return p.board[g.habitat].length;
    case 'eggsInHabitat':
      return p.board[g.habitat].reduce((n, b) => n + b.eggs, 0);
    case 'birdsInOneRow':
      return Math.max(...HABITATS.map((h) => p.board[h].length));
    case 'birdsNoEggs':
      return playedBirds(p).filter(({ bird: b }) => b.eggs === 0).length;
    case 'birdsPoints': {
      return playedBirds(p).filter(({ bird: b }) => {
        const pts = BIRD_BY_ID.get(b.cardId)!.points;
        return g.op === 'gt' ? pts > g.value : pts <= g.value;
      }).length;
    }
    case 'nestBirdsWithEggs':
      return playedBirds(p).filter(({ bird: b }) => {
        const c = BIRD_BY_ID.get(b.cardId)!;
        return (c.nest === g.nest || c.nest === 'wild') && b.eggs > 0;
      }).length;
    case 'eggsInNest':
      return playedBirds(p).reduce((n, { bird: b }) => {
        const c = BIRD_BY_ID.get(b.cardId)!;
        return n + ((c.nest === g.nest || c.nest === 'wild') ? b.eggs : 0);
      }, 0);
    case 'cardsInHand':
      return p.hand.length;
    case 'foodInSupply':
      return totalFood(p);
    case 'birdsPowerColor':
      return playedBirds(p).filter(({ bird: b }) => {
        const c = BIRD_BY_ID.get(b.cardId)!;
        if (g.color === 'white') return c.powerColor === 'white' && !c.powerText;
        return c.powerColor === g.color;
      }).length;
    case 'filledColumns': {
      let n = 0;
      for (let i = 0; i < 5; i++) {
        if (HABITATS.every((h) => p.board[h].length > i)) n++;
      }
      return n;
    }
    case 'foodCostTotal':
      return playedBirds(p).reduce((n, { bird: b }) => n + costTotal(BIRD_BY_ID.get(b.cardId)!.cost), 0);
    case 'setsOfThreeEggs':
      return Math.min(...HABITATS.map((h) => p.board[h].reduce((x, b) => x + b.eggs, 0)));
    case 'totalBirds':
      return birdCount(p);
    case 'birdsWithTucked':
      return playedBirds(p).filter(({ bird: b }) => b.tucked.length > 0).length;
    case 'beakDirection':
      return playedBirds(p).filter(({ bird: b }) => BIRD_BY_ID.get(b.cardId)!.beakLeft === (g.dir === 'L')).length;
    case 'cubesOnPlayBird':
      return p.cubesOnPlayBird;
    case 'costIncludes':
      return playedBirds(p).filter(({ bird: b }) => {
        const cost = BIRD_BY_ID.get(b.cardId)!.cost;
        const have = (f: string) =>
          cost.kind === 'and'
            ? cost.items.some((i) => i.food === f || i.food === 'any')
            : cost.kind === 'or'
              ? cost.foods.includes(f as never)
              : cost.kind === 'any';
        return g.all ? g.foods.every(have) : g.foods.some(have);
      }).length;
    case 'noGoal':
    case 'unsupported':
      return 0;
  }
}

function costTotal(cost: { kind: string; items?: { count: number }[]; count?: number }): number {
  if (cost.kind === 'none') return 0;
  if (cost.kind === 'any' || cost.kind === 'or') return cost.count ?? 1;
  return (cost.items ?? []).reduce((n, i) => n + i.count, 0);
}

/** Units for a bonus card's scoring condition. */
function bonusUnits(p: PlayerState, name: string): number {
  switch (name) {
    case 'Breeding Manager':
      return playedBirds(p).filter(({ bird: b }) => b.eggs >= 4).length;
    case 'Oologist':
      return playedBirds(p).filter(({ bird: b }) => b.eggs >= 1).length;
    case 'Ecologist': {
      const min = Math.min(...HABITATS.map((h) => p.board[h].length));
      return p.board[HABITATS.find((h) => p.board[h].length === min)!].length;
    }
    case 'Visionary Leader':
      return p.hand.length;
    default:
      return playedBirds(p).filter(({ bird: b }) => BIRD_BY_ID.get(b.cardId)!.bonusFlags.includes(name)).length;
  }
}

/** Convert a unit count to VP using the card's parsed vp spec. */
function unitsToVp(vp: { kind: string; tiers?: { min: number; max: number | null; vp: number }[]; per?: number; one?: number; two?: number }, units: number): number {
  if (vp.kind === 'tiers' && vp.tiers) {
    for (const t of vp.tiers) {
      if (units >= t.min && (t.max == null || units <= t.max)) return t.vp;
    }
    return 0;
  }
  if (vp.kind === 'linear' && vp.per != null) return vp.per * units;
  return 0;
}

export function bonusPoints(p: PlayerState): number {
  let total = 0;
  for (const id of p.bonusHand) {
    const card = bonusCard(id);
    total += unitsToVp(card.vp, bonusUnits(p, card.name));
  }
  return total;
}

/** Full end-of-game score for one player. */
export function finalScore(state: GameState, playerId: PlayerId): ScoreBreakdown {
  const p = state.players.find((x) => x.id === playerId)!;
  const birdPoints = playedBirds(p).reduce((n, { bird: b }) => n + BIRD_BY_ID.get(b.cardId)!.points, 0);
  const bonus = bonusPoints(p);
  const eggs = totalEggs(p);
  const cached = totalCached(p);
  const tucked = totalTucked(p);
  const idx = state.playerOrder.indexOf(playerId);
  const goalPoints = state.goalScores.reduce((n, round) => n + (round[idx] ?? 0), 0);
  const nectar = 0; // Oceania scoring lands with the expansion.
  const total = birdPoints + bonus + eggs + cached + tucked + goalPoints + nectar;
  return { birdPoints, bonusPoints: bonus, eggs, cached, tucked, nectar, goalPoints, total };
}
