// Score benchmark for the baseline Wyrmspan agents (no network involved).
//
//   npm run wyrm:bench                          # default sweep, 200 games per row
//   npm run wyrm:bench -- --games 400 --players 2 --lineup heuristic,greedy
//
// Each row plays `--games` deals; with a lineup, agent k sits in seat k and the
// lineup rotates one seat per game so every agent visits every seat. Reported
// per agent: mean final score with a 95% interval, plus seconds per game.
// Solo (players 1) is vs Automa; only the player's score is reported.

import { scorePlayer } from '@/wyrmspan/scoring';
import { type BaselineAgent, BASELINE_AGENTS, isAutomaSeat, playBaselines } from '@/wyrmspan/nn/play';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt;
};
const games = Number(opt('games', '200'));
const seed0 = Number(opt('seed', '9000001'));

function parseLineup(s: string): BaselineAgent[] {
  const out = s.split(',').map((x) => x.trim()) as BaselineAgent[];
  for (const a of out) if (!BASELINE_AGENTS.includes(a)) throw new Error(`unknown agent ${a}`);
  return out;
}

const rows: { players: number; lineup: BaselineAgent[] }[] = args.includes('--lineup')
  ? [{ players: Number(opt('players', '2')), lineup: parseLineup(opt('lineup', 'heuristic,greedy')) }]
  : [
      { players: 1, lineup: ['heuristic'] },
      { players: 1, lineup: ['greedy'] },
      { players: 1, lineup: ['random'] },
      { players: 2, lineup: ['heuristic', 'greedy'] },
      { players: 2, lineup: ['heuristic', 'heuristic'] },
      { players: 2, lineup: ['greedy', 'greedy'] },
      { players: 3, lineup: ['heuristic', 'greedy', 'greedy'] },
      { players: 4, lineup: ['heuristic', 'greedy', 'greedy', 'greedy'] },
    ];

const stats = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean: m, ci: (1.96 * sd) / Math.sqrt(xs.length), sd };
};

for (const { players, lineup } of rows) {
  const seats = players === 1 ? 1 : players;
  const scores = new Map<BaselineAgent, number[]>();
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    // Rotate the lineup so every agent visits every seat.
    const agents = Array.from({ length: seats }, (_, k) => lineup[(k + g) % lineup.length]!);
    const s = playBaselines(seed0 + g, players, agents);
    s.players.forEach((p, k) => {
      if (isAutomaSeat(s, p.id)) return;
      const list = scores.get(agents[k]!) ?? [];
      list.push(scorePlayer(s, p).total);
      scores.set(agents[k]!, list);
    });
  }
  const secs = (performance.now() - t0) / 1000;
  const parts = [...scores.entries()].map(([a, xs]) => {
    const { mean, ci, sd } = stats(xs);
    return `${a.padEnd(9)} ${mean.toFixed(1).padStart(5)} ± ${ci.toFixed(1)} (sd ${sd.toFixed(1)}, n ${xs.length})`;
  });
  console.log(`${players}p [${lineup.join(', ')}]`.padEnd(42) + parts.join(' | ') + `   ${(secs / games).toFixed(3)} s/game`);
}
