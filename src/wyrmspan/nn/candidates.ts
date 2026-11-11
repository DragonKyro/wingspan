// The learned agent's action space: every decision is a pick among a list of
// legal candidates, each a concrete engine Action sequence plus features.
//
// A candidate's features say what it does (verb, cave/column, the concrete
// items it pays, a summary of the effect it triggers, the option it picks,
// resources it names) and which tokens it involves: `sel` lists the tokens it
// picks / plays / keeps (a hand card to entice, display slots, cards to keep,
// mat spaces for eggs), `pay` the tokens it spends (hand cards discarded,
// tucked or paid; dragons whose eggs pay a cost), and `target` the mat space
// it plays into. The network scores each candidate against the encoded state
// (pointer-style), so the action space has no fixed slot layout.
//
// Every decision the rules leave to the player is offered (rules audit,
// ACTION_SPACE_VERSION 2): gaining a card from the display or the deck; how
// to pay "any resource" / card / egg / item / tithe costs (a few distinct
// mixes: the engine default, cards first, spare resources first, eggs from
// the nests or from dragons); which cave a free play goes into; which drawn
// card is tucked and under which dragon; and declining any optional ability
// step ("these benefits are not mandatory").
//
// Macro: a cost that needs the free 2-for-1 exchange ("at any point during the
// game") carries those exchanges in front of it.
//
// Combinatorial picks are enumerated when small and pruned to a diverse,
// sensible subset otherwise, so a list never exceeds MAX_CANDS. Everything here
// reads the redacted view.

import { answerFor } from '../ai';
import { exploreCost, nextEmptySpace } from '../actions';
import { caveCard, dragonCard, dragonMatchesCond, isDragonCard, parseTrainingTrack, trainingTrackLength } from '../cards';
import { MAT_COVERED_ICONS, legalPlaySpaces } from '../effects';
import { GUILD_TILES, INCOME_SECTIONS, incomeSectionIndex } from '../guild';
import {
  allDragons, canPay, countCounter, dragonPrintedCost, dragonTargetPositions, eggTargetSpots, exchangePlan, payCost, player,
} from '../helpers';
import type {
  Action, ChoiceAnswer, EggSpot, GainItem, GameState, PayUnit, PendingStep, PlayerId, PlayerState, Resource, Step,
} from '../types';
import { RESOURCES } from '../types';
import { SUMMARY_DIM, abilitySummary, summarizeSteps, summaryValue } from './cardFeatures';
import { type TokenRefs, headFor, matToken } from './encode';
import {
  canExplore, enticeOptions, exchangeActions, excavatableCaves, excavateCost, exploreYield, handCaves,
  handDragons,
} from './rules';

export const ACTION_SPACE_VERSION = 2;
export const MAX_CANDS = 64;

export const VERBS = ['entice', 'excavate', 'explore', 'pass', 'decline', 'accept', 'pick'] as const;
export type Verb = (typeof VERBS)[number];

const COST_KEYS = ['coin', 'egg', 'meat', 'gold', 'crystal', 'milk', 'anyRes', 'dragonCard', 'caveCard', 'item'] as const;
const MAX_OPTION = 8;

/** verb 7 + cave 3 + column 4 + cost 10 + exchanges 1 + effect SUMMARY_DIM + effect value 1 + option 8
 *  + resources 4 + selected 1 + paid 1 + guild 3 + explore 2 + ignoredCost 1 + eggs 2. */
export const CAND_DIM = VERBS.length + 3 + 4 + COST_KEYS.length + 1 + SUMMARY_DIM + 1 + MAX_OPTION + 4 + 1 + 1 + 3 + 2 + 1 + 2;

export interface Candidate {
  /** Applied in order; the last one ends the decision. */
  actions: Action[];
  label: string;
  verb: Verb;
  feat: Float32Array;
  /** Tokens this candidate picks / plays / keeps (repeats allowed, e.g. 2 eggs on one dragon). */
  sel: number[];
  /** Tokens it spends: hand cards paid / discarded / tucked, dragons whose eggs pay. */
  pay: number[];
  /** Mat-space token it plays into, or −1. */
  target: number;
}

interface Spec {
  verb: Verb;
  answer?: ChoiceAnswer;
  actions?: Action[];
  /** Actions before the answer (resource exchanges). */
  pre?: Action[];
  label: string;
  cave?: number;
  col?: number;
  cost?: readonly GainItem[];
  exchanges?: number;
  effect?: Float32Array;
  option?: number | number[];
  resources?: readonly Resource[];
  sel?: number[];
  pay?: number[];
  target?: number;
  guild?: [vpPer: number, unlimited: number, estimate: number];
  explore?: [dragons: number, explores: number];
  ignoredCost?: boolean;
  eggs?: [placed: number, nest: number];
}

function build(me: PlayerId, s: Spec): Candidate {
  const f = new Float32Array(CAND_DIM);
  let i = 0;
  f[i + VERBS.indexOf(s.verb)] = 1;
  i += VERBS.length;
  if (s.cave !== undefined && s.cave >= 0) f[i + s.cave] = 1;
  i += 3;
  if (s.col !== undefined && s.col >= 0) f[i + s.col] = 1;
  i += 4;
  for (const it of s.cost ?? []) {
    const key =
      it.kind === 'resource' ? (it.res === 'any' ? 'anyRes' : it.res)
      : it.kind === 'card' ? (it.deck === 'dragon' ? 'dragonCard' : 'caveCard')
      : it.kind === 'coin' || it.kind === 'egg' ? it.kind
      : 'item';
    f[i + COST_KEYS.indexOf(key)]! += it.count / 3;
  }
  i += COST_KEYS.length;
  f[i++] = (s.exchanges ?? s.pre?.length ?? 0) / 3;
  if (s.effect) for (let k = 0; k < SUMMARY_DIM; k++) f[i + k] = s.effect[k]! * 0.5;
  i += SUMMARY_DIM;
  f[i++] = s.effect ? summaryValue(s.effect) / 5 : 0;
  for (const o of Array.isArray(s.option) ? s.option : s.option !== undefined ? [s.option] : []) if (o < MAX_OPTION) f[i + o] = 1;
  i += MAX_OPTION;
  for (const r of s.resources ?? []) f[i + RESOURCES.indexOf(r)]! += 1 / 3;
  i += 4;
  f[i++] = (s.sel?.length ?? 0) / 6;
  f[i++] = (s.pay?.length ?? 0) / 6;
  if (s.guild) s.guild.forEach((v, k) => (f[i + k] = v));
  i += 3;
  if (s.explore) s.explore.forEach((v, k) => (f[i + k] = v));
  i += 2;
  f[i++] = s.ignoredCost ? 1 : 0;
  if (s.eggs) s.eggs.forEach((v, k) => (f[i + k] = v / 5));
  i += 2;
  if (i !== CAND_DIM) throw new Error(`candidate has ${i} features, expected ${CAND_DIM}`);
  const actions = s.actions ?? [...(s.pre ?? []), { type: 'resolveChoice', playerId: me, answer: s.answer ?? { kind: 'decline' } }];
  return { actions, label: s.label, verb: s.verb, feat: f, sel: s.sel ?? [], pay: s.pay ?? [], target: s.target ?? -1 };
}

// ---------------------------------------------------------------------------
// Small combinatorics

function combinations<T>(arr: readonly T[], k: number, limit = Infinity): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (out.length >= limit) return;
    if (acc.length === k) {
      out.push(acc.slice());
      return;
    }
    for (let i = start; i <= arr.length - (k - acc.length); i++) {
      acc.push(arr[i]!);
      rec(i + 1, acc);
      acc.pop();
    }
  };
  if (k >= 0 && k <= arr.length) rec(0, []);
  return out;
}

/** Count vectors over `caps.length` bins summing to n (each ≤ its cap). */
function multisets(caps: readonly number[], n: number, limit = Infinity): number[][] {
  const out: number[][] = [];
  const cur = caps.map(() => 0);
  const rec = (bin: number, left: number) => {
    if (out.length >= limit) return;
    if (bin === caps.length) {
      if (left === 0) out.push(cur.slice());
      return;
    }
    for (let c = Math.min(caps[bin]!, left); c >= 0; c--) {
      cur[bin] = c;
      rec(bin + 1, left - c);
    }
    cur[bin] = 0;
  };
  rec(0, n);
  return out;
}

const expand = <T>(bins: readonly T[], counts: readonly number[]): T[] => bins.flatMap((b, i) => Array(counts[i]).fill(b) as T[]);

/** Rough keep-value of a hand card (low = first to give up). A pruning prior only. */
export function handCardValue(p: PlayerState, id: number): number {
  if (!isDragonCard(id)) return 0.4 + summaryValue(abilitySummary(caveCard(id))) * 0.2;
  const c = dragonCard(id);
  const cost = RESOURCES.reduce((a, r) => a + (c.cost[r] ?? 0) * (p.resources[r] > 0 ? 0.6 : 1), 0) + (c.cost.coin ?? 0) + (c.cost.egg ?? 0);
  return 0.5 + c.vp * 0.4 + summaryValue(abilitySummary(c)) * 0.2 - cost * 0.2;
}

/** Resources to spend for `n` "any" units: most plentiful first (as the engine pays). */
function defaultSpend(p: PlayerState, n: number): Resource[] {
  const have = { ...p.resources };
  const out: Resource[] = [];
  for (let k = 0; k < n; k++) {
    const r = [...RESOURCES].sort((a, b) => have[b] - have[a])[0]!;
    if (have[r] <= 0) break;
    have[r]--;
    out.push(r);
  }
  return out;
}

function gainsSummary(items: readonly GainItem[]): Float32Array {
  return summarizeSteps([{ op: 'gain', items: items as GainItem[] }]);
}

// ---------------------------------------------------------------------------
// Payments: the distinct sensible ways to pay a cost the rules let the player mix.

interface PayOption {
  payment?: PayUnit[];
  /** The concrete items spent (resource types, cards by deck, eggs, coins). */
  cost: GainItem[];
  /** Tokens spent: hand cards, dragons whose eggs are paid. */
  pay: number[];
  label: string;
}

const isChoosable = (it: GainItem) =>
  (it.kind === 'resource' && it.res === 'any') || it.kind === 'card' || it.kind === 'egg' || it.kind === 'item' || it.kind === 'tithe';

/** Resource units, the least needed by the hand's dragons first. */
function spareResourceUnits(p: PlayerState): PayUnit[] {
  const need: Record<Resource, number> = { meat: 0, gold: 0, crystal: 0, milk: 0 };
  for (const id of handDragons(p)) for (const r of RESOURCES) need[r] += dragonCard(id).cost[r] ?? 0;
  const have = { ...p.resources };
  const out: PayUnit[] = [];
  for (;;) {
    const r = [...RESOURCES].filter((x) => have[x] > 0).sort((a, b) => have[b] - need[b] - (have[a] - need[a]))[0];
    if (!r) return out;
    have[r]--;
    out.push({ kind: 'resource', res: r });
  }
}

function eggUnits(p: PlayerState, nestFirst: boolean): PayUnit[] {
  const nest: PayUnit[] = Array.from({ length: p.nestEggs }, () => ({ kind: 'egg', spot: { kind: 'nest' } }));
  const dragons: PayUnit[] = allDragons(p)
    // Spend the eggs of the dragons with the most room to refill first.
    .sort((a, b) => b.dragon.eggs - a.dragon.eggs)
    .flatMap((d) => Array.from({ length: d.dragon.eggs }, (): PayUnit => ({ kind: 'egg', spot: { kind: 'dragon', pos: [d.cave, d.space] } })));
  return nestFirst ? [...nest, ...dragons] : [...dragons, ...nest];
}

/** Up to `limit` distinct ways to pay `cost` (deduplicated by their outcome). */
function paymentOptions(p: PlayerState, cost: readonly GainItem[], refs: TokenRefs, limit = 4): PayOption[] {
  const describe = (payment?: PayUnit[]): PayOption & { key: string } => {
    const { player: q, discarded } = payCost(p, cost, payment);
    const spent: GainItem[] = [];
    for (const r of RESOURCES) if (p.resources[r] > q.resources[r]) spent.push({ kind: 'resource', res: r, count: p.resources[r] - q.resources[r] });
    if (p.coins > q.coins) spent.push({ kind: 'coin', count: p.coins - q.coins });
    const eggs = (x: PlayerState) => x.nestEggs + allDragons(x).reduce((a, d) => a + d.dragon.eggs, 0);
    if (eggs(p) > eggs(q)) spent.push({ kind: 'egg', count: eggs(p) - eggs(q) });
    const dc = discarded.filter(isDragonCard).length;
    const cc = discarded.length - dc;
    if (dc) spent.push({ kind: 'card', deck: 'dragon', count: dc });
    if (cc) spent.push({ kind: 'card', deck: 'cave', count: cc });
    const pay = discarded.map((id) => refs.hand.get(id)).filter((t): t is number => t !== undefined);
    const eggTokens: string[] = [];
    allDragons(p).forEach((d) => {
      const after = q.caves[d.cave]!.spaces[d.space]!.dragon!.eggs;
      for (let k = after; k < d.dragon.eggs; k++) {
        pay.push(matToken(d.cave, d.space));
        eggTokens.push(`${d.cave}${d.space}`);
      }
    });
    const nestPaid = p.nestEggs - q.nestEggs;
    const parts = [
      ...spent.filter((x) => x.kind === 'resource').map((x) => `${x.count} ${x.kind === 'resource' ? x.res : ''}`),
      ...(discarded.length ? [`cards ${discarded.join(',')}`] : []),
      ...(nestPaid ? [`${nestPaid} nest egg${nestPaid > 1 ? 's' : ''}`] : []),
      ...(eggTokens.length ? [`eggs from ${eggTokens.join(',')}`] : []),
    ];
    const key = JSON.stringify([q.resources, [...q.hand].sort(), q.nestEggs, allDragons(q).map((d) => d.dragon.eggs)]);
    return { payment, cost: spent, pay, label: parts.length ? ` (paying ${parts.join(', ')})` : '', key };
  };
  if (!cost.some(isChoosable)) {
    const d = describe(undefined);
    return [{ payment: undefined, cost: d.cost, pay: d.pay, label: '' }];
  }
  const cards: PayUnit[] = [...p.hand].sort((a, b) => handCardValue(p, a) - handCardValue(p, b)).map((cardId) => ({ kind: 'card', cardId }));
  const spare = spareResourceUnits(p);
  const variants: (PayUnit[] | undefined)[] = [
    undefined, // the engine's default
    [...spare, ...cards, ...eggUnits(p, true)], // spare resources first
    [...cards, ...spare, ...eggUnits(p, true)], // cheapest cards first
    [...spare, ...cards, ...eggUnits(p, false)], // eggs from dragons rather than the nests
  ];
  // Card costs of one type: each of the cheapest few cards of that type.
  for (const it of cost) {
    if (it.kind !== 'card') continue;
    const ofType = cards.filter((u) => u.kind === 'card' && isDragonCard(u.cardId) === (it.deck === 'dragon'));
    for (const u of ofType.slice(0, 3)) variants.push([u, ...spare, ...cards, ...eggUnits(p, true)]);
  }
  const seen = new Set<string>();
  const out: PayOption[] = [];
  for (const v of variants) {
    const d = describe(v);
    if (seen.has(d.key)) continue;
    seen.add(d.key);
    out.push({ payment: d.payment, cost: d.cost, pay: d.pay, label: d.label });
    if (out.length >= limit) break;
  }
  return out;
}

/** Ways to pay `cost` now, or after resource exchanges (with the exchanges to make). */
function affordablePayments(me: PlayerId, p: PlayerState, cost: readonly GainItem[], refs: TokenRefs, limit = 4): (PayOption & { pre: Action[] })[] {
  if (canPay(p, cost as GainItem[])) return paymentOptions(p, cost, refs, limit).map((o) => ({ ...o, pre: [] }));
  const plan = exchangePlan(p, cost);
  if (!plan) return [];
  const q: PlayerState = { ...p, resources: { ...p.resources } };
  for (const x of plan) {
    for (const r of x.give) q.resources[r] -= 1;
    q.resources[x.get] += 1;
  }
  return paymentOptions(q, cost, refs, limit).map((o) => ({ ...o, pre: exchangeActions(me, plan), label: `${o.label} after ${plan.length} exchange(s)` }));
}

// ---------------------------------------------------------------------------
// Generators

interface Ctx {
  view: GameState;
  me: PlayerId;
  p: PlayerState;
  refs: TokenRefs;
  out: Spec[];
}

function mainTurn(c: Ctx): void {
  const { view, me, p, refs, out } = c;
  out.push({ verb: 'pass', label: 'pass', actions: [{ type: 'pass', playerId: me }] });
  for (let cave = 0; cave < 3; cave++) {
    if (!canExplore(p, cave)) continue;
    const y = exploreYield(p, cave);
    for (const o of paymentOptions(p, exploreCost(p, cave), refs, 2)) {
      out.push({
        verb: 'explore', label: `explore cave ${cave + 1}${o.label}`, actions: [{ type: 'explore', playerId: me, cave, payment: o.payment }],
        cave, cost: o.cost, pay: o.pay, effect: y.summary,
        explore: [y.dragons / 4, p.explores[(['crimson', 'golden', 'amethyst'] as const)[cave]] / 3],
      });
    }
  }
  for (const id of handDragons(p)) {
    const card = dragonCard(id);
    for (const o of enticeOptions(view, p, id)) {
      const afterExchange: PlayerState = { ...p, resources: { ...p.resources } };
      for (const x of o.exchanges) {
        for (const r of x.give) afterExchange.resources[r] -= 1;
        afterExchange.resources[x.get] += 1;
      }
      for (const pay of paymentOptions(afterExchange, o.cost, refs, 2)) {
        out.push({
          verb: 'entice', label: `entice ${card.name} → cave ${o.cave + 1}${pay.label}`,
          actions: [...exchangeActions(me, o.exchanges), { type: 'entice', playerId: me, cave: o.cave, cardId: id, payment: pay.payment }],
          cave: o.cave, col: o.space, cost: pay.cost, pay: pay.pay, exchanges: o.exchanges.length, ignoredCost: o.ignoredCost,
          effect: card.abilityType.includes('WhenPlayed') ? abilitySummary(card) : undefined,
          sel: refs.hand.has(id) ? [refs.hand.get(id)!] : [], target: matToken(o.cave, o.space),
        });
      }
    }
  }
  const caves = excavatableCaves(p);
  for (const id of handCaves(p)) {
    for (const cave of caves) {
      const space = nextEmptySpace(p, cave);
      const effect = abilitySummary(caveCard(id)).slice();
      summarizeSteps(MAT_COVERED_ICONS[cave]![space]!, effect);
      for (const o of paymentOptions(p, excavateCost(p, cave)!, refs, 2)) {
        out.push({
          verb: 'excavate', label: `excavate cave ${cave + 1} with cave #${caveCard(id).number}${o.label}`,
          actions: [{ type: 'excavate', playerId: me, cave, cardId: id, payment: o.payment }],
          cave, col: space, cost: o.cost, pay: o.pay, effect,
          sel: refs.hand.has(id) ? [refs.hand.get(id)!] : [], target: matToken(cave, space),
        });
      }
    }
  }
}

function resourcePicks(c: Ctx, head: Extract<PendingStep, { kind: 'chooseResource' | 'setupResources' }>): void {
  const { p, out } = c;
  const count = head.count;
  const gain = head.kind === 'setupResources' || head.mode === 'gain';
  const types = gain ? (head.kind === 'chooseResource' && head.allowed ? head.allowed : RESOURCES) : RESOURCES;
  const caps = types.map((r) => (gain ? count : p.resources[r]));
  const n = Math.min(count, caps.reduce((a, b) => a + b, 0));
  let sets = multisets(caps, n, 200);
  if (sets.length > 40) sets = sets.filter((v) => v.filter((x) => x > 0).length <= 2).slice(0, 40);
  if (head.kind === 'chooseResource' && head.upTo) out.push({ verb: 'decline', label: 'decline', answer: { kind: 'decline' } });
  for (const v of sets) {
    const resources = expand(types, v);
    out.push({
      verb: 'pick', label: `${gain ? 'gain' : head.mode} ${resources.join('+') || 'nothing'}`,
      answer: { kind: 'resources', resources }, resources,
      cost: gain ? undefined : resources.map((r) => ({ kind: 'resource', res: r, count: 1 }) as GainItem),
    });
  }
}

/** Egg spots (placement or payment) as multisets, pruned to concentrated variants when large. */
function eggChoices(spots: { spot: EggSpot; cap: number }[], n: number): EggSpot[][] {
  const total = spots.reduce((a, s) => a + s.cap, 0);
  const k = Math.min(n, total);
  if (k <= 0) return [];
  const all = multisets(spots.map((s) => s.cap), k, 33);
  if (all.length <= 32) return all.map((v) => expand(spots.map((s) => s.spot), v));
  // Too many: for each spot, put as much as possible there and the rest on the earliest others.
  const out: EggSpot[][] = [];
  for (let j = 0; j < spots.length; j++) {
    const counts = spots.map(() => 0);
    let left = k;
    counts[j] = Math.min(spots[j]!.cap, left);
    left -= counts[j]!;
    for (let i = 0; i < spots.length && left > 0; i++) {
      if (i === j) continue;
      const add = Math.min(spots[i]!.cap, left);
      counts[i]! += add;
      left -= add;
    }
    out.push(expand(spots.map((s) => s.spot), counts));
  }
  return out;
}

const spotToken = (s: EggSpot): number => (s.kind === 'dragon' ? matToken(s.pos[0], s.pos[1]) : -1);

function eggSpots(c: Ctx, head: Extract<PendingStep, { kind: 'chooseEggSpot' }>): void {
  const { p, out } = c;
  const ctxPos = head.resume?.ctx.dragon;
  const spots: { spot: EggSpot; cap: number }[] = [];
  if (head.target.kind === 'any' && p.nestEggs < 2) spots.push({ spot: { kind: 'nest' }, cap: 2 - p.nestEggs });
  for (const pos of eggTargetSpots(p, head.target, ctxPos) as { cave: number; space: number }[]) {
    const d = p.caves[pos.cave]!.spaces[pos.space]!.dragon!;
    spots.push({ spot: { kind: 'dragon', pos: [pos.cave, pos.space] }, cap: dragonCard(d.cardId).capacity - d.eggs });
  }
  if (head.optional || !spots.length) out.push({ verb: 'decline', label: 'lay no eggs', answer: { kind: 'decline' } });
  for (const list of eggChoices(spots, head.count)) {
    const nest = list.filter((s) => s.kind === 'nest').length;
    out.push({
      verb: 'pick', label: `lay ${list.map((s) => (s.kind === 'nest' ? 'nest' : s.pos.join(':'))).join(', ')}`,
      answer: { kind: 'eggSpots', spots: list }, sel: list.map(spotToken).filter((t) => t >= 0), eggs: [list.length, nest],
    });
  }
}

function eggPayment(c: Ctx, head: Extract<PendingStep, { kind: 'chooseEggPayment' }>): void {
  const { p, out } = c;
  const spots: { spot: EggSpot; cap: number }[] = [];
  if (p.nestEggs > 0) spots.push({ spot: { kind: 'nest' }, cap: p.nestEggs });
  for (const d of allDragons(p)) if (d.dragon.eggs > 0) spots.push({ spot: { kind: 'dragon', pos: [d.cave, d.space] }, cap: d.dragon.eggs });
  const choices = eggChoices(spots, head.count);
  if (!choices.length) out.push({ verb: 'decline', label: 'no eggs to pay', answer: { kind: 'eggSpots', spots: [] } });
  for (const list of choices) {
    out.push({
      verb: 'pick', label: `pay eggs ${list.map((s) => (s.kind === 'nest' ? 'nest' : s.pos.join(':'))).join(', ')}`,
      answer: { kind: 'eggSpots', spots: list }, pay: list.map(spotToken).filter((t) => t >= 0),
      cost: [{ kind: 'egg', count: list.length }], eggs: [list.length, list.filter((s) => s.kind === 'nest').length],
    });
  }
}

function cache(c: Ctx, head: Extract<PendingStep, { kind: 'chooseCache' }>): void {
  const { p, out } = c;
  const positions = dragonTargetPositions(p, head.target, head.resume?.ctx.dragon);
  out.push({ verb: 'decline', label: 'cache nothing', answer: { kind: 'decline' } });
  if (!positions.length) return;
  const fromSupply = head.from === 'supply';
  const choose = head.res === 'any';
  const available = fromSupply ? (choose ? RESOURCES.reduce((a, r) => a + p.resources[r], 0) : p.resources[head.res as Resource]) : head.count;
  const n = Math.min(head.count, available);
  if (n <= 0) return;
  const counts = head.upTo ? Array.from({ length: n }, (_, k) => n - k) : [n];
  const plans: Resource[][] = [];
  for (const k of counts) {
    if (!choose) plans.push(Array(k).fill(head.res) as Resource[]);
    else if (fromSupply) {
      // Spend the most plentiful first, plus (at full count) each other affordable mix.
      plans.push(defaultSpend(p, k));
      if (k === n) {
        for (const v of multisets(RESOURCES.map((r) => p.resources[r]), k, 12)) {
          const plan = expand(RESOURCES, v);
          if (plan.join() !== plans[0]!.join()) plans.push(plan);
        }
      }
    } else if (k === n) {
      // Free cache from the general supply: the type only matters for "cache X here" hooks.
      for (const r of RESOURCES) plans.push(Array(k).fill(r) as Resource[]);
    } else plans.push(Array(k).fill('meat') as Resource[]);
  }
  const posKey = (q: { cave: number; space: number }) => matToken(q.cave, q.space);
  const add = (q: { cave: number; space: number }, plan: Resource[]) =>
    out.push({
      verb: 'pick', label: `cache ${plan.join('+')} on ${q.cave}:${q.space}`,
      answer: { kind: 'dragons', positions: [[q.cave, q.space]], resources: plan },
      sel: plan.map(() => posKey(q)), target: posKey(q), resources: plan,
      cost: fromSupply ? plan.map((r) => ({ kind: 'resource', res: r, count: 1 }) as GainItem) : undefined,
      effect: summarizeSteps([{ op: 'cache', count: plan.length, res: 'any', from: 'general', target: { kind: 'here' } }]),
    });
  // Every target with the default plan; every alternative plan on the first target.
  for (const q of positions) add(q, plans[0]!);
  for (const plan of plans.slice(1)) add(positions[0]!, plan);
}

function tuck(c: Ctx, head: Extract<PendingStep, { kind: 'chooseTuck' }>): void {
  const { p, refs, out } = c;
  const positions = dragonTargetPositions(p, head.target, head.resume?.ctx.dragon);
  // Abilities are optional: tucking can always be declined.
  out.push({ verb: 'decline', label: 'tuck nothing', answer: { kind: 'decline' } });
  if (!positions.length) return;
  const effect = (k: number) => summarizeSteps([{ op: 'tuck', count: k, from: 'deck', target: { kind: 'here' } }]);
  if (head.from === 'deck') {
    for (const q of positions) {
      const t = matToken(q.cave, q.space);
      out.push({ verb: 'pick', label: `tuck ${head.count} from deck on ${q.cave}:${q.space}`, answer: { kind: 'dragons', positions: [[q.cave, q.space]] }, sel: [t], target: t, effect: effect(head.count) });
    }
    return;
  }
  const cards = handDragons(p).sort((a, b) => handCardValue(p, a) - handCardValue(p, b));
  const max = Math.min(head.count, cards.length);
  if (max <= 0) return;
  const sizes = head.upTo ? Array.from({ length: max }, (_, k) => max - k) : [max];
  const add = (ids: number[], q: { cave: number; space: number }) => {
    const t = matToken(q.cave, q.space);
    out.push({
      verb: 'pick', label: `tuck ${ids.map((id) => dragonCard(id).name).join(', ')} on ${q.cave}:${q.space}`,
      answer: { kind: 'assignTucks', assignments: ids.map((cardId) => ({ cardId, pos: [q.cave, q.space] as [number, number] })) },
      pay: ids.map((id) => refs.hand.get(id)).filter((x): x is number => x !== undefined), sel: [t], target: t,
      cost: [{ kind: 'card', deck: 'dragon', count: ids.length }], effect: effect(ids.length),
    });
  };
  for (const k of sizes) {
    const cheapest = cards.slice(0, k);
    for (const q of positions) add(cheapest, q);
    if (k === 1 || k === max) {
      // Alternatives: any single card swapped in for the most valuable of the cheapest set.
      for (const id of cards.slice(k, k + 6)) add([...cheapest.slice(0, k - 1), id], positions[0]!);
    }
  }
}

function handCards(c: Ctx, head: Extract<PendingStep, { kind: 'chooseHandCards' }>): void {
  const { p, refs, out } = c;
  const pool = p.hand.filter((id) => head.what === 'any' || (head.what === 'dragon') === isDragonCard(id));
  pool.sort((a, b) => handCardValue(p, a) - handCardValue(p, b));
  out.push({ verb: 'decline', label: 'keep my cards', answer: { kind: 'decline' } });
  const sizes = head.perCard ? Array.from({ length: Math.min(head.count, pool.length) }, (_, k) => k + 1) : pool.length >= head.count ? [head.count] : [];
  for (const k of sizes) {
    const sets = combinations(pool, k, 400);
    sets.sort((a, b) => a.reduce((x, id) => x + handCardValue(p, id), 0) - b.reduce((x, id) => x + handCardValue(p, id), 0));
    for (const ids of sets.slice(0, head.perCard ? 8 : 20)) {
      const effect = new Float32Array(SUMMARY_DIM);
      if (head.activateDiscarded) effect.set(abilitySummary(isDragonCard(ids[0]!) ? dragonCard(ids[0]!) : caveCard(ids[0]!)));
      else if (head.then) for (let t = 0; t < (head.perCard ? k : 1); t++) summarizeSteps(head.then, effect);
      out.push({
        verb: 'pick', label: `${head.purpose} ${ids.join(',')}`, answer: { kind: 'cards', cardIds: ids },
        pay: ids.map((id) => refs.hand.get(id)).filter((x): x is number => x !== undefined),
        cost: [{ kind: 'card', deck: head.what === 'cave' ? 'cave' : 'dragon', count: ids.length }], effect,
      });
    }
  }
}

function display(c: Ctx, head: Extract<PendingStep, { kind: 'chooseDisplay' }>): void {
  const { view, refs, out } = c;
  const disp = head.deck === 'dragon' ? view.dragonDisplay : view.caveDisplay;
  const toks = head.deck === 'dragon' ? refs.dDisplay : refs.cDisplay;
  disp.forEach((id, i) => {
    if (id != null) out.push({ verb: 'pick', label: `take display ${i + 1}`, answer: { kind: 'index', index: i }, sel: [toks[i]!], option: i });
  });
  // A plain "gain" may take the top of the deck instead (an older step without
  // orDeck falls back to the deck too); "from the display" can only be declined.
  if (head.orDeck !== false) out.push({ verb: 'pick', label: 'draw from the deck', answer: { kind: 'decline' }, option: 3 });
  else if (!out.length) out.push({ verb: 'decline', label: 'no face-up card', answer: { kind: 'decline' } });
}

/** Where a drawn / picked card can be played: dragons into a cave's leftmost space, cave cards into a cave. */
function placementsFor(p: PlayerState, cardId: number, onTop?: boolean): { cave: number; space: number }[] {
  if (isDragonCard(cardId)) return legalPlaySpaces(p, cardId, onTop);
  return [0, 1, 2].map((cave) => ({ cave, space: nextEmptySpace(p, cave) })).filter((x) => x.space >= 0);
}

function distribute(c: Ctx, head: Extract<PendingStep, { kind: 'distributeCards' }>): void {
  const { p, refs, out } = c;
  const n = head.cardIds.length;
  if (head.playFree) {
    head.cardIds.forEach((id, i) => {
      const card = isDragonCard(id) ? dragonCard(id) : caveCard(id);
      const name = 'name' in card && card.name ? card.name : `#${id}`;
      const sel = [refs.pending[i] ?? -1].filter((t) => t >= 0);
      const places = placementsFor(p, id);
      if (!places.length) {
        out.push({ verb: 'pick', label: `pick ${name} (nowhere to play it)`, answer: { kind: 'indexes', indexes: [i] }, sel, option: i });
        return;
      }
      for (const at of places) {
        out.push({
          verb: 'pick', label: `play ${name} at ${at.cave}:${at.space}`, answer: { kind: 'play', index: i, pos: [at.cave, at.space] },
          sel, option: i, effect: abilitySummary(card), cave: at.cave, col: at.space, target: matToken(at.cave, at.space),
        });
      }
    });
    return;
  }
  const keep = Math.min(head.keep ?? n, n);
  const tuckN = typeof head.tuck === 'number' ? head.tuck : 0;
  const positions = tuckN > 0 ? dragonTargetPositions(p, head.tuckTarget ?? { kind: 'any' }, head.resume?.ctx.dragon).slice(0, 4) : [];
  for (const set of combinations(head.cardIds.map((_, i) => i), keep, 40)) {
    const sel = set.map((i) => refs.pending[i]).filter((t): t is number => t !== undefined);
    const leftover = head.cardIds.map((_, i) => i).filter((i) => !set.includes(i) && isDragonCard(head.cardIds[i]!));
    const k = Math.min(tuckN, leftover.length);
    if (k <= 0 || !positions.length || leftover.length <= k && positions.length <= 1) {
      out.push({ verb: 'pick', label: `keep ${set.join(',')}`, answer: { kind: 'indexes', indexes: set }, sel, option: set });
      continue;
    }
    // Which leftover card(s) to tuck, and under which dragon.
    for (const tucked of combinations(leftover, k, 6)) {
      for (const q of positions) {
        const t = matToken(q.cave, q.space);
        out.push({
          verb: 'pick', label: `keep ${set.join(',')}, tuck ${tucked.join(',')} under ${q.cave}:${q.space}`,
          answer: { kind: 'indexes', indexes: set, tucks: tucked.map((index) => ({ index, pos: [q.cave, q.space] as [number, number] })) },
          sel, option: set, target: t,
          pay: tucked.map((i) => refs.pending[i]).filter((x): x is number => x !== undefined),
        });
      }
    }
  }
}

function ability(c: Ctx, head: Extract<PendingStep, { kind: 'chooseAbility' }>): void {
  const { p, out } = c;
  out.push({ verb: 'decline', label: 'activate nothing', answer: { kind: 'decline' } });
  const k = Math.min(head.count, head.candidates.length);
  for (const set of combinations(head.candidates.map((_, i) => i), k, 40)) {
    if (head.distinct && new Set(set.map((i) => head.candidates[i]!.dragon?.join(','))).size < set.length) continue;
    const effect = new Float32Array(SUMMARY_DIM);
    const sel: number[] = [];
    for (const i of set) {
      const cand = head.candidates[i]!;
      if (cand.dragon) {
        const d = p.caves[cand.dragon[0]]!.spaces[cand.dragon[1]]!.dragon;
        if (d) abilitySummary(dragonCard(d.cardId)).forEach((v, x) => (effect[x]! += v));
        sel.push(matToken(cand.dragon[0], cand.dragon[1]));
      }
    }
    out.push({ verb: 'pick', label: `activate ${set.map((i) => head.candidates[i]!.label).join(', ')}`, answer: { kind: 'indexes', indexes: set }, sel, option: set, effect });
  }
}

function excavateChoice(c: Ctx, head: Extract<PendingStep, { kind: 'chooseExcavate' }>): void {
  const { view, p, refs, out } = c;
  out.push({ verb: 'decline', label: 'excavate nothing', answer: { kind: 'decline' } });
  const hand = handCaves(p);
  const disp = view.caveDisplay.map((id, i) => [id, i] as const).filter((x): x is readonly [number, number] => x[0] !== null);
  const pool: { id: number | null; tok: number }[] =
    head.source === 'hand' ? hand.map((id) => ({ id, tok: refs.hand.get(id) ?? -1 }))
    : head.source === 'display' ? disp.map(([id, i]) => ({ id, tok: refs.cDisplay[i]! }))
    : head.source === 'handOrDisplay' ? [...hand.map((id) => ({ id, tok: refs.hand.get(id) ?? -1 })), ...disp.map(([id, i]) => ({ id, tok: refs.cDisplay[i]! }))]
    : [{ id: null, tok: -1 }];
  const caves = [0, 1, 2].filter((cv) => nextEmptySpace(p, cv) >= 0);
  pool.forEach((card, poolIdx) => {
    for (const cave of caves) {
      const space = nextEmptySpace(p, cave);
      const effect = card.id != null ? abilitySummary(caveCard(card.id)).map((v) => v * (head.activateTimes ?? 1)) : new Float32Array(SUMMARY_DIM);
      summarizeSteps(MAT_COVERED_ICONS[cave]![space]!, effect);
      out.push({
        verb: 'pick', label: `excavate cave ${cave + 1} with ${card.id != null ? `cave #${caveCard(card.id).number}` : 'the top card'}`,
        answer: { kind: 'index', index: poolIdx * 3 + cave }, cave, col: space, effect,
        sel: card.tok >= 0 ? [card.tok] : [], target: matToken(cave, space),
      });
    }
  });
}

function playDragon(c: Ctx, head: Extract<PendingStep, { kind: 'choosePlayDragon' }>): void {
  const { view, me, p, refs, out } = c;
  out.push({ verb: 'decline', label: 'play nothing', answer: { kind: 'decline' } });
  if (head.source === 'deck') {
    out.push({ verb: 'pick', label: 'play the top dragon of the deck', answer: { kind: 'index', index: 0 } });
    return;
  }
  const hand = handDragons(p).map((id) => ({ id, tok: refs.hand.get(id) ?? -1 }));
  const disp = view.dragonDisplay.map((id, i) => ({ id, tok: refs.dDisplay[i]! })).filter((x): x is { id: number; tok: number } => x.id !== null);
  const raw = head.source === 'hand' ? hand : head.source === 'display' ? disp : [...hand, ...disp];
  const pool = head.cond ? raw.filter((x) => dragonMatchesCond(dragonCard(x.id), head.cond!)) : raw;
  pool.forEach((x, i) => {
    const card = dragonCard(x.id);
    const printed = dragonPrintedCost(x.id);
    // "Pay its printed costs": the player's payment (and exchanges); otherwise free / discounted later.
    const pays = head.discount === 'full' ? affordablePayments(me, p, printed, refs, 2) : [{ payment: undefined, cost: [] as GainItem[], pay: [] as number[], label: '', pre: [] as Action[] }];
    for (const at of legalPlaySpaces(p, x.id, head.onTop)) {
      for (const o of pays) {
        out.push({
          verb: 'pick', label: `play ${card.name} at ${at.cave}:${at.space}${o.label}`,
          answer: { kind: 'play', index: i, pos: [at.cave, at.space], payment: o.payment }, pre: o.pre,
          cave: at.cave, col: at.space, cost: head.discount === 'full' ? o.cost : Array.isArray(head.discount) ? printed : undefined,
          pay: o.pay, sel: x.tok >= 0 ? [x.tok] : [], target: matToken(at.cave, at.space),
          effect: card.abilityType.includes('WhenPlayed') ? abilitySummary(card) : undefined,
        });
      }
    }
  });
}

function waived(cost: GainItem[], waive: GainItem[]): GainItem[] {
  const key = (i: GainItem) => (i.kind === 'resource' ? `r:${i.res}` : i.kind === 'card' ? `c:${i.deck}` : i.kind);
  const out = cost.map((i) => ({ ...i }));
  for (const w of waive) {
    const j = out.findIndex((i) => key(i) === key(w) && i.count > 0);
    if (j >= 0) out[j]!.count = Math.max(0, out[j]!.count - w.count);
  }
  return out.filter((i) => i.count > 0);
}

function payDragonCost(c: Ctx, head: Extract<PendingStep, { kind: 'payDragonCost' }>): void {
  const { me, p, refs, out } = c;
  out.push({ verb: 'decline', label: 'do not play it', answer: { kind: 'decline' } });
  head.options.forEach((o, i) => {
    for (const pay of affordablePayments(me, p, waived(dragonPrintedCost(head.cardId), o.waive), refs, 2)) {
      out.push({
        verb: 'accept', label: `${o.label}${pay.label}`, answer: { kind: 'option', index: i, payment: pay.payment }, pre: pay.pre,
        cost: pay.cost, pay: pay.pay, option: i, sel: refs.pending.slice(0, 1), target: matToken(head.pos[0], head.pos[1]),
      });
    }
  });
}

function guildSquare(c: Ctx): void {
  const { view, p, out } = c;
  const tile = GUILD_TILES[view.guild.tile];
  tile.squares.forEach((sq, i) => {
    if (!sq.unlimited && (view.guild.squares[i] ?? []).length > 0) return;
    const eg = sq.endGame;
    let estimate = 0;
    if (eg) {
      if (eg.gamblerDraw4) estimate = 8;
      else {
        let units = eg.counter ? countCounter(view, p, eg.counter) : 1;
        if (eg.divisor) units = Math.floor(units / eg.divisor);
        estimate = eg.vpPer * units;
        if (eg.max !== undefined) estimate = Math.min(estimate, eg.max);
      }
    }
    out.push({
      verb: 'pick', label: sq.label, answer: { kind: 'index', index: i }, option: i,
      effect: sq.immediate ? summarizeSteps(sq.immediate) : undefined,
      guild: [eg ? (eg.flat ?? eg.vpPer) / 5 : 0, sq.unlimited ? 1 : 0, estimate / 10],
    });
  });
  if (!out.length) out.push({ verb: 'decline', label: 'no open square', answer: { kind: 'decline' } });
}

function option(c: Ctx, head: Extract<PendingStep, { kind: 'chooseOption' }>): void {
  const { out } = c;
  const data = head.resume?.ctx.data;
  const repeat = data?.repeatSteps !== undefined ? (JSON.parse(String(data.repeatSteps)) as Step[]) : null;
  head.options.forEach((o, i) => {
    let effect: Float32Array | undefined;
    if (repeat) effect = i === 0 ? summarizeSteps(repeat) : undefined;
    else {
      effect = o.steps ? summarizeSteps(o.steps) : new Float32Array(SUMMARY_DIM);
      if (o.items) summarizeSteps([{ op: 'gain', items: o.items }], effect);
    }
    out.push({ verb: repeat && i === 1 ? 'decline' : 'pick', label: o.label, answer: { kind: 'option', index: i }, option: i, effect });
  });
  // Abilities are optional: "either A or B" may also be neither (repeats already offer "stop").
  if (!repeat) out.push({ verb: 'decline', label: 'neither', answer: { kind: 'decline' } });
}

function train(c: Ctx, head: Extract<PendingStep, { kind: 'chooseTrain' }>): void {
  const { me, p, refs, out } = c;
  out.push({ verb: 'decline', label: 'do not train', answer: { kind: 'decline' } });
  const ctxPos = head.resume?.ctx.dragon;
  const eligible = head.pos
    ? [{ cave: head.pos[0], space: head.pos[1] }]
    : allDragons(p)
        .filter((d) => {
          const card = dragonCard(d.dragon.cardId);
          const len = trainingTrackLength(card);
          if (card.size !== 'Fledgling' || len === 0 || (d.dragon.training ?? 0) >= len) return false;
          return head.target !== 'orthAdjacent' || (!!ctxPos && Math.abs(ctxPos[0] - d.cave) + Math.abs(ctxPos[1] - d.space) === 1);
        })
        .map((d) => ({ cave: d.cave, space: d.space }));
  for (const pos of eligible) {
    const d = p.caves[pos.cave]!.spaces[pos.space]!.dragon;
    if (!d) continue;
    const track = parseTrainingTrack(dragonCard(d.cardId).trainingTrack);
    const at = d.training ?? 0;
    const times = head.times === 'full' ? track.length - at : head.times;
    const boxes = track.slice(at, at + times);
    if (!boxes.length) continue;
    const t = matToken(pos.cave, pos.space);
    const free = head.free || head.gainItem;
    const pays = free ? [{ payment: undefined, cost: [] as GainItem[], pay: [] as number[], label: '', pre: [] as Action[] }] : affordablePayments(me, p, boxes.slice(0, 1), refs, 3);
    for (const o of pays) {
      out.push({
        verb: 'accept', label: `train ${dragonCard(d.cardId).name}${o.label}`, answer: { kind: 'dragon', pos: [pos.cave, pos.space], payment: o.payment },
        pre: o.pre, cost: free ? undefined : boxes, pay: o.pay, effect: head.gainItem ? gainsSummary(boxes) : undefined,
        sel: [t], target: t, col: pos.space, cave: pos.cave,
      });
    }
  }
}

function swap(c: Ctx): void {
  const { p, out } = c;
  out.push({ verb: 'decline', label: 'swap nothing', answer: { kind: 'decline' } });
  const ds = allDragons(p);
  for (const [a, b] of combinations(ds, 2, 40)) {
    out.push({
      verb: 'pick', label: `swap ${a!.cave}:${a!.space} ↔ ${b!.cave}:${b!.space}`,
      answer: { kind: 'dragons', positions: [[a!.cave, a!.space], [b!.cave, b!.space]] },
      sel: [matToken(a!.cave, a!.space), matToken(b!.cave, b!.space)],
    });
  }
}

function handDragonSwap(c: Ctx): void {
  const { p, refs, out } = c;
  out.push({ verb: 'decline', label: 'swap nothing', answer: { kind: 'decline' } });
  const mat = allDragons(p);
  const hand = handDragons(p);
  const pairs: { score: number; h: number; m: number }[] = [];
  hand.forEach((id, h) => mat.forEach((d, m) => pairs.push({ score: dragonCard(id).vp - dragonCard(d.dragon.cardId).vp, h, m })));
  pairs.sort((a, b) => b.score - a.score);
  for (const { h, m } of pairs.slice(0, 30)) {
    const d = mat[m]!;
    out.push({
      verb: 'pick', label: `swap in ${dragonCard(hand[h]!).name} for ${dragonCard(d.dragon.cardId).name}`,
      answer: { kind: 'index', index: h * mat.length + m },
      sel: [refs.hand.get(hand[h]!) ?? -1].filter((t) => t >= 0), target: matToken(d.cave, d.space),
      effect: dragonCard(hand[h]!).abilityType.includes('WhenPlayed') ? abilitySummary(dragonCard(hand[h]!)) : undefined,
    });
  }
}

function caveCardSwap(c: Ctx): void {
  const { p, refs, out } = c;
  out.push({ verb: 'decline', label: 'swap nothing', answer: { kind: 'decline' } });
  const uncovered: { cave: number; space: number }[] = [];
  p.caves.forEach((row, cave) => row.spaces.forEach((sp, space) => {
    if (sp.excavated && sp.caveCardId !== null && !sp.dragon) uncovered.push({ cave, space });
  }));
  const hand = handCaves(p);
  const pairs: { score: number; h: number; u: number }[] = [];
  hand.forEach((id, h) => uncovered.forEach((_, u) => pairs.push({ score: summaryValue(abilitySummary(caveCard(id))), h, u })));
  pairs.sort((a, b) => b.score - a.score);
  for (const { h, u } of pairs.slice(0, 30)) {
    const at = uncovered[u]!;
    out.push({
      verb: 'pick', label: `swap cave #${caveCard(hand[h]!).number} into ${at.cave}:${at.space}`,
      answer: { kind: 'index', index: h * uncovered.length + u },
      sel: [refs.hand.get(hand[h]!) ?? -1].filter((t) => t >= 0), target: matToken(at.cave, at.space),
      effect: abilitySummary(caveCard(hand[h]!)),
    });
  }
}

function pay(c: Ctx, head: Extract<PendingStep, { kind: 'choosePay' }>): void {
  const { me, p, refs, out } = c;
  out.push({ verb: 'decline', label: 'do not pay', answer: { kind: 'decline' } });
  head.tiers.forEach((t, i) => {
    for (const o of affordablePayments(me, p, t.cost, refs, 4)) {
      out.push({
        verb: 'accept', label: `pay tier ${i + 1}${o.label}`, answer: { kind: 'option', index: i, payment: o.payment }, pre: o.pre,
        cost: o.cost, pay: o.pay, option: i, effect: summarizeSteps(t.then),
      });
    }
  });
}

function discardDown(c: Ctx): void {
  const { p, refs, out } = c;
  const excessCards = p.hand.length - 9;
  if (excessCards > 0) {
    const pool = [...p.hand].sort((a, b) => handCardValue(p, a) - handCardValue(p, b));
    const base = pool.slice(0, excessCards);
    const sets: number[][] = [base];
    // Variants: swap one of the base cards for one of the next cheapest.
    for (const alt of pool.slice(excessCards, excessCards + 8)) {
      for (let k = 0; k < base.length && sets.length < 40; k++) sets.push([...base.slice(0, k), alt, ...base.slice(k + 1)]);
    }
    for (const ids of sets) {
      out.push({
        verb: 'pick', label: `discard ${ids.join(',')}`, answer: { kind: 'cards', cardIds: ids },
        pay: ids.map((id) => refs.hand.get(id)).filter((x): x is number => x !== undefined),
        cost: [{ kind: 'card', deck: 'dragon', count: ids.filter(isDragonCard).length }, { kind: 'card', deck: 'cave', count: ids.filter((i) => !isDragonCard(i)).length }],
      });
    }
    return;
  }
  const excess = RESOURCES.reduce((a, r) => a + p.resources[r], 0) - 9;
  let sets = multisets(RESOURCES.map((r) => p.resources[r]), Math.max(0, excess), 200);
  if (sets.length > 40) sets = sets.filter((v) => v.filter((x) => x > 0).length <= 2).slice(0, 40);
  for (const v of sets) {
    const resources = expand(RESOURCES, v);
    out.push({ verb: 'pick', label: `discard ${resources.join('+')}`, answer: { kind: 'resources', resources }, resources, cost: resources.map((r) => ({ kind: 'resource', res: r, count: 1 }) as GainItem) });
  }
  if (!out.length) out.push({ verb: 'pick', label: 'discard down', answer: { kind: 'resources', resources: [] } });
}

function oncePerRound(c: Ctx, head: Extract<PendingStep, { kind: 'oncePerRoundPick' }>): void {
  const { p, out } = c;
  head.positions.forEach((pos, i) => {
    const d = p.caves[pos[0]]!.spaces[pos[1]]!.dragon;
    out.push({
      verb: 'pick', label: `activate ${d ? dragonCard(d.cardId).name : pos.join(':')} first`, answer: { kind: 'index', index: i },
      option: i, sel: [matToken(pos[0], pos[1])], effect: d ? abilitySummary(dragonCard(d.cardId)) : undefined,
    });
  });
}

function benefits(c: Ctx, head: Extract<PendingStep, { kind: 'chooseBenefits' }>): void {
  const { out } = c;
  const k = Math.min(head.count, head.options.length);
  for (const set of combinations(head.options.map((_, i) => i), k, 40)) {
    out.push({ verb: 'pick', label: `benefits ${set.join(',')}`, answer: { kind: 'indexes', indexes: set }, option: set, effect: gainsSummary(set.flatMap((i) => head.options[i]!)) });
  }
}

function income(c: Ctx, head: Extract<PendingStep, { kind: 'chooseIncomeSpace' }>): void {
  const { view, out } = c;
  const section = INCOME_SECTIONS[incomeSectionIndex(view.round)]!;
  head.options.forEach((sp, i) => {
    out.push({ verb: 'pick', label: section[sp]!.label, answer: { kind: 'index', index: i }, option: sp, effect: gainsSummary(section[sp]!.items) });
  });
}

function setupCards(c: Ctx, head: Extract<PendingStep, { kind: 'setupCards' }>): void {
  const { refs, out } = c;
  for (const set of combinations(head.offer.map((_, i) => i), Math.min(head.keep, head.offer.length))) {
    out.push({
      verb: 'pick', label: `keep ${set.map((i) => head.offer[i]).join(',')}`,
      answer: { kind: 'cards', cardIds: set.map((i) => head.offer[i]!) }, option: set,
      sel: set.map((i) => refs.pending[i]).filter((t): t is number => t !== undefined),
    });
  }
}

// ---------------------------------------------------------------------------

/**
 * Every candidate for `me`'s current decision (≤ MAX_CANDS), from the redacted
 * `view` and the encoder's token refs. Empty when `me` has nothing to decide.
 */
export function legalCandidates(view: GameState, me: PlayerId, refs: TokenRefs): Candidate[] {
  const p = player(view, me);
  const head = headFor(view, me);
  const c: Ctx = { view, me, p, refs, out: [] };
  if (!head) {
    if (view.pending.length || view.phase !== 'main' || view.turn !== me || p.passed) return [];
    mainTurn(c);
  } else {
    switch (head.kind) {
      case 'setupCards': setupCards(c, head); break;
      case 'setupResources': resourcePicks(c, head); break;
      case 'chooseResource': resourcePicks(c, head); break;
      case 'chooseEggSpot': eggSpots(c, head); break;
      case 'chooseEggPayment': eggPayment(c, head); break;
      case 'chooseCache': cache(c, head); break;
      case 'chooseTuck': tuck(c, head); break;
      case 'choosePay': pay(c, head); break;
      case 'chooseHandCards': handCards(c, head); break;
      case 'chooseDisplay': display(c, head); break;
      case 'distributeCards': distribute(c, head); break;
      case 'chooseAbility': ability(c, head); break;
      case 'chooseExcavate': excavateChoice(c, head); break;
      case 'choosePlayDragon': playDragon(c, head); break;
      case 'payDragonCost': payDragonCost(c, head); break;
      case 'chooseGuildSquare': guildSquare(c); break;
      case 'chooseOption': option(c, head); break;
      case 'chooseTrain': train(c, head); break;
      case 'chooseSwap': swap(c); break;
      case 'chooseHandDragonSwap': handDragonSwap(c); break;
      case 'chooseCaveCardSwap': caveCardSwap(c); break;
      case 'opponentMay':
        c.out.push({ verb: 'accept', label: `accept ${head.label}`, answer: { kind: 'confirm' }, effect: summarizeSteps(head.steps) });
        c.out.push({ verb: 'decline', label: 'decline', answer: { kind: 'decline' } });
        break;
      case 'discardDown': discardDown(c); break;
      case 'oncePerRoundPick': oncePerRound(c, head); break;
      case 'chooseBenefits': benefits(c, head); break;
      case 'chooseIncomeSpace': income(c, head); break;
    }
    // Never leave a decision without a move: fall back to the greedy answer.
    if (!c.out.length) c.out.push({ verb: 'pick', label: 'default', answer: answerFor(view, me) });
  }
  return dedupe(c.out).slice(0, MAX_CANDS).map((s) => build(me, s));
}

/** Drop candidates whose actions are identical (keeping the first). */
function dedupe(specs: Spec[]): Spec[] {
  const seen = new Set<string>();
  return specs.filter((s) => {
    const key = JSON.stringify(s.actions ?? [s.pre ?? [], s.answer ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
