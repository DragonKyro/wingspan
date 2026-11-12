// The learned agent's game side: pinned encoder / action-space layouts, the
// information boundary (nothing hidden reaches the encoder, the candidates or
// the heuristic), candidate validity over real games, and the benchmark
// heuristic's determinism and strength.

import { describe, expect, it } from 'vitest';
import { shuffle } from '@/shared/rng';
import { chooseAction } from '../ai';
import { isDragonCard } from '../cards';
import { applyAction } from '../engine';
import type { GameState, PlayerId } from '../types';
import { CARD_STATIC_DIM, NUM_CARD_INDEX, cardIndex, cardStaticTable } from './cardFeatures';
import { ACTION_SPACE_VERSION, CAND_DIM, MAX_CANDS, legalCandidates } from './candidates';
import { ENCODER_VERSION, GLOBAL_DIM, NUM_TOKENS, TOKEN_DIM, encodeView, tokenRefs } from './encode';
import { heuristicIndex } from './heuristic';
import { actingPlayer, applyAll, isAutomaSeat, newMatch, playBaselines } from './play';
import { determinize, redact } from './view';
import { scorePlayer } from '../scoring';

/** Play up to `steps` greedy-AI moves into a fresh game (stopping short of its end). */
function midGame(seed: number, players: number, steps: number): GameState {
  let s = newMatch(seed, players);
  for (let n = 0; n < steps; n++) {
    const id = actingPlayer(s)!;
    const next = applyAction(s, chooseAction(s, id)!);
    if (next.phase === 'gameEnd') break;
    s = next;
  }
  return s;
}

/** The same game with every piece of hidden information (for `me`) changed. */
function scrambleHidden(s: GameState, me: PlayerId, seed: number): GameState {
  const t = JSON.parse(JSON.stringify(s)) as GameState;
  let rng = seed;
  const opp = t.players.find((p) => p.id !== me && !isAutomaSeat(t, p.id))!;
  // Swap opponent hand cards with same-type deck cards, then reshuffle both decks.
  if (opp) {
    opp.hand = opp.hand.map((id) => {
      const deck = isDragonCard(id) ? t.dragonDeck : t.caveDeck;
      if (!deck.length) return id;
      const swap = deck.shift()!;
      deck.push(id);
      return swap;
    });
  }
  [t.dragonDeck, rng] = shuffle(rng, t.dragonDeck);
  [t.caveDeck, rng] = shuffle(rng, t.caveDeck);
  // Tucked cards are face-down: their identities are hidden too.
  for (const p of t.players) for (const row of p.caves) for (const sp of row.spaces) if (sp.dragon?.tucked.length) {
    [sp.dragon.tucked, rng] = shuffle(rng, sp.dragon.tucked);
  }
  t.rngState = (rng ^ 0xdeadbeef) >>> 0;
  t.log = [...t.log, 'something hidden happened'];
  return t;
}

describe('versions and layout', () => {
  it('pins the encoder and action-space sizes (bump the versions when these change)', () => {
    expect({ ENCODER_VERSION, GLOBAL_DIM, TOKEN_DIM, NUM_TOKENS, CARD_STATIC_DIM, NUM_CARD_INDEX }).toEqual({
      ENCODER_VERSION: 2, GLOBAL_DIM: 395, TOKEN_DIM: 42, NUM_TOKENS: 41, CARD_STATIC_DIM: 74, NUM_CARD_INDEX: 371,
    });
    expect({ ACTION_SPACE_VERSION, CAND_DIM, MAX_CANDS }).toEqual({ ACTION_SPACE_VERSION: 2, CAND_DIM: 82, MAX_CANDS: 64 });
  });

  it('card table rows are finite, and row 0 (no card) is empty', () => {
    const t = cardStaticTable();
    expect(t.length).toBe(NUM_CARD_INDEX * CARD_STATIC_DIM);
    expect(t.every(Number.isFinite)).toBe(true);
    expect(t.slice(0, CARD_STATIC_DIM).every((x) => x === 0)).toBe(true);
  });
});

describe('information boundary (no peeking)', () => {
  const cases: [number, number, number][] = [[11, 2, 0], [12, 2, 60], [13, 3, 140], [14, 1, 90], [15, 4, 200]];

  it.each(cases)('seed %i, %i players, %i moves in: hidden information changes nothing the agent sees', (seed, players, steps) => {
    const s = midGame(seed, players, steps);
    const me = actingPlayer(s)!;
    if (isAutomaSeat(s, me)) return;
    for (const salt of [1, 2, 3]) {
      const t = scrambleHidden(s, me, salt);
      expect(t.dragonDeck).not.toEqual(s.dragonDeck);
      const [a, b] = [redact(s, me), redact(t, me)];
      expect(b).toEqual(a);
      const [ea, eb] = [encodeView(a, me), encodeView(b, me)];
      expect(Array.from(eb.global)).toEqual(Array.from(ea.global));
      expect(Array.from(eb.tokenIds)).toEqual(Array.from(ea.tokenIds));
      expect(Array.from(eb.tokenFeat)).toEqual(Array.from(ea.tokenFeat));
      const [ca, cb] = [legalCandidates(a, me, ea.refs), legalCandidates(b, me, eb.refs)];
      expect(cb.map((c) => c.actions)).toEqual(ca.map((c) => c.actions));
      expect(heuristicIndex(b, me, cb)).toBe(heuristicIndex(a, me, ca));
    }
  });

  it("never encodes an opponent's hand", () => {
    const s = midGame(21, 2, 40);
    const me = actingPlayer(s)!;
    const view = redact(s, me);
    const visible = new Set<number>([
      ...view.players.find((p) => p.id === me)!.hand, ...view.dragonDisplay, ...view.caveDisplay,
    ].filter((x): x is number => x != null).map(cardIndex));
    for (const p of view.players) for (const row of p.caves) for (const sp of row.spaces) if (sp.dragon) visible.add(cardIndex(sp.dragon.cardId));
    const ctx = view.pending[0]?.playerId === me && 'resume' in view.pending[0] ? view.pending[0].resume?.ctx.sourceCardId : undefined;
    if (ctx != null) visible.add(cardIndex(ctx));
    const { tokenIds } = encodeView(view, me);
    for (const id of tokenIds) if (id !== 0) expect(visible.has(id)).toBe(true);
  });

  it('determinize keeps every visible part of the view and only re-deals hidden cards', () => {
    const s = midGame(31, 2, 80);
    const me = actingPlayer(s)!;
    const view = redact(s, me);
    const world = determinize(view, me, 99);
    // Same visible view and same hidden pool (redact sorts the pool back), new deal.
    expect(redact(world, me)).toEqual(view);
    expect(world.dragonDeck.length).toBe(view.dragonDeck.length);
    expect(world.dragonDeck).not.toEqual(view.dragonDeck);
  });
});

describe('candidates', () => {
  it('every candidate of every decision in real games is accepted by the engine', () => {
    let decisions = 0;
    for (const [seed, players] of [[41, 1], [42, 2], [43, 3]] as const) {
      let s = newMatch(seed, players);
      while (s.phase !== 'gameEnd') {
        const id = actingPlayer(s)!;
        if (!isAutomaSeat(s, id)) {
          const view = redact(s, id);
          const enc = encodeView(view, id);
          const cands = legalCandidates(view, id, enc.refs);
          expect(cands.length).toBeGreaterThan(0);
          expect(cands.length).toBeLessThanOrEqual(MAX_CANDS);
          for (const c of cands) {
            expect(c.feat.length).toBe(CAND_DIM);
            expect(c.sel.every((t) => t >= 0 && t < NUM_TOKENS)).toBe(true);
            expect(c.pay.every((t) => t >= 0 && t < NUM_TOKENS)).toBe(true);
            const t = applyAll(s, c.actions); // throws on no progress
            expect(JSON.stringify({ ...t, log: [] })).not.toBe(JSON.stringify({ ...s, log: [] }));
          }
          decisions++;
        }
        s = applyAction(s, chooseAction(s, id)!);
      }
    }
    expect(decisions).toBeGreaterThan(200);
  }, 120_000);

  it('token refs without encoding match the encoder', () => {
    const s = midGame(51, 2, 30);
    const me = actingPlayer(s)!;
    const view = redact(s, me);
    expect(tokenRefs(view, me)).toEqual(encodeView(view, me).refs);
  });
});

describe('benchmark heuristic', () => {
  it('is deterministic for a given position', () => {
    const s = midGame(61, 2, 25);
    const me = actingPlayer(s)!;
    const view = redact(s, me);
    const cands = legalCandidates(view, me, tokenRefs(view, me));
    expect(heuristicIndex(view, me, cands)).toBe(heuristicIndex(redact(s, me), me, cands));
  });

  it('outscores the engine greedy AI by a wide margin on fixed deals', () => {
    const seeds = [71, 72, 73, 74];
    const mean = (agent: 'heuristic' | 'greedy') =>
      seeds.reduce((a, seed) => {
        const s = playBaselines(seed, 1, [agent]);
        return a + scorePlayer(s, s.players[0]!).total;
      }, 0) / seeds.length;
    expect(mean('heuristic')).toBeGreaterThan(mean('greedy') + 10);
  }, 120_000);
});
