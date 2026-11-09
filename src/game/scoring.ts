// Round-goal unit counting and end-of-game scoring.

import { bonusCard, BIRD_BY_ID, goalTile } from './cards';
import {
  isGoalDouble,
  playedBirds,
  totalCached,
  totalEggs,
  totalFood,
  totalTucked,
} from './helpers';
import type { GameState, PlayedBird, PlayerId, PlayerState, ScoreBreakdown } from './types';
import { HABITATS } from './types';

/** Goal-unit weight of a played bird: european "counts double toward the
 *  end-of-round goal" teal powers double the bird when it qualifies. */
function goalWeight(b: PlayedBird): number {
  return isGoalDouble(BIRD_BY_ID.get(b.cardId)!) ? 2 : 1;
}

/** Power colors present among `birds`; birds with no power count as white. */
function powerColorsOf(birds: PlayedBird[]): Set<string> {
  const colors = new Set<string>();
  for (const b of birds) colors.add(BIRD_BY_ID.get(b.cardId)!.powerColor ?? 'white');
  return colors;
}

/** Units a player has for a goal tile (ranked comparison happens in actions.ts). */
export function goalScore(state: GameState, playerId: PlayerId, tileId: number): number {
  const tile = goalTile(tileId);
  const p = state.players.find((x) => x.id === playerId)!;
  const g = tile.goal;
  switch (g.kind) {
    case 'birdsInHabitat':
      return playedBirds(p)
        .filter(({ ref }) => ref.habitat === g.habitat)
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
    case 'eggsInHabitat':
      return p.board[g.habitat].reduce((n, b) => n + b.eggs, 0);
    case 'birdsInOneRow':
      return Math.max(
        ...HABITATS.map((h) =>
          playedBirds(p)
            .filter(({ ref }) => ref.habitat === h)
            .reduce((n, { bird: b }) => n + goalWeight(b), 0),
        ),
      );
    case 'birdsNoEggs':
      return playedBirds(p)
        .filter(({ bird: b }) => b.eggs === 0)
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
    case 'birdsPoints': {
      return playedBirds(p)
        .filter(({ bird: b }) => {
          const pts = BIRD_BY_ID.get(b.cardId)!.points;
          return g.op === 'gt' ? pts > g.value : pts <= g.value;
        })
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
    }
    case 'nestBirdsWithEggs':
      return playedBirds(p)
        .filter(({ bird: b }) => {
          const c = BIRD_BY_ID.get(b.cardId)!;
          return (c.nest === g.nest || c.nest === 'wild') && b.eggs > 0;
        })
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
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
      return playedBirds(p)
        .filter(({ bird: b }) => {
          const c = BIRD_BY_ID.get(b.cardId)!;
          // "White & No Powers": no power at all, or a when-played power.
          if (g.color === 'white') return c.powerColor == null || c.powerColor === 'white';
          return c.powerColor === g.color;
        })
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
    case 'filledColumns': {
      // Counts covered (ghost) spaces too: sideways birds fill both spaces.
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
      return playedBirds(p).reduce((n, { bird: b }) => n + goalWeight(b), 0);
    case 'birdsWithTucked':
      return playedBirds(p)
        .filter(({ bird: b }) => b.tucked.length > 0)
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
    case 'beakDirection':
      return playedBirds(p)
        .filter(({ bird: b }) => BIRD_BY_ID.get(b.cardId)!.beakLeft === (g.dir === 'L'))
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
    case 'cubesOnPlayBird':
      return p.cubesOnPlayBird;
    case 'costIncludes':
      return playedBirds(p)
        .filter(({ bird: b }) => {
          const cost = BIRD_BY_ID.get(b.cardId)!.cost;
          const have = (f: string) =>
            cost.kind === 'and'
              ? cost.items.some((i) => i.food === f || i.food === 'any')
              : cost.kind === 'or'
                ? cost.foods.includes(f as never)
                : cost.kind === 'any';
          return g.all ? g.foods.every(have) : g.foods.some(have);
        })
        .reduce((n, { bird: b }) => n + goalWeight(b), 0);
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
    case 'Ecologist':
      return Math.min(
        ...HABITATS.map((h) => playedBirds(p).filter(({ ref }) => ref.habitat === h).length),
      );
    case 'Visionary Leader':
      return p.hand.length;
    // === european bonus cards ===
    case 'Citizen Scientist':
      return playedBirds(p).filter(({ bird: b }) => b.tucked.length > 0).length;
    case 'Diet Specialist':
      return playedBirds(p).filter(({ bird: b }) => costTotal(BIRD_BY_ID.get(b.cardId)!.cost) === 3).length;
    case 'Ethologist': {
      // "In any one habitat: 2[point] per power color" — best single habitat.
      return Math.max(
        0,
        ...HABITATS.map(
          (h) =>
            powerColorsOf(
              playedBirds(p)
                .filter(({ ref }) => ref.habitat === h)
                .map(({ bird: b }) => b),
            ).size,
        ),
      );
    }
    case 'Behaviorist': {
      // Columns (all three rows) holding birds with 3 different power colors.
      // A sideways bird covers a space in the column — its color counts there.
      let n = 0;
      for (let i = 0; i < 5; i++) {
        const column = HABITATS.map((h) => p.board[h][i]).filter(
          (b): b is NonNullable<typeof b> => b != null,
        );
        if (column.length === 3 && powerColorsOf(column).size >= 3) n++;
      }
      return n;
    }
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
