// Bird power implementations, keyed by exact power text (so expansion cards
// with identical wording share one implementation). A power runs against the
// acting player's state and may push PendingSteps for choices.

import { BIRD_BY_ID, bird } from './cards';
import { FEEDER_SIZE } from './constants';
import { rollBirdfeeder, shuffle } from './rng';
import {
  addEggs,
  addFood,
  appendLog,
  eggsInHabitat,
  getPlayer,
  playedBirds,
  playerToLeft,
  playerToRight,
  recordFoodGain,
  sameRef,
  spendFood,
  totalEggs,
  wingspanOf,
} from './helpers';
import type {
  BirdCard,
  BirdRef,
  DieFace,
  FoodType,
  GameState,
  Habitat,
  NestType,
  PendingStep,
  PendingTag,
  PlayerId,
  PlayerState,
} from './types';
import { BASE_DIE_FACES, FOOD_TYPES, HABITATS, NEST_TYPES } from './types';

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
    players: state.players.map((x) =>
      x.id === playerId
        ? {
            ...recordFoodGain(addFood(x, food), food),
            feederGainedThisTurn: [...x.feederGainedThisTurn, food],
          }
        : x,
    ),
  };
  if (s.feederIn.length === 0) s = refillFeeder(s);
  // Oceania pink: "when another player gains nectar" watches all nectar gains.
  if (food === 'nectar') s = firePinkTriggers(s, playerId, { kind: 'gainNectar' });
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

/** Gain `n` of `food` from the supply into `playerId`'s supply — the single
 *  entry point for supply gains (records the gain and fires the Oceania
 *  "another player gains nectar" pink watch when `food` is nectar). */
export function grantSupplyFood(
  state: GameState,
  playerId: PlayerId,
  food: FoodType,
  n = 1,
): GameState {
  let p = getPlayer(state, playerId);
  p = addFood(p, food, n);
  for (let i = 0; i < n; i++) p = recordFoodGain(p, food);
  let s = setPlayer(state, p);
  if (food === 'nectar' && n > 0) s = firePinkTriggers(s, playerId, { kind: 'gainNectar' });
  return s;
}

/** Cache `food` on the bird at `ref` (counts as "gained" for the player's turn tracker). */
export function cacheOnBird(state: GameState, playerId: PlayerId, ref: BirdRef, food: FoodType): GameState {
  const p = getPlayer(state, playerId);
  const row = [...p.board[ref.habitat]];
  const b = row[ref.index]!;
  row[ref.index] = {
    ...b,
    cached: [...b.cached, food],
    cachedGainedThisTurn: (b.cachedGainedThisTurn ?? 0) + 1,
  };
  return setPlayer(state, recordFoodGain({ ...p, board: { ...p.board, [ref.habitat]: row } }, food));
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
    let p = getPlayer(state, playerId);
    p = addFood(p, food, count);
    for (let i = 0; i < count; i++) p = recordFoodGain(p, food);
    return setPlayer(state, p);
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
    let tucked = 0;
    for (let i = 0; i < count; i++) {
      if (s.deck.length === 0) break;
      const id = s.deck[s.deck.length - 1]!;
      s = { ...s, deck: s.deck.slice(0, -1) };
      s = tuckCardOnBird(s, playerId, ref, id);
      tucked++;
    }
    if (tucked > 0) s = firePinkTriggers(s, playerId, { kind: 'tuck' });
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
      s = firePinkTriggers(s, playerId, { kind: 'tuck' });
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
  return (state) => {
    let s = state;
    for (const pid of s.playerOrder) s = grantSupplyFood(s, pid, food);
    return s;
  };
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
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseWildTrade',
      playerId,
      from: 'any',
      spentHabitat: ref.habitat,
    });
}

// === european expansion building blocks ===

/** Reset the feeder, then let the player pick `count` dice of `faces` from it. */
function resetThenGain(faces: DieFace[] | undefined, count = 1): PowerFn {
  return (state, playerId, ref) => {
    const s = appendLog(refillFeeder(state), `${playerId}: reset the birdfeeder`);
    return gainDice(count, { faces })(s, playerId, ref);
  };
}

/** Draw `n` cards off the deck into a limbo pool (not the hand) for a
 *  choose-and-keep power. Returns the drawn ids and the updated state. */
export function drawToPool(state: GameState, n: number): { s: GameState; ids: number[] } {
  let s = state;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0) {
      if (s.discard.length === 0) break;
      const [deck, rng] = shuffle(s.rngState, s.discard);
      s = { ...s, deck, discard: [], rngState: rng };
    }
    ids.push(s.deck[s.deck.length - 1]!);
    s = { ...s, deck: s.deck.slice(0, -1) };
  }
  return { s, ids };
}

/** Tuck the top `n` deck cards behind `ref` (reshuffling discards as needed). */
export function tuckFromDeck(state: GameState, playerId: PlayerId, ref: BirdRef, n: number): GameState {
  let s = state;
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0) {
      if (s.discard.length === 0) break;
      const [deck, rng] = shuffle(s.rngState, s.discard);
      s = { ...s, deck, discard: [], rngState: rng };
    }
    const id = s.deck[s.deck.length - 1]!;
    s = { ...s, deck: s.deck.slice(0, -1) };
    s = tuckCardOnBird(s, playerId, ref, id);
  }
  return s;
}

/** European steals: pick another player, take `food` from their supply
 *  ('any' = chooser's pick). `cache` sends it to this bird, otherwise it goes
 *  to the chooser's supply. The victim gains 1 die from the feeder. */
function stealFood(food: FoodType | 'any', cache: boolean): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'choosePlayer',
      playerId,
      other: true,
      then: {
        effect: 'stealResolve',
        ids: [food === 'any' ? -1 : FOOD_TYPES.indexOf(food)],
        bird: cache ? ref : undefined,
      },
    });
}

/** Choose `min`..`max` own birds (optionally in one habitat) for a follow-up. */
function chooseOwnBirds(
  min: number,
  max: number,
  habitat: Habitat | undefined,
  then: PendingTag,
): PowerFn {
  return (state, playerId) =>
    pushPending(state, { kind: 'chooseBirds', playerId, min, max, habitat, then });
}

/** "Draw 1 new bonus card" — kept — then run the queued second effect. */
function drawBonusCardThen(...next: PendingStep[]): PowerFn {
  return (state, playerId) => {
    let s = state;
    if (s.bonusDeck.length > 0) {
      const id = s.bonusDeck[s.bonusDeck.length - 1]!;
      s = { ...s, bonusDeck: s.bonusDeck.slice(0, -1) };
      const p = getPlayer(s, playerId);
      s = setPlayer(s, { ...p, bonusHand: [...p.bonusHand, id] });
      s = appendLog(s, `${playerId}: drew a new bonus card`);
    }
    return pushPending(s, ...next);
  };
}

/** Optional discard of an egg (any bird) → play another bird in `habitat`. */
function discardEggToPlay(habitat: Habitat): PowerFn {
  return (state, playerId) =>
    pushPending(state, {
      kind: 'chooseBirdForEggDiscard',
      playerId,
      count: 1,
      optional: true,
      then: { effect: 'playAdditional', ids: [HABITATS.indexOf(habitat)] },
    });
}

/** Roll the dice outside the feeder; lay an egg / cache per hit. */
function rollOutDiceEuropean(
  want: FoodType,
  perHit: (s: GameState, playerId: PlayerId, ref: BirdRef, hits: number) => GameState,
): PowerFn {
  return (state, playerId, ref) => {
    if (state.feederOut.length === 0) return appendLog(state, `${playerId}: no dice outside feeder`);
    const [rolled, rng] = rollBirdfeeder(state.rngState, BASE_DIE_FACES, state.feederOut.length);
    let s: GameState = { ...state, feederOut: rolled, rngState: rng };
    const hits = rolled.filter((f) => faceCovers(f, want)).length;
    if (hits > 0) {
      s = perHit(s, playerId, ref, hits);
      s = firePinkTriggers(s, playerId, { kind: 'predatorSuccess' });
    }
    return appendLog(s, `${playerId}: roll ${hits > 0 ? 'succeeded' : 'failed'} (${hits}x ${want})`);
  };
}

/** Draw N cards where N = empty slots in the row; keep 1 at end of turn. */
function drawPerEmptySlot(): PowerFn {
  return (state, playerId, ref) => {
    const p = getPlayer(state, playerId);
    const empty = Math.max(0, 5 - p.board[ref.habitat].length);
    if (empty === 0) return appendLog(state, `${playerId}: row is full, no cards drawn`);
    return drawThenEndDiscard(empty, empty - 1)(state, playerId, ref);
  };
}

/** "If you used all 4 types of actions this round, play another bird." */
function playIfAllFourActions(): PowerFn {
  return (state, playerId) => {
    const p = getPlayer(state, playerId);
    const usedAll =
      p.roundCubes.playBird > 0 &&
      p.roundCubes.forest > 0 &&
      p.roundCubes.grassland > 0 &&
      p.roundCubes.wetland > 0;
    if (!usedAll) return appendLog(state, `${playerId}: did not use all 4 action types`);
    return pushPending(state, {
      kind: 'chooseAdditionalPlay',
      playerId,
      habitat: 'any',
      optional: true,
    });
  };
}

/** Queue an optional discard of food from the supply, with a follow-up.
 *  Nectar spent here counts toward the power-bird's habitat row (Oceania). */
function discardFoodFor(options: FoodType[] | 'any', count: number, then: PendingTag): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseFoodDiscard',
      playerId,
      count,
      options,
      optional: true,
      spentHabitat: ref.habitat,
      then,
    });
}

/** "Discard up to `count` [food] from your supply. For each, tuck 1 deck card." */
function discardFoodToTuckUpTo(food: FoodType | 'any', count: number): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseFoodDiscard',
      playerId,
      count,
      options: food === 'any' ? 'any' : [food],
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect: 'tuckDeckPerFood', bird: ref },
    });
}

/** Habitat index for a teal "cubes on their [habitat]" power. */
function cubesThen(habitat: Habitat, effect: string, ref: BirdRef): PowerFn {
  return (state, playerId) =>
    pushPending(state, {
      kind: 'choosePlayer',
      playerId,
      other: true,
      then: { effect, bird: ref, n: [HABITATS.indexOf(habitat)] },
    });
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

// === oceania expansion building blocks ===

/** "Choose 1 other player", then run `effect` with the chosen player as the answer. */
function chooseOther(effect: string, extra: Partial<PendingTag> = {}): PowerFn {
  return (state, playerId) =>
    pushPending(state, {
      kind: 'choosePlayer',
      playerId,
      other: true,
      then: { effect, ...extra } as PendingTag,
    });
}

/** Optional "discard up to `count` food" then an effect keyed to this bird.
 *  Nectar spent counts toward the bird's habitat. */
function discardUpTo(options: FoodType[] | 'any', count: number, effect: string): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseFoodDiscard',
      playerId,
      count,
      options,
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect, bird: ref },
    });
}

/** Tūī / Superb Lyrebird: copy a brown power from a neighbour's forest. */
function copyPower(dir: 'left' | 'right'): PowerFn {
  return (state, playerId, ref) => {
    const target = dir === 'left' ? playerToLeft(state, playerId) : playerToRight(state, playerId);
    if (!target) return appendLog(state, `${playerId}: no player to the ${dir}`);
    return pushPending(state, {
      kind: 'chooseCopyPower',
      playerId,
      target,
      habitat: 'forest',
      then: { effect: 'copyPower', bird: ref },
    });
  };
}

/** "If the player to your left/right has X in supply" conditional powers. */
function neighborHas(
  dirs: ('left' | 'right')[],
  food: FoodType,
  effect: 'gain' | 'cache' | 'tuck',
): PowerFn {
  return (state, playerId, ref) => {
    const has = dirs.some((dir) => {
      const pid = dir === 'left' ? playerToLeft(state, playerId) : playerToRight(state, playerId);
      return pid != null && getPlayer(state, pid).food[food] > 0;
    });
    if (!has) return appendLog(state, `${playerId}: neighbour has no ${food}`);
    let s = state;
    if (effect === 'gain') s = grantSupplyFood(s, playerId, food);
    else if (effect === 'cache') s = cacheOnBird(s, playerId, ref, food);
    else {
      s = tuckFromDeck(s, playerId, ref, 1);
      s = firePinkTriggers(s, playerId, { kind: 'tuck' });
    }
    return s;
  };
}

/** Lay 1 egg on each real bird in a habitat ('same' = the power bird's row). */
function eggsEachIn(habitat: Habitat | 'same'): PowerFn {
  return (state, playerId, ref) => {
    const h = habitat === 'same' ? ref.habitat : habitat;
    let p = getPlayer(state, playerId);
    for (const { ref: r } of playedBirds(p)) {
      if (r.habitat !== h) continue;
      const b = p.board[r.habitat][r.index]!;
      if (b.eggs < bird(b.cardId).eggLimit) p = addEggs(p, r, 1);
    }
    return setPlayer(state, p);
  };
}

/** Lay 1 egg on each own bird matching a wingspan predicate (incl. source). */
function eggsEachWingspan(pred: (w: number) => boolean): PowerFn {
  return (state, playerId) => {
    let p = getPlayer(state, playerId);
    for (const { ref, bird: b } of playedBirds(p)) {
      if (pred(wingspanOf(bird(b.cardId))) && b.eggs < bird(b.cardId).eggLimit) {
        p = addEggs(p, ref, 1);
      }
    }
    return setPlayer(state, p);
  };
}

/** "Draw 1 face-up [card] with [nest] or [star] nest; may reset/refill tray." */
function trayDrawNest(nest: NestType): PowerFn {
  return (state, playerId) =>
    pushPending(state, {
      kind: 'chooseTrayCardEx',
      playerId,
      nests: [nest, 'wild'],
      mayResetTray: true,
      destination: 'hand',
    });
}

/** Oceania "look at the top card" predator: tuck on a matching card, else
 *  discard; on success optionally cache a food on this bird. */
function lookIf(pred: (c: BirdCard) => boolean, cache?: FoodType): PowerFn {
  return (state, playerId, ref) => {
    let s = state;
    if (s.deck.length === 0 && s.discard.length > 0) {
      const [deck, rng] = shuffle(s.rngState, s.discard);
      s = { ...s, deck, discard: [], rngState: rng };
    }
    if (s.deck.length === 0) return s;
    const id = s.deck[s.deck.length - 1]!;
    s = { ...s, deck: s.deck.slice(0, -1) };
    const success = pred(bird(id));
    if (success) {
      s = tuckCardOnBird(s, playerId, ref, id);
      if (cache) s = cacheOnBird(s, playerId, ref, cache);
      s = firePinkTriggers(s, playerId, { kind: 'tuck' });
      s = firePinkTriggers(s, playerId, { kind: 'predatorSuccess' });
    } else {
      s = { ...s, discard: [...s.discard, id] };
    }
    return appendLog(s, `${playerId}: predator ${success ? 'succeeded' : 'failed'} (${bird(id).name})`);
  };
}

/** Does `c`'s food cost show any of `foods`? ('any' costs have no listed food.) */
function costHasFood(c: BirdCard, foods: FoodType[]): boolean {
  if (c.cost.kind === 'and') {
    return c.cost.items.some((i) => i.food !== 'any' && foods.includes(i.food));
  }
  if (c.cost.kind === 'or') return c.cost.foods.some((f) => foods.includes(f));
  return false;
}

/** Count of `food` icons in `c`'s printed food cost (Little Penguin). */
function foodIconsInCost(c: BirdCard, food: FoodType): number {
  if (c.cost.kind === 'and') {
    return c.cost.items.reduce((n, i) => n + (i.food === food ? i.count : 0), 0);
  }
  if (c.cost.kind === 'or') return c.cost.foods.filter((f) => f === food).length;
  return 0;
}

/** "Reset the birdfeeder and gain all X; may cache any or all on this bird." */
function resetGainAllCache(food: FoodType): PowerFn {
  return (state, playerId, ref) => {
    let s = appendLog(refillFeeder(state), `${playerId}: reset the birdfeeder`);
    const before = getPlayer(s, playerId).food[food];
    s = takeAllMatching(s, playerId, food, true);
    const gained = getPlayer(s, playerId).food[food] - before;
    if (gained <= 0) return s;
    return pushPending(s, {
      kind: 'chooseCacheFromSupply',
      playerId,
      bird: ref,
      count: gained,
      food,
      optional: true,
    });
  };
}

/** "Reset the birdfeeder. Gain/cache 1 die of `faces` on this bird." */
function resetCacheDie(faces: DieFace[]): PowerFn {
  return (state, playerId, ref) => {
    let s = appendLog(refillFeeder(state), `${playerId}: reset the birdfeeder`);
    const available = s.feederIn.some((f) => faces.some((w) => faceCovers(f, w)));
    if (!available) return appendLog(s, `${playerId}: no matching die in feeder`);
    return pushPending(s, {
      kind: 'pickDie',
      playerId,
      count: 1,
      faces,
      then: { effect: 'cacheLastGained', bird: ref },
    });
  };
}

/** Tuck 1 deck card behind each real bird in a habitat ('same' = own row). */
function tuckDeckEachIn(habitat: Habitat | 'same'): PowerFn {
  return (state, playerId, ref) => {
    const h = habitat === 'same' ? ref.habitat : habitat;
    const p = getPlayer(state, playerId);
    const refs = playedBirds(p).filter(({ ref: r }) => r.habitat === h).map(({ ref: r }) => r);
    let s = state;
    for (const r of refs) s = tuckFromDeck(s, playerId, r, 1);
    if (refs.length > 0) s = firePinkTriggers(s, playerId, { kind: 'tuck' });
    return s;
  };
}

// === asia expansion building blocks ===

/** Every player gets one queued step (or none), in player order. */
function eachPlayerStep(make: (pid: PlayerId) => PendingStep | null): PowerFn {
  return (state) => {
    let s = state;
    const steps: PendingStep[] = [];
    for (const pid of s.playerOrder) {
      const step = make(pid);
      if (step) steps.push(step);
    }
    return pushPending(s, ...steps);
  };
}

/** All players lay `each` eggs; the power's owner lays `actorExtra` more. */
function allLayEggs(each: number, actorExtra = 0): PowerFn {
  return (state, playerId) => {
    const steps: PendingStep[] = state.playerOrder.map((pid) => ({
      kind: 'chooseBirdForEgg',
      playerId: pid,
      count: each + (pid === playerId ? actorExtra : 0),
      nest: 'any' as const,
    }));
    return pushPending(state, ...steps);
  };
}

/** Roll `n` food dice (respecting the game's die set). Returns faces + state. */
export function rollDice(state: GameState, n: number): { s: GameState; faces: DieFace[] } {
  const faces = state.settings.sets.includes('oceania')
    ? (['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'nectar'] as DieFace[])
    : [...BASE_DIE_FACES];
  const [rolled, rng] = rollBirdfeeder(state.rngState, faces, n);
  return { s: { ...state, rngState: rng }, faces: rolled };
}

/** "Roll N dice; if ≥1 [want] shows, cache 1 [want] on this bird" (predator-style). */
function rollAnyDiceCache(dice: number, want: FoodType, thenEachDiscardCard?: FoodType): PowerFn {
  return (state, playerId, ref) => {
    const { s: s0, faces } = rollDice(state, dice);
    let s = appendLog(s0, `${playerId}: rolled ${faces.join(', ')}`);
    if (faces.some((f) => faceCovers(f, want))) {
      s = cacheOnBird(s, playerId, ref, want);
      s = firePinkTriggers(s, playerId, { kind: 'predatorSuccess' });
    }
    if (thenEachDiscardCard) {
      const steps: PendingStep[] = s.playerOrder.map((pid) => ({
        kind: 'chooseHandDiscard',
        playerId: pid,
        count: 1,
        optional: true,
        then: { effect: 'supplyFood', ids: [FOOD_TYPES.indexOf(thenEachDiscardCard)] },
      }));
      s = pushPending(s, ...steps);
    }
    return s;
  };
}

/** Risky-roll predators: "roll N dice up to R times; each hit caches 1; a
 *  miss returns all food cached on this bird this turn." The confirm step
 *  gates each roll; the work lives in the 'asiaRiskyRoll' continuation. */
function riskyRoll(dice: number, wants: FoodType[]): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'confirm',
      playerId,
      then: {
        effect: 'asiaRiskyRoll',
        bird: ref,
        n: [dice, 0, 0],
        ids: wants.map((f) => FOOD_TYPES.indexOf(f)),
      },
    });
}

/** "Up to N times, draw 1 card; when you stop, if the drawn birds' total
 *  wingspan is < cap, tuck them all behind this bird; else discard them." */
function drawUpToWingspan(max: number, cap: number): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'drawUpTo',
      playerId,
      left: max,
      bird: ref,
      pool: [],
      then: { effect: 'asiaDrawUpToEval', n: [cap] },
    });
}

/** All players may cache `food` from their supply on a bird in `habitat`. */
function allMayCacheOn(food: FoodType, habitat: Habitat): PowerFn {
  return eachPlayerStep((pid) => ({
    kind: 'chooseBirds',
    playerId: pid,
    min: 0,
    max: 1,
    habitat,
    then: { effect: 'asiaCacheSupplyOn', ids: [FOOD_TYPES.indexOf(food)] },
  }));
}

/** "Discard any number of tray cards, then refill; if one discarded matches
 *  `check`, lay 1 egg on this bird." */
function trayDiscardCheck(check: 'grassland' | 'predator'): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseTrayDiscard',
      playerId,
      then: { effect: 'asiaTrayCheck', bird: ref, n: [check === 'grassland' ? 0 : 1] },
    });
}

/** "If rightmost, may move (card only) to a neighbour's mat; if so, draw 3." */
function moveToNeighbor(dir: 'left' | 'right'): PowerFn {
  return (state, playerId, ref) => {
    const p = getPlayer(state, playerId);
    if (ref.index !== p.board[ref.habitat].length - 1) {
      return appendLog(state, `${playerId}: not the rightmost bird`);
    }
    const target = dir === 'left' ? playerToLeft(state, playerId) : playerToRight(state, playerId);
    if (!target) return state;
    return pushPending(state, {
      kind: 'moveBirdToPlayer',
      playerId,
      bird: ref,
      target,
      then: { effect: 'drawCards', n: [3] },
    });
  };
}

/** Draw N cards to a pool, then: 1 to hand, 1 tucked, `rest` of the pool. */
function draw5HandTuck(rest: 'discard' | 'give'): PowerFn {
  return (state, playerId, ref) => {
    const { s, ids } = drawToPool(state, 5);
    if (ids.length === 0) return s;
    return pushPending(s, {
      kind: 'chooseDrawnCard',
      playerId,
      cardIds: ids,
      then: { effect: 'asiaPool5', ids, bird: ref, n: [rest === 'discard' ? 0 : 1] },
    });
  };
}

/** "Give 1 hand card to another player", then `effect` for the actor. */
function giveCardThen(after: 'draw2' | 'eggs2'): PowerFn {
  return (state, playerId, ref) =>
    pushPending(state, {
      kind: 'chooseHandPick',
      playerId,
      count: 1,
      then: { effect: 'asiaGivePick', bird: ref, n: [after === 'draw2' ? 0 : 1] },
    });
}

/** Count eggs in the player's board column of `ref` (other birds, eggs>0). */
function columnEggsOthers(state: GameState, playerId: PlayerId, ref: BirdRef): number {
  const p = getPlayer(state, playerId);
  let n = 0;
  for (const h of HABITATS) {
    const b = p.board[h][ref.index];
    if (b && !b.ghost && b.eggs > 0 && !(h === ref.habitat)) n++;
  }
  return n;
}

/** "All 4 action types used this round" check for asia teal powers. */
function usedAll4(p: PlayerState): boolean {
  return (
    p.roundCubes.forest > 0 &&
    p.roundCubes.grassland > 0 &&
    p.roundCubes.wetland > 0 &&
    p.roundCubes.playBird > 0
  );
}

/** "For every 3 eggs in `habitat`, gain 1 inv-or-seed; may cache up to 2 on this bird." */
function gainPer3Eggs(habitat: Habitat): PowerFn {
  return (state, playerId, ref) => {
    const n = Math.floor(eggsInHabitat(getPlayer(state, playerId), habitat) / 3);
    if (n <= 0) return appendLog(state, `${playerId}: no complete sets of 3 eggs`);
    const steps: PendingStep[] = [];
    for (let i = 0; i < n; i++) {
      steps.push({
        kind: 'chooseSupplyFood',
        playerId,
        count: 1,
        options: ['invertebrate', 'seed'],
      });
    }
    steps.push({
      kind: 'chooseCacheFromSupply',
      playerId,
      bird: ref,
      count: Math.min(2, n),
      food: 'any',
      options: ['invertebrate', 'seed'],
      optional: true,
    });
    return pushPending(state, ...steps);
  };
}

/** Actor draws 1; each other player draws 1 and keeps it iff `pred` holds. */
function drawKeepIf(pred: (c: BirdCard) => boolean): PowerFn {
  return (state, playerId) => {
    let s = drawFromDeck(state, playerId, 1);
    for (const pid of s.playerOrder) {
      if (pid === playerId) continue;
      if (s.deck.length === 0 && s.discard.length > 0) {
        const [deck, rng] = shuffle(s.rngState, s.discard);
        s = { ...s, deck, discard: [], rngState: rng };
      }
      if (s.deck.length === 0) break;
      const id = s.deck[s.deck.length - 1]!;
      s = { ...s, deck: s.deck.slice(0, -1) };
      if (pred(bird(id))) {
        const p = getPlayer(s, pid);
        s = setPlayer(s, { ...p, hand: [...p.hand, id] });
      } else {
        s = { ...s, discard: [...s.discard, id] };
      }
    }
    return s;
  };
}

/** "For each bird in `habitat` with an egg, roll 1 die; gain 1 food of a type
 *  rolled, from the supply." */
function rollPerEggedGain(habitat: Habitat): PowerFn {
  return (state, playerId) => {
    const n = playedBirds(getPlayer(state, playerId)).filter(
      ({ ref: r, bird: b }) => r.habitat === habitat && b.eggs > 0,
    ).length;
    if (n === 0) return appendLog(state, `${playerId}: no ${habitat} birds with eggs`);
    const { s, faces } = rollDice(state, n);
    const options = [
      ...new Set(
        faces.flatMap((f): FoodType[] => (f === 'split' ? ['invertebrate', 'seed'] : [f as FoodType])),
      ),
    ];
    const out = appendLog(s, `${playerId}: rolled ${faces.join(', ')}`);
    return pushPending(out, { kind: 'chooseSupplyFood', playerId, count: 1, options });
  };
}

/** Asia Adjutants: pick 1 of the neighbour's bonus cards to copy. */
function copyBonusCard(dir: 'left' | 'right'): PowerFn {
  return (state, playerId) => {
    const target = dir === 'left' ? playerToLeft(state, playerId) : playerToRight(state, playerId);
    if (!target) return appendLog(state, `${playerId}: no player to the ${dir}`);
    const tp = getPlayer(state, target);
    if (tp.bonusHand.length === 0) {
      return appendLog(state, `${playerId}: neighbour has no bonus cards`);
    }
    return pushPending(state, {
      kind: 'chooseBonusCards',
      playerId,
      cardIds: tp.bonusHand,
      keep: 1,
      copyFrom: target,
    });
  };
}

/** Common Tailorbird: the largest contiguous orthogonally-adjacent group of
 *  own birds sharing one nest type (star nests count as any); lay 1 egg each. */
function tailorbird(): PowerFn {
  return (state, playerId) => {
    const p = getPlayer(state, playerId);
    let best: BirdRef[] = [];
    for (const t of NEST_TYPES) {
      const cells = new Map<string, BirdRef>();
      for (const { ref, bird: b } of playedBirds(p)) {
        const n = bird(b.cardId).nest;
        if (n === t || n === 'wild') cells.set(`${ref.habitat}:${ref.index}`, ref);
      }
      const seen = new Set<string>();
      for (const k of cells.keys()) {
        if (seen.has(k)) continue;
        const comp: BirdRef[] = [];
        const stack = [cells.get(k)!];
        seen.add(k);
        while (stack.length > 0) {
          const r = stack.pop()!;
          comp.push(r);
          const hn = HABITATS.indexOf(r.habitat);
          const cands: BirdRef[] = [];
          if (hn > 0) cands.push({ habitat: HABITATS[hn - 1]!, index: r.index });
          if (hn < 2) cands.push({ habitat: HABITATS[hn + 1]!, index: r.index });
          cands.push(
            { habitat: r.habitat, index: r.index - 1 },
            { habitat: r.habitat, index: r.index + 1 },
          );
          for (const c of cands) {
            const kk = `${c.habitat}:${c.index}`;
            if (!seen.has(kk) && cells.has(kk)) {
              seen.add(kk);
              stack.push(cells.get(kk)!);
            }
          }
        }
        if (comp.length > best.length) best = comp;
      }
    }
    let s = state;
    for (const ref of best) {
      const p2 = getPlayer(s, playerId);
      const b = p2.board[ref.habitat]?.[ref.index];
      if (b && b.eggs < bird(b.cardId).eggLimit) {
        s = setPlayer(s, addEggs(p2, ref, 1));
      }
    }
    return s;
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
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [fruit] from the supply.': tuckHand({ effect: 'supplyFood', ids: [3] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [seed] from the supply.': tuckHand({ effect: 'supplyFood', ids: [1] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [invertebrate] from the supply.': tuckHand({ effect: 'supplyFood', ids: [0] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [invertebrate] or [seed] from the supply.': tuckHand({ effect: 'supplyFoodChoice', ids: [0, 1] }),
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

  // === european expansion: when activated (brown) ===
  'Remove any 1 [die] from the birdfeeder, then gain 1 [seed] from the supply.': (s, pid) =>
    pushPending(s, { kind: 'chooseDieRemove', playerId: pid, count: 1, then: { effect: 'supplyFood', ids: [1] } }),
  'Reset the birdfeeder. If you do, gain 1 [die] from the birdfeeder after resetting.': resetThenGain(undefined),
  'Reset the birdfeeder. If you do, gain 1 [invertebrate] from the birdfeeder after resetting.': resetThenGain(['invertebrate']),
  'Reset the birdfeeder. If you do, gain 1 [seed] from the birdfeeder after resetting.': resetThenGain(['seed']),
  'Reset the birdfeeder. If you do, gain 1 [seed] or 1 [fruit] from the birdfeeder after resetting.': resetThenGain(['seed', 'fruit']),
  'Steal 1 [wild] from another player\'s supply and add it to your own supply. They gain 1 [die] from the birdfeeder.': stealFood('any', false),
  'Steal 1 [fish] from another player\'s supply and cache it on this bird. They gain 1 [die] from the birdfeeder.': stealFood('fish', true),
  'Steal 1 [seed] from another player\'s supply and cache it on this bird. They gain 1 [die] from the birdfeeder.': stealFood('seed', true),
  'Steal 1 [invertebrate] from another player\'s supply and cache it on this bird. They gain 1 [die] from the birdfeeder.': stealFood('invertebrate', true),
  'Steal 1 [rodent] from another player\'s supply and cache it on this bird. They gain 1 [die] from the birdfeeder.': stealFood('rodent', true),
  'Choose a food type. All players gain 1 of that food from the supply.': (s, pid) =>
    pushPending(s, { kind: 'chooseFoodType', playerId: pid, then: { effect: 'allGainChosen' } }),
  'Gain 1 [seed] from the supply and cache it on this card. At any time, you may spend [seed] cached on this card.': (s, pid, ref) =>
    cacheOnBird(s, pid, ref, 'seed'),
  'From the supply, gain 1 food of a type you already gained this turn.': (s, pid) => {
    const types = [...new Set(getPlayer(s, pid).gainedThisTurn)];
    if (types.length === 0) return appendLog(s, `${pid}: no food gained this turn`);
    return pushPending(s, { kind: 'chooseSupplyFood', playerId: pid, count: 1, options: types });
  },
  'Discard all remaining face-up [card] and refill the tray. If you do, draw 1 of the new face-up [card].': (s, pid) => {
    let out: GameState = {
      ...s,
      discard: [...s.discard, ...s.tray.filter((id): id is number => id != null)],
      tray: [null, null, null],
    };
    out = refillTray(out);
    return pushPending(out, { kind: 'chooseTrayCard', playerId: pid });
  },
  'Gain 1 face-up [card] that can live in [grassland].': (s, pid) =>
    pushPending(s, { kind: 'chooseTrayCard', playerId: pid, habitat: 'grassland' }),
  'Gain 1 face-up [card] that can live in [wetland].': (s, pid) =>
    pushPending(s, { kind: 'chooseTrayCard', playerId: pid, habitat: 'wetland' }),
  'Draw 2 [card] from the deck. Tuck 1 behind this bird and keep the other.': (s, pid, ref) => {
    const { s: out, ids } = drawToPool(s, 2);
    if (ids.length === 0) return appendLog(out, `${pid}: deck is empty`);
    return pushPending(out, {
      kind: 'chooseDrawnCard',
      playerId: pid,
      cardIds: ids,
      then: { effect: 'tuckChosenKeepRest', ids, bird: ref },
    });
  },
  'Draw 2 [card]. All other players draw 1 [card] from the deck.': (s, pid) => {
    let out = drawFromDeck(s, pid, 2);
    for (const pl of out.players) {
      if (pl.id !== pid) out = drawFromDeck(out, pl.id, 1);
    }
    return out;
  },
  'Draw 1 [card] for each empty card slot in this row. At the end of your turn, keep 1 and discard the rest.': drawPerEmptySlot(),
  'Choose 1-5 birds in this habitat. Tuck 1 [card] from your hand behind each.': (s, pid, ref) =>
    chooseOwnBirds(1, 5, ref.habitat, { effect: 'assignTucks' })(s, pid, ref),
  'Choose 1-3 birds in your [wetland]. Tuck 1 [card] from your hand behind each. If you tuck at least 1 card, draw 1 [card].':
    chooseOwnBirds(1, 3, 'wetland', { effect: 'assignTucksDraw' }),
  'Choose 1-5 birds in your [forest]. Cache 1 [seed] from your supply on each.':
    chooseOwnBirds(1, 5, 'forest', { effect: 'cacheSeedEach' }),
  'Discard 1 [wild] from your supply. If you do, play another bird in your [wetland]. Pay its normal food and egg cost.':
    discardFoodFor('any', 1, { effect: 'playAdditional', ids: [2] }),
  'Discard 1 [card] from your hand. If you do, play another bird in your [forest]. Pay its normal food and egg cost.':
    (s, pid) =>
      pushPending(s, {
        kind: 'chooseHandDiscard',
        playerId: pid,
        count: 1,
        optional: true,
        then: { effect: 'playAdditional', ids: [0] },
      }),
  'Discard 1 [egg] from any bird. If you do, play another bird in your [forest]. Pay its normal food and egg cost.':
    discardEggToPlay('forest'),
  'Discard 1 [seed] from your supply. If you do, lay 2 [egg] on this bird.':
    discardFoodFor(['seed'], 1, { effect: 'selfEggs', n: [2] }),
  'Roll all dice not in the birdfeeder. If any are [rodent], place 1 [egg] on this card.':
    rollOutDiceEuropean('rodent', (s, pid, ref) => setPlayer(s, addEggs(getPlayer(s, pid), ref, 1))),
  'Roll all dice not in birdfeeder. If any are a [fish], gain that many [fish] from the supply and cache them on this bird.':
    rollOutDiceEuropean('fish', (s, pid, ref, hits) => {
      let out = s;
      for (let i = 0; i < hits; i++) out = cacheOnBird(out, pid, ref, 'fish');
      return out;
    }),
  'Lay 1 [egg] on each bird in this column, including this one.': (s, pid, ref) => {
    let p = getPlayer(s, pid);
    for (const h of HABITATS) {
      const b = p.board[h][ref.index];
      if (b && !b.ghost) p = addEggs(p, { habitat: h, index: ref.index }, 1);
    }
    return setPlayer(s, p);
  },
  'Choose 1 other player. For each action cube on their [wetland], tuck 1 [card] from your hand behind this bird, then draw an equal number of [card].':
    (s, pid, ref) => cubesThen('wetland', 'tuckPerCube', ref)(s, pid, ref),

  // === european expansion: round end (teal) ===
  'Choose a habitat with no [egg]. Lay 1 [egg] on each bird in that habitat.': (s, pid) =>
    pushPending(s, { kind: 'chooseHabitat', playerId: pid, noEggs: true, then: { effect: 'eggEachHabitat' } }),
  'Choose any 1 player (including yourself). Cache 1 [rodent] from the supply on this bird for each [predator] that player has.':
    (s, pid, ref) =>
      pushPending(s, { kind: 'choosePlayer', playerId: pid, then: { effect: 'cachePerPredator', bird: ref } }),
  'This bird counts double toward the end-of-round goal, if it qualifies for the goal.': (s) => s,
  'Lay 1 [egg] on this bird for each other bird with a [cavity] nest that you have.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    const n = playedBirds(p).filter(({ ref: r, bird: b }) => {
      if (r.habitat === ref.habitat && r.index === ref.index) return false;
      const c = BIRD_BY_ID.get(b.cardId)!;
      return c.nest === 'cavity' || c.nest === 'wild';
    }).length;
    return setPlayer(s, addEggs(p, ref, n));
  },
  'Discard up to 5 [wild] from your supply. For each, tuck 1 [card] from the deck behind this bird.':
    discardFoodToTuckUpTo('any', 5),
  'Discard up to 5 [invertebrate] from your supply. For each, tuck 1 [card] from the deck behind this bird.':
    discardFoodToTuckUpTo('invertebrate', 5),
  'Discard up to 5 [seed] from your supply. For each, tuck 1 [card] from the deck behind this bird.':
    discardFoodToTuckUpTo('seed', 5),
  'Choose 1 other player. For each action cube on their [grassland], lay 1 [egg] on this bird.':
    (s, pid, ref) => cubesThen('grassland', 'eggsPerCube', ref)(s, pid, ref),
  'Choose 1 other player. For each action cube on their [grassland], cache 1 [wild] from the supply on any of your birds.':
    (s, pid, ref) => cubesThen('grassland', 'cacheWildPerCube', ref)(s, pid, ref),
  'Reset the birdfeeder. If you do, gain all [invertebrate] in the birdfeeder after resetting.': (s, pid) =>
    takeAllMatching(refillFeeder(appendLog(s, `${pid}: reset the birdfeeder`)), pid, 'invertebrate', true),
  'Choose 1 other player. For each action cube on their [grassland], tuck 1 [card] from your hand behind this bird, then draw an equal number of [card].':
    (s, pid, ref) => cubesThen('grassland', 'tuckPerCube', ref)(s, pid, ref),
  'If you used all 4 types of actions this round, play another bird. Pay its normal food and egg cost.':
    playIfAllFourActions(),
  'Tuck up to 3 [card] from your hand behind this bird. Draw 1 [card] for each card you tucked.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'assignHandTucks',
      playerId: pid,
      targets: [ref, ref, ref],
      then: { effect: 'drawPerTucked' },
    }),

  // === european expansion: when played (white) ===
  // Alternative-cost powers are consumed by the playBird action itself; the
  // impls below exist so hasPowerImpl/runPower treat them as implemented.
  'For each [rodent] in this bird\'s cost, you may pay 1 [card] from your hand instead. If you do, tuck the paid [card] behind this card.': (s) => s,
  'Place this bird sideways, so that it covers 2 [forest] spaces. Pay the lower egg cost.': (s) => s,
  'Place this bird sideways, so that it covers 2 [grassland] spaces. Pay the lower egg cost.': (s) => s,
  'Place this bird sideways, so that it covers 2 [wetland] spaces. Pay the lower egg cost.': (s) => s,
  'Instead of paying any costs, you may play this bird on top of another bird on your player mat. Discard any eggs and food from that bird. It becomes a tucked card.': (s) => s,
  'Draw 1 new bonus card. Then draw 3 [card] and keep 1 of them.': (s, pid, ref) => {
    const { s: out, ids } = drawToPool(s, 3);
    if (ids.length === 0) return out;
    return drawBonusCardThen({
      kind: 'chooseDrawnCard',
      playerId: pid,
      cardIds: ids,
      then: { effect: 'keepDiscardRest', ids },
    })(out, pid, ref);
  },
  'Draw 1 new bonus card. Then gain 1 [die] from the birdfeeder.': (s, pid, ref) =>
    drawBonusCardThen({ kind: 'pickDie', playerId: pid, count: 1 })(s, pid, ref),
  'Draw 1 new bonus card. Then gain 1 [die] from the birdfeeder, lay 1 [egg] on any bird, or draw 1 [card].': (s, pid, ref) =>
    drawBonusCardThen({ kind: 'chooseOption', playerId: pid, options: ['gainDie', 'layEgg', 'drawCard'] })(s, pid, ref),
  'Draw 1 new bonus card. Then gain 1 [card] or lay 1 [egg] on any bird.': (s, pid, ref) =>
    drawBonusCardThen({ kind: 'chooseOption', playerId: pid, options: ['drawCard', 'layEgg'] })(s, pid, ref),

  // === oceania expansion ===

  // --- gain food ---
  'All players gain 1 [fruit] from the supply. You gain 1 additional [fruit] from the supply.': (s, pid) => {
    let out = s;
    for (const o of out.playerOrder) out = grantSupplyFood(out, o, 'fruit');
    return grantSupplyFood(out, pid, 'fruit');
  },
  'All players gain 1 [nectar] from the supply. You also gain 1 [seed] from the supply.': (s, pid) => {
    let out = s;
    for (const o of out.playerOrder) out = grantSupplyFood(out, o, 'nectar');
    return grantSupplyFood(out, pid, 'seed');
  },
  'All players gain 1 [nectar] from the supply.': (s) => {
    let out = s;
    for (const o of out.playerOrder) out = grantSupplyFood(out, o, 'nectar');
    return out;
  },
  'All players may discard 1 [egg] from a [wetland] bird. Each player that discards an [egg] gains 1 [wild] from the supply.': (s) =>
    pushPending(
      s,
      ...s.playerOrder.map((pid) => ({
        kind: 'chooseBirdForEggDiscard' as const,
        playerId: pid,
        count: 1,
        habitat: 'wetland' as const,
        optional: true,
        then: { effect: 'supplyWild', n: [1] },
      })),
    ),
  'If the player to your left has a [nectar] in their personal supply, gain 1 [nectar] from the general supply.':
    neighborHas(['left'], 'nectar', 'gain'),
  'If the player to your left has an [invertebrate] in their personal supply, gain 1 [invertebrate] from the general supply.':
    neighborHas(['left'], 'invertebrate', 'gain'),
  'If the player to your left or right has an [invertebrate] in their personal supply, gain 1 [invertebrate] from the general supply.':
    neighborHas(['left', 'right'], 'invertebrate', 'gain'),
  'If the player to your right has a [nectar] in their personal supply, gain 1 [nectar] from the general supply.':
    neighborHas(['right'], 'nectar', 'gain'),
  'If the player to your right has a [seed] in their personal supply, tuck a [card] from the deck behind this bird.':
    neighborHas(['right'], 'seed', 'tuck'),
  'If the player to your right has an [invertebrate] in their supply, cache 1 [invertebrate] from the general supply on this bird.':
    neighborHas(['right'], 'invertebrate', 'cache'),
  'Gain 1 [nectar] from the birdfeeder, if there is one.': gainDice(1, { faces: ['nectar'] }),
  'Gain 1 [nectar] from the supply for each bird with a wingspan less than 49cm in your [forest].': (s, pid) => {
    const p = getPlayer(s, pid);
    const n = p.board.forest.filter((b) => !b.ghost && wingspanOf(bird(b.cardId)) < 49).length;
    return grantSupplyFood(s, pid, 'nectar', n);
  },
  'Gain all [seed] that are in the birdfeeder. Keep half (rounded up), then choose how to distribute the remainder among the other player(s).': (s, pid) => {
    const before = getPlayer(s, pid).food.seed;
    let out = takeAllMatching(s, pid, 'seed');
    const kept = getPlayer(out, pid).food.seed - before;
    const give = Math.floor(kept / 2);
    if (give <= 0 || out.playerOrder.length < 2) return out;
    return pushPending(
      out,
      ...Array.from({ length: give }, () => ({
        kind: 'choosePlayer' as const,
        playerId: pid,
        other: true,
        then: { effect: 'giveSupplyFood', ids: [1] },
      })),
    );
  },
  'Reset the birdfeeder and gain 1 [rodent], if there is one. You may give it to another player; if you do, lay up to 3 [egg] on this bird.': (s, pid, ref) => {
    let out = appendLog(refillFeeder(s), `${pid}: reset the birdfeeder`);
    const idx = out.feederIn.findIndex((f) => f === 'rodent');
    if (idx < 0) return out;
    out = takeDieFromFeeder(out, pid, idx, undefined);
    return pushPending(out, {
      kind: 'choosePlayer',
      playerId: pid,
      other: true,
      optional: true,
      then: { effect: 'giveRodentLayEggs', bird: ref },
    });
  },
  'Reset the birdfeeder and gain all [fish], if there are any. You may cache any or all of them on this bird.':
    resetGainAllCache('fish'),
  'Reset the birdfeeder and gain all [fish], if there are any. You may discard any of these [fish] to tuck that many [card] from the deck behind this bird instead.': (s, pid, ref) => {
    let out = appendLog(refillFeeder(s), `${pid}: reset the birdfeeder`);
    const before = getPlayer(out, pid).food.fish;
    out = takeAllMatching(out, pid, 'fish', true);
    const n = getPlayer(out, pid).food.fish - before;
    if (n <= 0) return out;
    return pushPending(out, {
      kind: 'chooseFoodDiscard',
      playerId: pid,
      count: n,
      options: ['fish'],
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect: 'tuckDeckPerFood', bird: ref },
    });
  },
  'Reset the birdfeeder and gain all [rodent], if there are any. You may cache any or all of them on this bird.':
    resetGainAllCache('rodent'),
  'Reset the birdfeeder, then, for each type of food in the birdfeeder, gain 1 of that type.': (s, pid) => {
    let out = appendLog(refillFeeder(s), `${pid}: reset the birdfeeder`);
    const types = new Set(out.feederIn.filter((f): f is FoodType => f !== 'split'));
    for (const f of types) out = grantSupplyFood(out, pid, f);
    return out;
  },
  'Reset the birdfeeder. Cache 1 [invertebrate] or [rodent] from the birdfeeder (if available) on this bird.':
    resetCacheDie(['invertebrate', 'rodent']),
  'Reset the birdfeeder. Gain 1 [fish] or 1 [rodent] from the birdfeeder, if there is one, and cache it on this bird.':
    resetCacheDie(['fish', 'rodent']),
  'Reset the birdfeeder. If you do, gain 1 [invertebrate], [fish], or [rodent], if there is one.':
    resetThenGain(['invertebrate', 'fish', 'rodent']),
  'Give 1 [nectar] from your supply to another player. If you do, lay 2 [egg] on this bird or gain 2 [die] from the birdfeeder.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    if (p.food.nectar <= 0) return appendLog(s, `${pid}: no nectar to give`);
    return pushPending(s, {
      kind: 'choosePlayer',
      playerId: pid,
      other: true,
      then: { effect: 'giveNectar', bird: ref },
    });
  },
  'Gain 1 [fruit] from the supply, or discard 1 [fruit] to gain 1 [nectar] from the supply.': (s, pid) => {
    const p = getPlayer(s, pid);
    const options = p.food.fruit > 0 ? (['gainFruit', 'fruitToNectar'] as const) : (['gainFruit'] as const);
    return pushPending(s, { kind: 'chooseOption', playerId: pid, options: [...options] });
  },
  'Choose 1 other player. They lay 1 [egg]; you draw 2 [card].': chooseOther('theyLayYouDraw', { n: [2] }),
  'Choose 1 other player. They reset the birdfeeder and gain a [seed], if there is one. You tuck 2 [card] from the deck behind this bird.':
    (s, pid, ref) =>
      pushPending(s, {
        kind: 'choosePlayer',
        playerId: pid,
        other: true,
        then: { effect: 'galahReset', bird: ref },
      }),
  'Choose 1 other player. You both draw 1 [card] from the deck.': chooseOther('bothDraw', { n: [1] }),
  'Choose 1 other player. You both gain 1 [fruit] from the supply.': chooseOther('bothGainSupply', { ids: [3] }),
  'Choose 1 other player. You both gain 1 [invertebrate] from the supply.': chooseOther('bothGainSupply', { ids: [0] }),
  'Choose 1 other player. You both gain 1 [nectar] from the supply.': chooseOther('bothGainSupply', { ids: [5] }),
  'Choose 1 other player. You both gain 1 [seed] from the supply.': chooseOther('bothGainSupply', { ids: [1] }),
  'Choose 1 other player. You both lay 1 [egg].': chooseOther('bothLayEgg'),
  'Copy a brown power on one bird in the [forest] of the player to your left.': copyPower('left'),
  'Copy a brown power on one bird in the [forest] of the player to your right.': copyPower('right'),

  // --- discard / gain ---
  'Discard 1 [invertebrate]. If you do, gain 1 [nectar] from the supply.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseFoodDiscard',
      playerId: pid,
      count: 1,
      options: ['invertebrate'],
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect: 'supplyFood', ids: [5] },
    }),
  'Discard 1 [nectar] to the “spent nectar” space for your [forest]. If you do, gain 2 [die] from the birdfeeder.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    if (p.food.nectar <= 0) return appendLog(s, `${pid}: no nectar`);
    const out = setPlayer(s, {
      ...spendFood(p, ['nectar']),
      nectarSpent: { ...p.nectarSpent, forest: p.nectarSpent.forest + 1 },
    });
    return gainDice(2, {})(out, pid, ref);
  },
  'Discard 1 [seed] to choose a [card] from the tray and tuck it behind this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseFoodDiscard',
      playerId: pid,
      count: 1,
      options: ['seed'],
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect: 'trayTuck', bird: ref },
    }),
  'Discard 1 [seed]. If you do, lay up to 2 [egg] on this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseFoodDiscard',
      playerId: pid,
      count: 1,
      options: ['seed'],
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect: 'selfEggsUpTo', n: [2], bird: ref },
    }),
  'Discard 1 [wild] to tuck 1 [card] from the deck behind this bird.': discardUpTo('any', 1, 'tuckDeckPerFood'),
  'Discard any number of [rodent] to gain that many [nectar] from the supply.':
    discardUpTo(['rodent'], 99, 'gainPerFood'),
  'Discard any number of [seed]. Lay 1 [egg] on this bird for each discarded [seed].':
    discardUpTo(['seed'], 99, 'selfEggsPerFood'),
  'Discard any number of [wild] to draw that many [card].': discardUpTo('any', 99, 'drawPerFood'),
  'Discard up to 6 [wild]. Lay 1 [egg] on this bird for each discarded food.':
    discardUpTo('any', 6, 'selfEggsPerFood'),
  'Discard a bonus card. If you do, draw 4 bonus cards, keep 2, and discard the other 2.': (s, pid) =>
    pushPending(s, {
      kind: 'discardBonusCards',
      playerId: pid,
      count: 1,
      optional: true,
      then: { effect: 'kiwiDraw' },
    }),
  'Discard all [egg] from 1 of your birds with a [cavity] nest. Tuck twice that many [card] from the deck behind this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseBirds',
      playerId: pid,
      min: 0,
      max: 1,
      nest: 'cavity',
      eggsMin: 1,
      then: { effect: 'hornbillTuck', bird: ref },
    }),
  'Discard a bird from your [forest] and put this bird in its place (do not pay an egg cost). If you do, lay 4 [egg] on this bird and gain 2 [fruit] from the supply.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseBirds',
      playerId: pid,
      min: 0,
      max: 1,
      habitat: 'forest',
      exclude: ref,
      then: { effect: 'cassowarySwap', bird: ref },
    }),
  'Discard 1 [egg] from each bird in this row and column that has an [egg] on it, excluding this bird. For each discarded [egg], cache 2 [seed] from the supply on this bird.': (s, pid, ref) => {
    let out = s;
    const p = getPlayer(out, pid);
    const targets: BirdRef[] = [];
    // Same row: every other bird with an egg.
    p.board[ref.habitat].forEach((b, index) => {
      if (index !== ref.index && !b.ghost && b.eggs > 0) {
        targets.push({ habitat: ref.habitat, index });
      }
    });
    // Same column in the other two rows.
    for (const h of HABITATS) {
      if (h === ref.habitat) continue;
      const b = p.board[h][ref.index];
      if (b && !b.ghost && b.eggs > 0) targets.push({ habitat: h, index: ref.index });
    }
    for (const t of targets) {
      const pl = getPlayer(out, pid);
      const row = [...pl.board[t.habitat]];
      row[t.index] = { ...row[t.index]!, eggs: row[t.index]!.eggs - 1 };
      out = setPlayer(out, { ...pl, board: { ...pl.board, [t.habitat]: row } });
      out = cacheOnBird(out, pid, ref, 'seed');
      out = cacheOnBird(out, pid, ref, 'seed');
    }
    return out;
  },

  // --- draw / tuck ---
  'Draw 1 face-up [card] from the tray with a [bowl] or [star] nest. You may reset or refill the tray before doing so.':
    trayDrawNest('bowl'),
  'Draw 1 face-up [card] from the tray with a [cavity] or [star] nest. You may reset or refill the tray before doing so.':
    trayDrawNest('cavity'),
  'Draw 1 face-up [card] from the tray with a [ground] or [star] nest. You may reset or refill the tray before doing so.':
    trayDrawNest('ground'),
  'Draw 1 face-up [card] from the tray with a [platform] or [star] nest. You may reset or refill the tray before doing so.':
    trayDrawNest('platform'),
  'Draw 1 face-up [card] from the tray with a wingspan less than 75cm and tuck it behind this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseTrayCardEx',
      playerId: pid,
      wingspanLt: 75,
      destination: 'tuck',
      bird: ref,
    }),
  'Draw 2 [card] from the deck. Keep 1 and give the other to another player.': (s, pid) => {
    const { s: out, ids } = drawToPool(s, 2);
    if (ids.length === 0) return appendLog(out, `${pid}: deck is empty`);
    return pushPending(out, {
      kind: 'chooseDrawnCard',
      playerId: pid,
      cardIds: ids,
      then: { effect: 'giveOtherCard', ids },
    });
  },
  'Draw and discard 5 [card] from the deck. For each [fish] in their food costs, cache 1 [fish] from the supply on this bird.': (s, pid, ref) => {
    const { s: out, ids } = drawToPool(s, 5);
    let n = 0;
    for (const id of ids) n += foodIconsInCost(bird(id), 'fish');
    let o: GameState = { ...out, discard: [...out.discard, ...ids] };
    for (let i = 0; i < n; i++) o = cacheOnBird(o, pid, ref, 'fish');
    return o;
  },
  'Look at 3 [card] from the deck. Keep 1 [wetland] bird, if there is one. You may add it to your hand or tuck it behind this bird. Discard the other cards.': (s, pid, ref) => {
    const { s: out, ids } = drawToPool(s, 3);
    const wetlands = ids.filter((id) => bird(id).habitats.includes('wetland'));
    if (wetlands.length === 0) return { ...out, discard: [...out.discard, ...ids] };
    return pushPending(out, {
      kind: 'chooseDrawnCard',
      playerId: pid,
      cardIds: wetlands,
      then: { effect: 'poolTuckOrHand', ids, bird: ref },
    });
  },
  'Look at a [card] from the deck. If it can live in [wetland], tuck it behind this bird. If not, discard it.':
    lookIf((c) => c.habitats.includes('wetland')),
  'Look at a [card] from the deck. If its food cost includes an [invertebrate] or a [rodent], tuck it behind this bird. If not, discard it.':
    lookIf((c) => costHasFood(c, ['invertebrate', 'rodent'])),
  'Look at a [card] from the deck. If its wingspan is less than 40cm, tuck it behind this bird and cache 1 [rodent] from the supply on this bird. If not, discard it.':
    lookIf((c) => wingspanOf(c) < 40, 'rodent'),
  'Look at a [card] from the deck. If its wingspan is over 65cm, tuck it behind this bird and cache 1 [rodent] from the supply on this bird. If not, discard it.':
    lookIf((c) => wingspanOf(c) > 65, 'rodent'),
  'Look through all discarded bonus cards. Keep 1 of them.': (s, pid) => {
    if (s.bonusDiscard.length === 0) return appendLog(s, `${pid}: no discarded bonus cards`);
    return pushPending(s, {
      kind: 'chooseBonusCards',
      playerId: pid,
      cardIds: s.bonusDiscard.slice(),
      keep: 1,
      fromDiscard: true,
    });
  },
  'Draw 1 bonus card for each bird in your [grassland]. Keep 1 and discard the rest.': (s, pid, ref) =>
    drawBonus(Math.max(1, getPlayer(s, pid).board.grassland.filter((b) => !b.ghost).length), 1)(s, pid, ref),
  'Draw 1 bonus card. You may discard any number of [wild] to draw that many additional bonus cards. Keep 1 of the cards you drew and discard the rest.': (s, pid, ref) => {
    let out = s;
    const pool: number[] = [];
    if (out.bonusDeck.length > 0) {
      pool.push(out.bonusDeck[out.bonusDeck.length - 1]!);
      out = { ...out, bonusDeck: out.bonusDeck.slice(0, -1) };
    }
    return pushPending(out, {
      kind: 'chooseFoodDiscard',
      playerId: pid,
      count: 99,
      options: 'any',
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect: 'keaDraw', ids: pool },
    });
  },
  'Draw 3 bonus cards, then discard 2. You may discard bonus cards you did not draw this turn.': drawBonus(3, 1),
  'Draw 4 bonus cards, keep 1, and discard the other 3.': drawBonus(4, 1),
  'Shuffle the discard pile, then draw 2 [card] from it. Choose 1 and tuck it behind this bird or add it to your hand. Discard the other.': (s, pid, ref) => {
    if (s.discard.length === 0) return appendLog(s, `${pid}: discard pile is empty`);
    const [pile, rng] = shuffle(s.rngState, s.discard);
    const drawn = pile.slice(-2);
    const out: GameState = { ...s, discard: pile.slice(0, -drawn.length), rngState: rng };
    return pushPending(out, {
      kind: 'chooseDrawnCard',
      playerId: pid,
      cardIds: drawn,
      then: { effect: 'poolTuckOrHand', ids: drawn, bird: ref },
    });
  },
  'Tuck 1 [card] from the deck behind each bird in this habitat, including this bird.': tuckDeckEachIn('same'),
  'Tuck 1 [card] from the deck behind each bird in your [grassland], including this one.': tuckDeckEachIn('grassland'),
  'Tuck 1 [card] from your hand behind this bird. If you do, all players gain 1 [nectar] from the supply.':
    tuckHand({ effect: 'allGainFoodType', ids: [5] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, all players gain 1 [seed] from the supply.':
    tuckHand({ effect: 'allGainFoodType', ids: [1] }),
  'Tuck 1 [card] from your hand behind this bird. If you do, lay up to 2 [egg] on this bird. All other players may lay 1 [egg].':
    tuckHand({ effect: 'noisyMiner' }),
  'Tuck the smallest bird in the tray behind this bird.': (s, pid, ref) => {
    const candidates = s.tray
      .map((id, i) => ({ id, i }))
      .filter((x): x is { id: number; i: number } => x.id != null);
    if (candidates.length === 0) return s;
    const min = candidates.reduce((a, b) =>
      wingspanOf(bird(a.id)) <= wingspanOf(bird(b.id)) ? a : b,
    );
    let out: GameState = { ...s, tray: s.tray.map((t, i) => (i === min.i ? null : t)) };
    out = tuckCardOnBird(out, pid, ref, min.id);
    return firePinkTriggers(out, pid, { kind: 'tuck' });
  },
  'Tuck up to 3 [card] from your hand behind this bird. If you tuck at least 1 [card], gain 1 [seed] from the supply.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'assignHandTucks',
      playerId: pid,
      targets: [ref, ref, ref],
      then: { effect: 'gainIfTucked', ids: [1] },
    }),
  // --- eggs ---
  'Lay 1 [egg] on an adjacent bird.': (s, pid, ref) =>
    pushPending(s, { kind: 'chooseBirdForEgg', playerId: pid, count: 1, nest: 'any', adjacentTo: ref }),
  'Lay 1 [egg] on each bird in your [grassland], including this one.': eggsEachIn('grassland'),
  'Lay 1 [egg] on each bird in your [wetland], including this one.': eggsEachIn('wetland'),
  'Lay 1 [egg] on each of your birds with a [ground] nest, including this one.': layEggsEachNest('ground'),
  'Lay 1 [egg] on each of your birds with a [platform] nest, including this one.': layEggsEachNest('platform'),
  'Lay 1 [egg] on each of your birds with a [star] nest, including this one.': (s, pid) => {
    let p = getPlayer(s, pid);
    for (const { ref, bird: b } of playedBirds(p)) {
      if (bird(b.cardId).nest === 'wild' && b.eggs < bird(b.cardId).eggLimit) p = addEggs(p, ref, 1);
    }
    return setPlayer(s, p);
  },
  'Lay 1 [egg] on each of your birds with a wingspan less than 30cm, including this one.':
    eggsEachWingspan((w) => w < 30),
  'Lay 1 [egg] on each of your birds with a wingspan over 100cm, including this one.':
    eggsEachWingspan((w) => w > 100),
  'For every 2 [egg] in your [wetland], lay 1 [egg] on this bird.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    const n = Math.floor(p.board.wetland.reduce((x, b) => x + (b.ghost ? 0 : b.eggs), 0) / 2);
    return n > 0 ? setPlayer(s, addEggs(p, ref, n)) : s;
  },

  // --- play additional birds ---
  'Play a bird. Pay its normal food and egg cost. If it has a “when played” or “game end” power, you may use it.': (s, pid) =>
    pushPending(s, { kind: 'chooseAdditionalPlay', playerId: pid, habitat: 'any', optional: true }),
  'Play a bird. Pay its normal food cost, but ignore 1 [egg] in its egg cost. If it has a “when played” or “game end” power, you may use it.': (s, pid) =>
    pushPending(s, { kind: 'chooseAdditionalPlay', playerId: pid, habitat: 'any', eggDiscount: 1, optional: true }),
  'Play another bird in your [forest]. Pay its normal cost with a 1 [egg] discount.': (s, pid) =>
    pushPending(s, { kind: 'chooseAdditionalPlay', playerId: pid, habitat: 'forest', eggDiscount: 1, optional: true }),
  'Play another bird in your [grassland]. Pay its normal cost with a 1 [egg] discount.': (s, pid) =>
    pushPending(s, { kind: 'chooseAdditionalPlay', playerId: pid, habitat: 'grassland', eggDiscount: 1, optional: true }),
  'Play another bird in your [wetland]. Pay its normal cost with a 1 [egg] discount.': (s, pid) =>
    pushPending(s, { kind: 'chooseAdditionalPlay', playerId: pid, habitat: 'wetland', eggDiscount: 1, optional: true }),
  'Discard 2 [egg] from your [forest]. If you do, play 1 bird in your [grassland] at its normal food cost (ignore its egg cost). If it has a “when played” or “game end” power, you may use it.': (s, pid) =>
    pushPending(s, {
      kind: 'chooseBirdForEggDiscard',
      playerId: pid,
      count: 2,
      habitat: 'forest',
      optional: true,
      then: { effect: 'playAdditional', ids: [1], n: [99] },
    }),

  // --- game end caching ---
  'Cache up to 5 [wild] from your supply on this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseCacheFromSupply',
      playerId: pid,
      bird: ref,
      count: 5,
      food: 'any',
      optional: true,
    }),
  'Cache up to 8 [seed] from your supply on this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseCacheFromSupply',
      playerId: pid,
      bird: ref,
      count: 8,
      food: 'seed',
      optional: true,
    }),

  // === asia expansion powers ===

  // --- when played (white) ---
  'Lay 2 [egg] on each other bird in this column.': (s, pid, ref) => {
    let p = getPlayer(s, pid);
    for (const h of HABITATS) {
      if (h === ref.habitat) continue;
      const b = p.board[h][ref.index];
      if (b && !b.ghost) p = addEggs(p, { habitat: h, index: ref.index }, 2);
    }
    return setPlayer(s, p);
  },
  'Draw 2 new bonus cards and keep 1. Other players may discard any 2 resources ([wild], [egg], or [card]) to do the same.': (s, pid, ref) => {
    s = drawBonus(2, 1)(s, pid, ref);
    for (const oid of s.playerOrder) {
      if (oid === pid) continue;
      s = pushPending(s, {
        kind: 'chooseResources',
        playerId: oid,
        count: 2,
        optional: true,
        then: { effect: 'asiaDrawBonus21' },
      });
    }
    return s;
  },
  'All players lay 2 [egg]. You lay 2 additional [egg].': allLayEggs(2, 2),
  'Lay 1 [egg] on this bird for each other bird in your [grassland].': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    const n = playedBirds(p).filter(
      ({ ref: r }) => r.habitat === 'grassland' && !sameRef(r, ref),
    ).length;
    return setPlayer(s, addEggs(p, ref, n));
  },
  'Steal 1 [invertebrate] from each of your neighbors. Each neighbor from whom a [invertebrate] was stolen may gain 1 [wild] from the supply.': (s, pid) => {
    const neighbors = new Set<PlayerId>();
    for (const n of [playerToLeft(s, pid), playerToRight(s, pid)]) if (n) neighbors.add(n);
    for (const n of neighbors) {
      const v = getPlayer(s, n);
      if (v.food.invertebrate > 0) {
        s = setPlayer(s, spendFood(v, ['invertebrate']));
        s = grantSupplyFood(s, pid, 'invertebrate');
        s = pushPending(s, { kind: 'chooseSupplyFood', playerId: n, count: 1, options: 'any' });
      }
    }
    return s;
  },
  'Score 1 of your bonus cards now by caching 1 [seed] from the supply on this bird for each point. Also score it normally at game end.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    if (p.bonusHand.length === 0) return appendLog(s, `${pid}: no bonus cards`);
    return pushPending(s, {
      kind: 'chooseBonusCards',
      playerId: pid,
      cardIds: p.bonusHand,
      keep: 1,
      fromHand: true,
      then: { effect: 'asiaScoreBonusNow', bird: ref, ids: [FOOD_TYPES.indexOf('seed')], n: [0] },
    });
  },
  'Score 1 of your bonus cards now by caching 1 [wild] from the supply on this bird for each point. Discard that bonus card and draw 1 new one.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    if (p.bonusHand.length === 0) return appendLog(s, `${pid}: no bonus cards`);
    return pushPending(s, {
      kind: 'chooseBonusCards',
      playerId: pid,
      cardIds: p.bonusHand,
      keep: 1,
      fromHand: true,
      then: { effect: 'asiaScoreBonusNow', bird: ref, ids: [-1], n: [1] },
    });
  },
  'Copy a “When Played” (white) ability on 1 of your neighbors\' birds.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseCopyPlayed',
      playerId: pid,
      then: { effect: 'asiaCopyPlayed', bird: ref },
    }),
  'Play 1 additional bird in your [forest]. You may ignore 1 [invertebrate] or 1 [egg] in its cost.': (s, pid) =>
    pushPending(s, {
      kind: 'chooseAdditionalPlay',
      playerId: pid,
      habitat: 'forest',
      optional: true,
      eggDiscount: 1,
      foodDiscount: 'invertebrate',
    }),
  'Play 1 additional bird in your [grassland]. You may ignore 1 [seed] or 1 [egg] in its cost.': (s, pid) =>
    pushPending(s, {
      kind: 'chooseAdditionalPlay',
      playerId: pid,
      habitat: 'grassland',
      optional: true,
      eggDiscount: 1,
      foodDiscount: 'seed',
    }),
  'Draw 3 new bonus cards and keep 1.': (s, pid, ref) => drawBonus(3, 1)(s, pid, ref),
  'All players draw 2 [card] from the deck. You draw 1 additional [card].': (s, pid, ref) => {
    let out = allDraw(2)(s, pid, ref);
    return drawFromDeck(out, pid, 1);
  },
  'Draw 4 [card]. Tuck 2 [card] behind this bird and add the other 2 [card] to your hand.': (s, pid, ref) => {
    const { s: s1, ids } = drawToPool(s, 4);
    if (ids.length === 0) return s1;
    return pushPending(s1, {
      kind: 'choosePoolTuck',
      playerId: pid,
      cardIds: ids,
      count: 2,
      bird: ref,
      rest: 'hand',
    });
  },

  // --- game end (yellow) ---
  'Find a contiguous group of birds in your preserve that all have the same nest type. Lay 1 [egg] on each of them. [star] nests count as any nest type.': tailorbird(),
  'Copy one bonus card of the player on your left, as if it were your own (score it based on your own birds).': copyBonusCard('left'),
  'Copy one bonus card of the player on your right, as if it were your own (score it based on your own birds).': copyBonusCard('right'),

  // --- end of round (teal) ---
  'For each other bird in this column with an egg on it, lay 1 [egg] on this bird.': (s, pid, ref) => {
    const n = columnEggsOthers(s, pid, ref);
    return n > 0 ? setPlayer(s, addEggs(getPlayer(s, pid), ref, n)) : s;
  },
  'Lay 1 [egg] on each of the birds immediately to the left and right of this bird.': (s, pid, ref) => {
    let p = getPlayer(s, pid);
    const row = p.board[ref.habitat];
    for (const i of [ref.index - 1, ref.index + 1]) {
      const b = row[i];
      if (b && !b.ghost) p = addEggs(p, { habitat: ref.habitat, index: i }, 1);
    }
    return setPlayer(s, p);
  },
  'If you used all 4 actions this round, gain 1 [wild] from the supply, lay 1 [egg] on any bird, and draw 1 [card] from the deck.': (s, pid) => {
    if (!usedAll4(getPlayer(s, pid))) return appendLog(s, `${pid}: did not use all 4 actions`);
    return pushPending(
      s,
      { kind: 'chooseSupplyFood', playerId: pid, count: 1, options: 'any' },
      { kind: 'chooseBirdForEgg', playerId: pid, count: 1, nest: 'any', then: { effect: 'drawCards', n: [1] } },
    );
  },
  'If you used all 4 types of action this round, gain 2 [wild] from the supply.': (s, pid) => {
    if (!usedAll4(getPlayer(s, pid))) return appendLog(s, `${pid}: did not use all 4 actions`);
    return pushPending(s, { kind: 'chooseSupplyFood', playerId: pid, count: 2, options: 'any' });
  },
  'Draw 2 [card] from the deck and add them to your hand. Then, tuck any 2 [card] from your hand behind this bird.': (s, pid, ref) => {
    s = drawFromDeck(s, pid, 2);
    return pushPending(s, { kind: 'assignHandTucks', playerId: pid, targets: [ref, ref] });
  },
  'Draw 2 [card] from the deck and add them to your hand. Then, tuck up to 2 [card] from your hand behind this bird.': (s, pid, ref) => {
    s = drawFromDeck(s, pid, 2);
    return pushPending(s, { kind: 'assignHandTucks', playerId: pid, targets: [ref, ref] });
  },
  'For every 3 [egg] in your [wetland], draw 1 [card] from the deck. You may tuck up to 2 [card] from your hand behind this bird.': (s, pid, ref) => {
    const n = Math.floor(eggsInHabitat(getPlayer(s, pid), 'wetland') / 3);
    if (n > 0) s = drawFromDeck(s, pid, n);
    return pushPending(s, { kind: 'assignHandTucks', playerId: pid, targets: [ref, ref] });
  },
  'For every 3 [egg] in your [forest], gain 1 [invertebrate] or [seed] from the supply. You may cache up to 2 of them on this bird.': gainPer3Eggs('forest'),
  'For every 3 [egg] in your [grassland], gain 1 [invertebrate] or [seed] from the supply. You may cache up to 2 of them on this bird.': gainPer3Eggs('grassland'),
  'For each bird in this column with an [egg] on it, draw 1 [card]. Keep 1 and discard the rest.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    let n = 0;
    for (const h of HABITATS) {
      const b = p.board[h][ref.index];
      if (b && !b.ghost && b.eggs > 0) n++;
    }
    if (n === 0) return appendLog(s, `${pid}: no eggs in this column`);
    return drawThenEndDiscard(n, n - 1)(s, pid, ref);
  },
  'Activate the “When Activated” (brown) powers of all of your other [predator].': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    for (const { ref: r, bird: b } of playedBirds(p)) {
      if (sameRef(r, ref)) continue;
      const c = bird(b.cardId);
      if (c.predator && c.powerColor === 'brown' && c.powerText && hasPowerImpl(c.id)) {
        s = runPower(s, pid, r);
      }
    }
    return s;
  },
  'Roll all 5 [die]. You may reroll any number of [die], up to 2 times. If at least 3 [rodent] are showing when you stop, draw 2 bonus cards and keep 1. Reset the birdfeeder.': (s, pid) => {
    s = appendLog(refillFeeder(s), `${pid}: rolled all 5 dice`);
    return pushPending(s, {
      kind: 'chooseReroll',
      playerId: pid,
      then: { effect: 'asiaEagleEval', n: [2] },
    });
  },
  'You may cache 1 [wild] from your supply on each bird in this row.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    const steps: PendingStep[] = playedBirds(p)
      .filter(({ ref: r }) => r.habitat === ref.habitat)
      .map(({ ref: r }) => ({
        kind: 'chooseCacheFromSupply',
        playerId: pid,
        bird: r,
        count: 1,
        food: 'any' as const,
        optional: true,
      }));
    return pushPending(s, ...steps);
  },
  'You may cache 1 [wild] from your supply on each of your other birds.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    const steps: PendingStep[] = playedBirds(p)
      .filter(({ ref: r }) => !sameRef(r, ref))
      .map(({ ref: r }) => ({
        kind: 'chooseCacheFromSupply',
        playerId: pid,
        bird: r,
        count: 1,
        food: 'any' as const,
        optional: true,
      }));
    return pushPending(s, ...steps);
  },
  'Draw 5 [card] from the deck. Add 1 to your hand, tuck 1 behind this bird, and discard the rest.': draw5HandTuck('discard'),
  'Draw 5 [card] from the deck. Add 1 to your hand, tuck 1 behind this bird, give 1 to another player, and discard the rest.': draw5HandTuck('give'),
  'Lay 1 [egg] on this bird for each bird to its left in this row.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    const n = p.board[ref.habitat].slice(0, ref.index).filter((b) => !b.ghost).length;
    return n > 0 ? setPlayer(s, addEggs(p, ref, n)) : s;
  },

  // --- when activated (brown) ---
  'All players draw 1 [card] from the deck and gain 1 [invertebrate] from the supply. You draw 1 additional [card] from the deck.': (s, pid) => {
    let out = s;
    for (const p2 of out.playerOrder) {
      out = drawFromDeck(out, p2, 1);
      out = grantSupplyFood(out, p2, 'invertebrate');
    }
    return drawFromDeck(out, pid, 1);
  },
  'All players gain 1 [seed] from the supply. You also lay 1 [egg].': (s, pid, ref) => {
    const out = allGainSupply('seed')(s, pid, ref);
    return pushPending(out, { kind: 'chooseBirdForEgg', playerId: pid, count: 1, nest: 'any' });
  },
  'All players lay 1 [egg].': allLayEggs(1),
  'All players lay 1 [egg]. You lay 1 additional [egg].': allLayEggs(1, 1),
  'All players may cache 1 [invertebrate] from their personal supply on a bird in their [grassland].': allMayCacheOn('invertebrate', 'grassland'),
  'All players may discard 1 [seed] from their supply to lay 1 [egg].': eachPlayerStep((pid) => ({
    kind: 'chooseFoodDiscard',
    playerId: pid,
    count: 1,
    options: ['seed'],
    optional: true,
    then: { effect: 'anyEgg' },
  })),
  'All players may tuck a [card] from their hand under a bird in their [forest] and/or cache 1 [fruit] from their supply on a bird in their [forest].': eachPlayerStep((pid) => ({
    kind: 'chooseBirds',
    playerId: pid,
    min: 0,
    max: 1,
    habitat: 'forest',
    then: { effect: 'asiaTuckCacheForest' },
  })),
  'Cache 1 [invertebrate], [seed], or [fruit] from the birdfeeder on this bird, if there is one.': (s, pid, ref) => {
    const avail = s.feederIn.some((f) =>
      (['invertebrate', 'seed', 'fruit'] as const).some((w) => faceCovers(f, w)),
    );
    if (!avail) return appendLog(s, `${pid}: no matching die in feeder`);
    return pushPending(s, {
      kind: 'pickDie',
      playerId: pid,
      count: 1,
      faces: ['invertebrate', 'seed', 'fruit'],
      then: { effect: 'cacheLastGained', bird: ref },
    });
  },
  'Cache 1 [wild] from your supply on any bird. If you do, you may tuck 1 [card] from your hand behind this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseBirds',
      playerId: pid,
      min: 0,
      max: 1,
      then: { effect: 'asiaCrowCache', bird: ref },
    }),
  'Cache 1 [wild] from your supply on this bird or tuck 1 [card] from your hand behind this bird. If you do either, tuck 1 [card] from the deck behind this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseOption',
      playerId: pid,
      options: ['asiaCacheWild', 'asiaTuckHand'],
      then: { effect: 'asiaOptionDone', bird: ref },
    }),
  'Choose any 1 [die]. Roll it one for each of your [wetland] birds. If you roll at least 1 [fish], gain 1 from the supply. You may cache it on this bird.': (s, pid, ref) => {
    const n = playedBirds(getPlayer(s, pid)).filter(({ ref: r }) => r.habitat === 'wetland').length;
    if (n === 0) return appendLog(s, `${pid}: no wetland birds`);
    const { s: s1, faces } = rollDice(s, n);
    let out = appendLog(s1, `${pid}: rolled ${faces.join(', ')}`);
    if (faces.includes('fish')) {
      out = grantSupplyFood(out, pid, 'fish');
      out = pushPending(out, { kind: 'chooseCacheGained', playerId: pid, bird: ref, food: 'fish' });
    }
    return out;
  },
  'Choose any 1 [die]. Roll it up to 3 times. Each time, if you roll a [invertebrate], [fish], or [rodent], cache 1 here. If not, stop and return all food cached here this turn.': riskyRoll(1, ['invertebrate', 'fish', 'rodent']),
  'Choose any 2 [die]. Roll them up to 3 times. Each time, if you roll at least 1 [invertebrate] or [fish], cache 1 here. If not, stop and return all food cached here this turn.': riskyRoll(2, ['invertebrate', 'fish']),
  'Choose any 2 [die]. Roll them up to 3 times. Each time, if you roll at least 1 [invertebrate] or [rodent], cache 1 here. If not, stop and return all food cached here this turn.': riskyRoll(2, ['invertebrate', 'rodent']),
  'Choose any 3 [die]. Roll them up to 3 times. Each time, if you roll at least 1 [fish] or [rodent], cache 1 here. If not, stop and return all food cached here this turn.': riskyRoll(3, ['fish', 'rodent']),
  'Copy the “When Activated” (brown) power of a bird in the [grassland] of the player on your left.': (s, pid, ref) => {
    const target = playerToLeft(s, pid);
    if (!target) return appendLog(s, `${pid}: no player to the left`);
    return pushPending(s, {
      kind: 'chooseCopyPower',
      playerId: pid,
      target,
      habitat: 'grassland',
      then: { effect: 'copyPower', bird: ref },
    });
  },
  'Count the [egg] on all of your birds. If the total is fewer than 6 [egg], lay 1 [egg] on this bird.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    if (totalEggs(p) >= 6) return appendLog(s, `${pid}: already has 6+ eggs`);
    return setPlayer(s, addEggs(p, ref, 1));
  },
  'Discard 1 [card] from your hand. If you do, lay 1 [egg] on this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseHandDiscard',
      playerId: pid,
      count: 1,
      optional: true,
      then: { effect: 'selfEgg', bird: ref },
    }),
  'Discard 1 [egg]. If you do, gain 1 [invertebrate] from the supply.': (s, pid) =>
    pushPending(s, {
      kind: 'chooseBirdForEggDiscard',
      playerId: pid,
      count: 1,
      optional: true,
      then: { effect: 'supplyFood', ids: [FOOD_TYPES.indexOf('invertebrate')] },
    }),
  'Discard 1 [seed]. If you do, lay 1 [egg] on this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseFoodDiscard',
      playerId: pid,
      count: 1,
      options: ['seed'],
      optional: true,
      spentHabitat: ref.habitat,
      then: { effect: 'selfEgg', bird: ref },
    }),
  'Discard any number of [card] from the tray then refill it. If at least one of the discarded birds is a [grassland] bird, lay 1 [egg] on this bird.': trayDiscardCheck('grassland'),
  'Discard any number of [card] from the tray, then refill it. If at least 1 of the discarded birds is a [predator], lay 1 [egg] on this bird.': trayDiscardCheck('predator'),
  'Draw 1 [card] for each bird in your [wetland] with an [egg] on it. Keep 1 and discard the rest.': (s, pid, ref) => {
    const n = playedBirds(getPlayer(s, pid)).filter(
      ({ ref: r, bird: b }) => r.habitat === 'wetland' && b.eggs > 0,
    ).length;
    if (n === 0) return appendLog(s, `${pid}: no wetland birds with eggs`);
    return drawThenEndDiscard(n, n - 1)(s, pid, ref);
  },
  'Draw 1 [card] from the deck and add it to your hand. All other players draw 1 [card] from the deck and add it to their hand if the bird has a [invertebrate] or [seed] in its food cost.': drawKeepIf((c) => costHasFood(c, ['invertebrate', 'seed'])),
  'Draw 1 [card] from the deck and add it to your hand. All other players draw 1 [card] from the deck and keep it if it can live in [wetland].': drawKeepIf((c) => c.habitats.includes('wetland')),
  'Draw the [card] in the middle slot of the bird tray.': (s, pid) =>
    s.tray[1] != null
      ? takeTrayCard(s, pid, 1)
      : appendLog(s, `${pid}: middle tray slot is empty`),
  'Each player may discard 1 [egg] to draw 1 [card] from the deck.': eachPlayerStep((pid) => ({
    kind: 'chooseBirdForEggDiscard',
    playerId: pid,
    count: 1,
    optional: true,
    then: { effect: 'drawCards', n: [1] },
  })),
  'Each player may roll any 1 [die] and gain that food from the supply.': (s) => {
    let out = s;
    for (const pid of out.playerOrder) {
      const { s: s1, faces } = rollDice(out, 1);
      out = s1;
      const f = faces[0]!;
      if (f === 'split') {
        out = pushPending(out, {
          kind: 'chooseSupplyFood',
          playerId: pid,
          count: 1,
          options: ['invertebrate', 'seed'],
        });
      } else {
        out = grantSupplyFood(out, pid, f as FoodType);
      }
    }
    return out;
  },
  'For each bird in your [forest] with an egg on it, roll any 1 [die]. Choose 1 type of food you rolled and gain 1 of that food from the supply.': rollPerEggedGain('forest'),
  'For each bird in your [grassland] with an [egg] on it, roll any 1 [die]. Choose 1 type of food you rolled, and gain 1 of that food from the supply.': rollPerEggedGain('grassland'),
  'Gain 1 [invertebrate] or [fruit] from the birdfeeder, if there is one.': whenFeederGain(['invertebrate', 'fruit']),
  'Gain 1 [invertebrate] or [rodent] from the birdfeeder, if there is one. You may cache it on this bird.': whenFeederGain(['invertebrate', 'rodent'], 1, true),
  'Gain 1 [invertebrate] or [seed] from the birdfeeder, if there is one.': whenFeederGain(['invertebrate', 'seed']),
  'Gain 1 [invertebrate], [seed], or [fruit] from the supply.': (s, pid) =>
    pushPending(s, { kind: 'chooseSupplyFood', playerId: pid, count: 1, options: ['invertebrate', 'seed', 'fruit'] }),
  'Gain 1 [seed] from the supply or tuck 1 [card] from the deck behind this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseOption',
      playerId: pid,
      options: ['gainSeed', 'tuckDeckCard'],
      then: { effect: 'asiaOptionDone', bird: ref },
    }),
  'Give 1 [card] from your hand to another player. If you do, draw 2 [card].': giveCardThen('draw2'),
  'Give 1 [card] from your hand to another player. If you do, lay 2 [egg] on this bird.': giveCardThen('eggs2'),
  'If there is at least 1 bird on the tray that has [invertebrate] in its food cost, tuck 1 of them behind this bird.': (s, pid, ref) => {
    if (!s.tray.some((id) => id != null && costHasFood(bird(id), ['invertebrate']))) {
      return appendLog(s, `${pid}: no tray bird costs [invertebrate]`);
    }
    return pushPending(s, {
      kind: 'chooseTrayCardEx',
      playerId: pid,
      costFoods: ['invertebrate'],
      destination: 'tuck',
      bird: ref,
    });
  },
  'If this bird has no birds to the right of it, you may move it (only the card) to the player mat of the player on your left (you choose its habitat). If you do, draw 3 [card].': moveToNeighbor('left'),
  'If this bird has no birds to the right of it, you may move it (only the card) to the player mat of the player on your right (you choose its habitat). If you do, draw 3 [card].': moveToNeighbor('right'),
  'If you have at least 1 [fruit] in your supply, lay 1 [egg] on this bird.': (s, pid, ref) => {
    const p = getPlayer(s, pid);
    if (p.food.fruit <= 0) return appendLog(s, `${pid}: no fruit in supply`);
    return setPlayer(s, addEggs(p, ref, 1));
  },
  'If you have gained a [invertebrate] from the birdfeeder on this turn, gain 1 [fruit] from the supply.': (s, pid) => {
    const p = getPlayer(s, pid);
    if (!p.feederGainedThisTurn.includes('invertebrate')) {
      return appendLog(s, `${pid}: gained no feeder invertebrate this turn`);
    }
    return grantSupplyFood(s, pid, 'fruit');
  },
  'If you laid an [egg] on this bird this turn, tuck 1 [card] from the deck behind this bird.': (s, pid, ref) => {
    const b = getPlayer(s, pid).board[ref.habitat]?.[ref.index];
    if (!b || !(b.eggsGainedThisTurn ?? 0)) {
      return appendLog(s, `${pid}: no egg laid on this bird this turn`);
    }
    let out = tuckFromDeck(s, pid, ref, 1);
    return firePinkTriggers(out, pid, { kind: 'tuck' });
  },
  'Lay 1 [egg] on another bird in this column.': (s, pid, ref) =>
    pushPending(s, { kind: 'chooseBirdForEgg', playerId: pid, count: 1, nest: 'any', columnOf: ref }),
  'Roll any 1 [die]. If you roll a [invertebrate], cache 1 [invertebrate] from the supply on this bird. All players may discard 1 [card] from their hand to gain 1 [invertebrate] from the supply.': rollAnyDiceCache(1, 'invertebrate', 'invertebrate'),
  'Roll any 2 [die]. If you roll at least 1 [fish], cache 1 [fish] from the supply on this bird. All players may discard 1 [card] from their hand to gain 1 [fish] from the supply.': rollAnyDiceCache(2, 'fish', 'fish'),
  'Roll any 3 [die]. If you roll at least 1 [rodent], cache 1 [rodent] on this bird.': rollAnyDiceCache(3, 'rodent'),
  'Tuck 1 [card] from your hand behind this bird. If you do, gain 1 [invertebrate], [seed], or [fruit] from the birdfeeder.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'chooseHandTuck',
      playerId: pid,
      bird: ref,
      optional: true,
      then: { effect: 'asiaPickDieISF' },
    }),
  'Tuck up to 3 [card] from your hand behind this bird.': (s, pid, ref) =>
    pushPending(s, { kind: 'assignHandTucks', playerId: pid, targets: [ref, ref, ref] }),
  'Tuck up to 3 [card] from your hand behind this bird. If you tuck at least 1 [card], gain 1 [invertebrate] from the supply.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'assignHandTucks',
      playerId: pid,
      targets: [ref, ref, ref],
      then: { effect: 'gainIfTucked', ids: [FOOD_TYPES.indexOf('invertebrate')] },
    }),
  'Tuck up to 3 [card] from your hand behind this bird. If you tuck at least 1 [card], lay 1 [egg] on this bird.': (s, pid, ref) =>
    pushPending(s, {
      kind: 'assignHandTucks',
      playerId: pid,
      targets: [ref, ref, ref],
      then: { effect: 'selfEggIfTucked', bird: ref },
    }),
  'Up to 3 times, draw 1 [card] from the deck. When you stop, if the birds\' total wingspan is less than 110 cm, tuck them behind this bird. If not, discard them.': drawUpToWingspan(3, 110),
  'You may move 1 [fish] from this bird to your supply. Then, roll any 2 [die]. If any are [fish], cache 1 [fish] on this bird from the supply.': (s, pid, ref) => {
    const b = getPlayer(s, pid).board[ref.habitat]?.[ref.index];
    if (b?.cached.includes('fish')) {
      s = pushPending(s, {
        kind: 'confirm',
        playerId: pid,
        then: { effect: 'asiaMoveCachedFish', bird: ref },
      });
    }
    const { s: s1, faces } = rollDice(s, 2);
    let out = appendLog(s1, `${pid}: rolled ${faces.join(', ')}`);
    if (faces.includes('fish')) {
      out = cacheOnBird(out, pid, ref, 'fish');
      out = firePinkTriggers(out, pid, { kind: 'predatorSuccess' });
    }
    return out;
  },
};

// === pink powers (once between turns) ===

export type PinkTrigger =
  | { kind: 'layEggs' }
  /** `food` omitted = fires on the action regardless of what was gained. */
  | { kind: 'gainFood'; food?: FoodType }
  | { kind: 'playBird'; habitat: 'forest' | 'grassland' | 'wetland' }
  | { kind: 'predatorSuccess' }
  | { kind: 'tuck' }
  /** Oceania: fires whenever another player gains nectar (feeder or supply). */
  | { kind: 'gainNectar' };

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

  // === european expansion pinks ===
  'When another player takes the “lay eggs” action, this bird lays 1 [egg] on another bird with a [bowl] or [ground] nest.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner, ref) =>
      pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId: owner,
        count: 1,
        nest: ['bowl', 'ground'],
        exclude: ref,
      }),
  },
  'When another player takes the “gain food” action, gain 1 [invertebrate] or [fruit] from the birdfeeder at the end of their turn.': {
    trigger: { kind: 'gainFood' },
    fn: (s, owner, ref) => gainDice(1, { faces: ['invertebrate', 'fruit'] })(s, owner, ref),
  },
  'When another player takes the “gain food” action, gain 1 [seed] from the birdfeeder at the end of their turn.': {
    trigger: { kind: 'gainFood' },
    fn: (s, owner, ref) => gainDice(1, { faces: ['seed'] })(s, owner, ref),
  },
  'When another player tucks a [card] for any reason, tuck 1 [card] from the deck behind this bird.': {
    trigger: { kind: 'tuck' },
    fn: (s, owner, ref) => tuckFromDeck(s, owner, ref, 1),
  },
  'When another player tucks a [card] for any reason, tuck 1 [card] from your hand behind this bird, then draw 1 [card] at the end of their turn.': {
    trigger: { kind: 'tuck' },
    fn: (s, owner, ref) =>
      pushPending(s, {
        kind: 'chooseHandTuck',
        playerId: owner,
        bird: ref,
        optional: true,
        then: { effect: 'drawCards', n: [1] },
      }),
  },

  // === oceania expansion pinks ===
  'When another player takes the “gain food” action, gain 1 [invertebrate] from the birdfeeder, if there is one, at the end of their turn.': {
    trigger: { kind: 'gainFood' },
    fn: (s, owner, ref) => gainDice(1, { faces: ['invertebrate'] })(s, owner, ref),
  },
  'When another player takes the “gain food” action, gain 1 [invertebrate], [fish], or [rodent] from the birdfeeder, if there is one, at the end of their turn.': {
    trigger: { kind: 'gainFood' },
    fn: (s, owner, ref) => gainDice(1, { faces: ['invertebrate', 'fish', 'rodent'] })(s, owner, ref),
  },
  'When another player takes the “lay eggs” action, lay 1 [egg] on a bird with a wingspan less than 30cm.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner) =>
      pushPending(s, { kind: 'chooseBirdForEgg', playerId: owner, count: 1, nest: 'any', wingspanLt: 30 }),
  },
  'When another player takes the “lay eggs” action, lay 1 [egg] on this bird.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner, ref) => setPlayer(s, addEggs(getPlayer(s, owner), ref, 1)),
  },
  'When another player gains [nectar], gain 1 [nectar] from the supply.': {
    trigger: { kind: 'gainNectar' },
    fn: (s, owner) => grantSupplyFood(s, owner, 'nectar'),
  },

  // === asia expansion pinks ===
  'When another player takes the “lay eggs” action, this bird lays 1 [egg] on another bird with a [platform] nest. You may go 3 over its egg limit while using this power.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner, ref) =>
      pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId: owner,
        count: 1,
        nest: 'platform',
        exclude: ref,
        overLimit: 3,
      }),
  },
  'When another player takes the “lay eggs” action, lay 1 [egg] on another bird with wingspan less than 30 cm. You may go 2 over its egg limit while using this power.': {
    trigger: { kind: 'layEggs' },
    fn: (s, owner, ref) =>
      pushPending(s, {
        kind: 'chooseBirdForEgg',
        playerId: owner,
        count: 1,
        nest: 'any',
        exclude: ref,
        wingspanLt: 30,
        overLimit: 2,
      }),
  },
};

// === helpers used by the registries ===

function takeAllMatching(state: GameState, playerId: PlayerId, want: FoodType, stopAtRefill = false): GameState {
  let s = state;
  // Cap at 10 takes: an all-matching refill would otherwise loop forever.
  for (let taken = 0; taken < 10 && s.feederIn.length > 0; taken++) {
    const idx = s.feederIn.findIndex((f) => faceCovers(f, want));
    if (idx < 0) break;
    s = takeDieFromFeeder(s, playerId, idx, want === 'invertebrate' || want === 'seed' ? want : undefined);
    // Official rule (EE): when the feeder empties mid-power and refills, the
    // power is done — no extra food is gained from the new dice.
    if (stopAtRefill && s.feederIn.length === FEEDER_SIZE) break;
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
  // "Once between turns" powers never fire from round-end (teal) or
  // game-end (yellow) resolution — only during the main phase.
  if (state.phase !== 'main') return state;
  let s = state;
  for (const p of s.players) {
    if (p.id === actor) continue;
    for (const { ref, bird: b } of playedBirds(p)) {
      if (b.pinkUsed) continue;
      const card = BIRD_BY_ID.get(b.cardId);
      if (!card || card.powerColor !== 'pink' || !card.powerText) continue;
      const def = PINK_IMPLS[card.powerText];
      if (!def || def.trigger.kind !== trigger.kind) continue;
      if (trigger.kind === 'gainFood' && 'food' in trigger && def.trigger.kind === 'gainFood' && def.trigger.food != null && def.trigger.food !== trigger.food) continue;
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

/** Reset per-turn state for `playerId` (at the start of their turn):
 *  pink-power availability and the foods-gained tracker. */
export function resetPinkFlags(state: GameState, playerId: PlayerId): GameState {
  let p = getPlayer(state, playerId);
  const board = { ...p.board };
  let changed = p.gainedThisTurn.length > 0 || p.feederGainedThisTurn.length > 0;
  for (const h of HABITATS) {
    board[h] = p.board[h].map((b) => {
      if (!b.pinkUsed && !b.eggsGainedThisTurn && !b.cachedGainedThisTurn) return b;
      changed = true;
      return { ...b, pinkUsed: false, eggsGainedThisTurn: 0, cachedGainedThisTurn: 0 };
    });
  }
  if (!changed) return state;
  p = { ...p, board, gainedThisTurn: [], feederGainedThisTurn: [] };
  return setPlayer(state, p);
}

export { FOOD_TYPES };
