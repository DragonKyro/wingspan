// Shared pure helpers: seeded RNG, deck/display manipulation, position
// queries, counter/condition evaluation, and resource/card movement.

import { shuffle as shuffleSeeded } from '../shared/rng';
import * as shared from '../shared/state';
import { dragonCard, dragonMatchesCond, isDragonCard, isFullyTrained } from './cards';
import type {
  Cond,
  Counter,
  DragonCond,
  DragonTarget,
  EggSpot,
  EggTarget,
  GameState,
  GainItem,
  PlayedDragon,
  PlayerId,
  PayUnit,
  PlayerState,
  Resource,
} from './types';
import { RESOURCES } from './types';

// ---------------------------------------------------------------------------
// Seeded RNG: the shared mulberry32 (src/shared/rng.ts), threaded through
// GameState.rngState.

export function shuffle<T>(state: GameState, arr: readonly T[]): [T[], GameState] {
  const [out, rngState] = shuffleSeeded(state.rngState, arr);
  return [out, { ...state, rngState }];
}

// ---------------------------------------------------------------------------
// Player/state accessors

export const player: (state: GameState, id: PlayerId) => PlayerState = shared.getPlayer;
export const setPlayer: (state: GameState, p: PlayerState) => GameState = shared.setPlayer;

export function otherPlayers(state: GameState, id: PlayerId): PlayerState[] {
  return state.players.filter((p) => p.id !== id);
}

/**
 * Other players in turn (clockwise) order, starting with the player after
 * `id`. Used for "each opponent may ..." benefits, which the rulebook
 * resolves clockwise starting with the effect's owner.
 */
export function orderedOthers(state: GameState, id: PlayerId): PlayerState[] {
  const i = state.playerOrder.indexOf(id);
  const rotated = [...state.playerOrder.slice(i + 1), ...state.playerOrder.slice(0, i)];
  return rotated.map((pid) => player(state, pid));
}

export function leftNeighbor(state: GameState, id: PlayerId): PlayerState {
  const i = state.playerOrder.indexOf(id);
  return player(state, state.playerOrder[(i + 1) % state.playerOrder.length]!);
}

export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function log(state: GameState, msg: string): GameState {
  return { ...state, log: [...state.log, msg] };
}

// ---------------------------------------------------------------------------
// Positions / dragons

export interface Pos {
  cave: number;
  space: number;
}

export function dragonAt(p: PlayerState, pos: Pos): PlayedDragon | null {
  return p.caves[pos.cave]!.spaces[pos.space]!.dragon;
}

export function allDragons(p: PlayerState): (Pos & { dragon: PlayedDragon })[] {
  const out: (Pos & { dragon: PlayedDragon })[] = [];
  p.caves.forEach((row, cave) =>
    row.spaces.forEach((sp, space) => {
      if (sp.dragon) out.push({ cave, space, dragon: sp.dragon });
    }),
  );
  return out;
}

function matchesSelf(d: Pos & { dragon: PlayedDragon }, ctxPos?: [number, number]): boolean {
  return !!ctxPos && d.cave === ctxPos[0] && d.space === ctxPos[1];
}

/** Orthogonal neighbors of a position (up/down across caves, left/right within). */
export function orthAdjacent(pos: Pos): Pos[] {
  const out: Pos[] = [];
  if (pos.space > 0) out.push({ cave: pos.cave, space: pos.space - 1 });
  if (pos.space < 3) out.push({ cave: pos.cave, space: pos.space + 1 });
  if (pos.cave > 0) out.push({ cave: pos.cave - 1, space: pos.space });
  if (pos.cave < 2) out.push({ cave: pos.cave + 1, space: pos.space });
  return out;
}

/** Enumerate dragon positions matching a DragonTarget. ctxPos = source dragon. */
export function dragonTargetPositions(
  p: PlayerState,
  target: DragonTarget,
  ctxPos?: [number, number],
): Pos[] {
  const all = allDragons(p);
  switch (target.kind) {
    case 'here':
      return ctxPos && dragonAt(p, { cave: ctxPos[0], space: ctxPos[1] })
        ? [{ cave: ctxPos[0], space: ctxPos[1] }]
        : [];
    case 'any':
      return all.map((d) => ({ cave: d.cave, space: d.space }));
    case 'thisColumn': {
      if (!ctxPos) return [];
      return all.filter((d) => d.space === ctxPos[1]).map((d) => ({ cave: d.cave, space: d.space }));
    }
    case 'orthAdjacent': {
      if (!ctxPos) return [];
      const adj = orthAdjacent({ cave: ctxPos[0], space: ctxPos[1] });
      return all
        .filter((d) => adj.some((a) => a.cave === d.cave && a.space === d.space))
        .map((d) => ({ cave: d.cave, space: d.space }));
    }
    case 'eachInCave': {
      if (!ctxPos) return [];
      return all
        .filter(
          (d) =>
            d.cave === ctxPos[0] &&
            (!target.cond || dragonMatchesCond(dragonCard(d.dragon.cardId), target.cond)) &&
            !(target.cond?.excludeSelf && matchesSelf(d, ctxPos)),
        )
        .map((d) => ({ cave: d.cave, space: d.space }));
    }
    case 'eachOnMat':
      return all
        .filter((d) => !target.cond || dragonMatchesCond(dragonCard(d.dragon.cardId), target.cond))
        .map((d) => ({ cave: d.cave, space: d.space }));
  }
}

/** Enumerate legal egg-landing spots for an EggTarget. */
export function eggTargetSpots(
  p: PlayerState,
  target: EggTarget,
  ctxPos?: [number, number],
): { kind: 'nest' }[] | Pos[] {
  // A context position can be an empty space (cave-card effects run with the
  // excavated space as their context): no dragon there, no egg spot.
  const spotsFor = (positions: Pos[]): Pos[] =>
    positions.filter((pos) => {
      const d = dragonAt(p, pos);
      return !!d && d.eggs < dragonCard(d.cardId).capacity;
    });
  switch (target.kind) {
    case 'any':
      return [
        ...spotsFor(allDragons(p).map((d) => ({ cave: d.cave, space: d.space }))),
      ];
    case 'here':
      return ctxPos ? spotsFor([{ cave: ctxPos[0], space: ctxPos[1] }]) : [];
    case 'thisCave':
    case 'eachInRow':
      return ctxPos
        ? spotsFor(allDragons(p).filter((d) => d.cave === ctxPos[0]).map((d) => ({ cave: d.cave, space: d.space })))
        : [];
    case 'thisColumn':
    case 'eachInColumn':
      return ctxPos
        ? spotsFor(allDragons(p).filter((d) => d.space === ctxPos[1]).map((d) => ({ cave: d.cave, space: d.space })))
        : [];
    case 'orthAdjacent':
      return ctxPos
        ? spotsFor(
            allDragons(p)
              .filter((d) => orthAdjacent({ cave: ctxPos[0], space: ctxPos[1] }).some((a) => a.cave === d.cave && a.space === d.space))
              .map((d) => ({ cave: d.cave, space: d.space })),
          )
        : [];
    case 'eachInCave':
      return ctxPos
        ? spotsFor(
            allDragons(p)
              .filter(
                (d) =>
                  d.cave === ctxPos[0] &&
                  (!target.cond || dragonMatchesCond(dragonCard(d.dragon.cardId), target.cond)),
              )
              .map((d) => ({ cave: d.cave, space: d.space })),
          )
        : [];
    case 'eachFledgling':
      return spotsFor(
        allDragons(p)
          .filter((d) => dragonCard(d.dragon.cardId).size === 'Fledgling')
          .map((d) => ({ cave: d.cave, space: d.space })),
      );
    case 'eachFullyTrainedFledgling':
      return spotsFor(
        allDragons(p)
          .filter((d) => isFullyTrained(dragonCard(d.dragon.cardId), d.dragon.training))
          .map((d) => ({ cave: d.cave, space: d.space })),
      );
  }
}

/** Does the player have ANY legal egg spot (including mat nests)? */
export function hasAnyEggSpot(p: PlayerState, target: EggTarget, ctxPos?: [number, number]): boolean {
  if (eggTargetSpots(p, target, ctxPos).length > 0) return true;
  return target.kind === 'any' && p.nestEggs < 2;
}

// ---------------------------------------------------------------------------
// Deck / display

export type DeckName = 'dragon' | 'cave';

export function deckOf(_state: GameState, deck: DeckName): 'dragonDeck' | 'caveDeck' {
  return deck === 'dragon' ? 'dragonDeck' : 'caveDeck';
}

export function discardOf(_state: GameState, deck: DeckName): 'dragonDiscard' | 'caveDiscard' {
  return deck === 'dragon' ? 'dragonDiscard' : 'caveDiscard';
}

export function displayOf(_state: GameState, deck: DeckName): 'dragonDisplay' | 'caveDisplay' {
  return deck === 'dragon' ? 'dragonDisplay' : 'caveDisplay';
}

/** Draw n cards from a deck into `to`; reshuffles its discard when empty. */
export function drawCards(state: GameState, deck: DeckName, n: number): [number[], GameState] {
  let s = state;
  const drawn: number[] = [];
  for (let i = 0; i < n; i++) {
    const key = deckOf(s, deck);
    if (s[key].length === 0) {
      const dKey = discardOf(s, deck);
      if (s[dKey].length === 0) break;
      const [shuffled, s2] = shuffle(s, s[dKey]);
      s = { ...s2, [key]: shuffled, [dKey]: [] };
    }
    drawn.push(s[key][0]!);
    s = { ...s, [key]: s[key].slice(1) };
  }
  return [drawn, s];
}

/** Remove a card id from a display slot, leaving a gap (refilled at round end). */
export function takeFromDisplay(state: GameState, deck: DeckName, cardId: number): GameState {
  const key = displayOf(state, deck);
  const disp = [...state[key]];
  const i = disp.indexOf(cardId);
  if (i < 0) return state;
  disp[i] = null;
  return { ...state, [key]: disp };
}

/** Draw into any empty display slots (Academy: immediate refill after drafts). */
export function refillDisplayGaps(state: GameState): GameState {
  let s = state;
  for (const deck of ['dragon', 'cave'] as DeckName[]) {
    const key = displayOf(s, deck);
    while (s[key].includes(null)) {
      const [drawn, s2] = drawCards(s, deck, 1);
      s = s2;
      if (!drawn.length) break;
      const disp = [...s[key]];
      disp[disp.indexOf(null)] = drawn[0]!;
      s = { ...s, [key]: disp };
    }
  }
  return s;
}

/** Discard-and-restock both displays (round-end refresh). */
export function refreshDisplays(state: GameState): GameState {
  let s = state;
  for (const deck of ['dragon', 'cave'] as DeckName[]) {
    const key = displayOf(s, deck);
    const dKey = discardOf(s, deck);
    const leftover = s[key].filter((c): c is number => c !== null);
    s = { ...s, [key]: [null, null, null], [dKey]: [...s[dKey], ...leftover] };
    const [drawn, s2] = drawCards(s, deck, 3);
    s = { ...s2, [key]: drawn };
  }
  return s;
}

// ---------------------------------------------------------------------------
// Cost / gain helpers on PlayerState

export function canPay(p: PlayerState, cost: GainItem[]): boolean {
  const need = { meat: 0, gold: 0, crystal: 0, milk: 0 };
  let anyRes = 0;
  let eggs = 0;
  let coins = 0;
  let dragonCards = 0;
  let caveCards = 0;
  let items = 0;
  let tithes = 0;
  for (const it of cost) {
    if (it.kind === 'resource') {
      if (it.res === 'any') anyRes += it.count;
      else need[it.res] += it.count;
    } else if (it.kind === 'egg') eggs += it.count;
    else if (it.kind === 'coin') coins += it.count;
    else if (it.kind === 'card') {
      if (it.deck === 'dragon') dragonCards += it.count;
      else caveCards += it.count;
    } else if (it.kind === 'item') {
      items += it.count;
    } else if (it.kind === 'tithe') {
      tithes += it.count;
    }
  }
  if (p.coins < coins) return false;
  for (const r of RESOURCES) if (p.resources[r] < need[r]) return false;
  const remRes = RESOURCES.reduce((a, r) => a + p.resources[r] - need[r], 0);
  if (remRes < anyRes) return false;
  const remDragons = p.hand.filter(isDragonCard).length - dragonCards;
  const remCaves = p.hand.filter((c) => !isDragonCard(c)).length - caveCards;
  if (remDragons < 0 || remCaves < 0) return false;
  const remEggs = eggsOnMatCount(p) - eggs;
  if (remEggs < 0) return false;
  const remResAndCards = remRes - anyRes + remDragons + remCaves;
  if (remResAndCards < items) return false;
  if (remResAndCards - items + remEggs < tithes) return false;
  return true;
}

export function eggsOnMatCount(p: PlayerState): number {
  let n = p.nestEggs;
  for (const d of allDragons(p)) n += d.dragon.eggs;
  return n;
}

/** Remove `n` eggs from a player's mat: dragon eggs first, then mat nests. */
export function removeEggs(p: PlayerState, n: number): PlayerState {
  let left = n;
  outer: for (const row of p.caves) {
    for (const sp of row.spaces) {
      if (left <= 0) break outer;
      if (sp.dragon && sp.dragon.eggs > 0) {
        sp.dragon.eggs -= 1;
        left--;
      }
    }
  }
  if (left > 0) p.nestEggs = Math.max(0, p.nestEggs - left);
  return p;
}

/** Eggs on one spot (a dragon or the mat nests). */
function eggsAt(p: PlayerState, spot: EggSpot): number {
  if (spot.kind === 'nest') return p.nestEggs;
  return p.caves[spot.pos[0]]?.spaces[spot.pos[1]]?.dragon?.eggs ?? 0;
}

/**
 * Pay `cost` for player `p` (returns an updated clone), honoring the player's
 * `payment` wherever the rules leave the choice to them: which resources pay
 * an "any resource" cost, which hand cards pay a card cost, which eggs pay an
 * egg cost ("from any dragon or nest"), and how 4th-column items / King's
 * Guild tithes are mixed ("in any combination"). Each choosable unit of the
 * cost takes the first unused, still-available unit of `payment` that fits it;
 * otherwise the default: the most plentiful resource, the last matching hand
 * card, eggs from dragons first (mat order) then the nests. Specific
 * resources and coins have no choice. Returns the cards paid (for discards).
 * The caller checks affordability first (canPay).
 */
export function payCost(p: PlayerState, cost: readonly GainItem[], payment?: readonly PayUnit[]): { player: PlayerState; discarded: number[] } {
  const q = clone(p);
  const discarded: number[] = [];
  const units = payment ?? [];
  const used = units.map(() => false);
  for (const it of cost) {
    if (it.kind === 'resource' && it.res !== 'any') q.resources[it.res] -= it.count;
    else if (it.kind === 'coin') q.coins -= it.count;
  }
  const available = (u: PayUnit) =>
    u.kind === 'resource' ? q.resources[u.res] > 0 : u.kind === 'card' ? q.hand.includes(u.cardId) : eggsAt(q, u.spot) > 0;
  const spend = (u: PayUnit) => {
    if (u.kind === 'resource') q.resources[u.res] -= 1;
    else if (u.kind === 'card') {
      q.hand.splice(q.hand.indexOf(u.cardId), 1);
      discarded.push(u.cardId);
    } else if (u.spot.kind === 'nest') q.nestEggs -= 1;
    else q.caves[u.spot.pos[0]]!.spaces[u.spot.pos[1]]!.dragon!.eggs -= 1;
  };
  const chosen = (fits: (u: PayUnit) => boolean): boolean => {
    for (let i = 0; i < units.length; i++) {
      if (used[i] || !fits(units[i]!) || !available(units[i]!)) continue;
      used[i] = true;
      spend(units[i]!);
      return true;
    }
    return false;
  };
  const anyResource = (): boolean => {
    const r = [...RESOURCES].sort((a, b) => q.resources[b] - q.resources[a])[0]!;
    if (q.resources[r] <= 0) return false;
    q.resources[r] -= 1;
    return true;
  };
  const lastCard = (deck?: DeckName): boolean => {
    for (let c = q.hand.length - 1; c >= 0; c--) {
      const id = q.hand[c]!;
      if (deck && (deck === 'dragon') !== isDragonCard(id)) continue;
      q.hand.splice(c, 1);
      discarded.push(id);
      return true;
    }
    return false;
  };
  const anyEgg = (): boolean => {
    if (eggsOnMatCount(q) <= 0) return false;
    removeEggs(q, 1);
    return true;
  };
  for (const it of cost) {
    for (let k = 0; k < it.count; k++) {
      switch (it.kind) {
        case 'resource':
          if (it.res === 'any' && !chosen((u) => u.kind === 'resource')) anyResource();
          break;
        case 'card':
          if (!chosen((u) => u.kind === 'card' && isDragonCard(u.cardId) === (it.deck === 'dragon'))) lastCard(it.deck);
          break;
        case 'egg':
          if (!chosen((u) => u.kind === 'egg')) anyEgg();
          break;
        case 'item': // a resource, dragon card or cave card
          if (!chosen((u) => u.kind !== 'egg')) void (anyResource() || lastCard());
          break;
        case 'tithe': // a resource, dragon card, cave card or egg
          if (!chosen(() => true)) void (anyResource() || lastCard() || anyEgg());
          break;
        default:
          break;
      }
    }
  }
  return { player: q, discarded };
}

/** 2-resources-for-1 exchanges ("at any point during the game"). */
export interface Exchange {
  give: [Resource, Resource];
  get: Resource;
}

/**
 * The exchanges (2 resources → 1 of another) that make `cost` payable, or
 * null if it can't be paid even then; [] = payable as is. Coins, eggs and
 * cards can't be exchanged for; surplus resources are given most-plentiful first.
 */
export function exchangePlan(p: PlayerState, cost: readonly GainItem[]): Exchange[] | null {
  if (canPay(p, cost as GainItem[])) return [];
  const need: Record<Resource, number> = { meat: 0, gold: 0, crystal: 0, milk: 0 };
  let any = 0;
  for (const it of cost) {
    if (it.kind === 'resource') {
      if (it.res === 'any') any += it.count;
      else need[it.res] += it.count;
    }
  }
  const have = { ...p.resources };
  const deficit: Resource[] = [];
  for (const r of RESOURCES) for (let k = have[r]; k < need[r]; k++) deficit.push(r);
  if (!deficit.length) return null; // short on coins / eggs / cards, not resources
  const surplus = () => RESOURCES.filter((r) => have[r] > need[r]).sort((a, b) => have[b] - need[b] - (have[a] - need[a]));
  const plan: Exchange[] = [];
  for (const get of deficit) {
    const give: Resource[] = [];
    for (let k = 0; k < 2; k++) {
      const r = surplus().find((x) => x !== get);
      if (!r) return null;
      have[r] -= 1;
      give.push(r);
    }
    have[get] += 1;
    plan.push({ give: [give[0]!, give[1]!], get });
  }
  const left = RESOURCES.reduce((a, r) => a + have[r] - need[r], 0);
  if (left < any) return null;
  return canPay({ ...p, resources: have }, cost as GainItem[]) ? plan : null;
}

/** Payable now, or after 2-for-1 resource exchanges. */
export function canPayWithExchanges(p: PlayerState, cost: readonly GainItem[]): boolean {
  return exchangePlan(p, cost) !== null;
}

/** The printed cost of a dragon card (resources/coins/eggs printed on it). */
export function dragonPrintedCost(cardId: number): GainItem[] {
  const c = dragonCard(cardId);
  const out: GainItem[] = [];
  for (const r of RESOURCES) {
    const n = c.cost[r];
    if (n) out.push({ kind: 'resource', res: r, count: n });
  }
  if (c.cost.coin) out.push({ kind: 'coin', count: c.cost.coin });
  if (c.cost.egg) out.push({ kind: 'egg', count: c.cost.egg });
  return out;
}

/** Pay a resource/coin/card cost (eggs handled separately via chooseEggPayment). */
export function payItems(p: PlayerState, cost: GainItem[], eggSpots?: { pos?: Pos; fromNest?: boolean }[]): PlayerState {
  const q = clone(p);
  let anyRes = 0;
  for (const it of cost) {
    if (it.kind === 'resource') {
      if (it.res === 'any') anyRes += it.count;
      else q.resources[it.res] -= it.count;
    } else if (it.kind === 'coin') q.coins -= it.count;
    else if (it.kind === 'egg') {
      // eggs removed via eggSpots below
    } else if (it.kind === 'card') {
      // hand cards removed by caller (choice)
    }
  }
  // Pay 'any' resources greedily from the most plentiful.
  for (let i = 0; i < anyRes; i++) {
    const best = [...RESOURCES].sort((a, b) => q.resources[b] - q.resources[a])[0]!;
    q.resources[best] -= 1;
  }
  if (eggSpots) {
    for (const spot of eggSpots) {
      if (spot.fromNest) q.nestEggs -= 1;
      else if (spot.pos) q.caves[spot.pos.cave]!.spaces[spot.pos.space]!.dragon!.eggs -= 1;
    }
  }
  return q;
}

// ---------------------------------------------------------------------------
// Counter / cond evaluation

export function countCounter(_state: GameState, p: PlayerState, counter: Counter, ctxPos?: [number, number]): number {
  const all = allDragons(p);
  const match = (d: (typeof all)[number], cond?: DragonCond) =>
    (!cond || dragonMatchesCond(dragonCard(d.dragon.cardId), cond)) &&
    !(cond?.excludeSelf && matchesSelf(d, ctxPos));
  switch (counter.kind) {
    case 'dragons':
      switch (counter.where) {
        case 'mat':
          return all.filter((d) => match(d, counter.cond)).length;
        case 'cave':
          return ctxPos === undefined ? 0 : all.filter((d) => d.cave === ctxPos[0] && match(d, counter.cond)).length;
        case 'column':
          return ctxPos === undefined ? 0 : all.filter((d) => d.space === ctxPos[1] && match(d, counter.cond)).length;
        case 'orthAdjacent':
          return ctxPos === undefined
            ? 0
            : all.filter(
                  (d) =>
                    match(d, counter.cond) &&
                    orthAdjacent({ cave: ctxPos[0], space: ctxPos[1] }).some((a) => a.cave === d.cave && a.space === d.space),
                ).length;
        case 'namedCave': {
          const caveIdx = counter.cave === 'crimson' ? 0 : counter.cave === 'golden' ? 1 : 2;
          return all.filter((d) => d.cave === caveIdx && match(d, counter.cond)).length;
        }
      }
      break;
    case 'eggs':
      if (counter.where === 'mat') return eggsOnMatCount(p);
      if (ctxPos === undefined) return 0;
      if (counter.where === 'row')
        return all.filter((d) => d.cave === ctxPos[0]).reduce((a, d) => a + d.dragon.eggs, 0);
      return all.filter((d) => d.space === ctxPos[1]).reduce((a, d) => a + d.dragon.eggs, 0);
    case 'cached':
      if (counter.where === 'here') {
        if (!ctxPos) return 0;
        return dragonAt(p, { cave: ctxPos[0], space: ctxPos[1] })?.cached.length ?? 0;
      }
      return all.reduce((a, d) => a + d.dragon.cached.length, 0);
    case 'tucked':
      if (counter.where === 'here') {
        if (!ctxPos) return 0;
        return dragonAt(p, { cave: ctxPos[0], space: ctxPos[1] })?.tucked.length ?? 0;
      }
      return all.reduce((a, d) => a + d.dragon.tucked.length, 0);
    case 'guildMarkers':
      return p.guildMarkersPlaced;
    case 'objectivesLowest': {
      let count = 0;
      const rounds = Math.max(4, p.objectiveVps.length);
      for (let r = 0; r < rounds; r++) {
        const myVp = p.objectiveVps[r];
        if (myVp === undefined) continue;
        const lowest = Math.min(..._state.players.map((pl) => pl.objectiveVps[r] ?? myVp));
        if (myVp <= lowest) count++;
      }
      return count;
    }
    case 'traitSets': {
      const counts = (['Shy', 'Playful', 'Helpful', 'Aggressive'] as const).map(
        (per) => all.filter((d) => dragonCard(d.dragon.cardId).personality === per).length,
      );
      return Math.min(...counts);
    }
    case 'sizeSets': {
      const sizes = _state.expansions.includes('academy')
        ? (['Hatchling', 'Fledgling', 'Small', 'Medium', 'Large'] as const)
        : (['Hatchling', 'Small', 'Medium', 'Large'] as const);
      const counts = sizes.map(
        (sz) => all.filter((d) => dragonCard(d.dragon.cardId).size === sz).length,
      );
      return Math.min(...counts);
    }
    case 'trainingTokens':
      return all.reduce((a, d) => a + (d.dragon.training ?? 0), 0);
    case 'fullyTrainedFledglings':
      return all.filter((d) => isFullyTrained(dragonCard(d.dragon.cardId), d.dragon.training)).length;
    case 'filledColumns':
      return [0, 1, 2, 3].filter((col) => p.caves.every((row) => row.spaces[col]!.dragon)).length;
    case 'printedResourceCost': {
      // best single cave: sum of printed resource icons in dragon costs
      let best = 0;
      for (let c = 0; c < 3; c++) {
        const sum = all
          .filter((d) => d.cave === c)
          .reduce((a, d) => {
            const cost = dragonCard(d.dragon.cardId).cost;
            return a + RESOURCES.reduce((x, r) => x + (cost[r] ?? 0), 0);
          }, 0);
        best = Math.max(best, sum);
      }
      return best;
    }
    case 'fledglingCount':
      return all.filter((d) => dragonCard(d.dragon.cardId).size === 'Fledgling').length;
    case 'caveCards':
      return p.caves.reduce(
        (a, row) => a + row.spaces.filter((sp) => sp.excavated && sp.caveCardId !== null).length,
        0,
      );
  }
  return 0;
}

export function evalCond(
  state: GameState,
  p: PlayerState,
  cond: Cond,
  ctxPos?: [number, number],
): boolean {
  switch (cond.kind) {
    case 'atLeast':
      return countCounter(state, p, cond.counter, ctxPos) >= cond.n;
    case 'exactly':
      return countCounter(state, p, cond.counter, ctxPos) === cond.n;
    case 'isLastInCave': {
      if (!ctxPos) return false;
      const row = p.caves[ctxPos[0]]!;
      for (let i = ctxPos[1] + 1; i < row.spaces.length; i++) if (row.spaces[i]!.dragon) return false;
      return true;
    }
    case 'caveFull':
      return ctxPos !== undefined && p.caves[ctxPos[0]]!.spaces.every((s) => s.dragon);
    case 'columnFull':
      return ctxPos !== undefined && p.caves.every((row) => row.spaces[ctxPos[1]]!.dragon);
    case 'betweenTwoDragons': {
      if (!ctxPos) return false;
      return (
        ctxPos[1] > 0 &&
        ctxPos[1] < 3 &&
        !!p.caves[ctxPos[0]]!.spaces[ctxPos[1] - 1]!.dragon &&
        !!p.caves[ctxPos[0]]!.spaces[ctxPos[1] + 1]!.dragon
      );
    }
    case 'hasGuildMarker':
      return p.guildMarkersPlaced > 0;
    case 'leftNeighborGe': {
      const cave = cond.cave === 'crimson' ? 0 : cond.cave === 'golden' ? 1 : 2;
      const mine = allDragons(p).filter((d) => d.cave === cave).length;
      const theirs = allDragons(leftNeighbor(state, p.id)).filter((d) => d.cave === cave).length;
      return mine >= theirs;
    }
    case 'cardIs':
      return true; // evaluated by reveal handler, not here
    case 'allExcavated':
      return ctxPos !== undefined && p.caves[ctxPos[0]]!.spaces.every((s) => s.excavated);
    case 'willBeNthInCave':
    case 'playedAdjacentTo':
    case 'willCompleteRowOrColumn':
    case 'playedAtLeast':
      return true; // evaluated at play time / ignore-cost check
    case 'didPrecede':
    case 'tuckedHere':
      return true; // handled via step context flags
    case 'hasSizesInCave': {
      if (!ctxPos) return false;
      const inCave = allDragons(p).filter((d) => d.cave === ctxPos[0]);
      return cond.sizes.every((sz) => inCave.some((d) => dragonCard(d.dragon.cardId).size === sz));
    }
  }
  return true;
}

