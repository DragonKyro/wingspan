// Match plumbing shared by the training env, the benchmark and the tests:
// a game factory for 1–5 players (1 = solo vs Automa) and the baseline seat
// agents a learner is measured against.
//
//   heuristic  heuristic.ts — one-ply lookahead on a determinized view
//   greedy     ai.ts — the engine's first-legal-choice AI (the in-app AI)
//   random     a uniformly random candidate
//
// Automa's turns (solo) are always played by the engine's Automa rules.

import { nextRng } from '@/shared/rng';
import { chooseAction } from '../ai';
import { createGame } from '../createGame';
import { applyAction } from '../engine';
import type { Action, AutomaDifficulty, Expansion, GameState, PlayerId } from '../types';
import { legalCandidates } from './candidates';
import { tokenRefs } from './encode';
import { heuristicActions } from './heuristic';
import { redact } from './view';

export type BaselineAgent = 'heuristic' | 'greedy' | 'random';
export const BASELINE_AGENTS: readonly BaselineAgent[] = ['heuristic', 'greedy', 'random'];

export interface MatchOptions {
  expansions?: Expansion[];
  automaDifficulty?: AutomaDifficulty;
}

/** A fresh game with `players` seats (all flagged AI); 1 player = solo vs Automa (seat p2). */
export function newMatch(seed: number, players: number, opts: MatchOptions = {}): GameState {
  if (!(players >= 1 && players <= 5)) throw new Error(`players must be 1-5, got ${players}`);
  const solo = players === 1;
  const n = solo ? 2 : players;
  return createGame({
    seed,
    playerNames: Array.from({ length: n }, (_, i) => (solo && i === 1 ? 'Automa' : `P${i + 1}`)),
    isAI: Array(n).fill(true),
    expansions: opts.expansions,
    automa: solo ? { difficulty: opts.automaDifficulty ?? 1 } : undefined,
  });
}

/** Who must act next, or null when the game is over. */
export function actingPlayer(s: GameState): PlayerId | null {
  if (s.phase === 'gameEnd') return null;
  return s.pending[0]?.playerId ?? s.turn;
}

export const isAutomaSeat = (s: GameState, id: PlayerId): boolean => !!s.automa && id === 'p2';

/** A baseline agent's move (an action sequence) for `id`. `rng` drives 'random'. */
export function baselineActions(s: GameState, id: PlayerId, agent: BaselineAgent, rng = { state: 1 }): Action[] {
  if (isAutomaSeat(s, id)) {
    const a = chooseAction(s, id);
    return a ? [a] : [];
  }
  if (agent === 'greedy') {
    const a = chooseAction(s, id);
    return a ? [a] : [];
  }
  if (agent === 'heuristic') return heuristicActions(s, id);
  const view = redact(s, id);
  const cands = legalCandidates(view, id, tokenRefs(view, id));
  if (!cands.length) return [];
  const [u, next] = nextRng(rng.state);
  rng.state = next;
  return cands[Math.floor(u * cands.length)]!.actions;
}

/** Apply an action sequence; throws if the engine ignores the first action (no progress). */
export function applyAll(s: GameState, actions: readonly Action[]): GameState {
  let t = s;
  for (const a of actions) t = applyAction(t, a);
  if (t === s) throw new Error(`no progress applying ${JSON.stringify(actions[0])}`);
  return t;
}

/** Play a whole game with one baseline agent per seat (index = state.players order). */
export function playBaselines(seed: number, players: number, agents: readonly BaselineAgent[], opts: MatchOptions = {}, maxSteps = 6000): GameState {
  let s = newMatch(seed, players, opts);
  const rng = { state: (seed ^ 0x5bd1e995) >>> 0 || 1 };
  for (let n = 0; s.phase !== 'gameEnd'; n++) {
    if (n > maxSteps) throw new Error(`seed ${seed}: no end after ${maxSteps} decisions`);
    const id = actingPlayer(s)!;
    const seat = s.players.findIndex((p) => p.id === id);
    s = applyAll(s, baselineActions(s, id, agents[seat] ?? 'greedy', rng));
  }
  return s;
}
