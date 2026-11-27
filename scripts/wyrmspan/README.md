# Wyrmspan heuristic tools

The app's Wyrmspan AI is the heuristic in `src/wyrmspan/heuristic/` (see
AGENTS.md, "Wyrmspan heuristic AI"). These scripts measure and tune it.

| command | what |
|---|---|
| `npm run wyrm:bench` | scores of the heuristic / greedy / random agents, per table size; solo vs any Automa level |
| `npm run wyrm:tune -- --configs FILE` | paired comparison of `WEIGHTS` configs (same deals, same seats) |
| `npm run wyrm:time -- --configs FILE` | decision time of `WEIGHTS` configs on the same positions |
| `npx vite-node scripts/wyrmspan/value-data.ts` / `value-fit.ts` | does a learned evaluation predict final scores better? |

Outputs go to `scripts/wyrmspan/runs/` (gitignored).

## Benchmark

```sh
npm run wyrm:bench                                     # the default rows, 200 games each
npm run wyrm:bench -- --games 400 --players 2 --lineup heuristic,greedy
npm run wyrm:bench -- --games 150 --players 1 --lineup heuristic --automa 3 --ravel
```

With a lineup, agent k sits in seat k and the lineup rotates one seat per
game. Solo (players 1) is vs Automa (`--automa` 1–3, `--ravel`): Automa's score
and the win rate are reported too (ties go to the player). `--weights '{…}'`
plays a partial `WEIGHTS` patch. Scores (100 games per row, 200 in self-play,
150 solo; Academy on; same deals for every column):

| table | heuristic | (2026-11-18) | (hand-set) | greedy (engine AI) | random |
|---|---:|---:|---:|---:|---:|
| solo vs Automa L1 | 75.2 ± 2.3 | 71.8 | 65.4 | 37.5 ± 2.7 | 28.0 ± 1.4 |
| 2p vs greedy | 80.1 ± 2.2 | 75.8 | 70.2 | 38.6 ± 2.3 | |
| 2p self-play | 77.4 ± 1.6 | 72.9 | 68.7 | 40.9 ± 1.9 | |
| 3p vs 2 greedy | 80.3 ± 2.4 | 75.7 | 68.3 | 38.7 ± 1.9 | |
| 4p vs 3 greedy | 79.0 ± 2.0 | 74.4 | 67.6 | 40.7 ± 1.6 | |

Against the Automa (150 games each, same deals):

| Automa | heuristic | Automa | heuristic wins | (2026-11-23 weights) |
|---|---:|---:|---:|---:|
| Level 1 | 75.2 ± 2.3 | 80.5 ± 0.7 | **33%** | 71.0 / 23% |
| Level 2 | 73.8 ± 2.1 | 92.2 ± 0.6 | 9% | 68.5 / 5% |
| Level 3 | 72.1 ± 2.3 | 105.4 ± 0.7 | 3% | 68.0 / 0% |
| Ravel Level 1 | 73.4 ± 1.8 | 94.9 ± 1.2 | 8% | 68.8 / 3% |
| Ravel Level 2 | 73.9 ± 2.2 | 105.9 ± 1.5 | 2% | 67.5 / 0% |
| Ravel Level 3 | 71.2 ± 1.9 | 114.5 ± 1.5 | 0% | 67.3 / 0% |

For scale: a human beginner (< 10 games) scores ~80; good players
consistently exceed 100. Scores vary a lot by deal (sd ≈ 11), so differences
of a few points on 100 games are noise — use the tuner's paired comparison.

## Decision time

```sh
npm run wyrm:time -- --configs scripts/wyrmspan/tune/example.json --games 3
```

Records every decision position of `--games` 2p games of the shipped
heuristic, then times each config on all of them, single-threaded: mean ms
per decision, and mean / p95 per turn decision (where the plan search runs).
The shipped weights: ~47 ms a decision, ~145 ms a turn decision (p95 ~0.45 s)
— ~1.2× the 2026-11-18 weights. Timings drift ±15% with machine load between
runs; compare ratios within one run.

## Tuning the weights

```sh
npm run wyrm:tune -- --configs scripts/wyrmspan/tune/example.json --games 600 --jobs 12
```

A config file lists `{ "name", "weights" }` entries, partial `WEIGHTS` deep-merged
over the reference (`--base`, default the shipped weights; open maps such as
`partScale` are replaced whole). Each config takes one seat, rotating; the
other seats play the reference. Its pair is the reference in the same seat on
the same deal, so the difference is paired (sd ≈ 10 per game: 600 games ≈
±0.8). `--pair NAME` pairs against another config; `--players N` picks the
table size (1 = solo). Games are cached in `scripts/wyrmspan/runs/tune/games.jsonl`,
so reruns and repeated configs are free; each run also writes
`<configs>.results.json`. **Re-test a sweep's winner on fresh deals (`--seed`)**:
the best of many configs is partly luck (2026-11-25: +2.2 in its own sweep,
−0.5 on fresh deals).

### 2026-11-18: weights (from the hand-set weights, 2p, ±95%)

| change | vs before |
|---|---:|
| two-turn plan on the best 6 turn moves (`planBeam` 6; 3: −1.2, 10: +0.2 at 2× the time) | +3.2 ± 1.0 |
| + early coin 2.5, guild 2.5 (from a strong player's 3 / 2), `walkIcon` 1.5 | +1.7 ± 1.1 |
| + `endGameUnits` 2 (was 3; 5: −2.3, 7: −3.8) | +1.4 ± 0.7 |
| **all of it, fresh deals** — solo / 2p / 3p | **+6.5 ± 1.3 / +6.3 ± 0.8 / +5.5 ± 1.2** |
| no effect (±1): 3 determinized worlds averaged, follow-up budget, explore / adventurer rates, egg slot, objectives, end bias, plays per round, card / resource value, cheaper ability costs, cheaper spare resources | |
| worse: hand share 0.15 / 0.5 (−2.9 / −1.9), walk icon 0.5 (−1.3) | |

The configs are in git history at commit 4300fa4.

### 2026-11-25: deeper plans and a learned evaluation (from the 11-18 weights, 2p)

**Plan search over major decisions** (own turns; each turn scores every move,
follows only its best `deepBeam`; `dedupeFrom` collapses payment variants;
`deepBudget` = follow-up effort deep in the plan). Pooled over two sweeps of
600 games each, 3–4 turns ahead is worth only **+0.5 to +1**; 5 turns adds
nothing over 4. The gain is in printed dragon points — excavate → explore for
resources → entice chains — not in engines.

**Learned evaluation** (`value-data.ts` + `value-fit.ts`, 30k turn-start
positions from 600 self-play games, 125 held out):

| predicting the final score | RMSE | R² |
|---|---:|---:|
| `positionValue` as is | 11.0 | 0.08 |
| calibrated per round | 9.7 | 0.28 |
| its parts re-weighted per round (ridge) | 8.8 | 0.41 |
| + raw counts (eggs, caches, tucks, dragons by ability type…) | 8.8 | 0.41 |
| a 64×64 MLP on the same features | 8.7 | 0.42 |

The fit says the potential parts are overpriced (hand ≈ 0, cave walks 0.2–0.6,
engines 0.3–0.75 of their value) and resources, late coins, egg room and guild
underpriced. Played (`partScale`, multipliers per part and round):

| evaluation | vs the 11-18 weights |
|---|---:|
| fully fitted | **−5.7 ± 1.1** — fewer eggs, caches and tucks |
| halfway between 1 and fitted | +1.7 ± 1.0 |
| quarter / 0.4 of the way | +2.0 / +1.9 |

Better prediction is not better play: the fit learns that engine potential
adds little final score *because* the heuristic already acts on it, so used
fully it stops building engines. A value network would have to be trained in
the loop with the search (AlphaZero-style) to avoid that; an MLP on these
features fits no better than the linear model.

**Both together** (1000 fresh deals each; time = decision time vs the 11-18 weights):

| config | vs the 11-18 weights | time |
|---|---:|---:|
| halfway evaluation + 3-turn plan, root 8, deep beam 3, follow-ups 8 deep | +3.1 ± 0.8 | 1.95× |
| **halfway evaluation + 3-turn plan, root 8, deep beam 3, greedy follow-ups deep (shipped)** | **+2.7 ± 0.8** | **1.23×** |
| quarter evaluation + the 1.95× plan | +2.6 ± 0.8 | 2.04× |
| halfway evaluation + 3-turn plan, root 6, deep beam 3, follow-ups 8 deep | +2.6 ± 0.8 | 1.65× |
| halfway evaluation + 3-turn plan, root 6, deep beam 2, greedy follow-ups | +2.3 ± 0.8 | 0.91× |

The shipped config on other tables: **+3.7 ± 1.2 solo** (400 games vs Automa
L1), **+3.2 ± 1.2 in 3p** (450 games). The evaluation and the search help each
other: the search alone was +0.7, the evaluation alone +1.7, both +2.7.

The shipped config is the `WEIGHTS` defaults; the sweep configs and run
outputs weren't kept (regenerate positions with `value-data.ts`).

Converter engines (cache / tuck / end-game counters) remain the weak spot.
