# training/

Offline tooling for a learned Wyrmspan agent. Nothing here ships to GitHub
Pages: it runs the real engine headlessly for a Python learner (PyTorch) to
train against and be evaluated with. Modeled on the sibling `catan` project's
`training/` (same bridge protocol, same PPO-with-imitation-warm-start layout).

**Objective: the agent's own final score**, not win rate. Wyrmspan has little
player interaction, so the network sees the general game state and its own
position, but no opponent detail beyond table size, who has passed, and the
public objective race.

The game-side pieces live in `src/wyrmspan/nn/` (see AGENTS.md):

| File | Role |
|---|---|
| `view.ts` | the information boundary: `redact(state, me)` replaces every hidden location (deck order, opponents' hands, others' setup offers, face-down tucked cards, Automa's deck, the RNG) with a canonical arrangement of the public pool; `determinize` deals that pool at random for lookahead |
| `encode.ts` | global vector (395) + 41 card tokens (12 mat spaces, 16 hand, 3 + 3 displays, 6 pending-shown cards, 1 resolving-ability card), each a card index + 42 context floats |
| `cardFeatures.ts` | static per-card table (74 floats per card: cost, VP, size, personality, caves, ability-AST summary, …) + `summarizeSteps` for ability ASTs |
| `candidates.ts` | the action space: every decision is a pick among ≤ 64 legal candidates (concrete engine action sequences, with features and the tokens they pick, spend and target), offering every choice the rules leave to the player: display-or-deck card gains, payment mixes (resources / cards / eggs / items / tithes), free-play placement, which card is tucked where, declining optional ability steps, exchanges before a payment |
| `heuristic.ts` | the benchmark AI (below) |
| `rules.ts`, `play.ts` | derived rules (affordability with exchanges, explore yield) and match plumbing / baseline agents |

## Setup

Uses the `train` conda env (Python 3.11, PyTorch CUDA, numpy, tensorboard,
pytest), e.g. `C:\ProgramData\anaconda3\envs\train`. Activate it: running
its `python.exe` directly skips the env's DLL path, and CUDA then fails with
"Cannot load symbol cudnnGetVersion".

```sh
conda activate train
npm run train:build                                  # bundle the TS side → training/dist/wyrmspan-env.mjs
python -m pytest training/wyrmspan -q                # shapes, export, bridge, paired eval, tiny train → resume → eval
python training/wyrmspan/env_client.py --players 1 2 # random-agent smoke test of the Python ↔ Node bridge
npm run wyrm:bench                                   # baseline agents' scores (no network)
```

`train.py` rebuilds `training/dist` itself at start (skip with `--no-build`).

## The benchmark heuristic

`heuristic.ts` is a one-ply lookahead over the agent's own candidate list.
Each candidate is applied to a determinized copy of the player's redacted view
(it never sees the real deck), the player's follow-up choices are resolved
value-greedily, and the result is scored with `positionValue`: the points the
game would award now, plus what isn't points yet. That is priced at a strong
player's rule-of-thumb exchange rate early (coin 3, guild advance 2, resource /
egg / card 1), decaying to end-game worth (coin 1, resource / card ¼). A
dragon's worth counts its ability for every activation still expected.
Weights are in `WEIGHTS` (the benchmark can sweep them). Its pick is also the
imitation label.

Baseline scores (`npm run wyrm:bench`, 100 games per row, Academy on):

| table | heuristic | greedy (in-app AI) | random |
|---|---:|---:|---:|
| solo vs Automa | 65.4 ± 2.3 | 37.5 ± 2.7 | 28.0 ± 1.4 |
| 2p vs greedy | 70.2 ± 2.2 | 38.9 ± 2.3 | |
| 2p self-play | 68.7 ± 1.6 | 40.9 ± 1.9 | |
| 3p vs 2 greedy | 68.3 ± 2.6 | 39.4 ± 2.0 | |
| 4p vs 3 greedy | 67.6 ± 2.3 | 40.4 ± 1.7 | |

(After the rules audit: display-or-deck card gains, payment choices,
exchanges at any point, etc. Heuristic: ~1.9 s per game.)

For scale: a human beginner (< 10 games) scores ~80; good players
consistently exceed 100. So the heuristic is a floor for the network to
clear, not a strong player. It plays ~25 turns a game but only ~5 entices
(~6 dragons on the mat), and explores shallow caves. Re-run after changing
`WEIGHTS`; the heuristic is deterministic per deal, so differences of a few
points on 100 games are mostly noise (sd ≈ 12).

## Training

```sh
python training/wyrmspan/train.py --run main                    # Ctrl+C any time: saves, then exits
python training/wyrmspan/train.py --run main --resume           # carry on to --updates (default 3000)
python training/wyrmspan/train.py --run solo --players 1        # solo vs Automa only
python training/wyrmspan/train.py --run mix --players 1 2 3 4   # table sizes cycled per match
tensorboard --logdir training/runs
```

To stop a run you can't Ctrl+C, create an empty
`training/runs/wyrmspan/<run>/STOP`; it saves and exits after the current
update.

Each update collects `--rollout` (32) decisions from every match. Workers
(`--workers`, default cores − 4, max 12) come in two kinds:

- **self** (`--self-play`, 50%): every seat is the network, `--envs-per-worker` (32) matches.
- **heuristic**: one network seat, the rest heuristic, `--heuristic-envs` (2)
  matches. Heuristic seats are much slower to play, and workers step in
  lockstep, so fewer matches keep every step about as long. Measured at 2p,
  learner decisions/s per worker: self-play 735 (44 ms per 32-match step),
  self-play with teacher labels 248 (129 ms), vs heuristic 29 at 4 matches
  (137 ms per step).

**Reward**: final score / `--score-norm` (100), plus potential-based shaping
on the running score (`--shaping` 1.0): Δscore / 100 whenever it changes,
paid back at the end, so each match sums to (final − starting score) / 100
whatever the shaping (pinned by `vec-env.test.ts`). `--gamma` 1 (undiscounted
points), `--lam` 0.95. The value head predicts remaining score.

**Imitation first**: the first `--bc-updates` (30) learn to copy the heuristic
(the env labels every learner decision with its pick). The heuristic plays
those moves at first; in the last `--bc-dagger` (40%) the network plays its
own (DAgger). Then PPO, plus a pull toward the heuristic's pick (`--bc-anchor`
0.2) fading to 0 over `--bc-anchor-updates` (200). Labels stop being computed
after that.

The network (`model.py`): card tokens (static card table row ‖ learned card
embedding ‖ context) and a global token through `--layers` (2) transformer
layers at `--width` (128); each candidate is an MLP of its features plus the
mean of the tokens it selects plus the mat token it targets, scored against
the trunk (pointer-style); value head on the trunk. ~0.65M parameters.

### What it reports

One line per update:

```
u   412 PPO|   4.71M dec | 2900/s | pi -0.004 v 0.0021 ent 1.10 kl 0.0061 clip 0.07 ev +0.58 | score heuristic 71.2 self 69.8 (heuristic seats 64.1) | 4.9s/u, ETA 3h50m
```

`score`: the learner's mean final score over its last `--window` (400)
matches per worker kind (sampling policy; trust the evals). PPO health: `kl`
(≲ 0.02), `clip` (≲ 0.2), `ent` (falls slowly), `ev` (value explained
variance, rises toward 1).

Every `--eval-every` (50) updates: `--eval-games` (200) greedy matches on
fixed eval deals (never trained on) vs heuristic opponents. Reported: the
policy's mean score ± 95% CI, the heuristic's score playing **the same seats
on the same deals** (played once per run, cached in `baseline.json`), and the
paired difference. That's the number to watch: **> 0 means the network
outscores the benchmark**. Results go to `evals.jsonl`, tensorboard `eval/*`,
and `progress.md`:

| update | hours | decisions | score (95% CI) | heuristic | vs heuristic (95% CI) | better deals |
|---:|---:|---:|---:|---:|---:|---:|

| Path | What |
|---|---|
| `progress.md` | the eval table |
| `metrics.jsonl`, `tb/` | per-update losses, entropy, KL, explained variance, throughput, training scores |
| `evals.jsonl`, `baseline.json` | every eval result; the heuristic's eval-deal episodes |
| `config.json` | arguments, encoder / action-space versions, architecture |
| `ckpt/update_N.pt` | resumable checkpoints (newest `--keep-ckpt`, plus every `--keep-every`) |

## Evaluating

```sh
python training/wyrmspan/evaluate.py match training/runs/wyrmspan/main --vs heuristic --games 400
python training/wyrmspan/evaluate.py match training/runs/wyrmspan/main@1500 --vs training/runs/wyrmspan/main@500
python training/wyrmspan/evaluate.py match heuristic --vs random --players 1 2 3 4
```

Agents: `heuristic`, `random`, a checkpoint `.pt`, a policy `.json`, a run
directory (its latest checkpoint), or `RUN@N`. Agent A takes one seat
(rotating); every other seat is `--opponents` (default heuristic). With
`--vs B`, B plays the same deals in the same seats and the paired score
difference is reported.

How close a checkpoint is to the heuristic it imitates, per decision kind:

```sh
python training/wyrmspan/diagnose.py training/runs/wyrmspan/main@150 --games 96
```

Every learner decision carries the heuristic's value of every candidate
(`teacherValue`). Reported: agreement, top-3, and *regret* — the heuristic's
value of its own pick minus its value of the network's pick. Regret is in the
heuristic's points; summed per game it overstates the real score gap, so read
it relatively. Also reported: how many labels are near-ties, and how many have
an input-identical twin. Both run with the network playing (its own states) and
with the heuristic playing (the imitation data's states).

## Versioning

`ENCODER_VERSION` (`encode.ts`) and `ACTION_SPACE_VERSION` (`candidates.ts`)
are pinned with every feature size by `src/wyrmspan/nn/nn.test.ts`.
Checkpoints and policy files record both and refuse to load on a mismatch, so
retrain after changing either.

## Not done yet

- No training has been run; no policy ships in the app.
- No TypeScript runtime for the network yet (`export_policy` writes the
  weights in the same JSON format catan's `runtime.ts` reads, ready for a port).
