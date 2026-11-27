// How well does the heuristic's positionValue predict the final score — and
// would a learned evaluation do better? Fits on value-data.ts positions.
//
//   npx vite-node scripts/wyrmspan/value-fit.ts -- scripts/wyrmspan/runs/value/*.jsonl
//
// Games are split train / test by seed (1 in 5 to test). Each model predicts
// the deciding player's final score from a turn-start position; reported on the
// test games: RMSE and R², overall and per round.
//
//   positionValue    the hand-written evaluation as is (points now + priced potential)
//   calibrated       a + b × positionValue, per round
//   parts            its parts re-weighted, per round (ridge) — a linear value function
//   parts + counts   … plus raw counts (eggs, caches, tucks, dragons by ability type, …)
//
// If the learned weightings predict much better, the hand-written one misprices
// something and a learned value at the search's leaves could play better; the
// per-round weights (parts model) are written next to the data for plugging in.

import { readFileSync, writeFileSync } from 'node:fs';

interface Row { seed: number; seat: number; round: number; parts: Record<string, number>; raw: Record<string, number>; final: number }

const files = process.argv.slice(2).filter((a) => a !== '--');
if (!files.length) throw new Error('usage: value-fit.ts FILE.jsonl …');
const rows: Row[] = files.flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row));
const isTest = (seed: number) => ((Math.imul(seed, 2654435761) >>> 0) % 5) === 0;
const train = rows.filter((r) => !isTest(r.seed));
const test = rows.filter((r) => isTest(r.seed));
const partKeys = [...new Set(rows.flatMap((r) => Object.keys(r.parts)))].sort();
const rawKeys = [...new Set(rows.flatMap((r) => Object.keys(r.raw)))].sort();
const rounds = [...new Set(rows.map((r) => r.round))].sort();
const games = (rs: Row[]) => new Set(rs.map((r) => r.seed)).size;
console.log(`${rows.length} positions: ${train.length} train (${games(train)} games), ${test.length} test (${games(test)} games)`);

const pv = (r: Row) => partKeys.reduce((a, k) => a + (r.parts[k] ?? 0), 0);

/** Ridge regression on standardized features (intercept unpenalized); returns a predictor. */
function ridge(X: number[][], y: number[], lambda = 1): (x: number[]) => number {
  const n = X.length;
  const d = X[0]!.length;
  const mu = Array.from({ length: d }, (_, j) => X.reduce((a, x) => a + x[j]!, 0) / n);
  const sd = Array.from({ length: d }, (_, j) => Math.sqrt(X.reduce((a, x) => a + (x[j]! - mu[j]!) ** 2, 0) / n) || 1);
  const ym = y.reduce((a, b) => a + b, 0) / n;
  const Z = X.map((x) => x.map((v, j) => (v - mu[j]!) / sd[j]!));
  // (ZᵀZ + λI) w = Zᵀ(y − ȳ)
  const A = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => Z.reduce((a, z) => a + z[i]! * z[j]!, 0) + (i === j ? lambda : 0)));
  const b = Array.from({ length: d }, (_, i) => Z.reduce((a, z, k) => a + z[i]! * (y[k]! - ym), 0));
  const w = solve(A, b);
  return (x) => ym + x.reduce((a, v, j) => a + ((v - mu[j]!) / sd[j]!) * w[j]!, 0);
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / piv;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  return M.map((row, i) => row[n]! / (row[i]! || 1e-12));
}

type Model = (r: Row) => number;
const perRound = (features: (r: Row) => number[]): Model => {
  const fits = new Map(rounds.map((rd) => {
    const rs = train.filter((r) => r.round === rd);
    return [rd, ridge(rs.map(features), rs.map((r) => r.final))] as const;
  }));
  return (r) => fits.get(r.round)!(features(r));
};

const models: [string, Model][] = [
  ['positionValue', pv],
  ['calibrated', perRound((r) => [pv(r)])],
  ['parts', perRound((r) => partKeys.map((k) => r.parts[k] ?? 0))],
  ['parts + counts', perRound((r) => [...partKeys.map((k) => r.parts[k] ?? 0), ...rawKeys.map((k) => r.raw[k] ?? 0)])],
];

const metrics = (m: Model, rs: Row[]) => {
  const y = rs.map((r) => r.final);
  const ym = y.reduce((a, b) => a + b, 0) / y.length;
  const sse = rs.reduce((a, r) => a + (m(r) - r.final) ** 2, 0);
  const sst = y.reduce((a, v) => a + (v - ym) ** 2, 0);
  const bias = rs.reduce((a, r) => a + m(r) - r.final, 0) / rs.length;
  return { rmse: Math.sqrt(sse / rs.length), r2: 1 - sse / sst, bias };
};

console.log(`\n${'model'.padEnd(16)} ${'RMSE'.padStart(6)} ${'R²'.padStart(6)} ${'bias'.padStart(6)}   per round: RMSE (R²)`);
for (const [name, m] of models) {
  const all = metrics(m, test);
  const by = rounds.map((rd) => {
    const x = metrics(m, test.filter((r) => r.round === rd));
    return `r${rd} ${x.rmse.toFixed(1)} (${x.r2.toFixed(2)})`;
  });
  console.log(`${name.padEnd(16)} ${all.rmse.toFixed(2).padStart(6)} ${all.r2.toFixed(3).padStart(6)} ${all.bias.toFixed(1).padStart(6)}   ${by.join('  ')}`);
}

// The parts model's weights in raw units (1 = as the hand-written evaluation counts it).
console.log('\nparts model: per-round weight of each part (hand-written = 1)');
const weights: Record<number, Record<string, number>> = {};
for (const rd of rounds) {
  const rs = train.filter((r) => r.round === rd);
  const f = ridge(rs.map((r) => partKeys.map((k) => r.parts[k] ?? 0)), rs.map((r) => r.final));
  const zero = partKeys.map(() => 0);
  const w0 = f(zero);
  weights[rd] = Object.fromEntries(partKeys.map((k, j) => {
    const x = zero.slice();
    x[j] = 1;
    return [k, f(x) - w0];
  }));
  weights[rd]!.intercept = w0;
}
console.log(`${'part'.padEnd(12)} ${rounds.map((rd) => `round ${rd}`.padStart(9)).join('')}`);
for (const k of [...partKeys, 'intercept']) console.log(`${k.padEnd(12)} ${rounds.map((rd) => weights[rd]![k]!.toFixed(2).padStart(9)).join('')}`);
const out = files[0]!.replace(/[^/\\]*$/, 'parts-weights.json');
writeFileSync(out, JSON.stringify(weights, null, 1));
console.log(`→ ${out}`);
