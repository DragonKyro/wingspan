// Handlers for the four turn actions, setup, activation and end-turn.
// Every handler validates the action fully; invalid actions throw.

import { bird, goalTile } from './cards';
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
  columnEggCost,
  getPlayer,
  isAmericas,
  isCardCostBird,
  isCoverBird,
  isDuet,
  isFlock,
  isGoalDouble,
  isOceania,
  isSideways,
  nextSlot,
  payFoodPlan,
  rowFull,
  spendFood,
} from './helpers';
import { DUET_GOAL_POINTS, DUET_LOWER_IS_BETTER, FLOCK_GOAL_POINTS } from './duetMap';
import { goalScore } from './scoring';
import {
  drawFromDeck,
  feederReset,
  firePinkTriggers,
  hasPowerImpl,
  pushPending,
  queueRowHumAction,
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
  if (action.coverBird) return playOnTop(state, action, card);
  if (!card.habitats.includes(action.habitat)) throw new Error(`this bird can't live in the ${action.habitat}`);
  if (rowFull(p, action.habitat)) throw new Error('row is full');
  const slot = nextSlot(p, action.habitat);
  // European sideways birds cover a second space when two are free (the
  // power can be forgone; a single free space also means a normal play).
  const coversTwo = isSideways(card) && action.coverTwo !== false && slot <= 3;
  // "Pay the lower egg cost": the lower of the two covered columns' costs —
  // column costs are non-decreasing, so that is the left covered slot's cost.
  const eggCost = columnEggCost(slot);
  // Americas: a Rufous Hornero placeholder egg on this slot discounts the cost.
  const horneroDiscount = p.horneroEggs.includes(action.habitat) && eggCost > 0;
  const effEggCost = eggCost - (horneroDiscount ? 1 : 0);
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
  }
  if (action.rerollCost != null) {
    const pl = getPlayer(s, action.playerId);
    s = setPlayer(s, spendNectarAware(pl, action.rerollCost, 'forest'));
    s = feederReset(s, action.playerId);
  }
  if (action.reroll) {
    if (!allSameFace(s.feederIn)) throw new Error('can only reroll when all dice show the same face');
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
  }
  for (const t of extraTrades) {
    let pl = getPlayer(s, action.playerId);
    if ('card' in t) {
      s = {
        ...setPlayer(s, { ...pl, hand: pl.hand.filter((id) => id !== t.card) }),
        discard: [...s.discard, t.card],
      };
    } else {
      s = setPlayer(s, spendNectarAware(pl, t.food, 'grassland'));
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
  }
  if (action.tradeNectar) {
    const pl = getPlayer(s, action.playerId);
    s = setPlayer(s, spendNectarAware(pl, 'nectar', 'wetland'));
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
  // End-of-turn discard powers trigger first. When the hand is empty there
  // is nothing to discard — clear the flag inline (a 0-count pending step
  // would be dropped without running its continuation).
  if (p.endOfTurnDiscards > 0 && p.hand.length > 0) {
    return pushPending(state, {
      kind: 'chooseHandDiscard',
      playerId,
      count: Math.min(p.endOfTurnDiscards, p.hand.length),
      then: { effect: 'endTurnDiscardsDone' },
    });
  }
  let s = refillTray(state);
  // Americas: empty hummingbird-garden slots refill at the end of each turn.
  if (isAmericas(s)) s = refillHumGarden(s);
  if (p.endOfTurnDiscards > 0) s = finishEndOfTurnDiscards(s, playerId);
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

// === round / game end ===

function endRound(state: GameState): GameState {
  // End-of-round order (EE reference tile): 1. round-end (teal) bird powers,
  // 2. score the end-of-round goal, 3. remove action cubes, 4. discard and
  // replace the tray cards, 5. rotate the first-player marker. The teal
  // powers therefore run BEFORE goal scoring — they can change it.
  const tealQueue: { playerId: PlayerId; bird: BirdRef }[] = [];
  for (const pid of state.playerOrder) {
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
  // Score this round's goal tile (green side: ranked).
  const tile = s.goalTiles[s.round];
  if (tile != null) {
    if (isDuet(s)) {
      // Duet board: the winner takes the round's points, ties are friendly
      // (both score). The loser takes the first-player token; on a tie it
      // passes to the player who did not hold it this round.
      const pts = DUET_GOAL_POINTS[s.round] ?? DUET_GOAL_POINTS[3]!;
      const lower = DUET_LOWER_IS_BETTER.has(tile);
      const units = s.playerOrder.map((pid) => goalScore(s, pid, tile));
      const best = lower ? Math.min(...units) : Math.max(...units);
      const scores = units.map((u) => (u === best ? pts : 0));
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
      const values = [...new Set(units.filter((u) => u > 0))].sort((a, b) => b - a);
      const scores = units.map((u) => (u > 0 ? (table[values.indexOf(u)] ?? 0) : 0));
      const goalScores = [...s.goalScores];
      goalScores[s.round] = scores;
      s = { ...s, goalScores };
    } else {
      const points = GOAL_POINTS[s.round] ?? GOAL_POINTS[3]!;
      const units = s.playerOrder.map((pid) => goalScore(s, pid, tile));
      // Ranks with tie-split (floor of summed rank points). Players with 0
      // units place their cube on the 0 space — they don't rank. The americas
      // hummingbird-points goal can be negative, and a negative total is a
      // real count (everyone has a track total), so it still ranks.
      const humPointsGoal = goalTile(tile)?.goal.kind === 'humPoints';
      const order = s.playerOrder
        .map((pid, i) => ({ pid, units: units[i]! }))
        .filter((x) => (humPointsGoal ? x.units !== 0 : x.units > 0))
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
  if (nextRound < 4) {
    // First player of the new round: duet gives the token to the round-goal
    // loser (set during goal scoring); other modes pass it clockwise.
    const nextFirst = isDuet(s)
      ? s.firstPlayerIndex
      : (s.firstPlayerIndex + 1) % s.playerOrder.length;
    s = {
      ...s,
      round: nextRound,
      currentPlayerIndex: nextFirst,
      firstPlayerIndex: nextFirst,
      turnTookAction: false,
      phase: 'main',
      players: s.players.map((pl) => ({
        ...pl,
        actionCubes: CUBES_PER_ROUND[nextRound]!,
        roundCubes: { forest: 0, grassland: 0, wetland: 0, playBird: 0 },
        gainedThisTurn: [],
      })),
    };
    s = resetPinkFlags(s, s.playerOrder[s.currentPlayerIndex]!);
    return s;
  }
  return beginGameEnd({ ...s, round: nextRound });
}

export function beginGameEnd(state: GameState): GameState {
  // Queue every yellow-powered bird, in player order then board order.
  const queue: { playerId: PlayerId; bird: BirdRef }[] = [];
  for (const pid of state.playerOrder) {
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
