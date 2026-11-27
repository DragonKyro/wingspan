// Value-function data: turn-start positions of heuristic self-play games,
// labelled with the deciding player's final score.
//
//   npx vite-node scripts/wyrmspan/value-data.ts -- --games 100 --seed 61000001 --out scripts/wyrmspan/runs/value/a.jsonl
//
// One JSON line per position: game seed, seat, round, the parts of the
// heuristic's positionValue (from the player's redacted view — no peeking), a
// few raw counts, and `final` (that player's final score). value-fit.ts fits
// and compares evaluators on them. --weights '{...}' plays with patched WEIGHTS.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cardAbilityTypes, dragonCard, isDragonCard } from '@/wyrmspan/cards';
import { allDragons, player } from '@/wyrmspan/helpers';
import { DEFAULT_WEIGHTS, positionParts, setWeights } from '@/wyrmspan/heuristic/heuristic';
import { actingPlayer, applyAll, baselineActions, newMatch } from '@/wyrmspan/heuristic/play';
import { redact } from '@/wyrmspan/heuristic/view';
import { scorePlayer } from '@/wyrmspan/scoring';
import type { GameState, PlayerId } from '@/wyrmspan/types';

const args = process.argv.slice(2);
const opt = (name: string, dflt?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};
const games = Number(opt('games', '50'));
const seed0 = Number(opt('seed', '61000001'));
const out = opt('out', 'scripts/wyrmspan/runs/value/positions.jsonl')!;
const players = Number(opt('players', '2'));
setWeights(JSON.parse(opt('weights', '{}')!), DEFAULT_WEIGHTS);
mkdirSync(dirname(out), { recursive: true });

/** Raw counts the hand-written evaluation may under- or over-weight. */
function raw(view: GameState, me: PlayerId): Record<string, number> {
  const p = player(view, me);
  const ds = allDragons(p);
  const types = (t: string) => ds.filter((d) => cardAbilityTypes(dragonCard(d.dragon.cardId)).includes(t as never)).length;
  return {
    coins: p.coins,
    resources: Object.values(p.resources).reduce((a, b) => a + b, 0),
    handDragons: p.hand.filter(isDragonCard).length,
    hand: p.hand.length,
    dragons: ds.length,
    eggs: ds.reduce((a, d) => a + d.dragon.eggs, 0) + p.nestEggs,
    cached: ds.reduce((a, d) => a + d.dragon.cached.length, 0),
    tucked: ds.reduce((a, d) => a + d.dragon.tucked.length, 0),
    excavated: p.caves.reduce((a, row) => a + row.spaces.filter((sp) => sp.excavated).length, 0),
    adventurers: types('Adventurer'),
    oncePerRound: types('OncePerRound'),
    endGame: types('EndGame'),
    exploresThisRound: Object.values(p.explores).reduce((a, b) => a + b, 0),
  };
}

const t0 = performance.now();
let rows = 0;
for (let g = 0; g < games; g++) {
  const seed = seed0 + g;
  let s = newMatch(seed, players);
  const pending: { seat: number; round: number; parts: Record<string, number>; raw: Record<string, number> }[] = [];
  while (s.phase !== 'gameEnd') {
    const id = actingPlayer(s)!;
    if (s.phase === 'main' && !s.pending.length && s.turn === id && !player(s, id).passed) {
      const view = redact(s, id);
      pending.push({ seat: s.players.findIndex((p) => p.id === id), round: s.round, parts: positionParts(view, id), raw: raw(view, id) });
    }
    s = applyAll(s, baselineActions(s, id, 'heuristic'));
  }
  const finals = s.players.map((p) => scorePlayer(s, p).total);
  appendFileSync(out, pending.map((r) => JSON.stringify({ seed, ...r, final: finals[r.seat] })).join('\n') + '\n');
  rows += pending.length;
}
console.log(`${games} games, ${rows} positions → ${out} (${((performance.now() - t0) / 1000 / games).toFixed(1)} s/game)`);
