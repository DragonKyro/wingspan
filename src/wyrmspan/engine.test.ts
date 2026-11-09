import { describe, expect, it } from 'vitest';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { chooseAction } from './ai';
import type { GameState } from './types';

/** Drive the game with the AI until it ends or we hit a safety cap. */
function playOut(seed: number, players = 2): GameState {
  const names = Array.from({ length: players }, (_, i) => `P${i + 1}`);
  let s = createGame({ seed, playerNames: names });
  let steps = 0;
  while (s.phase !== 'gameEnd' && steps < 20000) {
    steps++;
    if (s.pending.length) {
      const pid = s.pending[0]!.playerId;
      const a = chooseAction(s, pid);
      if (!a) throw new Error(`AI stuck on pending ${JSON.stringify(s.pending[0])}`);
      s = applyAction(s, a);
      continue;
    }
    if (s.phase === 'setup') throw new Error('setup phase with no pending steps');
    const a = chooseAction(s, s.turn);
    if (!a) throw new Error(`AI stuck on turn ${s.turn} round ${s.round}`);
    s = applyAction(s, a);
  }
  expect(s.phase).toBe('gameEnd');
  return s;
}

describe('wyrmspan engine', () => {
  it('creates a game with setup pending', () => {
    const s = createGame({ seed: 1, playerNames: ['P1', 'P2'] });
    expect(s.phase).toBe('setup');
    expect(s.players).toHaveLength(2);
    expect(s.pending.length).toBeGreaterThan(0);
    for (const p of s.players) {
      expect(s.setupOffers[p.id]).toHaveLength(6);
      expect(p.coins).toBe(6);
      expect(p.nestEggs).toBe(1);
    }
  });

  it('plays a full 2-player game to completion', () => {
    const s = playOut(1, 2);
    expect(s.round).toBe(4);
    expect(s.finalScores).toBeDefined();
    expect(s.finalScores).toHaveLength(2);
    expect(s.winners?.length).toBeGreaterThan(0);
    for (const sc of s.finalScores!) {
      expect(sc.total).toBeGreaterThan(0);
      expect(sc.total).toBe(
        sc.guildTile + sc.printedDragonVp + sc.endGameAbilities + sc.eggs + sc.cached + sc.tucked + sc.objectives + sc.coins + sc.leftovers + sc.bonusVP,
      );
    }
  }, 30000);

  it('is deterministic for a fixed seed', () => {
    const a = playOut(7, 2);
    const b = playOut(7, 2);
    expect(a.finalScores).toEqual(b.finalScores);
  }, 30000);
});
