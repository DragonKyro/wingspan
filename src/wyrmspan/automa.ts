// Official Wyrmspan Automa solo mode (Base + Ravel Mode + Dragon Academy).
//
// Sources:
//   - Base Wyrmspan Automa rulebook (docs/extracted/dragon automa.txt, dragon_automa_p01..p08.png)
//   - Dragon Academy Automa rules (docs/extracted/academy.txt, academy_p06..p08.png)

import { GUILD_TILES, GUILD_TRACK } from './guild';
import { clone, drawCards, log, player, setPlayer, shuffle } from './helpers';
import type {
  AutomaCardDef,
  AutomaCardId,
  AutomaDifficulty,
  GameState,
  PlayerId,
  Step,
} from './types';

// ---------------------------------------------------------------------------
// 16 Automa Decision Cards (8 base, 3 increased-difficulty, 5 Ravel Mode)
// ---------------------------------------------------------------------------

export const AUTOMA_CARDS: Record<AutomaCardId, AutomaCardDef> = {
  // Base decision cards (1..8)
  '1': {
    id: '1',
    passIfLast: false,
    refreshDragons: false,
    objectiveCoinDelta: 0,
    guildSteps: { kind: 'byRound', steps: [1, 2, 2, 2] },
    brownSpace: { dragonSlot: 3, caveSlot: null, guildOval: 1 },
  },
  '2': {
    id: '2',
    passIfLast: true,
    refreshDragons: false,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'byRound', steps: [1, 2, 2, 2] },
    brownSpace: { dragonSlot: 2, caveSlot: 2, guildOval: 2 },
  },
  '3': {
    id: '3',
    passIfLast: true,
    refreshDragons: true,
    objectiveCoinDelta: 0,
    guildSteps: { kind: 'byRound', steps: [1, 2, 2, 3] },
    brownSpace: { dragonSlot: 1, caveSlot: 1, guildOval: 3 },
  },
  '4': {
    id: '4',
    passIfLast: false,
    refreshDragons: false,
    objectiveCoinDelta: -1,
    guildSteps: { kind: 'byRound', steps: [1, 1, 2, 2] },
    brownSpace: { dragonSlot: 3, caveSlot: null, guildOval: 1 },
  },
  '5': {
    id: '5',
    passIfLast: true,
    refreshDragons: false,
    objectiveCoinDelta: 0,
    guildSteps: { kind: 'byRound', steps: [1, 1, 2, 2] },
    brownSpace: { dragonSlot: 2, caveSlot: 3, guildOval: 2 },
  },
  '6': {
    id: '6',
    passIfLast: true,
    refreshDragons: true,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'byRound', steps: [1, 1, 2, 3] },
    brownSpace: { dragonSlot: 1, caveSlot: null, guildOval: 3 },
  },
  '7': {
    id: '7',
    passIfLast: true,
    refreshDragons: true,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'byRound', steps: [1, 1, 2, 3] },
    brownSpace: { dragonSlot: 2, caveSlot: null, guildOval: 2 },
  },
  '8': {
    id: '8',
    passIfLast: false,
    refreshDragons: true,
    objectiveCoinDelta: -1,
    guildSteps: { kind: 'byRound', steps: [1, 2, 3, 3] },
    brownSpace: { dragonSlot: 1, caveSlot: 2, guildOval: 1 },
  },

  // Increased difficulty cards (1/4, 2/5, 3/6)
  '1/4': {
    id: '1/4',
    passIfLast: false,
    refreshDragons: false,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'byRound', steps: [2, 2, 2, 3] },
    brownSpace: { dragonSlot: 3, caveSlot: 1, guildOval: 1 },
  },
  '2/5': {
    id: '2/5',
    passIfLast: true,
    refreshDragons: false,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'byRound', steps: [1, 2, 3, 3] },
    brownSpace: { dragonSlot: 2, caveSlot: 2, guildOval: 2 },
  },
  '3/6': {
    id: '3/6',
    passIfLast: true,
    refreshDragons: true,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'byRound', steps: [2, 2, 3, 3] },
    brownSpace: { dragonSlot: 1, caveSlot: 3, guildOval: 3 },
  },

  // Ravel Mode cards (R1/4, R2, R2/5, R3/6, R8)
  'R1/4': {
    id: 'R1/4',
    passIfLast: false,
    refreshDragons: false,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'mostExcavated', bonus: 0 },
    brownSpace: { dragonSlot: 3, caveSlot: null, guildOval: 1 },
  },
  'R2': {
    id: 'R2',
    passIfLast: true,
    refreshDragons: false,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'leastExcavated', bonus: 0 },
    brownSpace: { dragonSlot: 2, caveSlot: 2, guildOval: null },
  },
  'R2/5': {
    id: 'R2/5',
    passIfLast: true,
    refreshDragons: false,
    objectiveCoinDelta: 1,
    guildSteps: { kind: 'mostExcavated', bonus: 0 },
    brownSpace: { dragonSlot: 2, caveSlot: 2, guildOval: 2 },
  },
  'R3/6': {
    id: 'R3/6',
    passIfLast: true,
    refreshDragons: false,
    objectiveCoinDelta: 0,
    guildSteps: { kind: 'mostExcavated', bonus: 0 },
    brownSpace: { dragonSlot: 1, caveSlot: 1, guildOval: null },
  },
  'R8': {
    id: 'R8',
    passIfLast: false,
    refreshDragons: true,
    objectiveCoinDelta: -1,
    guildSteps: { kind: 'mostExcavated', bonus: 1 },
    brownSpace: { dragonSlot: 1, caveSlot: 3, guildOval: 3 },
  },
};

export const AUTOMA_CARD_IDS = Object.keys(AUTOMA_CARDS) as AutomaCardId[];

// ---------------------------------------------------------------------------
// Deck construction per Difficulty Level & Ravel Mode (dragon_automa_p02 & p06)
// ---------------------------------------------------------------------------

export function automaCardIdsForConfig(
  difficulty: AutomaDifficulty = 1,
  ravelMode = false,
): AutomaCardId[] {
  if (ravelMode) {
    switch (difficulty) {
      case 1:
        return ['R1/4', 'R2', 'R3/6', '4', '5', '6', '7', 'R8'];
      case 2:
        return ['1', '2', '3', 'R1/4', 'R2/5', 'R3/6', '7', 'R8'];
      case 3:
        return ['R1/4', 'R2/5', 'R3/6', '1/4', '2/5', '3/6', '7', 'R8'];
    }
  }
  switch (difficulty) {
    case 1:
      return ['1', '2', '3', '4', '5', '6', '7', '8'];
    case 2:
      return ['1/4', '2/5', '3/6', '4', '5', '6', '7', '8'];
    case 3:
      return ['1', '2', '3', '1/4', '2/5', '3/6', '7', '8'];
  }
}

/**
 * Shuffle the 8-card Automa decision deck, set 1 card off to the side unseen,
 * and return the remaining 7 cards as the active round decision deck.
 */
export function buildAutomaRoundDeck(
  state: GameState,
  allCards: readonly AutomaCardId[],
): [{ deck: AutomaCardId[]; setAside: AutomaCardId; discard: AutomaCardId[] }, GameState] {
  const [shuffled, s2] = shuffle(state, allCards);
  const setAside = shuffled[0]!;
  const deck = shuffled.slice(1);
  return [{ deck, setAside, discard: [] }, s2];
}

// ---------------------------------------------------------------------------
// Guild Track Step Computation & Brown Space Resolution
// ---------------------------------------------------------------------------

/** Compute the number of Dragon Guild steps Automa advances for `card`. */
export function computeAutomaGuildSteps(state: GameState, card: AutomaCardDef): number {
  const gs = card.guildSteps;
  if (gs.kind === 'byRound') {
    const idx = Math.max(0, Math.min(3, state.round - 1));
    return gs.steps[idx]!;
  }
  const p1 = player(state, 'p1');
  const excavatedCounts = p1.caves.map((row) => row.spaces.filter((sp) => sp.excavated).length);
  if (gs.kind === 'mostExcavated') {
    return Math.max(1, Math.max(...excavatedCounts) + (gs.bonus ?? 0));
  }
  // leastExcavated: rulebook notes her token always advances at least 1 space.
  return Math.max(1, Math.min(...excavatedCounts) + (gs.bonus ?? 0));
}

/**
 * Place 1 of Automa's available guild markers onto `state.guild.squares` using
 * the oval number (counting rows with at least one available space from top to
 * bottom, wrapping around). Automa does not gain any benefits shown on the tile.
 */
export function placeAutomaGuildMarker(state: GameState, guildOval: number): GameState {
  if (!state.automa || state.automa.availableGuildMarkers <= 0) return state;
  const p2 = player(state, 'p2');
  if (p2.guildMarkersPlaced >= 4) return state;

  const tile = GUILD_TILES[state.guild.tile];
  const availIndices = tile.squares
    .map((sq, idx) => (sq.unlimited || (state.guild.squares[idx] ?? []).length === 0 ? idx : -1))
    .filter((idx) => idx >= 0);
  if (availIndices.length === 0) return state;

  const count = Math.max(1, guildOval);
  const targetIdx = availIndices[(count - 1) % availIndices.length]!;
  const squares = state.guild.squares.map((row, idx) => (idx === targetIdx ? [...row, 'p2' as PlayerId] : [...row]));

  const q2 = clone(p2);
  q2.guildMarkersPlaced += 1;
  let s = setPlayer(state, q2);
  s = {
    ...s,
    guild: { ...s.guild, squares },
    automa: {
      ...s.automa!,
      availableGuildMarkers: s.automa!.availableGuildMarkers - 1,
    },
  };
  return log(s, `Automa placed a guild marker on square ${targetIdx + 1}`);
}

/** Automa takes the display card in `slot` (1-based; the first card shown
 *  when that slot is empty) and immediately refills the gap from the deck. */
function automaTakeFromDisplay(state: GameState, deck: 'dragon' | 'cave', slot: number): GameState {
  const key = deck === 'dragon' ? 'dragonDisplay' : 'caveDisplay';
  const disp = [...state[key]];
  const idx = disp[slot - 1] != null ? slot - 1 : disp.findIndex((c) => c !== null);
  const takenId = idx >= 0 ? disp[idx]! : null;
  if (idx >= 0) disp[idx] = null;
  const [refill, s] = drawCards({ ...state, [key]: disp }, deck, 1);
  const refillIdx = disp.indexOf(null);
  if (refillIdx >= 0 && refill[0] !== undefined) disp[refillIdx] = refill[0];
  const a = s.automa!;
  const automa =
    deck === 'dragon'
      ? { ...a, collectedDragons: a.collectedDragons + 1, dragonCards: takenId !== null ? [...a.dragonCards, takenId] : a.dragonCards }
      : { ...a, collectedCaves: a.collectedCaves + 1, caveCards: takenId !== null ? [...a.caveCards, takenId] : a.caveCards };
  return log({ ...s, [key]: disp, automa }, `Automa took ${deck === 'dragon' ? 'dragon' : 'cave card'} from display slot ${slot}`);
}

/**
 * Resolve the `IF BROWN SPACE` section of `card` after Automa's guild token
 * finishes advancing and has moved onto or past either brown space (0 or 6).
 */
export function resolveAutomaBrownSpace(state: GameState, card: AutomaCardDef): GameState {
  if (!state.automa) return state;
  let s = state;

  // 1–2. Take the dragon / cave card from display[slot - 1] and refill that slot.
  if (card.brownSpace.dragonSlot !== null) s = automaTakeFromDisplay(s, 'dragon', card.brownSpace.dragonSlot);
  if (card.brownSpace.caveSlot !== null) s = automaTakeFromDisplay(s, 'cave', card.brownSpace.caveSlot);

  // 3. Place a guild marker if available.
  if (card.brownSpace.guildOval !== null) {
    s = placeAutomaGuildMarker(s, card.brownSpace.guildOval);
  }

  return s;
}

// ---------------------------------------------------------------------------
// Automa Turn Execution
// ---------------------------------------------------------------------------

/** Mark Automa as passed; with Dragon Academy in Rounds 1-3, block 6-coin income if passing before p1. */
export function passAutoma(state: GameState, playerId: PlayerId = 'p2'): GameState {
  let s = state;
  const p = clone(player(s, playerId));
  p.passed = true;
  s = setPlayer(s, p);
  s = log(s, `${p.name} passed`);

  // Dragon Academy (academy_p06.png): "If Automa passes before you do, you may
  // not choose a 6-coin income space when you pass. When she passes first,
  // place Automa's adventurer onto the 6-coin income space (either one for
  // Round 3) as a reminder. Automa does not collect the income when her
  // adventurer is retrieved."
  if (s.expansions.includes('academy') && s.round <= 3 && !player(s, 'p1').passed) {
    s = {
      ...s,
      incomeChoices: { ...s.incomeChoices, [playerId]: 5 },
    };
    s = log(s, 'Automa placed her adventurer on the 6-coin income space as a reminder');
  }
  return s;
}

/** Execute one Automa turn (draw/resolve top decision card, or pass). */
export function executeAutomaTurn(state: GameState, playerId: PlayerId = 'p2'): GameState {
  if (!state.automa) return state;
  let s = state;
  const p = player(s, playerId);
  if (p.passed) return s;

  // If the decision deck is empty, she passes.
  if (s.automa!.deck.length === 0) {
    return passAutoma(s, playerId);
  }

  // Draw the top card from the decision deck.
  const cardId = s.automa!.deck[0]!;
  const remaining = s.automa!.deck.slice(1);
  const card = AUTOMA_CARDS[cardId];
  s = {
    ...s,
    automa: {
      ...s.automa!,
      deck: remaining,
      discard: [...s.automa!.discard, cardId],
      lastCard: cardId,
    },
  };
  s = log(s, `Automa drew decision card ${cardId}`);

  // PASS ICON: If the decision deck is now empty and the pass icon is at the
  // top of the card, she passes and does not perform any actions.
  if (remaining.length === 0 && card.passIfLast) {
    return passAutoma(s, playerId);
  }

  // 1. ACTION: REFRESH DRAGON CARDS
  if (card.refreshDragons) {
    const leftover = s.dragonDisplay.filter((c): c is number => c !== null);
    s = {
      ...s,
      dragonDisplay: [null, null, null],
      dragonDiscard: [...s.dragonDiscard, ...leftover],
    };
    const [drawn, s2] = drawCards(s, 'dragon', 3);
    s = { ...s2, dragonDisplay: drawn };
    s = log(s, 'Automa refreshed the dragon display');
  }

  // 2. ACTION: ADJUST OBJECTIVE MARKER
  if (card.objectiveCoinDelta !== 0) {
    const nextCoins = Math.max(0, s.automa!.objectiveCoins + card.objectiveCoinDelta);
    s = {
      ...s,
      automa: { ...s.automa!, objectiveCoins: nextCoins },
    };
    s = log(
      s,
      card.objectiveCoinDelta > 0
        ? `Automa placed 1 objective coin (now ${nextCoins})`
        : `Automa removed 1 objective coin (now ${nextCoins})`,
    );
  }

  // 3. ACTION: ADVANCE ON DRAGON GUILD TRACK
  const steps = computeAutomaGuildSteps(s, card);
  let pos = s.guild.track[playerId] ?? 0;
  let hitBrown = false;
  for (let i = 0; i < steps; i++) {
    pos = (pos + 1) % GUILD_TRACK.length;
    if (GUILD_TRACK[pos]?.brown) {
      hitBrown = true;
    }
  }
  s = {
    ...s,
    guild: { ...s.guild, track: { ...s.guild.track, [playerId]: pos } },
  };
  s = log(s, `Automa advanced ${steps} step(s) on the Dragon Guild track to space ${pos}`);

  // 4. BROWN SPACES ON THE DRAGON GUILD TRACK
  if (hitBrown) {
    s = resolveAutomaBrownSpace(s, card);
  }

  return s;
}

// ---------------------------------------------------------------------------
// Dragon Academy: Automa's Cache
// ---------------------------------------------------------------------------

function countItemsInSteps(steps: Step[]): number {
  let total = 0;
  for (const st of steps) {
    switch (st.op) {
      case 'gain':
        total += st.items.reduce((a, it) => a + it.count, 0);
        break;
      case 'layEggs':
        total += st.count;
        break;
      case 'chooseBenefits': {
        const perPick = st.options[0]?.reduce((a, it) => a + it.count, 0) ?? 1;
        total += st.count * perPick;
        break;
      }
      case 'trainFledgling':
        total += typeof st.times === 'number' ? st.times : 1;
        break;
      case 'pay':
        total += countItemsInSteps(st.then);
        break;
      default:
        break;
    }
  }
  return Math.max(1, total);
}

/**
 * Compute how many cache tokens Automa gains from an `opponentsMay` step
 * under Dragon Academy rules (academy_p07.png):
 *   - If she must pay a cost to gain something: 1 cache token per thing gained.
 *   - Otherwise: 2 cache tokens per thing gained.
 */
export function automaCacheTokensForMaySteps(steps: Step[]): number {
  const hasCost = steps.some((st) => st.op === 'pay' || st.op === 'discardFromHand');
  const things = countItemsInSteps(steps);
  return (hasCost ? 1 : 2) * things;
}

/** Award `tokens` cache tokens to Automa when Dragon Academy is enabled. */
export function grantAutomaCacheTokens(state: GameState, tokens: number): GameState {
  if (!state.automa || !state.expansions.includes('academy') || tokens <= 0) return state;
  const s: GameState = {
    ...state,
    automa: {
      ...state.automa,
      cacheTokens: state.automa.cacheTokens + tokens,
    },
  };
  return log(s, `Automa gained ${tokens} cache token(s) (now ${s.automa!.cacheTokens})`);
}
