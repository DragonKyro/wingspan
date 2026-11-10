// The four turn actions: excavate, entice, explore, pass — plus the free
// any-time exchange. Turn progression and round/upkeep live in engine.ts.

import { passAutoma } from './automa';
import { dragonCard, isDragonCard, parseIcons } from './cards';
import { excavateAt, runSteps, tryPlayDragonAt } from './effects';
import { INCOME_SECTIONS, incomeSectionIndex } from './guild';
import { allDragons, canPay, clone, dragonPrintedCost, eggsOnMatCount, log, otherPlayers, payItems, player, removeEggs, setPlayer } from './helpers';
import type { GameState, GainItem, PlayerId, PlayerState, Resource } from './types';

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
  removeEggs(q, eggs);
  q.hand.splice(q.hand.indexOf(cardId), 1);
  let s = setPlayer(state, q);
  s = excavateAt(s, playerId, cave, cardId);
  return s;
}

// ---------------------------------------------------------------------------
// ENTICE — play a dragon into the leftmost excavated space of a preferred cave.

export function dragonCost(cardId: number): GainItem[] {
  // 1-coin entice action cost + the dragon's printed cost.
  return [{ kind: 'coin', count: 1 }, ...dragonPrintedCost(cardId)];
}

export function entice(state: GameState, playerId: PlayerId, cave: number, cardId: number): GameState {
  const p = player(state, playerId);
  if (!p.hand.includes(cardId) || !isDragonCard(cardId)) return log(state, 'entice: card not in hand');
  const card = dragonCard(cardId);
  const prefs: number[] = card.caves.map((n) => (n === 'Crimson Cavern' ? 0 : n === 'Golden Grotto' ? 1 : 2));
  if (!prefs.includes(cave)) return log(state, 'entice: dragon does not live in that cave');
  if (nextEnticeSpace(p, cave) < 0) return log(state, 'entice: no excavated space');

  // "Ignore this dragon's cost if ..." — evaluate the printed clause. The
  // printed cost is waived but the 1-coin entice action cost is always paid.
  let cost = dragonCost(cardId);
  const ignoreCheck = evaluateIgnoreCost(state, p, cardId, cave);
  if (ignoreCheck) cost = [{ kind: 'coin', count: 1 }];

  if (!canPay(p, cost)) return log(state, 'entice: cannot pay');
  const q = payItems(clone(p), cost, undefined);
  q.coinsSpentEntice += cost.filter((it) => it.kind === 'coin').reduce((a, i) => a + i.count, 0);
  // pay egg portion of the printed cost from the mat
  const eggCost = cost.filter((it) => it.kind === 'egg').reduce((a, i) => a + i.count, 0);
  removeEggs(q, eggCost);
  let s = setPlayer(state, q);
  const r = tryPlayDragonAt(s, playerId, cardId, {}, { cave, space: nextEnticeSpace(q, cave) });
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
  const names = ['crimson', 'golden', 'amethyst'] as const;
  // Rulebook: the 3rd entry into a cave in a round is the maximum.
  if (p.explores[names[cave]!] >= 3) {
    return log(state, 'explore: cave already explored 3 times this round');
  }
  const cost = exploreCost(p, cave);
  if (!canPay(p, cost)) return log(state, 'explore: cannot pay');
  const q = payItems(clone(p), cost, undefined);
  // pay egg portion of explore cost
  const eggN = cost.filter((it) => it.kind === 'egg').reduce((a, i) => a + i.count, 0);
  removeEggs(q, eggN);
  q.explores[names[cave]!] += 1;
  let s = setPlayer(state, q);
  s = log(s, `${player(s, playerId).name} explored cave ${cave + 1}`);
  // Walk left to right via continuation-chained steps: printed path icon [i],
  // then dragon [i]'s Adventurer ability + fledgling training offer, stopping
  // at the first space without a dragon (or after path icon [4] if all 4 spaces
  // have dragons).
  s = runSteps(s, [{ op: 'exploreStep', cave, index: 0 }], { playerId });
  return s;
}

// ---------------------------------------------------------------------------
// PASS — sit out the rest of the round.

export function pass(state: GameState, playerId: PlayerId): GameState {
  if (state.automa && playerId === 'p2') {
    return passAutoma(state, playerId);
  }
  const p = clone(player(state, playerId));
  p.passed = true;
  // Ravel Mode (dragon automa.txt line 403): "In Ravel Mode only, you may not
  // store more than 2 coins between rounds; you must discard down to 2 coins
  // when you pass."
  if (state.automa?.ravelMode && playerId === 'p1') {
    p.coins = Math.min(2, p.coins);
  }
  let s = setPlayer(state, p);
  s = log(s, `${p.name} passed`);
  // Academy: in rounds 1-3 a passing player claims an income space for next
  // round's collection (the benefit is gained at round end, not now).
  if (s.expansions.includes('academy') && s.round <= 3) {
    const section = INCOME_SECTIONS[incomeSectionIndex(s.round)]!;
    const claimed = new Set(Object.values(s.incomeChoices));
    const automaPassedFirst = Boolean(s.automa && player(s, 'p2').passed);
    let options = section
      .map((_, i) => i)
      .filter((i) => {
        if (claimed.has(i)) return false;
        // Dragon Academy Automa (academy_p06.png): "If Automa passes before you
        // do, you may not choose a 6-coin income space when you pass."
        if (automaPassedFirst && section[i]!.items.some((it) => it.kind === 'coin' && it.count === 6)) {
          return false;
        }
        return true;
      });
    // If every space is somehow taken, allow doubling up rather than stalling.
    if (!options.length) options = section.map((_, i) => i);
    s = {
      ...s,
      pending: [...s.pending, { kind: 'chooseIncomeSpace', playerId, options }],
    };
  }
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
