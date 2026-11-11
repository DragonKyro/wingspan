// Observation encoder for the learned Wyrmspan agent.
//
// The network sees one decision of one player, encoded from that player's
// redacted view (view.ts — never the real state):
//
//   global  GLOBAL_DIM floats: round/phase/table size, own economy (coins,
//           resources, hand, eggs, explores), the current score breakdown,
//           mat aggregates, the Dragon Guild (tile, own track position, square
//           occupancy), the 4 round objectives (+ a public race summary: own
//           units vs the best opponent's), Academy income spaces, Automa's
//           public state (solo), and the pending decision (kind, parameters,
//           a summary of the ability steps still to run).
//   tokens  NUM_TOKENS card slots, each a card index (→ the network's card
//           table + embedding; 0 = empty) and TOKEN_DIM context floats:
//             mat      12  one per cave space (cave-major); excavated / eggs /
//                          cached / tucked / training / legality for the
//                          pending step, and the dragon on it
//             hand     16  own hand (cards past 16 are not shown)
//             dDisplay  3  face-up dragons      cDisplay 3  face-up caves
//             pending   6  cards the pending step shows (setup offer, drawn
//                          cards, the dragon being paid for)
//             ctx       1  the card whose ability is resolving
//
// Opponents are deliberately not encoded (Wyrmspan has little interaction):
// only table size, who has passed and the objective race are.

import { cardAbilityTypes, dragonCard, isDragonCard, trainingTrackLength } from '../cards';
import { GUILD_TILES, GUILD_TILE_IDS, GUILD_TRACK, INCOME_SECTIONS, incomeSectionIndex } from '../guild';
import { allDragons, countCounter, dragonTargetPositions, eggTargetSpots, player } from '../helpers';
import { OBJECTIVES, OBJECTIVE_IDS, ROUND_OBJECTIVE_VP, automaObjectiveUnits } from '../objectives';
import { scorePlayer } from '../scoring';
import type { GameState, PendingStep, PlayerId, PlayerState, ScoreBreakdown } from '../types';
import { CAVE_IDS, RESOURCES } from '../types';
import { SUMMARY_DIM, cardIndex, summarizeSteps } from './cardFeatures';
import {
  abilityActive, canExplore, enticeOptions, excavatableCaves, excavateCost, exploreEggCost, freeEggCapacity,
  handCaves, handDragons, hasEnticeSpace, totalResources,
} from './rules';

export const ENCODER_VERSION = 2;

// ---------------------------------------------------------------------------
// Token layout

export const TOKEN_ZONES = ['mat', 'hand', 'dDisplay', 'cDisplay', 'pending', 'ctx'] as const;
export type TokenZone = (typeof TOKEN_ZONES)[number];
export const ZONE_SIZES: Record<TokenZone, number> = { mat: 12, hand: 16, dDisplay: 3, cDisplay: 3, pending: 6, ctx: 1 };
export const ZONE_START: Record<TokenZone, number> = (() => {
  const out = {} as Record<TokenZone, number>;
  let at = 0;
  for (const z of TOKEN_ZONES) {
    out[z] = at;
    at += ZONE_SIZES[z];
  }
  return out;
})();
export const NUM_TOKENS = TOKEN_ZONES.reduce((a, z) => a + ZONE_SIZES[z], 0);
export const matToken = (cave: number, space: number): number => ZONE_START.mat + cave * 4 + space;

// ---------------------------------------------------------------------------
// Feature writer: fixed-size segments, recorded once for the layout report.

export type Segment = [name: string, offset: number, size: number];

class Writer {
  at = 0;
  constructor(
    readonly buf: Float32Array,
    readonly base = 0,
    readonly record?: Segment[],
  ) {}
  seg(name: string, n: number): number {
    const o = this.at;
    this.at += n;
    this.record?.push([name, o, n]);
    return this.base + o;
  }
  num(name: string, v: number): void {
    this.buf[this.seg(name, 1)] = Number.isFinite(v) ? v : 0;
  }
  flag(name: string, b: boolean): void {
    this.buf[this.seg(name, 1)] = b ? 1 : 0;
  }
  nums(name: string, vs: readonly number[]): void {
    const o = this.seg(name, vs.length);
    vs.forEach((v, i) => (this.buf[o + i] = Number.isFinite(v) ? v : 0));
  }
  oneHot(name: string, n: number, idx: number): void {
    const o = this.seg(name, n);
    if (idx >= 0 && idx < n) this.buf[o + idx] = 1;
  }
  vec(name: string, v: ArrayLike<number>, scale = 1): void {
    const o = this.seg(name, v.length);
    for (let i = 0; i < v.length; i++) this.buf[o + i] = v[i]! * scale;
  }
}

// ---------------------------------------------------------------------------
// Pending-step vocabulary

export const PENDING_KINDS = [
  'main', 'setupCards', 'setupResources', 'chooseResource', 'chooseEggSpot', 'chooseCache', 'chooseTuck',
  'chooseHandCards', 'chooseDisplay', 'distributeCards', 'chooseAbility', 'chooseExcavate', 'choosePlayDragon',
  'payDragonCost', 'chooseGuildSquare', 'chooseOption', 'chooseTrain', 'chooseSwap', 'chooseHandDragonSwap',
  'chooseCaveCardSwap', 'choosePay', 'opponentMay', 'discardDown', 'oncePerRoundPick', 'chooseBenefits',
  'chooseEggPayment', 'chooseIncomeSpace',
] as const satisfies readonly (PendingStep['kind'] | 'main')[];
const TARGET_KINDS = [
  'any', 'here', 'thisCave', 'thisColumn', 'orthAdjacent', 'eachInCave', 'eachInColumn', 'eachInRow', 'eachFledgling',
  'eachFullyTrainedFledgling', 'eachOnMat',
] as const;
const SOURCES = ['hand', 'display', 'handOrDisplay', 'deck'] as const;
const FROMS = ['supply', 'general', 'hand', 'deck'] as const;
const PURPOSES = ['discard', 'pay', 'tuck', 'cavesForEggs'] as const;

const idx = <T extends string>(list: readonly T[], v: T | undefined | null): number => (v == null ? -1 : list.indexOf(v));

// ---------------------------------------------------------------------------
// Global features

export const GLOBAL_DIM = 395;
export const TOKEN_DIM = 42;

/** The (my) pending step at the head of the queue, or null for a turn decision. */
export function headFor(view: GameState, me: PlayerId): PendingStep | null {
  const h = view.pending[0];
  return h && h.playerId === me ? h : null;
}

function objectiveUnits(view: GameState, p: PlayerState, round: number): number {
  if (view.automa && p.id === 'p2') return automaObjectiveUnits(view, round);
  return OBJECTIVES[view.objectives[round]!].unit(view, p);
}

function writeGlobal(view: GameState, me: PlayerId, w: Writer, score: ScoreBreakdown): void {
  const p = player(view, me);
  const n = view.players.length;
  const others = view.players.filter((q) => q.id !== me);
  const head = headFor(view, me);
  const r = view.round;

  // --- table
  w.oneHot('round', 4, r - 1);
  w.oneHot('phase', 3, ['setup', 'main', 'roundEnd'].indexOf(view.phase));
  w.oneHot('players', 5, n - 1);
  w.flag('automa', !!view.automa);
  w.num('automaDifficulty', (view.automa?.difficulty ?? 0) / 3);
  w.flag('academy', view.expansions.includes('academy'));
  w.flag('ravel', !!view.automa?.ravelMode);
  w.flag('startPlayer', view.startPlayer === me);
  const startAt = view.playerOrder.indexOf(view.startPlayer);
  w.num('turnPosition', ((view.playerOrder.indexOf(me) - startAt + n) % n) / 4);
  w.num('opponentsActive', others.length ? others.filter((q) => !q.passed).length / others.length : 0);
  w.flag('allOpponentsPassed', others.every((q) => q.passed));
  w.flag('passed', p.passed);
  w.flag('myTurn', view.turn === me && view.phase === 'main');
  w.nums('decks', [view.dragonDeck.length / 100, view.caveDeck.length / 50, view.dragonDiscard.length / 50, view.caveDiscard.length / 30]);

  // --- own economy
  w.nums('coins', [p.coins / 10, p.coins >= 9 ? 1 : 0]);
  w.nums('resources', RESOURCES.map((x) => p.resources[x] / 5));
  w.num('resourceTotal', totalResources(p) / 10);
  const hd = handDragons(p).length;
  const hc = handCaves(p).length;
  w.nums('hand', [hd / 9, hc / 9, p.hand.length / 9]);
  const eggs = score.eggs;
  w.nums('eggs', [p.nestEggs / 2, eggs / 10, freeEggCapacity(p) / 10]);
  w.nums('explores', CAVE_IDS.map((c) => p.explores[c] / 3));
  w.nums('exploreEggCost', [0, 1, 2].map((c) => exploreEggCost(p, c) / 2));
  w.nums('guildMarkers', [p.guildMarkersPlaced / 4, p.guildMarkersPlaced >= 4 ? 1 : 0]);
  w.num('bonusVP', p.bonusVP / 10);
  w.num('coinsSpentEntice', p.coinsSpentEntice / 10);

  // --- current score (what the game would award now)
  w.nums('score', [
    score.guildTile / 20, score.printedDragonVp / 40, score.endGameAbilities / 20, score.eggs / 20, score.cached / 20,
    score.tucked / 20, score.objectives / 20, score.coins / 10, score.bonusVP / 10, score.leftovers / 5, score.total / 100,
  ]);

  // --- mat aggregates
  const dragons = allDragons(p);
  w.num('dragons', dragons.length / 12);
  w.nums('caveDragons', [0, 1, 2].map((c) => dragons.filter((d) => d.cave === c).length / 4));
  w.nums('caveExcavated', [0, 1, 2].map((c) => p.caves[c]!.spaces.filter((s) => s.excavated).length / 4));
  w.nums('excavateEggCost', [0, 1, 2].map((c) => {
    const cost = excavateCost(p, c);
    return cost ? cost.reduce((a, it) => a + (it.kind === 'egg' ? it.count : 0), 0) / 2 : 1.5;
  }));
  w.num('openSpaces', p.caves.reduce((a, row) => a + row.spaces.filter((s) => s.excavated && !s.dragon).length, 0) / 6);
  w.num('filledColumns', countCounter(view, p, { kind: 'filledColumns' }) / 4);

  // --- what's affordable now
  const dragonIds = handDragons(p);
  let now = 0;
  let withExchange = 0;
  for (const id of dragonIds) {
    const opts = enticeOptions(view, p, id);
    if (opts.some((o) => o.exchanges.length === 0)) now++;
    else if (opts.length) withExchange++;
  }
  w.nums('enticeable', [now / 4, withExchange / 4, dragonIds.filter((id) => hasEnticeSpace(p, id)).length / 6]);
  w.num('excavatable', hc > 0 ? excavatableCaves(p).length / 3 : 0);
  w.nums('explorable', [0, 1, 2].map((c) => (canExplore(p, c) ? 1 : 0)));

  // --- Dragon Guild
  const tileId = view.guild.tile;
  const tile = GUILD_TILES[tileId];
  w.oneHot('guildTile', GUILD_TILE_IDS.length, GUILD_TILE_IDS.indexOf(tileId));
  const pos = view.guild.track[me] ?? 0;
  w.oneHot('guildTrack', GUILD_TRACK.length, pos);
  const squares = tile.squares.map((_, i) => view.guild.squares[i] ?? []);
  w.nums('guildSquaresMine', squares.map((occ) => occ.filter((x) => x === me).length / 2));
  w.nums('guildSquaresOthers', squares.map((occ) => occ.filter((x) => x !== me).length / 4));
  w.nums('guildSquaresOpen', tile.squares.map((sq, i) => (sq.unlimited || squares[i]!.length === 0 ? 1 : 0)));
  let toBrown = 1;
  while (toBrown < GUILD_TRACK.length && !GUILD_TRACK[(pos + toBrown) % GUILD_TRACK.length]!.brown) toBrown++;
  w.num('stepsToBrown', toBrown / 6);

  // --- objectives (public race summary, no other opponent detail)
  const objIdx = view.objectives.map((o) => OBJECTIVE_IDS.indexOf(o));
  for (let k = 0; k < 4; k++) w.oneHot(`objective${k + 1}`, OBJECTIVE_IDS.length, objIdx[k]!);
  w.nums('objectiveIsCurrent', [0, 1, 2, 3].map((k) => (k === r - 1 ? 1 : 0)));
  w.nums('objectiveBanked', [0, 1, 2, 3].map((k) => (p.objectiveVps[k] ?? 0) / 7));
  const mine: number[] = [];
  const best: number[] = [];
  const ahead: number[] = [];
  const tied: number[] = [];
  for (let k = 0; k < 4; k++) {
    if (k < view.objectives.length) {
      const u = objectiveUnits(view, p, k);
      const theirs = others.map((q) => objectiveUnits(view, q, k));
      mine.push(u / 6);
      best.push((theirs.length ? Math.max(...theirs) : 0) / 6);
      ahead.push(theirs.filter((t) => t > u).length / 4);
      tied.push(theirs.filter((t) => t === u).length / 4);
    } else {
      mine.push(0);
      best.push(0);
      ahead.push(0);
      tied.push(0);
    }
  }
  w.nums('objectiveMine', mine);
  w.nums('objectiveBestOpponent', best);
  w.nums('objectiveAhead', ahead);
  w.nums('objectiveTied', tied);
  w.nums('objectivePoints', (ROUND_OBJECTIVE_VP[Math.min(3, r - 1)] ?? [0, 0, 0, 0]).map((v) => v / 7));

  // --- Academy income spaces (claimed when passing in rounds 1-3)
  const section = INCOME_SECTIONS[incomeSectionIndex(Math.min(3, r))]!;
  const claimed = new Set(Object.values(view.incomeChoices));
  w.nums('incomeClaimed', section.map((_, i) => (claimed.has(i) ? 1 : 0)));
  w.oneHot('incomeMine', section.length + 1, view.incomeChoices[me] ?? section.length);
  w.oneHot('incomeSection', 2, incomeSectionIndex(Math.min(3, r)));

  // --- Automa (solo): its public tallies
  const a = view.automa;
  w.nums('automaState', a
    ? [a.collectedDragons / 10, a.collectedCaves / 10, a.cacheTokens / 10, a.objectiveCoins / 5, (view.guild.track.p2 ?? 0) / 12]
    : [0, 0, 0, 0, 0]);

  // --- the decision
  writePending(view, me, head, w);
}

function writePending(view: GameState, me: PlayerId, head: PendingStep | null, w: Writer): void {
  w.oneHot('pendingKind', PENDING_KINDS.length, head ? PENDING_KINDS.indexOf(head.kind) : 0);
  const h = (head ?? {}) as Record<string, unknown>;
  const target = h.target as { kind: (typeof TARGET_KINDS)[number] } | undefined;
  const count = typeof h.count === 'number' ? h.count : 0;
  w.num('pendingCount', count / 5);
  w.flag('pendingOptional', !!(h.upTo || h.optional));
  w.oneHot('pendingMode', 3, idx(['gain', 'discard', 'pay'], h.mode as string));
  w.oneHot('pendingFrom', FROMS.length, idx(FROMS, h.from as (typeof FROMS)[number]));
  w.oneHot('pendingSource', SOURCES.length, idx(SOURCES, h.source as (typeof SOURCES)[number]));
  w.oneHot('pendingTarget', TARGET_KINDS.length, idx(TARGET_KINDS, target?.kind));
  w.oneHot('pendingPurpose', PURPOSES.length, idx(PURPOSES, h.purpose as (typeof PURPOSES)[number]));
  w.oneHot('pendingWhat', 3, idx(['dragon', 'cave', 'any'], h.what as string));
  w.oneHot('pendingTrainTarget', 3, head?.kind === 'chooseTrain' ? idx(['any', 'orthAdjacent', 'mat'], head.target) : -1);
  w.nums('pendingDiscount', [Array.isArray(h.discount) ? 1 : 0, h.discount === 'full' ? 1 : 0]);
  w.flag('pendingOnTop', !!h.onTop);
  w.flag('pendingCond', !!h.cond);
  w.flag('pendingFree', !!h.free);
  w.flag('pendingGainItem', !!h.gainItem);
  w.num('pendingTimes', h.times === 'full' ? 1 : typeof h.times === 'number' ? h.times / 3 : 0);
  w.oneHot('pendingDeck', 2, idx(['dragon', 'cave'], h.deck as string));
  // A card gain that may also take the top of the deck (vs face-up only).
  w.flag('pendingOrDeck', head?.kind === 'chooseDisplay' && head.orDeck !== false);
  const dist = head?.kind === 'distributeCards' ? head : null;
  w.nums('pendingDistribute', dist
    ? [(dist.keep ?? 0) / 3, dist.tuck === 'rest' ? 1 : (dist.tuck ?? 0) / 3, dist.discard === 'rest' ? 1 : (dist.discard ?? 0) / 3, (dist.playFree ?? 0), dist.orKeep ? 1 : 0]
    : [0, 0, 0, 0, 0]);
  const options = Array.isArray(h.options) ? h.options.length : Array.isArray(h.candidates) ? h.candidates.length : Array.isArray(h.positions) ? h.positions.length : 0;
  w.num('pendingOptions', options / 6);
  w.num('pendingQueue', view.pending.length / 5);
  w.num('pendingMineAfter', view.pending.slice(1).filter((s) => s.playerId === me).length / 5);
  const resume = h.resume as { steps: Parameters<typeof summarizeSteps>[0] } | undefined;
  w.vec('pendingResume', resume?.steps.length ? summarizeSteps(resume.steps) : new Float32Array(SUMMARY_DIM), 0.5);
  w.flag('turnEnding', view.turnEnding);
  w.num('roundEndQueueMine', view.roundEndQueue.filter((e) => e.playerId === me).length / 4);
}

// ---------------------------------------------------------------------------
// Tokens

export interface TokenRefs {
  /** card id → hand token */
  hand: Map<number, number>;
  /** display slot → token (−1 when empty) */
  dDisplay: number[];
  cDisplay: number[];
  /** pending-shown card index → token */
  pending: number[];
}

/** Cards the pending step shows its owner (setup offer, drawn cards, …). */
export function pendingCards(head: PendingStep | null): number[] {
  if (!head) return [];
  if (head.kind === 'setupCards') return head.offer;
  if (head.kind === 'distributeCards') return head.cardIds;
  if (head.kind === 'payDragonCost') return [head.cardId];
  return [];
}

/** The token refs `encodeView` would produce, without encoding features (for heuristic seats). */
export function tokenRefs(view: GameState, me: PlayerId): TokenRefs {
  const p = player(view, me);
  const refs: TokenRefs = { hand: new Map(), dDisplay: [-1, -1, -1], cDisplay: [-1, -1, -1], pending: [] };
  p.hand.slice(0, ZONE_SIZES.hand).forEach((id, i) => refs.hand.set(id, ZONE_START.hand + i));
  view.dragonDisplay.forEach((id, i) => id != null && (refs.dDisplay[i] = ZONE_START.dDisplay + i));
  view.caveDisplay.forEach((id, i) => id != null && (refs.cDisplay[i] = ZONE_START.cDisplay + i));
  pendingCards(headFor(view, me)).slice(0, ZONE_SIZES.pending).forEach((_, i) => refs.pending.push(ZONE_START.pending + i));
  return refs;
}

function legalTargets(view: GameState, me: PlayerId, head: PendingStep | null): Set<number> {
  const out = new Set<number>();
  if (!head) return out;
  const p = player(view, me);
  const ctxPos = 'resume' in head ? head.resume?.ctx.dragon : undefined;
  if (head.kind === 'chooseEggSpot') {
    for (const s of eggTargetSpots(p, head.target, ctxPos) as { cave?: number; space?: number }[]) {
      if (s.cave !== undefined) out.add(matToken(s.cave, s.space!));
    }
  } else if (head.kind === 'chooseCache' || head.kind === 'chooseTuck') {
    for (const s of dragonTargetPositions(p, head.target, ctxPos)) out.add(matToken(s.cave, s.space));
  }
  return out;
}

function writeTokens(view: GameState, me: PlayerId, ids: Int16Array, feat: Float32Array, mask: Uint8Array, record?: Segment[]): TokenRefs {
  const p = player(view, me);
  const head = headFor(view, me);
  const ctx = head && 'resume' in head ? head.resume?.ctx : undefined;
  const ctxPos = ctx?.dragon;
  const targets = legalTargets(view, me, head);
  const refs: TokenRefs = { hand: new Map(), dDisplay: [-1, -1, -1], cDisplay: [-1, -1, -1], pending: [] };

  const token = (t: number, zone: TokenZone, cardId: number | null, fill: (w: Writer) => void) => {
    ids[t] = cardIndex(cardId);
    mask[t] = 1;
    const w = new Writer(feat, t * TOKEN_DIM, t === 0 ? record : undefined);
    w.oneHot('zone', TOKEN_ZONES.length, TOKEN_ZONES.indexOf(zone));
    w.flag('present', cardId != null);
    fill(w);
    if (w.at !== TOKEN_DIM) throw new Error(`token has ${w.at} features, expected ${TOKEN_DIM}`);
  };

  const matPart = (w: Writer, cave: number, space: number) => {
    const sp = p.caves[cave]!.spaces[space]!;
    const d = sp.dragon;
    const card = d ? dragonCard(d.cardId) : null;
    w.oneHot('cave', 3, cave);
    w.oneHot('column', 4, space);
    w.nums('space', [sp.excavated ? 1 : 0, sp.caveCardId !== null ? 1 : 0]);
    const nextEntice = p.caves[cave]!.spaces.findIndex((s) => s.excavated && !s.dragon);
    const nextExcavate = p.caves[cave]!.spaces.findIndex((s) => !s.excavated);
    w.nums('next', [nextEntice === space ? 1 : 0, nextExcavate === space ? 1 : 0, space >= 2 ? (space - 1) / 2 : 0]);
    w.nums('eggs', [d ? d.eggs / 5 : 0, d && card ? (card.capacity - d.eggs) / 5 : 0]);
    w.num('cached', d ? d.cached.length / 5 : 0);
    w.nums('cachedBy', RESOURCES.map((x) => (d ? d.cached.filter((c) => c === x).length / 3 : 0)));
    w.num('tucked', d ? d.tucked.length / 5 : 0);
    const track = card ? trainingTrackLength(card) : 0;
    w.nums('training', [track ? (d!.training ?? 0) / track : 0, card && card.size === 'Fledgling' && track > 0 && (d!.training ?? 0) >= track ? 1 : 0]);
    w.flag('abilityActive', !!d && abilityActive(d));
    const isCtx = !!ctxPos && ctxPos[0] === cave && ctxPos[1] === space;
    const adj = !!ctxPos && Math.abs(ctxPos[0] - cave) + Math.abs(ctxPos[1] - space) === 1;
    w.nums('ctxRelation', [isCtx ? 1 : 0, adj ? 1 : 0, ctxPos && ctxPos[0] === cave ? 1 : 0, ctxPos && ctxPos[1] === space ? 1 : 0]);
    w.flag('legalTarget', targets.has(matToken(cave, space)));
  };
  const blankMat = (w: Writer) => w.seg('matBlock', 28);

  const cardPart = (w: Writer, cardId: number | null) => {
    if (cardId == null) {
      w.seg('cardBlock', 6);
      return;
    }
    if (isDragonCard(cardId)) {
      const opts = enticeOptions(view, p, cardId);
      const cheapest = opts.length ? Math.min(...opts.map((o) => o.exchanges.length)) : -1;
      w.nums('affordable', [cheapest === 0 ? 1 : 0, cheapest >= 0 ? 1 : 0, cheapest > 0 ? cheapest / 3 : 0]);
      w.flag('hasSpace', hasEnticeSpace(p, cardId));
      w.flag('costIgnored', opts.some((o) => o.ignoredCost));
      w.flag('excavatable', false);
    } else {
      w.seg('dragonOnly', 5);
      w.flag('excavatable', excavatableCaves(p).length > 0);
    }
  };

  for (let cave = 0; cave < 3; cave++) {
    for (let space = 0; space < 4; space++) {
      const d = p.caves[cave]!.spaces[space]!.dragon;
      token(matToken(cave, space), 'mat', d ? d.cardId : null, (w) => {
        matPart(w, cave, space);
        w.seg('cardBlock', 6);
        w.num('index', 0);
      });
    }
  }
  p.hand.slice(0, ZONE_SIZES.hand).forEach((id, i) => {
    const t = ZONE_START.hand + i;
    refs.hand.set(id, t);
    token(t, 'hand', id, (w) => {
      blankMat(w);
      cardPart(w, id);
      w.num('index', i / 16);
    });
  });
  view.dragonDisplay.forEach((id, i) => {
    if (id == null) return;
    const t = ZONE_START.dDisplay + i;
    refs.dDisplay[i] = t;
    token(t, 'dDisplay', id, (w) => {
      blankMat(w);
      cardPart(w, id);
      w.num('index', i / 3);
    });
  });
  view.caveDisplay.forEach((id, i) => {
    if (id == null) return;
    const t = ZONE_START.cDisplay + i;
    refs.cDisplay[i] = t;
    token(t, 'cDisplay', id, (w) => {
      blankMat(w);
      cardPart(w, id);
      w.num('index', i / 3);
    });
  });
  pendingCards(head).slice(0, ZONE_SIZES.pending).forEach((id, i) => {
    const t = ZONE_START.pending + i;
    refs.pending.push(t);
    token(t, 'pending', id, (w) => {
      blankMat(w);
      cardPart(w, id);
      w.num('index', i / 6);
    });
  });
  if (ctx?.sourceCardId != null) {
    const src = ctx.sourceCardId;
    token(ZONE_START.ctx, 'ctx', src, (w) => {
      if (ctxPos) matPart(w, ctxPos[0], ctxPos[1]);
      else blankMat(w);
      w.seg('cardBlock', 6);
      w.num('index', isDragonCard(src) && cardAbilityTypes(dragonCard(src)).includes('Adventurer') ? 1 : 0);
    });
  }
  return refs;
}

// ---------------------------------------------------------------------------

export interface Encoded {
  global: Float32Array;
  tokenIds: Int16Array;
  tokenFeat: Float32Array;
  tokenMask: Uint8Array;
  refs: TokenRefs;
  score: ScoreBreakdown;
}

/** Encode `me`'s decision from its redacted view. Buffers may be supplied (filled in place). */
export function encodeView(
  view: GameState,
  me: PlayerId,
  out?: { global: Float32Array; tokenIds: Int16Array; tokenFeat: Float32Array; tokenMask: Uint8Array },
  record?: { global: Segment[]; token: Segment[] },
): Encoded {
  const global = out?.global ?? new Float32Array(GLOBAL_DIM);
  const tokenIds = out?.tokenIds ?? new Int16Array(NUM_TOKENS);
  const tokenFeat = out?.tokenFeat ?? new Float32Array(NUM_TOKENS * TOKEN_DIM);
  const tokenMask = out?.tokenMask ?? new Uint8Array(NUM_TOKENS);
  global.fill(0);
  tokenIds.fill(0);
  tokenFeat.fill(0);
  tokenMask.fill(0);
  const score = scorePlayer(view, player(view, me));
  const w = new Writer(global, 0, record?.global);
  writeGlobal(view, me, w, score);
  if (w.at !== GLOBAL_DIM) throw new Error(`global has ${w.at} features, expected ${GLOBAL_DIM}`);
  const refs = writeTokens(view, me, tokenIds, tokenFeat, tokenMask, record?.token);
  return { global, tokenIds, tokenFeat, tokenMask, refs, score };
}
