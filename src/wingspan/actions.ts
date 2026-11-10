// Handlers for the four turn actions, setup, activation and end-turn.
// Every handler validates the action fully; invalid actions throw.

import {
  advanceAutomaHummingbird,
  automaCard,
  placeAutomaDuetToken,
  selectAutomaTrayBirds,
} from './automa';
import { bird, goalTile } from './cards';
import { shuffle } from '../shared/rng';
import {
  CUBES_PER_ROUND,
  FOREST_DICE,
  GOAL_POINTS,
  GRASSLAND_EGGS,
  OCEANIA_CARD_TRADE_SLOTS,
  OCEANIA_EGG_DOUBLE_TRADE_SLOT,
  OCEANIA_EGG_TRADE_SLOTS,
  OCEANIA_FOREST_DICE,
  OCEANIA_FOREST_RESET_SLOTS,
  OCEANIA_FOREST_TRADE_SLOTS,
  OCEANIA_GRASSLAND_EGGS,
  OCEANIA_WETLAND_CARDS,
  OCEANIA_WETLAND_RESET_SLOTS,
  TRADE_SLOTS,
  WETLAND_CARDS,
} from './constants';
import {
  actingPlayerId,
  actionSlot,
  addEggs,
  birdAt,
  canHoldEggs,
  getPlayer,
  isAmericas,
  isAutoma,
  isCardCostBird,
  isCoverBird,
  isDuet,
  isFlock,
  isGoalDouble,
  isOceania,
  isSideways,
  nextSlot,
  payFoodPlan,
  playEggCost,
  rowFull,
  spendFood,
} from './helpers';
import { DUET_GOAL_POINTS, DUET_LOWER_IS_BETTER, FLOCK_GOAL_POINTS } from './duetMap';
import { goalScore } from './scoring';
import {
  drawFromDeck,
  feederReset,
  fireAllPinkPowersForAutoma,
  firePinkTriggers,
  hasPowerImpl,
  pushPending,
  queueRowHumAction,
  refillFeeder,
  refillHumGarden,
  refillTray,
  resetPinkFlags,
  runPower,
  setPlayer,
  takeDieFromFeeder,
} from './powers';
import type {
  BirdCard,
  BirdRef,
  CubeTrack,
  DieFace,
  DrawCardsAction,
  DuetResetAction,
  FoodCost,
  FoodType,
  GainFoodAction,
  GameState,
  Habitat,
  KeepSetupAction,
  LayEggsAction,
  PlayBirdAction,
  PlayerId,
} from './types';
import { HABITATS, HUM_GROUPS } from './types';

function requireTurn(state: GameState, playerId: PlayerId): void {
  if (state.phase !== 'main') throw new Error('not the main phase');
  if (actingPlayerId(state) !== playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  if (state.activation) throw new Error('finish activating powers first');
  if (state.turnTookAction) throw new Error('already took an action this turn');
  const p = getPlayer(state, playerId);
  if (p.actionCubes <= 0) throw new Error('no action cubes left');
}

function spendCube(state: GameState, playerId: PlayerId, track: CubeTrack): GameState {
  const p = getPlayer(state, playerId);
  return {
    ...setPlayer(state, {
      ...p,
      actionCubes: p.actionCubes - 1,
      roundCubes: { ...p.roundCubes, [track]: p.roundCubes[track] + 1 },
    }),
    turnTookAction: true,
  };
}

/** Start the activation track for a habitat row: brown powers, right to left. */
function startActivation(state: GameState, playerId: PlayerId, habitat: Habitat): GameState {
  const p = getPlayer(state, playerId);
  const remaining: number[] = [];
  for (let i = p.board[habitat].length - 1; i >= 0; i--) {
    if (p.board[habitat][i]!.ghost) continue;
    const c = bird(p.board[habitat][i]!.cardId);
    if (c.powerColor === 'brown' && c.powerText && hasPowerImpl(c.id)) remaining.push(i);
  }
  return { ...state, activation: remaining.length ? { habitat, remaining } : null };
}

/** Americas: a row action lands the action cube on the row's hummingbird
 *  space after the brown powers finish. Marks the owed action and queues it
 *  immediately when the row has no brown powers to activate. */
function rowHumAction(state: GameState, playerId: PlayerId, habitat: Habitat): GameState {
  if (!isAmericas(state)) return state;
  const s: GameState = { ...state, humAction: habitat };
  return s.activation == null ? queueRowHumAction(s, playerId) : s;
}

/** Called whenever the activation track drains: queue the owed hummingbird
 *  action (if any). */
function activationDone(state: GameState, playerId: PlayerId): GameState {
  if (state.pending.some((st) => st.kind === 'moveBirdHabitat' && st.then?.effect === 'amCubeMove')) {
    return state;
  }
  return state.activation == null ? queueRowHumAction(state, playerId) : state;
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
  // Oceania: the starting nectar is gained only after setup choices are made.
  if (action.discardFood.includes('nectar')) throw new Error('cannot discard nectar during setup');
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
    // The bonus card not kept is discarded (it never returns to the deck).
    bonusDiscard: [...state.bonusDiscard, ...unkeptBonus],
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
  if (action.coverBird) return playOnTop(state, action, card);
  if (!card.habitats.includes(action.habitat)) throw new Error(`this bird can't live in the ${action.habitat}`);
  if (rowFull(p, action.habitat)) throw new Error('row is full');
  const slot = nextSlot(p, action.habitat);
  // European sideways birds cover a second space when two are free (the
  // power can be forgone; a single free space also means a normal play).
  const coversTwo = isSideways(card) && action.coverTwo !== false && slot <= 3;
  // "Pay the lower egg cost": the lower of the two covered columns' costs —
  // column costs are non-decreasing, so that is the left covered slot's cost.
  // Includes the Americas Rufous Hornero placeholder-egg discount.
  const effEggCost = playEggCost(p, action.habitat);
  if (action.eggPayments.length !== effEggCost) throw new Error(`column ${slot + 1} costs ${effEggCost} eggs`);
  for (const ref of action.eggPayments) {
    const b = birdAt(state, action.playerId, ref);
    if (b.ghost) throw new Error('that space is covered');
    if (b.eggs <= 0) throw new Error('that bird has no eggs');
  }
  // European predators: hand cards may replace [rodent] cost items; the paid
  // cards tuck behind the bird (counts as a tuck + a predator succeeding).
  const cardPayments = action.cardPayments ?? [];
  for (const id of cardPayments) {
    if (id === action.cardId || !p.hand.includes(id)) throw new Error('card not in hand');
  }
  let effCost: FoodCost = card.cost;
  if (cardPayments.length > 0) {
    if (!isCardCostBird(card) || card.cost.kind !== 'and') {
      throw new Error('this bird cannot be paid with cards');
    }
    const rodents = card.cost.items
      .filter((i) => i.food === 'rodent')
      .reduce((n, i) => n + i.count, 0);
    if (cardPayments.length > rodents) throw new Error('more cards paid than [rodent] in cost');
    let left = cardPayments.length;
    effCost = {
      kind: 'and',
      items: card.cost.items
        .map((i) => {
          if (i.food !== 'rodent') return i;
          const use = Math.min(left, i.count);
          left -= use;
          return { ...i, count: i.count - use };
        })
        .filter((i) => i.count > 0),
    };
    if (effCost.kind === 'and' && effCost.items.length === 0) effCost = { kind: 'none' };
  }
  // Cached food on birds can be spent like supply food (european caching).
  const cachedPayments = action.cachedFoodPayments ?? [];
  for (const cp of cachedPayments) {
    const b = birdAt(state, action.playerId, cp.bird);
    if (b.ghost) throw new Error('that space is covered');
    if (!b.cached.includes(cp.food)) throw new Error('that food is not cached there');
  }
  // Validate the food payment covers the (possibly card-reduced) cost.
  const paid: Record<FoodType, number> = {
    invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0,
  };
  for (const f of action.foodPayments) paid[f]++;
  for (const cp of cachedPayments) paid[cp.food]++;
  if (payFoodPlan(paid, effCost) === null) throw new Error('food payment does not cover the cost');
  for (const f of action.foodPayments) {
    if (p.food[f] <= 0) throw new Error(`you don't have ${f}`);
  }

  let s = spendCube(state, action.playerId, 'playBird');
  let pl = getPlayer(s, action.playerId);
  // Pay eggs.
  for (const ref of action.eggPayments) {
    const row = [...pl.board[ref.habitat]];
    row[ref.index] = { ...row[ref.index]!, eggs: row[ref.index]!.eggs - 1 };
    pl = { ...pl, board: { ...pl.board, [ref.habitat]: row } };
  }
  // Spend cached food off the birds it sat on.
  for (const cp of cachedPayments) {
    const row = [...pl.board[cp.bird.habitat]];
    const b = row[cp.bird.index]!;
    const at = b.cached.indexOf(cp.food);
    row[cp.bird.index] = { ...b, cached: b.cached.filter((_, i) => i !== at) };
    pl = { ...pl, board: { ...pl.board, [cp.bird.habitat]: row } };
  }
  // Pay food (track nectar spent for Oceania scoring — including cached nectar).
  const nectarPaid =
    action.foodPayments.filter((f) => f === 'nectar').length +
    cachedPayments.filter((cp) => cp.food === 'nectar').length;
  pl = spendFood(pl, action.foodPayments);
  if (nectarPaid > 0) {
    pl = {
      ...pl,
      nectarSpent: { ...pl.nectarSpent, [action.habitat]: pl.nectarSpent[action.habitat] + nectarPaid },
    };
  }
  // Play the bird (paid cards tuck behind it; sideways birds cover +1 slot).
  const paidSet = new Set(cardPayments);
  const newRow = [
    ...pl.board[action.habitat],
    { cardId: action.cardId, eggs: 0, tucked: [...cardPayments], cached: [] },
  ];
  if (coversTwo) {
    newRow.push({ cardId: action.cardId, eggs: 0, tucked: [], cached: [], ghost: true });
  }
  pl = {
    ...pl,
    hand: pl.hand.filter((id) => id !== action.cardId && !paidSet.has(id)),
    board: { ...pl.board, [action.habitat]: newRow },
    cubesOnPlayBird: pl.cubesOnPlayBird + 1,
    // The placeholder egg is discarded when a bird is played on its slot —
    // whether or not it counted toward the egg cost (a 0-cost slot wastes it).
    horneroEggs: pl.horneroEggs.filter((h) => h !== action.habitat),
  };
  s = setPlayer(s, pl);

  const ref: BirdRef = { habitat: action.habitat, index: slot };
  // Duet mode: a duet token is placed for every bird played — before the
  // bird's when-played power runs. European "counts double" birds place 2.
  if (isDuet(s)) {
    const paidFoods = [
      ...action.foodPayments,
      ...cachedPayments.map((cp) => cp.food),
    ];
    for (let i = 0; i < (isGoalDouble(card) ? 2 : 1); i++) {
      s = pushPending(s, {
        kind: 'chooseDuetSpace',
        playerId: action.playerId,
        cardId: card.id,
        habitat: action.habitat,
        foods: paidFoods,
      });
    }
  }
  // When-played powers (white banner).
  if (card.powerColor === 'white' && card.powerText) {
    s = runPower(s, action.playerId, ref);
  }
  if (cardPayments.length > 0) {
    s = firePinkTriggers(s, action.playerId, { kind: 'tuck' });
    s = firePinkTriggers(s, action.playerId, { kind: 'predatorSuccess' });
  }
  s = firePinkTriggers(s, action.playerId, { kind: 'playBird', habitat: action.habitat, cardId: action.cardId });
  return s;
}

/** European predators played "on top of another bird": no costs are paid,
 *  the covered bird's eggs/cached food are discarded, and it (plus anything
 *  already tucked under it) becomes tucked cards under the new bird. */
function playOnTop(
  state: GameState,
  action: PlayBirdAction,
  card: BirdCard,
): GameState {
  const ref = action.coverBird!;
  if (!isCoverBird(card)) throw new Error('this bird cannot be played on top of another');
  if (!card.habitats.includes(ref.habitat)) {
    throw new Error(`this bird can't live in the ${ref.habitat}`);
  }
  const target = birdAt(state, action.playerId, ref);
  if (target.ghost) throw new Error('that space is covered');
  let s = spendCube(state, action.playerId, 'playBird');
  let pl = getPlayer(s, action.playerId);
  const row = [...pl.board[ref.habitat]];
  row[ref.index] = {
    cardId: action.cardId,
    eggs: 0,
    tucked: [...target.tucked, target.cardId],
    cached: [],
  };
  if (row[ref.index + 1]?.ghost) {
    row.splice(ref.index + 1, 1);
  }
  pl = {
    ...pl,
    hand: pl.hand.filter((id) => id !== action.cardId),
    board: { ...pl.board, [ref.habitat]: row },
    cubesOnPlayBird: pl.cubesOnPlayBird + 1,
  };
  s = setPlayer(s, pl);
  // Duet mode: a cover play still counts as playing a bird (no food was spent).
  if (isDuet(s)) {
    s = pushPending(s, {
      kind: 'chooseDuetSpace',
      playerId: action.playerId,
      cardId: card.id,
      habitat: ref.habitat,
      foods: [],
    });
  }
  // Counts as a tuck and a predator succeeding; the covered slot still counts
  // as playing a bird in that habitat for pink triggers.
  s = firePinkTriggers(s, action.playerId, { kind: 'tuck' });
  s = firePinkTriggers(s, action.playerId, { kind: 'predatorSuccess' });
  s = firePinkTriggers(s, action.playerId, { kind: 'playBird', habitat: ref.habitat, cardId: action.cardId });
  return s;
}

// === gain food ===

function allSameFace(dice: DieFace[]): boolean {
  return dice.length > 0 && dice.every((d) => d === dice[0]);
}

export function gainFood(state: GameState, action: GainFoodAction): GameState {
  requireTurn(state, action.playerId);
  const p = getPlayer(state, action.playerId);
  const oceania = isOceania(state);
  const slot = actionSlot(p, 'forest', oceania);
  let diceToTake = (oceania ? OCEANIA_FOREST_DICE[slot]! : FOREST_DICE[slot]!);
  if (action.bonusTradeCardId != null) {
    const tradeSlots = oceania ? OCEANIA_FOREST_TRADE_SLOTS : TRADE_SLOTS;
    if (!tradeSlots.includes(slot)) throw new Error('this slot has no trade');
    if (!p.hand.includes(action.bonusTradeCardId)) throw new Error('card not in hand');
    diceToTake += 1;
  }
  if (action.rerollCost != null) {
    // Oceania mat: pay any 1 food to reset the birdfeeder before gaining.
    if (!oceania || !OCEANIA_FOREST_RESET_SLOTS.includes(slot)) {
      throw new Error('this slot has no reset option');
    }
    if (p.food[action.rerollCost] <= 0) throw new Error(`you don't have ${action.rerollCost}`);
  }
  let s = spendCube(state, action.playerId, 'forest');
  if (action.bonusTradeCardId != null) {
    const pl = getPlayer(s, action.playerId);
    s = {
      ...setPlayer(s, { ...pl, hand: pl.hand.filter((id) => id !== action.bonusTradeCardId) }),
      discard: [...s.discard, action.bonusTradeCardId],
    };
    s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', cardId: action.bonusTradeCardId });
  }
  if (action.reroll) {
    // Free reroll: checked against the feeder as the player saw it — before
    // any paid mat reset — so a reroll flag can't roll fresh dice.
    if (!allSameFace(s.feederIn)) throw new Error('can only reroll when all dice show the same face');
    s = feederReset(s, action.playerId);
  }
  if (action.rerollCost != null) {
    const pl = getPlayer(s, action.playerId);
    s = setPlayer(s, spendNectarAware(pl, action.rerollCost, 'forest'));
    s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', food: action.rerollCost });
    s = feederReset(s, action.playerId);
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
  return rowHumAction(startActivation(s, action.playerId, 'forest'), action.playerId, 'forest');
}

/** Spend one food of `food` from `p`; nectar also goes to the spent-nectar
 *  space of `habitat` for Oceania end-game scoring. */
function spendNectarAware(
  p: ReturnType<typeof getPlayer>,
  food: FoodType,
  habitat: Habitat,
): ReturnType<typeof getPlayer> {
  const out = spendFood(p, [food]);
  if (food !== 'nectar') return out;
  return { ...out, nectarSpent: { ...out.nectarSpent, [habitat]: out.nectarSpent[habitat] + 1 } };
}

// === lay eggs ===

export function layEggs(state: GameState, action: LayEggsAction): GameState {
  requireTurn(state, action.playerId);
  const p = getPlayer(state, action.playerId);
  const oceania = isOceania(state);
  const slot = actionSlot(p, 'grassland', oceania);
  let eggs = oceania ? OCEANIA_GRASSLAND_EGGS[slot]! : GRASSLAND_EGGS[slot]!;
  if (action.tradeFood != null) {
    if (oceania) throw new Error('use extraTrades on the oceania mat');
    if (!TRADE_SLOTS.includes(slot)) throw new Error('this slot has no trade');
    if (p.food[action.tradeFood] <= 0) throw new Error(`you don't have ${action.tradeFood}`);
    eggs += 1;
  }
  const extraTrades = action.extraTrades ?? [];
  if (extraTrades.length > 0) {
    if (!oceania) throw new Error('extra trades need the oceania mat');
    if (!OCEANIA_EGG_TRADE_SLOTS.includes(slot)) throw new Error('this slot has no trade');
    const maxTrades = slot === OCEANIA_EGG_DOUBLE_TRADE_SLOT ? 2 : 1;
    if (extraTrades.length > maxTrades) throw new Error(`at most ${maxTrades} trade(s) here`);
    for (const t of extraTrades) {
      if ('card' in t) {
        if (!p.hand.includes(t.card)) throw new Error('card not in hand');
      } else if (p.food[t.food] <= 0) {
        throw new Error(`you don't have ${t.food}`);
      }
    }
    eggs += extraTrades.length;
  }
  if (action.placements.length > eggs) throw new Error(`only ${eggs} eggs to place`);
  // Validate targets up-front against remaining room.
  const planned = new Map<string, number>();
  for (const ref of action.placements) {
    const key = `${ref.habitat}:${ref.index}`;
    planned.set(key, (planned.get(key) ?? 0) + 1);
    const b = birdAt(state, action.playerId, ref);
    if (b.ghost) throw new Error('that space is covered');
    if (!canHoldEggs(b.cardId)) throw new Error('that bird cannot hold eggs');
    const used = planned.get(key)!;
    if (b.eggs + used > bird(b.cardId).eggLimit) throw new Error('over the egg limit');
  }
  let s = spendCube(state, action.playerId, 'grassland');
  if (action.tradeFood != null) {
    s = setPlayer(s, spendFood(getPlayer(s, action.playerId), [action.tradeFood]));
    s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', food: action.tradeFood });
  }
  for (const t of extraTrades) {
    let pl = getPlayer(s, action.playerId);
    if ('card' in t) {
      s = {
        ...setPlayer(s, { ...pl, hand: pl.hand.filter((id) => id !== t.card) }),
        discard: [...s.discard, t.card],
      };
      s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', cardId: t.card });
    } else {
      s = setPlayer(s, spendNectarAware(pl, t.food, 'grassland'));
      s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', food: t.food });
    }
  }
  for (const ref of action.placements) {
    s = setPlayer(s, addEggs(getPlayer(s, action.playerId), ref, 1));
  }
  s = firePinkTriggers(s, action.playerId, { kind: 'layEggs' });
  return rowHumAction(startActivation(s, action.playerId, 'grassland'), action.playerId, 'grassland');
}

// === draw cards ===

export function drawCards(state: GameState, action: DrawCardsAction): GameState {
  requireTurn(state, action.playerId);
  const p = getPlayer(state, action.playerId);
  const oceania = isOceania(state);
  const slot = actionSlot(p, 'wetland', oceania);
  let count = oceania ? OCEANIA_WETLAND_CARDS[slot]! : WETLAND_CARDS[slot]!;
  const trades = (action.tradeEgg ? 1 : 0) + (action.tradeNectar ? 1 : 0);
  if (trades > 1) throw new Error('only one card trade per action');
  if (action.tradeEgg) {
    const tradeSlots = oceania ? OCEANIA_CARD_TRADE_SLOTS : TRADE_SLOTS;
    if (!tradeSlots.includes(slot)) throw new Error('this slot has no trade');
    const b = birdAt(state, action.playerId, action.tradeEgg);
    if (b.ghost) throw new Error('that space is covered');
    if (b.eggs <= 0) throw new Error('that bird has no eggs');
    count += 1;
  }
  if (action.tradeNectar) {
    if (!oceania || !OCEANIA_CARD_TRADE_SLOTS.includes(slot)) throw new Error('this slot has no trade');
    if (p.food.nectar <= 0) throw new Error("you don't have nectar");
    count += 1;
  }
  if (action.resetTrayCost != null) {
    // Oceania mat: pay any 1 food to discard + refill the tray first.
    if (!oceania || !OCEANIA_WETLAND_RESET_SLOTS.includes(slot)) {
      throw new Error('this slot has no reset option');
    }
    if (p.food[action.resetTrayCost] <= 0) throw new Error(`you don't have ${action.resetTrayCost}`);
  }
  if (action.picks.length !== count) throw new Error(`draw ${count} cards`);
  for (const pick of action.picks) {
    if (pick !== 'deck' && (pick < 0 || pick > 2 || state.tray[pick] == null)) {
      throw new Error('that tray slot is empty');
    }
  }
  let s = spendCube(state, action.playerId, 'wetland');
  if (action.resetTrayCost != null) {
    const pl = getPlayer(s, action.playerId);
    s = setPlayer(s, spendNectarAware(pl, action.resetTrayCost, 'wetland'));
    s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', food: action.resetTrayCost });
    // Reset: discard all face-up cards, then refill from the deck.
    s = {
      ...s,
      discard: [...s.discard, ...s.tray.filter((id): id is number => id != null)],
      tray: [null, null, null],
    };
    s = refillTray(s);
    // Re-validate tray picks against the new tray.
    for (const pick of action.picks) {
      if (pick !== 'deck' && s.tray[pick] == null) throw new Error('that tray slot is empty');
    }
  }
  if (action.tradeEgg) {
    const pl = getPlayer(s, action.playerId);
    const row = [...pl.board[action.tradeEgg.habitat]];
    row[action.tradeEgg.index] = { ...row[action.tradeEgg.index]!, eggs: row[action.tradeEgg.index]!.eggs - 1 };
    s = setPlayer(s, { ...pl, board: { ...pl.board, [action.tradeEgg.habitat]: row } });
    s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', egg: true });
  }
  if (action.tradeNectar) {
    const pl = getPlayer(s, action.playerId);
    s = setPlayer(s, spendNectarAware(pl, 'nectar', 'wetland'));
    s = firePinkTriggers(s, action.playerId, { kind: 'actionUpgrade', food: 'nectar' });
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
  // Americas pink: "when another player takes the draw-cards action".
  s = firePinkTriggers(s, action.playerId, { kind: 'drawCards' });
  return rowHumAction(startActivation(s, action.playerId, 'wetland'), action.playerId, 'wetland');
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
  return activationDone(s, playerId);
}

export function skipPower(state: GameState, playerId: PlayerId, all: boolean): GameState {
  if (actingPlayerId(state) !== playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  const act = state.activation;
  if (!act) return state;
  const remaining = all ? [] : act.remaining.slice(1);
  const s: GameState = { ...state, activation: remaining.length ? { ...act, remaining } : null };
  return activationDone(s, playerId);
}

// === end turn ===

export function endTurn(state: GameState, playerId: PlayerId): GameState {
  if (state.phase !== 'main') throw new Error('not the main phase');
  if (actingPlayerId(state) !== playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  if (state.activation) throw new Error('finish activating powers first');
  const p = getPlayer(state, playerId);
  // End-of-turn discard powers trigger first. The pending step's
  // continuation re-enters this function to finish the turn. When the hand
  // is empty there is nothing to discard — clear the flag inline (a 0-count
  // pending step would be dropped without running its continuation).
  if (p.endOfTurnDiscards > 0) {
    if (p.hand.length > 0) {
      return pushPending(state, {
        kind: 'chooseHandDiscard',
        playerId,
        count: Math.min(p.endOfTurnDiscards, p.hand.length),
        then: { effect: 'endTurnDiscardsDone' },
      });
    }
    state = setPlayer(state, { ...p, endOfTurnDiscards: 0 });
  }
  let s = refillTray(state);
  // Americas: empty hummingbird-garden slots refill at the end of each turn.
  if (isAmericas(s)) s = refillHumGarden(s);
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

/** Called by the pending resolver when the queued end-of-turn discard is
 *  done: clear the flag, then finish the interrupted endTurn (tray/garden
 *  refill, player advancement, pink-flag reset). */
export function finishEndOfTurnDiscards(state: GameState, playerId: PlayerId): GameState {
  const p = getPlayer(state, playerId);
  const s = setPlayer(state, { ...p, endOfTurnDiscards: 0 });
  return endTurn(s, playerId);
}

// === duet reset token ===

/** Duet mode: remove a token from the reset space to reset the birdfeeder or
 *  the tray. Usable at any time on the player's turn. */
export function duetReset(state: GameState, action: DuetResetAction): GameState {
  if (!state.duet) throw new Error('not a duet game');
  if (state.phase !== 'main') throw new Error('not the main phase');
  if (actingPlayerId(state) !== action.playerId) throw new Error('not your turn');
  if (state.pending.length > 0) throw new Error('resolve the pending choice first');
  const at = state.duet.reset.indexOf(action.playerId);
  if (at < 0) throw new Error('you have no token on the reset space');
  const reset = state.duet.reset.filter((_, i) => i !== at);
  let s: GameState = { ...state, duet: { ...state.duet, reset } };
  if (action.target === 'feeder') {
    s = feederReset(s, action.playerId);
  } else {
    s = {
      ...s,
      discard: [...s.discard, ...s.tray.filter((id): id is number => id != null)],
      tray: [null, null, null],
    };
    s = refillTray(s);
  }
  return s;
}

// === automa solo turn ===

function drawAutomaFaceDown(state: GameState): { s: GameState; drawnId: number | null } {
  let deck = state.deck;
  let discard = state.discard;
  let rngState = state.rngState;
  if (deck.length === 0 && discard.length > 0) {
    [deck, rngState] = shuffle(rngState, discard);
    discard = [];
  }
  let drawnId: number | null = null;
  if (deck.length > 0) {
    drawnId = deck[deck.length - 1]!;
    deck = deck.slice(0, -1);
  }
  return {
    s: {
      ...state,
      deck,
      discard,
      rngState,
      automa: {
        ...state.automa!,
        faceDownBirds: state.automa!.faceDownBirds + 1,
      },
    },
    drawnId,
  };
}

export function automaTurn(state: GameState, playerId: PlayerId): GameState {
  if (!state.automa || !isAutoma(state, playerId)) {
    throw new Error('not an automa player');
  }
  requireTurn(state, playerId);
  const p = getPlayer(state, playerId);
  let s: GameState = setPlayer(state, { ...p, actionCubes: p.actionCubes - 1 });

  let automaDeck = s.automa!.deck.slice();
  let automaDiscard = s.automa!.discard.slice();
  let rng = s.rngState;
  if (automaDeck.length === 0 && automaDiscard.length > 0) {
    [automaDeck, rng] = shuffle(rng, automaDiscard);
    automaDiscard = [];
  }
  const cardId = automaDeck.pop()!;
  automaDiscard.push(cardId);
  s = {
    ...s,
    rngState: rng,
    automa: {
      ...s.automa!,
      deck: automaDeck,
      discard: automaDiscard,
      lastCardId: cardId,
    },
  };

  const card = automaCard(cardId);
  const section = card.rounds[Math.max(0, Math.min(3, s.round))]!;

  for (const act of section) {
    switch (act.kind) {
      case 'drawCards': {
        const trayCards = s.tray.filter((id): id is number => id != null);
        s = {
          ...s,
          discard: [...s.discard, ...trayCards],
          tray: [null, null, null],
        };
        s = drawAutomaFaceDown(s).s;
        break;
      }
      case 'gainFood': {
        if (s.feederIn.length === 0 || allSameFace(s.feederIn)) {
          s = refillFeeder(s);
        }
        const oceania = isOceania(s);
        for (const want of act.order) {
          const effFace: DieFace = oceania && want === 'split' ? 'nectar' : want;
          if (!s.feederIn.includes(effFace)) continue;
          const removed = s.feederIn.filter((f) => f === effFace);
          const remaining = s.feederIn.filter((f) => f !== effFace);
          s = {
            ...s,
            feederIn: remaining,
            feederOut: [...s.feederOut, ...removed],
          };
          if (oceania && effFace === 'nectar') {
            const hab = HABITATS[s.round % 3]!;
            const nextNectar = {
              ...s.automa!.nectarSpent,
              [hab]: s.automa!.nectarSpent[hab] + removed.length,
            };
            const pl = getPlayer(s, playerId);
            s = {
              ...setPlayer(s, {
                ...pl,
                nectarSpent: {
                  ...pl.nectarSpent,
                  [hab]: pl.nectarSpent[hab] + removed.length,
                },
              }),
              automa: {
                ...s.automa!,
                nectarSpent: nextNectar,
              },
            };
          }
          if (s.feederIn.length === 0) {
            s = refillFeeder(s);
          }
          break;
        }
        break;
      }
      case 'playBird': {
        const { keep, discard, matchedIndices } = selectAutomaTrayBirds(
          s.tray,
          s.automa!.bonusCardId,
          s.automa!.difficulty,
        );
        let duetCardId: number | null = null;
        if (keep.length > 0) {
          const nextTray = s.tray.map((id, i) => (matchedIndices.includes(i) ? null : id));
          s = {
            ...s,
            tray: nextTray,
            discard: [...s.discard, ...discard],
            automa: {
              ...s.automa!,
              faceUpBirds: [...s.automa!.faceUpBirds, ...keep],
            },
          };
          duetCardId = keep[0]!;
        } else {
          const r = drawAutomaFaceDown(s);
          s = r.s;
          duetCardId = r.drawnId;
        }
        if (isDuet(s)) {
          s = placeAutomaDuetToken(s, duetCardId);
        }
        if (isAmericas(s)) {
          s = advanceAutomaHummingbird(s);
        }
        break;
      }
      case 'layEggs': {
        s = {
          ...s,
          automa: {
            ...s.automa!,
            eggs: s.automa!.eggs + act.count,
          },
        };
        break;
      }
      case 'placeGoalCube': {
        s = {
          ...s,
          automa: {
            ...s.automa!,
            goalCubes: s.automa!.goalCubes + 1,
          },
        };
        break;
      }
      case 'removeGoalCube': {
        s = {
          ...s,
          automa: {
            ...s.automa!,
            goalCubes: Math.max(0, s.automa!.goalCubes - 1),
          },
        };
        break;
      }
      case 'activatePink': {
        s = fireAllPinkPowersForAutoma(s, playerId);
        break;
      }
    }
  }

  s = refillTray(s);
  if (isAmericas(s)) s = refillHumGarden(s);

  let next = s.currentPlayerIndex;
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

// === round / game end ===

/** Turn order starting at the first-player marker (used to sequence the
 *  round-end teal and game-end yellow power queues). */
function turnOrderFromFirst(state: GameState): PlayerId[] {
  return state.playerOrder.map(
    (_, i) => state.playerOrder[(state.firstPlayerIndex + i) % state.playerOrder.length]!,
  );
}

function endRound(state: GameState): GameState {
  // End-of-round order (EE reference tile): 1. round-end (teal) bird powers,
  // 2. score the end-of-round goal, 3. remove action cubes, 4. discard and
  // replace the tray cards, 5. rotate the first-player marker. The teal
  // powers therefore run BEFORE goal scoring — they can change it.
  const tealQueue: { playerId: PlayerId; bird: BirdRef }[] = [];
  for (const pid of turnOrderFromFirst(state)) {
    const p = getPlayer(state, pid);
    for (const h of HABITATS) {
      p.board[h].forEach((b, index) => {
        if (b.ghost) return;
        const c = bird(b.cardId);
        if (c.powerColor === 'teal' && c.powerText && hasPowerImpl(c.id)) {
          tealQueue.push({ playerId: pid, bird: { habitat: h, index } });
        }
      });
    }
  }
  return { ...state, phase: 'roundEnd', roundEndQueue: tealQueue };
}

/** Called by settle() once the roundEnd queue has drained: score the goal,
 *  restock the tray, reset cubes, rotate the first player, and continue to
 *  the next round — or begin game end after round 4. */
export function finishRound(state: GameState): GameState {
  let s = state;
  // Oceania: unused nectar in each player's supply is discarded after the
  // round-end (teal) powers and before the goal is scored. Nectar already
  // spent or cached on birds is not affected.
  if (isOceania(s)) {
    s = {
      ...s,
      players: s.players.map((pl) => ({ ...pl, food: { ...pl.food, nectar: 0 } })),
    };
  }
  // Score this round's goal tile.
  const tile = s.goalTiles[s.round];
  if (tile != null) {
    if (goalTile(tile)?.goal.kind === 'noGoal') {
      // Oceania "no goal" (or Daurian Jackdaw): no goal is scored this round,
      // and players keep their cube (following rounds have +1 turn).
      const goalScores = [...s.goalScores];
      goalScores[s.round] = new Array<number>(s.playerOrder.length).fill(0);
      s = {
        ...s,
        goalScores,
        firstPlayerIndex: isDuet(s) ? 1 - s.firstPlayerIndex : s.firstPlayerIndex,
      };
    } else if (isDuet(s)) {
      // Duet board: the winner takes the round's points, ties are friendly
      // (both score). The loser takes the first-player token; on a tie it
      // passes to the player who did not hold it this round.
      const pts = DUET_GOAL_POINTS[s.round] ?? DUET_GOAL_POINTS[3]!;
      const lower = DUET_LOWER_IS_BETTER.has(tile);
      const units = s.playerOrder.map((pid) => goalScore(s, pid, tile));
      // "You must have at least 1 of the targeted items to score points for
      // a goal" — a 0-unit player can't win, even on a 'fewest' tile.
      const qualified = units.filter((u) => u > 0);
      const best =
        qualified.length === 0
          ? null
          : lower
            ? Math.min(...qualified)
            : Math.max(...qualified);
      const scores = units.map((u) => (best != null && u === best ? pts : 0));
      const goalScores = [...s.goalScores];
      goalScores[s.round] = scores;
      const winnerIdxs = units
        .map((u, i) => (u === best ? i : -1))
        .filter((i) => i >= 0);
      const nextFirst =
        winnerIdxs.length === 1 ? 1 - winnerIdxs[0]! : 1 - s.firstPlayerIndex;
      s = { ...s, goalScores, firstPlayerIndex: nextFirst };
    } else if (isFlock(s)) {
      // Flock goal board: 1st-5th ranks with friendly ties — tied players
      // share the full rank value and the next rank is still awarded.
      const table = FLOCK_GOAL_POINTS[s.round] ?? FLOCK_GOAL_POINTS[3]!;
      const units = s.playerOrder.map((pid) => goalScore(s, pid, tile));
      const humPointsGoal = goalTile(tile)?.goal.kind === 'humPoints';
      const qualifies = (pid: PlayerId, u: number) =>
        humPointsGoal ? HUM_GROUPS.some((g) => getPlayer(s, pid).humTrack[g] > 0) : u > 0;
      const values = [
        ...new Set(s.playerOrder.map((_, i) => units[i]!).filter((u, i) => qualifies(s.playerOrder[i]!, u))),
      ].sort((a, b) => b - a);
      const scores = units.map((u, i) =>
        qualifies(s.playerOrder[i]!, u) ? (table[values.indexOf(u)] ?? 0) : 0,
      );
      const goalScores = [...s.goalScores];
      goalScores[s.round] = scores;
      s = { ...s, goalScores };
    } else if (s.settings.goalSide === 'blue') {
      // Blue side: 1 point per targeted item, up to a maximum of 5 points.
      const scores = s.playerOrder.map((pid) =>
        Math.max(0, Math.min(5, goalScore(s, pid, tile))),
      );
      const goalScores = [...s.goalScores];
      goalScores[s.round] = scores;
      s = { ...s, goalScores };
    } else {
      const points = GOAL_POINTS[s.round] ?? GOAL_POINTS[3]!;
      const units = s.playerOrder.map((pid) => goalScore(s, pid, tile));
      // Ranks with tie-split (floor of summed rank points). Players with 0
      // units place their cube on the 0 space — they don't rank. Per Americas
      // p.8, players with negative or zero Hummingbird Points are still
      // eligible to score as long as they've moved up the track at least once.
      const humPointsGoal = goalTile(tile)?.goal.kind === 'humPoints';
      const order = s.playerOrder
        .map((pid, i) => ({ pid, units: units[i]! }))
        .filter((x) =>
          humPointsGoal && !isAutoma(s, x.pid)
            ? HUM_GROUPS.some((g) => getPlayer(s, x.pid).humTrack[g] > 0)
            : x.units > 0,
        )
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
  }
  // Discard the face-up tray cards and restock from the deck.
  s = {
    ...s,
    discard: [...s.discard, ...s.tray.filter((id): id is number => id != null)],
    tray: [null, null, null],
  };
  s = refillTray(s);
  // Americas: the hummingbird garden is wiped and restocked each round.
  if (isAmericas(s)) {
    s = {
      ...s,
      humDiscard: [...s.humDiscard, ...s.humGarden.flat()],
      humGarden: s.humGarden.map(() => []),
    };
    s = refillHumGarden(s);
  }

  const nextRound = s.round + 1;
  if (s.automa) {
    // Automa round-end adjustment: reset goal cubes, remove the card marked
    // "Remove after round N" (round + 1), and reshuffle the Automa deck.
    const completedRound = s.round + 1;
    const remainingAutoma = [...s.automa.deck, ...s.automa.discard].filter(
      (id) => automaCard(id).removeAfterRound !== completedRound,
    );
    let nextAutomaDeck = remainingAutoma;
    let rng = s.rngState;
    if (nextRound < 4) {
      [nextAutomaDeck, rng] = shuffle(rng, remainingAutoma);
    }
    s = {
      ...s,
      rngState: rng,
      firstPlayerIndex: 0,
      automa: {
        ...s.automa,
        deck: nextAutomaDeck,
        discard: [],
        goalCubes: 0,
      },
    };
  }
  if (nextRound < 4) {
    // First player of the new round: Automa games always keep the human player
    // first ("You always go first"); duet gives the token to the round-goal
    // loser; other modes pass it clockwise.
    const nextFirst = s.automa
      ? 0
      : isDuet(s)
        ? s.firstPlayerIndex
        : (s.firstPlayerIndex + 1) % s.playerOrder.length;
    // Oceania "no goal": each completed round with "no goal" lets players
    // keep their action cube, granting +1 turn in all following rounds.
    const keptCubes = s.goalTiles
      .slice(0, nextRound)
      .filter((id) => id != null && goalTile(id)?.goal.kind === 'noGoal').length;
    s = {
      ...s,
      round: nextRound,
      currentPlayerIndex: nextFirst,
      firstPlayerIndex: nextFirst,
      turnTookAction: false,
      phase: 'main',
      players: s.players.map((pl) => ({
        ...pl,
        actionCubes: CUBES_PER_ROUND[nextRound]! + keptCubes,
        roundCubes: { forest: 0, grassland: 0, wetland: 0, playBird: 0 },
        cubesOnPlayBird: 0,
        gainedThisTurn: [],
      })),
    };
    s = resetPinkFlags(s, s.playerOrder[s.currentPlayerIndex]!);
    return s;
  }
  return beginGameEnd({ ...s, round: nextRound });
}

export function beginGameEnd(state: GameState): GameState {
  // Queue every yellow-powered bird, in turn order from the first-player
  // marker then board order.
  const queue: { playerId: PlayerId; bird: BirdRef }[] = [];
  for (const pid of turnOrderFromFirst(state)) {
    const p = getPlayer(state, pid);
    for (const h of HABITATS) {
      p.board[h].forEach((b, index) => {
        if (b.ghost) return;
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
