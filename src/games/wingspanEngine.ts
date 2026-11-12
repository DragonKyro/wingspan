// Wingspan engine entry for the lazy registry (src/games/engines.ts).
import { chooseAction } from '@/wingspan/ai/chooseAction';
import { createGame } from '@/wingspan/createGame';
import { applyAction } from '@/wingspan/engine';
import { actingPlayerId, getPlayer } from '@/wingspan/helpers';
import type { GameState, PlayerId } from '@/wingspan/types';
import type { GameEngine } from './engines';

function actorNeeded(s: GameState): PlayerId | null {
  if (s.phase === 'gameOver') return null;
  if (s.pending.length > 0) return s.pending[0]!.playerId;
  if (s.phase === 'setup') return s.setupRemaining[0] ?? null;
  if (s.phase === 'roundEnd' || s.phase === 'gameEnd') return null;
  return actingPlayerId(s);
}

export const engine = {
  createGame,
  applyAction,
  chooseAction,
  aiToAct(s: GameState) {
    const pid = actorNeeded(s);
    return pid && getPlayer(s, pid).isAI ? pid : null;
  },
  hasHuman: (s: GameState) => s.players.some((p) => !p.isAI),
} satisfies GameEngine;
