// Official Finspan Nautoma solo mode (+ Ravel Mode + Sharks & Reefs Nautoma).
//
// Transcribed from:
//   * Base Nautoma rulebook: docs/extracted/fish automa.txt and
//     docs/extracted/pages/fish_automa_p01.png..p08.png
//   * Sharks & Reefs rules + Nautoma update: docs/extracted/sharks.txt,
//     docs/extracted/pages/sharks_p07.png..p08.png, and FS_S&R_AutomaRulebook.

import { shuffle } from '../shared/rng';
import { allSlots } from './helpers';
import type { AchievementKind, NautomaState, PlayerState } from './types';

export interface NautomaDecisionCard {
  id: number;
  /** +1 = place diver on achievement board, -1 = remove diver, 0 = none. */
  achievementDelta: -1 | 0 | 1;
  /** True if this card performs the 3-step Dive action. */
  dive: boolean;
  /** Eggs gained in step 3 of the Dive action (2 on all Dive cards). */
  diveEggs: number;
  /** S&R replacement cards (IDs 1, 2, 6): convert 1 egg -> 1 coral (2 at diff 4-5). */
  addCoral: boolean;
  /** True if this card performs the Play a Fish Card action. */
  playFish: boolean;
}

/** The 7 official Nautoma decision cards (IDs 1..7).
 *  Cards 1, 2, 6 are the Play-a-Fish cards (which also carry Add Coral in S&R);
 *  Cards 3, 4, 5, 7 are the Dive cards (convert 3 young -> 1 school 1x, convert
 *  <=4 eggs -> young, gain 2 eggs). */
export const NAUTOMA_DECISION_CARDS: NautomaDecisionCard[] = [
  { id: 1, achievementDelta: 1, dive: false, diveEggs: 0, addCoral: true, playFish: true },
  { id: 2, achievementDelta: 0, dive: false, diveEggs: 0, addCoral: true, playFish: true },
  { id: 3, achievementDelta: 0, dive: true, diveEggs: 2, addCoral: false, playFish: false },
  { id: 4, achievementDelta: 1, dive: true, diveEggs: 2, addCoral: false, playFish: false },
  { id: 5, achievementDelta: 1, dive: true, diveEggs: 2, addCoral: false, playFish: false },
  { id: 6, achievementDelta: -1, dive: false, diveEggs: 0, addCoral: true, playFish: true },
  { id: 7, achievementDelta: -1, dive: true, diveEggs: 2, addCoral: false, playFish: false },
];

export function getNautomaDecisionCard(id: number): NautomaDecisionCard {
  const c = NAUTOMA_DECISION_CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown Nautoma decision card ${id}`);
  return c;
}

export interface RavelScoringCard {
  id: string;
  /** Highlighted dive site column (0 = blue/left, 1 = purple/center, 2 = green/right) worth +X per fish. */
  site: 0 | 1 | 2;
  /** Highlighted ocean mat rows (0..5) worth -1 per fish. */
  rows: number[];
}

/** The 6 Ravel Mode scoring cards (R1..R6).
 *  R1 (fish_automa_p01.png): blue site (col 0), midnight rows [4, 5].
 *  R6 (fish_automa_p07.png): green site (col 2), lower sunlight rows [1, 2]. */
export const RAVEL_SCORING_CARDS: RavelScoringCard[] = [
  { id: 'R1', site: 0, rows: [4, 5] },
  { id: 'R2', site: 0, rows: [0, 1] },
  { id: 'R3', site: 1, rows: [2, 3] },
  { id: 'R4', site: 1, rows: [3, 4] },
  { id: 'R5', site: 2, rows: [3, 4] },
  { id: 'R6', site: 2, rows: [1, 2] },
];

export function getRavelCard(id: string): RavelScoringCard {
  const c = RAVEL_SCORING_CARDS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown Ravel scoring card ${id}`);
  return c;
}

/** Shuffle all 7 decision cards, setting 1 aside unseen and keeping 6 in the active deck. */
export function dealNautomaDeck(rng: number): { deck: number[]; setAside: number; rng: number } {
  const ids = NAUTOMA_DECISION_CARDS.map((c) => c.id);
  const [shuffled, rng2] = shuffle(rng, ids);
  return {
    setAside: shuffled[0]!,
    deck: shuffled.slice(1),
    rng: rng2,
  };
}

/** Build the initial NautomaState at game setup. */
export function buildInitialNautoma(
  rng: number,
  opts: { difficulty?: 1 | 2 | 3 | 4 | 5; ravelMode?: boolean; ravelStrength?: 2 | 3 | 4 },
): { nautoma: NautomaState; rng: number } {
  const difficulty = opts.difficulty ?? 2;
  const ravelMode = opts.ravelMode ?? false;
  const ravelStrength = opts.ravelStrength ?? 2;
  const { deck, setAside, rng: rng2 } = dealNautomaDeck(rng);
  let ravelCardId: string | null = null;
  let rngOut = rng2;
  if (ravelMode) {
    const [cards, rng3] = shuffle(
      rngOut,
      RAVEL_SCORING_CARDS.map((c) => c.id),
    );
    ravelCardId = cards[0]!;
    rngOut = rng3;
  }
  return {
    nautoma: {
      difficulty,
      ravelMode,
      ravelStrength,
      ravelCardId,
      deck,
      setAside,
      lastCardId: null,
      eggs: 2,
      young: 1,
      schools: 0,
      corals: 0,
      fish: [],
      achievementDivers: 0,
      ravelPoints: 0,
    },
    rng: rngOut,
  };
}

/** Base values on the 3 double-sided Nautoma Achievement Cards (Weeks 1, 2, 3)
 *  for Calm (Difficulties 2-3) and Stormy (Difficulties 4-5), plus S&R tiles.
 *  Per fish_automa_p01.png, fish_automa_p02.png, and FS_S&R_AutomaAchievementCard:
 *    - Week 1: eggsAndYoung 3/6, smallFish(fishSunlight) 2/5, fish 2/6,
 *              young 0/4, tagPredator 0/2, consumedFish 0/2, coral 1/4.
 *    - Week 2: fullRows 0/2, young 1/5, fishWithTokens 3/7,
 *              eachOfTheseTags(tagPredator/uniqueTags) 2/5, every2Eggs(eggs) 0/2, coral 1/4.
 *    - Week 3: schools 0/2, young 3/6, every3Eggs(eggs) 0/2,
 *              fishWithTokens 3/7, consumedFish 0/2, fishPoints1to3 3/6. */
const ACHIEVEMENT_BASE_BY_WEEK: Record<
  1 | 2 | 3,
  Record<AchievementKind, { calm: number; stormy: number }>
> = {
  1: {
    eggsAndYoung: { calm: 3, stormy: 6 },
    eggs: { calm: 0, stormy: 2 },
    young: { calm: 0, stormy: 4 },
    fullRows: { calm: 0, stormy: 2 },
    fish: { calm: 2, stormy: 6 },
    tagPredator: { calm: 0, stormy: 2 },
    schools: { calm: 0, stormy: 2 },
    fishWithTokens: { calm: 3, stormy: 7 },
    consumedFish: { calm: 0, stormy: 2 },
    fishPoints1to3: { calm: 3, stormy: 6 },
    uniqueTags: { calm: 2, stormy: 5 },
    fishSunlight: { calm: 2, stormy: 5 },
    coral: { calm: 1, stormy: 4 },
  },
  2: {
    eggsAndYoung: { calm: 3, stormy: 6 },
    eggs: { calm: 0, stormy: 2 },
    young: { calm: 1, stormy: 5 },
    fullRows: { calm: 0, stormy: 2 },
    fish: { calm: 2, stormy: 6 },
    tagPredator: { calm: 2, stormy: 5 },
    schools: { calm: 0, stormy: 2 },
    fishWithTokens: { calm: 3, stormy: 7 },
    consumedFish: { calm: 0, stormy: 2 },
    fishPoints1to3: { calm: 3, stormy: 6 },
    uniqueTags: { calm: 2, stormy: 5 },
    fishSunlight: { calm: 2, stormy: 5 },
    coral: { calm: 1, stormy: 4 },
  },
  3: {
    eggsAndYoung: { calm: 3, stormy: 6 },
    eggs: { calm: 0, stormy: 2 },
    young: { calm: 3, stormy: 6 },
    fullRows: { calm: 0, stormy: 2 },
    fish: { calm: 2, stormy: 6 },
    tagPredator: { calm: 2, stormy: 5 },
    schools: { calm: 0, stormy: 2 },
    fishWithTokens: { calm: 3, stormy: 7 },
    consumedFish: { calm: 0, stormy: 2 },
    fishPoints1to3: { calm: 3, stormy: 6 },
    uniqueTags: { calm: 2, stormy: 5 },
    fishSunlight: { calm: 2, stormy: 5 },
    coral: { calm: 1, stormy: 4 },
  },
};

/** Look up Nautoma's base quantity for a weekly achievement.
 *  `week` may be 1..3 (1-based week number) or 0..2 (0-based state.week = 0 -> Week 1). */
export function nautomaAchievementBase(
  week: number,
  kind: AchievementKind,
  side: 'calm' | 'stormy',
): number {
  const w: 1 | 2 | 3 = week <= 1 ? 1 : week === 2 ? 2 : 3;
  return ACHIEVEMENT_BASE_BY_WEEK[w][kind][side];
}

/** Calculate Ravel Mode extra points Nautoma gains at the end of a week based
 *  on the human player's ocean mat (fish_automa_p06.png..p07.png):
 *  +X points per fish in the highlighted dive site, minus 1 point per fish in
 *  the highlighted rows, floored at 0. */
export function scoreRavelWeek(
  human: PlayerState,
  ravelCardId: string,
  ravelStrength: 2 | 3 | 4,
): number {
  const card = getRavelCard(ravelCardId);
  let siteFish = 0;
  let rowFish = 0;
  for (const { ref, slot } of allSlots(human.ocean)) {
    if (slot.stack.length === 0) continue;
    if (ref.col === card.site) siteFish++;
    if (card.rows.includes(ref.row)) rowFish++;
  }
  return Math.max(0, ravelStrength * siteFish - rowFish);
}
