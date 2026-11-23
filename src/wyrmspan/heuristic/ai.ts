// The app's Wyrmspan AI: the heuristic (heuristic.ts), one engine action per call.
//
// The heuristic plans a whole decision — e.g. two resource exchanges, then an
// entice — but the app's AI driver applies one action at a time. The rest of
// the plan is kept and replayed while the game is exactly where the plan
// expects it; anything else (another seat moved, an undo, a new game) plans
// afresh. Automa's turns follow the Automa rules (the engine AI), and a plan
// the engine wouldn't accept falls back to the engine AI's move, so an AI
// seat never stalls.

import { chooseAction as engineAI } from '../ai';
import { applyAction } from '../engine';
import { player } from '../helpers';
import type { Action, GameState, PlayerId } from '../types';
import { heuristicActions } from './heuristic';

interface Plan {
  /** The state the next action of `rest` expects (JSON). */
  expect: string;
  rest: Action[];
}

const plans = new Map<PlayerId, Plan>();
const snapshot = (s: GameState) => JSON.stringify(s);

/** The state after `action`, or null if the engine rejects it (throws or makes no progress). */
function tryApply(s: GameState, action: Action): GameState | null {
  try {
    const t = applyAction(s, action);
    return t === s ? null : t;
  } catch {
    return null;
  }
}

export function chooseAction(state: GameState, playerId: PlayerId): Action | null {
  const head = state.pending[0];
  if (head ? head.playerId !== playerId : state.phase !== 'main' || state.turn !== playerId || player(state, playerId).passed) return null;
  if (state.automa && playerId === 'p2') return engineAI(state, playerId);

  const plan = plans.get(playerId);
  if (plan?.rest.length && plan.expect === snapshot(state)) {
    const next = plan.rest.shift()!;
    const after = tryApply(state, next);
    if (after) {
      plan.expect = plan.rest.length ? snapshot(after) : '';
      return next;
    }
  }
  plans.delete(playerId);

  const [first, ...rest] = heuristicActions(state, playerId);
  const after = first && tryApply(state, first);
  if (!first || !after) return engineAI(state, playerId);
  if (rest.length) plans.set(playerId, { expect: snapshot(after), rest });
  return first;
}
