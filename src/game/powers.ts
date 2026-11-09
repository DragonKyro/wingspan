// Bird power implementations, keyed by exact power text (so expansion cards
// with identical wording share one implementation). A power runs against the
// acting player's state and may push PendingSteps for choices.

import { BIRD_BY_ID, bird } from './cards';
import { rollBirdfeeder, shuffle } from './rng';
import {
  addEggs,
  addFood,
  appendLog,
  getPlayer,
  playedBirds,
} from './helpers';
import type {
  BirdRef,
  DieFace,
  FoodType,
  GameState,
  PendingStep,
  PlayerId,
  PlayerState,
} from './types';
import { BASE_DIE_FACES, FOOD_TYPES, HABITATS } from './types';

// === low-level state writers ===

export function setPlayer(state: GameState, p: PlayerState): GameState {
  return { ...state, players: state.players.map((x) => (x.id === p.id ? p : x)) };
}

export function pushPending(state: GameState, ...steps: PendingStep[]): GameState {
  return { ...state, pending: [...state.pending, ...steps] };
}

/** Draw `n` cards from the deck into the player's hand, reshuffling the
 *  discard pile (with rng) into a new deck when the deck runs out. */
export function drawFromDeck(state: GameState, playerId: PlayerId, n: number): GameState {
  let p = getPlayer(state, playerId);
  let deck = state.deck;
  let rng = state.rngState;
  let discard = state.discard;
  for (let i = 0; i < n; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      [deck, rng] = shuffle(rng, discard);
      discard = [];
    }
    const id = deck[deck.length - 1]!;
    deck = deck.slice(0, -1);
    p = { ...p, hand: [...p.hand, id] };
  }
  return { ...setPlayer({ ...state, deck, discard, rngState: rng }, p), deck, discard, rngState: rng };
}

/** Take the tray card at `idx` into hand (slot stays empty until turn end). */
export function takeTrayCard(state: GameState, playerId: PlayerId, idx: number): GameState {
  const id = state.tray[idx];
  if (id == null) throw new Error('tray slot is empty');
  const p = getPlayer(state, playerId);
  const tray = [...state.tray];
  tray[idx] = null;
  return { ...state, tray, players: state.players.map((x) => (x.id === playerId ? { ...p, hand: [...p.hand, id] } : x)) };
}

/** Refill empty tray slots from the deck (start/end-of-turn maintenance). */
export function refillTray(state: GameState): GameState {
  let { deck, discard, rngState } = state;
  const tray = state.tray.map((t) => {
    if (t != null) return t;
    if (deck.length === 0 && discard.length > 0) {
      [deck, rngState] = shuffle(rngState, discard);
      discard = [];
    }
    if (deck.length === 0) return null;
    const id = deck[deck.length - 1]!;
    deck = deck.slice(0, -1);
    return id;
  });
  return { ...state, tray, deck, discard, rngState };
}

/** Take dice out of the feeder. If it empties, all 5 go back in (rerolled). */
export function takeDieFromFeeder(
  state: GameState,
  playerId: PlayerId,
  dieIndex: number,
  take: FoodType | undefined,
): GameState {
  const face = state.feederIn[dieIndex];
  if (face == null) throw new Error('no such die');
  let food: FoodType;
  if (face === 'split') {
    if (take !== 'invertebrate' && take !== 'seed') throw new Error('split die needs a choice');
    food = take;
  } else {
    food = face;
  }
  const inDice = state.feederIn.filter((_, i) => i !== dieIndex);
  const outDice = [...state.feederOut, face];
  let s: GameState = {
    ...state,
    feederIn: inDice,
    feederOut: outDice,
    players: state.players.map((x) => (x.id === playerId ? addFood(x, food) : x)),
  };
  if (s.feederIn.length === 0) s = refillFeeder(s);
  return s;
}

/** Throw all 5 dice back in (reroll). Dice outside the tower return too. */
export function refillFeeder(state: GameState): GameState {
  const faces = state.settings.sets.includes('oceania')
    ? (['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'nectar'] as DieFace[])
    : [...BASE_DIE_FACES];
  const [rolled, rng] = rollBirdfeeder(state.rngState, faces, 5);
  return { ...state, feederIn: rolled, feederOut: [], rngState: rng };
}

/** Cache `food` on the bird at `ref`. */
export function cacheOnBird(state: GameState, playerId: PlayerId, ref: BirdRef, food: FoodType): GameState {
  const p = getPlayer(state, playerId);
  const row = [...p.board[ref.habitat]];
  const b = row[ref.index]!;
  row[ref.index] = { ...b, cached: [...b.cached, food] };
  return setPlayer(state, { ...p, board: { ...p.board, [ref.habitat]: row } });
}

/** Tuck `cardId` behind the bird at `ref` (from hand — caller removes it first). */
export function tuckCardOnBird(state: GameState, playerId: PlayerId, ref: BirdRef, cardId: number): GameState {
  const p = getPlayer(state, playerId);
  const row = [...p.board[ref.habitat]];
  const b = row[ref.index]!;
  row[ref.index] = { ...b, tucked: [...b.tucked, cardId] };
  return setPlayer(state, { ...p, board: { ...p.board, [ref.habitat]: row } });
}

// === power building blocks ===

type PowerFn = (state: GameState, playerId: PlayerId, ref: BirdRef) => GameState;

/** Queue picking `count` dice from the feeder; `faces` restricts which die faces qualify. */
function gainDice(count: number, opts: { faces?: DieFace[]; cache?: boolean } = {}): PowerFn {
  return (state, playerId, ref) => {
    const available = state.feederIn.filter((f) => {
      if (!opts.faces) return true;
      return opts.faces.some((w) => faceCovers(f, w));
    });
    if (available.length === 0) return appendLog(state, `${playerId}: no matching die in feeder`);
    const step: PendingStep = {
      kind: 'pickDie',
      playerId,
      count: Math.min(count, available.length),
      faces: opts.faces,
      then: opts.cache ? { effect: 'gainThenCache', bird: ref } : undefined,
    };
    return pushPending(state, step);
  };
}

/** Does die face `f` offer food `want`? split covers inv/seed; 'nectar' only nectar. */
export function faceCovers(f: DieFace, want: DieFace | FoodType): boolean {
  if (f === want) return true;
  if (f === 'split') return want === 'invertebrate' || want === 'seed';
  return false;
}

/** Supply gain with no choice needed (single food type, straight to supply). */
function gainSupplyAuto(food: FoodType, count: number): PowerFn {
  return (state, playerId) => {
    const p = getPlayer(state, playerId);
    return setPlayer(state, addFood(p, food, count));
  };
}

/** Auto: lay `count` eggs on the power's own bird (cap respected). */
function layEggsSelf(count: number): PowerFn {
  return (state, playerId, ref) => {
    const p = getPlayer(state, playerId);
    return setPlayer(state, addEggs(p, ref, count));
  };
}

/** Auto: lay 1 egg on each owned bird whose nest matches (own bird too). */
function layEggsEachNest(nest: 'bowl' | 'cavity' | 'ground' | 'platform' | 'wild'): PowerFn {
  return (state, playerId) => {
    let s = state;
    let p = getPlayer(s, playerId);
    for (const { ref, bird: b } of playedBirds(p)) {
      const card = BIRD_BY_ID.get(b.cardId)!;
      if ((card.nest === nest || card.nest === 'wild') && b.eggs < card.eggLimit) {
        p = addEggs(p, ref, 1);
        s = setPlayer(s, p);
      }
    }
    return s;
  };
}

/** Discard `count` eggs from other birds, then supply-gain. */
function discardEggsFor(count: number, gainWild: number): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseBirdForEggDiscard',
      playerId,
      count,
      exclude: ref,
      then: { effect: 'supplyWild', n: [gainWild] },
    });
}

/** Tuck from hand behind own bird; on success run the follow-up step. */
function tuckHandThen(then: PendingStep['then']): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, { kind: 'chooseHandTuck', playerId, bird: ref, optional: true, then });
}

/** Pay `food` to tuck `count` deck cards behind own bird. */
function discardFoodToTuckDeck(food: FoodType, count: number): PowerFn {
  return (state, playerId, ref) => {
    const p = getPlayer(state, playerId);
    if (p.food[food] <= 0) return appendLog(state, `${playerId}: no ${food} to discard`);
    let s = setPlayer(state, { ...p, food: { ...p.food, [food]: p.food[food] - 1 } });
    for (let i = 0; i < count; i++) {
      if (s.deck.length === 0) break;
      const id = s.deck[s.deck.length - 1]!;
      s = { ...s, deck: s.deck.slice(0, -1) };
      s = tuckCardOnBird(s, playerId, ref, id);
    }
    return s;
  };
}

/** Look at top deck card: tuck if wingspan < max, else discard (predator).
 *  Deterministic on the card's wingspan — no player choice. On a tuck the
 *  predator succeeded (other players' pink powers may trigger). */
function lookTuck(maxWingspan: number): PowerFn {
  return (state, playerId, ref) => {
    let s = state;
    if (s.deck.length === 0 && s.discard.length > 0) {
      const [deck, rng] = shuffle(s.rngState, s.discard);
      s = { ...s, deck, discard: [], rngState: rng };
    }
    if (s.deck.length === 0) return s;
    const id = s.deck[s.deck.length - 1]!;
    s = { ...s, deck: s.deck.slice(0, -1) };
    const success = bird(id).wingspan < maxWingspan;
    if (success) {
      s = tuckCardOnBird(s, playerId, ref, id);
      s = firePinkTriggers(s, playerId, { kind: 'predatorSuccess' });
    } else {
      s = { ...s, discard: [...s.discard, id] };
    }
    return appendLog(s, `${playerId}: predator ${success ? 'succeeded' : 'failed'} (${bird(id).name})`);
  };
}

/** Reroll dice outside the feeder; cache `want` from supply when one shows. */
function rollOutDice(want: FoodType): PowerFn {
  return (state, playerId, ref) => {
    if (state.feederOut.length === 0) return appendLog(state, `${playerId}: no dice outside feeder`);
    const [rolled, rng] = rollBirdfeeder(state.rngState, BASE_DIE_FACES, state.feederOut.length);
    let s: GameState = { ...state, feederOut: rolled, rngState: rng };
    const hit = rolled.some((f) => faceCovers(f, want));
    if (hit) {
      s = cacheOnBird(s, playerId, ref, want);
      s = firePinkTriggers(s, playerId, { kind: 'predatorSuccess' });
    }
    return appendLog(s, `${playerId}: predator roll ${hit ? 'succeeded' : 'failed'}`);
  };
}

/** Every player gains `food` from supply. */
function allGainSupply(food: FoodType): PowerFn {
  return (state) => ({
    ...state,
    players: state.players.map((p) => addFood(p, food)),
  });
}

/** Every player draws `count` cards from the deck. */
function allDraw(count: number): PowerFn {
  return (state) => {
    let s = state;
    for (const p of state.players) s = drawFromDeck(s, p.id, count);
    return s;
  };
}

/** Players tied for fewest birds in `habitat` each draw `count` cards. */
function fewestInHabitatDraw(habitat: 'forest' | 'grassland' | 'wetland'): PowerFn {
  return (state) => {
    const min = Math.min(...state.players.map((p) => p.board[habitat].length));
    let s = state;
    for (const p of state.players) {
      if (p.board[habitat].length === min) s = drawFromDeck(s, p.id, 1);
    }
    return s;
  };
}

/** Players tied for fewest birds in `habitat` each pick a die from the feeder. */
function fewestInHabitatGainDie(habitat: 'forest' | 'grassland' | 'wetland'): PowerFn {
  return (state) => {
    const min = Math.min(...state.players.map((p) => p.board[habitat].length));
    let s = state;
    for (const p of state.players) {
      if (p.board[habitat].length === min && s.feederIn.length > 0) {
        s = pushPending(s, { kind: 'pickDie', playerId: p.id, count: 1, then: { effect: 'feederGain' } });
      }
    }
    return s;
  };
}

/** Each player picks a die in order starting with a chosen player. */
function eachPlayerDie(): PowerFn {
  return (state, playerId) =>
    pushPending(state, {
      kind: 'chooseFirstPlayer',
      playerId,
      effect: 'gainDie',
      then: { effect: 'eachPlayerDie' },
    });
}

/** All players lay an egg on a nest-filtered bird; actor may lay 1 extra. */
function allLayEggNest(nest: 'bowl' | 'cavity' | 'ground' | 'platform'): PowerFn {
  return (state, playerId) => {
    let s = state;
    for (const p of state.players) {
      const count = p.id === playerId ? 2 : 1;
      s = pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId: p.id,
        count,
        nest,
      });
    }
    return s;
  };
}

/** Tuck a hand card behind own bird + optional extra effect. */
function tuckHand(then: PendingStep['then']): PowerFn {
  return tuckHandThen(then);
}

/** Draw `count` bonus cards, keep `keep`. */
function drawBonus(count: number, keep: number): PowerFn {
  return (state, playerId) => {
    let s = state;
    const drawn: number[] = [];
    for (let i = 0; i < count && s.bonusDeck.length > 0; i++) {
      drawn.push(s.bonusDeck[s.bonusDeck.length - 1]!);
      s = { ...s, bonusDeck: s.bonusDeck.slice(0, -1) };
    }
    const p = getPlayer(s, playerId);
    s = setPlayer(s, { ...p, bonusHand: [...p.bonusHand, ...drawn] });
    const discard = drawn.length - keep;
    if (discard <= 0) return s;
    return pushPending(s, { kind: 'discardBonusCards', playerId, count: discard });
  };
}

/** Draw `count` cards then flag an end-of-turn hand discard of `discards`. */
function drawThenEndDiscard(count: number, discards: number): PowerFn {
  return (state, playerId) => {
    let s = drawFromDeck(state, playerId, count);
    const p = getPlayer(s, playerId);
    return setPlayer(s, { ...p, endOfTurnDiscards: p.endOfTurnDiscards + discards });
  };
}

/** Repeat a brown (or predator) power in this habitat — target chosen via pending. */
function repeatPower(predatorOnly = false): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseRepeatPower',
      playerId,
      habitat: ref.habitat,
      predatorOnly,
      then: { effect: 'repeatPower', bird: ref },
    });
}

/** Rightmost bird may move to another habitat. */
function moveRightmost(): PowerFn {
  return (state, playerId, ref) => {
    const p = getPlayer(state, playerId);
    const row = p.board[ref.habitat];
    if (ref.index !== row.length - 1) return appendLog(state, `${playerId}: not rightmost`);
    if (row.length === 0) return state;
    // Eligible habitats = the other habitats this bird may live in, with room.
    const card = bird(row[ref.index]!.cardId);
    const options = card.habitats.filter((h) => h !== ref.habitat && p.board[h].length < 5);
    if (options.length === 0) return appendLog(state, `${playerId}: nowhere to move`);
    return pushPending(state, {
      kind: 'moveBirdHabitat',
      playerId,
      bird: ref,
    });
  };
}

/** Play an additional bird in the given habitat (normal cost). */
function playAdditional(habitat: 'forest' | 'grassland' | 'wetland' | 'same'): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseAdditionalPlay',
      playerId,
      habitat: habitat === 'same' ? ref.habitat : habitat,
      sourceBird: ref,
      optional: true,
    });
}

/** Trade 1 food (any) for 1 food of choice from supply. */
function tradeWild(): PowerFn {
  return (state, playerId) =>
    pushPending(state, { kind: 'chooseWildTrade', playerId, from: 'any' });
}

/** Draw N cards where N = players+1; each player picks 1 clockwise; actor keeps the rest. */
function oystercatcher(): PowerFn {
  return (state, playerId) => {
    const n = state.players.length + 1;
    const drawn: number[] = [];
    let s = state;
    for (let i = 0; i < n && s.deck.length > 0; i++) {
      drawn.push(s.deck[s.deck.length - 1]!);
      s = { ...s, deck: s.deck.slice(0, -1) };
    }
    // Queue picks: actor first, then clockwise through players. The
    // 'oystercatcher' tag in the resolver shrinks the pool and queues the
    // next player's pick; the actor keeps the leftover card.
    const order: PlayerId[] = [];
    const startIdx = state.playerOrder.indexOf(playerId);
    for (let i = 0; i < state.players.length; i++) {
      order.push(state.playerOrder[(startIdx + i) % state.playerOrder.length]!);
    }
    return pushPending(s, {
      kind: 'chooseDrawnCard',
      playerId: order[0]!,
      cardIds: drawn,
      then: { effect: 'oystercatcher', ids: drawn, n: [1] },
    });
  };
}

// === the power registry ===

const whenSupplyGain = (food: FoodType, n = 1) => gainSupplyAuto(food, n);
const whenFeederGain = (faces: DieFace[], n = 1, cache = false) => gainDice(n, { faces, cache });
const whenFeederAny = (n = 1) => gainDice(n, {});

/** text → implementation. Covers every distinct core-set power text. */
export const POWER_IMPLS: Record<string, PowerFn> = {
  // --- gain food ---
  'Gain 1 [die] from the birdfeeder.': whenFeederAny(),
  'Gain 1 [invertebrate] from the birdfeeder, if available.': whenFeederGain(['invertebrate']),
  'Gain 1 [invertebrate] or [fruit] from the birdfeeder, if available.': whenFeederGain(['invertebrate', 'fruit']),
  'Gain 1 [seed] or [fruit] from the birdfeeder, if available.': whenFeederGain(['seed', 'fruit']),
  'Gain 1 [seed] from the birdfeeder, if available. You may cache it on this bird.': whenFeederGain(['seed'], 1, true),
  'Gain all [fish] that are in the birdfeeder.': (s, pid) => takeAllMatching(s, pid, 'fish'),
  'Gain all [invertebrate] that are in the birdfeeder.': (s, pid) => takeAllMatching(s, pid, 'invertebrate'),
  'Each player gains 1 [die] from the birdfeeder, starting with the player of your choice.': eachPlayerDie(),
  'Gain 1 [invertebrate] from the supply.': whenSupplyGain('invertebrate'),
  'Gain 1 [fruit] from the supply.': whenSupplyGain('fruit'),
  'Gain 1 [seed] from the supply.': whenSupplyGain('seed'),
  'Gain 3 [seed] from the supply.': whenSupplyGain('seed', 3),
  'Gain 3 [fish] from the supply.': whenSupplyGain('fish', 3),
  'All players gain 1 [invertebrate] from the supply.': allGainSupply('invertebrate'),
  'All players gain 1 [seed] from the supply.': allGainSupply('seed'),
  'All players gain 1 [fish] from the supply.': allGainSupply('fish'),
  'All players gain 1 [fruit] from the supply.': allGainSupply('fruit'),
  'Player(s) with the fewest birds in their [forest] gain 1 [die] from birdfeeder.': fewestInHabitatGainDie('forest'),
  'Player(s) with the fewest birds in their [wetland] draw 1 [card].': fewestInHabitatDraw('wetland'),
  'Roll all dice not in birdfeeder. If any are [rodent], cache 1 [rodent] from the supply on this bird.': rollOutDice('rodent'),
  'Roll all dice not in birdfeeder. If any are [fish], cache 1 [fish] from the supply on this bird.': rollOutDice('fish'),
  'Cache 1 [seed] from the supply on this bird.': (s, pid, ref) => cacheOnBird(s, pid, ref, 'seed'),
  'Trade 1 [wild] for any other type from the supply.': tradeWild(),

  // --- eggs ---
  'Lay 1 [egg] on this bird.': layEggsSelf(1),
  'Lay 1 [egg] on any bird.': (s, pid) => pushPending(s, { kind: 'chooseBirdForEgg', playerId: pid, count: 1, nest: 'any' }),
  'Lay 1 [egg] on each of your birds with a [bowl] nest.': layEggsEachNest('bowl'),
  'Lay 1 [egg] on each of your birds with a [cavity] nest.': layEggsEachNest('cavity'),
  'Lay 1 [egg] on each of your birds with a [ground] nest.': layEggsEachNest('ground'),
  'Lay 1 [egg] on each of your birds with a [platform] nest.': layEggsEachNest('platform'),
  'All players lay 1 [egg] on any 1 [bowl] bird. You may lay 1 [egg] on 1 additional [bowl] bird.': allLayEggNest('bowl'),
  'All players lay 1 [egg] on any 1 [cavity] bird. You may lay 1 [egg] on 1 additional [cavity] bird.': allLayEggNest('cavity'),
  'All players lay 1 [egg] on any 1 [ground] bird. You may lay 1 [egg] on 1 additional [ground] bird.': allLayEggNest('ground'),
  'Discard 1 [egg] from any of your other birds to gain 1 [wild] from the supply.': discardEggsFor(1, 1),
  'Discard 1 [egg] from any of your other birds to gain 2 [wild] from the supply.': discardEggsFor(1, 2),
  'Discard 1 [egg] to draw 2 [card].': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseBirdForEggDiscard',
      playerId: pid,
      count: 1,
      exclude: ref,
      then: { effect: 'drawCards', n: [2] },
    }),

  // --- tuck / draw ---
  'Tuck 1 [card] from your hand behind this bird. If you do, draw 1 [card].': tuckHand({ effect: 'drawCards', n: [1] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [fruit] from the supply.': tuckHand({ effect: 'supplyFood', ids: [2] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [seed] from the supply.': tuckHand({ effect: 'supplyFood', ids: [3] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [invertebrate] from the supply.': tuckHand({ effect: 'supplyFood', ids: [0] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [invertebrate] or [seed] from the supply.': tuckHand({ effect: 'supplyFoodChoice', ids: [0, 3] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, you may also lay 1 [egg] on this bird.': tuckHand({ effect: 'selfEgg' }),
  'Tuck 1 [card] from your hand behind this bird. If you do, lay 1 [egg] on any bird.': tuckHand({ effect: 'anyEgg' }),
  'Discard 1 [fish] to tuck 2 [card] from the deck behind this bird.': discardFoodToTuckDeck('fish', 2),
  'Discard 1 [seed] to tuck 2 [card] from the deck behind this bird.': discardFoodToTuckDeck('seed', 2),
  'Look at a [card] from the deck. If less than 50cm, tuck it behind this bird. If not, discard it.': lookTuck(50),
  'Look at a [card] from the deck. If less than 75cm, tuck it behind this bird. If not, discard it.': lookTuck(75),
  'Look at a [card] from the deck. If less than 100cm, tuck it behind this bird. If not, discard it.': lookTuck(100),
  'Draw 1 [card].': (s, pid) => drawFromDeck(s, pid, 1),
  'Draw 2 [card].': (s, pid) => drawFromDeck(s, pid, 2),
  'Draw the 3 face-up [card] in the bird tray.': (s, pid) => {
    let out = s;
    for (let i = 0; i < 3; i++) if (out.tray[i] != null) out = takeTrayCard(out, pid, i);
    return out;
  },
  'Draw 1 [card]. If you do, discard 1 [card] from your hand at the end of your turn.': drawThenEndDiscard(1, 1),
  'Draw 2 [card]. If you do, discard 1 [card] from your hand at the end of your turn.': drawThenEndDiscard(2, 1),
  'All players draw 1 [card] from the deck.': allDraw(1),
  'Draw 2 new bonus cards and keep 1.': drawBonus(2, 1),
  'Draw [card] equal to the number of players +1. Starting with you and proceeding clockwise, each player selects 1 of those cards and places it in their hand. You keep the extra card.': oystercatcher(),

  // --- play / repeat / move ---
  'Play an additional bird in your [forest]. Pay its normal cost.': playAdditional('forest'),
  'Play an additional bird in your [grassland]. Pay its normal cost.': playAdditional('grassland'),
  'Play an additional bird in your [wetland]. Pay its normal cost.': playAdditional('wetland'),
  "Play an additional bird in this bird's habitat. Pay its normal cost.": playAdditional('same'),
  'Repeat a brown power on another bird in this habitat.': repeatPower(false),
  'Repeat 1 [predator] power in this habitat.': repeatPower(true),
  'If this bird is to the right of all other birds in its habitat, move it to another habitat.': moveRightmost(),
};

// === pink powers (once between turns) ===

export type PinkTrigger =
  | { kind: 'layEggs' }
  | { kind: 'gainFood'; food: FoodType }
  | { kind: 'playBird'; habitat: 'forest' | 'grassland' | 'wetland' }
  | { kind: 'predatorSuccess' }
  | { kind: 'tuck' };

interface PinkDef {
  trigger: PinkTrigger;
  fn: (state: GameState, owner: PlayerId, ref: BirdRef, ctx: { actor: PlayerId }) => GameState;
}

export const PINK_IMPLS: Record<string, PinkDef> = {
  'When another player takes the “lay eggs” action, lay 1 [egg] on another bird with a [ground] nest.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner, ref) => pushPending(s, { kind: 'chooseBirdForEgg', playerId: owner, count: 1, nest: 'ground', exclude: ref }),
  },
  'When another player takes the “lay eggs” action, lay 1 [egg] on another bird with a [cavity] nest.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner, ref) => pushPending(s, { kind: 'chooseBirdForEgg', playerId: owner, count: 1, nest: 'cavity', exclude: ref }),
  },
  'When another player takes the “lay eggs” action, lay 1 [egg] on a bird with a [bowl] nest.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner) => pushPending(s, { kind: 'chooseBirdForEgg', playerId: owner, count: 1, nest: 'bowl' }),
  },
  'When another player takes the “gain food” action, if they gain any number of [rodent], cache 1 [rodent] from the supply on this bird.': {
    trigger: { kind: 'gainFood', food: 'rodent' },
    fn: (s, owner, ref) => cacheOnBird(s, owner, ref, 'rodent'),
  },
  'When another player plays a bird in their [wetland], gain 1 [fish] from the supply.': {
    trigger: { kind: 'playBird', habitat: 'wetland' },
    fn: (s, owner) => {
      const p = getPlayer(s, owner);
      return setPlayer(s, addFood(p, 'fish'));
    },
  },
  'When another player plays a bird in their [forest], gain 1 [invertebrate] from the supply.': {
    trigger: { kind: 'playBird', habitat: 'forest' },
    fn: (s, owner) => {
      const p = getPlayer(s, owner);
      return setPlayer(s, addFood(p, 'invertebrate'));
    },
  },
  'When another player plays a bird in their [grassland], tuck 1 [card] from your hand behind this bird.': {
    trigger: { kind: 'playBird', habitat: 'grassland' },
    fn: (s, owner, ref) =>
      pushPending(s, { kind: 'chooseHandTuck', playerId: owner, bird: ref, optional: true }),
  },
  "When another player's [predator] succeeds, gain 1 [die] from the birdfeeder.": {
    trigger: { kind: 'predatorSuccess' },
    fn: (s, owner, ref) => gainDice(1, {})(s, owner, ref),
  },
};

// === helpers used by the registries ===

function takeAllMatching(state: GameState, playerId: PlayerId, want: FoodType): GameState {
  let s = state;
  // Cap at 10 takes: an all-matching refill would otherwise loop forever.
  for (let taken = 0; taken < 10 && s.feederIn.length > 0; taken++) {
    const idx = s.feederIn.findIndex((f) => faceCovers(f, want));
    if (idx < 0) break;
    s = takeDieFromFeeder(s, playerId, idx, want === 'invertebrate' || want === 'seed' ? want : undefined);
  }
  return s;
}

/** Does the bird's power have an implementation? */
export function hasPowerImpl(cardId: number): boolean {
  const c = BIRD_BY_ID.get(cardId);
  if (!c?.powerText) return false;
  if (c.powerColor === 'pink') return PINK_IMPLS[c.powerText] != null;
  return POWER_IMPLS[c.powerText] != null;
}

const warned = new Set<string>();
/** Run a brown/white/teal power. Unknown texts warn once and no-op. */
export function runPower(state: GameState, playerId: PlayerId, ref: BirdRef): GameState {
  const p = getPlayer(state, playerId);
  const b = p.board[ref.habitat]?.[ref.index];
  if (!b) return state;
  const card = bird(b.cardId);
  if (!card.powerText) return state;
  const fn = POWER_IMPLS[card.powerText];
  if (!fn) {
    if (!warned.has(card.powerText)) {
      warned.add(card.powerText);
      console.warn(`[powers] no implementation for "${card.powerText}" (${card.name})`);
    }
    return appendLog(state, `${playerId}: ${card.name}'s power is not implemented`);
  }
  return fn(state, playerId, ref);
}

/** The pink trigger for a card, if it has one. */
export function pinkTriggerFor(cardId: number): PinkDef | null {
  const c = BIRD_BY_ID.get(cardId);
  if (!c || c.powerColor !== 'pink' || !c.powerText) return null;
  return PINK_IMPLS[c.powerText] ?? null;
}

/** Fire the pink powers of everyone but `actor` that match `trigger`.
 *  Each eligible bird fires at most once between its owner's turns. */
export function firePinkTriggers(
  state: GameState,
  actor: PlayerId,
  trigger: PinkTrigger,
): GameState {
  let s = state;
  for (const p of s.players) {
    if (p.id === actor) continue;
    for (const { ref, bird: b } of playedBirds(p)) {
      if (b.pinkUsed) continue;
      const card = BIRD_BY_ID.get(b.cardId);
      if (!card || card.powerColor !== 'pink' || !card.powerText) continue;
      const def = PINK_IMPLS[card.powerText];
      if (!def || def.trigger.kind !== trigger.kind) continue;
      if (trigger.kind === 'gainFood' && 'food' in trigger && def.trigger.kind === 'gainFood' && def.trigger.food !== trigger.food) continue;
      if (trigger.kind === 'playBird' && 'habitat' in trigger && def.trigger.kind === 'playBird' && def.trigger.habitat !== trigger.habitat) continue;
      // Mark used before running (the power might chain pending steps).
      const cur = getPlayer(s, p.id);
      const row = [...cur.board[ref.habitat]];
      row[ref.index] = { ...b, pinkUsed: true };
      s = setPlayer(s, { ...cur, board: { ...cur.board, [ref.habitat]: row } });
      s = def.fn(s, p.id, ref, { actor });
    }
  }
  return s;
}

/** Reset pink-power availability for `playerId` (at the start of their turn). */
export function resetPinkFlags(state: GameState, playerId: PlayerId): GameState {
  const p = getPlayer(state, playerId);
  const board = { ...p.board };
  let changed = false;
  for (const h of HABITATS) {
    board[h] = p.board[h].map((b) => {
      if (!b.pinkUsed) return b;
      changed = true;
      return { ...b, pinkUsed: false };
    });
  }
  return changed ? setPlayer(state, { ...p, board }) : state;
}

export { FOOD_TYPES };
