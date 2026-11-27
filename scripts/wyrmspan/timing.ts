// Decision time of heuristic weight configs, on the same positions.
//
//   npm run wyrm:time -- --configs scripts/wyrmspan/tune/example.json --games 3
//
// Plays --games 2p games with the shipped heuristic in every seat, keeps every
// position where a player decides, then times each config's decision on all
// of them (single-threaded, one after another — so load affects all alike).
// Reported: mean ms per decision, mean and 95th-percentile ms per turn
// decision (the expensive kind: the plan search runs there), relative to the
// shipped weights.

import { readFileSync } from 'node:fs';
import { DEFAULT_WEIGHTS, heuristicActions, setWeights } from '@/wyrmspan/heuristic/heuristic';
import { actingPlayer, applyAll, baselineActions, isAutomaSeat, newMatch } from '@/wyrmspan/heuristic/play';
import type { GameState, PlayerId } from '@/wyrmspan/types';

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const configsPath = opt('configs');
if (!configsPath) throw new Error('--configs FILE required');
const configs = [{ name: 'shipped', weights: {} }, ...(JSON.parse(readFileSync(configsPath, 'utf8')) as { name: string; weights: object }[])];
const games = Number(opt('games', '3'));
const seed0 = Number(opt('seed', '51000001'));

const positions: { s: GameState; id: PlayerId; turn: boolean }[] = [];
for (let g = 0; g < games; g++) {
  let s = newMatch(seed0 + g, 2);
  while (s.phase !== 'gameEnd') {
    const id = actingPlayer(s)!;
    if (!isAutomaSeat(s, id)) positions.push({ s, id, turn: !s.pending.length });
    s = applyAll(s, baselineActions(s, id, 'heuristic'));
  }
}
const turns = positions.filter((p) => p.turn).length;
console.log(`${positions.length} positions (${turns} turn decisions) from ${games} games`);

let base = 0;
for (const c of configs) {
  setWeights(c.weights as never, DEFAULT_WEIGHTS);
  const all: number[] = [];
  const turn: number[] = [];
  for (const p of positions) {
    const t0 = performance.now();
    heuristicActions(p.s, p.id);
    const ms = performance.now() - t0;
    all.push(ms);
    if (p.turn) turn.push(ms);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const p95 = [...turn].sort((a, b) => a - b)[Math.floor(turn.length * 0.95)]!;
  if (!base) base = mean(all);
  console.log(`${c.name.padEnd(30)} ${mean(all).toFixed(1).padStart(6)} ms/decision (${(mean(all) / base).toFixed(2)}×) | turn ${mean(turn).toFixed(0).padStart(5)} ms, p95 ${p95.toFixed(0)} ms`);
}
setWeights();
