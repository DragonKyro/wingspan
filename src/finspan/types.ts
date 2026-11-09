// Core types for the Finspan engine. Everything is JSON-serializable: the
// engine is a pure applyAction(state, action) => state reducer, so replays
// work by logging actions.

export type PlayerId = `p${number}`;

export type Zone = 'sunlight' | 'twilight' | 'midnight';
export const ZONES: Zone[] = ['sunlight', 'twilight', 'midnight'];

/** Dive site (column) colors, left to right. Column index = SITE_COLORS[i]. */
export type SiteColor = 'blue' | 'purple' | 'green';
export const SITE_COLORS: SiteColor[] = ['blue', 'purple', 'green'];

/** Number of slot rows on the ocean mat (0-2 sunlight, 3 twilight, 4-5 midnight). */
export const ROWS = 6;
export const COLS = 3;
export const TWILIGHT_ROW = 3;
export const MIDNIGHT_START_ROW = 4;
/** Top row (estuaries) and bottom row (deepwater) special slots. */
export const ESTUARY_ROW = 0;
export const DEEPWATER_ROW = 5;
export const DIVERS_PER_WEEK = 6;
export const WEEKS = 4;

/** A slot on a player's ocean mat: row (0-5) and column (0-2 = blue/purple/green). */
export interface SlotRef {
  row: number;
  col: number;
}

export function zoneOfRow(row: number): Zone {
  if (row <= 2) return 'sunlight';
  if (row === TWILIGHT_ROW) return 'twilight';
  return 'midnight';
}

export type FishSize = 'small' | 'medium' | 'large';

export interface FishCost {
  /** Discard N fish cards from hand (to personal discard pile). */
  cards: number;
  /** Remove N egg tokens from anywhere in your ocean. */
  eggs: number;
  /** Remove N young tokens from anywhere in your ocean. */
  young: number;
  /** Remove N school tokens from anywhere in your ocean. */
  schools: number;
  /** Placement must cover a shorter fish already in the ocean. */
  consume: boolean;
}

export interface CoralCost {
  site: SiteColor | 'any';
  count: number;
}

export interface FishTags {
  bioluminescent: number;
  camouflage: number;
  /** 1 = active electrolocation, 2 = electric discharge (counts as both for tags). */
  electric: number;
  /** 2 = uber predator (counts as predator for tag purposes). */
  predator: number;
  venomous: number;
}

export type AbilityType = 'WhenPlayed' | 'IfActivated' | 'GameEnd';

export interface FishCard {
  id: number;
  group: 'main' | 'starter' | 'forage';
  set: string;
  name: string;
  latin: string;
  points: number;
  /** Length in cm — decides what this fish may consume (must exceed covered fish). */
  length: number;
  size: FishSize;
  zones: { sunlight: boolean; twilight: boolean; midnight: 'any' | 'bottom' | false };
  cost: FishCost;
  /** S&R reef-fish requirement: play only in a site with >= count coral. */
  coralCost: CoralCost | null;
  /** Colored ability band restricts placement to the matching dive site. */
  band: SiteColor | null;
  abilityType: AbilityType | null;
  /** Raw ability text (icon tokens + English), interpreted by powers.ts. */
  ability: string | null;
  tags: FishTags;
  /** Printed on the ocean mat; counts as a fish but has no printed points. */
  forage: boolean;
}

/** A benefit icon the engine knows how to grant. */
export type Benefit =
  | 'drawCard' // draw 1 fish card from the deck
  | 'discardCard' // may discard 1 card from hand (rummage)
  | 'recoverCard' // gain a card from your discard pile (deck if empty)
  | 'egg' // put an egg on a fish that doesn't already have one
  | 'hatch' // flip one of your eggs to a young
  | 'young' // put a young on any fish or open slot
  | 'move' // move 1 young or 1 school in a straight line
  | 'consumeHand' // a fish in your ocean consumes a shorter fish card from hand
  | 'unSchool' // discard a school -> place 1 young in 4 different slots (else 1 young)
  | 'coralBlue'
  | 'coralPurple'
  | 'coralGreen'
  | 'coralAny';

/** One slot on the ocean mat. The visible fish is stack[stack.length-1];
 *  everything below it is a consumed fish (cards and forage). */
export interface SlotState {
  /** bottom -> top card ids (forage pseudo-ids included). */
  stack: number[];
  /** 0 or 1 egg on the visible fish. */
  eggs: number;
  /** Young tokens on the slot. */
  young: number;
  /** School token on the slot. */
  school: boolean;
}

export interface OceanState {
  /** slots[row][col]; row 0-2 sunlight, 3 twilight, 4-5 midnight. */
  slots: SlotState[][];
  /** S&R: coral tokens per dive site [blue, purple, green], max 6 each. */
  corals: number[];
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: string;
  isAI: boolean;
  /** Hand is face-up/public in Finspan. */
  hand: number[];
  /** Personal discard pile (spent card costs + discards). */
  discard: number[];
  ocean: OceanState;
  /** Divers used this week (0..6). */
  diversUsed: number;
  /** Which dive sites' bottom bonus has been claimed this week. */
  bottomTaken: boolean[];
  /** Banked achievement points from weeks 1-3. */
  achievementPoints: number;
}

export type Phase =
  /** Weeks 1-4: players take turns playing fish / diving. */
  | 'main'
  /** After week 4: non-point GAME END abilities drain via gameEndQueue. */
  | 'gameEnd'
  | 'gameOver';

// === pending sub-choices ==================================================

/** A queued sub-decision the game is waiting on. Only the head of `pending`
 *  is answerable, and only by its `playerId`. Optional steps may be declined
 *  (choice `decline`); declining skips the whole step including `then`. */
export type PendingStep =
  /** Put an egg on `count` fish (each lacking an egg). `filter` restricts targets. */
  | { kind: 'chooseEggTargets'; playerId: PlayerId; count: number; filter?: SlotFilter; optional?: boolean }
  /** Flip `count` of your eggs into young (choose which slots). */
  | { kind: 'chooseHatch'; playerId: PlayerId; count: number; optional?: boolean }
  /** Put `count` young on slots (`distinct` = all on different slots). */
  | { kind: 'chooseYoungSlots'; playerId: PlayerId; count: number; distinct?: boolean; optional?: boolean }
  /** Move `count` young-or-school tokens (one move per step). */
  | { kind: 'chooseMove'; playerId: PlayerId; count: number; optional?: boolean }
  /** Discard `count` cards from hand to the personal discard pile. */
  | { kind: 'chooseHandDiscard'; playerId: PlayerId; count: number; optional?: boolean }
  /** Remove `count` eggs from anywhere in your ocean. */
  | { kind: 'chooseEggRemoval'; playerId: PlayerId; count: number; optional?: boolean }
  /** Remove `count` young from anywhere in your ocean. */
  | { kind: 'chooseYoungRemoval'; playerId: PlayerId; count: number; optional?: boolean }
  /** Remove `count` school tokens from your ocean. */
  | { kind: 'chooseSchoolRemoval'; playerId: PlayerId; count: number; optional?: boolean }
  /** A fish in your ocean consumes a shorter fish card from hand.
   *  `onto` = the consuming fish must be this slot (ConsumeFishN benefit);
   *  omitted = pick any ocean fish (FishFromHandConsume benefit). */
  | { kind: 'chooseConsume'; playerId: PlayerId; count: number; onto?: SlotRef; optional?: boolean }
  /** Play a fish from hand. `free` skips all costs; `filter` restricts which
   *  card; `restrict` restricts the destination (location criteria). */
  | {
      kind: 'choosePlayFromHand';
      playerId: PlayerId;
      free: boolean;
      filter?: CardFilter;
      restrict?: SlotFilter;
      optional?: boolean;
    }
  /** Choose a dive site with <6 coral and place 1 coral (AnyCoral benefit). */
  | { kind: 'chooseCoralSite'; playerId: PlayerId; count: number; optional?: boolean }
  /** S&R reef: discard the overlay's indicated item to place 1 coral here. */
  | { kind: 'chooseReefDiscard'; playerId: PlayerId; col: number; item: 'egg' | 'young' | 'card' }
  /** Take `count` cards from your discard pile into hand (deck if pile short). */
  | { kind: 'chooseRecover'; playerId: PlayerId; count: number; optional?: boolean }
  /** Discard a school and place 1 young in 4 different slots (or 1 young if
   *  no school to discard — handled by queuing chooseYoungSlots instead). */
  | { kind: 'chooseUnSchool'; playerId: PlayerId; count: number; optional?: boolean };

/** Filter over ocean slots (visible fish). */
export interface SlotFilter {
  zone?: Zone;
  col?: number;
  row?: number;
  estuary?: boolean;
  deepwater?: boolean;
  bandSite?: SiteColor;
  coralAtLeast?: number;
  size?: FishSize;
  tag?: keyof FishTags;
  /** Slot must already have a fish (used for egg targets). */
  hasFish?: boolean;
  /** Slot must not already have an egg. */
  noEgg?: boolean;
}

/** Filter over hand cards (for FreePlayFishFromHand "only [X]" texts). */
export interface CardFilter {
  size?: FishSize;
  tag?: keyof FishTags;
  /** Only fish that can consume (must cover a shorter fish). */
  consumeOnly?: boolean;
}

// === choices (answers to pending steps) =====================================

export type Choice =
  | { kind: 'slots'; slots: SlotRef[] }
  | { kind: 'handCards'; cardIds: number[] }
  | { kind: 'move'; from: SlotRef; to: SlotRef; token: 'young' | 'school' }
  | { kind: 'consume'; onto: SlotRef; cardIds: number[] }
  | {
      kind: 'playFromHand';
      cardId: number;
      row: number;
      col: number;
      discardCardIds?: number[];
      eggSlots?: SlotRef[];
      youngSlots?: SlotRef[];
      schoolSlots?: SlotRef[];
    }
  | { kind: 'site'; col: number }
  | { kind: 'reefDiscard'; use: boolean; eggSlot?: SlotRef; youngSlot?: SlotRef; cardId?: number }
  | { kind: 'unSchool'; schoolSlot: SlotRef | null; youngSlots: SlotRef[] }
  | { kind: 'decline' };

// === actions ================================================================

export interface BaseAction {
  type: string;
  playerId: PlayerId;
}

export interface PlayFishAction extends BaseAction {
  type: 'playFish';
  cardId: number;
  row: number;
  col: number;
  /** Hand cards discarded to satisfy cost.cards. */
  discardCardIds?: number[];
  /** Slots whose egg is removed for cost.eggs. */
  eggSlots?: SlotRef[];
  /** Slots whose young are removed for cost.young (list each young). */
  youngSlots?: SlotRef[];
  /** Slots whose school token is removed for cost.schools. */
  schoolSlots?: SlotRef[];
}

export interface DiveAction extends BaseAction {
  type: 'dive';
  /** Dive site column 0-2. */
  col: number;
}

export interface ResolveChoiceAction extends BaseAction {
  type: 'resolveChoice';
  choice: Choice;
}

export interface EndTurnAction extends BaseAction {
  type: 'endTurn';
}

export type Action = PlayFishAction | DiveAction | ResolveChoiceAction | EndTurnAction;

// === achievements ===========================================================

export type AchievementKind =
  | 'eggs'
  | 'young'
  | 'eggsAndYoung'
  | 'fullRows'
  | 'fish'
  | 'tagPredator'
  | 'schools'
  | 'fishWithTokens'
  | 'consumedFish'
  | 'fishPoints1to3'
  | 'uniqueTags'
  | 'fishSunlight'
  | 'coral';

export interface Achievement {
  id?: string;
  week: number;
  name: string;
  kind: AchievementKind;
  per: number;
  set?: string;
}

// === game state =============================================================

export interface GameSettings {
  /** 'base' or ['base','sr'] for the Sharks & Reefs expansion. */
  sets: string[];
  /** Achievement board side: 'A' = printed goals, 'B' = drawn tiles. */
  achievementSide: 'A' | 'B';
  /** S&R: the discard item shown on each player's reef overlay
   *  (egg | young | card). Index aligned with playerOrder. */
  reefCosts?: ('egg' | 'young' | 'card')[];
  aiLevel?: number;
}

export interface ScoreBreakdown {
  achievementPoints: number;
  gameEndAbilityPoints: number;
  fishPoints: number;
  consumedPoints: number;
  eggYoungPoints: number;
  schoolPoints: number;
  coralPoints: number;
  total: number;
}

export interface GameState {
  phase: Phase;
  rngState: number;
  /** 0..3 (weeks 1-4). */
  week: number;
  playerOrder: PlayerId[];
  currentPlayerIndex: number;
  firstPlayerIndex: number;
  players: PlayerState[];
  /** Global fish deck (main fish only; starters are dealt at setup). Top = end. */
  deck: number[];
  /** Achievements in effect for weeks 1-3 (index 0-2). */
  achievements: Achievement[];
  pending: PendingStep[];
  /** Non-point GAME END abilities still to activate (phase 'gameEnd'). */
  gameEndQueue: { playerId: PlayerId; slot: SlotRef }[] | null;
  /** True once the current player has used this turn's diver. */
  turnTookAction: boolean;
  settings: GameSettings;
  winner: PlayerId[] | null;
  finalScores: Record<PlayerId, ScoreBreakdown> | null;
  log: { seq: number; msg: string }[];
}

export interface CreateGameOptions {
  playerNames: string[];
  playerTypes: ('human' | 'ai')[];
  playerColors: string[];
  seed: number;
  settings?: Partial<GameSettings>;
}
