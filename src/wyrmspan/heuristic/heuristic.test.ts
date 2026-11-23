// The Wyrmspan heuristic AI: the information boundary (nothing hidden reaches
// the move generator or the heuristic), move validity over real games, the
// heuristic's determinism and strength, and the app AI wrapper (one action at a
// time, multi-action plans replayed, never stalling).

import { describe, expect, it } from 'vitest';
import { shuffle } from '@/shared/rng';
import { chooseAction as engineAI } from '../ai';
import { isDragonCard } from '../cards';
import { applyAction } from '../engine';
import { scorePlayer } from '../scoring';
import type { GameState, PlayerId } from '../types';
import { chooseAction } from './ai';
import { heuristicActions, heuristicIndex } from './heuristic';
import { MAX_MOVES, legalMoves } from './moves';
import { actingPlayer, applyAll, isAutomaSeat, newMatch, playBaselines } from './play';
import { determinize, redact } from './view';

/** Play up to `steps` engine-AI moves into a fresh game (stopping short of its end). */
function midGame(seed: number, players: number, steps: number): GameState {
  let s = newMatch(seed, players);
  for (let n = 0; n < steps; n++) {
    const id = actingPlayer(s)!;
    const next = applyAction(s, engineAI(s, id)!);
    if (next.phase === 'gameEnd') break;
    s = next;
  }
  return s;
}

/** The same game with every piece of hidden information (for `me`) changed. */
function scrambleHidden(s: GameState, me: PlayerId, seed: number): GameState {
  const t = JSON.parse(JSON.stringify(s)) as GameState;
  let rng = seed;
  const opp = t.players.find((p) => p.id !== me && !isAutomaSeat(t, p.id));
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

describe('information boundary (no peeking)', () => {
  const cases: [number, number, number][] = [[11, 2, 0], [12, 2, 60], [13, 3, 140], [14, 1, 90], [15, 4, 200]];

  it.each(cases)('seed %i, %i players, %i moves in: hidden information changes nothing the AI sees', (seed, players, steps) => {
    const s = midGame(seed, players, steps);
    const me = actingPlayer(s)!;
    if (isAutomaSeat(s, me)) return;
    for (const salt of [1, 2, 3]) {
      const t = scrambleHidden(s, me, salt);
      expect(t.dragonDeck).not.toEqual(s.dragonDeck);
      const [a, b] = [redact(s, me), redact(t, me)];
      expect(b).toEqual(a);
      const [ma, mb] = [legalMoves(a, me), legalMoves(b, me)];
      expect(mb.map((m) => m.actions)).toEqual(ma.map((m) => m.actions));
      expect(heuristicIndex(b, me, mb)).toBe(heuristicIndex(a, me, ma));
      expect(heuristicActions(t, me)).toEqual(heuristicActions(s, me));
    }
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

describe('moves', () => {
  it('every move of every decision in real games is accepted by the engine', () => {
    let decisions = 0;
    for (const [seed, players] of [[41, 1], [42, 2], [43, 3]] as const) {
      let s = newMatch(seed, players);
      while (s.phase !== 'gameEnd') {
        const id = actingPlayer(s)!;
        if (!isAutomaSeat(s, id)) {
          const moves = legalMoves(redact(s, id), id);
          expect(moves.length).toBeGreaterThan(0);
          expect(moves.length).toBeLessThanOrEqual(MAX_MOVES);
          for (const m of moves) {
            const t = applyAll(s, m.actions); // throws on no progress
            expect(JSON.stringify({ ...t, log: [] })).not.toBe(JSON.stringify({ ...s, log: [] }));
          }
          decisions++;
        }
        s = applyAction(s, engineAI(s, id)!);
      }
    }
    expect(decisions).toBeGreaterThan(200);
  }, 120_000);
});

describe('heuristic', () => {
  it('is deterministic for a given position', () => {
    const s = midGame(61, 2, 25);
    const me = actingPlayer(s)!;
    const view = redact(s, me);
    const moves = legalMoves(view, me);
    expect(heuristicIndex(view, me, moves)).toBe(heuristicIndex(redact(s, me), me, moves));
  });

  it('outscores the engine AI by a wide margin on fixed deals', () => {
    const seeds = [71, 72];
    const mean = (agent: 'heuristic' | 'greedy') =>
      seeds.reduce((a, seed) => {
        const s = playBaselines(seed, 1, [agent]);
        return a + scorePlayer(s, s.players[0]!).total;
      }, 0) / seeds.length;
    expect(mean('heuristic')).toBeGreaterThan(mean('greedy') + 20);
  }, 180_000);
});

describe('the app AI (one action per call)', () => {
  /** A whole game through `chooseAction`, as the app's AI driver plays it. */
  function playApp(seed: number, players: number, opts: Parameters<typeof newMatch>[2] = {}) {
    let s = newMatch(seed, players, opts);
    let steps = 0;
    while (s.phase !== 'gameEnd') {
      const id = actingPlayer(s)!;
      const action = chooseAction(s, id);
      expect(action).not.toBeNull();
      const next = applyAction(s, action!);
      expect(next).not.toBe(s); // every action makes progress: an AI seat never stalls
      s = next;
      expect(++steps).toBeLessThan(6000);
    }
    return s;
  }

  it.each([[81, 1], [82, 2]] as const)('seed %i, %i players: plays a whole game and scores like the heuristic', (seed, players) => {
    const s = playApp(seed, players);
    for (const p of s.players) if (!isAutomaSeat(s, p.id)) expect(scorePlayer(s, p).total).toBeGreaterThan(40);
  }, 180_000);

  it('plays the base game alone (no Academy) too', () => {
    const s = playApp(84, 1, { expansions: ['base'] });
    expect(s.phase).toBe('gameEnd');
  }, 180_000);

  it("answers only for the seat that must act, and replays a multi-action plan's later actions", () => {
    let s = newMatch(91, 2);
    let replayed = 0;
    for (let n = 0; n < 300 && s.phase !== 'gameEnd' && replayed < 2; n++) {
      const id = actingPlayer(s)!;
      const other = s.players.find((p) => p.id !== id)!.id;
      expect(chooseAction(s, other)).toBeNull();
      const plan = heuristicActions(s, id);
      const first = chooseAction(s, id)!;
      expect(first).toEqual(plan[0]);
      s = applyAction(s, first);
      // The rest of the plan comes out as is, one action per call.
      for (const a of plan.slice(1)) {
        expect(chooseAction(s, id)).toEqual(a);
        s = applyAction(s, a);
        replayed++;
      }
    }
    expect(replayed).toBeGreaterThan(0);
  }, 180_000);
});
