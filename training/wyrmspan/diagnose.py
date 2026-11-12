"""How far a network is from the heuristic it imitates, and what each disagreement costs.

Every learner decision is labelled with the heuristic's value of every candidate
(points, from its own one-ply lookahead on the redacted view). A disagreement's
*regret* is the heuristic's value of its own pick minus its value of the
network's pick: ~0 = a near-tie the label can't really distinguish, large = a
real mistake by the heuristic's judgement. Summed per game it is the points the
heuristic thinks the network gave away.

    python training/wyrmspan/diagnose.py training/runs/wyrmspan/main@30 --games 96
    python training/wyrmspan/diagnose.py training/runs/wyrmspan/main@30 --play heuristic

--play net        the network plays its own moves (where it actually ends up)
--play heuristic  the heuristic plays; the network's pick is only scored
                  (its accuracy on the imitation data's own states)

Reported per decision kind (pending step, or 'turn' split by the heuristic's verb):
share of decisions, agreement, regret per game, and how ambiguous the labels are
(another candidate within 0.1 pt of the best; a twin candidate with the same
network inputs, which no network can tell apart).
"""

from __future__ import annotations

import argparse
import collections
import math
import sys
import time

import numpy as np
import torch

from env_client import ROLE_LEARNER, WyrmspanEnv
from evaluate import EVAL_SEED, load_agent
from model import to_tensors

TIE = 0.1  # points: two candidates this close are a tie to the heuristic
BUCKETS = (0.1, 1.0, 3.0)


def same_inputs(b, i: int, j: int, k: int) -> bool:
    return (np.array_equal(b.cand_feat[i, j], b.cand_feat[i, k]) and np.array_equal(b.cand_sel[i, j], b.cand_sel[i, k])
            and np.array_equal(b.cand_pay[i, j], b.cand_pay[i, k]) and b.cand_target[i, j] == b.cand_target[i, k])


def run(net, games: int, play: str, players: list[int], workers: int, envs_per_worker: int, device: str,
        seed: int, verbs: list[str] | None = None) -> tuple[list[dict], list[dict]]:
    per_env = max(1, math.ceil(games / (workers * envs_per_worker)))
    n_envs = max(1, min(envs_per_worker, math.ceil(games / (workers * per_env))))
    envs = [WyrmspanEnv() for _ in range(workers)]
    verbs = verbs or envs[0].verbs
    rows: list[dict] = []
    episodes: list[dict] = []
    try:
        batches = [env.reset(num_envs=n_envs, seed=seed + 7919 * k, players=players, opponents="heuristic", quota=per_env,
                             teacher=True, shaping=0.0) for k, env in enumerate(envs)]
        while True:
            live = [k for k, b in enumerate(batches) if (b.role >= 0).any()]
            if not live:
                break
            for k in live:
                b = batches[k]
                rows_k = np.flatnonzero(b.role == ROLE_LEARNER)
                picks = np.zeros(len(b.role), np.int64)
                if len(rows_k):
                    with torch.no_grad():
                        logits, _ = net(*to_tensors(b.obs(rows_k), device))
                    logits = logits.float().cpu().numpy()
                    for r, i in enumerate(rows_k):
                        t = int(b.teacher[i])
                        mask = b.cand_mask[i]
                        vals = b.teacher_value[i]
                        lg = np.where(mask, logits[r], -np.inf)
                        net_pick = int(lg.argmax())
                        finite = mask & np.isfinite(vals)
                        best = float(vals[t])
                        verb = verbs[int(np.argmax(b.cand_feat[i, t, :len(verbs)]))]
                        kind = b.kind[i]
                        rank = int((lg > lg[t]).sum())
                        z = lg[mask] - lg[mask].max()
                        p_t = float(np.exp(lg[t] - lg[mask].max()) / np.exp(z).sum())
                        twins = [k2 for k2 in np.flatnonzero(mask) if k2 != t and same_inputs(b, i, t, k2)]
                        rows.append({
                            "env": (k, int(i)),
                            "kind": f"turn:{verb}" if kind == "turn" else kind,
                            "n": int(mask.sum()),
                            "agree": net_pick == t,
                            "top3": rank < 3,
                            "p_teacher": p_t,
                            "regret": max(0.0, best - float(vals[net_pick])) if np.isfinite(vals[net_pick]) else float("nan"),
                            "tied": int(((best - vals[finite]) < TIE).sum()) > 1,
                            "twin": bool(twins) and any(abs(float(vals[k2]) - best) >= TIE for k2 in twins),
                            "net_verb": verbs[int(np.argmax(b.cand_feat[i, net_pick, :len(verbs)]))] if kind == "turn" else "",
                        })
                        picks[i] = net_pick if play == "net" else t
                envs[k].send_step(picks)
            for k in live:
                batches[k] = envs[k].recv_batch()
                episodes.extend(ep for ep in batches[k].episodes if not ep["aborted"])
    finally:
        for env in envs:
            env.close()
    return rows, episodes


def report(name: str, rows: list[dict], episodes: list[dict]) -> None:
    g = max(1, len(episodes))
    scores = [ep["scores"][s] for ep in episodes for s, r in enumerate(ep["roles"]) if r == "learner"]
    reg = np.array([r["regret"] for r in rows if not math.isnan(r["regret"])])
    dis = np.array([r["regret"] for r in rows if not r["agree"] and not math.isnan(r["regret"])])
    print(f"\n== {name}: {len(episodes)} games, {len(rows)} decisions ({len(rows) / g:.0f}/game), "
          f"score {np.mean(scores):.1f}")
    print(f"agreement {np.mean([r['agree'] for r in rows]):.1%}   top-3 {np.mean([r['top3'] for r in rows]):.1%}   "
          f"p(teacher) {np.mean([r['p_teacher'] for r in rows]):.2f}")
    print(f"regret {reg.sum() / g:.1f} pts/game (heuristic's own valuation)")
    edges = (0.0,) + BUCKETS + (float("inf"),)
    parts = []
    for lo, hi in zip(edges, edges[1:]):
        sel = (dis >= lo) & (dis < hi)
        parts.append(f"{lo:g}-{hi:g}: {sel.mean():.0%} of them, {dis[sel].sum() / g:.1f} pts/game")
    print(f"disagreements ({len(dis)}) by regret  " + " | ".join(parts))
    print(f"labels: {np.mean([r['tied'] for r in rows]):.1%} of decisions have a tie within {TIE} pt; "
          f"{np.mean([r['twin'] for r in rows]):.1%} have an input-identical twin of different value")
    by = collections.defaultdict(list)
    for r in rows:
        by[r["kind"]].append(r)
    print(f"{'decision':28s} {'share':>6s} {'cands':>6s} {'agree':>6s} {'tied':>5s} {'regret/g':>9s}  net picks instead")
    for kind, rs in sorted(by.items(), key=lambda kv: -sum(x["regret"] for x in kv[1] if not math.isnan(x["regret"]))):
        rg = sum(x["regret"] for x in rs if not math.isnan(x["regret"])) / g
        instead = ""
        if kind.startswith("turn:"):
            c = collections.Counter(x["net_verb"] for x in rs if not x["agree"])
            instead = " ".join(f"{v}:{n}" for v, n in c.most_common(4))
        print(f"{kind:28s} {len(rs) / len(rows):6.1%} {np.mean([x['n'] for x in rs]):6.1f} "
              f"{np.mean([x['agree'] for x in rs]):6.1%} {np.mean([x['tied'] for x in rs]):5.0%} {rg:9.2f}  {instead}")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("agents", nargs="+", help="checkpoints: PATH, run dir, or RUN@N")
    p.add_argument("--play", choices=("net", "heuristic", "both"), default="both")
    p.add_argument("--games", type=int, default=96)
    p.add_argument("--players", type=int, nargs="+", default=[2])
    p.add_argument("--workers", type=int, default=3)
    p.add_argument("--envs-per-worker", type=int, default=16)
    p.add_argument("--seed", type=int, default=EVAL_SEED)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    a = p.parse_args(argv)
    with WyrmspanEnv() as probe:
        versions, verbs = probe.versions, probe.verbs
    for spec in a.agents:
        net = load_agent(spec, versions, a.device)
        for play in (("net", "heuristic") if a.play == "both" else (a.play,)):
            t0 = time.perf_counter()
            rows, eps = run(net, a.games, play, a.players, a.workers, a.envs_per_worker, a.device, a.seed, verbs)
            report(f"{spec} | {play} plays", rows, eps)
            print(f"({time.perf_counter() - t0:.0f}s)")
            sys.stdout.flush()


if __name__ == "__main__":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")
    main()
