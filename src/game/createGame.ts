// Deterministic game setup from a numeric seed.

import { birdsInSets, bonusCardsInSets, goalsForSets } from './cards';
import { CUBES_PER_ROUND } from './constants';
import { rollBirdfeeder, rngInt, shuffle } from './rng';
import type {
  CreateGameOptions,
  GameState,
  GoalTile,
  PlayerState,
} from './types';
import { BASE_DIE_FACES } from './types';

export function createGame(opts: CreateGameOptions): GameState {
  let rng = opts.seed >>> 0;

  const sets = opts.settings?.sets ?? ['core'];
  const settings = {
    sets,
    goalSide: 'green' as const,
    aiLevel: opts.settings?.aiLevel,
  };

  // Decks.
  let deck: number[];
  [deck, rng] = shuffle(rng, birdsInSets(sets));
  let bonusDeck: number[];
  [bonusDeck, rng] = shuffle(rng, bonusCardsInSets(sets));

  // Goal tiles: 4 supported, non-blank tiles.
  const goalPool = goalsForSets(sets).filter(
    (g: GoalTile) => g.goal.kind !== 'noGoal',
  );
  let shuffledGoals: GoalTile[];
  [shuffledGoals, rng] = shuffle(rng, goalPool);
  const goalTiles = shuffledGoals.slice(0, 4).map((g) => g.id);

  // Feeder: roll 5 dice.
  let feederIn;
  [feederIn, rng] = rollBirdfeeder(rng, BASE_DIE_FACES, 5);

  // Tray: 3 face-up cards (top of deck = end of array).
  const tray = [deck.pop()!, deck.pop()!, deck.pop()!];

  const players: PlayerState[] = opts.playerNames.map((name, i) => {
    const hand = deck.splice(0, 5);
    const bonusHand = bonusDeck.splice(0, 2);
    return {
      id: `p${i + 1}` as PlayerState['id'],
      name,
      color: opts.playerColors[i]!,
      isAI: opts.playerTypes[i] === 'ai',
      hand,
      bonusHand,
      food: { invertebrate: 1, seed: 1, fish: 1, fruit: 1, rodent: 1, nectar: 0 },
      board: { forest: [], grassland: [], wetland: [] },
      actionCubes: CUBES_PER_ROUND[0]!,
      endOfTurnDiscards: 0,
      cubesOnPlayBird: 0,
      nectarSpent: { forest: 0, grassland: 0, wetland: 0 },
    };
  });

  let startIdx;
  [startIdx, rng] = rngInt(rng, players.length);

  const playerOrder = players.map((p) => p.id);

  return {
    phase: 'setup',
    rngState: rng,
    playerOrder,
    currentPlayerIndex: startIdx,
    round: 0,
    players,
    deck,
    tray,
    discard: [],
    feederIn,
    feederOut: [],
    bonusDeck,
    goalTiles,
    goalScores: [],
    pending: [],
    activation: null,
    turnTookAction: false,
    setupRemaining: playerOrder.slice(),
    roundEndQueue: [],
    gameEndQueue: null,
    settings,
    winner: null,
    finalScores: null,
    log: [],
  };
}
