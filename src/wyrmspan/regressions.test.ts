// Regressions found by AI self-play fuzzing: the Academy "Play 1 for free and
// keep/discard the other N" draw abilities (cards 321 and 322).

import { describe, expect, it } from 'vitest';
import { chooseAction } from './ai';
import { CAVES, DRAGONS, isDragonCard } from './cards';
import { createGame } from './createGame';
import { applyAction } from './engine';
import type { GameState, PendingStep, PlayerId } from './types';

/** Reach the 'main' phase of a fresh 2-player game. */
function inMain(): GameState {
  let s = createGame({ seed: 3, playerNames: ['P1', 'P2'] });
  while (s.pending.length) {
    s = applyAction(s, chooseAction(s, s.pending[0]!.playerId)!);
  }
  expect(s.phase).toBe('main');
  return s;
}

const me = (s: GameState, pid: PlayerId) => s.players.find((p) => p.id === pid)!;
const excavated = (s: GameState, pid: PlayerId) =>
  me(s, pid).caves.reduce((n, row) => n + row.spaces.filter((sp) => sp.excavated).length, 0);

function withStep(s: GameState, step: PendingStep): GameState {
  return { ...s, pending: [step, ...s.pending] };
}

describe('distributeCards "play 1 for free"', () => {
  it('"play 1 free and keep the other 2" excavates a drawn cave card instead of crashing', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const drawn = CAVES.slice(0, 3).map((c) => c.id);
    expect(drawn.some(isDragonCard)).toBe(false);
    const before = excavated(s0, pid);
    const s = applyAction(
      withStep(s0, { kind: 'distributeCards', playerId: pid, cardIds: drawn, keep: 2, playFree: 1 }),
      { type: 'resolveChoice', playerId: pid, answer: { kind: 'indexes', indexes: [0, 1, 2] } },
    );
    // The first card was played (excavated); the other two are kept in hand.
    expect(excavated(s, pid)).toBeGreaterThan(before);
    for (const id of drawn.slice(1)) expect(me(s, pid).hand).toContain(id);
    expect(me(s, pid).hand).not.toContain(drawn[0]);
  });

  it('honors the chosen index as the card played for free', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const drawn = CAVES.slice(0, 3).map((c) => c.id);
    const s = applyAction(
      withStep(s0, { kind: 'distributeCards', playerId: pid, cardIds: drawn, keep: 2, playFree: 1 }),
      { type: 'resolveChoice', playerId: pid, answer: { kind: 'indexes', indexes: [2] } },
    );
    expect(me(s, pid).hand).toContain(drawn[0]);
    expect(me(s, pid).hand).toContain(drawn[1]);
    expect(me(s, pid).hand).not.toContain(drawn[2]);
  });

  it('"play 1 free and discard the other 2" discards the rest instead of keeping them', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const drawn = DRAGONS.slice(0, 3).map((d) => d.id);
    const handBefore = me(s0, pid).hand.length;
    const discardBefore = s0.dragonDiscard.length;
    const s = applyAction(
      withStep(s0, { kind: 'distributeCards', playerId: pid, cardIds: drawn, playFree: 1, discard: 2 }),
      { type: 'resolveChoice', playerId: pid, answer: { kind: 'indexes', indexes: [0, 1, 2] } },
    );
    for (const id of drawn.slice(1)) {
      expect(me(s, pid).hand).not.toContain(id);
      expect(s.dragonDiscard).toContain(id);
    }
    expect(s.dragonDiscard.length).toBeGreaterThanOrEqual(discardBefore + 2);
    expect(me(s, pid).hand.length).toBeLessThanOrEqual(handBefore);
  });
});
