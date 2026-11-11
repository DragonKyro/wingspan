// The reducer: applyAction(state, action) -> state, plus settle() which
// drops infeasible pending steps, drains the game-end ability queue, and
// computes final scores / winner.

import { hasGameEndEffect } from './abilities';
import { doDive, doEndTurn, doNautomaTurn, doPlayFish } from './actions';
import { appendLog, getPlayer, slotAt, topFish } from './helpers';
import { fireAbility } from './powers';
import { dropInfeasible, resolveChoice } from './resolve';
import { finalScores } from './scoring';
import type { Action, GameState } from './types';

export function applyAction(state: GameState, action: Action): GameState {
  let s: GameState;
  switch (action.type) {
    case 'playFish':
      s = doPlayFish(state, action);
      break;
    case 'dive':
      s = doDive(state, action);
      break;
    case 'nautomaTurn':
      s = doNautomaTurn(state, action);
      break;
    case 'endTurn':
      s = doEndTurn(state, action);
      break;
    case 'resolveChoice':
      s = resolveChoice(state, action.playerId, action.choice);
      break;
    default:
      throw new Error(`unknown action ${(action as Action).type}`);
  }
  return settle(s);
}

/** Post-action housekeeping: drop dead pending steps, drain the gameEnd
 *  queue, and finish the game when nothing remains. */
export function settle(state: GameState): GameState {
  let s = dropInfeasible(state);
  if (s.phase !== 'gameEnd' || !s.gameEndQueue) return s;

  while (s.pending.length === 0 && (s.gameEndQueue?.length ?? 0) > 0) {
    const [head, ...rest] = s.gameEndQueue!;
    // "Activate any GAME END abilities on fish in your ocean (in any order)":
    // with 2+ still-live abilities left, the player picks the next one.
    const mine = s.gameEndQueue!.filter(
      (e) => e.playerId === head.playerId && hasGameEndEffect(topFish(slotAt(getPlayer(s, e.playerId).ocean, e.slot))),
    );
    if (mine.length >= 2) {
      s = { ...s, pending: [{ kind: 'chooseGameEndAbility', playerId: head.playerId, slots: mine.map((e) => e.slot), optional: true }] };
      break;
    }
    s = { ...s, gameEndQueue: rest };
    const p = getPlayer(s, head.playerId);
    // Re-read the visible fish — an earlier game-end ability may have
    // covered it, in which case its ability is gone too.
    const card = topFish(slotAt(p.ocean, head.slot));
    if (hasGameEndEffect(card)) {
      s = fireAbility(s, head.playerId, card.ability, head.slot, `${card.name} (game end)`);
    }
    s = dropInfeasible(s);
  }

  if (s.pending.length === 0 && (s.gameEndQueue?.length ?? 0) === 0) {
    const { scores, winner } = finalScores(s);
    s = appendLog({ ...s, phase: 'gameOver', finalScores: scores, winner }, 'game over');
  }
  return s;
}
