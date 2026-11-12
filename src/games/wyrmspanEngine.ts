// Wyrmspan engine entry for the lazy registry (src/games/engines.ts).
import { chooseAction } from '@/wyrmspan/ai';
import { createGame } from '@/wyrmspan/createGame';
import { applyAction } from '@/wyrmspan/engine';
import { player } from '@/wyrmspan/helpers';
import type { GameState } from '@/wyrmspan/types';
import type { GameEngine } from './engines';

export const engine = {
  createGame,
  applyAction,
  chooseAction,
  aiToAct(s: GameState) {
    if (s.phase === 'gameEnd') return null;
    const pid = s.pending[0]?.playerId ?? s.turn;
    return pid && player(s, pid).isAI ? pid : null;
  },
  hasHuman: (s: GameState) => s.players.some((p) => !p.isAI),
} satisfies GameEngine;
