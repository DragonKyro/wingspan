"""Policy / value network for Wyrmspan, its checkpoints, and its policy-file export.

Inputs are the encoder's arrays (src/wyrmspan/nn/encode.ts, candidates.ts):
a global vector, NUM_TOKENS card tokens (card index + context features), and
up to MAX_CANDS candidates (features + which tokens each one uses / targets).

    tokens      [card table row (static printed features) ‖ learned card embedding
                 ‖ token context] → MLP → width d
    trunk       a global token (MLP of the global vector) + the card tokens →
                 `layers` pre-norm transformer layers (padding masked) →
                 h = MLP([global token ‖ mean of tokens])
    candidates  c_k = MLP(features_k) + W_sel · mean(tokens it picks / plays)
                 + W_pay · mean(tokens it spends) + W_tgt · (the mat token it plays into)
    heads       logit_k = MLP([h ‖ c_k ‖ h ⊙ c_k]); value = MLP(h)

The policy is a softmax over a decision's real candidates (pointer-style), so
one network handles every pending-step kind. The value head predicts the
remaining return: (final score − shaping × current score) / score_norm.
"""

from __future__ import annotations

import base64
import json
import os

import numpy as np
import torch
from torch import nn

POLICY_FORMAT = "wyrmspan/pointer@1"
GAME = "wyrmspan"
ILLEGAL_LOGIT = -1e9


def _mlp(n_in: int, d: int, n_out: int, out_gain: float = 1.0) -> nn.Sequential:
    out = nn.Linear(d, n_out)
    nn.init.orthogonal_(out.weight, out_gain)
    nn.init.zeros_(out.bias)
    return nn.Sequential(nn.Linear(n_in, d), nn.GELU(), nn.Linear(d, d), nn.GELU(), out)


class WyrmspanNet(nn.Module):
    def __init__(self, dims: dict, shape: dict, width: int = 128, layers: int = 2, heads: int = 4, card_emb: int = 32,
                 card_table: np.ndarray | None = None):
        super().__init__()
        self.arch = {"dims": dict(dims), "shape": dict(shape), "width": width, "layers": layers, "heads": heads,
                     "card_emb": card_emb}
        n_cards, s_dim = shape["cardIndex"], dims["cardStatic"]
        table = torch.zeros(n_cards, s_dim) if card_table is None else torch.as_tensor(card_table, dtype=torch.float32)
        self.register_buffer("card_table", table)
        self.card_embed = nn.Embedding(n_cards, card_emb, padding_idx=0)
        d = width
        self.tok_in = _mlp(s_dim + card_emb + dims["token"], d, d)
        self.glob_in = _mlp(dims["global"], d, d)
        layer = nn.TransformerEncoderLayer(d, heads, 2 * d, dropout=0.0, activation="gelu", batch_first=True, norm_first=True)
        self.encoder = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)
        self.norm = nn.LayerNorm(d)
        self.trunk = _mlp(2 * d, d, d)
        self.cand_in = _mlp(dims["cand"], d, d)
        self.sel_proj = nn.Linear(d, d)
        self.pay_proj = nn.Linear(d, d)
        self.tgt_proj = nn.Linear(d, d)
        self.score = _mlp(3 * d, d, 1, out_gain=0.01)
        self.value = _mlp(d, d, 1, out_gain=1.0)

    def forward(self, glob, tok_id, tok_feat, tok_mask, cand_feat, cand_sel, cand_pay, cand_target, cand_mask):
        B, T = tok_id.shape
        x = torch.cat([self.card_table[tok_id], self.card_embed(tok_id), tok_feat], dim=-1)
        x = self.tok_in(x)
        g = self.glob_in(glob)[:, None]
        seq = torch.cat([g, x], dim=1)
        pad = torch.cat([torch.zeros(B, 1, dtype=torch.bool, device=tok_mask.device), ~tok_mask], dim=1)
        seq = self.norm(self.encoder(seq, src_key_padding_mask=pad))
        g, toks = seq[:, 0], seq[:, 1:]
        m = tok_mask.to(toks.dtype)[..., None]
        toks = toks * m  # padded tokens contribute nothing below
        pooled = toks.sum(1) / m.sum(1).clamp(min=1.0)
        h = self.trunk(torch.cat([g, pooled], dim=-1))

        c = self.cand_in(cand_feat)
        sel = cand_sel.to(toks.dtype)
        sel = sel / sel.sum(-1, keepdim=True).clamp(min=1.0)
        c = c + self.sel_proj(torch.bmm(sel, toks))
        spend = cand_pay.to(toks.dtype)
        spend = spend / spend.sum(-1, keepdim=True).clamp(min=1.0)
        c = c + self.pay_proj(torch.bmm(spend, toks))
        has_tgt = (cand_target >= 0)[..., None].to(toks.dtype)
        tgt = toks.gather(1, cand_target.clamp(min=0)[..., None].expand(-1, -1, toks.shape[-1]))
        c = c + self.tgt_proj(tgt) * has_tgt
        hk = h[:, None].expand_as(c)
        logits = self.score(torch.cat([hk, c, hk * c], dim=-1)).squeeze(-1)
        logits = logits.masked_fill(~cand_mask, ILLEGAL_LOGIT)
        return logits, self.value(h).squeeze(-1)


def net_from_spec(env, **arch) -> WyrmspanNet:
    """A fresh network for an env's spec (dims, shape, card table)."""
    return WyrmspanNet(env.dims, env.shape, card_table=env.card_table, **arch)


def to_tensors(parts, device) -> list[torch.Tensor]:
    """Batch.obs() arrays → tensors on `device` in forward() order and dtypes."""
    glob, tok_id, tok_feat, tok_mask, cand_feat, cand_sel, cand_pay, cand_target, cand_mask = (_writable(np.asarray(x)) for x in parts)
    out = [
        torch.from_numpy(np.ascontiguousarray(glob, dtype=np.float32)),
        torch.from_numpy(np.ascontiguousarray(tok_id, dtype=np.int64)),
        torch.from_numpy(np.ascontiguousarray(tok_feat, dtype=np.float32)),
        torch.from_numpy(np.ascontiguousarray(tok_mask, dtype=bool)),
        torch.from_numpy(np.ascontiguousarray(cand_feat, dtype=np.float32)),
        torch.from_numpy(np.ascontiguousarray(cand_sel, dtype=np.uint8)),
        torch.from_numpy(np.ascontiguousarray(cand_pay, dtype=np.uint8)),
        torch.from_numpy(np.ascontiguousarray(cand_target, dtype=np.int64)),
        torch.from_numpy(np.ascontiguousarray(cand_mask, dtype=bool)),
    ]
    return [t.to(device, non_blocking=True) for t in out]


def _writable(x: np.ndarray) -> np.ndarray:
    return x if x.flags.writeable else x.copy()


# ---------------------------------------------------------------- policy files

def _b64(t: torch.Tensor) -> str:
    return base64.b64encode(np.ascontiguousarray(t.detach().float().cpu().numpy(), dtype="<f4").tobytes()).decode()


def export_policy(net: WyrmspanNet, path: str, versions: dict, meta: dict | None = None) -> None:
    """Every tensor of the network (card table included) as base64 little-endian
    float32, keyed by its state_dict name — for a future TypeScript runtime and
    for reloading a policy as an eval agent."""
    doc = {
        "format": POLICY_FORMAT,
        "game": GAME,
        **versions,
        "arch": net.arch,
        "tensors": {k: {"shape": list(v.shape), "data": _b64(v)} for k, v in net.state_dict().items()},
        "meta": meta or {},
    }
    _atomic_write(path, json.dumps(doc))


def _build(arch: dict) -> WyrmspanNet:
    return WyrmspanNet(arch["dims"], arch["shape"], arch["width"], arch["layers"], arch["heads"], arch["card_emb"])


def load_policy(path: str, versions: dict | None = None, device: str | torch.device = "cpu") -> WyrmspanNet:
    with open(path, encoding="utf-8") as f:
        doc = json.load(f)
    if doc.get("format") != POLICY_FORMAT or doc.get("game") != GAME:
        raise ValueError(f"{path} is not a {GAME} policy ({doc.get('format')}, {doc.get('game')})")
    check_versions(doc, versions, path)
    net = _build(doc["arch"])
    state = {k: torch.from_numpy(np.frombuffer(base64.b64decode(t["data"]), dtype="<f4").copy().reshape(t["shape"]))
             for k, t in doc["tensors"].items()}
    net.load_state_dict(state)
    return net.to(device).eval()


def check_versions(doc: dict, versions: dict | None, what: str) -> None:
    if versions:
        mine = {k: doc.get(k) for k in versions}
        if mine != versions:
            raise ValueError(f"{what} was trained on {mine}, this build is {versions} -- retrain after changing the encoder")


# ---------------------------------------------------------------- checkpoints

def save_checkpoint(path: str, net: WyrmspanNet, optimizer: torch.optim.Optimizer, state: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    torch.save({"model": net.state_dict(), "optimizer": optimizer.state_dict(), "arch": net.arch, **state}, tmp)
    os.replace(tmp, path)


def load_checkpoint(path: str, device: str | torch.device = "cpu") -> dict:
    return torch.load(path, map_location=device, weights_only=False)


def net_from_checkpoint(ckpt: dict, device: str | torch.device = "cpu") -> WyrmspanNet:
    net = _build(ckpt["arch"]).to(device)
    net.load_state_dict(ckpt["model"])
    return net


def _atomic_write(path: str, text: str) -> None:
    """Readers (evals) never see a half-written file."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)
