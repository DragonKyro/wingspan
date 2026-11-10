// Core types for the Wyrmspan engine. Everything is JSON-serializable: every
// state mutation goes through applyAction(state, action) so games can be
// rebuilt from createGame(options) + the action log.

export type PlayerId = `p${number}`;

export type Resource = 'meat' | 'gold' | 'crystal' | 'milk';
export const RESOURCES: Resource[] = ['meat', 'gold', 'crystal', 'milk'];

export type CaveId = 'crimson' | 'golden' | 'amethyst';
export const CAVE_IDS: CaveId[] = ['crimson', 'golden', 'amethyst'];
export const CAVE_NAMES: Record<CaveId, string> = {
  crimson: 'Crimson Cavern',
  golden: 'Golden Grotto',
  amethyst: 'Amethyst Abyss',
};

export type Personality = 'Shy' | 'Playful' | 'Helpful' | 'Aggressive';
export const PERSONALITIES: Personality[] = ['Shy', 'Playful', 'Helpful', 'Aggressive'];

export type Size = 'Small' | 'Medium' | 'Large' | 'Hatchling' | 'Fledgling';
export type AbilityType = 'Adventurer' | 'WhenPlayed' | 'OncePerRound' | 'EndGame';

export type Expansion = 'base' | 'academy';

// ---------------------------------------------------------------------------
// Card data (mirrors src/wyrmspan/data/cards.json)

export type CardCost = Partial<Record<Resource | 'coin' | 'egg', number>>;

export interface DragonCard {
  id: number;
  number: number;
  name: string;
  expansion: Expansion;
  ability: string | null;
  abilityType: AbilityType | 'Adventurer, EndGame';
  vp: number;
  size: Size;
  capacity: number; // nest icons (egg storage)
  personality: Personality | null;
  cost: CardCost;
  caves: string[]; // display names, e.g. "Crimson Cavern"
  /** Academy fledglings: raw icon list for the training track, e.g. "[Milk][Meat]". */
  trainingTrack: string | null;
  ignoreCost: boolean; // card has an "Ignore this dragon's cost if ..." clause
}

export interface CaveCard {
  id: number;
  number: number;
  name: string | null;
  expansion: Expansion;
  ability: string | null;
  abilityType: 'WhenPlayed';
}

export interface CardDB {
  dragons: DragonCard[];
  caves: CaveCard[];
}

// ---------------------------------------------------------------------------
// Ability step AST. `parseAbility` compiles each distinct printed ability text
// into a list of these steps; `effects.ts` interprets them.

/** An amount of a thing gained (or paid when used as a cost). */
export type GainItem =
  | { kind: 'resource'; res: Resource | 'any'; count: number }
  | { kind: 'card'; deck: 'dragon' | 'cave'; count: number; source?: 'deck' | 'display' }
  | { kind: 'coin'; count: number }
  | { kind: 'guild'; count: number }
  /** Egg unit: as a cost = pay an egg from your mat; as a gain = lay an egg. */
  | { kind: 'egg'; count: number }
  /** King's Guild tithe: any 1 resource, dragon card, cave card, or egg. */
  | { kind: 'tithe'; count: number }
  /** Player-mat 4th-column exchange item: any 1 resource, dragon card, or cave card. */
  | { kind: 'item'; count: number }
  | { kind: 'vp'; count: number };

/** Where an egg may be laid. */
export type EggTarget =
  | { kind: 'any' } // any dragon or mat nest icon with room
  | { kind: 'here' }
  | { kind: 'thisCave' }
  | { kind: 'thisColumn' }
  | { kind: 'orthAdjacent' }
  | { kind: 'eachInCave'; cond?: DragonCond }
  | { kind: 'eachInColumn' }
  | { kind: 'eachInRow' }
  | { kind: 'eachFledgling' }
  | { kind: 'eachFullyTrainedFledgling' };

/** Which dragon(s) a cache/tuck/other effect targets. */
export type DragonTarget =
  | { kind: 'here' }
  | { kind: 'any' }
  | { kind: 'thisColumn' }
  | { kind: 'orthAdjacent' }
  | { kind: 'eachInCave'; cond?: DragonCond }
  | { kind: 'eachOnMat'; cond?: DragonCond };

/** A filter on dragons (used inside counters and targets). */
export interface DragonCond {
  personality?: Personality;
  size?: Size;
  /** 'adult' = Small|Medium|Large; 'nonFledgling' excludes fledglings */
  sizeGroup?: 'adult' | 'nonFledgling';
  abilityType?: AbilityType;
  costHas?: Resource | 'coin' | 'egg';
  excludeSelf?: boolean;
  not?: DragonCond;
  /** Match if ANY of these conditions match. */
  anyOf?: DragonCond[];
}

/** Countable features of a player's position ("for each X"). */
export type Counter =
  | { kind: 'dragons'; where: 'mat' | 'cave' | 'column' | 'orthAdjacent' | 'namedCave'; cond?: DragonCond; cave?: CaveId }
  | { kind: 'eggs'; where: 'mat' | 'row' | 'column' }
  | { kind: 'cached'; where: 'here' | 'mat' }
  | { kind: 'tucked'; where: 'here' | 'mat' }
  | { kind: 'guildMarkers' }
  | { kind: 'objectivesLowest' } // objectives where your marker placed lowest (ties incl.)
  | { kind: 'traitSets' } // sets of one of each personality
  | { kind: 'sizeSets' } // sets of one of each size
  | { kind: 'trainingTokens' } // tokens placed on all your fledglings
  | { kind: 'fullyTrainedFledglings' }
  | { kind: 'filledColumns' }
  | { kind: 'printedResourceCost'; where: 'cave' }
  | { kind: 'fledglingCount' }
  | { kind: 'caveCards' };

export type Cond =
  | { kind: 'atLeast'; counter: Counter; n: number }
  | { kind: 'exactly'; counter: Counter; n: number }
  | { kind: 'isLastInCave' }
  | { kind: 'caveFull' }
  | { kind: 'columnFull' }
  | { kind: 'betweenTwoDragons' }
  | { kind: 'hasGuildMarker' }
  | { kind: 'leftNeighborGe'; cave: CaveId } // "as many dragons in <cave> as your left neighbor"
  | { kind: 'cardIs'; cond: DragonCond } // for reveal effects: the revealed card matches
  | { kind: 'allExcavated'; where: 'cave' }
  /** "will be the 3rd or 4th dragon in its cave" — evaluated when choosing a space. */
  | { kind: 'willBeNthInCave'; ns: number[] }
  /** "played orthogonally adjacent to a <cond>" — evaluated with a chosen position. */
  | { kind: 'playedAdjacentTo'; cond: DragonCond }
  /** "will complete a column or row of dragons" — evaluated with a chosen position. */
  | { kind: 'willCompleteRowOrColumn' }
  /** "you have played at least N <cond>" — counts dragons on mat (excluding the one being played). */
  | { kind: 'playedAtLeast'; cond: DragonCond; n: number }
  /** "If you do, ..." — true when the immediately-preceding optional step ran. */
  | { kind: 'didPrecede' }
  /** "If you tuck it here, ..." — true when the last tuck targeted this dragon. */
  | { kind: 'tuckedHere' };

export type Step =
  | { op: 'gain'; items: GainItem[] }
  /** Gain `items` once per unit of `counter` (e.g. "gain X for each Y"). */
  | { op: 'gainPer'; counter: Counter; items: GainItem[]; cacheTo?: DragonTarget }
  | { op: 'opponentsGain'; items: GainItem[]; eachChooses?: boolean }
  | { op: 'layEggs'; count: number; target: EggTarget }
  | { op: 'cache'; count: number; res: Resource | 'any'; from: 'supply' | 'general'; target: DragonTarget; upTo?: boolean }
  | { op: 'tuck'; count: number; from: 'hand' | 'deck'; target: DragonTarget; upTo?: boolean }
  /** Optional: pay `cost`, then run `then`. repeat allows up to N payments. */
  | { op: 'pay'; cost: GainItem[]; then: Step[]; repeat?: number }
  /** "Each opponent may <steps> once" (queued for each opponent). */
  | { op: 'opponentsMay'; steps: Step[] }
  /** Discard `count` cards of `what` from hand, then run `then`. */
  | { op: 'discardFromHand'; what: 'dragon' | 'cave' | 'any'; count: number; then: Step[]; perCard?: boolean; activateDiscarded?: boolean }
  /** Draw `count` cards face-down, then distribute per `dist`. */
  | {
      op: 'drawDistribute';
      deck: 'dragon' | 'cave';
      count: number;
      keep?: number;
      tuck?: number | 'rest';
      discard?: number | 'rest';
      playFree?: number;
      orKeep?: boolean;
      tuckTarget?: DragonTarget;
      keepMessage?: string;
    }
  /** Reveal top dragon card: if it matches cond, run yes, else run no. */
  | { op: 'reveal'; cond: DragonCond | null; yes: Step[]; no: Step[] }
  | { op: 'excavateFree'; source: 'hand' | 'display' | 'handOrDisplay' | 'deck'; count: number; activateTimes?: number }
  /** Play a dragon. No discount field = free; discount = alternatives, one of
   *  which may be waived from the printed cost; `full` = pay printed cost. */
  | { op: 'playDragonFree'; source: 'hand' | 'display' | 'handOrDisplay' | 'deck'; discount?: GainItem[][] | 'full'; onTop?: boolean; cond?: DragonCond }
  | { op: 'activateAbility'; kinds: AbilityType[]; count: number; distinct?: boolean; printedOnMat?: boolean }
  | { op: 'trainFledgling'; times: number | 'full'; free: boolean; gainItem?: boolean; target: 'any' | 'orthAdjacent' | 'mat' }
  | { op: 'swapDragons' }
  /** Guild of Magicians: swap a dragon on your mat with a dragon in your hand (ignoring normal cave requirements). */
  | { op: 'swapHandDragon' }
  /** Guild of Magicians: swap an uncovered cave card on your mat with a cave card in your hand (activating its WhenPlayed ability). */
  | { op: 'swapCaveCard' }
  /** Gambler's Guild: draw 1 dragon card; either gain its printed cost or discard it to gain 1 coin. */
  | { op: 'gamblerDraw' }
  /** Gambler's Guild end-game square: draw 4 dragon cards, score printed VP on 2 of them, discard all 4. */
  | { op: 'gamblerEndGameDraw' }
  /** Gain `count` resource(s) chosen from the resource types in the last-tucked dragon's printed cost. */
  | { op: 'gainTuckedPrintedResource'; count: number }
  /** Sequential explore-walk steps so mid-walk pending choices pause the walk. */
  | { op: 'exploreStep'; cave: number; index: number }
  | { op: 'exploreSpace'; cave: number; space: number }
  | { op: 'offerFledglingTrain'; cave: number; space: number }
  | { op: 'advanceGuild'; count: number }
  | { op: 'withCtx'; ctx: EffectCtx; steps: Step[] }
  /** Lay `per` egg(s) once per unit of `counter` ("lay 1 egg for each fledgling"). */
  | { op: 'layPer'; counter: Counter; per: number; target: EggTarget }
  /** Tuck `per` card(s) once per unit of `counter` ("tuck 1 card for each marker"). */
  | { op: 'tuckPer'; counter: Counter; per: number; from: 'deck' | 'hand'; target: DragonTarget }
  /** Gain the item shown on the box just covered by the last training token. */
  | { op: 'gainCoveredItem' }
  /** Reveal-outcome steps (valid only inside a `reveal` step's yes/no lists). */
  | { op: 'keepRevealed' }
  | { op: 'discardRevealed' }
  | { op: 'tuckRevealed'; target: DragonTarget }
  /** Immediate VP award/loss (printed on some abilities). */
  | { op: 'vp'; count: number }
  /** Pick `count` distinct benefit groups. */
  | { op: 'chooseBenefits'; count: number; options: GainItem[][] }
  /** Pick one option bundle of steps ("Either A, or B", "pay X or Y to Z"). */
  | { op: 'chooseOption'; options: { label: string; steps: Step[] }[] }
  /** "Choose a resource; gain 2 of it; each opponent gains 1 of the same." */
  | { op: 'chooseResourceGain'; selfCount: number; oppCount: number }
  /** Offer `steps` repeatedly, up to `times` ("Up to Nx, ..."). */
  | { op: 'repeat'; times: number; steps: Step[] }
  /** Draw 1 card per unit of `counter`; optionally tuck up to `tuck` of them. */
  | { op: 'drawPer'; counter: Counter; deck: 'dragon' | 'cave'; tuck?: number; tuckTarget?: DragonTarget }
  | { op: 'if'; cond: Cond; then: Step[]; else?: Step[] }
  /** Register a recurring trigger on this dragon ("Any time you cache X here ..."). */
  | {
      op: 'recurring';
      trigger: 'cache' | 'tuck';
      key: Resource | 'dragonCard';
      eachSteps: Step[];
      thirdGain: Step[];
    }
  | { op: 'unsupported'; text: string };

export interface AbilityDef {
  /** Conditional free-play clause ("Ignore this dragon's cost if ..."). */
  ignoreCostIf?: Cond;
  steps: Step[];
  /** End-game scoring descriptor (for EndGame abilities / hybrid cards). */
  endGame?: {
    vpPer: number;
    counter?: Counter;
    cond?: Cond;
    max?: number;
    roundDown?: boolean; // "round down" expressions
    extraEggVp?: number; // "an additional +VP-1 for every 2 eggs"
  };
  /** Cave-card texts may grant their benefit when discarded by an effect. */
}

// ---------------------------------------------------------------------------
// Mat / player state

export interface RecurringHook {
  trigger: 'cache' | 'tuck';
  key: Resource | 'dragonCard';
  eachSteps: Step[];
  thirdGain: Step[];
  count?: number;
  thirdFired?: boolean;
}

export interface PlayedDragon {
  cardId: number;
  eggs: number;
  tucked: number[]; // tucked dragon card ids
  cached: Resource[];
  /** Fledglings: number of training tokens placed. */
  training?: number;
  /** Recurring-trigger counter ("when the 3rd X is cached/tucked ..."). */
  recurCount?: number;
  /** Recurring "Any time you cache/tuck X here" hooks registered by abilities. */
  hooks?: RecurringHook[];
}

export interface CaveSpace {
  excavated: boolean;
  caveCardId: number | null; // null on the pre-excavated first spaces until a card covers them? (first spaces never get cave cards)
  dragon: PlayedDragon | null;
}

export interface CaveRow {
  spaces: CaveSpace[]; // length 4
}

export interface PlayerState {
  id: PlayerId;
  color: string;
  name: string;
  isAI: boolean;
  coins: number;
  resources: Record<Resource, number>;
  hand: number[]; // card ids (dragon or cave)
  caves: [CaveRow, CaveRow, CaveRow]; // [crimson, golden, amethyst]
  nestEggs: number; // eggs on the 2 printed mat nest icons (max 2)
  explores: Record<CaveId, number>; // explore count per cave this round
  passed: boolean;
  guildMarkersPlaced: number;
  /** Immediate-VP tokens awarded mid-game. */
  bonusVP: number;
  /** How many cards/resources the player has been told to discard at end of turn. */
  objectiveVps: number[]; // VP earned per round objective [round-1]
  /** Coins paid on entice actions (tracks an Academy objective tile). */
  coinsSpentEntice: number;
}

// ---------------------------------------------------------------------------
// Guild

export type GuildTileId =
  | 'seafarers'
  | 'highlands'
  | 'plains'
  | 'rainforest'
  | 'merchants'
  | 'gamblers'
  | 'kings'
  | 'veterinary'
  | 'magicians';

export interface GuildTileSquare {
  /** Immediate effect run when a marker is placed, and/or end-game scoring. */
  label: string;
  immediate?: Step[];
  endGame?: { vpPer: number; counter?: Counter; flat?: number; max?: number; divisor?: number; gamblerDraw4?: boolean };
  unlimited?: boolean; // the long-rectangle square (any number of markers)
}

// ---------------------------------------------------------------------------
// Objectives

export type ObjectiveId =
  | 'hatchlingsOnMat'
  | 'mediumDragonsOnMat'
  | 'cardsInCrimson'
  | 'cardsInAmethyst'
  | 'cardsInGolden'
  | 'shyDragons'
  | 'playfulDragons'
  | 'helpfulDragons'
  | 'aggressiveDragons'
  | 'eggsOnMat'
  | 'tuckedCards'
  | 'cachedResources'
  | 'totalDragons'
  | 'caveCardsOnMat'
  | 'smallDragons'
  | 'largeDragons'
  | 'dragonsInOneCave'
  | 'guildMarkers'
  | 'resourcesInSupply'
  | 'costCrystal'
  | 'costMilk'
  | 'costMeat'
  | 'costGold'
  | 'vp4PlusDragons'
  | 'fledglingsOnMat'
  | 'trainedFledglings'
  | 'coinsSpentEntice'
  | 'dragonsInColumn'
  | 'setsOfTraits';

// ---------------------------------------------------------------------------
// Pending choices

/** Context an effect is running under (for resolving continuations). */
export interface EffectCtx {
  playerId: PlayerId;
  /** The dragon the ability belongs to, if any: [caveIndex, spaceIndex]. */
  dragon?: [number, number];
  /** Card id that produced the effect (dragon or cave card). */
  sourceCardId?: number;
  /** Free-form data threaded through multi-step effects. */
  data?: Record<string, number | string | number[] | boolean>;
}

export interface Resume {
  steps: Step[];
  ctx: EffectCtx;
}

export type PendingStep =
  | { kind: 'setupCards'; playerId: PlayerId; offer: number[]; keep: number }
  | { kind: 'setupResources'; playerId: PlayerId; count: number }
  /** Pick `count` resource types to gain (or discard). */
  | { kind: 'chooseResource'; playerId: PlayerId; count: number; mode: 'gain' | 'discard' | 'pay'; allowed?: Resource[]; resume?: Resume; upTo?: boolean }
  /** Pick where to lay egg(s). target constrains legal spots. */
  | { kind: 'chooseEggSpot'; playerId: PlayerId; count: number; target: EggTarget; resume?: Resume; optional?: boolean }
  /** Pick which resource(s) to cache + onto which dragon. */
  | { kind: 'chooseCache'; playerId: PlayerId; count: number; res: Resource | 'any'; from: 'supply' | 'general'; target: DragonTarget; upTo?: boolean; resume?: Resume }
  | { kind: 'chooseTuck'; playerId: PlayerId; count: number; from: 'hand' | 'deck'; target: DragonTarget; upTo?: boolean; resume?: Resume }
  /** Pick `count` hand cards of `what` to discard/pay. `then` runs only when
   * the discard is actually performed (declined `upTo` skips it). */
  | { kind: 'chooseHandCards'; playerId: PlayerId; count: number; what: 'dragon' | 'cave' | 'any'; purpose: 'discard' | 'pay' | 'tuck' | 'cavesForEggs'; upTo?: boolean; perCard?: boolean; activateDiscarded?: boolean; then?: Step[]; resume?: Resume }
  /** Pick a face-up display card. */
  | { kind: 'chooseDisplay'; playerId: PlayerId; deck: 'dragon' | 'cave'; resume?: Resume }
  /** Distribute just-drawn cards: choose which to keep/tuck/discard/play. */
  | { kind: 'distributeCards'; playerId: PlayerId; cardIds: number[]; keep?: number; tuck?: number | 'rest'; discard?: number | 'rest'; playFree?: number; orKeep?: boolean; tuckTarget?: DragonTarget; resume?: Resume }
  /** Pick an ability to activate (dragon ref + optional mat icon). */
  | { kind: 'chooseAbility'; playerId: PlayerId; candidates: AbilityCandidate[]; count: number; distinct?: boolean; resume?: Resume }
  /** Pick which cave/space to excavate for free. */
  | { kind: 'chooseExcavate'; playerId: PlayerId; source: 'hand' | 'display' | 'handOrDisplay' | 'deck'; count: number; activateTimes?: number; resume?: Resume }
  /** Pick a dragon card to play for free/discounted. */
  | { kind: 'choosePlayDragon'; playerId: PlayerId; source: 'hand' | 'display' | 'handOrDisplay' | 'deck'; discount?: GainItem[][] | 'full'; onTop?: boolean; cond?: DragonCond; resume?: Resume }
  /** Pay for a dragon chosen via choosePlayDragon: `options` are the single
   * items that may be waived from the printed cost (pick one). */
  | { kind: 'payDragonCost'; playerId: PlayerId; cardId: number; pos: [number, number]; onTop?: boolean; options: { label: string; waive: GainItem[] }[]; resume?: Resume }
  /** Pick a square on the guild tile after reaching a brown track space. */
  | { kind: 'chooseGuildSquare'; playerId: PlayerId; resume?: Resume }
  /** Pick one of several option bundles. */
  | { kind: 'chooseOption'; playerId: PlayerId; options: { label: string; steps?: Step[]; items?: GainItem[] }[]; count?: number; resume?: Resume }
  /** Pick a fledgling to train. `pos` pins the choice to a specific dragon
   * (e.g. the fledgling the adventurer just walked over). */
  | { kind: 'chooseTrain'; playerId: PlayerId; times: number | 'full'; free: boolean; gainItem?: boolean; target: 'any' | 'orthAdjacent' | 'mat'; pos?: [number, number]; resume?: Resume }
  /** Pick two dragons to swap. */
  | { kind: 'chooseSwap'; playerId: PlayerId; resume?: Resume }
  /** Guild of Magicians: swap a dragon on your mat with a dragon in your hand. */
  | { kind: 'chooseHandDragonSwap'; playerId: PlayerId; resume?: Resume }
  /** Guild of Magicians: swap an uncovered cave card on your mat with a cave card in your hand. */
  | { kind: 'chooseCaveCardSwap'; playerId: PlayerId; resume?: Resume }
  /** Pay-or-decline for an optional "pay X to ..." step (or choose payment tier). */
  | { kind: 'choosePay'; playerId: PlayerId; tiers: { cost: GainItem[]; then: Step[] }[]; repeat?: number; resume?: Resume }
  /** "Each opponent may ..." step — the named (non-active) player decides. */
  | { kind: 'opponentMay'; playerId: PlayerId; label: string; steps: Step[]; resume?: Resume }
  /** End-of-turn discard down to limits. */
  | { kind: 'discardDown'; playerId: PlayerId; resume?: Resume }
  /** Pick which once-per-round dragon to activate next (round end). When a
   * player has several "once per round" dragons they choose the activation
   * order; `positions` are the [cave, space] refs still awaiting activation. */
  | { kind: 'oncePerRoundPick'; playerId: PlayerId; positions: [number, number][]; resume?: Resume }
  /** Pick which benefit group (for "gain N different benefits"). */
  | { kind: 'chooseBenefits'; playerId: PlayerId; count: number; options: GainItem[][]; resume?: Resume }
  /** Reveal resolution is automatic; kept for logging symmetry. */
  | { kind: 'chooseEggPayment'; playerId: PlayerId; count: number; resume?: Resume }
  /** Academy: on the turn a player passes (rounds 1-3), pick an income space.
   * `options` are indices into INCOME_SECTIONS[section]; answer.index selects
   * a position within `options`. */
  | { kind: 'chooseIncomeSpace'; playerId: PlayerId; options: number[] };

export interface AbilityCandidate {
  /** Dragon position [cave, space] on the chooser's mat, or -1 for mat path icons. */
  dragon?: [number, number];
  /** Mat path icon index (0-3) within `cave` when kind is a printed mat icon. */
  matIcon?: { cave: number; icon: number };
  kinds: AbilityType[];
  label: string;
}

// ---------------------------------------------------------------------------
// Actions

export type Action =
  | { type: 'keepSetup'; playerId: PlayerId; keepCards: number[]; resources: Resource[] }
  | { type: 'excavate'; playerId: PlayerId; cave: number; cardId: number }
  | { type: 'entice'; playerId: PlayerId; cave: number; cardId: number }
  | { type: 'explore'; playerId: PlayerId; cave: number }
  | { type: 'pass'; playerId: PlayerId }
  | { type: 'exchange'; playerId: PlayerId; give: [Resource, Resource]; get: Resource }
  | { type: 'resolveChoice'; playerId: PlayerId; answer: ChoiceAnswer }
  | { type: 'automaTurn'; playerId: PlayerId };

// ---------------------------------------------------------------------------
// Automa solo mode
// ---------------------------------------------------------------------------

export type AutomaDifficulty = 1 | 2 | 3;

export type AutomaCardId =
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '1/4'
  | '2/5'
  | '3/6'
  | 'R1/4'
  | 'R2'
  | 'R2/5'
  | 'R3/6'
  | 'R8';

export type AutomaGuildSteps =
  | { kind: 'byRound'; steps: [number, number, number, number] }
  | { kind: 'mostExcavated'; bonus?: number }
  | { kind: 'leastExcavated'; bonus?: number };

export interface AutomaBrownSpace {
  dragonSlot: 1 | 2 | 3 | null;
  caveSlot: 1 | 2 | 3 | null;
  guildOval: number | null;
}

export interface AutomaCardDef {
  id: AutomaCardId;
  passIfLast: boolean;
  refreshDragons: boolean;
  objectiveCoinDelta: -1 | 0 | 1;
  guildSteps: AutomaGuildSteps;
  brownSpace: AutomaBrownSpace;
}

export interface AutomaOptions {
  difficulty?: AutomaDifficulty;
  ravelMode?: boolean;
}

export interface AutomaState {
  difficulty: AutomaDifficulty;
  ravelMode: boolean;
  /** All 8 decision card IDs configured for this game. */
  allCards: AutomaCardId[];
  /** Face-down decision deck for the current round (starts at 7 cards). */
  deck: AutomaCardId[];
  /** Resolved decision cards this round. */
  discard: AutomaCardId[];
  /** The 1 decision card set aside unseen for the current round. */
  setAside: AutomaCardId | null;
  /** Most recently drawn decision card ID. */
  lastCard: AutomaCardId | null;
  /** Coins placed on the current round's objective tile by Automa. */
  objectiveCoins: number;
  /** Player markers currently available beside the Dragon Guild board for Automa. */
  availableGuildMarkers: number;
  /** Total dragons collected by Automa on brown spaces. */
  collectedDragons: number;
  /** Card IDs of dragons collected by Automa. */
  dragonCards: number[];
  /** Total cave cards collected by Automa on brown spaces. */
  collectedCaves: number;
  /** Card IDs of cave cards collected by Automa. */
  caveCards: number[];
  /** Dragon Academy: cache tokens in Automa's Cache (1 VP per 2 tokens at game end). */
  cacheTokens: number;
}

export type ChoiceAnswer =
  | { kind: 'cards'; cardIds: number[] }
  | { kind: 'resources'; resources: Resource[] }
  | { kind: 'index'; index: number }
  | { kind: 'indexes'; indexes: number[] }
  | { kind: 'dragon'; pos: [number, number] }
  | { kind: 'dragons'; positions: [number, number][] }
  | { kind: 'eggSpots'; spots: EggSpot[] }
  | { kind: 'decline' }
  | { kind: 'confirm' }
  | { kind: 'option'; index: number }
  | { kind: 'assignTucks'; assignments: { cardId: number; pos: [number, number] }[] };

export type EggSpot = { kind: 'nest' } | { kind: 'dragon'; pos: [number, number] };

// ---------------------------------------------------------------------------
// Game state

export interface GuildState {
  tile: GuildTileId;
  /** Per-square marker occupants (parallel to GUILD_TILES[tile].squares). */
  squares: (PlayerId | null)[][];
  track: Record<PlayerId, number>; // position index on GUILD_TRACK
  /** Gambler's Guild end-game VP banked from drawing 4 dragon cards. */
  gamblerVp?: Partial<Record<PlayerId, number>>;
}

export interface GameState {
  rngState: number;
  phase: 'setup' | 'main' | 'roundEnd' | 'gameEnd';
  round: number; // 1..4
  turn: PlayerId;
  turnIndex: number;
  startPlayer: PlayerId;
  playerOrder: PlayerId[];
  players: PlayerState[];
  /** Card pools in use; 'academy' enables the replacement round tracker. */
  expansions: Expansion[];
  dragonDeck: number[];
  caveDeck: number[];
  dragonDisplay: (number | null)[];
  caveDisplay: (number | null)[];
  dragonDiscard: number[];
  caveDiscard: number[];
  objectives: ObjectiveId[]; // 4, index = round-1
  guild: GuildState;
  pending: PendingStep[];
  /** Queue of round-end once-per-round activations to process. */
  roundEndQueue: { playerId: PlayerId; pos: [number, number] }[];
  /** Academy: income space index each player claimed this round (cleared per round). */
  incomeChoices: Partial<Record<PlayerId, number>>;
  /** Academy: players still due to collect income during round end. */
  incomeQueue: PlayerId[];
  /** Players still resolving turn-end discards. */
  turnEnding: boolean;
  /** Setup offers: playerId -> dealt 6 cards. */
  setupOffers: Record<string, number[]>;
  /** Solo Automa state when playing against Automa. */
  automa?: AutomaState;
  finalScores: ScoreBreakdown[] | null;
  winners: PlayerId[] | null;
  log: string[];
}

export interface ScoreBreakdown {
  playerId: PlayerId;
  guildTile: number;
  printedDragonVp: number;
  endGameAbilities: number;
  eggs: number;
  cached: number;
  tucked: number;
  objectives: number;
  coins: number;
  bonusVP: number;
  leftovers: number; // 1 VP per 4 remaining cards+resources
  total: number;
  visibleDragons: number;
}
