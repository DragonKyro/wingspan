"""Score-based evaluation of Wyrmspan agents.

The metric is the agent's own final score (not wins). An agent takes one seat
(rotating match by match; solo = vs Automa) on a fixed set of eval deals never
trained on; every other seat is `--opponents` (default: the heuristic).
Networks play greedily (argmax).

Agents:
  heuristic     the benchmark heuristic (src/wyrmspan/nn/heuristic.ts) in the
                agent's seat — played by following the env's teacher label, so
                it sits in exactly the same seats on exactly the same deals
  random        a uniformly random candidate
  PATH          a checkpoint (.pt), a policy file (.json), a run directory
                (its latest checkpoint), or RUN@N (the checkpoint of update N)

Reported: mean score with a 95% interval, its spread, per table size, the
score breakdown, and — against a second agent on the same deals — the paired
score difference (same seeds, same seat) with its 95% interval.

    python training/wyrmspan/evaluate.py match training/runs/wyrmspan/main --games 400
    python training/wyrmspan/evaluate.py match training/runs/wyrmspan/main --vs heuristic --players 1 2 3 4
    python training/wyrmspan/evaluate.py match heuristic --vs random --games 200
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time

import numpy as np
import torch

from env_client import ROLE_LEARNER, WyrmspanEnv, random_picks
from model import check_versions, load_checkpoint, load_policy, net_from_checkpoint, to_tensors

EVAL_SEED = 777_000_001
BASELINES = ("heuristic", "random")
BREAKDOWN = ("printedDragonVp", "endGameAbilities", "eggs", "cached", "tucked", "objectives", "guildTile", "coins",
             "bonusVP", "leftovers")


def list_checkpoints(run_dir: str) -> list[tuple[int, str]]:
    d = os.path.join(run_dir, "ckpt")
    if not os.path.isdir(d):
        return []
    out = []
    for f in os.listdir(d):
        m = re.fullmatch(r"update_(\d+)\.pt", f)
        if m:
            out.append((int(m.group(1)), os.path.join(d, f)))
    return sorted(out)


def resolve(spec: str) -> str:
    """An agent spec → a baseline name or a checkpoint / policy file path."""
    if spec in BASELINES:
        return spec
    m = re.fullmatch(r"(.+)@(\d+)", spec)
    if m:
        path = os.path.join(m.group(1), "ckpt", f"update_{int(m.group(2)):06d}.pt")
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        return path
    if os.path.isdir(spec):
        ckpts = list_checkpoints(spec)
        if not ckpts:
            raise FileNotFoundError(f"{spec} has no ckpt/")
        return ckpts[-1][1]
    if not os.path.isfile(spec):
        raise FileNotFoundError(spec)
    return spec


def load_agent(spec: str, versions: dict, device: str):
    """A baseline name, or a WyrmspanNet in eval mode."""
    path = resolve(spec)
    if path in BASELINES:
        return path
    if path.endswith(".json"):
        return load_policy(path, versions, device)
    ckpt = load_checkpoint(path, device)
    check_versions(ckpt, versions, path)
    return net_from_checkpoint(ckpt, device).eval()


def greedy_picks(net, batch, device) -> np.ndarray:
    live = np.flatnonzero(batch.role == ROLE_LEARNER)
    picks = np.zeros(len(batch.role), np.int64)
    if len(live):
        with torch.no_grad():
            logits, _ = net(*to_tensors(batch.obs(live), device))
        picks[live] = logits.argmax(-1).cpu().numpy()
    return picks


def play(agent, games: int, players: list[int], opponents: str = "heuristic", workers: int = 4, envs_per_worker: int = 16,
         device: str = "cpu", seed: int = EVAL_SEED, envs: list[WyrmspanEnv] | None = None) -> list[dict]:
    """Play `games` eval matches (rounded up to fill every env) and return their episode summaries.
    The deal layout depends only on (games, players, workers, envs_per_worker, seed), so two agents
    evaluated with the same arguments meet the same deals in the same seats."""
    per_env = max(1, math.ceil(games / (workers * envs_per_worker)))
    n_envs = max(1, min(envs_per_worker, math.ceil(games / (workers * per_env))))
    own = envs is None
    envs = envs or [WyrmspanEnv() for _ in range(workers)]
    rng = np.random.default_rng(seed)
    episodes: list[dict] = []
    try:
        batches = [env.reset(num_envs=n_envs, seed=seed + 7919 * k, players=players, opponents=opponents, quota=per_env,
                             teacher=agent == "heuristic", shaping=0.0)
                   for k, env in enumerate(envs[:workers])]
        while True:
            live = [k for k, b in enumerate(batches) if (b.role >= 0).any()]
            if not live:
                break
            for k in live:
                b = batches[k]
                if agent == "heuristic":
                    picks = np.where(b.teacher >= 0, b.teacher, 0)
                elif agent == "random":
                    picks = random_picks(b.cand_mask, rng)
                else:
                    picks = greedy_picks(agent, b, device)
                envs[k].send_step(picks)
            for k in live:
                batches[k] = envs[k].recv_batch()
                episodes.extend(batches[k].episodes)
    finally:
        if own:
            for env in envs:
                env.close()
    return [ep for ep in episodes if not ep["aborted"]]


def _learner_rows(episodes: list[dict]):
    for ep in episodes:
        for seat, role in enumerate(ep["roles"]):
            if role == "learner":
                yield ep, seat


def summarize(episodes: list[dict]) -> dict:
    """Mean score (95% CI), spread, per table size, breakdown, and opponents' mean."""
    rows = list(_learner_rows(episodes))
    scores = np.array([ep["scores"][s] for ep, s in rows], dtype=np.float64)
    if not len(scores):
        return {"games": 0}
    opp = [x for ep, s in rows for k, x in enumerate(ep["scores"]) if k != s and ep["roles"][k] != "automa"]
    out = {
        "games": len(scores),
        "score": float(scores.mean()),
        "ci95": float(1.96 * scores.std(ddof=1) / math.sqrt(len(scores))) if len(scores) > 1 else 0.0,
        "sd": float(scores.std(ddof=1)) if len(scores) > 1 else 0.0,
        "opponents": float(np.mean(opp)) if opp else None,
        "byPlayers": {},
        "breakdown": {k: float(np.mean([ep["breakdown"][s][k] for ep, s in rows])) for k in BREAKDOWN},
        "truncated": int(sum(ep["truncated"] for ep in episodes)),
        "fallbacks": int(sum(ep["fallbacks"] for ep in episodes)),
    }
    for n in sorted({ep["players"] for ep, _ in rows}):
        xs = [ep["scores"][s] for ep, s in rows if ep["players"] == n]
        out["byPlayers"][str(n)] = {"games": len(xs), "score": float(np.mean(xs))}
    return out


def paired(a: list[dict], b: list[dict]) -> dict:
    """Score of A minus score of B on the deals both played (same seed, same seat)."""
    sb = {(ep["seed"], s): ep["scores"][s] for ep, s in _learner_rows(b)}
    diffs = np.array([ep["scores"][s] - sb[(ep["seed"], s)] for ep, s in _learner_rows(a) if (ep["seed"], s) in sb])
    if not len(diffs):
        return {"pairs": 0}
    ci = float(1.96 * diffs.std(ddof=1) / math.sqrt(len(diffs))) if len(diffs) > 1 else 0.0
    return {"pairs": len(diffs), "diff": float(diffs.mean()), "ci95": ci, "aBetter": float((diffs > 0).mean())}


def fmt(name: str, s: dict) -> str:
    if not s.get("games"):
        return f"{name}: no games"
    by = " ".join(f"{n}p {v['score']:.1f}" for n, v in s["byPlayers"].items())
    opp = f" | opponents {s['opponents']:.1f}" if s.get("opponents") is not None else ""
    return f"{name}: score {s['score']:.1f} ± {s['ci95']:.1f} (sd {s['sd']:.1f}, n {s['games']}) [{by}]{opp}"


def main(argv: list[str] | None = None) -> dict:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("match", help="score of agent A (and optionally B on the same deals)")
    m.add_argument("agent")
    m.add_argument("--vs", default=None, help="a second agent on the same deals (paired difference); e.g. heuristic")
    m.add_argument("--games", type=int, default=400)
    m.add_argument("--players", type=int, nargs="+", default=[2], help="table sizes, cycled (1 = solo vs Automa)")
    m.add_argument("--opponents", default="heuristic", choices=("heuristic", "greedy", "random"))
    m.add_argument("--workers", type=int, default=4)
    m.add_argument("--envs-per-worker", type=int, default=16)
    m.add_argument("--seed", type=int, default=EVAL_SEED)
    m.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    m.add_argument("--json", action="store_true", help="print the result as one JSON line")
    a = p.parse_args(argv)

    with WyrmspanEnv() as probe:
        versions = probe.versions
    t0 = time.perf_counter()
    kw = dict(games=a.games, players=a.players, opponents=a.opponents, workers=a.workers,
              envs_per_worker=a.envs_per_worker, device=a.device, seed=a.seed)
    ep_a = play(load_agent(a.agent, versions, a.device), **kw)
    result = {"agent": a.agent, "a": summarize(ep_a)}
    if a.vs:
        ep_b = play(load_agent(a.vs, versions, a.device), **kw)
        result.update({"vs": a.vs, "b": summarize(ep_b), "paired": paired(ep_a, ep_b)})
    result["seconds"] = time.perf_counter() - t0
    if a.json:
        print(json.dumps(result))
    else:
        print(fmt(a.agent, result["a"]))
        print("  breakdown " + " ".join(f"{k} {v:.1f}" for k, v in result["a"]["breakdown"].items()))
        if a.vs:
            print(fmt(a.vs, result["b"]))
            pr = result["paired"]
            print(f"paired {a.agent} − {a.vs}: {pr['diff']:+.1f} ± {pr['ci95']:.1f} points over {pr['pairs']} deals "
                  f"({100 * pr['aBetter']:.0f}% of deals better)")
        print(f"({result['seconds']:.0f}s)")
    return result


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
