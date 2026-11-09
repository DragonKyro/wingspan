// End-game scoring per the rulebook:
//   guild-tile end-game squares where the player placed markers
//   printed VP on visible dragons (fledglings score 1 VP per fledgling instead)
//   EndGame abilities on visible dragons
//   1 VP per egg, cached resource, tucked card
//   objective VP banked during the game
//   1 VP per remaining coin + 1 VP per 4 remaining items (round down)
// Tiebreak: most visible dragons on the mat.

import { parseAbility } from './abilities';
import { dragonCard } from './cards';
import { GUILD_TILES } from './guild';
import { allDragons, countCounter, evalCond } from './helpers';
import type { GameState, PlayerState, ScoreBreakdown } from './types';
import { RESOURCES } from './types';

function dragonVp(p: PlayerState, card: ReturnType<typeof dragonCard>): number {
  if (card.size === 'Fledgling') {
    return allDragons(p).filter((d) => dragonCard(d.dragon.cardId).size === 'Fledgling').length;
  }
  return card.vp;
}

export function scorePlayer(state: GameState, p: PlayerState): ScoreBreakdown {
  const dragons = allDragons(p);

  // Guild tile squares the player marked.
  let guildTile = 0;
  const tile = GUILD_TILES[state.guild.tile];
  state.guild.squares.forEach((occupants, i) => {
    const n = occupants.filter((id) => id === p.id).length;
    if (n <= 0) return;
    const eg = tile.squares[i]?.endGame;
    if (!eg) return;
    const units = eg.counter ? countCounter(state, p, eg.counter) : 0;
    guildTile += n * eg.vpPer * (eg.counter ? units : 1);
  });

  // Printed dragon VP + end-game abilities.
  let printedDragonVp = 0;
  let endGameAbilities = 0;
  for (const d of dragons) {
    const card = dragonCard(d.dragon.cardId);
    printedDragonVp += dragonVp(p, card);
    const def = parseAbility(card);
    if (def.endGame) {
      const eg = def.endGame;
      if (eg.cond) {
        if (evalCond(state, p, eg.cond, [d.cave, d.space])) endGameAbilities += eg.vpPer;
      } else {
        const units = eg.counter ? countCounter(state, p, eg.counter, [d.cave, d.space]) : 0;
        let n = eg.roundDown && eg.extraEggVp ? Math.floor(units / eg.extraEggVp) : units;
        if (eg.max !== undefined) n = Math.min(n * eg.vpPer, eg.max) / eg.vpPer;
        endGameAbilities += eg.vpPer * n;
      }
    }
  }

  const eggs = p.nestEggs + dragons.reduce((a, d) => a + d.dragon.eggs, 0);
  const cached = dragons.reduce((a, d) => a + d.dragon.cached.length, 0);
  const tucked = dragons.reduce((a, d) => a + d.dragon.tucked.length, 0);
  const objectives = p.objectiveVps.reduce((a, b) => a + b, 0);
  const coins = p.coins;
  const handAndResources = p.hand.length + RESOURCES.reduce((a, r) => a + p.resources[r], 0);
  const leftovers = Math.floor(handAndResources / 4);
  const bonusVP = p.bonusVP;

  const total =
    guildTile + printedDragonVp + endGameAbilities + eggs + cached + tucked + objectives + coins + leftovers + bonusVP;

  return {
    playerId: p.id,
    guildTile,
    printedDragonVp,
    endGameAbilities,
    eggs,
    cached,
    tucked,
    objectives,
    coins,
    bonusVP,
    leftovers,
    total,
    visibleDragons: dragons.length,
  };
}

export function scoreGame(state: GameState): { scores: ScoreBreakdown[]; winners: import('./types').PlayerId[] } {
  const scores = state.players.map((p) => scorePlayer(state, p));
  const max = Math.max(...scores.map((s) => s.total));
  let winners = scores.filter((s) => s.total === max).map((s) => s.playerId);
  if (winners.length > 1) {
    const maxDragons = Math.max(...winners.map((id) => scores.find((s) => s.playerId === id)!.visibleDragons));
    winners = winners.filter((id) => scores.find((s) => s.playerId === id)!.visibleDragons === maxDragons);
  }
  return { scores, winners };
}
