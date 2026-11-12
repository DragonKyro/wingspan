// Static per-card features (one row per card id, shared by the encoder's
// tokens and the network's card table) and `summarizeSteps`, a fixed-size
// description of an ability AST (what it gains, pays and does). Both are pure
// functions of the printed card data — no game state.

import { parseAbility } from '../abilities';
import { CAVES, DRAGONS, cardAbilityTypes, parseTrainingTrack } from '../cards';
import type { CaveCard, DragonCard, GainItem, Step } from '../types';
import { RESOURCES } from '../types';

// ---------------------------------------------------------------------------
// Card index: row of the card table / embedding. 0 = no card.

const MAX_CARD_ID = Math.max(...DRAGONS.map((d) => d.id), ...CAVES.map((c) => c.id));
export const NUM_CARD_INDEX = MAX_CARD_ID + 2;
export const cardIndex = (id: number | null | undefined): number => (id == null ? 0 : id + 1);

// ---------------------------------------------------------------------------
// Steps summary

/** Gained items, in this order (counts). */
const GAIN_KEYS = ['meat', 'gold', 'crystal', 'milk', 'anyRes', 'dragonCard', 'caveCard', 'coin', 'egg', 'guild', 'vp', 'cache', 'tuck'] as const;
/** Paid items (optional "pay X to …" costs and discards). */
const PAY_KEYS = ['resource', 'dragonCard', 'caveCard', 'coin', 'egg', 'item'] as const;
/** Other effects (counts). */
const OP_KEYS = [
  'excavateFree', 'playDragonFree', 'activateAbility', 'trainFledgling', 'swap', 'drawDistribute', 'reveal',
  'opponentsGain', 'opponentsMay', 'perCounter', 'choice', 'repeat', 'conditional', 'recurring', 'unsupported',
] as const;

export const SUMMARY_DIM = GAIN_KEYS.length + PAY_KEYS.length + OP_KEYS.length;
const G = (k: (typeof GAIN_KEYS)[number]) => GAIN_KEYS.indexOf(k);
const P = (k: (typeof PAY_KEYS)[number]) => GAIN_KEYS.length + PAY_KEYS.indexOf(k);
const O = (k: (typeof OP_KEYS)[number]) => GAIN_KEYS.length + PAY_KEYS.length + OP_KEYS.indexOf(k);

function addGain(out: Float32Array, it: GainItem, w: number): void {
  switch (it.kind) {
    case 'resource':
      out[it.res === 'any' ? G('anyRes') : G(it.res)]! += it.count * w;
      break;
    case 'card':
      out[it.deck === 'dragon' ? G('dragonCard') : G('caveCard')]! += it.count * w;
      break;
    case 'coin':
      out[G('coin')]! += it.count * w;
      break;
    case 'egg':
      out[G('egg')]! += it.count * w;
      break;
    case 'guild':
      out[G('guild')]! += it.count * w;
      break;
    case 'vp':
      out[G('vp')]! += it.count * w;
      break;
    case 'tithe':
    case 'item':
      out[G('anyRes')]! += it.count * w;
      break;
  }
}

function addPay(out: Float32Array, it: GainItem, w: number): void {
  switch (it.kind) {
    case 'resource':
      out[P('resource')]! += it.count * w;
      break;
    case 'card':
      out[it.deck === 'dragon' ? P('dragonCard') : P('caveCard')]! += it.count * w;
      break;
    case 'coin':
      out[P('coin')]! += it.count * w;
      break;
    case 'egg':
      out[P('egg')]! += it.count * w;
      break;
    default:
      out[P('item')]! += it.count * w;
  }
}

/** Accumulate a summary of `steps` (weight `w`) into `out` (length SUMMARY_DIM). */
export function summarizeSteps(steps: readonly Step[], out: Float32Array = new Float32Array(SUMMARY_DIM), w = 1): Float32Array {
  for (const st of steps) {
    switch (st.op) {
      case 'gain':
        for (const it of st.items) addGain(out, it, w);
        break;
      case 'gainPer':
        // "for each X": counted once per unit; ~2 units is a typical yield.
        out[O('perCounter')]! += w;
        for (const it of st.items) addGain(out, it, 2 * w);
        break;
      case 'opponentsGain':
        out[O('opponentsGain')]! += w;
        break;
      case 'opponentsMay':
        out[O('opponentsMay')]! += w;
        break;
      case 'layEggs':
        out[G('egg')]! += st.count * w * (st.target.kind.startsWith('each') ? 2 : 1);
        break;
      case 'layPer':
        out[O('perCounter')]! += w;
        out[G('egg')]! += 2 * st.per * w;
        break;
      case 'cache':
        out[G('cache')]! += st.count * w * (st.target.kind.startsWith('each') ? 2 : 1);
        if (st.from === 'supply') out[P('resource')]! += st.count * w;
        break;
      case 'tuck':
        out[G('tuck')]! += st.count * w * (st.target.kind.startsWith('each') ? 2 : 1);
        if (st.from === 'hand') out[P('dragonCard')]! += st.count * w;
        break;
      case 'tuckPer':
        out[O('perCounter')]! += w;
        out[G('tuck')]! += 2 * st.per * w;
        break;
      case 'pay':
        for (const it of st.cost) addPay(out, it, w * (st.repeat ?? 1));
        summarizeSteps(st.then, out, w * (st.repeat ?? 1));
        break;
      case 'discardFromHand': {
        const n = st.perCard ? st.count : 1;
        addPay(out, { kind: 'card', deck: st.what === 'cave' ? 'cave' : 'dragon', count: st.count }, w);
        summarizeSteps(st.then, out, w * n);
        break;
      }
      case 'drawDistribute':
        out[O('drawDistribute')]! += w;
        out[st.deck === 'dragon' ? G('dragonCard') : G('caveCard')]! += (st.keep ?? (st.orKeep ? 1 : 0)) * w;
        if (st.tuck) out[G('tuck')]! += (st.tuck === 'rest' ? st.count - (st.keep ?? 0) : st.tuck) * w;
        if (st.playFree) out[O(st.deck === 'dragon' ? 'playDragonFree' : 'excavateFree')]! += st.playFree * w;
        break;
      case 'drawPer':
        out[O('perCounter')]! += w;
        out[st.deck === 'dragon' ? G('dragonCard') : G('caveCard')]! += 2 * w;
        if (st.tuck) out[G('tuck')]! += st.tuck * w;
        break;
      case 'reveal':
        out[O('reveal')]! += w;
        summarizeSteps(st.yes, out, w * 0.5);
        summarizeSteps(st.no, out, w * 0.5);
        break;
      case 'keepRevealed':
        out[G('dragonCard')]! += w;
        break;
      case 'tuckRevealed':
        out[G('tuck')]! += w;
        break;
      case 'excavateFree':
        out[O('excavateFree')]! += st.count * w * (st.activateTimes ?? 1);
        break;
      case 'playDragonFree':
        out[O('playDragonFree')]! += w;
        break;
      case 'activateAbility':
        out[O('activateAbility')]! += st.count * w;
        break;
      case 'trainFledgling':
        out[O('trainFledgling')]! += (st.times === 'full' ? 3 : st.times) * w;
        break;
      case 'swapDragons':
      case 'swapHandDragon':
      case 'swapCaveCard':
        out[O('swap')]! += w;
        break;
      case 'gamblerDraw':
        out[G('anyRes')]! += 1.5 * w;
        break;
      case 'gamblerEndGameDraw':
        out[G('vp')]! += 8 * w;
        break;
      case 'gainTuckedPrintedResource':
        out[G('anyRes')]! += st.count * w;
        break;
      case 'advanceGuild':
        out[G('guild')]! += st.count * w;
        break;
      case 'withCtx':
        summarizeSteps(st.steps, out, w);
        break;
      case 'vp':
        out[G('vp')]! += st.count * w;
        break;
      case 'chooseBenefits':
        out[O('choice')]! += w;
        for (const opt of st.options) for (const it of opt) addGain(out, it, (w * st.count) / st.options.length);
        break;
      case 'chooseOption':
        out[O('choice')]! += w;
        for (const opt of st.options) summarizeSteps(opt.steps, out, w / st.options.length);
        break;
      case 'chooseResourceGain':
        out[O('choice')]! += w;
        out[G('anyRes')]! += st.selfCount * w;
        out[O('opponentsGain')]! += w;
        break;
      case 'repeat':
        out[O('repeat')]! += w;
        summarizeSteps(st.steps, out, w * st.times);
        break;
      case 'if':
        out[O('conditional')]! += w;
        summarizeSteps(st.then, out, w * 0.5);
        if (st.else) summarizeSteps(st.else, out, w * 0.5);
        break;
      case 'recurring':
        out[O('recurring')]! += w;
        summarizeSteps(st.eachSteps, out, w * 2);
        summarizeSteps(st.thirdGain, out, w * 0.5);
        break;
      case 'unsupported':
        out[O('unsupported')]! += w;
        break;
      default:
        break; // walk/plumbing ops (exploreStep, offerFledglingTrain, gainCoveredItem, discardRevealed)
    }
  }
  return out;
}

/** Rough VP worth of a steps summary — the heuristic's (and pruning's) common currency. */
/** Worth of each item in points (the exchange rate an evaluation uses). */
export interface ItemValues {
  resource: number;
  card: number;
  egg: number;
  coin: number;
  guild: number;
}

/** A fixed mid-game exchange rate, for priors and features (the heuristic uses its own, round-aware). */
export const MIDGAME_VALUES: ItemValues = { resource: 0.7, card: 0.55, egg: 1, coin: 1.5, guild: 1 };

export function summaryValue(sum: Float32Array, itemValue: ItemValues = MIDGAME_VALUES): number {
  const iv = itemValue;
  let v = 0;
  for (const k of ['meat', 'gold', 'crystal', 'milk', 'anyRes'] as const) v += sum[G(k)]! * iv.resource * (k === 'anyRes' ? 1.1 : 1);
  v += (sum[G('dragonCard')]! + sum[G('caveCard')]!) * iv.card;
  v += sum[G('coin')]! * iv.coin + sum[G('egg')]! * iv.egg;
  v += sum[G('guild')]! * iv.guild + sum[G('vp')]! + sum[G('cache')]! + sum[G('tuck')]!;
  v -= sum[P('resource')]! * iv.resource + (sum[P('dragonCard')]! + sum[P('caveCard')]!) * iv.card;
  v -= sum[P('coin')]! * iv.coin + sum[P('egg')]! * iv.egg + sum[P('item')]! * (iv.resource + iv.card) / 2;
  // Free plays save the action's coin and (for dragons) a typical cost.
  v += sum[O('excavateFree')]! * (iv.coin + 0.5) + sum[O('playDragonFree')]! * (iv.coin + 2.5 * iv.resource);
  v += sum[O('activateAbility')]! * 1.5 + sum[O('trainFledgling')]! * iv.resource;
  v += sum[O('swap')]! * 0.3 + sum[O('drawDistribute')]! * iv.card * 0.7 + sum[O('recurring')]! * 0.5;
  return v;
}

// ---------------------------------------------------------------------------
// Static card table

const SIZES = ['Hatchling', 'Fledgling', 'Small', 'Medium', 'Large'] as const;
const PERSONALITIES = ['Shy', 'Playful', 'Helpful', 'Aggressive'] as const;
const ABILITY_TYPES = ['Adventurer', 'WhenPlayed', 'OncePerRound', 'EndGame'] as const;
const CAVE_NAMES = ['Crimson Cavern', 'Golden Grotto', 'Amethyst Abyss'] as const;

/** 2 kind + 1 vp + 5 size + 4 personality + 7 cost + 1 capacity + 4 ability types + 3 caves
 *  + 1 ignoreCost + 5 training + 1 academy + 5 end-game + SUMMARY_DIM ability summary + 1 ability value. */
export const CARD_STATIC_DIM = 2 + 1 + 5 + 4 + 7 + 1 + 4 + 3 + 1 + 5 + 1 + 5 + SUMMARY_DIM + 1;

const summaryCache = new Map<number, Float32Array>();

/** Summary of a card's printed ability (cached). */
export function abilitySummary(card: DragonCard | CaveCard): Float32Array {
  let s = summaryCache.get(card.id);
  if (!s) {
    s = card.ability ? summarizeSteps(parseAbility(card).steps) : new Float32Array(SUMMARY_DIM);
    summaryCache.set(card.id, s);
  }
  return s;
}

function dragonRow(d: DragonCard, out: Float32Array): void {
  let i = 0;
  out[i++] = 1; // dragon
  out[i++] = 0;
  out[i++] = d.vp / 9;
  for (const sz of SIZES) out[i++] = d.size === sz ? 1 : 0;
  for (const pe of PERSONALITIES) out[i++] = d.personality === pe ? 1 : 0;
  for (const r of RESOURCES) out[i++] = (d.cost[r] ?? 0) / 3;
  out[i++] = (d.cost.coin ?? 0) / 3;
  out[i++] = (d.cost.egg ?? 0) / 3;
  out[i++] = RESOURCES.reduce((a, r) => a + (d.cost[r] ?? 0), 0) / 5;
  out[i++] = d.capacity / 5;
  const types = cardAbilityTypes(d);
  for (const t of ABILITY_TYPES) out[i++] = types.includes(t) ? 1 : 0;
  for (const c of CAVE_NAMES) out[i++] = d.caves.includes(c) ? 1 : 0;
  out[i++] = d.ignoreCost ? 1 : 0;
  const track = parseTrainingTrack(d.trainingTrack);
  out[i++] = track.length / 5;
  out[i++] = track.filter((t) => t.kind === 'resource').length / 3;
  out[i++] = track.filter((t) => t.kind === 'egg').length / 3;
  out[i++] = track.filter((t) => t.kind === 'card').length / 3;
  out[i++] = track.filter((t) => t.kind === 'coin').length / 3;
  out[i++] = d.expansion === 'academy' ? 1 : 0;
  const def = d.ability ? parseAbility(d) : null;
  const eg = def?.endGame;
  out[i++] = eg ? 1 : 0;
  out[i++] = eg ? eg.vpPer / 5 : 0;
  out[i++] = eg?.counter ? 1 : 0;
  out[i++] = eg?.cond ? 1 : 0;
  out[i++] = eg?.max !== undefined ? eg.max / 15 : 0;
  const sum = abilitySummary(d);
  out.set(sum, i);
  i += SUMMARY_DIM;
  out[i++] = summaryValue(sum) / 5;
  if (i !== CARD_STATIC_DIM) throw new Error(`dragon row has ${i} features, expected ${CARD_STATIC_DIM}`);
}

function caveRow(c: CaveCard, out: Float32Array): void {
  out[0] = 0;
  out[1] = 1; // cave card
  // Cave cards have only a when-played ability (an excavation reward).
  const at = 2 + 1 + 5 + 4 + 7 + 1;
  out[at + 1] = 1; // WhenPlayed
  out[at + 4 + 3 + 1 + 5] = c.expansion === 'academy' ? 1 : 0;
  const sumAt = CARD_STATIC_DIM - SUMMARY_DIM - 1;
  const sum = abilitySummary(c);
  out.set(sum, sumAt);
  out[CARD_STATIC_DIM - 1] = summaryValue(sum) / 5;
}

let table: Float32Array | null = null;

/** NUM_CARD_INDEX × CARD_STATIC_DIM, row-major; row 0 (no card) is zeros. */
export function cardStaticTable(): Float32Array {
  if (table) return table;
  const t = new Float32Array(NUM_CARD_INDEX * CARD_STATIC_DIM);
  for (const d of DRAGONS) dragonRow(d, t.subarray(cardIndex(d.id) * CARD_STATIC_DIM, (cardIndex(d.id) + 1) * CARD_STATIC_DIM));
  for (const c of CAVES) caveRow(c, t.subarray(cardIndex(c.id) * CARD_STATIC_DIM, (cardIndex(c.id) + 1) * CARD_STATIC_DIM));
  table = t;
  return t;
}
