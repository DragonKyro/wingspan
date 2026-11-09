// Typed accessors over the generated card data (scripts/convert-finspan.mjs).

import fishData from './data/fish.json';
import achievementsData from './data/achievements.json';
import type { Achievement, FishCard } from './types';

export const FISH: FishCard[] = fishData as FishCard[];
export const FISH_BY_ID: Map<number, FishCard> = new Map(FISH.map((c) => [c.id, c]));

export function fish(id: number): FishCard {
  const c = FISH_BY_ID.get(id);
  if (!c) throw new Error(`unknown fish card ${id}`);
  return c;
}

export function fishIdsInSets(sets: string[], group: 'main' | 'starter'): number[] {
  return FISH.filter((c) => c.group === group && sets.includes(c.set)).map((c) => c.id);
}

export const ACHIEVEMENTS = achievementsData as {
  sideA: Achievement[];
  sideBTiles: Achievement[];
  sideBLeaderBonus: number;
};

/** Side-B tiles eligible for a given week + expansion sets. */
export function sideBTilePool(week: number, sets: string[]): Achievement[] {
  return ACHIEVEMENTS.sideBTiles.filter((t) => t.week === week && (!t.set || sets.includes(t.set)));
}
