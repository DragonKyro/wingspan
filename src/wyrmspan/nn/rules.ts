// Derived rules for agents: what a turn action would cost, whether it is
// affordable (including the free 2-for-1 resource exchange), and what an
// explore walk yields. Pure reads of a (redacted) state — they mirror
// actions.ts / effects.ts rather than re-implementing their effects.

import { dragonCost, evaluateIgnoreCost, excavateEggCost, exploreCost, nextEmptySpace, nextEnticeSpace } from '../actions';
import { cardAbilityTypes, dragonCard, isDragonCard, trainingTrackLength } from '../cards';
import { MAT_ICONS } from '../effects';
import { parseAbility } from '../abilities';
import { type Exchange, canPay, eggsOnMatCount, exchangePlan } from '../helpers';
import type { Action, CaveId, GainItem, GameState, PlayedDragon, PlayerId, PlayerState } from '../types';
import { CAVE_IDS, RESOURCES } from '../types';
import { SUMMARY_DIM, summarizeSteps } from './cardFeatures';

export const CAVE_INDEX: Record<string, number> = { 'Crimson Cavern': 0, 'Golden Grotto': 1, 'Amethyst Abyss': 2 };

export type { Exchange };

export function exchangeActions(playerId: PlayerId, plan: readonly Exchange[]): Action[] {
  return plan.map((x) => ({ type: 'exchange', playerId, give: x.give, get: x.get }));
}

// ---------------------------------------------------------------------------
// Turn actions

export interface EnticeOption {
  cardId: number;
  cave: number;
  space: number;
  cost: GainItem[];
  ignoredCost: boolean;
  exchanges: Exchange[];
}

/** Every (dragon in hand, preferred cave) entice that is affordable, possibly after exchanges. */
export function enticeOptions(view: GameState, p: PlayerState, cardId: number): EnticeOption[] {
  const out: EnticeOption[] = [];
  const card = dragonCard(cardId);
  for (const name of card.caves) {
    const cave = CAVE_INDEX[name]!;
    const space = nextEnticeSpace(p, cave);
    if (space < 0) continue;
    const ignoredCost = evaluateIgnoreCost(view, p, cardId, cave);
    const cost: GainItem[] = ignoredCost ? [{ kind: 'coin', count: 1 }] : dragonCost(cardId);
    const plan = exchangePlan(p, cost);
    if (plan) out.push({ cardId, cave, space, cost, ignoredCost, exchanges: plan });
  }
  return out;
}

/** Does `cardId` have an open excavated space in one of its caves right now? */
export function hasEnticeSpace(p: PlayerState, cardId: number): boolean {
  return dragonCard(cardId).caves.some((n) => nextEnticeSpace(p, CAVE_INDEX[n]!) >= 0);
}

export function excavateCost(p: PlayerState, cave: number): GainItem[] | null {
  const idx = nextEmptySpace(p, cave);
  if (idx < 0) return null;
  const eggs = excavateEggCost(idx);
  return [{ kind: 'coin', count: 1 }, ...(eggs ? [{ kind: 'egg', count: eggs } as GainItem] : [])];
}

/** Caves a cave card from hand can be excavated into now. */
export function excavatableCaves(p: PlayerState): number[] {
  return [0, 1, 2].filter((c) => {
    const cost = excavateCost(p, c);
    return cost !== null && canPay(p, cost);
  });
}

export function canExplore(p: PlayerState, cave: number): boolean {
  return p.explores[CAVE_IDS[cave]!] < 3 && canPay(p, exploreCost(p, cave));
}

export function exploreEggCost(p: PlayerState, cave: number): number {
  return exploreCost(p, cave).reduce((a, it) => a + (it.kind === 'egg' ? it.count : 0), 0);
}

/** A dragon's abilities are inactive while it is an untrained fledgling. */
export function abilityActive(d: PlayedDragon): boolean {
  const card = dragonCard(d.cardId);
  return card.size !== 'Fledgling' || (d.training ?? 0) >= trainingTrackLength(card);
}

/** Summary of what exploring `cave` would yield: path icons up to the first
 *  empty space plus the Adventurer abilities of the dragons walked past. */
export function exploreYield(p: PlayerState, cave: number): { summary: Float32Array; dragons: number; adventurers: number } {
  const summary = new Float32Array(SUMMARY_DIM);
  const row = p.caves[cave]!;
  let dragons = 0;
  let adventurers = 0;
  for (let i = 0; i <= 4; i++) {
    summarizeSteps(MAT_ICONS[cave]![i]!, summary);
    if (i === 4) break;
    const d = row.spaces[i]!.dragon;
    if (!d) break;
    dragons++;
    const card = dragonCard(d.cardId);
    if (card.ability && cardAbilityTypes(card).includes('Adventurer') && abilityActive(d)) {
      adventurers++;
      summarizeSteps(parseAbility(card).steps, summary);
    }
  }
  return { summary, dragons, adventurers };
}

export function freeEggCapacity(p: PlayerState): number {
  let n = 2 - p.nestEggs;
  for (const row of p.caves) for (const sp of row.spaces) if (sp.dragon) n += Math.max(0, dragonCard(sp.dragon.cardId).capacity - sp.dragon.eggs);
  return n;
}

export const totalResources = (p: PlayerState): number => RESOURCES.reduce((a, r) => a + p.resources[r], 0);
export const handDragons = (p: PlayerState): number[] => p.hand.filter(isDragonCard);
export const handCaves = (p: PlayerState): number[] => p.hand.filter((id) => !isDragonCard(id));
export { eggsOnMatCount };
export type { CaveId };
