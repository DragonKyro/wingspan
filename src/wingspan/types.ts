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
export const NEST_TYPES: NestType[] = ['bowl', 'cavity', 'ground', 'platform'];

/** Asia duet mode: the symbol on a Duet-map space. */
export type DuetCriterion =
  | { type: 'nest'; nest: 'bowl' | 'cavity' | 'ground' | 'platform' }
  | { type: 'food'; food: 'invertebrate' | 'seed' | 'fish' | 'fruit' | 'rodent' }
  | { type: 'wingspan'; lt50: boolean }
  | { type: 'beak'; left: boolean };

export interface DuetSpace {
  habitat: Habitat;
  criterion: DuetCriterion;
  /** Bonus printed on the space ('food' = pick a die, 'card' = tray or deck). */
  bonus: 'food' | 'egg' | 'card' | null;
}

/** Asia duet mode board: 36 spaces + an unbounded reset space. */
export interface DuetState {
  /** Owner of the token on each map space (null = unclaimed). */
  map: (PlayerId | null)[];
  /** Tokens parked in the reset space (each may be spent to reset feeder/tray). */
  reset: PlayerId[];
}

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
  /** Flightless birds store '*' (treated as 0 by `wingspanOf`). */
  wingspan: number | '*';
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
  // === americas expansion goals ===
  /** Birds worth even (0,2,4,6,8) or odd (1,3,5,7,9) points; hummingbirds count as 0. */
  | { kind: 'birdsParity'; parity: 'even' | 'odd' }
  /** Number of different point values among your birds (hummingbirds = 0). */
  | { kind: 'distinctPoints' }
  /** Sum of hummingbird-track token positions (raw index, not points). */
  | { kind: 'humPoints' }
  /** Sum of egg limits on your played birds (hummingbirds have none). */
  | { kind: 'eggLimitTotal' }
  /** Position index of the token in one hummingbird column. */
  | { kind: 'humColumn'; group: HumGroup }
  | { kind: 'unsupported'; text: string };

export interface GoalTile {
  id: number;
  set: string;
  text: string;
  goal: GoalKind;
}

// === americas expansion: hummingbird mini-cards ===
/** The five hummingbird taxonomic groups (track columns). */
export type HumGroup = 'bee' | 'brilliant' | 'emerald' | 'mango' | 'topaz';
export const HUM_GROUPS: HumGroup[] = ['bee', 'brilliant', 'emerald', 'mango', 'topaz'];

/** Benefit printed on a hummingbird card, granted when it is attracted. */
export type HumBenefit = 'card' | 'nectar' | 'egg' | 'advance' | 'row';

export interface HummingbirdCard {
  id: number;
  name: string;
  sciName: string;
  set: string;
  group: HumGroup;
  benefit: HumBenefit;
  bonusFlags: string[];
  /** Beak direction — hummingbirds count for beak-direction goals/bonuses. */
  beakLeft: boolean | null;
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
  /** Asia: eggs laid on this bird during the current turn (teal/brown powers
   *  that check "if you laid an egg on this bird this turn"). Reset each turn. */
  eggsGainedThisTurn?: number;
  /** Asia: food cached on this bird during the current turn (risky-roll
   *  predators return "all food cached here this turn"). Reset each turn. */
  cachedGainedThisTurn?: number;
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
  /** Take `count` dice from the feeder (`faces` restricts them). Answer `dice`
   *  with 1..count picks (the rest stay queued, so a mid-pick refill is seen
   *  first), `{ picks: [], reroll: true }` to reset an all-same-face feeder and
   *  pick from the new dice, or `{ picks: [] }` to take nothing. */
  | { kind: 'pickDie'; playerId: PlayerId; count: number; faces?: DieFace[]; then?: PendingTag }
  /** From the supply: choose which food types to take (optionally cache on `cache`). */
  | { kind: 'chooseSupplyFood'; playerId: PlayerId; count: number; options: FoodType[] | 'any'; cache?: BirdRef | null; then?: PendingTag }
  /** Lay an egg on a chosen bird; `nest` = filter, 'any' or 'other' (array = any listed type).
   *  `onlyBird` pins every egg to that one bird (the same ref may repeat);
   *  `adjacentTo` restricts to the birds in the neighbouring slots;
   *  `wingspanLt` restricts to birds whose wingspan is below the threshold;
   *  `habitat` restricts targets to one row; `eggsMax` restricts to birds with
   *  at most that many eggs already. */
  | { kind: 'chooseBirdForEgg'; playerId: PlayerId; count: number; nest: NestType | 'any' | 'other' | NestType[]; exclude?: BirdRef; overLimit?: number; optional?: boolean; onlyBird?: BirdRef; adjacentTo?: BirdRef; wingspanLt?: number; columnOf?: BirdRef; habitat?: Habitat; eggsMax?: number; then?: PendingTag }
  /** Discard eggs from chosen birds (power costs). `optional`: declining skips `then`. `habitat` restricts to one row.
   *  `moveTo`: the eggs move onto that bird instead of being discarded (americas egg-moving power). */
  | { kind: 'chooseBirdForEggDiscard'; playerId: PlayerId; count: number; exclude?: BirdRef; habitat?: Habitat; optional?: boolean; moveTo?: BirdRef; then?: PendingTag }
  /** Discard `count` resources of any mix: food tokens, eggs (from birds),
   *  and/or hand cards (asia "any 2 resources" powers). `optional` declines `then`. */
  | { kind: 'chooseResources'; playerId: PlayerId; count: number; optional?: boolean; then?: PendingTag }
  /** Discard a card from hand (e.g. end-of-turn discard powers). `optional`: declining skips `then`. */
  | { kind: 'chooseHandDiscard'; playerId: PlayerId; count: number; optional?: boolean; then?: PendingTag }
  /** Tuck a card from hand behind `bird`. `optional`: declining skips `then`.
   *  `wingspanLt` restricts to hand cards with wingspan below the threshold (americas). */
  | { kind: 'chooseHandTuck'; playerId: PlayerId; bird: BirdRef; optional?: boolean; wingspanLt?: number; then?: PendingTag }
  /** Discard a bird card carrying one of `costFoods` in its food cost, from
   *  the tray and/or the player's hand (americas Limpkin). */
  | { kind: 'chooseCardDiscard'; playerId: PlayerId; costFoods: FoodType[]; fromTray: boolean; fromHand: boolean; optional?: boolean; then?: PendingTag }
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
  | { kind: 'chooseTrayCard'; playerId: PlayerId; habitat?: Habitat; peek?: boolean; then?: PendingTag }
  /** A plain "draw N [card]" (not "from the deck"): as in the draw-cards action,
   *  each card is a face-up tray card or the top of the deck, picked one at a
   *  time (answer `trayPick` with `cardId` for a tray card, without it for the
   *  deck). Rulebook: "You may choose to draw face-up cards or from the deck as
   *  normal". `then` runs after the last card. */
  | { kind: 'chooseCardDraw'; playerId: PlayerId; count: number; then?: PendingTag }
  /** Round end (teal) / game end (yellow): which of your waiting birds' powers
   *  runs next — "you may resolve your birds' powers in any order" / "you may
   *  activate them in any order". Answer `repeatTarget` with the bird. */
  | { kind: 'choosePowerOrder'; playerId: PlayerId; queue: 'roundEnd' | 'gameEnd'; birds: BirdRef[]; then?: PendingTag }
  /** Not a player choice: runs `then` when it reaches the head of the queue
   *  (e.g. a check after every other player has made their own choice). */
  | { kind: 'deferredEffect'; playerId: PlayerId; then: PendingTag }
  /** "Draw N [card] ... play one of those birds for free; discard the rest":
   *  the player picks the bird and its habitat (answer `handCards` with one
   *  card id + `habitat`), or plays none (`handCards` with no ids). */
  | { kind: 'choosePoolPlay'; playerId: PlayerId; cardIds: number[]; then?: PendingTag }
  /** Remove `count` dice from the feeder without gaining their food. */
  | { kind: 'chooseDieRemove'; playerId: PlayerId; count: number; then?: PendingTag }
  /** Pick `min`..`max` own birds (optionally within one habitat).
   *  `exclude`/`nest`/`eggsMin`/`costFood`/`adjacentTo`/`hasEggs`/`hasCached`/
   *  `needRoom` filter the eligible birds. */
  | { kind: 'chooseBirds'; playerId: PlayerId; min: number; max: number; habitat?: Habitat; exclude?: BirdRef; nest?: NestType; eggsMin?: number; costFood?: FoodType; adjacentTo?: BirdRef; hasEggs?: boolean; hasCached?: boolean; needRoom?: boolean; then?: PendingTag }
  /** Tuck hand cards behind `targets`: card i goes behind targets[i]; 0..len may be picked. */
  | { kind: 'assignHandTucks'; playerId: PlayerId; targets: BirdRef[]; then?: PendingTag }
  /** Cache `count` food (`food`) from the supply on any of your birds (stackable).
   *  'any' = the chooser picks which types. `habitat` restricts targets to a row;
   *  `optional` allows fewer/none; `maxPerBird` caps caches per bird. */
  | { kind: 'chooseCacheOnBirds'; playerId: PlayerId; count: number; food: FoodType | 'any'; habitat?: Habitat; optional?: boolean; maxPerBird?: number; then?: PendingTag }
  /** Name a food type (e.g. "all players gain 1 of the chosen food").
   *  `missing`: only players with none of that food gain it (americas Oilbird). */
  | { kind: 'chooseFoodType'; playerId: PlayerId; missing?: boolean; then?: PendingTag }
  /** Pick one of several mutually exclusive effects. */
  | { kind: 'chooseOption'; playerId: PlayerId; options: PowerOption[]; then?: PendingTag }
  /** Discard cached food from your birds (`count` items). */
  | { kind: 'chooseCachedDiscard'; playerId: PlayerId; count: number; optional?: boolean; then?: PendingTag }
  /** Drew cards face-down to distribute: this player keeps `keep` (default 1)
   *  of `cardIds`; `discardRest` sends the remainder to the discard pile
   *  (default: nothing happens to them — the continuation decides). */
  | { kind: 'chooseDrawnCard'; playerId: PlayerId; cardIds: number[]; keep?: number; discardRest?: boolean; then?: PendingTag }
  /** Keep `keep` of `cardIds` bonus cards, discard the rest. `fromDiscard`: the
   *  pool is the discarded-bonus-cards pile and unchosen cards return there
   *  (Wrybill). */
  | { kind: 'chooseBonusCards'; playerId: PlayerId; cardIds: number[]; keep: number; fromDiscard?: boolean; fromHand?: boolean; copyFrom?: PlayerId; then?: PendingTag }
  /** Discard `count` bonus cards from hand. `optional`: a 0-length answer declines. */
  /** `upTo`: discard 0..count ("discard up to / any number"); `then` runs with
   *  however many were discarded, none included. */
  | { kind: 'discardBonusCards'; playerId: PlayerId; count: number; optional?: boolean; upTo?: boolean; then?: PendingTag }
  /** Move `bird` to another habitat (rightmost-bird powers). */
  | { kind: 'moveBirdHabitat'; playerId: PlayerId; bird: BirdRef; then?: PendingTag }
  /** Pick which player goes first in an everyone-gains effect. */
  | { kind: 'chooseFirstPlayer'; playerId: PlayerId; effect: 'gainDie'; then?: PendingTag }
  /** Pick another bird in `habitat` whose brown/predator power to repeat.
   *  `excludeIds`: slot indices already activated (americas "activate any or
   *  all brown powers" chains until declined); `optional` allows declining. */
  | { kind: 'chooseRepeatPower'; playerId: PlayerId; habitat: Habitat; predatorOnly?: boolean; excludeIds?: number[]; optional?: boolean; then?: PendingTag }
  /** Play an additional bird (normal cost) in `habitat`. `optional`: may decline. 'any': the resolver picks the habitat. `eggDiscount` reduces the column egg cost (Oceania powers).
   *  `column` (americas): the bird must be played at that column index —
   *  eligible rows are those whose next slot IS that column. */
  | { kind: 'chooseAdditionalPlay'; playerId: PlayerId; habitat: Habitat | 'same' | 'any'; sourceBird?: BirdRef; optional?: boolean; eggDiscount?: number; foodDiscount?: FoodType; column?: number; then?: PendingTag }
  /** Cache up to `count` food from the supply onto `bird` (choose which types). */
  | { kind: 'chooseCacheFood'; playerId: PlayerId; bird: BirdRef; count: number; optional?: boolean; then?: PendingTag }
  /** Spend a wild food for any other type from the supply.
   *  `spentHabitat`: a nectar given counts toward that habitat's end-game nectar. */
  | { kind: 'chooseWildTrade'; playerId: PlayerId; from: FoodType | 'any'; spentHabitat?: Habitat; then?: PendingTag }
  /** Cache-or-keep for food just gained with a "may cache" power. */
  | { kind: 'chooseCacheGained'; playerId: PlayerId; bird: BirdRef; food: FoodType; then?: PendingTag }
  /** Oceania: copy a brown power on a bird in `target`'s `habitat` row; the
   *  effect runs for `playerId` as the copying bird's own power.
   *  `habitat` 'any' (americas): copy a brown power anywhere on their mat. */
  | { kind: 'chooseCopyPower'; playerId: PlayerId; target: PlayerId; habitat: Habitat | 'any'; then?: PendingTag }
  /** Oceania: take a face-up tray card matching `nests`/`wingspanLt`;
   *  `mayResetTray` allows discarding+refilling the tray first.
   *  `destination` 'hand' or 'tuck' (onto `bird`). */
  | { kind: 'chooseTrayCardEx'; playerId: PlayerId; nests?: NestType[]; wingspanLt?: number; costFoods?: FoodType[]; mayResetTray?: boolean; destination: 'hand' | 'tuck'; bird?: BirdRef; then?: PendingTag }
  /** Oceania: a card the player just drew — tuck it behind `bird` or keep it in hand. */
  | { kind: 'chooseTuckOrHand'; playerId: PlayerId; bird: BirdRef; cardId: number; then?: PendingTag }
  /** Oceania: cache up to `count` food from the player's own supply on `bird`. */
  | { kind: 'chooseCacheFromSupply'; playerId: PlayerId; bird: BirdRef; count: number; food: FoodType | 'any'; options?: FoodType[]; habitat?: Habitat; optional?: boolean; then?: PendingTag }

  // === asia expansion steps ===
  /** Duet mode: place a duet token on a matching unclaimed map space, or the
   *  reset space. `cardId`/`foods` describe the just-played bird. */
  | { kind: 'chooseDuetSpace'; playerId: PlayerId; cardId: number; habitat: Habitat; foods: FoodType[]; then?: PendingTag }
  /** Asia: discard any number of tray cards (0..3), then refill the tray. */
  | { kind: 'chooseTrayDiscard'; playerId: PlayerId; then?: PendingTag }
  /** Asia: move `bird` (the card only) to another player's mat; you pick its habitat. */
  | { kind: 'moveBirdToPlayer'; playerId: PlayerId; bird: BirdRef; target: PlayerId; then?: PendingTag }
  /** Generic yes/no gate for "you may" sub-effects. */
  | { kind: 'confirm'; playerId: PlayerId; prompt?: string; then?: PendingTag }
  /** Pick hand cards without spending them (the continuation decides their use). */
  | { kind: 'chooseHandPick'; playerId: PlayerId; count: number; optional?: boolean; then?: PendingTag }
  /** Pick `min`..`count` cards of a drawn pool to tuck behind `bird`; the rest go to hand or the discard pile. */
  | { kind: 'choosePoolTuck'; playerId: PlayerId; cardIds: number[]; count: number; min?: number; bird: BirdRef; rest: 'hand' | 'discard'; then?: PendingTag }
  /** Asia: copy a white "when played" power on a bird of a neighbouring player. */
  | { kind: 'chooseCopyPlayed'; playerId: PlayerId; then?: PendingTag }
  /** Asia: pick feeder dice to reroll (empty pick = stop), up to `then.n` times. */
  | { kind: 'chooseReroll'; playerId: PlayerId; then?: PendingTag }
  /** Asia: "up to N times, draw 1 card" — answer yes to draw another, no to stop. */
  | { kind: 'drawUpTo'; playerId: PlayerId; left: number; bird: BirdRef; pool: number[]; then?: PendingTag }

  // === americas expansion steps (hummingbirds) ===
  /** Pick which hummingbird to attract into `habitat`'s empty hummingbird
   *  space: the top card of a garden slot (answer = slot index), or 'deck' to
   *  take the top of the hummingbird deck. `groups` restricts garden picks to
   *  those groups (group-named attract powers — deck draw is then illegal).
   *  `lazy` (the row's owed hummingbird action) re-decides attract vs return
   *  when the step comes up, since earlier steps may have changed the space. */
  | { kind: 'chooseHumSource'; playerId: PlayerId; habitat: Habitat; groups?: HumGroup[]; lazy?: boolean; then?: PendingTag }
  /** Pick a garden slot for the hummingbird being returned from `habitat`'s
   *  hummingbird space (may cover a garden card). `lazy`: see chooseHumSource. */
  | { kind: 'chooseHumCover'; playerId: PlayerId; habitat: Habitat; lazy?: boolean; then?: PendingTag }
  /** Move one hummingbird token `count` space(s) up (or down with `down`) in
   *  a chosen column. `groups` lists the eligible columns. */
  | { kind: 'chooseHumColumn'; playerId: PlayerId; groups: HumGroup[]; down?: boolean; then?: PendingTag }
  /** Pick a row for a hummingbird action. `mode` 'attract' (empty spaces),
   *  'return' (occupied), 'either' (the space decides); `exclude` removes a
   *  row; `groups` restricts to actions producing a hummingbird of those
   *  groups; `optional` allows declining (all-players-may powers). */
  | { kind: 'chooseHumHabitat'; playerId: PlayerId; mode: 'attract' | 'return' | 'either'; exclude?: Habitat; groups?: HumGroup[]; optional?: boolean; then?: PendingTag };

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
  | 'gain2Dice'
  /** Asia: take a face-up card from the tray (duet card bonus). */
  | 'trayCard'
  /** Asia: "gain 1 seed or tuck a deck card" and "cache wild or tuck hand" choices. */
  | 'gainSeed'
  | 'tuckDeckCard'
  | 'asiaCacheWild'
  | 'asiaTuckHand'
  // === americas expansion options ===
  /** Southern Lapwing: 1 egg on this bird (vs drawCard). */
  | 'selfEgg1'
  /** Great-Tailed Grackle: tuck up to 3 hand cards (vs tuckDeckCard). */
  | 'tuck3Hand'
  /** Great Potoo: take the die now vs reset the feeder then take it. */
  | 'takeDieNow'
  | 'resetThenDie'
  /** Firewood-Gatherer: move eggs onto this bird vs off it. */
  | 'moveEggsIn'
  | 'moveEggsOut'
  /** Scarlet Ibis: tuck from hand + draw, optionally resetting the tray first. */
  | 'tuckHandDraw'
  | 'resetTrayTuckDraw'
  /** Southern Screamer: tuck a hand card (vs untuckDraw3). */
  | 'tuckHand'
  /** Southern Screamer: discard a tucked card to draw 3. */
  | 'untuckDraw3'
  /** Wattled Jacana follow-up: trade a hand card with a tray card, or skip. */
  | 'traySwap'
  | 'skip'
  /** Promo Canada Warbler: all players lay 1 egg vs all players draw 1 card. */
  | 'allLayEgg'
  | 'allDrawCard';

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
  /** Food types gained from the BIRDFEEDER this turn (asia "gained an X from
   *  the birdfeeder on this turn" powers). Reset when a turn starts. */
  feederGainedThisTurn: FoodType[];
  /** Bonus cards copied from neighbours by game-end powers (asia Adjutant etc.)
   *  — scored against this player's birds as extra hand bonus cards. */
  copiedBonus: number[];
  // === americas expansion ===
  /** Hummingbird card id sitting on each row's hummingbird space (null = empty). */
  humBoard: Record<Habitat, number | null>;
  /** Token position per hummingbird column (index into HUM_TRACK; 0 = START). */
  humTrack: Record<HumGroup, number>;
  /** Hummingbird ids this player returned to the garden this turn — they may
   *  not be re-attracted by this player this turn (no takebacks). Reset per turn. */
  humReturned: number[];
  /** Rufous Hornero: a placeholder egg sits on the next empty slot of each
   *  listed habitat; playing a bird there discounts its egg cost by 1. */
  horneroEggs: Habitat[];
}

export interface ScoreBreakdown {
  birdPoints: number;
  bonusPoints: number;
  eggs: number;
  cached: number;
  tucked: number;
  nectar: number;
  /** Americas: sum of hummingbird-track token point values (may be negative). */
  hummingbirds: number;
  /** Duet mode: 1 pt per token in the largest contiguous group on the duet map. */
  duetTokens: number;
  goalPoints: number;
  total: number;
}

/** Player-count / rules variant: standard (1-5), asia duet (2, duet map),
 *  asia flock (6-7, flock goal board). */
export type GameMode = 'standard' | 'duet' | 'flock';

export type AutomaDifficulty = 'eaglet' | 'eagle' | 'eagleEyed';

export interface AutomaSettings {
  difficulty?: AutomaDifficulty;
  automubonSociety?: boolean;
  hoard?: boolean;
}

export type AutomaSectionAction =
  | { kind: 'drawCards' }
  | { kind: 'gainFood'; order: DieFace[] }
  | { kind: 'playBird' }
  | { kind: 'layEggs'; count: number }
  | { kind: 'placeGoalCube' }
  | { kind: 'removeGoalCube' }
  | { kind: 'activatePink' };

export interface AutomaCard {
  id: number;
  name?: string;
  /** 1-based round (1, 2, or 3) after which this card is removed from the Automa deck. */
  removeAfterRound: 1 | 2 | 3 | null;
  expert?: boolean;
  /** Section actions for Rounds 1..4 (0-indexed: rounds[0]..rounds[3]). */
  rounds: [
    AutomaSectionAction[],
    AutomaSectionAction[],
    AutomaSectionAction[],
    AutomaSectionAction[],
  ];
}

export interface AutomaState {
  difficulty: AutomaDifficulty;
  bonusCardId: number;
  deck: number[];
  discard: number[];
  lastCardId: number | null;
  faceUpBirds: number[];
  faceDownBirds: number;
  eggs: number;
  goalCubes: number;
  hoardTokens: number;
  /** Oceania: spent nectar per habitat for end-game majority scoring. */
  nectarSpent: Record<Habitat, number>;
  /** Americas: hummingbird track token positions per group. */
  humTrack: Record<HumGroup, number>;
}

export interface GameSettings {
  /** Expansion set ids included in the deck, e.g. ['core'] or ['oceania']. */
  sets: string[];
  /** Goal board side: 'green' = ranked competitive scoring, 'blue' = 1 pt per item (max 5). */
  goalSide: 'green' | 'blue';
  /** 'duet' = asia 2-player mode with the duet map + duet goal tiles;
   *  'flock' = 6-7 player rules (flock goal board). */
  mode?: GameMode;
  aiLevel?: number;
  /** Official solo mode against the Automa. */
  automa?: AutomaSettings;
}

export interface GameState {
  phase: Phase;
  rngState: number;
  playerOrder: PlayerId[];
  currentPlayerIndex: number;
  /** Index into playerOrder of the player holding the first-player token
   *  this round (duet: passed to the round-goal loser). */
  firstPlayerIndex: number;
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
  /** Duet mode board (asia), null in other modes. */
  duet?: DuetState;
  /** Solo mode Automa state, undefined in standard multiplayer. */
  automa?: AutomaState;
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
  /** Pink powers triggered this turn whose text says "at the end of their
   *  turn": they run when the active player's turn ends (before the tray
   *  refills), not at the trigger. `trigger` is the PinkTrigger (JSON). */
  endOfTurnPinks?: { owner: PlayerId; bird: BirdRef; actor: PlayerId; trigger: unknown }[];
  /** Game-end yellow powers remaining: resolved one at a time in 'gameEnd'. */
  gameEndQueue: { playerId: PlayerId; bird: BirdRef }[] | null;
  // === americas expansion ===
  /** Hummingbird mini-deck + discard pile + the 5-slot garden (each slot is a
   *  stack, last element on top). All null/empty when the set isn't included. */
  humDeck: number[];
  humDiscard: number[];
  humGarden: number[][];
  /** The habitat whose hummingbird action is owed at the end of the current
   *  activation (set by the three row actions; consumed when activation ends). */
  humAction: Habitat | null;
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
  /** `habitat` disambiguates 'any'-habitat additional plays. For an
   *  additional play (chooseAdditionalPlay), the player may also say how they
   *  pay — "discarding eggs from any birds", which food tokens (2-for-1 and
   *  nectar included), and for "you may ignore 1 [food] or 1 [egg]" which one
   *  (`ignore`). Omitted parts are paid automatically. */
  | {
      kind: 'handCards';
      cardIds: number[];
      habitat?: Habitat;
      foodPayments?: FoodType[];
      eggPayments?: BirdRef[];
      ignore?: 'food' | 'egg';
    }
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
  | { kind: 'trayPick'; cardId?: number; mode?: 'reset' | 'refill' }
  /** Duet mode: place a token on map space N, or in the reset space. */
  | { kind: 'duetSpace'; space: number | 'reset' }
  /** Asia "any resources" discards: a mix of supply food, eggs, and hand cards. */
  | { kind: 'resources'; foods: FoodType[]; eggs: BirdRef[]; cards: number[] }
  /** Copy target naming another player's bird (asia white-power copy). */
  | { kind: 'playedTarget'; player: PlayerId; bird: BirdRef }
  /** Americas: pick a hummingbird source — a garden slot index or 'deck'. */
  | { kind: 'humPick'; source: number | 'deck' }
  /** Americas: pick the garden slot a returned hummingbird covers (0-4). */
  | { kind: 'humCover'; slot: number }
  /** Americas: pick the hummingbird column whose token moves. */
  | { kind: 'humColumn'; group: HumGroup };

export interface EndTurnAction extends BaseAction {
  type: 'endTurn';
}

/** Duet mode: spend a token from the reset space to reset the feeder or tray. */
export interface DuetResetAction extends BaseAction {
  type: 'duetReset';
  target: 'feeder' | 'tray';
}

/** Solo mode: execute the Automa's entire turn from the top Automa deck card. */
export interface AutomaTurnAction extends BaseAction {
  type: 'automaTurn';
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
  | EndTurnAction
  | DuetResetAction
  | AutomaTurnAction;

export interface CreateGameOptions {
  playerNames: string[];
  playerTypes: ('human' | 'ai')[];
  playerColors: PlayerColor[];
  seed: number;
  settings?: Partial<GameSettings>;
}
