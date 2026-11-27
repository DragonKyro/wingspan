// Score benchmark for the Wyrmspan agents (heuristic / greedy / random).
//
//   npm run wyrm:bench                          # default sweep, 200 games per row
//   npm run wyrm:bench -- --games 400 --players 2 --lineup heuristic,greedy
//   npm run wyrm:bench -- --games 200 --players 1 --lineup heuristic --automa 3 --ravel
//
// Each row plays `--games` deals; with a lineup, agent k sits in seat k and the
// lineup rotates one seat per game so every agent visits every seat. Reported
// per agent: mean final score with a 95% interval, plus seconds per game.
// Solo (players 1) is vs Automa (`--automa` level 1-3, `--ravel` for Ravel
// Mode): Automa's score and the player's win rate (ties go to the player) too.
// --weights '{…}' plays the heuristic with a partial WEIGHTS patch.

import { scorePlayer } from '@/wyrmspan/scoring';
import { DEFAULT_WEIGHTS, setWeights } from '@/wyrmspan/heuristic/heuristic';
import { type BaselineAgent, BASELINE_AGENTS, isAutomaSeat, playBaselines } from '@/wyrmspan/heuristic/play';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : dflt;
};
const games = Number(opt('games', '200'));
const seed0 = Number(opt('seed', '9000001'));
// Solo: Automa's level (1-3) and Ravel Mode.
const automaDifficulty = Number(opt('automa', '1')) as 1 | 2 | 3;
const ravelMode = args.includes('--ravel');
if (![1, 2, 3].includes(automaDifficulty)) throw new Error('--automa must be 1, 2 or 3');
// The heuristic's weights: the shipped ones, or a partial patch (JSON) over them.
setWeights(JSON.parse(opt('weights', '{}')), DEFAULT_WEIGHTS);

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
  const automa: number[] = [];
  let wins = 0;
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    // Rotate the lineup so every agent visits every seat.
    const agents = Array.from({ length: seats }, (_, k) => lineup[(k + g) % lineup.length]!);
    const s = playBaselines(seed0 + g, players, agents, { automaDifficulty, ravelMode });
    if (players === 1 && s.winners?.includes('p1')) wins++;
    s.players.forEach((p, k) => {
      if (isAutomaSeat(s, p.id)) {
        automa.push(scorePlayer(s, p).total);
        return;
      }
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
  if (automa.length) {
    const { mean, ci } = stats(automa);
    parts.push(`Automa ${mean.toFixed(1)} ± ${ci.toFixed(1)}, won ${((100 * wins) / games).toFixed(0)}%`);
  }
  const level = players === 1 ? ` (Automa ${ravelMode ? 'Ravel ' : ''}L${automaDifficulty})` : '';
  console.log(`${players}p [${lineup.join(', ')}]${level}`.padEnd(42) + parts.join(' | ') + `   ${(secs / games).toFixed(3)} s/game`);
}
