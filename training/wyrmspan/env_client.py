"""Python side of the Wyrmspan training bridge.

Spawns `node training/dist/wyrmspan-env.mjs` (build it with `npm run train:build`)
and drives the vectorized env over stdin/stdout (JSON lines; batch replies add
the feature arrays as raw bytes after the line). The game rules, the
hidden-information boundary (each seat's redacted view), the encoder and the
candidate action space all live in TypeScript (src/wyrmspan/nn/); this side only
ever sees encoded observations, candidate lists and rewards.

    with WyrmspanEnv() as env:
        batch = env.reset(num_envs=32, players=[2], opponents="heuristic")
        while training:
            picks = policy(batch)              # one candidate index per env row
            batch = env.step(picks)

For many env processes in parallel, split each step into `send_step` (all
workers) then `recv_batch` (all workers), so every node process works while the
others are being written to.

Run this file directly for a random-agent smoke test of the bridge:

    python training/wyrmspan/env_client.py --episodes 64 --envs 32
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import time
from dataclasses import dataclass

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SCRIPT = os.path.normpath(os.path.join(HERE, "..", "dist", "wyrmspan-env.mjs"))

ROLE_LEARNER, ROLE_IDLE = 0, -1
OPPONENTS = ("heuristic", "greedy", "random", "learner")


@dataclass
class Batch:
    seat: np.ndarray  # (n,) int64 -- seat (state.players index) deciding row i
    role: np.ndarray  # (n,) int64 -- 0 learner, -1 idle (quota reached)
    glob: np.ndarray  # (n, global_dim) float32
    tok_id: np.ndarray  # (n, T) int64 -- card index per token (0 = none)
    tok_feat: np.ndarray  # (n, T, token_dim) float32
    tok_mask: np.ndarray  # (n, T) bool
    cand_feat: np.ndarray  # (n, K, cand_dim) float32
    cand_sel: np.ndarray  # (n, K, T) uint8 -- how often candidate k picks / plays token t
    cand_pay: np.ndarray  # (n, K, T) uint8 -- how often candidate k spends token t (cards paid, eggs paid)
    cand_target: np.ndarray  # (n, K) int64 -- mat token a candidate plays into, -1 = none
    cand_mask: np.ndarray  # (n, K) bool -- True = a real candidate
    teacher: np.ndarray  # (n,) int64 -- the heuristic's pick for learner rows, -1 = none (teacher off)
    reward: np.ndarray  # (n, seats) float32 -- per-seat reward since the previous batch
    done: np.ndarray  # (n,) bool -- a match ended; row i is already the next match's first decision
    episodes: list  # summaries of the matches that ended

    OBS = ("glob", "tok_id", "tok_feat", "tok_mask", "cand_feat", "cand_sel", "cand_pay", "cand_target", "cand_mask")

    def obs(self, rows=None) -> tuple:
        """The network inputs (optionally only `rows`), in WyrmspanNet.forward order."""
        parts = tuple(getattr(self, k) for k in self.OBS)
        return parts if rows is None else tuple(p[rows] for p in parts)


class WyrmspanEnv:
    def __init__(self, script: str = DEFAULT_SCRIPT, node: str | None = None):
        if not os.path.exists(script):
            raise FileNotFoundError(f"{script} not found -- run `npm run train:build` first")
        node = node or shutil.which("node")
        if not node:
            raise FileNotFoundError("node executable not found on PATH")
        # Binary pipes: batch replies are a JSON line followed by raw feature bytes.
        self._proc = subprocess.Popen([node, script], stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=1 << 20)
        spec = self._call({"cmd": "spec"})
        self.dims: dict = spec["dims"]
        self.shape: dict = spec["shape"]
        self.zones: dict = spec["zones"]
        self.verbs: list[str] = spec["verbs"]
        self.layouts: dict = spec["layouts"]
        self.card_table = np.asarray(spec["cardTable"], dtype=np.float32).reshape(self.shape["cardIndex"], self.dims["cardStatic"])
        self.encoder_version: int = spec["encoderVersion"]
        self.action_space_version: int = spec["actionSpaceVersion"]

    @property
    def versions(self) -> dict:
        return {"encoderVersion": self.encoder_version, "actionSpaceVersion": self.action_space_version}

    def _send(self, msg: dict) -> None:
        assert self._proc.stdin
        self._proc.stdin.write((json.dumps(msg) + "\n").encode())
        self._proc.stdin.flush()

    def _recv(self) -> dict:
        assert self._proc.stdout
        line = self._proc.stdout.readline()
        if not line:
            raise RuntimeError(f"env server exited (code {self._proc.poll()})")
        reply = json.loads(line)
        if not reply.get("ok"):
            raise RuntimeError(f"env server: {reply.get('error')}")
        if "binary" in reply:
            sizes = reply.pop("binary")
            total = sum(size for _, size in sizes)
            data = self._proc.stdout.read(total)
            if data is None or len(data) < total:
                raise RuntimeError(f"env server exited mid-reply (code {self._proc.poll()})")
            at, raw = 0, {}
            for name, size in sizes:
                raw[name] = memoryview(data)[at:at + size]
                at += size
            reply["raw"] = raw
        return reply

    def _call(self, msg: dict) -> dict:
        self._send(msg)
        return self._recv()

    def _batch(self, r: dict) -> Batch:
        n, sh, d = r["n"], self.shape, self.dims
        T, K = sh["tokens"], sh["cands"]
        raw = r["raw"]

        def arr(key: str, dtype: str, *shape: int) -> np.ndarray:
            return np.frombuffer(raw[key], dtype=dtype).reshape(n, *shape)

        return Batch(
            seat=np.asarray(r["seat"], dtype=np.int64),
            role=np.asarray(r["role"], dtype=np.int64),
            glob=arr("global", "<f4", d["global"]),
            tok_id=arr("tokenIds", "<i2", T).astype(np.int64),
            tok_feat=arr("tokenFeat", "<f4", T, d["token"]),
            tok_mask=arr("tokenMask", "u1", T).astype(bool),
            cand_feat=arr("candFeat", "<f4", K, d["cand"]),
            cand_sel=arr("candSel", "u1", K, T).copy(),
            cand_pay=arr("candPay", "u1", K, T).copy(),
            cand_target=arr("candTarget", "i1", K).astype(np.int64),
            cand_mask=arr("candMask", "u1", K).astype(bool),
            teacher=np.frombuffer(raw["teacher"], dtype="<i2").astype(np.int64),
            reward=np.asarray(r["reward"], dtype=np.float32).reshape(n, sh["seats"]),
            done=np.asarray(r["done"], dtype=bool),
            episodes=r["episodes"],
        )

    def reset(
        self,
        num_envs: int = 16,
        seed: int = 1,
        players: list[int] | None = None,
        opponents: str = "heuristic",
        max_steps: int = 6000,
        score_norm: float = 100.0,
        shaping: float = 1.0,
        quota: int = 0,
        teacher: bool = False,
        expansions: list[str] | None = None,
        automa_difficulty: int | None = None,
    ) -> Batch:
        """players: table sizes to cycle through per match (1 = solo vs Automa).
        opponents: role of every seat but the learner's — 'heuristic' | 'greedy' |
        'random', or 'learner' for self-play (every seat a learner).
        Reward = score / score_norm at match end, plus potential-based shaping on the
        running score (`shaping`; it sums to a constant per match).
        quota: matches per env before it idles (0 = forever). teacher: label learner
        rows with the heuristic's pick (Batch.teacher)."""
        if opponents not in OPPONENTS:
            raise ValueError(f"opponents must be one of {OPPONENTS}")
        options: dict = {
            "numEnvs": num_envs,
            "seed": seed,
            "players": players or [2],
            "opponents": opponents,
            "maxSteps": max_steps,
            "scoreNorm": score_norm,
            "shaping": shaping,
            "quota": quota,
            "teacher": teacher,
        }
        if expansions is not None:
            options["expansions"] = expansions
        if automa_difficulty is not None:
            options["automaDifficulty"] = automa_difficulty
        return self._batch(self._call({"cmd": "reset", "options": options}))

    def step(self, picks) -> Batch:
        self.send_step(picks)
        return self.recv_batch()

    def send_step(self, picks) -> None:
        self._send({"cmd": "step", "actions": [int(a) for a in picks]})

    def recv_batch(self) -> Batch:
        return self._batch(self._recv())

    def configure(self, opponents: str | None = None, players: list[int] | None = None, teacher: bool | None = None) -> None:
        """New opponents / table sizes for matches that start from now on; teacher labels on / off."""
        options: dict = {}
        if opponents is not None:
            options["opponents"] = opponents
        if players is not None:
            options["players"] = players
        if teacher is not None:
            options["teacher"] = teacher
        self._call({"cmd": "configure", "options": options})

    def close(self) -> None:
        if self._proc.poll() is None:
            try:
                assert self._proc.stdin
                self._proc.stdin.write(b'{"cmd": "close"}\n')
                self._proc.stdin.flush()
                self._proc.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                self._proc.kill()

    def __enter__(self) -> "WyrmspanEnv":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


def random_picks(mask: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """A uniformly random real candidate per row (0 for rows with none)."""
    u = rng.random(mask.shape) * mask
    return np.where(mask.any(axis=1), u.argmax(axis=1), 0)


def learner_scores(episodes: list) -> list[float]:
    """Final scores of the learner seats in finished, non-aborted matches."""
    return [score for ep in episodes if not ep["aborted"]
            for score, role in zip(ep["scores"], ep["roles"]) if role == "learner"]


def _smoke(args: argparse.Namespace) -> None:
    rng = np.random.default_rng(args.seed)
    with WyrmspanEnv() as env:
        print(f"dims={env.dims} shape={env.shape} encoder v{env.encoder_version} action space v{env.action_space_version}")
        batch = env.reset(num_envs=args.envs, seed=args.seed, players=args.players, opponents=args.opponents)
        episodes: list = []
        decisions = 0
        t0 = time.perf_counter()
        while len(episodes) < args.episodes:
            for name in ("glob", "tok_feat", "cand_feat"):
                assert np.isfinite(getattr(batch, name)).all(), f"non-finite {name}"
            live = batch.role >= 0
            assert batch.cand_mask[live].sum(axis=1).min() >= 2, "a reported decision has < 2 candidates"
            batch = env.step(random_picks(batch.cand_mask, rng))
            decisions += int(live.sum())
            episodes.extend(batch.episodes)
        dt = time.perf_counter() - t0
    scores = learner_scores(episodes)
    print(f"{len(episodes)} matches (players {args.players}, opponents {args.opponents}), {decisions} learner decisions "
          f"in {dt:.1f}s ({decisions / dt:,.0f} decisions/s)")
    print(f"random learner score {np.mean(scores):.1f} ± {1.96 * np.std(scores) / np.sqrt(len(scores)):.1f}; "
          f"aborted {sum(e['aborted'] for e in episodes)}, fallbacks {sum(e['fallbacks'] for e in episodes)}, "
          f"truncated {sum(e['truncated'] for e in episodes)}")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="Random-agent smoke test for the Wyrmspan env bridge.")
    p.add_argument("--envs", type=int, default=32)
    p.add_argument("--episodes", type=int, default=64)
    p.add_argument("--players", type=int, nargs="+", default=[2])
    p.add_argument("--opponents", default="greedy", choices=OPPONENTS)
    p.add_argument("--seed", type=int, default=1)
    _smoke(p.parse_args())
