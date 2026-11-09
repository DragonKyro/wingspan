// Shared pure helpers: seeded RNG, deck/display manipulation, position
// queries, counter/condition evaluation, and resource/card movement.

import { dragonCard, dragonMatchesCond, isDragonCard, parseIcons } from './cards';
import type {
  Cond,
  Counter,
  DragonCond,
  DragonTarget,
  EggTarget,
  GameState,
  GainItem,
  PlayedDragon,
  PlayerId,
  PlayerState,

} from './types';
import { RESOURCES } from './types';

// ---------------------------------------------------------------------------
// Seeded RNG (mulberry32), same pattern as the wingspan engine.

export function nextRng(rngState: number): [number, number] {
  let t = (rngState + 0x6d2b79f5) | 0;
  let r = Math.imul(t ^ (t >>> 15), 1 | t);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return [((r ^ (r >>> 14)) >>> 0) / 4294967296, t];
}

export function randInt(state: GameState, n: number): [number, GameState] {
  const [f, s] = nextRng(state.rngState);
  return [Math.floor(f * n), { ...state, rngState: s }];
}

export function shuffle<T>(state: GameState, arr: T[]): [T[], GameState] {
  const out = [...arr];
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const [j, s2] = randInt(s, i + 1);
    s = s2;
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return [out, s];
}

// ---------------------------------------------------------------------------
// Player/state accessors

export function player(state: GameState, id: PlayerId): PlayerState {
  const p = state.players.find((pl) => pl.id === id);
  if (!p) throw new Error(`unknown player ${id}`);
  return p;
}

export function otherPlayers(state: GameState, id: PlayerId): PlayerState[] {
  return state.players.filter((p) => p.id !== id);
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
  const spotsFor = (positions: Pos[]): Pos[] =>
    positions.filter((pos) => {
      const d = dragonAt(p, pos)!;
      return d.eggs < dragonCard(d.cardId).capacity;
    });
  switch (target.kind) {
    case 'any':
      return [
        ...spotsFor(allDragons(p).map((d) => ({ cave: d.cave, space: d.space }))),
      ];
    case 'here':
      return ctxPos ? spotsFor([{ cave: ctxPos[0], space: ctxPos[1] }]) : [];
    case 'thisCave':
      return ctxPos
        ? spotsFor(allDragons(p).filter((d) => d.cave === ctxPos[0]).map((d) => ({ cave: d.cave, space: d.space })))
        : [];
    case 'thisColumn':
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
    case 'eachInColumn':
      return ctxPos
        ? spotsFor(allDragons(p).filter((d) => d.space === ctxPos[1]).map((d) => ({ cave: d.cave, space: d.space })))
        : [];
    case 'eachInRow':
      return ctxPos
        ? spotsFor(allDragons(p).filter((d) => d.cave === ctxPos[0]).map((d) => ({ cave: d.cave, space: d.space })))
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
          .filter((d) => {
            const c = dragonCard(d.dragon.cardId);
            const track = c.trainingTrack ? parseIcons(c.trainingTrack).length : 0;
            return c.size === 'Fledgling' && track > 0 && (d.dragon.training ?? 0) >= track;
          })
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
  for (const it of cost) {
    if (it.kind === 'resource') {
      if (it.res === 'any') anyRes += it.count;
      else need[it.res] += it.count;
    } else if (it.kind === 'egg') eggs += it.count;
    else if (it.kind === 'coin') coins += it.count;
    else if (it.kind === 'card') {
      if (p.hand.filter((c) => (it.deck === 'dragon' ? isDragonCard(c) : !isDragonCard(c))).length < it.count)
        return false;
    }
  }
  if (p.coins < coins) return false;
  for (const r of RESOURCES) if (p.resources[r] < need[r]) return false;
  const totalRes = RESOURCES.reduce((a, r) => a + p.resources[r] - need[r], 0);
  if (totalRes < anyRes) return false;
  if (eggs > 0 && eggsOnMatCount(p) < eggs) return false;
  return true;
}

export function eggsOnMatCount(p: PlayerState): number {
  let n = p.nestEggs;
  for (const d of allDragons(p)) n += d.dragon.eggs;
  return n;
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
      const scores = p.objectiveVps;
      const min = Math.min(...[0, 1, 2, 3].map((i) => scores[i] ?? 0));
      return [0, 1, 2, 3].filter((i) => (scores[i] ?? 0) === min).length;
    }
    case 'traitSets': {
      const counts = (['Shy', 'Playful', 'Helpful', 'Aggressive'] as const).map(
        (per) => all.filter((d) => dragonCard(d.dragon.cardId).personality === per).length,
      );
      return Math.min(...counts);
    }
    case 'sizeSets': {
      const counts = (['Small', 'Medium', 'Large'] as const).map(
        (sz) => all.filter((d) => dragonCard(d.dragon.cardId).size === sz).length,
      );
      return Math.min(...counts);
    }
    case 'trainingTokens':
      return all.reduce((a, d) => a + (d.dragon.training ?? 0), 0);
    case 'fullyTrainedFledglings':
      return all.filter((d) => {
        const c = dragonCard(d.dragon.cardId);
        const track = c.trainingTrack ? parseIcons(c.trainingTrack).length : 0;
        return c.size === 'Fledgling' && track > 0 && (d.dragon.training ?? 0) >= track;
      }).length;
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
  }
  return true;
}

// ---------------------------------------------------------------------------
// Item descriptions (for logs)

export function describeItems(items: GainItem[]): string {
  return items
    .map((it) => {
      switch (it.kind) {
        case 'resource':
          return `${it.count} ${it.res}`;
        case 'card':
          return `${it.count} ${it.deck} card${it.count > 1 ? 's' : ''}`;
        case 'coin':
          return `${it.count} coin${it.count > 1 ? 's' : ''}`;
        case 'guild':
          return `${it.count} guild advance${it.count > 1 ? 's' : ''}`;
        case 'egg':
          return `${it.count} egg${it.count > 1 ? 's' : ''}`;
        case 'vp':
          return `${it.count} VP`;
      }
    })
    .join(', ');
}
