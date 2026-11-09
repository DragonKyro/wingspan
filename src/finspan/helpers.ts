// Low-level state helpers: player/slot accessors, token movement with school
// formation, fish placement legality, and the global deck.

import { shuffle } from '../shared/rng';
import * as shared from '../shared/state';
import { fish } from './cards';
import { INITIAL_OCEAN, MAX_CORAL, SCHOOL_SIZE } from './constants';
import type {
  CardFilter,
  FishCard,
  GameState,
  OceanState,
  PlayerId,
  PlayerState,
  SiteColor,
  SlotFilter,
  SlotRef,
  SlotState,
  Zone,
} from './types';
import { DEEPWATER_ROW, ESTUARY_ROW, SITE_COLORS, zoneOfRow } from './types';

// === basic accessors ===

export const getPlayer: (state: GameState, id: PlayerId) => PlayerState = shared.getPlayer;
export const setPlayer: (state: GameState, p: PlayerState) => GameState = shared.setPlayer;

export function appendLog(state: GameState, msg: string): GameState {
  return { ...state, log: [...state.log, { seq: state.log.length, msg }] };
}

export function sameRef(a: SlotRef, b: SlotRef): boolean {
  return a.row === b.row && a.col === b.col;
}

export function slotAt(ocean: OceanState, ref: SlotRef): SlotState {
  return ocean.slots[ref.row]![ref.col]!;
}

export function topFishId(slot: SlotState): number | null {
  return slot.stack.length ? slot.stack[slot.stack.length - 1]! : null;
}

export function topFish(slot: SlotState): FishCard | null {
  const id = topFishId(slot);
  return id == null ? null : fish(id);
}

/** Consumed fish are everything under the visible top card (cards + forage). */
export function consumedCount(slot: SlotState): number {
  return Math.max(0, slot.stack.length - 1);
}

export function* allSlots(ocean: OceanState): Generator<{ ref: SlotRef; slot: SlotState }> {
  for (let row = 0; row < ocean.slots.length; row++) {
    for (let col = 0; col < ocean.slots[row]!.length; col++) {
      yield { ref: { row, col }, slot: ocean.slots[row]![col]! };
    }
  }
}

/** Iterate visible (top) fish in the ocean, optionally restricted. */
export function* visibleFish(ocean: OceanState): Generator<{ ref: SlotRef; slot: SlotState; card: FishCard }> {
  for (const { ref, slot } of allSlots(ocean)) {
    const card = topFish(slot);
    if (card) yield { ref, slot, card };
  }
}

export function setSlot(ocean: OceanState, ref: SlotRef, slot: SlotState): OceanState {
  const slots = ocean.slots.map((r, ri) =>
    ri === ref.row ? r.map((s, ci) => (ci === ref.col ? slot : s)) : r,
  );
  return { ...ocean, slots };
}

export function buildInitialOcean(): OceanState {
  const slots: SlotState[][] = Array.from({ length: 6 }, () =>
    Array.from({ length: 3 }, () => ({ stack: [], eggs: 0, young: 0, school: false })),
  );
  for (const [id, row, col, eggs, young] of INITIAL_OCEAN) {
    slots[row]![col] = { stack: id != null ? [id] : [], eggs, young, school: false };
  }
  return { slots, corals: [0, 0, 0] };
}

// === zone / site checks ===

export function zoneHasFish(ocean: OceanState, col: number, zone: Zone): boolean {
  for (const { ref, slot } of allSlots(ocean)) {
    if (ref.col === col && zoneOfRow(ref.row) === zone && slot.stack.length > 0) return true;
  }
  return false;
}

// === filters ===

export function matchesSlotFilter(ocean: OceanState, ref: SlotRef, f: SlotFilter): boolean {
  const slot = slotAt(ocean, ref);
  if (f.zone != null && zoneOfRow(ref.row) !== f.zone) return false;
  if (f.col != null && ref.col !== f.col) return false;
  if (f.row != null && ref.row !== f.row) return false;
  if (f.estuary && ref.row !== ESTUARY_ROW) return false;
  if (f.deepwater && ref.row !== DEEPWATER_ROW) return false;
  if (f.bandSite != null && SITE_COLORS[ref.col] !== f.bandSite) return false;
  if (f.coralAtLeast != null && ocean.corals[ref.col]! < f.coralAtLeast) return false;
  if (f.hasFish && slot.stack.length === 0) return false;
  if (f.noEgg && slot.eggs > 0) return false;
  if (f.size != null || f.tag != null) {
    const card = topFish(slot);
    if (!card) return false;
    if (f.size != null && card.size !== f.size) return false;
    if (f.tag != null && !(card.tags[f.tag] > 0)) return false;
  }
  return true;
}

export function matchesCardFilter(card: FishCard, f: CardFilter): boolean {
  if (f.size != null && card.size !== f.size) return false;
  if (f.tag != null && !(card.tags[f.tag] > 0)) return false;
  if (f.consumeOnly && !card.cost.consume) return false;
  return true;
}

// === token operations (player-immutable) ===

function withOcean(p: PlayerState, ocean: OceanState): PlayerState {
  return { ...p, ocean };
}

/** Replace 3 young with a school wherever possible (repeat until stable so a
 *  slot with 6+ young collapses correctly). */
function formSchools(ocean: OceanState): OceanState {
  let changed = true;
  let cur = ocean;
  while (changed) {
    changed = false;
    for (const { ref, slot } of allSlots(cur)) {
      if (!slot.school && slot.young >= SCHOOL_SIZE) {
        cur = setSlot(cur, ref, { ...slot, young: slot.young - SCHOOL_SIZE, school: true });
        changed = true;
      }
    }
  }
  return cur;
}

/** Put an egg on the slot (caller guarantees fish present and eggs==0). */
export function addEgg(p: PlayerState, ref: SlotRef): PlayerState {
  const s = slotAt(p.ocean, ref);
  if (s.stack.length === 0) throw new Error('no fish to hold the egg');
  if (s.eggs > 0) throw new Error('fish already has an egg');
  return withOcean(p, setSlot(p.ocean, ref, { ...s, eggs: 1 }));
}

/** Put `n` young on the slot, forming schools as needed. */
export function addYoung(p: PlayerState, ref: SlotRef, n = 1): PlayerState {
  const s = slotAt(p.ocean, ref);
  const ocean = setSlot(p.ocean, ref, { ...s, young: s.young + n });
  return withOcean(p, formSchools(ocean));
}

/** Flip an egg into a young on the slot. */
export function hatchAt(p: PlayerState, ref: SlotRef): PlayerState {
  const s = slotAt(p.ocean, ref);
  if (s.eggs <= 0) throw new Error('no egg to hatch');
  const ocean = setSlot(p.ocean, ref, { ...s, eggs: 0, young: s.young + 1 });
  return withOcean(p, formSchools(ocean));
}

export function removeEgg(p: PlayerState, ref: SlotRef): PlayerState {
  const s = slotAt(p.ocean, ref);
  if (s.eggs <= 0) throw new Error('no egg on that slot');
  return withOcean(p, setSlot(p.ocean, ref, { ...s, eggs: 0 }));
}

export function removeYoung(p: PlayerState, ref: SlotRef, n = 1): PlayerState {
  const s = slotAt(p.ocean, ref);
  if (s.young < n) throw new Error('not enough young on that slot');
  return withOcean(p, setSlot(p.ocean, ref, { ...s, young: s.young - n }));
}

export function removeSchool(p: PlayerState, ref: SlotRef): PlayerState {
  const s = slotAt(p.ocean, ref);
  if (!s.school) throw new Error('no school on that slot');
  // If 3+ young were sharing the slot with the removed school, they instantly
  // re-form a school ("if you have 3 or more young in a slot with a school and
  // then move that school, 3 of those young immediately form another school").
  return withOcean(p, formSchools(setSlot(p.ocean, ref, { ...s, school: false })));
}

/** Slots in a straight line strictly between `from` and `to` (exclusive). */
function pathBetween(from: SlotRef, to: SlotRef): SlotRef[] | null {
  const out: SlotRef[] = [];
  if (from.row === to.row && from.col !== to.col) {
    const step = Math.sign(to.col - from.col);
    for (let c = from.col + step; c !== to.col; c += step) out.push({ row: from.row, col: c });
  } else if (from.col === to.col && from.row !== to.row) {
    const step = Math.sign(to.row - from.row);
    for (let r = from.row + step; r !== to.row; r += step) out.push({ row: r, col: from.col });
  } else {
    return null;
  }
  return out;
}

export interface MoveResult {
  ok: boolean;
  /** For a young move that collides with 2 young: the slot where it stops. */
  stoppedAt?: SlotRef;
  error?: string;
}

/** Validate moving 1 young or 1 school from -> to (straight line).
 *  Young: passing through or landing on a slot with 2 young (no school) ends
 *  the move there and forms a school. Schools may not enter or cross a slot
 *  that already has a school. */
export function validateMove(ocean: OceanState, from: SlotRef, to: SlotRef, token: 'young' | 'school'): MoveResult {
  if (from.row === to.row && from.col === to.col) return { ok: false, error: 'no move' };
  const src = slotAt(ocean, from);
  const path = pathBetween(from, to);
  if (!path) return { ok: false, error: 'must move in a straight line' };
  if (token === 'young') {
    if (src.young <= 0) return { ok: false, error: 'no young there' };
    for (const r of path) {
      const s = slotAt(ocean, r);
      if (!s.school && s.young === SCHOOL_SIZE - 1) return { ok: true, stoppedAt: r };
    }
    return { ok: true };
  }
  if (!src.school) return { ok: false, error: 'no school there' };
  for (const r of path) {
    if (slotAt(ocean, r).school) return { ok: false, error: 'school may not pass a school' };
  }
  if (slotAt(ocean, to).school) return { ok: false, error: 'school may not enter a slot with a school' };
  return { ok: true };
}

/** Apply a validated move (re-checks rules, resolves school formation). */
export function applyMove(p: PlayerState, from: SlotRef, to: SlotRef, token: 'young' | 'school'): PlayerState {
  const v = validateMove(p.ocean, from, to, token);
  if (!v.ok) throw new Error(v.error ?? 'illegal move');
  const dest = v.stoppedAt ?? to;
  let ocean = p.ocean;
  const src = slotAt(ocean, from);
  if (token === 'young') {
    ocean = setSlot(ocean, from, { ...src, young: src.young - 1 });
    const d = slotAt(ocean, dest);
    ocean = setSlot(ocean, dest, { ...d, young: d.young + 1 });
  } else {
    ocean = setSlot(ocean, from, { ...src, school: false });
    const d = slotAt(ocean, dest);
    ocean = setSlot(ocean, dest, { ...d, school: true });
  }
  // School formation on the destination AND on the vacated slot
  // (3+ young left behind by a moved school form a new school).
  return withOcean(p, formSchools(ocean));
}

// === placement legality ===

/** May `card` be placed on `ref` given only zone/band/coral restrictions
 *  (occupancy handled separately)? */
function zoneBandOk(ocean: OceanState, card: FishCard, ref: SlotRef, restrict?: SlotFilter): string | null {
  const zone = zoneOfRow(ref.row);
  if (zone === 'sunlight' && !card.zones.sunlight) return 'not a sunlight fish';
  if (zone === 'twilight' && !card.zones.twilight) return 'not a twilight fish';
  if (zone === 'midnight') {
    if (card.zones.midnight === false) return 'not a midnight fish';
    if (card.zones.midnight === 'bottom' && ref.row !== DEEPWATER_ROW) return 'deepwater fish only';
  }
  if (card.band != null && SITE_COLORS[ref.col] !== card.band) return `must be in the ${card.band} dive site`;
  if (card.coralCost) {
    const site = card.coralCost.site;
    if (site !== 'any' && SITE_COLORS[ref.col] !== site) return `needs the ${site} dive site`;
    if (ocean.corals[ref.col]! < card.coralCost.count) return 'not enough coral in that dive site';
  }
  if (restrict && !matchesSlotFilter(ocean, ref, restrict)) return 'restricted placement';
  return null;
}

/** Everything needed to place `cardId` at `ref` besides paying card/token
 *  costs. Returns an error string or null. `ignoreConsume` is used for free
 *  plays granted by abilities (costs are waived entirely, including the
 *  consume requirement — per "play it for free ... ignoring its cost"). */
export function placementError(
  ocean: OceanState,
  card: FishCard,
  ref: SlotRef,
  opts: { restrict?: SlotFilter; ignoreConsume?: boolean } = {},
): string | null {
  const z = zoneBandOk(ocean, card, ref, opts.restrict);
  if (z) return z;
  const slot = slotAt(ocean, ref);
  const top = topFish(slot);
  if (top) {
    if (card.length <= top.length) return 'must be longer than the fish it covers';
  } else if (card.cost.consume && !opts.ignoreConsume) {
    return 'this fish must consume a shorter fish';
  }
  return null;
}

/** All slots where `card` could legally be placed (ignoring token/card cost). */
export function legalSlots(
  ocean: OceanState,
  card: FishCard,
  opts: { restrict?: SlotFilter; ignoreConsume?: boolean } = {},
): SlotRef[] {
  const out: SlotRef[] = [];
  for (const { ref } of allSlots(ocean)) {
    if (placementError(ocean, card, ref, opts) == null) out.push(ref);
  }
  return out;
}

// === costs / payments ===

/** True if the player can satisfy the card's non-consume, non-coral costs
 *  right now (card discards, eggs, young, schools). */
export function canAffordCost(p: PlayerState, card: FishCard): boolean {
  if (p.hand.length - 1 < card.cost.cards) return false; // the played card can't pay itself
  let eggs = 0;
  let young = 0;
  let schools = 0;
  for (const { slot } of allSlots(p.ocean)) {
    eggs += slot.eggs;
    young += slot.young;
    if (slot.school) schools++;
  }
  return eggs >= card.cost.eggs && young >= card.cost.young && schools >= card.cost.schools;
}

export function canPlayFish(p: PlayerState, card: FishCard): boolean {
  return canAffordCost(p, card) && legalSlots(p.ocean, card).length > 0;
}

/** Validate the explicit payments on a play action. Throws on mismatch. */
export function validatePayments(
  p: PlayerState,
  card: FishCard,
  opts: { discardCardIds?: number[]; eggSlots?: SlotRef[]; youngSlots?: SlotRef[]; schoolSlots?: SlotRef[] },
): void {
  const discards = opts.discardCardIds ?? [];
  if (discards.length !== card.cost.cards) throw new Error(`must discard ${card.cost.cards} card(s)`);
  if (new Set(discards).size !== discards.length) throw new Error('duplicate discard card ids');
  for (const id of discards) {
    if (id === card.id) throw new Error('cannot discard the card being played');
    if (!p.hand.includes(id)) throw new Error(`card ${id} not in hand`);
  }
  const eggs = opts.eggSlots ?? [];
  if (eggs.length !== card.cost.eggs) throw new Error(`must remove ${card.cost.eggs} egg(s)`);
  // A slot holds at most 1 egg, so listing a slot twice would pay it only once.
  if (new Set(eggs.map((r) => `${r.row},${r.col}`)).size !== eggs.length)
    throw new Error('duplicate egg slot');
  for (const r of eggs) if (slotAt(p.ocean, r).eggs <= 0) throw new Error('no egg on that slot');
  const young = opts.youngSlots ?? [];
  if (young.length !== card.cost.young) throw new Error(`must remove ${card.cost.young} young`);
  const youngNeeded = new Map<string, number>();
  for (const r of young) {
    const key = `${r.row},${r.col}`;
    youngNeeded.set(key, (youngNeeded.get(key) ?? 0) + 1);
  }
  for (const r of young) {
    if (slotAt(p.ocean, r).young < youngNeeded.get(`${r.row},${r.col}`)!)
      throw new Error('not enough young on that slot');
  }
  const schools = opts.schoolSlots ?? [];
  if (schools.length !== card.cost.schools) throw new Error(`must remove ${card.cost.schools} school token(s)`);
  // A slot holds at most 1 school token; a duplicate would pay it only once.
  if (new Set(schools.map((r) => `${r.row},${r.col}`)).size !== schools.length)
    throw new Error('duplicate school slot');
  for (const r of schools) if (!slotAt(p.ocean, r).school) throw new Error('no school on that slot');
}

/** Apply validated payments (card discards go to the personal discard pile). */
export function applyPayments(
  p: PlayerState,
  _card: FishCard,
  opts: { discardCardIds?: number[]; eggSlots?: SlotRef[]; youngSlots?: SlotRef[]; schoolSlots?: SlotRef[] },
): PlayerState {
  let out = p;
  const discards = opts.discardCardIds ?? [];
  if (discards.length) {
    out = { ...out, hand: out.hand.filter((id) => !discards.includes(id)), discard: [...out.discard, ...discards] };
  }
  for (const r of opts.eggSlots ?? []) out = removeEgg(out, r);
  for (const r of opts.youngSlots ?? []) out = removeYoung(out, r);
  for (const r of opts.schoolSlots ?? []) out = removeSchool(out, r);
  return out;
}

/** Place the card on the slot (stack push). Token transfer is automatic since
 *  eggs/young/school live on the slot, not the covered fish. */
export function placeFish(p: PlayerState, card: FishCard, ref: SlotRef): PlayerState {
  const s = slotAt(p.ocean, ref);
  return withOcean(p, setSlot(p.ocean, ref, { ...s, stack: [...s.stack, card.id] }));
}

/** Tuck a hand card beneath the visible fish at `ref` (consume benefit). */
export function tuckUnderFish(p: PlayerState, ref: SlotRef, cardId: number): PlayerState {
  const s = slotAt(p.ocean, ref);
  if (s.stack.length === 0) throw new Error('no fish there');
  const stack = [...s.stack];
  stack.splice(stack.length - 1, 0, cardId);
  return withOcean(p, setSlot(p.ocean, ref, { ...s, stack }));
}

// === deck ===

/** Draw `n` cards from the global deck into the player's hand. When the deck
 *  runs out, ALL players' discard piles are shuffled together into a new deck. */
export function drawFromDeck(state: GameState, playerId: PlayerId, n: number): GameState {
  let s = state;
  let p = getPlayer(s, playerId);
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0) {
      const pool = s.players.flatMap((pl) => pl.discard);
      if (pool.length === 0) break;
      const [deck, rng] = shuffle(s.rngState, pool);
      s = {
        ...s,
        deck,
        rngState: rng,
        players: s.players.map((pl) => ({ ...pl, discard: [] })),
      };
      p = getPlayer(s, playerId);
      s = appendLog(s, 'fish deck reshuffled from all discard piles');
    }
    const id = s.deck[s.deck.length - 1]!;
    s = { ...s, deck: s.deck.slice(0, -1) };
    p = { ...p, hand: [...p.hand, id] };
  }
  return setPlayer(s, p);
}

/** Take `cardIds` from the player's discard pile into hand. */
export function recoverCards(state: GameState, playerId: PlayerId, cardIds: number[]): GameState {
  let p = getPlayer(state, playerId);
  for (const id of cardIds) {
    if (!p.discard.includes(id)) throw new Error('card not in discard pile');
    p = { ...p, discard: p.discard.filter((x) => x !== id), hand: [...p.hand, id] };
  }
  return setPlayer(state, p);
}

// === counting helpers (achievements / scoring) ===

export function totalEggs(ocean: OceanState): number {
  let n = 0;
  for (const { slot } of allSlots(ocean)) n += slot.eggs;
  return n;
}

export function totalYoung(ocean: OceanState): number {
  let n = 0;
  for (const { slot } of allSlots(ocean)) n += slot.young;
  return n;
}

export function totalSchools(ocean: OceanState): number {
  let n = 0;
  for (const { slot } of allSlots(ocean)) if (slot.school) n++;
  return n;
}

export function totalConsumed(ocean: OceanState): number {
  let n = 0;
  for (const { slot } of allSlots(ocean)) n += consumedCount(slot);
  return n;
}

/** Rows (across all 3 sites) where every slot holds a visible fish. */
export function fullRows(ocean: OceanState): number {
  let n = 0;
  for (let row = 0; row < ocean.slots.length; row++) {
    if (ocean.slots[row]!.every((s) => s.stack.length > 0)) n++;
  }
  return n;
}

export function siteIndex(site: SiteColor): number {
  return SITE_COLORS.indexOf(site);
}

/** Place 1 coral in dive site `col` if under the cap (S&R). */
export function placeCoral(p: PlayerState, col: number): PlayerState {
  if (p.ocean.corals[col]! >= MAX_CORAL) return p;
  const corals = [...p.ocean.corals];
  corals[col] = corals[col]! + 1;
  return { ...p, ocean: { ...p.ocean, corals } };
}
