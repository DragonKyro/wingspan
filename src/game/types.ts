// Core types for the Wingspan engine. Everything is JSON-serializable: the
// network layer logs actions and every device rebuilds state from them.

export type PlayerId = `p${number}`;

export type PlayerColor =
  | 'red'
  | 'blue'
  | 'orange'
  | 'white'
  | 'purple'
  | 'pink'
  | 'teal'
  | 'gold';

export type Habitat = 'forest' | 'grassland' | 'wetland';
export const HABITATS: Habitat[] = ['forest', 'grassland', 'wetland'];

export type FoodType = 'invertebrate' | 'seed' | 'fish' | 'fruit' | 'rodent' | 'nectar';
export const FOOD_TYPES: FoodType[] = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'nectar'];
export const BASE_FOODS: FoodType[] = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'];

/** A birdfeeder die face. `split` is the invertebrate/seed face: the taker picks one. */
export type DieFace = 'invertebrate' | 'seed' | 'fish' | 'fruit' | 'rodent' | 'nectar' | 'split';
export const BASE_DIE_FACES: DieFace[] = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'split'];
/** Oceania dice: nectar replaces the split face. */
export const OCEANIA_DIE_FACES: DieFace[] = ['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'nectar'];

export type NestType = 'bowl' | 'cavity' | 'ground' | 'platform' | 'wild' | 'none';

/** Power banner color. brown=when activated, pink=once between turns,
 *  teal=end of round, yellow/white-with-text=when played. */
export type PowerColor = 'brown' | 'pink' | 'teal' | 'yellow' | 'white';

export type FoodCost =
  | { kind: 'none' }
  /** Pay the listed items; `any` units are covered by any food tokens. */
  | { kind: 'and'; items: { food: FoodType | 'any'; count: number }[] }
  /** Pay 1 food of any listed type. */
  | { kind: 'or'; foods: FoodType[] }
  /** Pay `count` food of any types. */
  | { kind: 'any'; count: number };

export interface BirdCard {
  id: number;
  name: string;
  sciName: string;
  set: string;
  powerColor: PowerColor | null;
  powerText: string | null;
  points: number;
  nest: NestType;
  eggLimit: number;
  wingspan: number;
  habitats: Habitat[];
  cost: FoodCost;
  predator: boolean;
  flocking: boolean;
  /** Power involves bonus cards ("Bonus card" flag in the data). */
  bonusPower: boolean;
  /** Bonus-card name → this bird qualifies (precomputed in the data). */
  bonusFlags: string[];
  beakLeft: boolean | null;
}

export interface BonusCard {
  id: number;
  name: string;
  set: string;
  condition: string;
  /** Raw VP text, e.g. "2 to 3 birds: 3[point]; 4+ birds: 7[point]". */
  vpText: string;
}

export type GoalKind =
  | { kind: 'birdsInHabitat'; habitat: Habitat }
  | { kind: 'eggsInHabitat'; habitat: Habitat }
  | { kind: 'birdsInOneRow' }
  | { kind: 'birdsNoEggs' }
  | { kind: 'birdsPoints'; op: 'gt' | 'lte'; value: number }
  | { kind: 'nestBirdsWithEggs'; nest: 'bowl' | 'cavity' | 'ground' | 'platform' }
  | { kind: 'eggsInNest'; nest: 'bowl' | 'cavity' | 'ground' | 'platform' }
  | { kind: 'cardsInHand' }
  | { kind: 'foodInSupply' }
  | { kind: 'birdsPowerColor'; color: 'brown' | 'white' }
  | { kind: 'filledColumns' }
  | { kind: 'foodCostTotal' }
  | { kind: 'setsOfThreeEggs' }
  | { kind: 'totalBirds' }
  | { kind: 'birdsWithTucked' }
  | { kind: 'beakDirection'; dir: 'L' | 'R' }
  | { kind: 'cubesOnPlayBird' }
  | { kind: 'costIncludes'; foods: FoodType[]; all: boolean }
  | { kind: 'noGoal' }
  | { kind: 'unsupported'; text: string };

export interface GoalTile {
  id: number;
  set: string;
  text: string;
  goal: GoalKind;
}

/** A bird on a player mat. `tucked`/`cached` live on the bird. */
export interface PlayedBird {
  cardId: number;
  eggs: number;
  tucked: number[];
  cached: FoodType[];
  /** Pink powers fire at most once between the owner's turns. */
  pinkUsed?: boolean;
  /** European "cover 2 spaces" birds leave a placeholder entry in the slot
   *  they cover to their right — it is not a real bird (no eggs, no powers,
   *  does not count as a bird) but it does occupy the space for row length,
   *  action-row slot position and the filled-columns goal. `cardId` mirrors
   *  the covering bird for display purposes. */
  ghost?: boolean;
}

/** Identifies a played bird: habitat + slot index. */
export interface BirdRef {
  habitat: Habitat;
  index: number;
}

/** A queued sub-decision the game is waiting on. While `pending` is
 *  non-empty, only the named player may act (with `resolveChoice`), except
 *  `skipActivation`/`activatePower` which also belong to the named player. */
export type PendingStep =
  /** Pick `count` dice in the feeder and take their food. `faces` restricts which die faces qualify. */
  | { kind: 'pickDie'; playerId: PlayerId; count: number; faces?: DieFace[]; then?: PendingTag }
  /** From the supply: choose which food types to take (optionally cache on `cache`). */
  | { kind: 'chooseSupplyFood'; playerId: PlayerId; count: number; options: FoodType[] | 'any'; cache?: BirdRef | null; then?: PendingTag }
  /** Lay an egg on a chosen bird; `nest` = filter, 'any' or 'other' (array = any listed type).
   *  `onlyBird` pins every egg to that one bird (the same ref may repeat);
   *  `adjacentTo` restricts to the birds in the neighbouring slots;
   *  `wingspanLt` restricts to birds whose wingspan is below the threshold. */
  | { kind: 'chooseBirdForEgg'; playerId: PlayerId; count: number; nest: NestType | 'any' | 'other' | NestType[]; exclude?: BirdRef; overLimit?: number; optional?: boolean; onlyBird?: BirdRef; adjacentTo?: BirdRef; wingspanLt?: number; then?: PendingTag }
  /** Discard eggs from chosen birds (power costs). `optional`: declining skips `then`. `habitat` restricts to one row. */
  | { kind: 'chooseBirdForEggDiscard'; playerId: PlayerId; count: number; exclude?: BirdRef; habitat?: Habitat; optional?: boolean; then?: PendingTag }
  /** Discard a card from hand (e.g. end-of-turn discard powers). `optional`: declining skips `then`. */
  | { kind: 'chooseHandDiscard'; playerId: PlayerId; count: number; optional?: boolean; then?: PendingTag }
  /** Tuck a card from hand behind `bird`. `optional`: declining skips `then`. */
  | { kind: 'chooseHandTuck'; playerId: PlayerId; bird: BirdRef; optional?: boolean; then?: PendingTag }
  /** Pick a player; `other` excludes the chooser. `optional`: a {boolean,no} answer declines. */
  | { kind: 'choosePlayer'; playerId: PlayerId; other?: boolean; optional?: boolean; then?: PendingTag }
  /** Pick a habitat; `noEggs` restricts to habitats with zero eggs (any owner's birds). */
  | { kind: 'chooseHabitat'; playerId: PlayerId; noEggs?: boolean; then?: PendingTag }
  /** Discard food from the supply (up to `count` when `optional`).
   *  `spentHabitat`: nectar discarded counts toward that habitat's end-game nectar. */
  | { kind: 'chooseFoodDiscard'; playerId: PlayerId; count: number; options: FoodType[] | 'any'; optional?: boolean; spentHabitat?: Habitat; then?: PendingTag }
  /** Steal 1 food of `food` type ('any' = chooser picks a type the victim has) from `from`. */
  | { kind: 'chooseFoodSteal'; playerId: PlayerId; from: PlayerId; food: FoodType | 'any'; then?: PendingTag }
  /** Take a face-up tray card (`habitat` restricts to cards that can live there). */
  | { kind: 'chooseTrayCard'; playerId: PlayerId; habitat?: Habitat; then?: PendingTag }
  /** Remove `count` dice from the feeder without gaining their food. */
  | { kind: 'chooseDieRemove'; playerId: PlayerId; count: number; then?: PendingTag }
  /** Pick `min`..`max` own birds (optionally within one habitat).
   *  `exclude`/`nest`/`eggsMin` filter the eligible birds. */
  | { kind: 'chooseBirds'; playerId: PlayerId; min: number; max: number; habitat?: Habitat; exclude?: BirdRef; nest?: NestType; eggsMin?: number; then?: PendingTag }
  /** Tuck hand cards behind `targets`: card i goes behind targets[i]; 0..len may be picked. */
  | { kind: 'assignHandTucks'; playerId: PlayerId; targets: BirdRef[]; then?: PendingTag }
  /** Cache `count` food (`food`) from the supply on any of your birds (stackable).
   *  'any' = the chooser picks which types. */
  | { kind: 'chooseCacheOnBirds'; playerId: PlayerId; count: number; food: FoodType | 'any'; then?: PendingTag }
  /** Name a food type (e.g. "all players gain 1 of the chosen food"). */
  | { kind: 'chooseFoodType'; playerId: PlayerId; then?: PendingTag }
  /** Pick one of several mutually exclusive effects. */
  | { kind: 'chooseOption'; playerId: PlayerId; options: PowerOption[]; then?: PendingTag }
  /** Drew cards face-down to distribute: this player picks one of `cardIds`. */
  | { kind: 'chooseDrawnCard'; playerId: PlayerId; cardIds: number[]; then?: PendingTag }
  /** Keep `keep` of `cardIds` bonus cards, discard the rest. `fromDiscard`: the
   *  pool is the discarded-bonus-cards pile and unchosen cards return there
   *  (Wrybill). */
  | { kind: 'chooseBonusCards'; playerId: PlayerId; cardIds: number[]; keep: number; fromDiscard?: boolean; then?: PendingTag }
  /** Discard `count` bonus cards from hand. `optional`: a 0-length answer declines. */
  | { kind: 'discardBonusCards'; playerId: PlayerId; count: number; optional?: boolean; then?: PendingTag }
  /** Move `bird` to another habitat (rightmost-bird powers). */
  | { kind: 'moveBirdHabitat'; playerId: PlayerId; bird: BirdRef; then?: PendingTag }
  /** Pick which player goes first in an everyone-gains effect. */
  | { kind: 'chooseFirstPlayer'; playerId: PlayerId; effect: 'gainDie'; then?: PendingTag }
  /** Pick another bird in `habitat` whose brown/predator power to repeat. */
  | { kind: 'chooseRepeatPower'; playerId: PlayerId; habitat: Habitat; predatorOnly?: boolean; then?: PendingTag }
  /** Play an additional bird (normal cost) in `habitat`. `optional`: may decline. 'any': the resolver picks the habitat. `eggDiscount` reduces the column egg cost (Oceania powers). */
  | { kind: 'chooseAdditionalPlay'; playerId: PlayerId; habitat: Habitat | 'same' | 'any'; sourceBird?: BirdRef; optional?: boolean; eggDiscount?: number; then?: PendingTag }
  /** Cache up to `count` food from the supply onto `bird` (choose which types). */
  | { kind: 'chooseCacheFood'; playerId: PlayerId; bird: BirdRef; count: number; optional?: boolean; then?: PendingTag }
  /** Spend a wild food for any other type from the supply.
   *  `spentHabitat`: a nectar given counts toward that habitat's end-game nectar. */
  | { kind: 'chooseWildTrade'; playerId: PlayerId; from: FoodType | 'any'; spentHabitat?: Habitat; then?: PendingTag }
  /** Cache-or-keep for food just gained with a "may cache" power. */
  | { kind: 'chooseCacheGained'; playerId: PlayerId; bird: BirdRef; food: FoodType; then?: PendingTag }
  /** Oceania: copy a brown power on a bird in `target`'s `habitat` row; the
   *  effect runs for `playerId` as the copying bird's own power. */
  | { kind: 'chooseCopyPower'; playerId: PlayerId; target: PlayerId; habitat: Habitat; then?: PendingTag }
  /** Oceania: take a face-up tray card matching `nests`/`wingspanLt`;
   *  `mayResetTray` allows discarding+refilling the tray first.
   *  `destination` 'hand' or 'tuck' (onto `bird`). */
  | { kind: 'chooseTrayCardEx'; playerId: PlayerId; nests?: NestType[]; wingspanLt?: number; mayResetTray?: boolean; destination: 'hand' | 'tuck'; bird?: BirdRef; then?: PendingTag }
  /** Oceania: a card the player just drew — tuck it behind `bird` or keep it in hand. */
  | { kind: 'chooseTuckOrHand'; playerId: PlayerId; bird: BirdRef; cardId: number; then?: PendingTag }
  /** Oceania: cache up to `count` food from the player's own supply on `bird`. */
  | { kind: 'chooseCacheFromSupply'; playerId: PlayerId; bird: BirdRef; count: number; food: FoodType | 'any'; optional?: boolean; then?: PendingTag };

/** Bookkeeping tag so a resolved pending step can continue the effect that
 *  created it. Encoded as a plain string + optional numeric params. */
export interface PendingTag {
  /** The power/effect that queued the step, for the engine to resume. */
  effect: string;
  /** Card id of the bird whose power this is (if any). */
  birdCardId?: number;
  /** The played bird ref the power belongs to (JSON: 'habitat:index'). */
  bird?: BirdRef;
  /** Free-form numeric params (counts remaining, flags). */
  n?: number[];
  /** Free-form ids (cards drawn, options). */
  ids?: number[];
}

/** Optional-power step: not in `pending`; tracked separately so the acting
 *  player explicitly uses or skips each brown power in the activated row. */
export interface ActivationTrack {
  habitat: Habitat;
  /** Bird slot indices still to offer, right to left. */
  remaining: number[];
}

export type Phase =
  | 'setup'
  | 'main'
  /** End-of-round: teal powers drain (after goal scoring, before the next round). */
  | 'roundEnd'
  /** Game end: yellow powers drain, then final scoring. */
  | 'gameEnd'
  | 'gameOver';

/** The four action columns action cubes are spent on (per round). */
export type CubeTrack = Habitat | 'playBird';
export const CUBE_TRACKS: CubeTrack[] = ['forest', 'grassland', 'wetland', 'playBird'];

/** Options offered by "choose one effect" powers. */
export type PowerOption =
  | 'gainDie'
  | 'drawCard'
  | 'layEgg'
  /** Oceania Mistletoebird. */
  | 'gainFruit'
  | 'fruitToNectar'
  /** Oceania Red-Winged Parrot follow-up (2 eggs on the source bird, or 2 dice). */
  | 'selfEggs2'
  | 'gain2Dice';

export interface PlayerState {
  id: PlayerId;
  name: string;
  color: PlayerColor;
  isAI: boolean;
  hand: number[];
  bonusHand: number[];
  board: Record<Habitat, PlayedBird[]>;
  food: Record<FoodType, number>;
  /** Eggs gained beyond capacity are lost — but the *spent* count is a goal metric. */
  actionCubes: number;
  /** Action cubes spent this round per action column (reset each round) —
   *  european teal powers count "action cubes on their [habitat]". */
  roundCubes: Record<CubeTrack, number>;
  /** Food types gained this turn (european robin-style powers). Reset when a turn starts. */
  gainedThisTurn: FoodType[];
  /** Cards this player must discard at end of turn ("draw N, discard 1 at end of turn" powers). */
  endOfTurnDiscards: number;
  /** Cubes spent on the "play a bird" action (a goal tile counts these). */
  cubesOnPlayBird: number;
  /** Nectar spent (Oceania end-game scoring). */
  nectarSpent: Record<Habitat, number>;
}

export interface ScoreBreakdown {
  birdPoints: number;
  bonusPoints: number;
  eggs: number;
  cached: number;
  tucked: number;
  nectar: number;
  goalPoints: number;
  total: number;
}

export interface GameSettings {
  /** Expansion set ids included in the deck, e.g. ['core'] or ['core','oceania']. */
  sets: string[];
  /** Goal board side: 'green' = ranked competitive scoring, 'blue' = 1 pt per item (max 5). */
  goalSide: 'green' | 'blue';
  aiLevel?: number;
}

export interface GameState {
  phase: Phase;
  rngState: number;
  playerOrder: PlayerId[];
  currentPlayerIndex: number;
  /** 0..3 */
  round: number;
  players: PlayerState[];
  deck: number[];
  tray: (number | null)[];
  discard: number[];
  feederIn: DieFace[];
  feederOut: DieFace[];
  bonusDeck: number[];
  /** Discarded bonus cards (Oceania Wrybill looks through this pile). */
  bonusDiscard: number[];
  goalTiles: number[];
  /** Goal scores per round: [round][playerOrder index] = points awarded. */
  goalScores: number[][];
  /** Pending required choices, resolved in order (only head is answerable). */
  pending: PendingStep[];
  /** Brown-power activations in progress (acting player only). */
  activation: ActivationTrack | null;
  /** True once the acting player has spent this turn's cube (play a bird or a
   *  habitat action); the only moves left are powers and endTurn. */
  turnTookAction: boolean;
  /** Setup bookkeeping: which players still need to pick keeps. */
  setupRemaining: PlayerId[];
  /** End-of-round teal powers remaining: resolved one at a time in 'roundEnd'. */
  roundEndQueue: { playerId: PlayerId; bird: BirdRef }[];
  /** Game-end yellow powers remaining: resolved one at a time in 'gameEnd'. */
  gameEndQueue: { playerId: PlayerId; bird: BirdRef }[] | null;
  settings: GameSettings;
  winner: PlayerId[] | null;
  /** Final score breakdown per player (gameOver only). */
  finalScores: Record<PlayerId, ScoreBreakdown> | null;
  /** Player-facing event feed for UI animation/log (not rules-relevant). */
  log: { seq: number; msg: string }[];
}

// === Actions ===

export interface BaseAction {
  type: string;
  playerId: PlayerId;
}

/** Setup: choose which birds + which bonus card to keep; food discarded = 5−kept birds. */
export interface KeepSetupAction extends BaseAction {
  type: 'keepSetup';
  keepBirds: number[];
  keepBonus: number;
  discardFood: FoodType[];
}

export interface PlayBirdAction extends BaseAction {
  type: 'playBird';
  cardId: number;
  habitat: Habitat;
  /** Eggs spent for the column cost. */
  eggPayments: BirdRef[];
  /** Food tokens spent from the supply (2-for-1 trades allowed: list actual tokens). */
  foodPayments: FoodType[];
  /** Food spent from birds' caches (european caching powers make cached food spendable). */
  cachedFoodPayments?: { bird: BirdRef; food: FoodType }[];
  /** European predators: hand cards paid instead of [rodent] cost items (tucked behind the bird). */
  cardPayments?: number[];
  /** European predators: play on top of this existing bird instead of paying any cost. */
  coverBird?: BirdRef;
  /** European sideways birds: cover 2 habitat spaces (default true when legal). */
  coverTwo?: boolean;
}

export interface GainFoodAction extends BaseAction {
  type: 'gainFood';
  /** Reroll all dice first (allowed when all show the same face, or via slot bonus by discarding a food). */
  reroll?: boolean;
  /** Food token discarded to reroll (slot bonus path). */
  rerollCost?: FoodType;
  /** Bird card discarded from hand for +1 die (slots 4/5). */
  bonusTradeCardId?: number;
  /** Indices into feederIn of dice to take, in order, plus the chosen food for 'split'/'nectar-as-wild' faces. */
  picks: { die: number; take?: FoodType }[];
}

export interface LayEggsAction extends BaseAction {
  type: 'layEggs';
  /** Where each gained egg goes (count = slot eggs + optional trade eggs). */
  placements: BirdRef[];
  /** Food token paid for +1 egg (base mat slots 4/5). */
  tradeFood?: FoodType;
  /** Oceania mat: each entry is a hand card or a food paid for +1 egg (max 2 at the double-trade slot). */
  extraTrades?: ({ card: number } | { food: FoodType })[];
}

export interface DrawCardsAction extends BaseAction {
  type: 'drawCards';
  /** Each pick: 'deck' or a tray index (0-2). Count = slot cards + optional trade card. */
  picks: ('deck' | number)[];
  /** Egg discarded for +1 card (base mat slots 4/5, or the oceania trade). */
  tradeEgg?: BirdRef;
  /** Oceania mat: nectar discarded for +1 card (alternative to tradeEgg). */
  tradeNectar?: boolean;
  /** Oceania mat: food discarded to reset the tray before drawing. */
  resetTrayCost?: FoodType;
}

/** Activate the next brown power in the current row (or answer an option the power offered). */
export interface ActivatePowerAction extends BaseAction {
  type: 'activatePower';
  /** For powers with inline options the player must pick up-front (e.g. repeat a power's target). */
  params?: Record<string, unknown>;
}

/** Skip the head brown power, or all remaining. */
export interface SkipPowerAction extends BaseAction {
  type: 'skipPower';
  all?: boolean;
}

/** Answer the head pending step. */
export interface ResolveChoiceAction extends BaseAction {
  type: 'resolveChoice';
  choice: Choice;
}

export type Choice =
  | { kind: 'dice'; picks: { die: number; take?: FoodType }[]; reroll?: boolean }
  | { kind: 'supplyFood'; foods: FoodType[] }
  | { kind: 'birds'; birds: BirdRef[] }
  /** `habitat` disambiguates 'any'-habitat additional plays. */
  | { kind: 'handCards'; cardIds: number[]; habitat?: Habitat }
  | { kind: 'bonusCards'; cardIds: number[] }
  | { kind: 'habitat'; habitat: Habitat }
  | { kind: 'player'; playerId: PlayerId }
  | { kind: 'boolean'; yes: boolean }
  | { kind: 'repeatTarget'; bird: BirdRef }
  | { kind: 'option'; option: PowerOption }
  | { kind: 'cacheAssign'; items: { bird: BirdRef; food: FoodType }[] }
  | { kind: 'wildTrade'; give: FoodType; to: FoodType }
  /** Answer to chooseTrayCardEx: take `cardId`, or 'reset'/'refill' the tray
   *  first (the step then re-queues so a card can be picked). */
  | { kind: 'trayPick'; cardId?: number; mode?: 'reset' | 'refill' };

export interface EndTurnAction extends BaseAction {
  type: 'endTurn';
}

/** During setup, players may look (no-op) — reserved. */
export type Action =
  | KeepSetupAction
  | PlayBirdAction
  | GainFoodAction
  | LayEggsAction
  | DrawCardsAction
  | ActivatePowerAction
  | SkipPowerAction
  | ResolveChoiceAction
  | EndTurnAction;

export interface CreateGameOptions {
  playerNames: string[];
  playerTypes: ('human' | 'ai')[];
  playerColors: PlayerColor[];
  seed: number;
  settings?: Partial<GameSettings>;
}
