// Deterministic game setup: shuffle starter + main decks, deal 2 starters +
// 3 main fish per player, place forage fish and starting tokens, and pick
// the week's achievements (fixed side A, or 3 drawn tiles on side B).

import { shuffle } from '../shared/rng';
import { buildInitialNautoma } from './automa';
import { ACHIEVEMENTS, fishIdsInSets, sideBTilePool } from './cards';
import { REEF_OVERLAY_SIDES, SETUP_MAIN_CARDS, SETUP_STARTER_CARDS } from './constants';
import { buildInitialOcean } from './helpers';
import type {
  Achievement,
  CreateGameOptions,
  GameSettings,
  GameState,
  NautomaState,
  PlayerId,
  PlayerState,
} from './types';

export function createGame(opts: CreateGameOptions): GameState {
  const playerNames = [...opts.playerNames];
  const playerTypes = [...opts.playerTypes];
  const playerColors = [...opts.playerColors];
  if (opts.settings?.automa && playerNames.length === 1) {
    playerNames.push('Nautoma');
    playerTypes.push('ai');
    playerColors.push(opts.playerColors[1] ?? 'c1');
  }

  const n = playerNames.length;
  if (n < 1 || n > 6) throw new Error('Finspan supports 1-5 players (6 for engine testing)');

  const settings: GameSettings = {
    sets: opts.settings?.sets ?? ['base'],
    achievementSide: opts.settings?.achievementSide ?? 'A',
    reefCosts: opts.settings?.reefCosts,
    aiLevel: opts.settings?.aiLevel ?? 1,
    ...(opts.settings?.automa ? { automa: opts.settings.automa } : {}),
  };

  let rng = opts.seed >>> 0;

  const playerOrder = playerNames.map((_, i) => `p${i + 1}` as PlayerId);
  const players: PlayerState[] = playerNames.map((name, i) => ({
    id: playerOrder[i]!,
    name,
    color: playerColors[i] ?? `c${i}`,
    isAI: (settings.automa && i === 1) ? true : (playerTypes[i] ?? 'human') === 'ai',
    hand: [],
    discard: [],
    ocean: buildInitialOcean(),
    diversUsed: 0,
    bottomTaken: [false, false, false],
    achievementPoints: 0,
  }));

  // Deal 2 starter fish to each player from the (shared) starter deck
  // (Nautoma does not get an ocean mat or hand of cards).
  let starters: number[];
  [starters, rng] = shuffle(rng, fishIdsInSets(settings.sets, 'starter'));
  let si = 0;
  for (const p of players) {
    if (settings.automa && p.id === 'p2') continue;
    p.hand.push(...starters.slice(si, si + SETUP_STARTER_CARDS));
    si += SETUP_STARTER_CARDS;
  }

  // Main deck; deal 3 to each player (draw = pop from the end).
  let deck: number[];
  [deck, rng] = shuffle(rng, fishIdsInSets(settings.sets, 'main'));
  for (const p of players) {
    if (settings.automa && p.id === 'p2') continue;
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
  // ocean mat" — deal each player one of the printed overlay sides from
  // REEF_OVERLAY_SIDES when caller did not supply explicit reefCosts.
  if (settings.sets.includes('sr') && !settings.reefCosts) {
    const [sides, rng2] = shuffle(rng, REEF_OVERLAY_SIDES);
    rng = rng2;
    settings.reefCosts = playerOrder.map((_, i) => [...sides[i % sides.length]!]);
  }

  let nautoma: NautomaState | undefined;
  if (settings.automa) {
    const built = buildInitialNautoma(rng, settings.automa);
    nautoma = built.nautoma;
    rng = built.rng;
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
    ...(nautoma ? { nautoma } : {}),
    winner: null,
    finalScores: null,
    log: [{ seq: 0, msg: `game created (week 1, ${settings.sets.join('+')})` }],
  };
}
