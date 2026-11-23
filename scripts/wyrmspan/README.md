# Wyrmspan heuristic tools

The app's Wyrmspan AI is the heuristic in `src/wyrmspan/heuristic/` (see
AGENTS.md, "Wyrmspan heuristic AI"). These scripts measure and tune it.

## Benchmark

```sh
npm run wyrm:bench                                     # the table below, 200 games per row
npm run wyrm:bench -- --games 400 --players 2 --lineup heuristic,greedy
```

With a lineup, agent k sits in seat k and the lineup rotates one seat per
game. Solo (players 1) is vs Automa. Scores (100 games per row, 200 in
self-play; Academy on; 2026-11-18 weights):

| table | heuristic | (before tuning) | greedy (engine AI) | random |
|---|---:|---:|---:|---:|
| solo vs Automa | 71.8 ± 2.1 | 65.4 | 37.5 ± 2.7 | 28.0 ± 1.4 |
| 2p vs greedy | 75.8 ± 1.8 | 70.2 | 38.6 ± 2.1 | |
| 2p self-play | 72.9 ± 1.6 | 68.7 | 40.9 ± 1.9 | |
| 3p vs 2 greedy | 75.7 ± 2.1 | 68.3 | 39.0 ± 1.9 | |
| 4p vs 3 greedy | 74.4 ± 2.5 | 67.6 | 40.9 ± 1.6 | |

Against the Automa (`--players 1 --lineup heuristic --automa N [--ravel]`,
150 games each, same deals, 2026-11-23) it doesn't win — ties go to the player:

| Automa | heuristic | Automa | heuristic wins |
|---|---:|---:|---:|
| Level 1 | 71.0 ± 2.0 | 80.7 ± 0.7 | 23% |
| Level 2 | 68.5 ± 1.9 | 92.0 ± 0.6 | 5% |
| Level 3 | 68.0 ± 1.8 | 105.4 ± 0.7 | 0% |
| Ravel Level 1 | 68.8 ± 1.9 | 93.4 ± 1.2 | 3% |
| Ravel Level 2 | 67.5 ± 1.7 | 102.8 ± 1.4 | 0% |
| Ravel Level 3 | 67.3 ± 1.8 | 111.5 ± 1.4 | 0% |

The heuristic takes ~55 ms a decision (~4.6 s per seat per game,
single-threaded). For scale: a human beginner (< 10 games) scores ~80; good
players consistently exceed 100. Scores vary a lot by deal (sd ≈ 11), so
differences of a few points on 100 games are noise — use the tuner's paired
comparison instead.

## Tuning the weights

```sh
npm run wyrm:tune -- --configs scripts/wyrmspan/tune/example.json --games 600 --jobs 12
```

A config file lists `{ "name", "weights" }` entries, partial `WEIGHTS` deep-merged
over the reference (`--base`, default the shipped weights). Each config takes
one seat, rotating; the other seats play the reference. Its pair is the
reference in the same seat on the same deal, so the difference is paired
(sd ≈ 10 per game: 600 games ≈ ±0.8). `--pair NAME` pairs against another
config; `--players N` picks the table size (1 = solo). Games are cached in
`scripts/wyrmspan/runs/tune/games.jsonl` (gitignored), so reruns and repeated
configs are free; each run also writes `<configs>.results.json` there.

What the 2026-11-18 sweep found (from the hand-set weights, 2p, ±95%; the
round logs are in `scripts/wyrmspan/runs/tune/`, the configs in git history at
commit 4300fa4):

| change | vs before |
|---|---:|
| two-turn plan on the best 6 turn moves (`planBeam` 6; 3: −1.2, 10: +0.2 at 2× the time) | +3.2 ± 1.0 |
| + early coin 2.5, guild 2.5 (from a strong player's 3 / 2), `walkIcon` 1.5 | +1.7 ± 1.1 |
| + `endGameUnits` 2 (was 3; 5: −2.3, 7: −3.8) | +1.4 ± 0.7 |
| **all of it, fresh deals** — solo / 2p / 3p | **+6.5 ± 1.3 / +6.3 ± 0.8 / +5.5 ± 1.2** |
| no effect (±1): 3 determinized worlds averaged, follow-up budget, explore / adventurer rates, egg slot, objectives, end bias, plays per round, card / resource value, cheaper ability costs, cheaper spare resources | |
| worse: hand share 0.15 / 0.5 (−2.9 / −1.9), walk icon 0.5 (−1.3) | |

Converter engines (cache / tuck / end-game counters) are still where it is
weakest — no valuation change fixed that; it can't plan an engine over several
rounds.
