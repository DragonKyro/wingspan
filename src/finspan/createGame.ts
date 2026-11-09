// Deterministic game setup: shuffle starter + main decks, deal 2 starters +
// 3 main fish per player, place forage fish and starting tokens, and pick
// the week's achievements (fixed side A, or 3 drawn tiles on side B).

import { rngInt, shuffle } from '../game/rng';
import { ACHIEVEMENTS, fishIdsInSets, sideBTilePool } from './cards';
import { REEF_DISCARD_ITEMS, SETUP_MAIN_CARDS, SETUP_STARTER_CARDS } from './constants';
import { buildInitialOcean } from './helpers';
import type { Achievement, CreateGameOptions, GameSettings, GameState, PlayerId, PlayerState } from './types';

export function createGame(opts: CreateGameOptions): GameState {
  const n = opts.playerNames.length;
  if (n < 1 || n > 6) throw new Error('Finspan supports 1-5 players (6 for engine testing)');

  const settings: GameSettings = {
    sets: opts.settings?.sets ?? ['base'],
    achievementSide: opts.settings?.achievementSide ?? 'A',
    reefCosts: opts.settings?.reefCosts,
    aiLevel: opts.settings?.aiLevel ?? 1,
  };

  let rng = opts.seed >>> 0;

  const playerOrder = opts.playerNames.map((_, i) => `p${i + 1}` as PlayerId);
  const players: PlayerState[] = opts.playerNames.map((name, i) => ({
    id: playerOrder[i]!,
    name,
    color: opts.playerColors[i] ?? `c${i}`,
    isAI: (opts.playerTypes[i] ?? 'human') === 'ai',
    hand: [],
    discard: [],
    ocean: buildInitialOcean(),
    diversUsed: 0,
    bottomTaken: [false, false, false],
    achievementPoints: 0,
  }));

  // Deal 2 starter fish to each player from the (shared) starter deck.
  let starters: number[];
  [starters, rng] = shuffle(rng, fishIdsInSets(settings.sets, 'starter'));
  let si = 0;
  for (const p of players) {
    p.hand.push(...starters.slice(si, si + SETUP_STARTER_CARDS));
    si += SETUP_STARTER_CARDS;
  }

  // Main deck; deal 3 to each player (draw = pop from the end).
  let deck: number[];
  [deck, rng] = shuffle(rng, fishIdsInSets(settings.sets, 'main'));
  for (const p of players) {
    for (let i = 0; i < SETUP_MAIN_CARDS; i++) p.hand.push(deck.pop()!);
  }

  // Achievements for weeks 1-3.
  let achievements: Achievement[];
  if (settings.achievementSide === 'A') {
    achievements = ACHIEVEMENTS.sideA;
  } else {
    achievements = [];
    for (let week = 1; week <= 3; week++) {
      const pool = sideBTilePool(week, settings.sets);
      const [drawn, rng2] = shuffle(rng, pool);
      rng = rng2;
      achievements.push(drawn[0]!);
    }
  }

  // S&R: "each player places either side of any coral reef overlay on their
  // ocean mat" — overlays differ per player/side. The printed discard-item
  // combos aren't enumerated in the rulebook (they're artwork), so when the
  // caller didn't supply explicit reefCosts we approximate by drawing each
  // dive site's item independently from {egg, young, card} with the seeded
  // RNG (kept after the deck/tile draws so base-game RNG use is unchanged).
  if (settings.sets.includes('sr') && !settings.reefCosts) {
    const items = REEF_DISCARD_ITEMS;
    settings.reefCosts = playerOrder.map(() => {
      const row: ('egg' | 'young' | 'card')[] = [];
      for (let col = 0; col < items.length; col++) {
        const [v, r] = rngInt(rng, items.length);
        rng = r;
        row.push(items[v]!);
      }
      return row;
    });
  }

  return {
    phase: 'main',
    rngState: rng,
    week: 0,
    playerOrder,
    currentPlayerIndex: 0,
    firstPlayerIndex: 0,
    players,
    deck,
    achievements,
    pending: [],
    gameEndQueue: null,
    turnTookAction: false,
    settings,
    winner: null,
    finalScores: null,
    log: [{ seq: 0, msg: `game created (week 1, ${settings.sets.join('+')})` }],
  };
}
