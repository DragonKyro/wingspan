// applyAction — the single entry point every interface (UI, AI, tests) calls.
// Each action returns the next immutable GameState; the log field records
// everything that happened for UI display and debugging.

import {
  activatePower,
  drawCards,
  endTurn,
  finishRound,
  gainFood,
  keepSetup,
  layEggs,
  playBird,
  runGameEndStep,
  runRoundEndStep,
  skipPower,
} from './actions';
import { dropImpossiblePending, resolveChoice } from './resolve';
import { finalScore } from './scoring';
import { getPlayer, totalFood } from './helpers';
import type { Action, GameState, PlayerId, ScoreBreakdown } from './types';

export function applyAction(state: GameState, action: Action): GameState {
  let s: GameState;
  switch (action.type) {
    case 'keepSetup':
      s = keepSetup(state, action);
      break;
    case 'playBird':
      s = playBird(state, action);
      break;
    case 'gainFood':
      s = gainFood(state, action);
      break;
    case 'layEggs':
      s = layEggs(state, action);
      break;
    case 'drawCards':
      s = drawCards(state, action);
      break;
    case 'activatePower':
      s = activatePower(state, action.playerId);
      break;
    case 'skipPower':
      s = skipPower(state, action.playerId, action.all ?? false);
      break;
    case 'resolveChoice':
      s = resolveChoice(state, action.playerId, action.choice);
      break;
    case 'endTurn':
      s = endTurn(state, action.playerId);
      break;
    default:
      return state;
  }
  return settle(s);
}

/** After any action: drop unanswerable pending steps, drain the gameEnd
 *  queue, and compute final scores when everything is done. */
export function settle(state: GameState): GameState {
  let s = dropImpossiblePending(state);
  while (s.phase === 'roundEnd' && s.pending.length === 0 && s.roundEndQueue.length > 0) {
    s = runRoundEndStep(s);
    s = dropImpossiblePending(s);
  }
  if (s.phase === 'roundEnd' && s.pending.length === 0 && s.roundEndQueue.length === 0) {
    // Teal powers are done → score the goal, reset cubes, move on (finishRound
    // returns a 'main' state or begins game end after round 4).
    s = finishRound(s);
  }
  while (
    s.phase === 'gameEnd' &&
    s.pending.length === 0 &&
    s.gameEndQueue != null &&
    s.gameEndQueue.length > 0
  ) {
    s = runGameEndStep(s);
    s = dropImpossiblePending(s);
  }
  if (
    s.phase === 'gameEnd' &&
    s.pending.length === 0 &&
    (s.gameEndQueue == null || s.gameEndQueue.length === 0)
  ) {
    const rec: Partial<Record<PlayerId, ScoreBreakdown>> = {};
    for (const pid of s.playerOrder) rec[pid] = finalScore(s, pid);
    // Winner: highest total; ties broken by most leftover food, then shared.
    const best = Math.max(...s.playerOrder.map((pid) => rec[pid]!.total));
    const tied = s.playerOrder.filter((pid) => rec[pid]!.total === best);
    const foodOf = (pid: PlayerId) => totalFood(getPlayer(s, pid));
    const bestFood = Math.max(...tied.map(foodOf));
    const winner = tied.filter((pid) => foodOf(pid) === bestFood);
    s = { ...s, phase: 'gameOver', finalScores: rec as GameState['finalScores'], winner };
  }
  return s;
}

/** Legal-actions enumeration for the AI and UI hinting. Deliberately a
 *  subset for v1: lists the main action kinds that are currently allowed. */
export function legalActionKinds(state: GameState): Action['type'][] {
  const head = state.pending[0];
  if (head) return ['resolveChoice'];
  if (state.phase === 'setup') return ['keepSetup'];
  if (state.phase === 'roundEnd' || state.phase === 'gameEnd') return []; // auto-settles
  if (state.phase !== 'main') return [];
  if (state.activation && state.activation.remaining.length > 0) {
    return ['activatePower', 'skipPower'];
  }
  const p = state.players.find((x) => x.id === state.playerOrder[state.currentPlayerIndex]);
  if (!p || p.actionCubes <= 0) return [];
  return ['playBird', 'gainFood', 'layEggs', 'drawCards'];
}
