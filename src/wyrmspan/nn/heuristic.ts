// Benchmark heuristic for Wyrmspan: a one-ply lookahead over the learned
// agent's own candidate list (candidates.ts), so its pick is directly usable
// as an imitation label.
//
// For each candidate it applies the candidate's actions to a *determinized*
// copy of the player's redacted view (hidden cards dealt at random from the
// public pool — never the real deck), resolves the player's own follow-up
// choices value-greedily, and scores the result with `positionValue`: the
// points the game would award now, plus what coins (future turns), resources,
// hand, cave walks (explore yield × explores still expected), once-per-round
// abilities and income are still worth. All candidates share one
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
import { type ItemValues, abilitySummary, summaryValue } from './cardFeatures';
import { type Candidate, legalCandidates } from './candidates';
import { tokenRefs } from './encode';
import { CAVE_INDEX, abilityActive, enticeOptions, exploreYield, freeEggCapacity, totalResources } from './rules';
import { determinize, redact, visibleSeed } from './view';

// ---------------------------------------------------------------------------
// Static evaluation
//
// The currency is end-of-game points. Items that aren't points yet are priced
// with a strong player's rule-of-thumb exchange rate early on — coin 3 (a coin
// is a turn), guild advance 2, resource / egg / dragon card / cave card 1 —
// and decay to what they are actually worth at the end (coin 1, egg 1,
// resource / card 1/4 via leftovers, guild 0) as the player's turns run out
// (coins in hand + income still to come — see roundsLeft). A dragon is worth enticing when its points, ability
// and egg room beat its cost at that rate. On top of that:
//   cave walk  each cave's explore yield (path icons up to the first empty
//              space + Adventurer abilities walked past), net of the coin an
//              explore costs, × the explores still expected there — so filling
//              caves and Adventurers in the caves explored most pay off
//   income     each remaining round end's income, at the coin value it will have

/** Tunable weights (exported so the benchmark can sweep them). */
export const WEIGHTS = {
  /** Early-game worth of each item (strong-player exchange rate). */
  early: { coin: 3, guild: 2, resource: 1, card: 1, egg: 1 },
  /** End-game worth. */
  late: { coin: 1, guild: 0, resource: 0.25, card: 0.25, egg: 1 },
  /** Rounds-left value below which items are priced at their end-game worth. */
  endBias: 0.5,
  /** Coins (= turns) a round's income is worth, for the game clock. */
  turnsPerRound: 5.5,
  /** 'turns': coins in hand + income to come; 'rounds': rounds the player can still act in. */
  clock: 'rounds' as 'turns' | 'rounds',
  /** Evaluations per candidate for resolving follow-up choices value-greedily (0 = engine greedy answers). */
  followUpBudget: 48,
  /** Explores per round expected in the player's best / 2nd / 3rd cave. */
  exploreRate: [1.3, 0.7, 0.35],
  /** Explores per remaining round a dragon's cave is expected to get (dragon worth). */
  adventurerRate: 1,
  /** Worth of a free egg slot early on (eggs are points, but need gaining). */
  eggSlot: 0.35,
  /** Items a dragon's path icon adds per walk of its cave. */
  walkIcon: 1,
  /** Share of a playable hand dragon's surplus counted while it's still in hand. */
  handShare: 0.3,
  /** Dragons / cave cards a player can expect to play per remaining round (caps the hand's worth). */
  playsPerRound: 3,
  /** Turn decisions: how many top candidates also get a follow-on own turn evaluated (0 = off). */
  planBeam: 0,
  /** How much of the follow-on turn's gain counts. */
  planWeight: 1,
  /** Share of the current round's projected objective points counted (later rounds: objectiveLater). */
  objectiveNow: 0.85,
  objectiveLater: 0.2,
};

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

/**
 * The game clock, in rounds' worth of turns: (coins in hand + the income still
 * to come) / TURNS_PER_ROUND. Every action costs a coin, so coins are turns;
 * this decays smoothly as they are spent, and passing costs nothing by itself
 * (coins carry over) — only the round-4 pass ends the clock.
 */
function roundsLeft(s: GameState, p: PlayerState): number {
  if (WEIGHTS.clock === 'rounds') return 4 - s.round + (p.passed ? 0 : 1);
  const coins = p.passed && s.round >= 4 ? 0 : Math.min(p.coins, 9);
  const collected = s.phase === 'roundEnd' && !s.incomeQueue.includes(p.id) && p.objectiveVps.length >= s.round;
  const incomes = Math.max(0, 4 - s.round - (collected ? 1 : 0));
  return (coins + WEIGHTS.turnsPerRound * incomes) / WEIGHTS.turnsPerRound;
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

/** Rough end-game points from an EndGame ability (≈3 units of its counter). */
function endGameEstimate(c: DragonCard): number {
  const eg = parseAbility(c).endGame;
  if (!eg) return 3; // pay-items-for-points dragons
  const pts = eg.cond ? eg.vpPer : eg.vpPer * (eg.counter ? 3 : 1);
  return eg.max !== undefined ? Math.min(pts, eg.max) : pts;
}

/**
 * What a dragon is worth over the rest of the game once it is on the mat, at
 * the current exchange rate: its points, its ability for every activation
 * still expected (once for when-played, per explore of its cave for
 * Adventurers, per round end for once-per-round), its egg room, and the path
 * icon its space adds to every later walk of its cave.
 */
export function dragonWorth(c: DragonCard, v: ItemValues, rem: number): number {
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
  for (const x of Object.values(positionParts(s, me))) v += x;
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
    const cands = legalCandidates(t, me, tokenRefs(t, me));
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

/**
 * Best value of one more own turn from `t` (opponents skipped — they barely
 * interact), or −Infinity when there is none (passed, not a turn decision).
 * Lets a turn be judged by what it sets up: excavate → entice, explore → entice.
 */
function nextTurnValue(t: GameState, me: PlayerId): number {
  if (t.phase !== 'main' || t.pending.length || player(t, me).passed) return -Infinity;
  const mine: GameState = { ...t, turn: me, turnIndex: t.playerOrder.indexOf(me), turnEnding: false };
  let best = -Infinity;
  for (const c of legalCandidates(mine, me, tokenRefs(mine, me))) {
    if (c.verb === 'pass') continue;
    const u = applyAll(mine, c.actions);
    if (u) best = Math.max(best, positionValue(finishOwnChoices(u, me, WEIGHTS.followUpBudget / 2), me));
  }
  return best;
}

/**
 * The heuristic's value of every candidate (built from `view`, `me`'s redacted
 * view): the position it leads to, in points. −Infinity for a candidate that
 * can't run in the sampled world.
 */
export function heuristicValues(view: GameState, me: PlayerId, cands: readonly Candidate[]): number[] {
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
  // Turn decisions: the best few are also judged by the best turn they set up next.
  const beam = !view.pending.length ? WEIGHTS.planBeam : 0;
  if (beam > 0) {
    const top = [...scored].sort((x, y) => y.v - x.v).slice(0, beam);
    for (const x of top) {
      const next = nextTurnValue(x.t, me);
      if (next > x.v) x.v = x.v + (next - x.v) * WEIGHTS.planWeight;
    }
  }
  for (const x of scored) values[x.i] = x.v;
  return values;
}

/** Index of the best of `values` (the first of equals); 0 if none is finite. */
export function bestIndex(values: readonly number[]): number {
  let best = -1;
  values.forEach((v, i) => {
    if (v > -Infinity && (best < 0 || v > values[best]! + 1e-9)) best = i;
  });
  return Math.max(0, best);
}

/** Index of the heuristic's pick among `cands` (built from `view`, `me`'s redacted view). */
export function heuristicIndex(view: GameState, me: PlayerId, cands: readonly Candidate[]): number {
  if (cands.length <= 1) return 0;
  return bestIndex(heuristicValues(view, me, cands));
}

/** The heuristic's move for `me` in the real `state` (redacted first — it never peeks). */
export function heuristicActions(state: GameState, me: PlayerId): Action[] {
  const view = redact(state, me);
  const cands = legalCandidates(view, me, tokenRefs(view, me));
  if (!cands.length) return [];
  return cands[heuristicIndex(view, me, cands)]!.actions;
}
