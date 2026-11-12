// End-game scoring per the rulebook:
//   guild-tile end-game squares where the player placed markers
//   printed VP on visible dragons (fledglings score 1 VP per fledgling instead)
//   EndGame abilities on visible dragons
//   1 VP per egg, cached resource, tucked card
//   objective VP banked during the game
//   1 VP per remaining coin + 1 VP per 4 remaining items (round down)
// Tiebreak: most visible dragons on the mat.

import { parseAbility } from './abilities';
import { dragonCard, isDragonCard, parseIcons } from './cards';
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
  if (state.automa && p.id === 'p2') {
    const automa = state.automa;
    const dragonVpPer = automa.difficulty === 3 && !automa.ravelMode ? 8 : 7;
    const printedDragonVp = automa.collectedDragons * dragonVpPer;
    const tucked = automa.collectedCaves * 2;
    const cached = state.expansions.includes('academy') ? Math.floor(automa.cacheTokens / 2) : 0;

    // 1 VP for each step beyond the last brown space visited (0 if on space 0 or 6).
    const guildPos = state.guild.track.p2 ?? 0;
    let guildTile = guildPos % 6;

    // In Ravel Mode only, score VP for any of her markers on the Dragon Guild
    // tile placed on fixed VP end-game benefits.
    if (automa.ravelMode) {
      const tile = GUILD_TILES[state.guild.tile];
      state.guild.squares.forEach((occupants, i) => {
        const n = occupants.filter((id) => id === p.id).length;
        if (n <= 0) return;
        const eg = tile.squares[i]?.endGame;
        if (eg && !eg.counter && !eg.gamblerDraw4) {
          guildTile += n * (eg.flat ?? eg.vpPer);
        }
      });
    }

    const objectives = p.objectiveVps.reduce((a, b) => a + b, 0);
    const endGameAbilities = 0;
    const eggs = 0;
    const coins = 0;
    const leftovers = 0;
    const bonusVP = p.bonusVP;
    const total =
      guildTile +
      printedDragonVp +
      endGameAbilities +
      eggs +
      cached +
      tucked +
      objectives +
      coins +
      leftovers +
      bonusVP;

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
      visibleDragons: automa.collectedDragons,
    };
  }

  const dragons = allDragons(p);

  // Guild tile squares the player marked.
  let guildTile = 0;
  const tile = GUILD_TILES[state.guild.tile];
  state.guild.squares.forEach((occupants, i) => {
    const n = occupants.filter((id) => id === p.id).length;
    if (n <= 0) return;
    const eg = tile.squares[i]?.endGame;
    if (!eg) return;
    if (eg.gamblerDraw4) {
      const banked = state.guild.gamblerVp?.[p.id];
      if (banked !== undefined) {
        guildTile += banked;
      } else {
        // Fallback when a marker was placed directly in state without running immediate step.
        const vps = state.dragonDeck
          .slice(0, 4 * n)
          .map((id) => dragonVp(p, dragonCard(id)))
          .sort((a, b) => b - a);
        guildTile += vps.slice(0, 2 * n).reduce((a, b) => a + b, 0);
      }
      return;
    }
    let units = eg.counter ? countCounter(state, p, eg.counter) : 1;
    if (eg.divisor) units = Math.floor(units / eg.divisor);
    let pts = eg.vpPer * units;
    if (eg.max !== undefined) pts = Math.min(pts, eg.max);
    guildTile += n * pts;
  });

  // Printed dragon VP + end-game abilities.
  let printedDragonVp = 0;
  let endGameAbilities = 0;
  let remDragonCards = p.hand.filter(isDragonCard).length;
  let remCaveCards = p.hand.filter((id) => !isDragonCard(id)).length;
  let remResources = RESOURCES.reduce((a, r) => a + p.resources[r], 0);
  for (const d of dragons) {
    const card = dragonCard(d.dragon.cardId);
    printedDragonVp += dragonVp(p, card);
    const active =
      card.size !== 'Fledgling' ||
      !card.trainingTrack ||
      (d.dragon.training ?? 0) >= parseIcons(card.trainingTrack).length;
    if (!active) continue;
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
    } else if (card.abilityType === 'EndGame') {
      // Pay-for-VP EndGame dragons (Northern Cavalier Wyvern 85, Equatorial
      // Cavalier Wyvern 86, Playful Hornwyrn 143, Ophidian Recluse 148):
      // paying items for VP is always strictly better than 1 VP per 4 leftovers.
      if (card.id === 85) {
        if (remDragonCards >= 2) {
          remDragonCards -= 2;
          endGameAbilities += 3;
        } else if (remDragonCards >= 1) {
          remDragonCards -= 1;
          endGameAbilities += 1;
        }
      } else if (card.id === 86) {
        if (remCaveCards >= 2) {
          remCaveCards -= 2;
          endGameAbilities += 3;
        } else if (remCaveCards >= 1) {
          remCaveCards -= 1;
          endGameAbilities += 1;
        }
      } else if (card.id === 143) {
        if (remResources >= 2) {
          remResources -= 2;
          endGameAbilities += 3;
        } else if (remResources >= 1) {
          remResources -= 1;
          endGameAbilities += 1;
        }
      } else if (card.id === 148) {
        if (remResources >= 1 && remCaveCards >= 1 && remDragonCards >= 1) {
          remResources -= 1;
          remCaveCards -= 1;
          remDragonCards -= 1;
          endGameAbilities += 5;
        }
      }
    }
  }

  const eggs = p.nestEggs + dragons.reduce((a, d) => a + d.dragon.eggs, 0);
  const cached = dragons.reduce((a, d) => a + d.dragon.cached.length, 0);
  const tucked = dragons.reduce((a, d) => a + d.dragon.tucked.length, 0);
  const objectives = p.objectiveVps.reduce((a, b) => a + b, 0);
  const coins = p.coins;
  const handAndResources = remDragonCards + remCaveCards + remResources;
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
    // Automa tiebreaker (dragon automa.txt line 449): "In the event of a tie, you win!"
    if (state.automa && winners.includes('p1')) {
      winners = ['p1'];
    } else {
      const maxDragons = Math.max(...winners.map((id) => scores.find((s) => s.playerId === id)!.visibleDragons));
      winners = winners.filter((id) => scores.find((s) => s.playerId === id)!.visibleDragons === maxDragons);
    }
  }
  return { scores, winners };
}
