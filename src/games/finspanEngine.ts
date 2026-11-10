// Finspan engine entry for the lazy registry (src/games/engines.ts).
import { chooseAction } from '@/finspan/ai/chooseAction';
import { createGame } from '@/finspan/createGame';
import { applyAction } from '@/finspan/engine';
import { getPlayer } from '@/finspan/helpers';
import type { GameState } from '@/finspan/types';
import type { GameEngine } from './engines';

export const engine = {
  createGame,
  applyAction,
  chooseAction,
  aiToAct(s: GameState) {
    if (s.phase === 'gameOver') return null;
    const pid = s.pending[0]?.playerId ?? s.playerOrder[s.currentPlayerIndex] ?? null;
    return pid && getPlayer(s, pid).isAI ? pid : null;
  },
  hasHuman: (s: GameState) => s.players.some((p) => !p.isAI),
} satisfies GameEngine;
