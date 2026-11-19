// Paired tuning of the benchmark heuristic (WEIGHTS in src/wyrmspan/nn/heuristic.ts).
//
//   npm run train:build
//   node training/dist/wyrmspan-tune.mjs --configs training/wyrmspan/tune/round1.json --games 400 --jobs 12
//
// --configs is a JSON list of { "name": …, "weights": { …partial WEIGHTS… } }
// (deep-merged over --base). Each config plays one seat — rotating with the
// game index — and every other seat is the reference heuristic (--base: a JSON
// file of partial weights, default the shipped WEIGHTS). Its pair is the
// reference itself in that same seat on that same deal, so the reported
// difference (config − reference) is paired: same deals, seats and opponents.
//
// --pair NAME pairs every config with config NAME instead (same deals and seats),
// e.g. to measure each tweak on top of a new search depth.
//
// Every game is cached in --cache (jsonl, keyed by both weight sets, table size,
// seed and seat), so the reference games are played once and a rerun or a
// config repeated in a later round costs nothing. Results also go to --out.

import { fork, type ChildProcess } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WEIGHTS, type Weights, setWeights } from '@/wyrmspan/nn/heuristic';
import { actingPlayer, applyAll, baselineActions, isAutomaSeat, newMatch } from '@/wyrmspan/nn/play';
import { scorePlayer } from '@/wyrmspan/scoring';
import type { ScoreBreakdown } from '@/wyrmspan/types';

interface Task { key: string; weights: Weights; base: Weights; players: number; seed: number; seat: number }
interface Result { key: string; score: number; opponents: number; breakdown: ScoreBreakdown; secs: number }

const BREAKDOWN = ['printedDragonVp', 'endGameAbilities', 'eggs', 'cached', 'tucked', 'objectives', 'guildTile', 'coins', 'leftovers'] as const;

// ---------------------------------------------------------------- worker

function playTask(t: Task): Result {
  const t0 = performance.now();
  let s = newMatch(t.seed, t.players);
  for (let n = 0; s.phase !== 'gameEnd'; n++) {
    if (n > 6000) throw new Error(`seed ${t.seed}: no end after 6000 decisions`);
    const id = actingPlayer(s)!;
    const seat = s.players.findIndex((p) => p.id === id);
    if (!isAutomaSeat(s, id)) setWeights(seat === t.seat ? t.weights : t.base, t.base);
    s = applyAll(s, baselineActions(s, id, 'heuristic'));
  }
  const scores = s.players.map((p) => scorePlayer(s, p));
  const others = s.players.map((p, k) => ({ p, k })).filter(({ p, k }) => k !== t.seat && !isAutomaSeat(s, p.id));
  return {
    key: t.key,
    score: scores[t.seat]!.total,
    opponents: others.length ? others.reduce((a, { k }) => a + scores[k]!.total, 0) / others.length : NaN,
    breakdown: scores[t.seat]!,
    secs: (performance.now() - t0) / 1000,
  };
}

// ---------------------------------------------------------------- driver

function arg(name: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

function deepMerge(into: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in into)) throw new Error(`unknown weight ${k}`);
    const cur = into[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object') deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    else into[k] = JSON.parse(JSON.stringify(v));
  }
  return into;
}

const full = (patch: object, base: Weights): Weights => deepMerge(JSON.parse(JSON.stringify(base)), patch as Record<string, unknown>) as unknown as Weights;

/** Canonical JSON (sorted keys) → FNV-1a hex. */
function hash(x: unknown): string {
  const canon = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
  const s = JSON.stringify(canon(x));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
};

async function main(): Promise<void> {
  const configsPath = arg('configs');
  if (!configsPath) throw new Error('--configs FILE required');
  const configs = JSON.parse(readFileSync(configsPath, 'utf8')) as { name: string; weights: object }[];
  const basePath = arg('base');
  const base = full(basePath ? JSON.parse(readFileSync(basePath, 'utf8')) : {}, DEFAULT_WEIGHTS);
  const games = Number(arg('games', '400'));
  const players = Number(arg('players', '2'));
  const seed0 = Number(arg('seed', '31000001'));
  const jobs = Number(arg('jobs', String(Math.max(1, cpus().length - 4))));
  const here = dirname(fileURLToPath(import.meta.url));
  const cachePath = arg('cache', `${here}/../runs/wyrmspan/tune/games.jsonl`)!;
  const outPath = arg('out', `${dirname(cachePath)}/${basename(configsPath).replace(/\.json$/, '')}.results.json`)!;
  mkdirSync(dirname(cachePath), { recursive: true });

  const cache = new Map<string, Result>();
  if (existsSync(cachePath)) {
    for (const line of readFileSync(cachePath, 'utf8').split('\n')) if (line.trim()) {
      const r = JSON.parse(line) as Result;
      cache.set(r.key, r);
    }
  }

  // Every config (and the reference) on every deal, in the rotating seat.
  const all = [{ name: 'reference', weights: {} }, ...configs.filter((c) => c.name !== 'reference')];
  const baseHash = hash(base);
  const plan = all.map((c) => {
    const w = full(c.weights, base);
    const wh = hash(w);
    const tasks: Task[] = [];
    for (let g = 0; g < games; g++) {
      const seat = players === 1 ? 0 : g % players;
      tasks.push({ key: `${wh}:${baseHash}:${players}:${seed0 + g}:${seat}`, weights: w, base, players, seed: seed0 + g, seat });
    }
    return { name: c.name, patch: c.weights, tasks };
  });
  const todo = [...new Map(plan.flatMap((p) => p.tasks).filter((t) => !cache.has(t.key)).map((t) => [t.key, t])).values()];
  console.log(`${all.length} configs × ${games} games (${players}p): ${todo.length} to play, ${plan.length * games - todo.length} cached; ${jobs} jobs`);

  const t0 = performance.now();
  let done = 0;
  let failed = 0;
  await new Promise<void>((resolve) => {
    if (!todo.length) return resolve();
    let next = 0;
    let live = 0;
    const feed = (w: ChildProcess) => {
      if (next < todo.length) w.send(todo[next++]!);
      else {
        w.kill();
        if (--live === 0) resolve();
      }
    };
    for (let k = 0; k < Math.min(jobs, todo.length); k++) {
      const w = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
      live++;
      w.on('message', (m: { ok: boolean; result?: Result; key?: string; error?: string }) => {
        if (m.ok) {
          cache.set(m.result!.key, m.result!);
          appendFileSync(cachePath, JSON.stringify(m.result) + '\n');
        } else {
          failed++;
          process.stderr.write(`game ${m.key} failed: ${m.error}\n`);
        }
        done++;
        if (done % 200 === 0) {
          const el = (performance.now() - t0) / 1000;
          console.log(`  ${done}/${todo.length} games, ${(done / el).toFixed(1)}/s, ETA ${(((todo.length - done) * el) / done / 60).toFixed(1)} min`);
        }
        feed(w);
      });
      w.on('exit', (code) => {
        if (code && code !== 0) process.stderr.write(`worker exited ${code}\n`);
      });
      feed(w);
    }
  });

  // Paired summary against the reference (or --pair).
  const pairName = arg('pair', 'reference')!;
  const pairPlan = plan.find((p) => p.name === pairName);
  if (!pairPlan) throw new Error(`--pair ${pairName}: no such config`);
  const ref = new Map(pairPlan.tasks.map((t) => [`${t.seed}:${t.seat}`, cache.get(t.key)]));
  const rows = plan.map((p) => {
    const res = p.tasks.map((t) => ({ t, r: cache.get(t.key) })).filter((x): x is { t: Task; r: Result } => !!x.r);
    const pairs = res.map(({ t, r }) => ({ r, b: ref.get(`${t.seed}:${t.seat}`) })).filter((x): x is { r: Result; b: Result } => !!x.b);
    const diffs = pairs.map(({ r, b }) => r.score - b.score);
    const bd = Object.fromEntries(BREAKDOWN.map((k) => [k, mean(pairs.map(({ r, b }) => (r.breakdown[k] as number) - (b.breakdown[k] as number)))]));
    return {
      name: p.name, weights: p.patch, games: res.length,
      score: mean(res.map((x) => x.r.score)), opponents: mean(res.map((x) => x.r.opponents)),
      diff: mean(diffs), ci: (1.96 * sd(diffs)) / Math.sqrt(Math.max(1, diffs.length)),
      better: mean(diffs.map((d) => (d > 0 ? 1 : 0))), secsPerGame: mean(res.map((x) => x.r.secs)), breakdownDiff: bd,
      breakdown: Object.fromEntries(BREAKDOWN.map((k) => [k, mean(res.map((x) => x.r.breakdown[k] as number))])),
    };
  });
  writeFileSync(outPath, JSON.stringify({ players, games, seed: seed0, base, pair: pairName, rows }, null, 2));
  const fmt = (x: number, d = 1) => (x >= 0 ? '+' : '') + x.toFixed(d);
  const vs = `vs ${pairName.slice(0, 10)}`;
  console.log(`\n${'config'.padEnd(30)} ${'score'.padStart(6)} ${vs.padStart(13)} ${'better'.padStart(6)} ${'s/game'.padStart(7)}  breakdown ${vs}`);
  for (const r of [...rows].sort((a, b) => b.diff - a.diff)) {
    const bd = Object.entries(r.breakdownDiff).filter(([, v]) => Math.abs(v) >= 0.3).map(([k, v]) => `${k} ${fmt(v)}`).join(' ');
    console.log(`${r.name.padEnd(30)} ${r.score.toFixed(1).padStart(6)} ${(fmt(r.diff) + ' ± ' + r.ci.toFixed(1)).padStart(13)} ${(100 * r.better).toFixed(0).padStart(5)}% ${r.secsPerGame.toFixed(2).padStart(7)}  ${bd}`);
  }
  for (const name of new Set(['reference', pairName])) {
    const row = rows[plan.findIndex((p) => p.name === name)]!;
    console.log(`${name} breakdown: ` + Object.entries(row.breakdown).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' '));
  }
  console.log(`(${((performance.now() - t0) / 60000).toFixed(1)} min${failed ? `, ${failed} games failed` : ''}) → ${outPath}`);
}

// ---------------------------------------------------------------- entry

if (process.argv.includes('--worker')) {
  process.on('message', (t: Task) => {
    try {
      process.send!({ ok: true, result: playTask(t) });
    } catch (e) {
      process.send!({ ok: false, key: t.key, error: (e as Error).stack ?? String(e) });
    }
  });
} else {
  void main();
}
