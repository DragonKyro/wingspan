// WyrmspanVecEnv: random learners against each kind of table, reward
// accounting (score-based, shaping sums to a constant), seat rotation, quotas
// and teacher labels.

import { describe, expect, it } from 'vitest';
import { nextRng } from '@/shared/rng';
import { CAND_DIM, MAX_CANDS } from '@/wyrmspan/nn/candidates';
import { GLOBAL_DIM } from '@/wyrmspan/nn/encode';
import { type Episode, MAX_SEATS, type VecBatch, type VecEnvOptions, WyrmspanVecEnv } from './vec-env';

/** Random picks among each row's real candidates. */
function randomPicks(b: VecBatch, rng: { s: number }): number[] {
  return Array.from(b.role, (_, i) => {
    let n = 0;
    while (n < MAX_CANDS && b.candMask[i * MAX_CANDS + n]) n++;
    const [u, next] = nextRng(rng.s);
    rng.s = next;
    return n ? Math.floor(u * n) : 0;
  });
}

/** Run until `episodes` matches end; returns them with each learner seat's summed reward. */
function run(opts: Partial<VecEnvOptions>, episodes: number) {
  const env = new WyrmspanVecEnv(opts);
  const n = opts.numEnvs ?? 4;
  const rng = { s: 7 };
  const totals = Array.from({ length: n }, () => new Array<number>(MAX_SEATS).fill(0));
  const out: { ep: Episode; reward: number[] }[] = [];
  let b = env.reset();
  for (let step = 0; out.length < episodes && step < 20000; step++) {
    for (let i = 0; i < n; i++) {
      for (let s = 0; s < MAX_SEATS; s++) totals[i]![s]! += b.reward[i * MAX_SEATS + s]!;
    }
    for (const ep of b.episodes) {
      out.push({ ep, reward: totals[ep.env]!.slice() });
      totals[ep.env]!.fill(0);
    }
    expect(b.global.every(Number.isFinite)).toBe(true);
    expect(b.candFeat.every(Number.isFinite)).toBe(true);
    for (let i = 0; i < n; i++) {
      if (b.role[i] < 0) continue;
      expect(b.candMask[i * MAX_CANDS]! + b.candMask[i * MAX_CANDS + 1]!).toBe(2); // ≥ 2 candidates reported
    }
    b = env.step(randomPicks(b, rng));
  }
  return { out, last: b };
}

describe('WyrmspanVecEnv', () => {
  it('plays random learners vs the greedy AI to the end with score rewards', () => {
    const { out } = run({ numEnvs: 4, players: [2], opponents: 'greedy', shaping: 1, scoreNorm: 100 }, 6);
    expect(out.length).toBeGreaterThanOrEqual(6);
    for (const { ep, reward } of out) {
      expect(ep.aborted).toBe(false);
      expect(ep.truncated).toBe(false);
      expect(ep.roles.filter((r) => r === 'learner')).toHaveLength(1);
      ep.roles.forEach((r, s) => {
        if (r !== 'learner') return;
        // Shaping is potential-based: the match pays exactly (final − starting score) / norm.
        const start = 7; // 6 coins + 1 egg on the mat
        expect(reward[s]!).toBeCloseTo((ep.scores[s]! - start) / 100, 4);
      });
    }
  }, 120_000);

  it('rotates the learner seat, plays solo vs Automa, and self-play makes every seat a learner', () => {
    const solo = run({ numEnvs: 2, players: [1], opponents: 'greedy' }, 2).out;
    for (const { ep } of solo) expect(ep.roles).toEqual(['learner', 'automa']);
    const selfPlay = run({ numEnvs: 2, players: [3], opponents: 'learner' }, 2).out;
    for (const { ep } of selfPlay) expect(ep.roles).toEqual(['learner', 'learner', 'learner']);
    const table = run({ numEnvs: 3, players: [3], opponents: 'greedy' }, 6).out;
    expect(new Set(table.map(({ ep }) => ep.roles.indexOf('learner'))).size).toBeGreaterThan(1);
  }, 120_000);

  it('labels learner rows with the heuristic, and idles envs once their quota is played', () => {
    const env = new WyrmspanVecEnv({ numEnvs: 2, players: [1], quota: 1, teacher: true });
    let b = env.reset();
    const rng = { s: 3 };
    let finished = 0;
    for (let step = 0; step < 5000 && b.role.some((r) => r >= 0); step++) {
      for (let i = 0; i < 2; i++) {
        if (b.role[i] < 0) continue;
        const t = b.teacher[i]!;
        expect(t).toBeGreaterThanOrEqual(0);
        expect(b.candMask[i * MAX_CANDS + t]).toBe(1);
      }
      finished += b.episodes.length;
      b = env.step(randomPicks(b, rng));
    }
    finished += b.episodes.length;
    expect(finished).toBe(2);
    expect(Array.from(b.role)).toEqual([-1, -1]);
    expect(b.global.length).toBe(2 * GLOBAL_DIM);
    expect(b.candFeat.length).toBe(2 * MAX_CANDS * CAND_DIM);
  }, 120_000);
});
