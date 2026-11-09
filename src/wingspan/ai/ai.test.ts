import { describe, expect, it } from 'vitest';
import { createGame } from '@/wingspan/createGame';
import { applyAction } from '@/wingspan/engine';
import type { GameState } from '@/wingspan/types';
import { chooseAction } from './chooseAction';
import { actingPlayerId } from '@/wingspan/helpers';

function aiGame(seed = 5, players = 2): GameState {
  return createGame({
    playerNames: ['A', 'B', 'C', 'D'].slice(0, players),
    playerTypes: Array.from({ length: players }, () => 'ai' as const),
    playerColors: (['red', 'blue', 'orange', 'white'] as const).slice(0, players) as import('@/wingspan/types').PlayerColor[],
    seed,
  });
}

/** Run the whole game with the AI, bounded. */
function playOut(s: GameState, maxActions = 3000): GameState {
  let guard = 0;
  while (s.phase !== 'gameOver' && guard++ < maxActions) {
    // Setup keeps + pending answers may belong to any player.
    const head = s.pending[0];
    let pid = head?.playerId;
    if (!pid) {
      if (s.phase === 'setup') pid = s.setupRemaining[0];
      else pid = actingPlayerId(s);
    }
    if (!pid) break;
    const action = chooseAction(s, pid);
    if (!action) break;
    s = applyAction(s, action);
  }
  return s;
}

describe('heuristic AI', () => {
  it('completes a 2-player game', () => {
    const s = playOut(aiGame(5));
    expect(s.phase).toBe('gameOver');
    expect(s.finalScores).not.toBeNull();
    // Sanity: birds were played and eggs laid.
    const anyBirds = s.players.some((p) =>
      Object.values(p.board).some((row) => row.length > 0),
    );
    expect(anyBirds).toBe(true);
  });

  it('completes a 4-player game', () => {
    const s = playOut(aiGame(9, 4));
    expect(s.phase).toBe('gameOver');
    expect(s.goalScores.length).toBe(4);
  });

  it('scores reasonable points (birds played in most games)', () => {
    let totalBirds = 0;
    let games = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const s = playOut(aiGame(seed));
      if (s.phase !== 'gameOver') continue;
      games++;
      for (const p of s.players) {
        totalBirds += Object.values(p.board).reduce((n, row) => n + row.length, 0);
      }
    }
    expect(games).toBe(5);
    expect(totalBirds).toBeGreaterThan(10);
  });
});
