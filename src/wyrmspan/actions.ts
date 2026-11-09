// The four turn actions: excavate, entice, explore, pass — plus the free
// any-time exchange. Turn progression and round/upkeep live in engine.ts.

import { dragonCard, isDragonCard, parseIcons } from './cards';
import { MAT_ICONS, excavateAt, runAbility, runSteps, tryPlayDragonAt } from './effects';
import { allDragons, canPay, clone, eggsOnMatCount, log, otherPlayers, payItems, player } from './helpers';
import type { GameState, GainItem, PlayerId, PlayerState, Resource } from './types';
import { RESOURCES } from './types';

function setPlayer(state: GameState, p: PlayerState): GameState {
  return { ...state, players: state.players.map((q) => (q.id === p.id ? p : q)) };
}

/** Egg cost of excavating column idx (0-based): col3 = +1 egg, col4 = +2 eggs. */
export function excavateEggCost(spaceIdx: number): number {
  return spaceIdx === 2 ? 1 : spaceIdx === 3 ? 2 : 0;
}

export function nextEmptySpace(p: PlayerState, cave: number): number {
  return p.caves[cave]!.spaces.findIndex((sp) => !sp.excavated);
}

export function nextEnticeSpace(p: PlayerState, cave: number): number {
  return p.caves[cave]!.spaces.findIndex((sp) => sp.excavated && !sp.dragon);
}

// ---------------------------------------------------------------------------
// EXCAVATE — play a cave card from hand into the leftmost empty space.

export function excavate(state: GameState, playerId: PlayerId, cave: number, cardId: number): GameState {
  const p = player(state, playerId);
  const idx = nextEmptySpace(p, cave);
  if (idx < 0) return log(state, 'excavate: cave full');
  if (!p.hand.includes(cardId) || isDragonCard(cardId)) return log(state, 'excavate: card not in hand');

  const cost: GainItem[] = [{ kind: 'coin', count: 1 }];
  const eggs = excavateEggCost(idx);
  if (eggs) cost.push({ kind: 'egg', count: eggs });
  if (!canPay(p, cost)) return log(state, 'excavate: cannot pay');

  const q = payItems(clone(p), cost, undefined);
  // pay eggs from anywhere on the mat
  let left = eggs;
  outer: for (const row of q.caves) {
    for (const sp of row.spaces) {
      if (left <= 0) break outer;
      if (sp.dragon && sp.dragon.eggs > 0) {
        sp.dragon.eggs -= 1;
        left--;
      }
    }
  }
  if (left > 0) q.nestEggs = Math.max(0, q.nestEggs - left);
  q.hand.splice(q.hand.indexOf(cardId), 1);
  let s = setPlayer(state, q);
  s = excavateAt(s, playerId, cave, cardId);
  return s;
}

// ---------------------------------------------------------------------------
// ENTICE — play a dragon into the leftmost excavated space of a preferred cave.

export function dragonCost(cardId: number): GainItem[] {
  const c = dragonCard(cardId);
  const out: GainItem[] = [{ kind: 'coin', count: 1 }];
  for (const r of RESOURCES) {
    const n = c.cost[r];
    if (n) out.push({ kind: 'resource', res: r, count: n });
  }
  if (c.cost.coin) out.push({ kind: 'coin', count: c.cost.coin });
  if (c.cost.egg) out.push({ kind: 'egg', count: c.cost.egg });
  return out;
}

export function entice(state: GameState, playerId: PlayerId, cave: number, cardId: number): GameState {
  const p = player(state, playerId);
  if (!p.hand.includes(cardId) || !isDragonCard(cardId)) return log(state, 'entice: card not in hand');
  const card = dragonCard(cardId);
  const prefs: number[] = card.caves.map((n) => (n === 'Crimson Cavern' ? 0 : n === 'Golden Grotto' ? 1 : 2));
  if (!prefs.includes(cave)) return log(state, 'entice: dragon does not live in that cave');
  if (nextEnticeSpace(p, cave) < 0) return log(state, 'entice: no excavated space');

  // "Ignore this dragon's cost if ..." — evaluate the printed clause.
  let cost = dragonCost(cardId);
  const ignoreCheck = evaluateIgnoreCost(state, p, cardId, cave);
  if (ignoreCheck) cost = cost.filter((it) => it.kind === 'coin' && it.count === 1); // keep the 1-coin action cost

  if (!canPay(p, cost)) return log(state, 'entice: cannot pay');
  const q = payItems(clone(p), cost, undefined);
  // pay egg portion of the printed cost from the mat
  const eggCost = cost.filter((it) => it.kind === 'egg').reduce((a, i) => a + i.count, 0);
  let left = eggCost;
  outer: for (const row of q.caves) {
    for (const sp of row.spaces) {
      if (left <= 0) break outer;
      if (sp.dragon && sp.dragon.eggs > 0) {
        sp.dragon.eggs -= 1;
        left--;
      }
    }
  }
  if (left > 0) q.nestEggs = Math.max(0, q.nestEggs - left);
  let s = setPlayer(state, q);
  const r = tryPlayDragonAt(s, playerId, cardId, { discount: 'full' }, { cave, space: nextEnticeSpace(q, cave) });
  return r.state;
}

function evaluateIgnoreCost(_state: GameState, p: PlayerState, cardId: number, cave: number): boolean {
  void _state;
  const card = dragonCard(cardId);
  if (!card.ignoreCost || !card.ability) return false;
  const m = /^Ignore this dragon's cost if (.*?)\./.exec(card.ability);
  if (!m) return false;
  const t = m[1]!;
  const spaceIdx = nextEnticeSpace(p, cave);
  if (spaceIdx < 0) return false;
  const mine = allDragons(p);
  if (/it will be the 3rd or 4th dragon in its cave/.test(t)) {
    const inCave = mine.filter((d) => d.cave === cave).length;
    return [3, 4].includes(inCave + 1);
  }
  if (/it is played orthogonally adjacent to a \*?fledgling/.test(t)) {
    // any fledgling adjacent to the target space
    for (const adj of [
      { cave, space: spaceIdx - 1 },
      { cave, space: spaceIdx + 1 },
      { cave: cave - 1, space: spaceIdx },
      { cave: cave + 1, space: spaceIdx },
    ]) {
      if (adj.cave < 0 || adj.cave > 2 || adj.space < 0 || adj.space > 3) continue;
      const d = p.caves[adj.cave]!.spaces[adj.space]!.dragon;
      if (d && dragonCard(d.cardId).size === 'Fledgling') return true;
    }
    return false;
  }
  if (/it will complete a column or row of dragons/.test(t)) {
    const rowFull = p.caves[cave]!.spaces.every((sp, i) => i === spaceIdx || sp.dragon);
    const colFull = p.caves.every((row) => row.spaces[spaceIdx]!.dragon);
    return rowFull || colFull;
  }
  const pm = /^you have played at least (\d+) other (\w+) dragons$/.exec(t);
  if (pm) {
    const pers = pm[2]!.toUpperCase();
    const n = mine.filter((d) => dragonCard(d.dragon.cardId).personality?.toUpperCase() === pers).length;
    return n >= Number(pm[1]);
  }
  const sm = /^you have played at least (\d+) \*?(fledglings?|hatchlings?)\*?$/.exec(t);
  if (sm) {
    const sz = sm[2]!.startsWith('fledgling') ? 'Fledgling' : 'Hatchling';
    const n = mine.filter((d) => dragonCard(d.dragon.cardId).size === sz).length;
    return n >= Number(sm[1]);
  }
  return false;
}

// ---------------------------------------------------------------------------
// EXPLORE — walk the adventurer through one cave.

export function exploreCost(p: PlayerState, cave: number): GainItem[] {
  const names = ['crimson', 'golden', 'amethyst'] as const;
  const n = p.explores[names[cave]!];
  const cost: GainItem[] = [{ kind: 'coin', count: 1 }];
  if (n === 1) cost.push({ kind: 'egg', count: 1 });
  else if (n >= 2) cost.push({ kind: 'egg', count: 2 });
  return cost;
}

export function explore(state: GameState, playerId: PlayerId, cave: number): GameState {
  const p = player(state, playerId);
  const cost = exploreCost(p, cave);
  if (!canPay(p, cost)) return log(state, 'explore: cannot pay');
  const q = payItems(clone(p), cost, undefined);
  // pay egg portion of explore cost
  const eggN = cost.filter((it) => it.kind === 'egg').reduce((a, i) => a + i.count, 0);
  let left = eggN;
  outer: for (const row of q.caves) {
    for (const sp of row.spaces) {
      if (left <= 0) break outer;
      if (sp.dragon && sp.dragon.eggs > 0) {
        sp.dragon.eggs -= 1;
        left--;
      }
    }
  }
  if (left > 0) q.nestEggs = Math.max(0, q.nestEggs - left);
  const names = ['crimson', 'golden', 'amethyst'] as const;
  q.explores[names[cave]!] += 1;
  let s = setPlayer(state, q);

  // Walk left to right: mat icon, then dragon's Adventurer ability; stop at
  // the first space without a dragon.
  const row = q.caves[cave]!;
  for (let i = 0; i < row.spaces.length; i++) {
    const icons = MAT_ICONS[cave]?.[i] ?? [];
    if (icons.length) s = runSteps(s, icons, { playerId });
    const sp = player(s, playerId).caves[cave]!.spaces[i]!;
    if (!sp.excavated || !sp.dragon) break;
    s = runAbility(s, playerId, { cave, space: i }, ['Adventurer']);
    // Hatchlings/fledglings also have non-adventurer abilities; adventurer
    // only triggers 'Adventurer'-typed ones (handled inside runAbility).
  }
  s = log(s, `${player(s, playerId).name} explored cave ${cave + 1}`);
  return s;
}

// ---------------------------------------------------------------------------
// PASS — sit out the rest of the round.

export function pass(state: GameState, playerId: PlayerId): GameState {
  const p = clone(player(state, playerId));
  p.passed = true;
  let s = setPlayer(state, p);
  s = log(s, `${p.name} passed`);
  return s;
}

// ---------------------------------------------------------------------------
// EXCHANGE — any time: trade any 2 resources for 1 of another type.

export function exchange(state: GameState, playerId: PlayerId, give: [Resource, Resource], get: Resource): GameState {
  const p = clone(player(state, playerId));
  for (const r of give) {
    if (p.resources[r] <= 0) return log(state, 'exchange: missing resources');
    p.resources[r] -= 1;
  }
  p.resources[get] += 1;
  return setPlayer(state, p);
}

// ---------------------------------------------------------------------------
// Turn helpers

export function turnPlayersDone(state: GameState): boolean {
  return state.players.every((p) => p.passed);
}

export function nextTurnPlayer(state: GameState): PlayerId {
  const order = state.playerOrder;
  for (let k = 1; k <= order.length; k++) {
    const id = order[(state.turnIndex + k) % order.length]!;
    if (!player(state, id).passed) return id;
  }
  return state.turn;
}

export { eggsOnMatCount, isDragonCard, otherPlayers, parseIcons };
