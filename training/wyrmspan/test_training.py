"""Python-side checks: network shapes and masking, policy export round trip, the
bridge, paired evaluation, and a tiny train → checkpoint → resume → evaluate
pipeline run (a few updates on a couple of envs — plumbing, not training).
Needs `npm run train:build`.

    python -m pytest training/wyrmspan -q
"""

from __future__ import annotations

import json
import os

import numpy as np
import torch

import evaluate as ev
import train
from env_client import WyrmspanEnv, learner_scores, random_picks
from model import ILLEGAL_LOGIT, export_policy, load_policy, net_from_spec, to_tensors


def test_forward_shapes_and_masking():
    with WyrmspanEnv() as env:
        batch = env.reset(num_envs=4, players=[2], opponents="greedy")
        net = net_from_spec(env, width=32, layers=1, heads=2, card_emb=8).eval()
        with torch.no_grad():
            logits, value = net(*to_tensors(batch.obs(), "cpu"))
    assert logits.shape == (4, env.shape["cands"]) and value.shape == (4,)
    mask = torch.from_numpy(batch.cand_mask)
    assert torch.isfinite(value).all()
    assert (logits[~mask] == ILLEGAL_LOGIT).all() and (logits[mask] > ILLEGAL_LOGIT / 2).all()
    assert np.allclose(net.card_table.numpy(), env.card_table)


def test_policy_export_round_trip(tmp_path):
    with WyrmspanEnv() as env:
        batch = env.reset(num_envs=3, players=[1])
        net = net_from_spec(env, width=32, layers=1, heads=2, card_emb=8).eval()
        path = os.path.join(tmp_path, "p.json")
        export_policy(net, path, env.versions, meta={"note": "test"})
        back = load_policy(path, env.versions)
        x = to_tensors(batch.obs(), "cpu")
        with torch.no_grad():
            a, va = net(*x)
            b, vb = back(*x)
    assert torch.equal(a, b) and torch.equal(va, vb)
    with open(path, encoding="utf-8") as f:
        assert json.load(f)["meta"] == {"note": "test"}


def test_random_bridge_keeps_features_sane():
    rng = np.random.default_rng(0)
    episodes = []
    with WyrmspanEnv() as env:
        batch = env.reset(num_envs=4, players=[1, 2], opponents="greedy")
        for _ in range(300):
            live = batch.role >= 0
            assert np.isfinite(batch.glob).all() and np.isfinite(batch.cand_feat).all()
            assert (batch.cand_mask[live].sum(1) >= 2).all()
            assert ((batch.cand_target >= -1) & (batch.cand_target < env.shape["tokens"])).all()
            batch = env.step(random_picks(batch.cand_mask, rng))
            episodes.extend(batch.episodes)
    assert episodes and all(not e["aborted"] for e in episodes)
    assert all(0 < s < 200 for s in learner_scores(episodes))


def test_paired_eval_uses_the_same_deals():
    kw = dict(games=4, players=[1], workers=1, envs_per_worker=2)
    a = ev.play("heuristic", **kw)
    b = ev.play("heuristic", **kw)
    assert sorted(e["seed"] for e in a) == sorted(e["seed"] for e in b)
    pr = ev.paired(a, b)
    assert pr["pairs"] == 4 and pr["diff"] == 0.0  # the heuristic is deterministic
    r = ev.paired(ev.play("random", **kw), a)
    assert r["pairs"] == 4 and r["diff"] < 0  # random scores less than the heuristic


def test_train_resume_evaluate(tmp_path):
    common = ["--runs-dir", str(tmp_path), "--run", "t", "--no-build", "--device", "cpu", "--players", "1", "2",
              "--workers", "2", "--envs-per-worker", "2", "--heuristic-envs", "2", "--rollout", "6", "--minibatch", "16", "--width", "32",
              "--layers", "1", "--heads", "2", "--card-emb", "8", "--bc-updates", "1", "--bc-epochs", "1",
              "--bc-anchor-updates", "1", "--epochs", "1", "--save-every", "1", "--eval-every", "2",
              "--eval-games", "4", "--eval-workers", "1"]
    run_dir = train.main(common + ["--updates", "2"])
    assert [u for u, _ in ev.list_checkpoints(run_dir)] == [1, 2]
    with open(os.path.join(run_dir, "evals.jsonl"), encoding="utf-8") as f:
        evals = [json.loads(line) for line in f]
    assert evals[0]["update"] == 2 and evals[0]["paired"]["pairs"] == 4
    assert os.path.exists(os.path.join(run_dir, "progress.md"))
    metrics = [json.loads(line) for line in open(os.path.join(run_dir, "metrics.jsonl"), encoding="utf-8")]
    assert metrics[0]["imitation"] == 1.0 and metrics[1]["imitation"] == 0.0
    assert all(np.isfinite(m["value_loss"]) for m in metrics)

    run_dir = train.main(common + ["--updates", "3", "--resume"])
    assert ev.list_checkpoints(run_dir)[-1][0] == 3
    out = ev.main(["match", run_dir, "--games", "4", "--workers", "1", "--envs-per-worker", "2", "--players", "1",
                   "--device", "cpu", "--vs", "heuristic", "--json"])
    assert out["a"]["games"] == 4 and out["paired"]["pairs"] == 4
