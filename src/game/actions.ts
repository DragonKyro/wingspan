// Handlers for the four turn actions, setup, activation and end-turn.
// Every handler validates the action fully; invalid actions throw.

import { bird } from './cards';
import {
  CUBES_PER_ROUND,
  FOREST_DICE,
  GOAL_POINTS,
  GRASSLAND_EGGS,
  TRADE_SLOTS,
  WETLAND_CARDS,
} from './constants';
import {
  actingPlayerId,
  actionSlot,
  birdAt,
  canHoldEggs,
  columnEggCost,
  getPlayer,
  nextSlot,
  payFoodPlan,
  rowFull,
  spendFood,
} from './helpers';
import { goalScore } from './scoring';
import {
  drawFromDeck,
  firePinkTriggers,
  hasPowerImpl,
  pushPending,
  refillFeeder,
  refillTray,
  resetPinkFlags,
  runPower,
  setPlayer,
  takeDieFromFeeder,
} from './powers';
import type {
  BirdRef,
  DieFace,
  DrawCardsAction,
  FoodType,
  GainFoodAction,
  GameState,
  Habitat,
  KeepSetupAction,
  LayEggsAction,
  PlayBirdAction,
  PlayerId,
} from './types';
import { HABITATS } from './types';

function requireTurn(state: GameState, playerId: PlayerId): void {
  if (state.phase !== 'main') throw new Error('not the main phase');
  if (actingPlayerId(state) !== playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  if (state.activation) throw new Error('finish activating powers first');
  if (state.turnTookAction) throw new Error('already took an action this turn');
  const p = getPlayer(state, playerId);
  if (p.actionCubes <= 0) throw new Error('no action cubes left');
}

function spendCube(state: GameState, playerId: PlayerId): GameState {
  const p = getPlayer(state, playerId);
  return { ...setPlayer(state, { ...p, actionCubes: p.actionCubes - 1 }), turnTookAction: true };
}

/** Start the activation track for a habitat row: brown powers, right to left. */
function startActivation(state: GameState, playerId: PlayerId, habitat: Habitat): GameState {
  const p = getPlayer(state, playerId);
  const remaining: number[] = [];
  for (let i = p.board[habitat].length - 1; i >= 0; i--) {
    const c = bird(p.board[habitat][i]!.cardId);
    if (c.powerColor === 'brown' && c.powerText && hasPowerImpl(c.id)) remaining.push(i);
  }
  return { ...state, activation: remaining.length ? { habitat, remaining } : null };
}

// === setup ===

export function keepSetup(state: GameState, action: KeepSetupAction): GameState {
  if (state.phase !== 'setup') throw new Error('not in setup');
  if (!state.setupRemaining.includes(action.playerId)) throw new Error('already kept');
  const p = getPlayer(state, action.playerId);
  for (const id of action.keepBirds) {
    if (!p.hand.includes(id)) throw new Error('bird was not dealt to you');
  }
  if (!p.bonusHand.includes(action.keepBonus)) throw new Error('bonus card was not dealt to you');
  if (action.discardFood.length !== action.keepBirds.length) {
    throw new Error('you must discard 1 food per bird kept');
  }
  const food = { ...p.food };
  for (const f of action.discardFood) {
    if (food[f] <= 0) throw new Error(`you don't have ${f}`);
    food[f]--;
  }
  const kept = new Set(action.keepBirds);
  const unkept = p.hand.filter((id) => !kept.has(id));
  const keptBonus = action.keepBonus;
  const unkeptBonus = p.bonusHand.filter((id) => id !== keptBonus);
  let s: GameState = {
    ...state,
    discard: [...state.discard, ...unkept],
    bonusDeck: [...state.bonusDeck, ...unkeptBonus],
    setupRemaining: state.setupRemaining.filter((id) => id !== action.playerId),
    players: state.players.map((x) =>
      x.id === action.playerId
        ? { ...x, hand: action.keepBirds.slice(), bonusHand: [keptBonus], food }
        : x,
    ),
  };
  if (s.setupRemaining.length === 0) {
    s = { ...s, phase: 'main', turnTookAction: false };
    s = resetPinkFlags(s, actingPlayerId(s));
  }
  return s;
}

// === play a bird ===

export function playBird(state: GameState, action: PlayBirdAction): GameState {
  requireTurn(state, action.playerId);
  const p = getPlayer(state, action.playerId);
  const card = bird(action.cardId);
  if (!p.hand.includes(action.cardId)) throw new Error('card not in hand');
  if (!card.habitats.includes(action.habitat)) throw new Error(`this bird can't live in the ${action.habitat}`);
  if (rowFull(p, action.habitat)) throw new Error('row is full');
  const slot = nextSlot(p, action.habitat);
  const eggCost = columnEggCost(slot);
  if (action.eggPayments.length !== eggCost) throw new Error(`column ${slot + 1} costs ${eggCost} eggs`);
  for (const ref of action.eggPayments) {
    const b = birdAt(state, action.playerId, ref);
    if (b.eggs <= 0) throw new Error('that bird has no eggs');
  }
  // Validate the food payment covers the cost (exact tokens, incl. 2-for-1 and nectar).
  const paid: Record<FoodType, number> = {
    invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0,
  };
  for (const f of action.foodPayments) paid[f]++;
  if (payFoodPlan(paid, card.cost) === null) throw new Error('food payment does not cover the cost');
  for (const f of action.foodPayments) {
    if (p.food[f] <= 0) throw new Error(`you don't have ${f}`);
  }

  let s = spendCube(state, action.playerId);
  let pl = getPlayer(s, action.playerId);
  // Pay eggs.
  for (const ref of action.eggPayments) {
    const row = [...pl.board[ref.habitat]];
    row[ref.index] = { ...row[ref.index]!, eggs: row[ref.index]!.eggs - 1 };
    pl = { ...pl, board: { ...pl.board, [ref.habitat]: row } };
  }
  // Pay food (track nectar spent for Oceania scoring).
  const nectarPaid = action.foodPayments.filter((f) => f === 'nectar').length;
  pl = spendFood(pl, action.foodPayments);
  if (nectarPaid > 0) {
    pl = {
      ...pl,
      nectarSpent: { ...pl.nectarSpent, [action.habitat]: pl.nectarSpent[action.habitat] + nectarPaid },
    };
  }
  // Play the bird.
  pl = {
    ...pl,
    hand: pl.hand.filter((id) => id !== action.cardId),
    board: {
      ...pl.board,
      [action.habitat]: [...pl.board[action.habitat], { cardId: action.cardId, eggs: 0, tucked: [], cached: [] }],
    },
    cubesOnPlayBird: pl.cubesOnPlayBird + 1,
  };
  s = setPlayer(s, pl);

  // When-played powers (white banner).
  const ref: BirdRef = { habitat: action.habitat, index: pl.board[action.habitat].length - 1 };
  if (card.powerColor === 'white' && card.powerText) {
    s = runPower(s, action.playerId, ref);
  }
  s = firePinkTriggers(s, action.playerId, { kind: 'playBird', habitat: action.habitat });
  return s;
}

// === gain food ===

function allSameFace(dice: DieFace[]): boolean {
  return dice.length > 0 && dice.every((d) => d === dice[0]);
}

export function gainFood(state: GameState, action: GainFoodAction): GameState {
  requireTurn(state, action.playerId);
  const p = getPlayer(state, action.playerId);
  const slot = actionSlot(p, 'forest');
  let diceToTake = FOREST_DICE[slot]!;
  if (action.bonusTradeCardId != null) {
    if (!TRADE_SLOTS.includes(slot)) throw new Error('this slot has no trade');
    if (!p.hand.includes(action.bonusTradeCardId)) throw new Error('card not in hand');
    diceToTake += 1;
  }
  let s = spendCube(state, action.playerId);
  if (action.bonusTradeCardId != null) {
    const pl = getPlayer(s, action.playerId);
    s = {
      ...setPlayer(s, { ...pl, hand: pl.hand.filter((id) => id !== action.bonusTradeCardId) }),
      discard: [...s.discard, action.bonusTradeCardId],
    };
  }
  if (action.reroll) {
    if (!allSameFace(s.feederIn)) throw new Error('can only reroll when all dice show the same face');
    s = refillFeeder(s);
  }
  if (action.picks.length !== diceToTake) throw new Error(`take ${diceToTake} dice`);
  const gained: FoodType[] = [];
  for (const pick of action.picks) {
    const face = s.feederIn[pick.die];
    if (face == null) throw new Error('no such die');
    if (face === 'split' && pick.take !== 'invertebrate' && pick.take !== 'seed') {
      throw new Error('choose which food the split die gives');
    }
    const before = getPlayer(s, action.playerId);
    s = takeDieFromFeeder(s, action.playerId, pick.die, pick.take);
    const after = getPlayer(s, action.playerId);
    for (const f of Object.keys(after.food) as FoodType[]) {
      if (after.food[f] > before.food[f]) gained.push(f);
    }
  }
  // Pink triggers: rodents taken (and any food-type watch).
  for (const f of new Set(gained)) {
    s = firePinkTriggers(s, action.playerId, { kind: 'gainFood', food: f });
  }
  return startActivation(s, action.playerId, 'forest');
}

// === lay eggs ===

export function layEggs(state: GameState, action: LayEggsAction): GameState {
  requireTurn(state, action.playerId);
  const p = getPlayer(state, action.playerId);
  const slot = actionSlot(p, 'grassland');
  let eggs = GRASSLAND_EGGS[slot]!;
  if (action.tradeFood != null) {
    if (!TRADE_SLOTS.includes(slot)) throw new Error('this slot has no trade');
    if (p.food[action.tradeFood] <= 0) throw new Error(`you don't have ${action.tradeFood}`);
    eggs += 1;
  }
  if (action.placements.length > eggs) throw new Error(`only ${eggs} eggs to place`);
  // Validate targets up-front against remaining room.
  const planned = new Map<string, number>();
  for (const ref of action.placements) {
    const key = `${ref.habitat}:${ref.index}`;
    planned.set(key, (planned.get(key) ?? 0) + 1);
    const b = birdAt(state, action.playerId, ref);
    if (!canHoldEggs(b.cardId)) throw new Error('that bird cannot hold eggs');
    const used = planned.get(key)!;
    if (b.eggs + used > bird(b.cardId).eggLimit) throw new Error('over the egg limit');
  }
  let s = spendCube(state, action.playerId);
  if (action.tradeFood != null) {
    s = setPlayer(s, spendFood(getPlayer(s, action.playerId), [action.tradeFood]));
  }
  for (const ref of action.placements) {
    const pl = getPlayer(s, action.playerId);
    const row = [...pl.board[ref.habitat]];
    row[ref.index] = { ...row[ref.index]!, eggs: row[ref.index]!.eggs + 1 };
    s = setPlayer(s, { ...pl, board: { ...pl.board, [ref.habitat]: row } });
  }
  s = firePinkTriggers(s, action.playerId, { kind: 'layEggs' });
  return startActivation(s, action.playerId, 'grassland');
}

// === draw cards ===

export function drawCards(state: GameState, action: DrawCardsAction): GameState {
  requireTurn(state, action.playerId);
  const p = getPlayer(state, action.playerId);
  const slot = actionSlot(p, 'wetland');
  let count = WETLAND_CARDS[slot]!;
  if (action.tradeEgg) {
    if (!TRADE_SLOTS.includes(slot)) throw new Error('this slot has no trade');
    const b = birdAt(state, action.playerId, action.tradeEgg);
    if (b.eggs <= 0) throw new Error('that bird has no eggs');
    count += 1;
  }
  if (action.picks.length !== count) throw new Error(`draw ${count} cards`);
  for (const pick of action.picks) {
    if (pick !== 'deck' && (pick < 0 || pick > 2 || state.tray[pick] == null)) {
      throw new Error('that tray slot is empty');
    }
  }
  let s = spendCube(state, action.playerId);
  if (action.tradeEgg) {
    const pl = getPlayer(s, action.playerId);
    const row = [...pl.board[action.tradeEgg.habitat]];
    row[action.tradeEgg.index] = { ...row[action.tradeEgg.index]!, eggs: row[action.tradeEgg.index]!.eggs - 1 };
    s = setPlayer(s, { ...pl, board: { ...pl.board, [action.tradeEgg.habitat]: row } });
  }
  for (const pick of action.picks) {
    if (pick === 'deck') {
      s = drawFromDeck(s, action.playerId, 1);
    } else {
      const id = s.tray[pick]!;
      const tray = [...s.tray];
      tray[pick] = null;
      const pl = getPlayer(s, action.playerId);
      s = { ...setPlayer(s, { ...pl, hand: [...pl.hand, id] }), tray };
    }
  }
  return startActivation(s, action.playerId, 'wetland');
}

// === activation ===

export function activatePower(state: GameState, playerId: PlayerId): GameState {
  if (state.phase !== 'main') throw new Error('not the main phase');
  if (actingPlayerId(state) !== playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  const act = state.activation;
  if (!act || act.remaining.length === 0) throw new Error('no power to activate');
  const ref: BirdRef = { habitat: act.habitat, index: act.remaining[0]! };
  const remaining = act.remaining.slice(1);
  let s: GameState = { ...state, activation: remaining.length ? { ...act, remaining } : null };
  s = runPower(s, playerId, ref);
  return s;
}

export function skipPower(state: GameState, playerId: PlayerId, all: boolean): GameState {
  if (actingPlayerId(state) !== playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  const act = state.activation;
  if (!act) return state;
  const remaining = all ? [] : act.remaining.slice(1);
  return { ...state, activation: remaining.length ? { ...act, remaining } : null };
}

// === end turn ===

export function endTurn(state: GameState, playerId: PlayerId): GameState {
  if (state.phase !== 'main') throw new Error('not the main phase');
  if (actingPlayerId(state) !== playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  if (state.activation) throw new Error('finish activating powers first');
  const p = getPlayer(state, playerId);
  // End-of-turn discard powers trigger first.
  if (p.endOfTurnDiscards > 0) {
    return pushPending(state, {
      kind: 'chooseHandDiscard',
      playerId,
      count: Math.min(p.endOfTurnDiscards, p.hand.length),
      then: { effect: 'endTurnDiscardsDone' },
    });
  }
  let s = refillTray(state);
  // Advance to the next player with cubes left.
  let next = state.currentPlayerIndex;
  let guard = 0;
  do {
    next = (next + 1) % s.playerOrder.length;
    guard++;
  } while (getPlayer(s, s.playerOrder[next]!).actionCubes <= 0 && guard <= s.playerOrder.length);
  const anyLeft = s.players.some((pl) => pl.actionCubes > 0);
  if (!anyLeft) {
    return endRound(s);
  }
  s = { ...s, currentPlayerIndex: next, turnTookAction: false };
  s = resetPinkFlags(s, s.playerOrder[next]!);
  return s;
}

/** Called by the pending resolver when the queued end-of-turn discard is done. */
export function finishEndOfTurnDiscards(state: GameState, playerId: PlayerId): GameState {
  const p = getPlayer(state, playerId);
  return setPlayer(state, { ...p, endOfTurnDiscards: 0 });
}

// === round / game end ===

function endRound(state: GameState): GameState {
  // Score this round's goal tile (green side: ranked).
  const tile = state.goalTiles[state.round];
  let s = state;
  if (tile != null) {
    const points = GOAL_POINTS[s.round] ?? GOAL_POINTS[3]!;
    const units = s.playerOrder.map((pid) => goalScore(s, pid, tile));
    // Ranks with tie-split (floor of summed rank points). Players with 0
    // units place their cube on the 0 space — they don't rank.
    const order = s.playerOrder
      .map((pid, i) => ({ pid, units: units[i]! }))
      .filter((x) => x.units > 0)
      .sort((a, b) => b.units - a.units);
    const scores = new Array<number>(s.playerOrder.length).fill(0);
    let i = 0;
    while (i < order.length) {
      let j = i;
      while (j + 1 < order.length && order[j + 1]!.units === order[i]!.units) j++;
      const rankPoints = points.slice(i, j + 1).reduce((a, b) => a + b, 0);
      const share = Math.floor(rankPoints / (j - i + 1));
      for (let k = i; k <= j; k++) scores[s.playerOrder.indexOf(order[k]!.pid)] = share;
      i = j + 1;
    }
    const goalScores = [...s.goalScores];
    goalScores[s.round] = scores;
    s = { ...s, goalScores };
  }
  // Discard the face-up tray cards and restock from the deck.
  s = {
    ...s,
    discard: [...s.discard, ...s.tray.filter((id): id is number => id != null)],
    tray: [null, null, null],
  };
  s = refillTray(s);
  // Queue every teal-powered bird (in player order then board order); they
  // drain during the 'roundEnd' phase, which settle() runs automatically.
  const tealQueue: { playerId: PlayerId; bird: BirdRef }[] = [];
  for (const pid of s.playerOrder) {
    const p = getPlayer(s, pid);
    for (const h of HABITATS) {
      p.board[h].forEach((b, index) => {
        const c = bird(b.cardId);
        if (c.powerColor === 'teal' && c.powerText && hasPowerImpl(c.id)) {
          tealQueue.push({ playerId: pid, bird: { habitat: h, index } });
        }
      });
    }
  }

  const nextRound = s.round + 1;
  if (nextRound < 4) {
    // Reset cubes for the new round; the NEXT player in order starts it
    // (first-player marker passes clockwise).
    s = {
      ...s,
      round: nextRound,
      currentPlayerIndex: (s.currentPlayerIndex + 1) % s.playerOrder.length,
      turnTookAction: false,
      players: s.players.map((pl) => ({ ...pl, actionCubes: CUBES_PER_ROUND[nextRound]! })),
    };
    s = resetPinkFlags(s, s.playerOrder[s.currentPlayerIndex]!);
  } else {
    s = { ...s, round: nextRound };
  }
  return { ...s, phase: 'roundEnd', roundEndQueue: tealQueue };
}

export function beginGameEnd(state: GameState): GameState {
  // Queue every yellow-powered bird, in player order then board order.
  const queue: { playerId: PlayerId; bird: BirdRef }[] = [];
  for (const pid of state.playerOrder) {
    const p = getPlayer(state, pid);
    for (const h of HABITATS) {
      p.board[h].forEach((b, index) => {
        const c = bird(b.cardId);
        if (c.powerColor === 'yellow' && c.powerText && hasPowerImpl(c.id)) {
          queue.push({ playerId: pid, bird: { habitat: h, index } });
        }
      });
    }
  }
  return { ...state, phase: 'gameEnd', gameEndQueue: queue };
}

/** Advance the roundEnd queue: run the head bird's teal power. */
export function runRoundEndStep(state: GameState): GameState {
  const q = state.roundEndQueue;
  if (q.length === 0 || state.pending.length > 0) return state;
  const { playerId, bird: ref } = q[0]!;
  let s: GameState = { ...state, roundEndQueue: q.slice(1) };
  s = runPower(s, playerId, ref);
  return s;
}

/** Advance the gameEnd queue: run the head bird's yellow power. */
export function runGameEndStep(state: GameState): GameState {
  const q = state.gameEndQueue;
  if (!q || q.length === 0 || state.pending.length > 0) return state;
  const { playerId, bird: ref } = q[0]!;
  let s: GameState = { ...state, gameEndQueue: q.slice(1) };
  s = runPower(s, playerId, ref);
  return s;
}

export const internals = { startActivation, allSameFace, spendCube };
