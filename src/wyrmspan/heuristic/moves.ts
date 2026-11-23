// The heuristic's move generator: every decision is a pick among a list of
// legal moves, each a concrete engine Action sequence (the last one ends the
// decision) plus a verb and a readable label.
//
// Every decision the rules leave to the player is offered (rules audit):
// gaining a card from the display or the deck; how to pay "any resource" /
// card / egg / item / tithe costs (a few distinct mixes: the engine default,
// cards first, spare resources first, eggs from the nests or from dragons);
// which cave a free play goes into; which drawn card is tucked and under which
// dragon; and declining any optional ability step ("these benefits are not
// mandatory").
//
// Macro: a cost that needs the free 2-for-1 exchange ("at any point during the
// game") carries those exchanges in front of it.
//
// Combinatorial picks are enumerated when small and pruned to a diverse,
// sensible subset otherwise, so a list never exceeds MAX_MOVES. Everything here
// reads the redacted view.

import { answerFor } from '../ai';
import { exploreCost, nextEmptySpace } from '../actions';
import { caveCard, dragonCard, dragonMatchesCond, isDragonCard, parseTrainingTrack, trainingTrackLength } from '../cards';
import { legalPlaySpaces } from '../effects';
import { GUILD_TILES, INCOME_SECTIONS, incomeSectionIndex } from '../guild';
import { allDragons, canPay, dragonPrintedCost, dragonTargetPositions, eggTargetSpots, exchangePlan, payCost, player } from '../helpers';
import type { Action, ChoiceAnswer, EggSpot, GainItem, GameState, PayUnit, PendingStep, PlayerId, PlayerState, Resource, Step } from '../types';
import { RESOURCES } from '../types';
import { canExplore, enticeOptions, exchangeActions, excavatableCaves, excavateCost, handCaves, handDragons } from './rules';
import { abilitySummary, summaryValue } from './summary';

export const MAX_MOVES = 64;

export type Verb = 'entice' | 'excavate' | 'explore' | 'pass' | 'decline' | 'accept' | 'pick';

export interface Move {
  /** Applied in order; the last one ends the decision. */
  actions: Action[];
  label: string;
  verb: Verb;
}

interface Spec {
  verb: Verb;
  answer?: ChoiceAnswer;
  actions?: Action[];
  /** Actions before the answer (resource exchanges). */
  pre?: Action[];
  label: string;
}

function build(me: PlayerId, s: Spec): Move {
  const actions = s.actions ?? [...(s.pre ?? []), { type: 'resolveChoice', playerId: me, answer: s.answer ?? { kind: 'decline' } }];
  return { actions, label: s.label, verb: s.verb };
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
function handCardValue(p: PlayerState, id: number): number {
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

// ---------------------------------------------------------------------------
// Payments: the distinct sensible ways to pay a cost the rules let the player mix.

interface PayOption {
  payment?: PayUnit[];
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
function paymentOptions(p: PlayerState, cost: readonly GainItem[], limit = 4): PayOption[] {
  const describe = (payment?: PayUnit[]): PayOption & { key: string } => {
    const { player: q, discarded } = payCost(p, cost, payment);
    const eggSpots: string[] = [];
    allDragons(p).forEach((d) => {
      const after = q.caves[d.cave]!.spaces[d.space]!.dragon!.eggs;
      for (let k = after; k < d.dragon.eggs; k++) eggSpots.push(`${d.cave}${d.space}`);
    });
    const nestPaid = p.nestEggs - q.nestEggs;
    const parts = [
      ...RESOURCES.filter((r) => p.resources[r] > q.resources[r]).map((r) => `${p.resources[r] - q.resources[r]} ${r}`),
      ...(discarded.length ? [`cards ${discarded.join(',')}`] : []),
      ...(nestPaid ? [`${nestPaid} nest egg${nestPaid > 1 ? 's' : ''}`] : []),
      ...(eggSpots.length ? [`eggs from ${eggSpots.join(',')}`] : []),
    ];
    const key = JSON.stringify([q.resources, [...q.hand].sort(), q.nestEggs, allDragons(q).map((d) => d.dragon.eggs)]);
    return { payment, label: parts.length ? ` (paying ${parts.join(', ')})` : '', key };
  };
  if (!cost.some(isChoosable)) return [{ payment: undefined, label: '' }];
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
    out.push({ payment: d.payment, label: d.label });
    if (out.length >= limit) break;
  }
  return out;
}

/** Ways to pay `cost` now, or after resource exchanges (with the exchanges to make). */
function affordablePayments(me: PlayerId, p: PlayerState, cost: readonly GainItem[], limit = 4): (PayOption & { pre: Action[] })[] {
  if (canPay(p, cost as GainItem[])) return paymentOptions(p, cost, limit).map((o) => ({ ...o, pre: [] }));
  const plan = exchangePlan(p, cost);
  if (!plan) return [];
  const q: PlayerState = { ...p, resources: { ...p.resources } };
  for (const x of plan) {
    for (const r of x.give) q.resources[r] -= 1;
    q.resources[x.get] += 1;
  }
  return paymentOptions(q, cost, limit).map((o) => ({ ...o, pre: exchangeActions(me, plan), label: `${o.label} after ${plan.length} exchange(s)` }));
}

const FREE: PayOption & { pre: Action[] } = { payment: undefined, label: '', pre: [] };

// ---------------------------------------------------------------------------
// Generators

interface Ctx {
  view: GameState;
  me: PlayerId;
  p: PlayerState;
  out: Spec[];
}

function mainTurn(c: Ctx): void {
  const { view, me, p, out } = c;
  out.push({ verb: 'pass', label: 'pass', actions: [{ type: 'pass', playerId: me }] });
  for (let cave = 0; cave < 3; cave++) {
    if (!canExplore(p, cave)) continue;
    for (const o of paymentOptions(p, exploreCost(p, cave), 2)) {
      out.push({ verb: 'explore', label: `explore cave ${cave + 1}${o.label}`, actions: [{ type: 'explore', playerId: me, cave, payment: o.payment }] });
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
      for (const pay of paymentOptions(afterExchange, o.cost, 2)) {
        out.push({
          verb: 'entice', label: `entice ${card.name} → cave ${o.cave + 1}${pay.label}`,
          actions: [...exchangeActions(me, o.exchanges), { type: 'entice', playerId: me, cave: o.cave, cardId: id, payment: pay.payment }],
        });
      }
    }
  }
  const caves = excavatableCaves(p);
  for (const id of handCaves(p)) {
    for (const cave of caves) {
      for (const o of paymentOptions(p, excavateCost(p, cave)!, 2)) {
        out.push({
          verb: 'excavate', label: `excavate cave ${cave + 1} with cave #${caveCard(id).number}${o.label}`,
          actions: [{ type: 'excavate', playerId: me, cave, cardId: id, payment: o.payment }],
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
    out.push({ verb: 'pick', label: `${gain ? 'gain' : head.mode} ${resources.join('+') || 'nothing'}`, answer: { kind: 'resources', resources } });
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

const spotLabel = (list: EggSpot[]) => list.map((s) => (s.kind === 'nest' ? 'nest' : s.pos.join(':'))).join(', ');

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
    out.push({ verb: 'pick', label: `lay ${spotLabel(list)}`, answer: { kind: 'eggSpots', spots: list } });
  }
}

function eggPayment(c: Ctx, head: Extract<PendingStep, { kind: 'chooseEggPayment' }>): void {
  const { p, out } = c;
  const spots: { spot: EggSpot; cap: number }[] = [];
  if (p.nestEggs > 0) spots.push({ spot: { kind: 'nest' }, cap: p.nestEggs });
  for (const d of allDragons(p)) if (d.dragon.eggs > 0) spots.push({ spot: { kind: 'dragon', pos: [d.cave, d.space] }, cap: d.dragon.eggs });
  const choices = eggChoices(spots, head.count);
  if (!choices.length) out.push({ verb: 'decline', label: 'no eggs to pay', answer: { kind: 'eggSpots', spots: [] } });
  for (const list of choices) out.push({ verb: 'pick', label: `pay eggs ${spotLabel(list)}`, answer: { kind: 'eggSpots', spots: list } });
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
  const add = (q: { cave: number; space: number }, plan: Resource[]) =>
    out.push({
      verb: 'pick', label: `cache ${plan.join('+')} on ${q.cave}:${q.space}`,
      answer: { kind: 'dragons', positions: [[q.cave, q.space]], resources: plan },
    });
  // Every target with the default plan; every alternative plan on the first target.
  for (const q of positions) add(q, plans[0]!);
  for (const plan of plans.slice(1)) add(positions[0]!, plan);
}

function tuck(c: Ctx, head: Extract<PendingStep, { kind: 'chooseTuck' }>): void {
  const { p, out } = c;
  const positions = dragonTargetPositions(p, head.target, head.resume?.ctx.dragon);
  // Abilities are optional: tucking can always be declined.
  out.push({ verb: 'decline', label: 'tuck nothing', answer: { kind: 'decline' } });
  if (!positions.length) return;
  if (head.from === 'deck') {
    for (const q of positions) {
      out.push({ verb: 'pick', label: `tuck ${head.count} from deck on ${q.cave}:${q.space}`, answer: { kind: 'dragons', positions: [[q.cave, q.space]] } });
    }
    return;
  }
  const cards = handDragons(p).sort((a, b) => handCardValue(p, a) - handCardValue(p, b));
  const max = Math.min(head.count, cards.length);
  if (max <= 0) return;
  const sizes = head.upTo ? Array.from({ length: max }, (_, k) => max - k) : [max];
  const add = (ids: number[], q: { cave: number; space: number }) =>
    out.push({
      verb: 'pick', label: `tuck ${ids.map((id) => dragonCard(id).name).join(', ')} on ${q.cave}:${q.space}`,
      answer: { kind: 'assignTucks', assignments: ids.map((cardId) => ({ cardId, pos: [q.cave, q.space] as [number, number] })) },
    });
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
  const { p, out } = c;
  const pool = p.hand.filter((id) => head.what === 'any' || (head.what === 'dragon') === isDragonCard(id));
  pool.sort((a, b) => handCardValue(p, a) - handCardValue(p, b));
  out.push({ verb: 'decline', label: 'keep my cards', answer: { kind: 'decline' } });
  const sizes = head.perCard ? Array.from({ length: Math.min(head.count, pool.length) }, (_, k) => k + 1) : pool.length >= head.count ? [head.count] : [];
  for (const k of sizes) {
    const sets = combinations(pool, k, 400);
    sets.sort((a, b) => a.reduce((x, id) => x + handCardValue(p, id), 0) - b.reduce((x, id) => x + handCardValue(p, id), 0));
    for (const ids of sets.slice(0, head.perCard ? 8 : 20)) {
      out.push({ verb: 'pick', label: `${head.purpose} ${ids.join(',')}`, answer: { kind: 'cards', cardIds: ids } });
    }
  }
}

function display(c: Ctx, head: Extract<PendingStep, { kind: 'chooseDisplay' }>): void {
  const { view, out } = c;
  const disp = head.deck === 'dragon' ? view.dragonDisplay : view.caveDisplay;
  disp.forEach((id, i) => {
    if (id != null) out.push({ verb: 'pick', label: `take display ${i + 1}`, answer: { kind: 'index', index: i } });
  });
  // A plain "gain" may take the top of the deck instead (an older step without
  // orDeck falls back to the deck too); "from the display" can only be declined.
  if (head.orDeck !== false) out.push({ verb: 'pick', label: 'draw from the deck', answer: { kind: 'decline' } });
  else if (!out.length) out.push({ verb: 'decline', label: 'no face-up card', answer: { kind: 'decline' } });
}

/** Where a drawn / picked card can be played: dragons into a cave's leftmost space, cave cards into a cave. */
function placementsFor(p: PlayerState, cardId: number, onTop?: boolean): { cave: number; space: number }[] {
  if (isDragonCard(cardId)) return legalPlaySpaces(p, cardId, onTop);
  return [0, 1, 2].map((cave) => ({ cave, space: nextEmptySpace(p, cave) })).filter((x) => x.space >= 0);
}

function distribute(c: Ctx, head: Extract<PendingStep, { kind: 'distributeCards' }>): void {
  const { p, out } = c;
  const n = head.cardIds.length;
  if (head.playFree) {
    head.cardIds.forEach((id, i) => {
      const card = isDragonCard(id) ? dragonCard(id) : caveCard(id);
      const name = 'name' in card && card.name ? card.name : `#${id}`;
      const places = placementsFor(p, id);
      if (!places.length) {
        out.push({ verb: 'pick', label: `pick ${name} (nowhere to play it)`, answer: { kind: 'indexes', indexes: [i] } });
        return;
      }
      for (const at of places) {
        out.push({ verb: 'pick', label: `play ${name} at ${at.cave}:${at.space}`, answer: { kind: 'play', index: i, pos: [at.cave, at.space] } });
      }
    });
    return;
  }
  const keep = Math.min(head.keep ?? n, n);
  const tuckN = typeof head.tuck === 'number' ? head.tuck : 0;
  const positions = tuckN > 0 ? dragonTargetPositions(p, head.tuckTarget ?? { kind: 'any' }, head.resume?.ctx.dragon).slice(0, 4) : [];
  for (const set of combinations(head.cardIds.map((_, i) => i), keep, 40)) {
    const leftover = head.cardIds.map((_, i) => i).filter((i) => !set.includes(i) && isDragonCard(head.cardIds[i]!));
    const k = Math.min(tuckN, leftover.length);
    if (k <= 0 || !positions.length || leftover.length <= k && positions.length <= 1) {
      out.push({ verb: 'pick', label: `keep ${set.join(',')}`, answer: { kind: 'indexes', indexes: set } });
      continue;
    }
    // Which leftover card(s) to tuck, and under which dragon.
    for (const tucked of combinations(leftover, k, 6)) {
      for (const q of positions) {
        out.push({
          verb: 'pick', label: `keep ${set.join(',')}, tuck ${tucked.join(',')} under ${q.cave}:${q.space}`,
          answer: { kind: 'indexes', indexes: set, tucks: tucked.map((index) => ({ index, pos: [q.cave, q.space] as [number, number] })) },
        });
      }
    }
  }
}

function ability(c: Ctx, head: Extract<PendingStep, { kind: 'chooseAbility' }>): void {
  const { out } = c;
  out.push({ verb: 'decline', label: 'activate nothing', answer: { kind: 'decline' } });
  const k = Math.min(head.count, head.candidates.length);
  for (const set of combinations(head.candidates.map((_, i) => i), k, 40)) {
    if (head.distinct && new Set(set.map((i) => head.candidates[i]!.dragon?.join(','))).size < set.length) continue;
    out.push({ verb: 'pick', label: `activate ${set.map((i) => head.candidates[i]!.label).join(', ')}`, answer: { kind: 'indexes', indexes: set } });
  }
}

function excavateChoice(c: Ctx, head: Extract<PendingStep, { kind: 'chooseExcavate' }>): void {
  const { view, p, out } = c;
  out.push({ verb: 'decline', label: 'excavate nothing', answer: { kind: 'decline' } });
  const hand = handCaves(p);
  const disp = view.caveDisplay.filter((id): id is number => id !== null);
  const pool: (number | null)[] =
    head.source === 'hand' ? hand : head.source === 'display' ? disp : head.source === 'handOrDisplay' ? [...hand, ...disp] : [null];
  const caves = [0, 1, 2].filter((cv) => nextEmptySpace(p, cv) >= 0);
  pool.forEach((id, poolIdx) => {
    for (const cave of caves) {
      out.push({
        verb: 'pick', label: `excavate cave ${cave + 1} with ${id != null ? `cave #${caveCard(id).number}` : 'the top card'}`,
        answer: { kind: 'index', index: poolIdx * 3 + cave },
      });
    }
  });
}

function playDragon(c: Ctx, head: Extract<PendingStep, { kind: 'choosePlayDragon' }>): void {
  const { view, me, p, out } = c;
  out.push({ verb: 'decline', label: 'play nothing', answer: { kind: 'decline' } });
  if (head.source === 'deck') {
    out.push({ verb: 'pick', label: 'play the top dragon of the deck', answer: { kind: 'index', index: 0 } });
    return;
  }
  const hand = handDragons(p);
  const disp = view.dragonDisplay.filter((id): id is number => id !== null);
  const raw = head.source === 'hand' ? hand : head.source === 'display' ? disp : [...hand, ...disp];
  const pool = head.cond ? raw.filter((id) => dragonMatchesCond(dragonCard(id), head.cond!)) : raw;
  pool.forEach((id, i) => {
    const card = dragonCard(id);
    // "Pay its printed costs": the player's payment (and exchanges); otherwise free / discounted later.
    const pays = head.discount === 'full' ? affordablePayments(me, p, dragonPrintedCost(id), 2) : [FREE];
    for (const at of legalPlaySpaces(p, id, head.onTop)) {
      for (const o of pays) {
        out.push({
          verb: 'pick', label: `play ${card.name} at ${at.cave}:${at.space}${o.label}`,
          answer: { kind: 'play', index: i, pos: [at.cave, at.space], payment: o.payment }, pre: o.pre,
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
  const { me, p, out } = c;
  out.push({ verb: 'decline', label: 'do not play it', answer: { kind: 'decline' } });
  head.options.forEach((o, i) => {
    for (const pay of affordablePayments(me, p, waived(dragonPrintedCost(head.cardId), o.waive), 2)) {
      out.push({ verb: 'accept', label: `${o.label}${pay.label}`, answer: { kind: 'option', index: i, payment: pay.payment }, pre: pay.pre });
    }
  });
}

function guildSquare(c: Ctx): void {
  const { view, out } = c;
  const tile = GUILD_TILES[view.guild.tile];
  tile.squares.forEach((sq, i) => {
    if (!sq.unlimited && (view.guild.squares[i] ?? []).length > 0) return;
    out.push({ verb: 'pick', label: sq.label, answer: { kind: 'index', index: i } });
  });
  if (!out.length) out.push({ verb: 'decline', label: 'no open square', answer: { kind: 'decline' } });
}

function option(c: Ctx, head: Extract<PendingStep, { kind: 'chooseOption' }>): void {
  const { out } = c;
  const data = head.resume?.ctx.data;
  // A repeatable ability asks "again?": option 0 repeats, option 1 stops.
  const repeat = data?.repeatSteps !== undefined ? (JSON.parse(String(data.repeatSteps)) as Step[]) : null;
  head.options.forEach((o, i) => {
    out.push({ verb: repeat && i === 1 ? 'decline' : 'pick', label: o.label, answer: { kind: 'option', index: i } });
  });
  // Abilities are optional: "either A or B" may also be neither (repeats already offer "stop").
  if (!repeat) out.push({ verb: 'decline', label: 'neither', answer: { kind: 'decline' } });
}

function train(c: Ctx, head: Extract<PendingStep, { kind: 'chooseTrain' }>): void {
  const { me, p, out } = c;
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
    const free = head.free || head.gainItem;
    const pays = free ? [FREE] : affordablePayments(me, p, boxes.slice(0, 1), 3);
    for (const o of pays) {
      out.push({
        verb: 'accept', label: `train ${dragonCard(d.cardId).name}${o.label}`,
        answer: { kind: 'dragon', pos: [pos.cave, pos.space], payment: o.payment }, pre: o.pre,
      });
    }
  }
}

function swap(c: Ctx): void {
  const { p, out } = c;
  out.push({ verb: 'decline', label: 'swap nothing', answer: { kind: 'decline' } });
  for (const [a, b] of combinations(allDragons(p), 2, 40)) {
    out.push({
      verb: 'pick', label: `swap ${a!.cave}:${a!.space} ↔ ${b!.cave}:${b!.space}`,
      answer: { kind: 'dragons', positions: [[a!.cave, a!.space], [b!.cave, b!.space]] },
    });
  }
}

function handDragonSwap(c: Ctx): void {
  const { p, out } = c;
  out.push({ verb: 'decline', label: 'swap nothing', answer: { kind: 'decline' } });
  const mat = allDragons(p);
  const hand = handDragons(p);
  const pairs: { score: number; h: number; m: number }[] = [];
  hand.forEach((id, h) => mat.forEach((d, m) => pairs.push({ score: dragonCard(id).vp - dragonCard(d.dragon.cardId).vp, h, m })));
  pairs.sort((a, b) => b.score - a.score);
  for (const { h, m } of pairs.slice(0, 30)) {
    out.push({
      verb: 'pick', label: `swap in ${dragonCard(hand[h]!).name} for ${dragonCard(mat[m]!.dragon.cardId).name}`,
      answer: { kind: 'index', index: h * mat.length + m },
    });
  }
}

function caveCardSwap(c: Ctx): void {
  const { p, out } = c;
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
    });
  }
}

function pay(c: Ctx, head: Extract<PendingStep, { kind: 'choosePay' }>): void {
  const { me, p, out } = c;
  out.push({ verb: 'decline', label: 'do not pay', answer: { kind: 'decline' } });
  head.tiers.forEach((t, i) => {
    for (const o of affordablePayments(me, p, t.cost, 4)) {
      out.push({ verb: 'accept', label: `pay tier ${i + 1}${o.label}`, answer: { kind: 'option', index: i, payment: o.payment }, pre: o.pre });
    }
  });
}

function discardDown(c: Ctx): void {
  const { p, out } = c;
  const excessCards = p.hand.length - 9;
  if (excessCards > 0) {
    const pool = [...p.hand].sort((a, b) => handCardValue(p, a) - handCardValue(p, b));
    const base = pool.slice(0, excessCards);
    const sets: number[][] = [base];
    // Variants: swap one of the base cards for one of the next cheapest.
    for (const alt of pool.slice(excessCards, excessCards + 8)) {
      for (let k = 0; k < base.length && sets.length < 40; k++) sets.push([...base.slice(0, k), alt, ...base.slice(k + 1)]);
    }
    for (const ids of sets) out.push({ verb: 'pick', label: `discard ${ids.join(',')}`, answer: { kind: 'cards', cardIds: ids } });
    return;
  }
  const excess = RESOURCES.reduce((a, r) => a + p.resources[r], 0) - 9;
  let sets = multisets(RESOURCES.map((r) => p.resources[r]), Math.max(0, excess), 200);
  if (sets.length > 40) sets = sets.filter((v) => v.filter((x) => x > 0).length <= 2).slice(0, 40);
  for (const v of sets) {
    const resources = expand(RESOURCES, v);
    out.push({ verb: 'pick', label: `discard ${resources.join('+')}`, answer: { kind: 'resources', resources } });
  }
  if (!out.length) out.push({ verb: 'pick', label: 'discard down', answer: { kind: 'resources', resources: [] } });
}

function oncePerRound(c: Ctx, head: Extract<PendingStep, { kind: 'oncePerRoundPick' }>): void {
  const { p, out } = c;
  head.positions.forEach((pos, i) => {
    const d = p.caves[pos[0]]!.spaces[pos[1]]!.dragon;
    out.push({ verb: 'pick', label: `activate ${d ? dragonCard(d.cardId).name : pos.join(':')} first`, answer: { kind: 'index', index: i } });
  });
}

function benefits(c: Ctx, head: Extract<PendingStep, { kind: 'chooseBenefits' }>): void {
  const { out } = c;
  const k = Math.min(head.count, head.options.length);
  for (const set of combinations(head.options.map((_, i) => i), k, 40)) {
    out.push({ verb: 'pick', label: `benefits ${set.join(',')}`, answer: { kind: 'indexes', indexes: set } });
  }
}

function income(c: Ctx, head: Extract<PendingStep, { kind: 'chooseIncomeSpace' }>): void {
  const { view, out } = c;
  const section = INCOME_SECTIONS[incomeSectionIndex(view.round)]!;
  head.options.forEach((sp, i) => out.push({ verb: 'pick', label: section[sp]!.label, answer: { kind: 'index', index: i } }));
}

function setupCards(c: Ctx, head: Extract<PendingStep, { kind: 'setupCards' }>): void {
  const { out } = c;
  for (const set of combinations(head.offer.map((_, i) => i), Math.min(head.keep, head.offer.length))) {
    out.push({ verb: 'pick', label: `keep ${set.map((i) => head.offer[i]).join(',')}`, answer: { kind: 'cards', cardIds: set.map((i) => head.offer[i]!) } });
  }
}

// ---------------------------------------------------------------------------

/**
 * Every move for `me`'s current decision (≤ MAX_MOVES), from the redacted
 * `view`. Empty when `me` has nothing to decide.
 */
export function legalMoves(view: GameState, me: PlayerId): Move[] {
  const p = player(view, me);
  const h = view.pending[0];
  const head = h && h.playerId === me ? h : null;
  const c: Ctx = { view, me, p, out: [] };
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
        c.out.push({ verb: 'accept', label: `accept ${head.label}`, answer: { kind: 'confirm' } });
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
  return dedupe(c.out).slice(0, MAX_MOVES).map((s) => build(me, s));
}

/** Drop moves whose actions are identical (keeping the first). */
function dedupe(specs: Spec[]): Spec[] {
  const seen = new Set<string>();
  return specs.filter((s) => {
    const key = JSON.stringify(s.actions ?? [s.pre ?? [], s.answer ?? null]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
