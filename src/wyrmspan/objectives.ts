// Public objectives: the round tracker holds 4 objective tiles (one per
// round). At round end each player ranks against the others on the tile's
// unit count and banks VP per the escalating table below (ties are friendly:
// tied players share the same rank and its VP).

import { dragonCard, dragonMatchesCond, parseIcons } from './cards';
import type { DragonCond, GameState, ObjectiveId, PlayerId, PlayerState } from './types';
import { CAVE_IDS } from './types';

// ---------------------------------------------------------------------------
// Unit counting helpers (shared with end-game counters where possible)

export function dragonsOnMat(p: PlayerState): { cave: number; space: number; cardId: number }[] {
  const out: { cave: number; space: number; cardId: number }[] = [];
  p.caves.forEach((row, cave) =>
    row.spaces.forEach((sp, space) => {
      if (sp.dragon) out.push({ cave, space, cardId: sp.dragon.cardId });
    }),
  );
  return out;
}

function countDragons(p: PlayerState, cond?: DragonCond, caveIdx?: number): number {
  return dragonsOnMat(p).filter(
    (d) => (caveIdx === undefined || d.cave === caveIdx) && (!cond || dragonMatchesCond(dragonCard(d.cardId), cond)),
  ).length;
}

function eggsOnMat(p: PlayerState): number {
  let n = p.nestEggs;
  for (const d of dragonsOnMat(p)) n += p.caves[d.cave].spaces[d.space].dragon!.eggs;
  return n;
}

function tuckedCards(p: PlayerState): number {
  return dragonsOnMat(p).reduce((a, d) => a + p.caves[d.cave].spaces[d.space].dragon!.tucked.length, 0);
}

function cachedResources(p: PlayerState): number {
  return dragonsOnMat(p).reduce((a, d) => a + p.caves[d.cave].spaces[d.space].dragon!.cached.length, 0);
}

function caveCardsOnMat(p: PlayerState): number {
  return p.caves.reduce((a, row) => a + row.spaces.filter((s) => s.excavated && s.caveCardId !== null).length, 0);
}

// ---------------------------------------------------------------------------
// Objective definitions. Each objective's `unit` returns the countable value.

interface ObjectiveDef {
  label: string;
  unit(state: GameState, p: PlayerState): number;
}

export const OBJECTIVES: Record<ObjectiveId, ObjectiveDef> = {
  hatchlingsOnMat: { label: 'hatchlings on your player mat', unit: (_s, p) => countDragons(p, { size: 'Hatchling' }) },
  mediumDragonsOnMat: { label: 'medium dragons on your player mat', unit: (_s, p) => countDragons(p, { size: 'Medium' }) },
  smallDragons: { label: 'small dragons on your player mat', unit: (_s, p) => countDragons(p, { size: 'Small' }) },
  largeDragons: { label: 'large dragons on your player mat', unit: (_s, p) => countDragons(p, { size: 'Large' }) },
  cardsInCrimson: {
    label: 'cards in your Crimson Cavern',
    unit: (_s, p) =>
      p.caves[0].spaces.filter((sp) => sp.excavated && (sp.caveCardId !== null || sp.dragon)).length,
  },
  cardsInGolden: {
    label: 'cards in your Golden Grotto',
    unit: (_s, p) =>
      p.caves[1].spaces.filter((sp) => sp.excavated && (sp.caveCardId !== null || sp.dragon)).length,
  },
  cardsInAmethyst: {
    label: 'cards in your Amethyst Abyss',
    unit: (_s, p) =>
      p.caves[2].spaces.filter((sp) => sp.excavated && (sp.caveCardId !== null || sp.dragon)).length,
  },
  shyDragons: { label: 'SHY dragons', unit: (_s, p) => countDragons(p, { personality: 'Shy' }) },
  playfulDragons: { label: 'PLAYFUL dragons', unit: (_s, p) => countDragons(p, { personality: 'Playful' }) },
  helpfulDragons: { label: 'HELPFUL dragons', unit: (_s, p) => countDragons(p, { personality: 'Helpful' }) },
  aggressiveDragons: { label: 'AGGRESSIVE dragons', unit: (_s, p) => countDragons(p, { personality: 'Aggressive' }) },
  eggsOnMat: { label: 'eggs on your player mat', unit: (_s, p) => eggsOnMat(p) },
  tuckedCards: { label: 'tucked cards', unit: (_s, p) => tuckedCards(p) },
  cachedResources: { label: 'cached resources', unit: (_s, p) => cachedResources(p) },
  totalDragons: { label: 'dragons on your player mat', unit: (_s, p) => countDragons(p) },
  caveCardsOnMat: { label: 'cave cards on your player mat', unit: (_s, p) => caveCardsOnMat(p) },
  dragonsInOneCave: {
    label: 'dragons in one cave',
    unit: (_s, p) => Math.max(...CAVE_IDS.map((_, i) => countDragons(p, undefined, i))),
  },
  dragonsInColumn: {
    label: 'dragons in one column',
    unit: (_s, p) =>
      Math.max(
        ...[0, 1, 2, 3].map((col) => p.caves.filter((row) => row.spaces[col]!.dragon).length),
      ),
  },
  guildMarkers: { label: 'markers on the Dragon Guild', unit: (_s, p) => p.guildMarkersPlaced },
  resourcesInSupply: {
    label: 'resources in your supply',
    unit: (_s, p) => p.resources.meat + p.resources.gold + p.resources.crystal + p.resources.milk,
  },
  costCrystal: { label: 'dragons costing [Crystal]', unit: (_s, p) => countDragons(p, { costHas: 'crystal' }) },
  costMilk: { label: 'dragons costing [Milk]', unit: (_s, p) => countDragons(p, { costHas: 'milk' }) },
  costMeat: { label: 'dragons costing [Meat]', unit: (_s, p) => countDragons(p, { costHas: 'meat' }) },
  costGold: { label: 'dragons costing [Gold]', unit: (_s, p) => countDragons(p, { costHas: 'gold' }) },
  vp4PlusDragons: {
    label: 'dragons worth 4+ VP',
    unit: (_s, p) => dragonsOnMat(p).filter((d) => dragonCard(d.cardId).vp >= 4).length,
  },
  fledglingsOnMat: { label: 'fledglings on your player mat', unit: (_s, p) => countDragons(p, { size: 'Fledgling' }) },
  trainedFledglings: {
    label: 'fully trained fledglings',
    unit: (_s, p) =>
      dragonsOnMat(p).filter((d) => {
        const played = p.caves[d.cave].spaces[d.space].dragon!;
        const card = dragonCard(d.cardId);
        const track = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
        return card.size === 'Fledgling' && track > 0 && (played.training ?? 0) >= track;
      }).length,
  },
  coinsSpentEntice: {
    label: 'coins spent enticing dragons',
    unit: (_s, p) => p.coinsSpentEntice,
  },
  setsOfTraits: {
    label: 'sets of dragon traits (1 of each personality)',
    unit: (_s, p) => {
      const counts = (['Shy', 'Playful', 'Helpful', 'Aggressive'] as const).map((per) =>
        countDragons(p, { personality: per }),
      );
      return Math.min(...counts);
    },
  },
};

export const OBJECTIVE_IDS = Object.keys(OBJECTIVES) as ObjectiveId[];

// ---------------------------------------------------------------------------
// Automa 4-round base values (X/X/X/X printed on each objective tile) and
// physical maximum caps per dragon automa.txt lines 405-420.

export const AUTOMA_OBJECTIVE_BASE: Record<ObjectiveId, [number, number, number, number]> = {
  hatchlingsOnMat: [0, 0, 1, 2],
  mediumDragonsOnMat: [0, 1, 2, 3],
  smallDragons: [0, 1, 2, 3],
  largeDragons: [0, 1, 2, 3],
  cardsInCrimson: [1, 2, 4, 5],
  cardsInGolden: [1, 2, 4, 5],
  cardsInAmethyst: [1, 2, 4, 5],
  shyDragons: [0, 1, 2, 3],
  playfulDragons: [0, 1, 2, 3],
  helpfulDragons: [0, 1, 2, 3],
  aggressiveDragons: [0, 1, 2, 3],
  eggsOnMat: [1, 2, 5, 10],
  tuckedCards: [0, 1, 3, 5],
  cachedResources: [0, 1, 3, 5],
  totalDragons: [1, 2, 4, 6],
  caveCardsOnMat: [1, 2, 4, 6],
  dragonsInOneCave: [1, 1, 2, 3],
  dragonsInColumn: [0, 1, 2, 2],
  guildMarkers: [0, 1, 2, 3],
  resourcesInSupply: [0, 1, 2, 3],
  costCrystal: [0, 1, 2, 4],
  costMilk: [0, 1, 2, 3],
  costMeat: [0, 1, 2, 4],
  costGold: [0, 1, 2, 4],
  vp4PlusDragons: [0, 1, 2, 3],
  fledglingsOnMat: [0, 1, 1, 2],
  trainedFledglings: [0, 0, 1, 2],
  coinsSpentEntice: [0, 1, 1, 0],
  setsOfTraits: [0, 0, 1, 1],
};

export const AUTOMA_OBJECTIVE_MAX: Partial<Record<ObjectiveId, number>> = {
  hatchlingsOnMat: 12,
  mediumDragonsOnMat: 12,
  smallDragons: 12,
  largeDragons: 12,
  cardsInCrimson: 7,
  cardsInGolden: 7,
  cardsInAmethyst: 7,
  shyDragons: 12,
  playfulDragons: 12,
  helpfulDragons: 12,
  aggressiveDragons: 12,
  totalDragons: 12,
  caveCardsOnMat: 9,
  dragonsInOneCave: 4,
  dragonsInColumn: 3,
  guildMarkers: 4,
  resourcesInSupply: 9,
  costCrystal: 12,
  costMilk: 12,
  costMeat: 12,
  costGold: 12,
  vp4PlusDragons: 12,
  fledglingsOnMat: 12,
  trainedFledglings: 12,
  setsOfTraits: 3,
};

/** Compute Automa's unit count for the objective in `roundIndex` (0..3). */
export function automaObjectiveUnits(state: GameState, roundIndex: number): number {
  const objId = state.objectives[roundIndex]!;
  const base = AUTOMA_OBJECTIVE_BASE[objId]?.[roundIndex] ?? 0;
  const coins = state.automa?.objectiveCoins ?? 0;
  const raw = Math.max(0, base + coins);
  const cap = AUTOMA_OBJECTIVE_MAX[objId];
  return cap !== undefined ? Math.min(raw, cap) : raw;
}

// ---------------------------------------------------------------------------
// Round scoring. Each round's objective scores [1st, 2nd, 3rd, all-others] VP;
// values escalate per round (mirrors the printed round-tracker).

export const ROUND_OBJECTIVE_VP: [number, number, number, number][] = [
  [4, 1, 0, 0],
  [5, 2, 1, 0],
  [6, 3, 2, 0],
  [7, 4, 3, 0],
];

/** Rank players on `units`; returns per-player VP for the given round. */
export function scoreObjective(
  state: GameState,
  roundIndex: number,
): Record<PlayerId, number> {
  const obj = OBJECTIVES[state.objectives[roundIndex]!];
  const units = new Map<PlayerId, number>();
  for (const p of state.players) {
    if (state.automa && p.id === 'p2') {
      units.set(p.id, automaObjectiveUnits(state, roundIndex));
    } else {
      units.set(p.id, obj.unit(state, p));
    }
  }

  const [v1, v2, v3, vRest] = ROUND_OBJECTIVE_VP[roundIndex]!;
  const sorted = [...state.players].sort((a, b) => units.get(b.id)! - units.get(a.id)!);
  const out = {} as Record<PlayerId, number>;
  let rank = 0; // current place index (0-based compressed ranks)
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && units.get(sorted[j]!.id) === units.get(sorted[i]!.id)) j++;
    const group = sorted.slice(i, j);
    const zero = units.get(group[0]!.id) === 0;
    const vp = zero ? 0 : rank === 0 ? v1 : rank === 1 ? v2 : rank === 2 ? v3 : vRest;
    for (const p of group) out[p.id] = vp;
    rank++;
    i = j;
  }
  return out;
}
