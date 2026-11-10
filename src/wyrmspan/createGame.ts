// Game setup: mirrors the rulebook. Shuffle both decks, deal displays,
// pick 4 objective tiles and a guild tile, then give each player 6 coins,
// 1 nest egg, and a 6-card offer (3 dragons + 3 caves) from which they keep 4,
// followed by a choice of any 3 resources.

import { automaCardIdsForConfig, buildAutomaRoundDeck } from './automa';
import { CAVES, DRAGONS } from './cards';
import { BASE_GUILD_TILE_IDS, GUILD_TILES, GUILD_TILE_IDS } from './guild';
import { drawCards, shuffle } from './helpers';
import { OBJECTIVE_IDS } from './objectives';
import type { AutomaOptions, CaveRow, Expansion, GameState, PlayerId, PlayerState } from './types';

/**
 * Filter a card list by `expansions`, deduplicating replacement cards by
 * `card.number` so that when `'academy'` is enabled its updated versions
 * (dragons 119, 124, 131, 132, 134 and caves 50, 51) replace the base cards.
 */
export function selectDeckCards<T extends { id: number; number: number; expansion: Expansion }>(
  cards: readonly T[],
  expansions: readonly Expansion[],
): number[] {
  const inPool = cards.filter((c) => expansions.includes(c.expansion));
  const byNumber = new Map<number, T>();
  for (const c of inPool) {
    const prev = byNumber.get(c.number);
    if (!prev || c.expansion === 'academy') {
      byNumber.set(c.number, c);
    }
  }
  return Array.from(byNumber.values(), (c) => c.id);
}

export interface CreateGameOptions {
  seed?: number;
  playerNames?: string[];
  /** AI seat flags aligned with playerNames (default: none). */
  isAI?: boolean[];
  /** Card pools to include (default: both). */
  expansions?: Expansion[];
  /** Enable official solo Automa mode (Base, Ravel Mode, + Dragon Academy). */
  automa?: AutomaOptions;
}

const CAVE_COUNT = 3;
const SPACES_PER_CAVE = 4;

function emptyMat(): [CaveRow, CaveRow, CaveRow] {
  const row = (): CaveRow => ({
    // First (leftmost) space of each cave starts pre-excavated.
    spaces: Array.from({ length: SPACES_PER_CAVE }, (_, i) => ({
      excavated: i === 0,
      caveCardId: null,
      dragon: null,
    })),
  });
  return [row(), row(), row()];
}

export function createGame(opts: CreateGameOptions = {}): GameState {
  const seed = opts.seed ?? 42;
  const isAutoma = opts.automa !== undefined;
  let names = opts.playerNames ? [...opts.playerNames] : isAutoma ? ['Player 1', 'Automa'] : ['Player 1', 'Player 2'];
  if (isAutoma && names.length === 1) {
    names.push('Automa');
  }
  const expansions = opts.expansions ?? ['base', 'academy'];

  let state: GameState = {
    rngState: seed >>> 0,
    phase: 'setup',
    round: 1,
    turn: 'p1',
    turnIndex: 0,
    startPlayer: 'p1',
    playerOrder: names.map((_, i) => `p${i + 1}` as PlayerId),
    players: [],
    expansions,
    dragonDeck: [],
    caveDeck: [],
    dragonDisplay: [null, null, null],
    caveDisplay: [null, null, null],
    dragonDiscard: [],
    caveDiscard: [],
    objectives: [],
    guild: { tile: 'seafarers', squares: [], track: {} },
    pending: [],
    roundEndQueue: [],
    incomeChoices: {},
    incomeQueue: [],
    turnEnding: false,
    setupOffers: {},
    finalScores: null,
    winners: null,
    log: [],
  };

  // Decks (Academy replacement cards replace their base counterparts by card number).
  const dragonIds = selectDeckCards(DRAGONS, expansions);
  const caveIds = selectDeckCards(CAVES, expansions);
  const [dDeck, s1] = shuffle(state, dragonIds);
  state = s1;
  const [cDeck, s2] = shuffle(state, caveIds);
  state = { ...s2, dragonDeck: dDeck, caveDeck: cDeck };

  // Objectives: 4 random distinct. Fledgling objectives can't score without
  // the Academy expansion; "Position on Dragon Guild" (guildMarkers) is
  // incompatible with Automa rules (dragon automa.txt line 108).
  let objPool = expansions.includes('academy')
    ? OBJECTIVE_IDS
    : OBJECTIVE_IDS.filter((id) => id !== 'fledglingsOnMat' && id !== 'trainedFledglings');
  if (isAutoma) {
    objPool = objPool.filter((id) => id !== 'guildMarkers');
  }
  const [objs, s3] = shuffle(state, objPool);
  state = { ...s3, objectives: objs.slice(0, 4) };

  // Guild tile: random from base + enabled expansion tiles.
  {
    const tilePool = expansions.includes('academy') ? GUILD_TILE_IDS : BASE_GUILD_TILE_IDS;
    const [tiles, s4] = shuffle(state, tilePool);
    state = s4;
    const tile = tiles[0]!;
    state = {
      ...state,
      guild: {
        tile,
        squares: GUILD_TILES[tile].squares.map(() => []),
        track: {},
      },
    };
  }

  // Displays: 3 dragons + 3 caves face up.
  const [dDisp, s5] = drawCards(state, 'dragon', 3);
  state = { ...s5, dragonDisplay: dDisp };
  const [cDisp, s6] = drawCards(state, 'cave', 3);
  state = { ...s6, caveDisplay: cDisp };

  // Players.
  const players: PlayerState[] = names.map((name, i) => {
    const id = `p${i + 1}` as PlayerId;
    const automaSeat = isAutoma && id === 'p2';
    const p: PlayerState = {
      id,
      color: ['orange', 'blue', 'green', 'purple', 'red'][i % 5]!,
      name,
      isAI: automaSeat ? true : (opts.isAI?.[i] ?? false),
      coins: automaSeat ? 0 : 6,
      resources: { meat: 0, gold: 0, crystal: 0, milk: 0 },
      hand: [],
      caves: emptyMat(),
      nestEggs: automaSeat ? 0 : 1,
      explores: { crimson: 0, golden: 0, amethyst: 0 },
      passed: false,
      guildMarkersPlaced: 0,
      bonusVP: 0,
      objectiveVps: [],
      coinsSpentEntice: 0,
    };
    state.guild.track[id] = 0;
    return p;
  });
  state = { ...state, players };
  void CAVE_COUNT;

  // Deal 3 dragons + 3 caves to each human/normal player; they keep 4 of 6
  // (pending choice), then each picks any 3 resources. Automa gets no player
  // mat, starting hand, or starting resources.
  const setupPlayers = isAutoma ? players.filter((p) => p.id !== 'p2') : players;
  for (const p of setupPlayers) {
    const [dd, s7] = drawCards(state, 'dragon', 3);
    state = s7;
    const [cc, s8] = drawCards(state, 'cave', 3);
    state = s8;
    const offer = [...dd, ...cc];
    state.setupOffers[p.id] = offer;
    state.pending.push({ kind: 'setupCards', playerId: p.id, offer, keep: 4 });
  }
  for (const p of setupPlayers) {
    state.pending.push({ kind: 'setupResources', playerId: p.id, count: 3 });
  }

  if (isAutoma) {
    const difficulty = opts.automa?.difficulty ?? 1;
    const ravelMode = opts.automa?.ravelMode ?? false;
    const allCards = automaCardIdsForConfig(difficulty, ravelMode);
    const [built, sAuto] = buildAutomaRoundDeck(state, allCards);
    state = {
      ...sAuto,
      automa: {
        difficulty,
        ravelMode,
        allCards,
        deck: built.deck,
        discard: built.discard,
        setAside: built.setAside,
        lastCard: null,
        objectiveCoins: 0,
        availableGuildMarkers: 1,
        collectedDragons: 0,
        dragonCards: [],
        collectedCaves: 0,
        caveCards: [],
        cacheTokens: 0,
      },
    };
    // Dragon Academy (academy_p06.png): "Give a random player the start player
    // marker. It will rotate between you and Automa each round."
    // Base Automa (dragon automa.txt line 163): "You are the starting player
    // for every round."
    if (expansions.includes('academy')) {
      const [startOrder, sStart] = shuffle(state, state.playerOrder);
      const startPlayer = startOrder[0]!;
      state = {
        ...sStart,
        startPlayer,
        turn: startPlayer,
        turnIndex: state.playerOrder.indexOf(startPlayer),
      };
    } else {
      state.startPlayer = 'p1';
      state.turn = 'p1';
      state.turnIndex = 0;
    }
  } else {
    state.turn = state.playerOrder[0]!;
  }

  state.log.push('game created');
  return state;
}
