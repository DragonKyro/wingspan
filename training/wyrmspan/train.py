"""PPO trainer for the Wyrmspan agent — objective: the agent's own final score.

    conda activate train
    python training/wyrmspan/train.py --run main              # Ctrl+C any time: it checkpoints, then exits
    python training/wyrmspan/train.py --run main --resume
    tensorboard --logdir training/runs

To stop a run you can't Ctrl+C, create an empty training/runs/wyrmspan/<run>/STOP:
it saves and exits after the current update (the file is removed on the next start).

Each update:
  1. Collect `--rollout` decisions from every env — `--workers` node processes ×
     `--envs-per-worker` matches. A worker is either
       heuristic  one learner seat; every other seat the benchmark heuristic
       self       every seat is the learner (more data per match; Wyrmspan has
                  little interaction, so opponents matter mostly through the
                  objective race and the shared displays)
     Table sizes come from `--players` (1 = solo vs Automa), cycled per match.
     Heuristic seats are 10-25x slower to play than network seats, so heuristic
     workers run `--heuristic-envs` matches against self-play's `--envs-per-worker`.
  2. Reward = final score / `--score-norm`, plus potential-based shaping on the
     running score (`--shaping`; it sums to a constant per match, so with
     gamma 1 it changes credit assignment, not the optimum).
  3. The first `--bc-updates` imitate the heuristic (each learner decision is
     labelled with the heuristic's pick; the policy learns to predict it and the
     value head learns the games' returns). The heuristic plays those moves at
     first; in the last `--bc-dagger` of imitation the network plays its own
     (DAgger). After that, PPO per (match, seat) stream, plus a pull toward the
     heuristic's pick (`--bc-anchor`) fading to 0 over `--bc-anchor-updates`.
  4. Every `--save-every`: ckpt/update_N.pt (the newest `--keep-ckpt` kept, plus
     every `--keep-every`).
  5. Every `--eval-every`: greedy matches on fixed eval deals (never trained on)
     vs heuristic opponents → mean score ± 95% CI and the paired difference to the
     heuristic playing the same seats on the same deals (computed once per run).
     Logged to evals.jsonl, tensorboard eval/*, and progress.md.

Outputs go to training/runs/wyrmspan/<run>/: config.json, metrics.jsonl, evals.jsonl,
progress.md, tb/, ckpt/.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import subprocess
import sys
import time

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.tensorboard import SummaryWriter

import evaluate as ev
from env_client import ROLE_LEARNER, Batch, WyrmspanEnv, learner_scores
from model import check_versions, load_checkpoint, net_from_checkpoint, net_from_spec, save_checkpoint, to_tensors

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", ".."))
DEFAULT_RUNS = os.path.join(REPO, "training", "runs", "wyrmspan")


def default_workers() -> int:
    """Leave cores for the learner and the eval envs."""
    return max(1, min(12, (os.cpu_count() or 4) - 4))


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    run = p.add_argument_group("run")
    run.add_argument("--run", default=None, help="run name (default: a timestamp)")
    run.add_argument("--runs-dir", default=DEFAULT_RUNS)
    run.add_argument("--resume", action="store_true", help="continue the run from its latest checkpoint")
    run.add_argument("--updates", type=int, default=3000, help="train until this many updates in total")
    run.add_argument("--seed", type=int, default=1)
    run.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    run.add_argument("--no-build", action="store_true", help="skip rebuilding training/dist")

    game = p.add_argument_group("game / envs")
    game.add_argument("--players", type=int, nargs="+", default=[2], help="table sizes, cycled per match (1 = solo)")
    game.add_argument("--workers", type=int, default=default_workers(), help="node env processes")
    game.add_argument("--envs-per-worker", type=int, default=32, help="matches per self-play worker")
    game.add_argument("--heuristic-envs", type=int, default=2,
                      help="matches per heuristic worker (heuristic seats are 10-25x slower to play; fewer matches keep "
                           "every worker's step about as long, since workers step in lockstep)")
    game.add_argument("--rollout", type=int, default=32, help="decisions per env per update")
    game.add_argument("--self-play", type=float, default=0.5, help="share of workers where every seat is the learner")
    game.add_argument("--max-steps", type=int, default=6000, help="engine decisions before a match is cut off")

    rew = p.add_argument_group("reward")
    rew.add_argument("--score-norm", type=float, default=100.0, help="reward = score / score_norm")
    rew.add_argument("--shaping", type=float, default=1.0, help="potential-based shaping weight on the running score")

    ppo = p.add_argument_group("PPO")
    ppo.add_argument("--lr", type=float, default=3e-4)
    ppo.add_argument("--gamma", type=float, default=1.0)
    ppo.add_argument("--lam", type=float, default=0.95)
    ppo.add_argument("--clip", type=float, default=0.2)
    ppo.add_argument("--epochs", type=int, default=3)
    ppo.add_argument("--minibatch", type=int, default=2048)
    ppo.add_argument("--ent-coef", type=float, default=0.01)
    ppo.add_argument("--vf-coef", type=float, default=0.5)
    ppo.add_argument("--max-grad-norm", type=float, default=1.0)
    ppo.add_argument("--target-kl", type=float, default=0.03, help="stop an update's epochs early past this KL (0 = off)")

    bc = p.add_argument_group("imitation warm start")
    bc.add_argument("--bc-updates", type=int, default=30, help="updates spent imitating the heuristic (0 = none)")
    bc.add_argument("--bc-epochs", type=int, default=4)
    bc.add_argument("--bc-lr", type=float, default=1e-3)
    bc.add_argument("--bc-dagger", type=float, default=0.4, help="last share of imitation where the network plays its own moves")
    bc.add_argument("--bc-anchor", type=float, default=0.2, help="initial weight of the pull toward the heuristic's pick in PPO")
    bc.add_argument("--bc-anchor-updates", type=int, default=200, help="PPO updates over which the pull fades to 0")

    net = p.add_argument_group("network")
    net.add_argument("--width", type=int, default=128)
    net.add_argument("--layers", type=int, default=2)
    net.add_argument("--heads", type=int, default=4)
    net.add_argument("--card-emb", type=int, default=32)

    out = p.add_argument_group("checkpoints / evals")
    out.add_argument("--save-every", type=int, default=50)
    out.add_argument("--keep-ckpt", type=int, default=5, help="newest checkpoints kept")
    out.add_argument("--keep-every", type=int, default=500, help="also keep every Nth update's checkpoint (0 = none)")
    out.add_argument("--eval-every", type=int, default=50, help="0 = no evals")
    out.add_argument("--eval-games", type=int, default=200)
    out.add_argument("--eval-players", type=int, nargs="+", default=None, help="eval table sizes (default: --players)")
    out.add_argument("--eval-workers", type=int, default=4)
    out.add_argument("--window", type=int, default=400, help="recent matches in the per-update training-score average")
    return p.parse_args(argv)


def build_typescript() -> None:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    subprocess.run([npm, "run", "--silent", "train:build"], cwd=REPO, check=True)


def fmt_duration(seconds: float) -> str:
    seconds = int(max(0, seconds))
    h, rem = divmod(seconds, 3600)
    return f"{h}h{rem // 60:02d}m" if h else f"{rem // 60}m{rem % 60:02d}s"


# ---------------------------------------------------------------- rollout storage

class Rollout:
    """Learner transitions for one update, in chronological order. Each
    (env, seat) is a stream: `next[i]` links a transition to that seat's
    following decision in the same match, so rewards and GAE follow the seat
    that earned them. A seat's newest transition is still collecting reward when
    the rollout ends — it is carried into the next update instead of being trained on."""

    OBS = Batch.OBS
    FIELDS = (*OBS, "action", "logp", "value", "teacher", "reward", "done")

    def __init__(self, capacity: int, dims: dict, shape: dict):
        T, K = shape["tokens"], shape["cands"]
        self.glob = np.zeros((capacity, dims["global"]), np.float32)
        self.tok_id = np.zeros((capacity, T), np.int16)
        self.tok_feat = np.zeros((capacity, T, dims["token"]), np.float32)
        self.tok_mask = np.zeros((capacity, T), bool)
        self.cand_feat = np.zeros((capacity, K, dims["cand"]), np.float32)
        self.cand_sel = np.zeros((capacity, K, T), np.uint8)
        self.cand_pay = np.zeros((capacity, K, T), np.uint8)
        self.cand_target = np.zeros((capacity, K), np.int8)
        self.cand_mask = np.zeros((capacity, K), bool)
        self.action = np.zeros(capacity, np.int64)
        self.logp = np.zeros(capacity, np.float32)
        self.value = np.zeros(capacity, np.float32)
        self.teacher = np.full(capacity, -1, np.int64)
        self.reward = np.zeros(capacity, np.float32)
        self.done = np.zeros(capacity, bool)
        self.next = np.full(capacity, -1, np.int64)
        self.n = 0

    def clear(self) -> None:
        self.reward[: self.n] = 0
        self.done[: self.n] = False
        self.next[: self.n] = -1
        self.n = 0

    def add(self, **rows: np.ndarray) -> np.ndarray:
        k = len(rows["action"])
        if self.n + k > len(self.action):
            raise RuntimeError("rollout buffer overflow")
        at = np.arange(self.n, self.n + k)
        for name, values in rows.items():
            getattr(self, name)[at] = values
        self.n += k
        return at

    def take(self, idx: np.ndarray) -> dict:
        return {name: getattr(self, name)[idx].copy() for name in self.FIELDS}

    def obs(self, idx: np.ndarray) -> tuple:
        return tuple(getattr(self, k)[idx] for k in self.OBS)


class Worker:
    def __init__(self, kind: str, env: WyrmspanEnv):
        self.kind = kind
        self.env = env
        self.batch: Batch | None = None


# ---------------------------------------------------------------- trainer

class Trainer:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.device = torch.device(args.device)

    # ------------------------------------------------------------ setup

    def setup(self) -> None:
        a = self.args
        name = a.run or time.strftime("%Y%m%d-%H%M%S")
        self.dir = os.path.join(a.runs_dir, name)
        os.makedirs(os.path.join(self.dir, "ckpt"), exist_ok=True)
        stop = os.path.join(self.dir, "STOP")
        if os.path.exists(stop):
            os.remove(stop)
        if not a.no_build:
            build_typescript()
        torch.manual_seed(a.seed)
        np.random.seed(a.seed)

        n_self = int(round(a.workers * a.self_play))
        kinds = ["self"] * n_self + ["heuristic"] * (a.workers - n_self)
        self.workers = [Worker(kind, WyrmspanEnv()) for kind in kinds]
        env0 = self.workers[0].env
        self.versions = env0.versions
        self.dims, self.shape = env0.dims, env0.shape

        self.update = 0
        self.decisions = 0
        ckpts = ev.list_checkpoints(self.dir)
        if a.resume and ckpts:
            ckpt = load_checkpoint(ckpts[-1][1], self.device)
            check_versions(ckpt, self.versions, ckpts[-1][1])
            self.net = net_from_checkpoint(ckpt, self.device)
            self.opt = torch.optim.Adam(self.net.parameters(), lr=a.lr, eps=1e-5)
            self.opt.load_state_dict(ckpt["optimizer"])
            self.update, self.decisions = ckpt["update"], ckpt["decisions"]
            print(f"resumed {self.dir} at update {self.update}")
        else:
            if a.resume:
                print(f"no checkpoint in {self.dir}; starting fresh")
            self.net = net_from_spec(env0, width=a.width, layers=a.layers, heads=a.heads, card_emb=a.card_emb).to(self.device)
            self.opt = torch.optim.Adam(self.net.parameters(), lr=a.lr, eps=1e-5)
        self.net.eval()
        params = sum(p.numel() for p in self.net.parameters())
        with open(os.path.join(self.dir, "config.json"), "w", encoding="utf-8") as f:
            json.dump({"args": vars(a), **self.versions, "arch": self.net.arch, "params": params, "workers": kinds}, f, indent=2)
        print(f"run {self.dir}: {params / 1e6:.2f}M params, workers {collections.Counter(kinds)}, players {a.players}")

        self.tb = SummaryWriter(os.path.join(self.dir, "tb"))
        self.slices = []
        at = 0
        for k, w in enumerate(self.workers):
            n_envs = a.envs_per_worker if w.kind == "self" else a.heuristic_envs
            w.batch = w.env.reset(num_envs=n_envs, seed=a.seed * 1000 + k + self.update * 100_003, players=a.players,
                                  opponents="learner" if w.kind == "self" else "heuristic", max_steps=a.max_steps,
                                  score_norm=a.score_norm, shaping=a.shaping, teacher=self.teacher_on)
            self.slices.append(slice(at, at + n_envs))
            at += n_envs
        self.total_envs = at
        seats = self.shape["seats"]
        # Every learner row of an update (+ the carried pending rows of every stream).
        self.buf = Rollout(self.total_envs * (a.rollout + seats), self.dims, self.shape)
        self.last = np.full((self.total_envs, seats), -1, np.int64)
        self.carry: dict | None = None
        self.carry_streams = np.zeros((0, 2), np.int64)
        self.window = {kind: collections.deque(maxlen=a.window) for kind in ("heuristic", "self")}
        self.opp_window = collections.deque(maxlen=a.window)
        self.aborted = 0
        self.fallbacks = 0
        self.baseline: list[dict] | None = None

    # ------------------------------------------------------------ schedule

    @property
    def imitating(self) -> bool:
        return self.update < self.args.bc_updates

    @property
    def teacher_on(self) -> bool:
        """Teacher labels are needed while imitating and while the anchor pulls."""
        a = self.args
        return self.update < a.bc_updates + (a.bc_anchor_updates if a.bc_anchor > 0 else 0)

    @property
    def teacher_forcing(self) -> bool:
        a = self.args
        return self.imitating and self.update < a.bc_updates * (1 - a.bc_dagger)

    def anchor_weight(self) -> float:
        a = self.args
        if self.imitating or a.bc_anchor <= 0 or a.bc_anchor_updates <= 0:
            return 0.0
        return a.bc_anchor * max(0.0, 1 - (self.update - a.bc_updates) / a.bc_anchor_updates)

    # ------------------------------------------------------------ collection

    def collect(self) -> np.ndarray:
        """Fill the rollout; returns a mask of transitions still pending (carried, not trained on)."""
        a, buf, last = self.args, self.buf, self.last
        buf.clear()
        last[:] = -1
        if self.carry is not None and len(self.carry_streams):
            rows = buf.add(**self.carry)
            last[self.carry_streams[:, 0], self.carry_streams[:, 1]] = rows
        for _ in range(a.rollout):
            self.decide()
            self.absorb()
        pending = np.zeros(buf.n, bool)
        streams = np.argwhere(last >= 0)
        pending[last[streams[:, 0], streams[:, 1]]] = True
        self.carry = buf.take(last[streams[:, 0], streams[:, 1]])
        self.carry_streams = streams
        return pending

    def decide(self) -> None:
        """One candidate per env (learner rows go in the rollout); send the picks off."""
        buf, last, dev = self.buf, self.last, self.device
        batches = [w.batch for w in self.workers]
        role = np.concatenate([b.role for b in batches])
        seat = np.concatenate([b.seat for b in batches])
        teacher = np.concatenate([b.teacher for b in batches])
        obs = tuple(np.concatenate([getattr(b, k) for b in batches]) for k in Batch.OBS)
        picks = np.zeros(len(role), np.int64)
        learner = np.flatnonzero(role == ROLE_LEARNER)
        if len(learner):
            parts = tuple(x[learner] for x in obs)
            with torch.no_grad():
                logits, value = self.net(*to_tensors(parts, dev))
                dist = torch.distributions.Categorical(logits=logits)
                action = dist.sample()
                if self.teacher_forcing:
                    t = torch.from_numpy(teacher[learner]).to(dev)
                    action = torch.where(t >= 0, t, action)
                logp = dist.log_prob(action)
            action_np = action.cpu().numpy()
            picks[learner] = action_np
            rows = buf.add(**{k: v for k, v in zip(Batch.OBS, parts)}, action=action_np, logp=logp.cpu().numpy(),
                           value=value.cpu().numpy(), teacher=teacher[learner])
            env_ids, seats = learner, seat[learner]
            prev = last[env_ids, seats]
            linked = prev >= 0
            buf.next[prev[linked]] = rows[linked]
            last[env_ids, seats] = rows
            self.decisions += len(learner)
        for k, w in enumerate(self.workers):
            w.env.send_step(picks[self.slices[k]])

    def absorb(self) -> None:
        """Receive every worker's next batch; credit rewards and match ends to each seat's latest decision."""
        buf, last = self.buf, self.last
        for k, w in enumerate(self.workers):
            w.batch = w.env.recv_batch()
            lw = last[self.slices[k]]
            for s in range(self.shape["seats"]):
                ok = lw[:, s] >= 0
                buf.reward[lw[ok, s]] += w.batch.reward[ok, s]
                buf.done[lw[ok & w.batch.done, s]] = True
            lw[w.batch.done] = -1
            for ep in w.batch.episodes:
                self.record(w.kind, ep)

    def record(self, kind: str, ep: dict) -> None:
        self.fallbacks += ep.get("fallbacks", 0)
        if ep["aborted"]:
            self.aborted += 1
            return
        if self.teacher_forcing:
            return  # the heuristic picked the learner's moves: not the network's results
        self.window[kind].extend(learner_scores([ep]))
        if kind == "heuristic":
            self.opp_window.extend(x for x, r in zip(ep["scores"], ep["roles"]) if r == "heuristic")

    # ------------------------------------------------------------ learning

    def advantages(self, pending: np.ndarray) -> np.ndarray:
        a, buf = self.args, self.buf
        adv = np.zeros(buf.n, np.float32)
        for i in range(buf.n - 1, -1, -1):
            if pending[i]:
                continue
            if buf.done[i]:
                next_value = next_adv = 0.0
            else:
                j = buf.next[i]
                if j < 0:  # (only possible for a truncated stream) bootstrap on own value
                    next_value, next_adv = buf.value[i], 0.0
                else:
                    next_value = buf.value[j]
                    next_adv = 0.0 if pending[j] else adv[j]
            delta = buf.reward[i] + a.gamma * next_value - buf.value[i]
            adv[i] = delta + a.gamma * a.lam * next_adv
        return adv

    def learn(self, pending: np.ndarray, adv: np.ndarray) -> dict:
        a, buf, dev = self.args, self.buf, self.device
        idx = np.flatnonzero(~pending)
        obs = to_tensors(buf.obs(idx), dev)
        action = torch.from_numpy(buf.action[idx]).to(dev)
        old_logp = torch.from_numpy(buf.logp[idx]).to(dev)
        advantage = torch.from_numpy(adv[idx]).to(dev)
        returns = advantage + torch.from_numpy(buf.value[idx]).to(dev)
        teacher = torch.from_numpy(buf.teacher[idx]).to(dev)
        anchor = self.anchor_weight()
        norm_adv = (advantage - advantage.mean()) / (advantage.std() + 1e-8)
        n = len(idx)
        lr = a.bc_lr if self.imitating else a.lr
        for g in self.opt.param_groups:
            g["lr"] = lr
        stats = collections.defaultdict(list)
        self.net.train()
        stop = False
        for _ in range(a.bc_epochs if self.imitating else a.epochs):
            perm = torch.randperm(n, device=dev)
            for start in range(0, n, a.minibatch):
                b = perm[start:start + a.minibatch]
                logits, value = self.net(*(x[b] for x in obs))
                logp_all = F.log_softmax(logits, dim=-1)
                probs = logp_all.exp()
                entropy = -(probs * logp_all.clamp(min=-30)).sum(-1).mean()
                labelled = teacher[b] >= 0
                imitation = F.nll_loss(logp_all[labelled], teacher[b][labelled]) if labelled.any() else logp_all.new_zeros(())
                if labelled.any():
                    stats["teacher_agreement"].append((logp_all[labelled].argmax(-1) == teacher[b][labelled]).float().mean().item())
                if self.imitating:
                    pi_loss = imitation
                else:
                    new_logp = logp_all.gather(1, action[b, None]).squeeze(1)
                    log_ratio = new_logp - old_logp[b]
                    ratio = log_ratio.exp()
                    adv_b = norm_adv[b]
                    pi_loss = -torch.min(ratio * adv_b, ratio.clamp(1 - a.clip, 1 + a.clip) * adv_b).mean()
                    kl = ((ratio - 1) - log_ratio).mean().item()
                    stats["approx_kl"].append(kl)
                    stats["clipfrac"].append(((ratio - 1).abs() > a.clip).float().mean().item())
                    if anchor > 0:
                        pi_loss = pi_loss + anchor * imitation
                        stats["anchor_loss"].append(imitation.item())
                    if a.target_kl > 0 and kl > 1.5 * a.target_kl:
                        stop = True
                v_loss = 0.5 * (value - returns[b]).pow(2).mean()
                loss = pi_loss + a.vf_coef * v_loss - (0.0 if self.imitating else a.ent_coef) * entropy
                if not torch.isfinite(loss):
                    stats["skipped_steps"].append(1.0)
                    continue
                self.opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.net.parameters(), a.max_grad_norm)
                self.opt.step()
                stats["policy_loss"].append(pi_loss.item())
                stats["value_loss"].append(v_loss.item())
                stats["entropy"].append(entropy.item())
                if stop:
                    break
            if stop:
                break
        self.net.eval()
        out = {k: float(np.sum(v) if k == "skipped_steps" else np.mean(v)) for k, v in stats.items()}
        ret_np, val_np = returns.cpu().numpy(), buf.value[idx]
        out["explained_variance"] = float(1 - np.var(ret_np - val_np) / (np.var(ret_np) + 1e-8))
        out["transitions"] = n
        out["anchor_weight"] = anchor
        out["imitation"] = 1.0 if self.imitating else 0.0
        out["early_stop"] = 1.0 if stop else 0.0
        return out

    # ------------------------------------------------------------ checkpoints / evals

    def save(self) -> str:
        a = self.args
        path = os.path.join(self.dir, "ckpt", f"update_{self.update:06d}.pt")
        save_checkpoint(path, self.net, self.opt, {"update": self.update, "decisions": self.decisions, **self.versions})
        keep = {p for _, p in ev.list_checkpoints(self.dir)[-a.keep_ckpt:]}
        for u, p in ev.list_checkpoints(self.dir):
            if p not in keep and not (a.keep_every and u % a.keep_every == 0):
                os.remove(p)
        return path

    def eval_kw(self) -> dict:
        a = self.args
        return dict(games=a.eval_games, players=a.eval_players or a.players, opponents="heuristic",
                    workers=a.eval_workers, envs_per_worker=16, device=str(self.device))

    def evaluate(self) -> dict:
        """Greedy matches on the eval deals; the heuristic baseline on the same deals is played once per run."""
        base_path = os.path.join(self.dir, "baseline.json")
        kw = self.eval_kw()
        if self.baseline is None:
            if os.path.exists(base_path):
                with open(base_path, encoding="utf-8") as f:
                    doc = json.load(f)
                if doc.get("kw") == {k: v for k, v in kw.items() if k != "device"}:
                    self.baseline = doc["episodes"]
            if self.baseline is None:
                self.baseline = ev.play("heuristic", **kw)
                with open(base_path, "w", encoding="utf-8") as f:
                    json.dump({"kw": {k: v for k, v in kw.items() if k != "device"}, "episodes": self.baseline}, f)
        eps = ev.play(self.net, **kw)
        res = {"update": self.update, "decisions": self.decisions, "hours": (time.time() - self.t_start) / 3600,
               "policy": ev.summarize(eps), "heuristic": ev.summarize(self.baseline), "paired": ev.paired(eps, self.baseline)}
        with open(os.path.join(self.dir, "evals.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(res) + "\n")
        self.tb.add_scalar("eval/score", res["policy"]["score"], self.update)
        self.tb.add_scalar("eval/vs_heuristic", res["paired"].get("diff", 0.0), self.update)
        self.write_progress()
        return res

    def write_progress(self) -> None:
        path = os.path.join(self.dir, "evals.jsonl")
        rows = [json.loads(line) for line in open(path, encoding="utf-8")] if os.path.exists(path) else []
        lines = [
            "# Wyrmspan training progress",
            "",
            "Greedy policy on fixed eval deals vs heuristic opponents; `vs heuristic` is the paired score difference",
            "to the heuristic playing the same seats on the same deals (positive = the policy scores more).",
            "",
            "| update | hours | decisions | score (95% CI) | heuristic | vs heuristic (95% CI) | better deals |",
            "|---:|---:|---:|---:|---:|---:|---:|",
        ]
        for r in rows:
            pol, base, pr = r["policy"], r["heuristic"], r["paired"]
            lines.append(f"| {r['update']} | {r['hours']:.1f} | {r['decisions'] / 1e6:.2f}M | {pol['score']:.1f} ± {pol['ci95']:.1f} "
                         f"| {base['score']:.1f} | {pr.get('diff', 0):+.1f} ± {pr.get('ci95', 0):.1f} | {100 * pr.get('aBetter', 0):.0f}% |")
        with open(os.path.join(self.dir, "progress.md"), "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    # ------------------------------------------------------------ logging

    def log_update(self, stats: dict, seconds: float) -> None:
        a = self.args
        stats.update({"update": self.update, "decisions": self.decisions, "seconds": seconds,
                      "aborted": self.aborted, "fallbacks": self.fallbacks})
        for kind, w in self.window.items():
            if w:
                stats[f"score_{kind}"] = float(np.mean(w))
        if self.opp_window:
            stats["score_heuristic_opponents"] = float(np.mean(self.opp_window))
        with open(os.path.join(self.dir, "metrics.jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(stats) + "\n")
        for k, v in stats.items():
            if isinstance(v, (int, float)):
                self.tb.add_scalar(f"train/{k}", v, self.update)
        phase = "BC " if self.imitating else "PPO"
        ppo = (f"kl {stats.get('approx_kl', 0):.4f} clip {stats.get('clipfrac', 0):.2f} " if not self.imitating else "")
        agree = f"agree {100 * stats['teacher_agreement']:.0f}% " if "teacher_agreement" in stats else ""
        scores = " ".join(f"{k} {np.mean(w):.1f}" for k, w in self.window.items() if w)
        opp = f" (heuristic seats {np.mean(self.opp_window):.1f})" if self.opp_window else ""
        left = (a.updates - self.update) * seconds
        print(f"u {self.update:5d} {phase}| {self.decisions / 1e6:6.2f}M dec | {stats['transitions'] / seconds:5.0f}/s | "
              f"pi {stats.get('policy_loss', 0):+.3f} v {stats.get('value_loss', 0):.4f} ent {stats.get('entropy', 0):.2f} "
              f"{ppo}{agree}ev {stats['explained_variance']:+.2f} | score {scores or '-'}{opp} | {seconds:.1f}s/u, ETA {fmt_duration(left)}",
              flush=True)

    # ------------------------------------------------------------ main loop

    def train(self) -> None:
        a = self.args
        self.t_start = time.time()
        stop_file = os.path.join(self.dir, "STOP")
        try:
            while self.update < a.updates:
                t0 = time.perf_counter()
                was_teacher = self.teacher_on
                pending = self.collect()
                adv = self.advantages(pending)
                stats = self.learn(pending, adv)
                self.update += 1
                self.log_update(stats, time.perf_counter() - t0)
                if was_teacher and not self.teacher_on:
                    for w in self.workers:
                        w.env.configure(teacher=False)  # labels are no longer used; skip the heuristic's cost
                if a.save_every and self.update % a.save_every == 0:
                    self.save()
                if a.eval_every and self.update % a.eval_every == 0:
                    r = self.evaluate()
                    pr = r["paired"]
                    print(f"  eval u{self.update}: score {r['policy']['score']:.1f} ± {r['policy']['ci95']:.1f} | heuristic "
                          f"{r['heuristic']['score']:.1f} | vs heuristic {pr.get('diff', 0):+.1f} ± {pr.get('ci95', 0):.1f}", flush=True)
                if os.path.exists(stop_file):
                    print("STOP file found; saving and exiting")
                    break
        except KeyboardInterrupt:
            print("interrupted; saving")
        finally:
            if self.update > 0:
                print(f"saved {self.save()}")
            self.close()

    def close(self) -> None:
        for w in self.workers:
            w.env.close()
        self.tb.close()


def main(argv: list[str] | None = None) -> str:
    args = parse_args(argv)
    t = Trainer(args)
    t.setup()
    t.train()
    return t.dir


if __name__ == "__main__":
    main(sys.argv[1:])
