// A batch of independent Wyrmspan matches for a learner to drive.
//
// Every seat has a role: 'learner' (the network being trained, answered by the
// Python process) or a baseline played right here — 'heuristic'
// (src/wyrmspan/nn/heuristic.ts), 'greedy' (the in-app AI) or 'random'. In
// solo matches (players = 1) the other seat is Automa. Each env runs on its own
// until a learner seat has a real decision, then reports that seat's encoded
// observation (from its redacted view — nothing hidden) and candidate list.
// The learner answers every env with one candidate index. Decisions with a
// single candidate are played automatically and never reported.
//
// The table size is drawn from `players` per match (cycled per env and match);
// one seat is the "primary" learner seat and rotates round the table match by
// match. With opponents = 'learner' every seat is a learner (self-play).
//
// Rewards are per seat (numEnvs × MAX_SEATS) and accrue between consecutive
// batches: credit `reward[i·MAX_SEATS + s]` to seat s's latest decision in env i.
// The objective is the seat's own final score (not winning):
//   - match end: final score / scoreNorm
//   - shaping (potential-based on the running score, so it sums to a constant
//     per match): shaping × Δscore / scoreNorm whenever a seat's current score
//     changes, and −shaping × score / scoreNorm at the end.
// A match cut off at maxSteps still pays its current score.
//
// With `teacher` on, every learner row carries the heuristic's pick for that
// decision (−1 where none) — the imitation target, and the "heuristic plays
// this seat" baseline when the learner process plays the label.
//
// Finished matches auto-reset (`done[i]`; the row returned is already the next
// match's first decision). With `quota` set, an env stops after that many
// matches and reports role −1 (no legal candidate; any index is ignored).
//
// Fault tolerance: a learner or baseline move the engine rejects (no progress /
// throws) is replaced by the greedy AI's move (`Episode.fallbacks`); any other
// error abandons just that match (`Episode.aborted`) and starts a new one.

import { chooseAction } from '@/wyrmspan/ai';
import { type Candidate, CAND_DIM, MAX_CANDS, legalCandidates } from '@/wyrmspan/nn/candidates';
import { GLOBAL_DIM, NUM_TOKENS, TOKEN_DIM, encodeView } from '@/wyrmspan/nn/encode';
import { heuristicIndex } from '@/wyrmspan/nn/heuristic';
import { type BaselineAgent, actingPlayer, applyAll, baselineActions, isAutomaSeat, newMatch } from '@/wyrmspan/nn/play';
import { redact } from '@/wyrmspan/nn/view';
import { scorePlayer } from '@/wyrmspan/scoring';
import type { Action, AutomaDifficulty, Expansion, GameState, ScoreBreakdown } from '@/wyrmspan/types';

export const MAX_SEATS = 5;

export type SeatRole = 'learner' | BaselineAgent;
const ROLES: readonly SeatRole[] = ['learner', 'heuristic', 'greedy', 'random'];

export interface VecEnvOptions {
  numEnvs: number;
  seed: number;
  /** Table sizes to play (1 = solo vs Automa), cycled per match. */
  players: number[];
  /** Role of every seat but the primary learner seat ('learner' = self-play). */
  opponents: SeatRole;
  /** Engine decisions before a match is cut off. */
  maxSteps: number;
  scoreNorm: number;
  shaping: number;
  /** Matches each env plays before going idle (0 = forever). */
  quota: number;
  /** Label learner rows with the heuristic's pick (`VecBatch.teacher`). */
  teacher: boolean;
  expansions?: Expansion[];
  automaDifficulty?: AutomaDifficulty;
}

export const DEFAULT_VEC_ENV_OPTIONS: VecEnvOptions = {
  numEnvs: 16,
  seed: 1,
  players: [2],
  opponents: 'heuristic',
  maxSteps: 6000,
  scoreNorm: 100,
  shaping: 1,
  quota: 0,
  teacher: false,
};

export interface Episode {
  env: number;
  seed: number;
  players: number;
  /** Role per seat (state.players order); Automa's seat is 'automa'. */
  roles: string[];
  /** Final score per seat. */
  scores: number[];
  breakdown: ScoreBreakdown[];
  /** Learner decisions reported to the learner / played automatically (single candidate). */
  decisions: number;
  forced: number;
  steps: number;
  truncated: boolean;
  fallbacks: number;
  aborted: boolean;
}

/** Buffers are reused by the next reset / step — copy anything you keep. */
export interface VecBatch {
  seat: Int8Array;
  /** 0 learner, −1 idle (quota reached). */
  role: Int8Array;
  global: Float32Array;
  tokenIds: Int16Array;
  tokenFeat: Float32Array;
  tokenMask: Uint8Array;
  candFeat: Float32Array;
  /** numEnvs × MAX_CANDS × NUM_TOKENS: how often candidate k picks / plays token t. */
  candSel: Uint8Array;
  /** numEnvs × MAX_CANDS × NUM_TOKENS: how often candidate k spends token t (cards paid, eggs paid). */
  candPay: Uint8Array;
  /** numEnvs × MAX_CANDS: the mat token a candidate plays into, or −1. */
  candTarget: Int8Array;
  candMask: Uint8Array;
  /** The heuristic's candidate for learner row i, or −1. */
  teacher: Int16Array;
  /** numEnvs × MAX_SEATS. */
  reward: Float32Array;
  done: Uint8Array;
  episodes: Episode[];
}

interface EnvSlot {
  state: GameState;
  seed: number;
  episode: number;
  roles: SeatRole[];
  rng: { state: number };
  /** Running score per seat (the shaping potential). */
  potential: number[];
  steps: number;
  decisions: number;
  forced: number;
  fallbacks: number;
  seat: number;
  shown: Candidate[] | null;
  idle: boolean;
}

/** stderr, at most a few lines per distinct problem (then every 100th). */
const reported = new Map<string, number>();
function report(kind: string, message: string): void {
  const n = (reported.get(kind) ?? 0) + 1;
  reported.set(kind, n);
  if (n <= 3 || n % 100 === 0) process.stderr.write(`[wyrmspan-env] ${kind} (×${n}): ${message}\n`);
}

export class WyrmspanVecEnv {
  readonly opts: VecEnvOptions;
  private readonly envs: EnvSlot[] = [];
  private batch: VecBatch;

  constructor(options: Partial<VecEnvOptions> = {}) {
    this.opts = { ...DEFAULT_VEC_ENV_OPTIONS, ...options };
    const n = this.opts.numEnvs;
    if (!(Number.isInteger(n) && n >= 1)) throw new Error('numEnvs must be a positive integer');
    validate(this.opts);
    this.batch = {
      seat: new Int8Array(n),
      role: new Int8Array(n),
      global: new Float32Array(n * GLOBAL_DIM),
      tokenIds: new Int16Array(n * NUM_TOKENS),
      tokenFeat: new Float32Array(n * NUM_TOKENS * TOKEN_DIM),
      tokenMask: new Uint8Array(n * NUM_TOKENS),
      candFeat: new Float32Array(n * MAX_CANDS * CAND_DIM),
      candSel: new Uint8Array(n * MAX_CANDS * NUM_TOKENS),
      candPay: new Uint8Array(n * MAX_CANDS * NUM_TOKENS),
      candTarget: new Int8Array(n * MAX_CANDS),
      candMask: new Uint8Array(n * MAX_CANDS),
      teacher: new Int16Array(n),
      reward: new Float32Array(n * MAX_SEATS),
      done: new Uint8Array(n),
      episodes: [],
    };
  }

  /** New opponents / table sizes for matches that start from now on; teacher labels on / off. */
  configure(update: { opponents?: SeatRole; players?: number[]; teacher?: boolean }): void {
    const next = { ...this.opts, ...update };
    validate(next);
    Object.assign(this.opts, next);
  }

  reset(): VecBatch {
    this.beginBatch();
    this.envs.length = 0;
    for (let i = 0; i < this.opts.numEnvs; i++) {
      this.envs.push(this.startMatch(i, 0));
      this.guarded(i, () => this.advance(i));
    }
    return this.finishBatch();
  }

  /** One candidate index per env, for the seat reported in the previous batch (ignored for idle envs). */
  step(picks: ArrayLike<number>): VecBatch {
    if (this.envs.length === 0) throw new Error('step before reset');
    if (picks.length !== this.envs.length) throw new Error(`expected ${this.envs.length} actions, got ${picks.length}`);
    this.beginBatch();
    for (let i = 0; i < this.envs.length; i++) {
      const env = this.envs[i]!;
      if (env.idle) continue;
      this.guarded(i, () => {
        const cands = env.shown!;
        const k = Math.trunc(picks[i]!);
        const cand = cands[k >= 0 && k < cands.length ? k : 0]!;
        env.shown = null;
        env.decisions++;
        this.play(i, cand.actions);
        this.advance(i);
      });
    }
    return this.finishBatch();
  }

  /** Run `f` on env i; on an error, abandon that match, start a fresh one and play it to its first decision. */
  private guarded(i: number, f: () => void, recover: () => void = () => this.advance(i)): void {
    for (let attempt = 0; ; attempt++) {
      try {
        f();
        return;
      } catch (e) {
        if (attempt >= 3) throw e; // a fresh match failing over and over is a real bug
        const env = this.envs[i]!;
        report('match aborted', `env ${i} seed ${env.seed} phase ${env.state.phase}: ${(e as Error).stack ?? e}`);
        this.endMatch(i, true, true);
        this.envs[i] = this.startMatch(i, env.episode + 1);
        f = recover;
      }
    }
  }

  private startMatch(i: number, episode: number): EnvSlot {
    const { players, opponents } = this.opts;
    const seed = (Math.imul(this.opts.seed, 1_000_003) + Math.imul(i, 7919) + Math.imul(episode, 104_729)) >>> 0;
    const n = players[(i + episode) % players.length]!;
    const state = newMatch(seed, n, { expansions: this.opts.expansions, automaDifficulty: this.opts.automaDifficulty });
    const seats = state.players.length;
    const primary = n === 1 ? 0 : (i + episode) % seats;
    const roles = state.players.map((p, k): SeatRole => (isAutomaSeat(state, p.id) ? 'greedy' : k === primary ? 'learner' : opponents));
    const env: EnvSlot = {
      state, seed, episode, roles, rng: { state: (seed ^ 0x85ebca6b) >>> 0 || 1 },
      potential: state.players.map(() => 0), steps: 0, decisions: 0, forced: 0, fallbacks: 0, seat: 0, shown: null, idle: false,
    };
    env.potential = state.players.map((p) => scorePlayer(state, p).total);
    return env;
  }

  /** Apply a move for the acting seat; a move the engine rejects becomes the greedy AI's move. */
  private play(i: number, actions: readonly Action[]): void {
    const env = this.envs[i]!;
    let after: GameState;
    try {
      after = applyAll(env.state, actions);
    } catch (e) {
      report('move rejected', `${(e as Error).message}`);
      env.fallbacks++;
      const id = actingPlayer(env.state)!;
      const fallback = chooseAction(env.state, id);
      if (!fallback) throw new Error(`no fallback move for ${id} in ${env.state.phase}`);
      after = applyAll(env.state, [fallback]);
    }
    env.state = after;
    env.steps++;
    if (this.opts.shaping !== 0) {
      const R = this.batch.reward;
      after.players.forEach((p, s) => {
        if (env.roles[s] !== 'learner') return;
        const v = scorePlayer(after, p).total;
        if (v !== env.potential[s]) {
          R[i * MAX_SEATS + s]! += (this.opts.shaping * (v - env.potential[s]!)) / this.opts.scoreNorm;
          env.potential[s] = v;
        }
      });
    }
  }

  /** Run env i forward to the next learner decision, resetting finished matches. */
  private advance(i: number): void {
    for (;;) {
      const env = this.envs[i]!;
      if (env.idle) return;
      const s = env.state;
      const over = s.phase === 'gameEnd';
      if (over || env.steps >= this.opts.maxSteps) {
        this.endMatch(i, !over, false);
        if (this.opts.quota > 0 && env.episode + 1 >= this.opts.quota) {
          env.idle = true;
          return;
        }
        this.envs[i] = this.startMatch(i, env.episode + 1);
        continue;
      }
      const id = actingPlayer(s)!;
      const seat = s.players.findIndex((p) => p.id === id);
      const role = env.roles[seat]!;
      if (role !== 'learner' || isAutomaSeat(s, id)) {
        this.play(i, baselineActions(s, id, role === 'learner' ? 'greedy' : role, env.rng));
        continue;
      }
      const view = redact(s, id);
      const enc = encodeView(view, id);
      const cands = legalCandidates(view, id, enc.refs);
      if (cands.length === 0) throw new Error(`${id} has no candidate (phase ${s.phase}, pending ${s.pending[0]?.kind ?? 'none'})`);
      if (cands.length === 1) {
        env.forced++;
        this.play(i, cands[0]!.actions);
        continue;
      }
      env.seat = seat;
      env.shown = cands;
      return;
    }
  }

  private endMatch(i: number, truncated: boolean, aborted: boolean): void {
    const env = this.envs[i]!;
    const s = env.state;
    const breakdown = s.players.map((p) => scorePlayer(s, p));
    const R = this.batch.reward;
    s.players.forEach((_, k) => {
      if (env.roles[k] !== 'learner' || aborted) return;
      R[i * MAX_SEATS + k]! += (breakdown[k]!.total - this.opts.shaping * env.potential[k]!) / this.opts.scoreNorm;
    });
    this.batch.done[i] = 1;
    this.batch.episodes.push({
      env: i,
      seed: env.seed,
      players: s.automa ? 1 : s.players.length,
      roles: s.players.map((p, k) => (isAutomaSeat(s, p.id) ? 'automa' : env.roles[k]!)),
      scores: breakdown.map((b) => b.total),
      breakdown,
      decisions: env.decisions,
      forced: env.forced,
      steps: env.steps,
      truncated,
      fallbacks: env.fallbacks,
      aborted,
    });
  }

  private beginBatch(): void {
    this.batch.reward.fill(0);
    this.batch.done.fill(0);
    this.batch.episodes = [];
  }

  private finishBatch(): VecBatch {
    for (let i = 0; i < this.envs.length; i++) {
      this.guarded(i, () => this.writeRow(i), () => {
        this.advance(i);
        this.writeRow(i);
      });
    }
    return this.batch;
  }

  /** Encode env i's pending learner decision into row i of the batch. */
  private writeRow(i: number): void {
    const b = this.batch;
    const env = this.envs[i]!;
    b.seat[i] = env.seat;
    b.teacher[i] = -1;
    const K = MAX_CANDS;
    const T = NUM_TOKENS;
    b.candMask.fill(0, i * K, (i + 1) * K);
    if (env.idle || !env.shown) {
      b.role[i] = -1;
      return;
    }
    const s = env.state;
    const id = s.players[env.seat]!.id;
    const view = redact(s, id);
    encodeView(view, id, {
      global: b.global.subarray(i * GLOBAL_DIM, (i + 1) * GLOBAL_DIM),
      tokenIds: b.tokenIds.subarray(i * T, (i + 1) * T),
      tokenFeat: b.tokenFeat.subarray(i * T * TOKEN_DIM, (i + 1) * T * TOKEN_DIM),
      tokenMask: b.tokenMask.subarray(i * T, (i + 1) * T),
    });
    const cands = env.shown;
    b.candFeat.fill(0, i * K * CAND_DIM, (i + 1) * K * CAND_DIM);
    b.candSel.fill(0, i * K * T, (i + 1) * K * T);
    b.candPay.fill(0, i * K * T, (i + 1) * K * T);
    b.candTarget.fill(-1, i * K, (i + 1) * K);
    cands.forEach((c, k) => {
      b.candFeat.set(c.feat, (i * K + k) * CAND_DIM);
      for (const t of c.sel) {
        const at = (i * K + k) * T + t;
        b.candSel[at] = Math.min(255, b.candSel[at]! + 1);
      }
      for (const t of c.pay) {
        const at = (i * K + k) * T + t;
        b.candPay[at] = Math.min(255, b.candPay[at]! + 1);
      }
      b.candTarget[i * K + k] = c.target;
      b.candMask[i * K + k] = 1;
    });
    b.role[i] = 0;
    if (this.opts.teacher) b.teacher[i] = heuristicIndex(view, id, cands);
  }
}

function validate(o: VecEnvOptions): void {
  if (!ROLES.includes(o.opponents)) throw new Error(`unknown opponents role ${JSON.stringify(o.opponents)}`);
  if (!o.players.length || o.players.some((n) => !(Number.isInteger(n) && n >= 1 && n <= MAX_SEATS))) {
    throw new Error(`players must be table sizes 1-${MAX_SEATS}, got ${JSON.stringify(o.players)}`);
  }
  if (!(o.scoreNorm > 0)) throw new Error('scoreNorm must be positive');
}
