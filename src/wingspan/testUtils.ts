// Shared helpers for the Wingspan engine tests (not itself a test file).

import { greedyChoice } from './ai/choices';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { actingPlayerId, getPlayer } from './helpers';
import { setPlayer } from './powers';
import type { Action, BirdRef, GameSettings, GameState, Habitat, PlayedBird, PlayerId, PlayerState } from './types';
import { BASE_FOODS } from './types';

/** `newGame(seed = 42, sets = defaultSets)` for a 2-player human game (A/red
 *  vs B/blue). Without sets the game uses createGame's default settings. */
export function gameFactory(defaultSets?: string[], extra: Partial<GameSettings> = {}) {
  return (seed = 42, sets = defaultSets): GameState =>
    createGame({
      playerNames: ['A', 'B'],
      playerTypes: ['human', 'human'],
      playerColors: ['red', 'blue'],
      seed,
      ...(sets && { settings: { sets, ...extra } }),
    });
}

/** Finish setup: every player keeps their first `keep` birds and discards
 *  that many base foods (1 food per bird kept). */
export function autoSetup(s: GameState, keep = 2): GameState {
  while (s.phase === 'setup' && s.setupRemaining.length > 0) {
    const pid = s.setupRemaining[0]!;
    const p = getPlayer(s, pid);
    s = applyAction(s, {
      type: 'keepSetup',
      playerId: pid,
      keepBirds: p.hand.slice(0, keep),
      keepBonus: p.bonusHand[0]!,
      discardFood: BASE_FOODS.slice(0, keep),
    });
  }
  return s;
}

/** Drain pending steps with the greedy AI answers (bounded). */
export function autoResolve(s: GameState, limit = 100): GameState {
  let n = 0;
  while (s.pending.length > 0 && n++ < limit) {
    const step = s.pending[0]!;
    const choice = greedyChoice(s, step);
    if (!choice) throw new Error(`no greedy answer for ${step.kind}`);
    s = applyAction(s, { type: 'resolveChoice', playerId: step.playerId, choice });
  }
  return s;
}

/** Finish any activation track by activating all remaining powers. */
export function autoActivate(s: GameState): GameState {
  let guard = 0;
  while (guard++ < 50) {
    s = autoResolve(s);
    if (!s.activation || s.activation.remaining.length === 0) break;
    s = applyAction(s, { type: 'activatePower', playerId: actingPlayerId(s) });
  }
  return autoResolve(s);
}

/** Play a full turn for the acting player: lay eggs (≥2 food) or take 1 die. */
export function takeSimpleTurn(s: GameState): GameState {
  const pid = actingPlayerId(s);
  const p = getPlayer(s, pid);
  const action: Action =
    BASE_FOODS.reduce((n, f) => n + p.food[f], 0) >= 2
      ? { type: 'layEggs', playerId: pid, placements: [] }
      : {
          type: 'gainFood',
          playerId: pid,
          picks: s.feederIn
            .map((f, i) => ({ die: i, take: f === 'split' ? ('seed' as const) : undefined }))
            .slice(0, 1),
        };
  s = applyAction(s, action);
  s = autoActivate(s);
  s = applyAction(s, { type: 'endTurn', playerId: pid });
  return autoResolve(s);
}

/** Patch one player's state. */
export function edit(s: GameState, pid: PlayerId, patch: Partial<PlayerState>): GameState {
  return setPlayer(s, { ...getPlayer(s, pid), ...patch });
}

/** A played bird with no eggs, tucks or caches (plus overrides). */
export function mkBird(cardId: number, extra: Partial<PlayedBird> = {}): PlayedBird {
  return { cardId, eggs: 0, tucked: [], cached: [], ...extra };
}

export const ref = (habitat: Habitat, index: number): BirdRef => ({ habitat, index });
