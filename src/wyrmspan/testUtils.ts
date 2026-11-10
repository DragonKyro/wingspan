// Shared helpers for the Wyrmspan engine tests (not itself a test file).

import { expect } from 'vitest';
import { chooseAction } from './ai';
import { applyAction } from './engine';
import type { GameState } from './types';

/** Drive the game with the AI until it ends, `stop` holds, or a step cap.
 *  `strict` also fails on a setup/round-end phase with nothing pending. */
export function aiPlay(s: GameState, stop: (s: GameState) => boolean = () => false, strict = false): GameState {
  let steps = 0;
  while (s.phase !== 'gameEnd' && !stop(s) && steps < 20000) {
    steps++;
    if (s.pending.length) {
      const a = chooseAction(s, s.pending[0]!.playerId);
      if (!a) throw new Error(`AI stuck on pending ${JSON.stringify(s.pending[0])}`);
      s = applyAction(s, a);
      continue;
    }
    if (strict && (s.phase === 'setup' || s.phase === 'roundEnd')) {
      throw new Error(`${s.phase} phase with no pending steps`);
    }
    const a = chooseAction(s, s.turn);
    if (!a) throw new Error(`AI stuck on turn ${s.turn} round ${s.round}`);
    s = applyAction(s, a);
  }
  return s;
}

/** Resolve a fresh game's setup offers with the AI, reaching 'main'. */
export function toMain(s: GameState): GameState {
  while (s.pending.length) s = applyAction(s, chooseAction(s, s.pending[0]!.playerId)!);
  expect(s.phase).toBe('main');
  return s;
}
