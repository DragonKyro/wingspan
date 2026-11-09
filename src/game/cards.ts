// Typed access to the generated card database (scripts/convert-cards.mjs).

import birdsJson from './data/birds.json';
import bonusJson from './data/bonusCards.json';
import goalsJson from './data/goals.json';
import type { BirdCard, BonusCard, GoalTile } from './types';

export const BIRDS = birdsJson as BirdCard[];
export const BONUS_CARDS = bonusJson as (BonusCard & {
  vp: { kind: string; tiers?: { min: number; max: number | null; vp: number }[]; per?: number; one?: number; two?: number; text?: string };
})[];
export const GOALS = goalsJson as GoalTile[];

export const BIRD_BY_ID = new Map<number, BirdCard>(BIRDS.map((b) => [b.id, b]));
export const BONUS_BY_ID = new Map<number, (typeof BONUS_CARDS)[number]>(BONUS_CARDS.map((b) => [b.id, b]));
export const GOAL_BY_ID = new Map<number, GoalTile>(GOALS.map((g) => [g.id, g]));

export function bird(id: number): BirdCard {
  const b = BIRD_BY_ID.get(id);
  if (!b) throw new Error(`unknown bird card ${id}`);
  return b;
}

export function bonusCard(id: number) {
  const b = BONUS_BY_ID.get(id);
  if (!b) throw new Error(`unknown bonus card ${id}`);
  return b;
}

export function goalTile(id: number): GoalTile {
  const g = GOAL_BY_ID.get(id);
  if (!g) throw new Error(`unknown goal tile ${id}`);
  return g;
}

/** All sets the card database knows about. */
export const SETS = [...new Set(BIRDS.map((b) => b.set))];

/** Bird ids in the given expansion sets (deck composition). */
export function birdsInSets(sets: string[]): number[] {
  return BIRDS.filter((b) => sets.includes(b.set)).map((b) => b.id);
}

export function bonusCardsInSets(sets: string[]): number[] {
  return BONUS_CARDS.filter((b) => sets.includes(b.set)).map((b) => b.id);
}

/** Goal tiles available for the given sets (only supported scorers are used). */
export function goalsForSets(sets: string[]): GoalTile[] {
  return GOALS.filter((g) => sets.includes(g.set) && g.goal.kind !== 'unsupported');
}
