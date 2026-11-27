// The Wyrmspan heuristic AI (the app's AI; ~76 points in 2p, ~75 solo): a
// one-ply lookahead over the move list (moves.ts). On a turn decision the best
// WEIGHTS.planBeam moves are also judged by the best plan of up to
// WEIGHTS.planDepth own turns they set up (a pruned search over major
// decisions: excavate → explore for resources → entice; see planValue).
//
// For each move it applies the move's actions to a *determinized*
// copy of the player's redacted view (hidden cards dealt at random from the
// public pool — never the real deck), resolves the player's own follow-up
// choices value-greedily, and scores the result with `positionValue`: the
// points the game would award now, plus what coins (future turns), resources,
// hand, cave walks (explore yield × explores still expected), once-per-round
// abilities and income are still worth. All moves share one
// determinization (common random numbers).
//
// Points-maximizing by design — it ignores opponents except through the
// public objective standings.

import { answerFor } from '../ai';
import { cardAbilityTypes, caveCard, dragonCard, isDragonCard, trainingTrackLength } from '../cards';
import { applyAction } from '../engine';
import { GUILD_TRACK, INCOME_SECTIONS, incomeSectionIndex } from '../guild';
import { allDragons, player } from '../helpers';
import { parseAbility } from '../abilities';
import { scoreObjective } from '../objectives';
import { scorePlayer } from '../scoring';
import type { Action, DragonCard, GainItem, GameState, PlayerId, PlayerState, Resource } from '../types';
import { RESOURCES } from '../types';
import { type Move, legalMoves } from './moves';
import { type ItemValues, abilitySummary, summaryValue } from './summary';
import { CAVE_INDEX, abilityActive, enticeOptions, exploreYield, freeEggCapacity, totalResources } from './rules';
import { determinize, redact, visibleSeed } from './view';

// ---------------------------------------------------------------------------
// Static evaluation
//
// The currency is end-of-game points. Items that aren't points yet are priced
// with a strong player's rule-of-thumb exchange rate early on — coin 3 (a coin
// is a turn), guild advance 2, resource / egg / dragon card / cave card 1 —
// and decay to what they are actually worth at the end (coin 1, egg 1,
// resource / card 1/4 via leftovers, guild 0) as the rounds the player can
// still act in run out (see roundsLeft). A dragon is worth enticing when its
// points, ability and egg room beat its cost at that rate. On top of that:
//   cave walk  each cave's explore yield (path icons up to the first empty
//              space + Adventurer abilities walked past), net of the coin an
//              explore costs, × the explores still expected there — so filling
//              caves and Adventurers in the caves explored most pay off
//   income     each remaining round end's income, at the coin value it will have

/**
 * Tunable weights (exported so the benchmark can sweep them). Tuned with
 * scripts/wyrmspan/tune.ts on paired deals (results in scripts/wyrmspan/README.md):
 * 2026-11-18 — the two-turn plan, coin / guild 2.5, walkIcon 1.5 and
 * endGameUnits 2: +6.3 ± 0.8 over the hand-set weights in 2p;
 * 2026-11-25 — a 3-turn plan with pruning (planDepth 3, planBeam 8, deepBeam 3,
 * dedupeFrom 2, deepBudget 0) and partScale halfway to the weights fitted on
 * game outcomes: +2.7 ± 0.8 more in 2p (+3.7 solo, +3.2 3p) at ~1.2× the time.
 */
export const WEIGHTS = {
  /** Early-game worth of each item (from a strong player's exchange rate: coin 3, guild 2, the rest 1). */
  early: { coin: 2.5, guild: 2.5, resource: 1, card: 1, egg: 1 },
  /** End-game worth. */
  late: { coin: 1, guild: 0, resource: 0.25, card: 0.25, egg: 1 },
  /** Rounds-left value below which items are priced at their end-game worth. */
  endBias: 0.5,
  /** Evaluations per candidate for resolving follow-up choices value-greedily (0 = engine greedy answers). */
  followUpBudget: 48,
  /** Explores per round expected in the player's best / 2nd / 3rd cave. */
  exploreRate: [1.3, 0.7, 0.35],
  /** Explores per remaining round a dragon's cave is expected to get (dragon worth). */
  adventurerRate: 1,
  /** Worth of a free egg slot early on (eggs are points, but need gaining). */
  eggSlot: 0.35,
  /** Items a dragon's path icon adds per walk of its cave. */
  walkIcon: 1.5,
  /** Share of a playable hand dragon's surplus counted while it's still in hand. */
  handShare: 0.3,
  /** Dragons / cave cards a player can expect to play per remaining round (caps the hand's worth). */
  playsPerRound: 3,
  /** Turn decisions: how many top candidates also get follow-on own turns evaluated (0 = off). */
  planBeam: 8,
  /** Own turns the plan spans, this one included (2 = this turn + the next). Opponents are skipped. */
  planDepth: 3,
  /** From the plan's 2nd turn on: how many of a turn's best moves are followed one more turn. */
  deepBeam: 3,
  /** Follow-up budget (see followUpBudget) for moves in the plan's 3rd turn and later (the 2nd uses half of followUpBudget). */
  deepBudget: 0,
  /** From this plan turn on (2 = the 2nd), payment / exchange variants of one move are tried once (0 = never). */
  dedupeFrom: 2,
  /** Share of the current round's projected objective points counted (later rounds: objectiveLater). */
  objectiveNow: 0.85,
  objectiveLater: 0.2,
  /** Units an end-game ability's counter is expected to reach (dragons still in hand). */
  endGameUnits: 2,
  /**
   * Per-round multipliers on positionValue's parts — `{ part: [round 1, 2, 3, 4] }`,
   * missing = 1 (as hand-written). These are halfway between 1 and the weights
   * a ridge fit of final scores on the parts gives (scripts/wyrmspan/value-fit.ts):
   * the full fit plays 5.7 points worse — it learns that engine potential adds
   * little *because* the heuristic acts on it — while halfway plays better.
   */
  partScale: {
    score: [1.034, 1.047, 1.021, 1.018],
    coins: [1.093, 1.469, 2.442, 2.5],
    resources: [1.437, 1.276, 1.274, 1.189],
    hand: [0.5, 0.556, 0.619, 0.68],
    walks: [0.596, 0.671, 0.736, 0.778],
    engine: [0.653, 0.738, 0.836, 0.875],
    eggRoom: [1.415, 1.731, 2.5, 2.5],
    guild: [2.236, 2.5, 2.308, 2.5],
    objectives: [0.932, 0.971, 1.002, 0.974],
  } as Record<string, number[]>,
};

export type Weights = typeof WEIGHTS;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
/** The weights as shipped (for resetting after a sweep). */
export const DEFAULT_WEIGHTS: Weights = clone(WEIGHTS);

/**
 * Replace the weights in place (WEIGHTS is read at call time, so a benchmark can
 * swap them per seat). `patch` is deep-merged over `base` (default: the shipped weights).
 */
export function setWeights(patch: DeepPartial<Weights> = {}, base: Weights = DEFAULT_WEIGHTS): void {
  const next = merge(clone(base), patch);
  for (const k of Object.keys(next) as (keyof Weights)[]) (WEIGHTS as Record<string, unknown>)[k] = next[k];
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

function merge<T>(into: T, patch: DeepPartial<T>): T {
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    if (!(k in (into as object))) throw new Error(`unknown weight ${k}`);
    const cur = (into as Record<string, unknown>)[k];
    // Objects with fixed keys (early, late) merge key by key; open maps (partScale, empty by default) are replaced.
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && Object.keys(cur).length) merge(cur, v as DeepPartial<typeof cur>);
    else (into as Record<string, unknown>)[k] = clone(v);
  }
  return into;
}

/** 1 at the start of the game → 0 once the player can no longer act. */
function progressLeft(rem: number): number {
  const b = WEIGHTS.endBias;
  return Math.max(0, Math.min(1, (rem - b) / (4 - b)));
}

function valuesFor(rem: number): ItemValues {
  const f = progressLeft(rem);
  const { early: e, late: l } = WEIGHTS;
  return {
    coin: l.coin + (e.coin - l.coin) * f,
    guild: l.guild + (e.guild - l.guild) * f,
    resource: l.resource + (e.resource - l.resource) * f,
    card: l.card + (e.card - l.card) * f,
    egg: l.egg + (e.egg - l.egg) * f,
  };
}

/** The game clock: rounds the player can still act in (this one counts until they pass). */
function roundsLeft(s: GameState, p: PlayerState): number {
  return 4 - s.round + (p.passed ? 0 : 1);
}

function itemsValue(items: readonly GainItem[], v: ItemValues): number {
  let out = 0;
  for (const it of items) {
    if (it.kind === 'coin') out += v.coin * it.count;
    else if (it.kind === 'egg' || it.kind === 'vp') out += it.count;
    else if (it.kind === 'resource') out += v.resource * it.count * (it.res === 'any' ? 1.1 : 1);
    else if (it.kind === 'card') out += v.card * it.count;
    else if (it.kind === 'guild') out += v.guild * it.count;
    else out += 0.6 * it.count;
  }
  return out;
}

const abilityValue = (sum: Float32Array, v: ItemValues) => summaryValue(sum, v);

/** Rough end-game points from an EndGame ability (WEIGHTS.endGameUnits units of its counter). */
function endGameEstimate(c: DragonCard): number {
  const eg = parseAbility(c).endGame;
  if (!eg) return 3; // pay-items-for-points dragons
  const pts = eg.cond ? eg.vpPer : eg.vpPer * (eg.counter ? WEIGHTS.endGameUnits : 1);
  return eg.max !== undefined ? Math.min(pts, eg.max) : pts;
}

/**
 * What a dragon is worth over the rest of the game once it is on the mat, at
 * the current exchange rate: its points, its ability for every activation
 * still expected (once for when-played, per explore of its cave for
 * Adventurers, per round end for once-per-round), its egg room, and the path
 * icon its space adds to every later walk of its cave.
 */
function dragonWorth(c: DragonCard, v: ItemValues, rem: number): number {
  const types = cardAbilityTypes(c);
  const fledgling = c.size === 'Fledgling';
  const av = Math.max(0, abilityValue(abilitySummary(c), v)) * (fledgling ? 0.6 : 1);
  let w = fledgling ? 2 : c.vp;
  if (types.includes('WhenPlayed')) w += av;
  if (types.includes('Adventurer')) w += av * WEIGHTS.adventurerRate * Math.max(0, rem - 0.5);
  if (types.includes('OncePerRound')) w += av * Math.max(0, rem - 0.25) * 0.85;
  if (types.includes('EndGame')) w += endGameEstimate(c);
  w += c.capacity * WEIGHTS.eggSlot * progressLeft(rem);
  w += WEIGHTS.walkIcon * v.resource * WEIGHTS.adventurerRate * Math.max(0, rem - 0.5);
  return w;
}

/**
 * Worth of the hand. A dragon in hand is worth a share of its surplus (worth −
 * cost at the exchange rate) — less if its caves need an excavation first or
 * its resources aren't there yet. Resources are allocated to the best dragons
 * first (with 2-for-1 exchanges), so one dragon's resources aren't counted for
 * every other; and only as many dragons / cave cards count as there are spaces
 * and turns left to play them — the rest are leftovers (1/4 point).
 */
function handValue(view: GameState, p: PlayerState, v: ItemValues, rem: number): number {
  if (rem === 0) return p.hand.length * 0.25;
  let total = 0;
  const unexcavated = p.caves.reduce((a, row) => a + row.spaces.filter((sp) => !sp.excavated).length, 0);
  const freeSpaces = p.caves.reduce((a, row) => a + row.spaces.filter((sp) => !sp.dragon).length, 0);
  const turns = Math.ceil(rem * WEIGHTS.playsPerRound);

  const dragons: { surplus: number; room: number; need: Record<Resource, number>; resCost: number }[] = [];
  for (const id of p.hand) {
    if (!isDragonCard(id)) continue;
    const c = dragonCard(id);
    const prefs = c.caves.map((n) => p.caves[CAVE_INDEX[n]!]!);
    const room = prefs.some((row) => row.spaces.some((sp) => sp.excavated && !sp.dragon)) ? 1
      : prefs.some((row) => row.spaces.some((sp) => !sp.excavated)) ? 0.5 : 0;
    const ignored = room > 0 && enticeOptions(view, p, id).some((o) => o.ignoredCost);
    const need = { meat: 0, gold: 0, crystal: 0, milk: 0 } as Record<Resource, number>;
    if (!ignored) for (const r of RESOURCES) need[r] = c.cost[r] ?? 0;
    const resCost = RESOURCES.reduce((a, r) => a + need[r], 0);
    const cost = v.coin + (ignored ? 0 : resCost * v.resource + (c.cost.coin ?? 0) * v.coin + (c.cost.egg ?? 0));
    const surplus = room ? dragonWorth(c, v, rem) - cost : 0;
    if (surplus > 0) dragons.push({ surplus, room, need, resCost });
    total += 0.25;
  }
  dragons.sort((a, b) => b.surplus - a.surplus);
  const pool = { ...p.resources };
  const playedDragons = Math.min(dragons.length, freeSpaces, turns);
  for (const d of dragons.slice(0, playedDragons)) {
    let missing = 0;
    for (const r of RESOURCES) {
      const take = Math.min(pool[r], d.need[r]);
      pool[r] -= take;
      missing += d.need[r] - take;
    }
    // Cover what's missing with 2-for-1 exchanges from what's left over.
    let spare = RESOURCES.reduce((a, r) => a + pool[r], 0);
    while (missing > 0 && spare >= 2) {
      missing--;
      spare -= 2;
      for (let k = 0; k < 2; k++) {
        const r = [...RESOURCES].sort((x, y) => pool[y] - pool[x])[0]!;
        pool[r]--;
      }
    }
    const afford = d.resCost ? 1 - 0.6 * (missing / d.resCost) : 1;
    total += Math.min(5, d.surplus * WEIGHTS.handShare * d.room * afford);
  }

  const caves = p.hand.filter((id) => !isDragonCard(id)).map((id) => Math.max(0, abilityValue(abilitySummary(caveCard(id)), v)));
  caves.sort((a, b) => b - a);
  caves.forEach((av, k) => {
    total += 0.25;
    // Cave cards share the turns left with the dragons worth playing.
    if (k < Math.min(unexcavated, turns - playedDragons)) total += 0.1 * rem + 0.3 * av * progressLeft(rem);
  });
  return total;
}

/** Base round-end upkeep (6 coins + 1 egg) collected at the start of `round`. */
function upkeepValue(round: number): number {
  return 6 * valuesFor(4 - round + 1).coin + 1;
}

/** The parts of `positionValue` (for tuning / inspection). */
export function positionParts(s: GameState, me: PlayerId): Record<string, number> {
  const p = player(s, me);
  const score = scorePlayer(s, p);
  if (s.phase === 'gameEnd') return { score: score.total };
  const after = 4 - s.round;
  const rem = roundsLeft(s, p);
  const v = valuesFor(rem);
  const parts: Record<string, number> = { score: score.total - score.leftovers };

  // Coins are turns: what they buy beyond the point each scores at the end.
  parts.coins = Math.min(p.coins, 9) * (v.coin - 1);

  // Resources and cards (worth 1/4 point each at the end; earlier they buy dragons).
  parts.resources = totalResources(p) * v.resource;
  parts.hand = handValue(s, p, v, rem);

  // Cave walks: each cave's explore yield (net of the coin it costs) × the explores still expected there.
  const walks = [0, 1, 2].map((c) => Math.max(0, abilityValue(exploreYield(p, c).summary, v) - v.coin)).sort((a, b) => b - a);
  const explores = Math.max(0, rem - 0.5);
  parts.walks = walks.reduce((a, w, k) => a + w * WEIGHTS.exploreRate[k]! * explores, 0);

  // Once-per-round abilities pay at each remaining round end; fledglings need training.
  parts.engine = 0;
  for (const d of allDragons(p)) {
    const card = dragonCard(d.dragon.cardId);
    if (!abilityActive(d.dragon)) {
      parts.engine += 0.15 * rem - (trainingTrackLength(card) - (d.dragon.training ?? 0)) * 0.1;
      continue;
    }
    if (cardAbilityTypes(card).includes('OncePerRound')) {
      parts.engine += Math.max(0, abilityValue(abilitySummary(card), v)) * (after + (s.phase === 'main' ? 1 : 0)) * 0.85;
    }
  }
  parts.eggRoom = Math.min(freeEggCapacity(p), 2 + 2 * rem) * WEIGHTS.eggSlot * progressLeft(rem);

  // Dragon Guild: closer to a brown space (a marker) is worth something while markers remain.
  parts.guild = 0;
  if (p.guildMarkersPlaced < 4) {
    const pos = s.guild.track[me] ?? 0;
    let toBrown = 1;
    while (toBrown < GUILD_TRACK.length && !GUILD_TRACK[(pos + toBrown) % GUILD_TRACK.length]!.brown) toBrown++;
    parts.guild = (1 - toBrown / 6) * 0.3 * rem;
  }

  // Objectives: the current round's standing as if it ended now; later rounds lightly.
  parts.objectives = 0;
  if (s.phase !== 'setup') {
    for (let r = p.objectiveVps.length; r < 4; r++) {
      parts.objectives += (scoreObjective(s, r)[me] ?? 0) * (r === s.round - 1 ? WEIGHTS.objectiveNow : WEIGHTS.objectiveLater);
    }
  }

  // Income still to come — the claimed space (Academy) or the expected upkeep per
  // remaining round end — so a line that reaches the next income early isn't credited for it.
  const collected = s.phase === 'roundEnd' && !s.incomeQueue.includes(me) && p.objectiveVps.length >= s.round;
  const claim = s.incomeChoices[me];
  const claimPending = claim !== undefined && (s.phase === 'main' || s.incomeQueue.includes(me));
  parts.income = 0;
  for (let r = s.round + 1 + (collected ? 1 : 0) + (claimPending ? 1 : 0); r <= 4; r++) parts.income += upkeepValue(r);
  if (claimPending) {
    const next = valuesFor(after);
    parts.income += itemsValue(INCOME_SECTIONS[incomeSectionIndex(s.round)]![claim!]!.items, next);
  }

  // Coins over 9 are lost at the end of a turn — and after passing, next round's
  // income lands on top of what's left.
  parts.coinCap = -Math.max(0, p.coins - 9) * v.coin;
  if (p.passed && s.round < 4) parts.coinCap -= Math.max(0, p.coins + 6 - 10) * valuesFor(after).coin;
  return parts;
}

/** Points now + what the position is still worth. Reads only `s` as `me` sees it. */
export function positionValue(s: GameState, me: PlayerId): number {
  let v = 0;
  const scale = WEIGHTS.partScale;
  if (s.phase === 'gameEnd' || !Object.keys(scale).length) {
    for (const x of Object.values(positionParts(s, me))) v += x;
    return v;
  }
  const r = Math.min(4, Math.max(1, s.round)) - 1;
  for (const [k, x] of Object.entries(positionParts(s, me))) v += x * (scale[k]?.[r] ?? 1);
  return v;
}

// ---------------------------------------------------------------------------
// Lookahead

/** Safety cap on follow-up choices resolved inside one lookahead. */
const MAX_FOLLOW_UPS = 60;
// Follow-up choices are resolved value-greedily (each option tried, its own
// follow-ups finished by the engine's greedy answers) while
// WEIGHTS.followUpBudget evaluations remain per candidate, then by the greedy
// answers alone.

function greedyFinish(s: GameState, me: PlayerId): GameState {
  let t = s;
  for (let k = 0; k < MAX_FOLLOW_UPS && t.phase !== 'gameEnd'; k++) {
    const head = t.pending[0];
    if (!head || head.playerId !== me) break;
    const next = applyAction(t, { type: 'resolveChoice', playerId: me, answer: answerFor(t, me) });
    if (next === t) break;
    t = next;
  }
  return t;
}

function finishOwnChoices(s: GameState, me: PlayerId, budget = WEIGHTS.followUpBudget): GameState {
  let t = s;
  for (let k = 0; k < MAX_FOLLOW_UPS && t.phase !== 'gameEnd'; k++) {
    const head = t.pending[0];
    if (!head || head.playerId !== me) break;
    const cands = legalMoves(t, me);
    let next: GameState | null = null;
    if (cands.length === 1) next = applyAll(t, cands[0]!.actions);
    else if (cands.length > 1 && budget >= cands.length) {
      budget -= cands.length;
      let bestV = -Infinity;
      for (const c of cands) {
        const u = applyAll(t, c.actions);
        if (!u) continue;
        const val = positionValue(greedyFinish(u, me), me);
        if (val > bestV + 1e-9) {
          bestV = val;
          next = u;
        }
      }
    }
    if (!next) next = applyAction(t, { type: 'resolveChoice', playerId: me, answer: answerFor(t, me) });
    if (next === t) break;
    t = next;
  }
  return t;
}

/** The state after `actions`, or null if the engine rejects them. */
function applyAll(s: GameState, actions: readonly Action[]): GameState | null {
  try {
    let t = s;
    for (const a of actions) t = applyAction(t, a);
    return t === s ? null : t;
  } catch {
    return null;
  }
}

/** One move per intent (entice this dragon into this cave, excavate this cave with this card, explore this cave): the first, the engine's default payment. */
function oneVariantEach(moves: readonly Move[]): Move[] {
  const seen = new Set<string>();
  return moves.filter((m) => {
    const a = m.actions[m.actions.length - 1]!;
    const key = a.type === 'entice' || a.type === 'excavate' ? `${a.type}:${a.cave}:${a.cardId}` : a.type === 'explore' ? `explore:${a.cave}` : JSON.stringify(m.actions);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Best value reachable from `t` (just after an own move and its follow-ups) by
 * taking up to `turns` more own turns — opponents skipped, they barely interact
 * — or −Infinity when there is no turn to take (passed, not a turn decision).
 * `level` is the plan's turn number (2 = the next turn). Lets a turn be judged
 * by what it sets up: excavate → explore for the resources → entice.
 *
 * Each turn scores every move (its follow-ups resolved value-greedily), then
 * follows only the best WEIGHTS.deepBeam one turn further: the search grows
 * linearly in depth, not exponentially. Stopping is always an option (the
 * coin is kept), so a further turn only counts when it adds value.
 */
function planValue(t: GameState, me: PlayerId, turns: number, level: number): number {
  if (t.phase !== 'main' || t.pending.length || player(t, me).passed) return -Infinity;
  const mine: GameState = { ...t, turn: me, turnIndex: t.playerOrder.indexOf(me), turnEnding: false };
  const budget = level === 2 ? WEIGHTS.followUpBudget / 2 : WEIGHTS.deepBudget;
  let moves = legalMoves(mine, me).filter((c) => c.verb !== 'pass');
  if (WEIGHTS.dedupeFrom > 0 && level >= WEIGHTS.dedupeFrom) moves = oneVariantEach(moves);
  const kids: { v: number; t: GameState }[] = [];
  let best = -Infinity;
  for (const c of moves) {
    const u = applyAll(mine, c.actions);
    if (!u) continue;
    const f = finishOwnChoices(u, me, budget);
    const v = positionValue(f, me);
    best = Math.max(best, v);
    kids.push({ v, t: f });
  }
  if (turns <= 1 || !kids.length) return best;
  for (const k of kids.sort((x, y) => y.v - x.v).slice(0, WEIGHTS.deepBeam)) best = Math.max(best, planValue(k.t, me, turns - 1, level + 1));
  return best;
}

/**
 * The heuristic's value of every candidate (built from `view`, `me`'s redacted
 * view): the position it leads to, in points. −Infinity for a candidate that
 * can't run in the sampled world.
 */
function heuristicValues(view: GameState, me: PlayerId, cands: readonly Move[]): number[] {
  const values = cands.map(() => -Infinity);
  if (cands.length <= 1) return values.fill(0);
  const world = determinize(view, me, visibleSeed(view, me));
  const scored: { i: number; v: number; t: GameState }[] = [];
  cands.forEach((c, i) => {
    const t0 = applyAll(world, c.actions);
    if (!t0) return; // a sampled world the candidate can't run in: skip it
    const t = finishOwnChoices(t0, me);
    scored.push({ i, v: positionValue(t, me), t });
  });
  // Turn decisions: the best few are also judged by the best turns they set up (planDepth − 1 more).
  const beam = !view.pending.length && WEIGHTS.planDepth >= 2 ? WEIGHTS.planBeam : 0;
  if (beam > 0) {
    const top = [...scored].sort((x, y) => y.v - x.v).slice(0, beam);
    for (const x of top) {
      x.v = Math.max(x.v, planValue(x.t, me, WEIGHTS.planDepth - 1, 2));
    }
  }
  for (const x of scored) values[x.i] = x.v;
  return values;
}

/** Index of the best of `values` (the first of equals); 0 if none is finite. */
function bestIndex(values: readonly number[]): number {
  let best = -1;
  values.forEach((v, i) => {
    if (v > -Infinity && (best < 0 || v > values[best]! + 1e-9)) best = i;
  });
  return Math.max(0, best);
}

/** Index of the heuristic's pick among `cands` (built from `view`, `me`'s redacted view). */
export function heuristicIndex(view: GameState, me: PlayerId, cands: readonly Move[]): number {
  if (cands.length <= 1) return 0;
  return bestIndex(heuristicValues(view, me, cands));
}

/** The heuristic's move for `me` in the real `state` (redacted first — it never peeks). */
export function heuristicActions(state: GameState, me: PlayerId): Action[] {
  const view = redact(state, me);
  const cands = legalMoves(view, me);
  if (!cands.length) return [];
  return cands[heuristicIndex(view, me, cands)]!.actions;
}
