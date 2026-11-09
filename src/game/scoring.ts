// Round-goal unit counting and end-of-game scoring.

import { bonusCard, BIRD_BY_ID, goalTile } from './cards';
import { NECTAR_POINTS } from './constants';
import { DUET_MAP, DUET_TILE_PAIRS, duetIsEdge, duetNeighbors } from './duetMap';
import {
  isGoalDouble,
  isOceania,
  playedBirds,
  totalCached,
  totalEggs,
  totalFood,
  totalTucked,
} from './helpers';
import type { GameState, Habitat, PlayedBird, PlayerId, PlayerState, ScoreBreakdown } from './types';
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

// === asia duet goals ===

/** All duet tile ids (both sides of the six tiles). */
const DUET_TILE_IDS = new Set(DUET_TILE_PAIRS.flat());

/** Tokens `playerId` has on duet-map spaces matching `f`. */
function duetTokens(state: GameState, playerId: PlayerId, f: (i: number) => boolean): number {
  const map = state.duet?.map ?? [];
  let n = 0;
  for (let i = 0; i < map.length; i++) if (map[i] === playerId && f(i)) n++;
  return n;
}

/** Units for a duet goal tile (the "winner takes the round points" tiles). */
function duetGoalUnits(state: GameState, playerId: PlayerId, tileId: number): number {
  const spacesOf = (habitat: Habitat) => DUET_MAP.map((s, i) => ({ s, i })).filter(({ s }) => s.habitat === habitat).map(({ i }) => i);
  switch (tileId) {
    case 2034:
      return duetTokens(state, playerId, (i) => DUET_MAP[i]!.habitat === 'forest');
    case 2035:
      return duetTokens(state, playerId, (i) => DUET_MAP[i]!.habitat === 'grassland');
    case 2036:
      return duetTokens(state, playerId, (i) => DUET_MAP[i]!.habitat === 'wetland');
    case 2037: {
      // Most tokens in any one horizontal row.
      let best = 0;
      for (let r = 0; r < 6; r++) {
        const inRow = new Set(Array.from({ length: 6 }, (_, c) => r * 6 + c));
        best = Math.max(best, duetTokens(state, playerId, (i) => inRow.has(i)));
      }
      return best;
    }
    case 2038:
      return duetTokens(state, playerId, (i) => !duetIsEdge(i));
    case 2039:
      return duetTokens(state, playerId, (i) => DUET_MAP[i]!.criterion.type === 'nest');
    case 2040:
      return duetTokens(state, playerId, (i) => DUET_MAP[i]!.criterion.type === 'food');
    case 2041:
      return duetTokens(state, playerId, (i) => duetIsEdge(i));
    case 2042: {
      // Tokens on a pair of matching symbols: each token counts once, and a
      // token qualifies when its symbol appears on ≥2 of the player's spaces.
      const map = state.duet?.map ?? [];
      const seen = new Map<string, number>();
      const keyOf = (i: number) => {
        const c = DUET_MAP[i]!.criterion;
        return `${c.type}:${'nest' in c ? c.nest : 'food' in c ? c.food : 'lt50' in c ? c.lt50 : c.left}`;
      };
      for (let i = 0; i < map.length; i++) {
        if (map[i] !== playerId) continue;
        const k = keyOf(i);
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      let n = 0;
      for (let i = 0; i < map.length; i++) {
        if (map[i] === playerId && (seen.get(keyOf(i)) ?? 0) >= 2) n++;
      }
      return n;
    }
    case 2043:
      return duetTokens(state, playerId, (i) => DUET_MAP[i]!.bonus != null);
    case 2044: {
      // Rows (of 6) containing at least one of the player's tokens.
      let n = 0;
      for (let r = 0; r < 6; r++) {
        const inRow = new Set(Array.from({ length: 6 }, (_, c) => r * 6 + c));
        if (duetTokens(state, playerId, (i) => inRow.has(i)) > 0) n++;
      }
      return n;
    }
    case 2045:
      return duetTokens(state, playerId, () => true);
    default:
      void spacesOf;
      return 0;
  }
}

/** Largest contiguous group of `playerId`'s duet tokens (end-game points). */
export function duetLargestGroup(state: GameState, playerId: PlayerId): number {
  const map = state.duet?.map ?? [];
  const seen = new Set<number>();
  let best = 0;
  for (let i = 0; i < map.length; i++) {
    if (map[i] !== playerId || seen.has(i)) continue;
    // Flood-fill this connected component.
    let size = 0;
    const stack = [i];
    seen.add(i);
    while (stack.length > 0) {
      const cur = stack.pop()!;
      size++;
      for (const n of duetNeighbors(cur)) {
        if (!seen.has(n) && map[n] === playerId) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

/** Units a player has for a goal tile (ranked comparison happens in actions.ts). */
export function goalScore(state: GameState, playerId: PlayerId, tileId: number): number {
  const tile = goalTile(tileId);
  const p = state.players.find((x) => x.id === playerId)!;
  const g = tile.goal;
  if (state.duet && DUET_TILE_IDS.has(tileId)) {
    return duetGoalUnits(state, playerId, tileId);
  }
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

/** Units for a bonus card's scoring condition. Exported for the asia
 *  "score a bonus card now" powers. */
export function bonusUnits(p: PlayerState, name: string): number {
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
    // === asia bonus cards ===
    case 'Avian Theriogenologist':
      // Birds whose nests are completely full (as many eggs as the egg limit).
      return playedBirds(p).filter(({ bird: b }) => {
        const c = BIRD_BY_ID.get(b.cardId)!;
        return c.eggLimit > 0 && b.eggs >= c.eggLimit;
      }).length;
    case 'Endangered Species Protector':
      // Birds with powers that score or draw bonus cards.
      return playedBirds(p).filter(({ bird: b }) => BIRD_BY_ID.get(b.cardId)!.bonusPower).length;
    case 'Forest Population Monitor':
    case 'Grassland Population Monitor':
    case 'Wetland Population Monitor': {
      const habitat: Habitat = name.split(' ')[0]!.toLowerCase() as Habitat;
      const nests = new Set<string>();
      for (const { ref, bird: b } of playedBirds(p)) {
        if (ref.habitat !== habitat) continue;
        const nest = BIRD_BY_ID.get(b.cardId)!.nest;
        if (nest !== 'none') nests.add(nest);
      }
      return nests.size;
    }
    case 'Forest Ranger':
    case 'Grassland Ranger':
    case 'Wetland Ranger': {
      const habitat: Habitat = name.split(' ')[0]!.toLowerCase() as Habitat;
      const pts = p.board[habitat]
        .filter((b) => !b.ghost)
        .map((b) => BIRD_BY_ID.get(b.cardId)!.points);
      // Longest run of consecutive birds with strictly ascending or
      // strictly descending printed scores.
      let best = pts.length > 0 ? 1 : 0;
      let run = 1;
      let dir = 0;
      for (let i = 1; i < pts.length; i++) {
        const d = Math.sign(pts[i]! - pts[i - 1]!);
        if (d === 0) {
          run = 1;
          dir = 0;
        } else if (dir === 0 || d === dir) {
          run++;
          dir = d;
        } else {
          run = 2;
          dir = d;
        }
        best = Math.max(best, run);
      }
      return best;
    }
    case 'Pellet Dissector':
      return playedBirds(p).reduce(
        (n, { bird: b }) => n + b.cached.filter((f) => f === 'fish' || f === 'rodent').length,
        0,
      );
    case 'Winter Feeder':
      return totalFood(p);
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

/** Oceania end-game nectar majorities: per habitat, most spent nectar scores
 *  NECTAR_POINTS[0], second-most NECTAR_POINTS[1]; ties share the rank (all
 *  tied players get its points, the next rank is skipped). Players with 0
 *  spent nectar in a habitat cannot place there. */
export function nectarPoints(state: GameState, playerId: PlayerId): number {
  if (!isOceania(state)) return 0;
  const p = state.players.find((x) => x.id === playerId)!;
  let total = 0;
  for (const h of HABITATS) {
    const ranked = state.players
      .map((x) => ({ id: x.id, n: x.nectarSpent[h] }))
      .filter((x) => x.n > 0)
      .sort((a, b) => b.n - a.n);
    let rank = 0;
    for (let i = 0; i < ranked.length && rank < NECTAR_POINTS.length; i++) {
      if (i > 0 && ranked[i]!.n < ranked[i - 1]!.n) rank = i;
      if (rank >= NECTAR_POINTS.length) break;
      if (ranked[i]!.id === p.id) {
        total += NECTAR_POINTS[rank]!;
        break;
      }
    }
  }
  return total;
}

/** VP a bonus card is currently worth for `p` (used by asia "score now" powers). */
export function bonusCardVp(p: PlayerState, id: number): number {
  const card = bonusCard(id);
  return unitsToVp(card.vp, bonusUnits(p, card.name));
}

export function bonusPoints(p: PlayerState): number {
  let total = 0;
  // Hand cards plus bonus cards copied from neighbours by game-end powers
  // (asia Adjutants — scored against this player's birds).
  for (const id of [...p.bonusHand, ...p.copiedBonus]) {
    total += bonusCardVp(p, id);
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
  const nectar = nectarPoints(state, playerId);
  // Duet mode: 1 pt per token in the largest contiguous group on the map.
  const duetTokens = state.duet ? duetLargestGroup(state, playerId) : 0;
  const total = birdPoints + bonus + eggs + cached + tucked + goalPoints + nectar + duetTokens;
  return { birdPoints, bonusPoints: bonus, eggs, cached, tucked, nectar, duetTokens, goalPoints, total };
}
