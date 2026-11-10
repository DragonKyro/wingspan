// Shared helpers for the Finspan engine tests (not itself a test file).

import { chooseAction } from './ai/chooseAction';
import { createGame } from './createGame';
import { applyAction } from './engine';
import type { Action, GameSettings, GameState } from './types';

/** A game with `players` AI seats (P1…, colors c0…). */
export function aiGame(seed: number, players: number, settings: Partial<GameSettings>): GameState {
  return createGame({
    playerNames: Array.from({ length: players }, (_, i) => `P${i + 1}`),
    playerTypes: Array.from({ length: players }, () => 'ai' as const),
    playerColors: Array.from({ length: players }, (_, i) => `c${i}`),
    seed,
    settings,
  });
}

/** Drive a game to completion with the heuristic AI (each move → `onAction`). */
export function runAI(s: GameState, maxActions: number, onAction?: (a: Action) => void): GameState {
  let n = 0;
  while (s.phase !== 'gameOver' && n < maxActions) {
    const pid = s.pending.length ? s.pending[0]!.playerId : s.playerOrder[s.currentPlayerIndex]!;
    const a = chooseAction(s, pid);
    if (!a) throw new Error(`AI stuck at action ${n} (phase ${s.phase})`);
    s = applyAction(s, a);
    onAction?.(a);
    n++;
  }
  return s;
}
