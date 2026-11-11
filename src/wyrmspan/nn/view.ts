// The information boundary for learned and heuristic Wyrmspan agents.
//
// `redact(state, me)` returns a GameState that holds only what player `me` may
// know. Every hidden location — the order of both decks, opponents' hands,
// other players' setup offers and drawn-card choices, the identities of tucked
// cards (face-down), Automa's face-down decision deck and the RNG — is refilled
// from a canonical pool: the multiset of cards in those locations, sorted.
// That multiset is public (all cards minus the visible ones), and each
// location keeps its size and its dragon/cave split (card backs are public),
// so two states that differ only in hidden information redact to the same view.
//
// The encoder, the action space and the heuristic AI only ever read a view.
// When the heuristic needs to look ahead it samples the hidden information
// with `determinize(view, me, seed)`, which deals the same pool in a random
// order and reseeds the RNG — a plausible world, never the real one.

import { shuffle } from '@/shared/rng';
import { isDragonCard } from '../cards';
import type { AutomaCardId, GameState, PlayerId } from '../types';

/** Every array of card ids `me` cannot see (mutable references into `s`). */
function hiddenCardArrays(s: GameState, me: PlayerId): number[][] {
  const out: number[][] = [s.dragonDeck, s.caveDeck];
  for (const p of s.players) {
    if (p.id !== me) out.push(p.hand);
    // Tucked cards lie face-down; only their count matters after tucking.
    for (const row of p.caves) for (const sp of row.spaces) if (sp.dragon?.tucked.length) out.push(sp.dragon.tucked);
  }
  for (const step of s.pending) {
    if (step.playerId === me) continue;
    if (step.kind === 'setupCards') out.push(step.offer);
    else if (step.kind === 'distributeCards') out.push(step.cardIds);
  }
  return out;
}

/** Refill `arrays` in place from their pooled contents, ordered by `order`;
 *  dragon positions get dragons and cave positions get caves. */
function refill(arrays: number[][], order: (pool: number[], kind: 'dragon' | 'cave') => number[]): void {
  const dragons: number[] = [];
  const caves: number[] = [];
  for (const a of arrays) for (const id of a) (isDragonCard(id) ? dragons : caves).push(id);
  const d = order(dragons, 'dragon');
  const c = order(caves, 'cave');
  let di = 0;
  let ci = 0;
  for (const a of arrays) for (let k = 0; k < a.length; k++) a[k] = isDragonCard(a[k]!) ? d[di++]! : c[ci++]!;
}

function cloneState(s: GameState): GameState {
  // The log is irrelevant to every consumer and can mention hidden cards.
  return JSON.parse(JSON.stringify({ ...s, log: [] })) as GameState;
}

/** Other players' setup offers mirror their pending setupCards step (resolution reads the step). */
function syncSetupOffers(s: GameState, me: PlayerId): void {
  const offers: Record<string, number[]> = {};
  if (s.setupOffers[me]) offers[me] = s.setupOffers[me]!;
  for (const step of s.pending) {
    if (step.kind === 'setupCards' && step.playerId !== me) offers[step.playerId] = step.offer.slice();
  }
  s.setupOffers = offers;
}

const automaOrder = (a: AutomaCardId, b: AutomaCardId) => (a < b ? -1 : a > b ? 1 : 0);

/** `state` as player `me` sees it. Safe to hand to any encoder or policy. */
export function redact(state: GameState, me: PlayerId): GameState {
  const s = cloneState(state);
  refill(hiddenCardArrays(s, me), (pool) => pool.sort((a, b) => a - b));
  syncSetupOffers(s, me);
  if (s.automa) {
    // Automa's decision deck and set-aside card are face-down.
    const pool = [...s.automa.deck, ...(s.automa.setAside ? [s.automa.setAside] : [])].sort(automaOrder);
    s.automa.deck = pool.slice(0, s.automa.deck.length);
    if (s.automa.setAside) s.automa.setAside = pool[pool.length - 1]!;
  }
  s.rngState = 0;
  return s;
}

/** A playable full state consistent with `view`: hidden cards dealt at random from the public pool. */
export function determinize(view: GameState, me: PlayerId, seed: number): GameState {
  const s = cloneState(view);
  let rng = seed >>> 0 || 1;
  refill(hiddenCardArrays(s, me), (pool) => {
    const [out, next] = shuffle(rng, pool);
    rng = next;
    return out;
  });
  syncSetupOffers(s, me);
  if (s.automa) {
    const pool = [...s.automa.deck, ...(s.automa.setAside ? [s.automa.setAside] : [])];
    const [out, next] = shuffle(rng, pool);
    rng = next;
    s.automa.deck = out.slice(0, s.automa.deck.length);
    if (s.automa.setAside) s.automa.setAside = out[out.length - 1]!;
  }
  s.rngState = rng;
  return s;
}

/** A deterministic seed from what `me` can see (so lookahead is reproducible and leak-free). */
export function visibleSeed(view: GameState, me: PlayerId, salt = 0): number {
  const p = view.players.find((q) => q.id === me)!;
  let h = (0x811c9dc5 ^ salt) >>> 0;
  const mix = (x: number) => {
    h = Math.imul(h ^ (x & 0xffff), 0x01000193) >>> 0;
    h = Math.imul(h ^ (x >>> 16), 0x01000193) >>> 0;
  };
  mix(view.round);
  mix(view.pending.length);
  mix(view.dragonDeck.length);
  mix(view.caveDeck.length);
  mix(p.coins);
  for (const id of p.hand) mix(id);
  for (const id of view.dragonDisplay) mix(id ?? 0);
  for (const id of view.caveDisplay) mix(id ?? 0);
  for (const q of view.players) {
    mix(q.coins);
    mix(q.hand.length);
    for (const row of q.caves) for (const sp of row.spaces) mix(sp.dragon ? sp.dragon.cardId + 1 + sp.dragon.eggs * 1000 : 0);
  }
  return h || 1;
}
