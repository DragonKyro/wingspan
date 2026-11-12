// Deterministic game setup from a numeric seed.

import { automaDeckIds, isAutomaBonusEligible } from './automa';
import { birdsInSets, bonusCardsInSets, goalsForSets, hummingbirdsInSets } from './cards';
import { CUBES_PER_ROUND, HUM_GARDEN_SLOTS } from './constants';
import { DUET_MAP, DUET_TILE_PAIRS } from './duetMap';
import { rollBirdfeeder, rngInt, shuffle } from '../shared/rng';
import type {
  AutomaState,
  CreateGameOptions,
  GameMode,
  GameState,
  GoalTile,
  PlayerColor,
  PlayerState,
} from './types';
import { BASE_DIE_FACES, OCEANIA_DIE_FACES } from './types';

export function createGame(opts: CreateGameOptions): GameState {
  let rng = opts.seed >>> 0;

  const automaCfg = opts.settings?.automa;
  let playerNames = opts.playerNames.slice();
  let playerTypes = opts.playerTypes.slice();
  let playerColors: PlayerColor[] = opts.playerColors.slice();

  if (automaCfg != null) {
    if (playerNames.length === 1) {
      playerNames.push('Automa');
      playerTypes.push('ai');
      playerColors.push(playerColors[0] === 'red' ? 'blue' : 'red');
    } else if (playerNames.length === 2) {
      playerTypes[1] = 'ai';
      if (!playerColors[1]) playerColors[1] = playerColors[0] === 'red' ? 'blue' : 'red';
    } else {
      throw new Error('automa mode requires 1 player');
    }
  }

  const mode: GameMode = opts.settings?.mode ?? 'standard';
  let sets = opts.settings?.sets ?? ['core'];
  // Duet/flock are Asia expansion modes — force the asia deck in.
  if ((mode === 'duet' || mode === 'flock') && !sets.includes('asia')) {
    sets = [...sets, 'asia'];
  }

  // Player-count validation per mode.
  if (mode === 'duet' && playerNames.length !== 2) {
    throw new Error('duet mode requires exactly 2 players');
  }
  if (mode === 'flock' && (playerNames.length < 6 || playerNames.length > 7)) {
    throw new Error('flock mode requires 6-7 players');
  }
  if (mode === 'standard' && (playerNames.length < 1 || playerNames.length > 5)) {
    throw new Error('standard mode requires 1-5 players');
  }

  const settings = {
    sets,
    goalSide: opts.settings?.goalSide ?? 'green',
    mode,
    aiLevel: opts.settings?.aiLevel,
    ...(automaCfg != null ? { automa: automaCfg } : {}),
  };

  // Decks.
  let deck: number[];
  [deck, rng] = shuffle(rng, birdsInSets(sets));
  let bonusDeck: number[];
  [bonusDeck, rng] = shuffle(rng, bonusCardsInSets(sets));

  // Automa setup: draw an eligible "% of cards" bonus card before dealing to p1,
  // and shuffle the Automa decision deck.
  let automa: AutomaState | undefined;
  if (automaCfg != null) {
    const skippedBonus: number[] = [];
    let automaBonusId: number | null = null;
    while (bonusDeck.length > 0) {
      const candidate = bonusDeck.pop()!;
      if (isAutomaBonusEligible(candidate)) {
        automaBonusId = candidate;
        break;
      }
      skippedBonus.push(candidate);
    }
    if (skippedBonus.length > 0) {
      [bonusDeck, rng] = shuffle(rng, [...bonusDeck, ...skippedBonus]);
    }
    if (automaBonusId == null) automaBonusId = 1000;

    let automaDeck: number[];
    [automaDeck, rng] = shuffle(rng, automaDeckIds(Boolean(automaCfg.automubonSociety)));
    automa = {
      difficulty: automaCfg.difficulty ?? 'eagle',
      bonusCardId: automaBonusId,
      deck: automaDeck,
      discard: [],
      lastCardId: null,
      faceUpBirds: [],
      faceDownBirds: 0,
      eggs: 0,
      goalCubes: 0,
      hoardTokens: 0,
      nectarSpent: { forest: 0, grassland: 0, wetland: 0 },
      humTrack: { bee: 0, brilliant: 0, emerald: 0, mango: 0, topaz: 0 },
    };
  }

  // Goal tiles: duet mode uses 4 of the 6 double-sided duet tiles (random
  // side each); other modes draw 4 supported tiles from the included sets.
  let goalTiles: number[];
  if (mode === 'duet') {
    const pairIdx = DUET_TILE_PAIRS.map((_, i) => i);
    let order: number[];
    [order, rng] = shuffle(rng, pairIdx);
    goalTiles = [];
    for (const i of order.slice(0, 4)) {
      let side: number;
      [side, rng] = rngInt(rng, 2);
      goalTiles.push(DUET_TILE_PAIRS[i]![side]!);
    }
  } else {
    const goalPool = goalsForSets(sets).filter(
      (g: GoalTile) => g.goal.kind !== 'noGoal' && g.goal.kind !== 'unsupported',
    );
    let shuffledGoals: GoalTile[];
    [shuffledGoals, rng] = shuffle(rng, goalPool);
    goalTiles = shuffledGoals.slice(0, 4).map((g) => g.id);
  }

  const oceania = sets.includes('oceania');
  const americas = sets.includes('americas');

  // Americas: shuffle the hummingbird mini-deck.
  let humDeck: number[];
  [humDeck, rng] = shuffle(rng, hummingbirdsInSets(sets));

  // Feeder: roll 5 dice (Oceania dice replace the split face with nectar).
  let feederIn;
  [feederIn, rng] = rollBirdfeeder(rng, oceania ? OCEANIA_DIE_FACES : BASE_DIE_FACES, 5);

  // Tray: 3 face-up cards (top of deck = end of array).
  const tray = [deck.pop()!, deck.pop()!, deck.pop()!];

  const players: PlayerState[] = playerNames.map((name, i) => {
    const isAutomaSeat = automa != null && i === 1;
    const hand = isAutomaSeat ? [] : deck.splice(0, 5);
    const bonusHand = isAutomaSeat ? [automa!.bonusCardId] : bonusDeck.splice(0, 2);
    return {
      id: `p${i + 1}` as PlayerState['id'],
      name,
      color: playerColors[i]!,
      isAI: isAutomaSeat || playerTypes[i] === 'ai',
      hand,
      bonusHand,
      // Oceania: each human/AI player starts with 1 nectar (Automa has no food supply).
      food: isAutomaSeat
        ? {
            invertebrate: 0,
            seed: 0,
            fish: 0,
            fruit: 0,
            rodent: 0,
            nectar: 0,
          }
        : {
            invertebrate: 1,
            seed: 1,
            fish: 1,
            fruit: 1,
            rodent: 1,
            nectar: oceania ? 1 : 0,
          },
      board: { forest: [], grassland: [], wetland: [] },
      actionCubes: CUBES_PER_ROUND[0]!,
      roundCubes: { forest: 0, grassland: 0, wetland: 0, playBird: 0 },
      gainedThisTurn: [],
      endOfTurnDiscards: 0,
      cubesOnPlayBird: 0,
      nectarSpent: { forest: 0, grassland: 0, wetland: 0 },
      feederGainedThisTurn: [],
      copiedBonus: [],
      // Americas: a random hummingbird starts on each non-Automa player's grassland space.
      humBoard: {
        forest: null,
        grassland: !isAutomaSeat && americas ? (humDeck.pop() ?? null) : null,
        wetland: null,
      },
      humTrack: { bee: 0, brilliant: 0, emerald: 0, mango: 0, topaz: 0 },
      humReturned: [],
      horneroEggs: [],
    };
  });

  // Americas: the garden holds one face-up hummingbird per slot.
  const humGarden = Array.from({ length: HUM_GARDEN_SLOTS }, () => {
    const id = americas ? humDeck.pop() : undefined;
    return id == null ? [] : [id];
  });

  let startIdx: number;
  if (automa != null) {
    // Automa rule: "You always go first."
    startIdx = 0;
  } else {
    [startIdx, rng] = rngInt(rng, players.length);
  }

  const playerOrder = players.map((p) => p.id);

  return {
    phase: 'setup',
    rngState: rng,
    playerOrder,
    currentPlayerIndex: startIdx,
    firstPlayerIndex: startIdx,
    round: 0,
    players,
    deck,
    tray,
    discard: [],
    feederIn,
    feederOut: [],
    bonusDeck,
    bonusDiscard: [],
    goalTiles,
    duet:
      mode === 'duet'
        ? { map: DUET_MAP.map(() => null), reset: [] }
        : undefined,
    ...(automa != null ? { automa } : {}),
    goalScores: [],
    pending: [],
    activation: null,
    turnTookAction: false,
    setupRemaining: automa != null ? [playerOrder[0]!] : playerOrder.slice(),
    roundEndQueue: [],
    gameEndQueue: null,
    humDeck,
    humDiscard: [],
    humGarden,
    humAction: null,
    settings,
    winner: null,
    finalScores: null,
    log: [],
  };
}
