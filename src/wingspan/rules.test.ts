// Targeted rule tests for engine mechanics that were previously covered
// only indirectly: end-of-turn discards, the all-same-face reroll, feeder
// auto-refill, pink once-per-turn timing, goal tie-splitting and
// zero-unit exclusion, and right-to-left power activation.

import { describe, expect, it } from 'vitest';
import { chooseAction } from '@/wingspan/ai/chooseAction';
import { greedyChoice } from '@/wingspan/ai/choices';
import { finishRound, internals } from './actions';
import { bird, BIRDS, BONUS_CARDS } from './cards';
import { HUM_BONUS_SPACES } from './constants';
import { createGame } from './createGame';
import { DUET_MAP, duetFoodsFor, FLOCK_GOAL_POINTS } from './duetMap';
import { applyAction, settle } from './engine';
import { actingPlayerId, getPlayer } from './helpers';
import { firePinkTriggers, resetPinkFlags, runPower, setPlayer } from './powers';
import { bonusCardVp, bonusUnits, finalScore, goalScore, nectarPoints } from './scoring';
import type { BirdRef, GameState, PlayerId, PlayerState, PlayedBird } from './types';

const COMMON_YELLOWTHROAT = 94; // brown: draw 2, discard 1 at end of turn.
const EASTERN_KINGBIRD = 104; // pink: +1 invertebrate when another plays in forest.
const ACORN_WOODPECKER = 2; // brown: gain seed from feeder, may cache.
const KILLDEER = 157; // brown: discard 1 egg to draw 2 cards.
const WOODCOCK = 13; // no power.
const CARDS_IN_HAND_GOAL = 2008;

function newGame(seed = 42, sets = ['core']): GameState {
  return createGame({
    playerNames: ['A', 'B'],
    playerTypes: ['human', 'human'],
    playerColors: ['red', 'blue'],
    seed,
    settings: { sets },
  });
}

function autoSetup(s: GameState): GameState {
  while (s.phase === 'setup' && s.setupRemaining.length > 0) {
    const pid = s.setupRemaining[0]!;
    const p = getPlayer(s, pid);
    s = applyAction(s, {
      type: 'keepSetup',
      playerId: pid,
      keepBirds: p.hand.slice(0, 2),
      keepBonus: p.bonusHand[0]!,
      discardFood: ['invertebrate', 'seed'],
    });
  }
  return s;
}

function autoResolve(s: GameState): GameState {
  let guard = 0;
  while (s.pending.length > 0 && guard++ < 100) {
    const step = s.pending[0]!;
    const choice = greedyChoice(s, step);
    if (!choice) throw new Error(`no greedy answer for ${step.kind}`);
    s = applyAction(s, { type: 'resolveChoice', playerId: step.playerId, choice });
  }
  return s;
}

function edit(s: GameState, pid: `p${number}`, patch: Partial<PlayerState>): GameState {
  return setPlayer(s, { ...getPlayer(s, pid), ...patch });
}

function mkBird(cardId: number, extra: Partial<PlayedBird> = {}): PlayedBird {
  return { cardId, eggs: 0, tucked: [], cached: [], ...extra };
}

const ref = (habitat: 'forest' | 'grassland' | 'wetland', index: number): BirdRef => ({
  habitat,
  index,
});

describe('end-of-turn discard', () => {
  it('resolving the queued discard finishes the turn for the next player', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const nextPid = s.playerOrder[(s.currentPlayerIndex + 1) % s.playerOrder.length]!;
    s = edit(s, pid, {
      board: { forest: [], grassland: [], wetland: [mkBird(COMMON_YELLOWTHROAT)] },
    });
    // The brown power draws 2 cards and flags an end-of-turn discard.
    s = runPower(s, pid, ref('wetland', 0));
    expect(getPlayer(s, pid).endOfTurnDiscards).toBe(1);
    s = applyAction(s, { type: 'endTurn', playerId: pid });
    expect(s.pending[0]?.kind).toBe('chooseHandDiscard');
    // The turn is not over until the discard is answered.
    expect(actingPlayerId(s)).toBe(pid);
    s = autoResolve(s);
    expect(s.pending.length).toBe(0);
    // Regression: tray refill + player advancement + flag reset ran, and the
    // next player is free to act.
    expect(actingPlayerId(s)).toBe(nextPid);
    expect(getPlayer(s, pid).endOfTurnDiscards).toBe(0);
    expect(s.turnTookAction).toBe(false);
    expect(s.tray.every((id) => id != null)).toBe(true);
  });
});

describe('birdfeeder rules', () => {
  it('allows the free reroll only when every die shows the same face', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = { ...s, feederIn: ['seed', 'fish', 'seed', 'seed', 'rodent'] };
    expect(() =>
      applyAction(s, {
        type: 'gainFood',
        playerId: pid,
        reroll: true,
        picks: [{ die: 0, take: 'seed' }],
      }),
    ).toThrow();
    // A single remaining die is "all the same face" per the rulebook.
    s = { ...s, feederIn: ['seed'] };
    s = applyAction(s, {
      type: 'gainFood',
      playerId: pid,
      reroll: true,
      picks: [{ die: 0, take: 'seed' }],
    });
    // 5 fresh dice were rolled and one was taken.
    expect(s.feederIn.length).toBe(4);
  });

  it('throws all 5 dice back in when the feeder empties mid-pick', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    // Two birds in the forest → the action lands on the 2-dice slot.
    s = edit(s, pid, {
      board: { forest: [mkBird(WOODCOCK), mkBird(WOODCOCK)], grassland: [], wetland: [] },
    });
    s = { ...s, feederIn: ['seed'] };
    s = applyAction(s, {
      type: 'gainFood',
      playerId: pid,
      picks: [
        { die: 0, take: 'seed' },
        { die: 0, take: 'seed' },
      ],
    });
    // First pick emptied the feeder → 5 dice came back → second took one.
    expect(s.feederIn.length).toBe(4);
    expect(getPlayer(s, pid).food.seed).toBeGreaterThanOrEqual(1);
  });

  it('does not grant a second free reroll after a paid Oceania mat reset', () => {
    let s = autoSetup(newGame(7, ['core', 'oceania']));
    const pid = actingPlayerId(s);
    // Forest slot 1 on the Oceania mat offers the paid reset; put a bird in
    // the forest so the cube lands there, and make the feeder mixed.
    s = edit(s, pid, { board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    s = { ...s, feederIn: ['seed', 'fish', 'fruit', 'rodent', 'nectar'] };
    const foodBefore = Object.values(getPlayer(s, pid).food).reduce((a, b) => a + b, 0);
    // reroll on a non-same feeder must fail even when paying for a reset.
    expect(() =>
      applyAction(s, {
        type: 'gainFood',
        playerId: pid,
        reroll: true,
        rerollCost: 'seed',
        picks: [
          { die: 0, take: 'seed' },
          { die: 0, take: 'seed' },
        ],
      }),
    ).toThrow();
    // The paid reset alone is legal: pay 1 food, feeder refreshes once.
    s = applyAction(s, {
      type: 'gainFood',
      playerId: pid,
      rerollCost: 'fish',
      picks: [
        { die: 0, take: 'seed' },
        { die: 0, take: 'seed' },
      ],
    });
    // Paid 1 fish for the reset, then gained the 2 dice picked.
    const foodAfter = Object.values(getPlayer(s, pid).food).reduce((a, b) => a + b, 0);
    expect(foodAfter).toBe(foodBefore + 1);
    expect(s.feederIn.length).toBe(3); // 5 fresh dice, 2 taken
  });
});

describe('pink once-per-turn powers', () => {
  it('fires once between turns and re-arms at the start of the owner’s turn', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p2', {
      board: { forest: [mkBird(EASTERN_KINGBIRD)], grassland: [], wetland: [] },
    });
    const foodOf = (st: GameState) => getPlayer(st, 'p2').food.invertebrate;
    const before = foodOf(s);
    const trig = { kind: 'playBird', habitat: 'forest', cardId: WOODCOCK } as const;
    s = firePinkTriggers(s, 'p1', trig);
    expect(foodOf(s)).toBe(before + 1);
    // A second matching trigger in the same window does nothing.
    s = firePinkTriggers(s, 'p1', trig);
    expect(foodOf(s)).toBe(before + 1);
    // At the start of p2's own turn the flag clears — it can fire again.
    s = resetPinkFlags(s, 'p2');
    s = firePinkTriggers(s, 'p1', trig);
    expect(foodOf(s)).toBe(before + 2);
  });
});

describe('goal scoring', () => {
  const roundEndState = (): GameState => ({
    ...autoSetup(newGame()),
    phase: 'roundEnd',
    round: 0,
    roundEndQueue: [],
    goalTiles: [CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL],
  });

  it('splits summed rank points (rounded down) between tied players', () => {
    let s = roundEndState();
    s = edit(s, 'p1', { hand: [1, 2, 3] });
    s = edit(s, 'p2', { hand: [4, 5, 6] });
    // Round 1 green table is [4,1] — a 1st-place tie splits (4+1)/2 → 2 each.
    s = finishRound(s);
    expect(s.goalScores[0]).toEqual([2, 2]);
  });

  it('gives no rank to a player with zero units', () => {
    let s = roundEndState();
    s = edit(s, 'p1', { hand: [1, 2, 3] });
    s = edit(s, 'p2', { hand: [] });
    s = finishRound(s);
    expect(s.goalScores[0]).toEqual([4, 0]);
  });

  it('duet “fewest on bonus spaces” excludes a player with zero tokens', () => {
    let s = autoSetup(
      createGame({
        playerNames: ['A', 'B'],
        playerTypes: ['ai', 'ai'],
        playerColors: ['red', 'blue'],
        seed: 7,
        settings: { sets: ['core', 'asia'], mode: 'duet' },
      }),
    );
    const map: (PlayerId | null)[] = s.duet!.map.slice();
    map[0] = 'p2'; // forest bonus space (food die)
    map[14] = 'p2'; // forest bonus space (food die)
    s = {
      ...s,
      phase: 'roundEnd',
      round: 0,
      roundEndQueue: [],
      goalTiles: [2043, 2043, 2043, 2043],
      duet: { ...s.duet!, map },
    };
    s = finishRound(s);
    // p1 has 0 tokens on bonus spaces and cannot win "fewest"; p2 scores.
    expect(s.goalScores[0]).toEqual([0, 2]);
  });

  it('scores blue-side goals at 1 pt per item up to max 5 (no competition)', () => {
    let s = createGame({
      playerNames: ['A', 'B'],
      playerTypes: ['human', 'human'],
      playerColors: ['red', 'blue'],
      seed: 12,
      settings: { sets: ['core', 'americas'], goalSide: 'blue' },
    });
    expect(s.settings.goalSide).toBe('blue');
    s = autoSetup(s);
    s = edit(s, 'p1', { hand: [1, 2, 3, 4, 5, 6, 7] }); // 7 cards → capped at 5
    s = edit(s, 'p2', { hand: [8, 9, 10] }); // 3 cards → 3 pts
    s = {
      ...s,
      phase: 'roundEnd',
      round: 0,
      roundEndQueue: [],
      goalTiles: [CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL],
    };
    s = finishRound(s);
    expect(s.goalScores[0]).toEqual([5, 3]);
  });

  it('scores Americas blue-side goals: eggLimitTotal ÷ 5, humPoints best track, humColumn point value', () => {
    let s = createGame({
      playerNames: ['A', 'B'],
      playerTypes: ['human', 'human'],
      playerColors: ['red', 'blue'],
      seed: 12,
      settings: { sets: ['core', 'americas'], goalSide: 'blue' },
    });
    s = autoSetup(s);
    // Acorn Woodpecker (id 2) has eggLimit 4; 3 of them = 12 → floor(12 / 5) = 2 on blue side.
    expect(bird(ACORN_WOODPECKER).eggLimit).toBe(4);
    s = edit(s, 'p1', {
      board: {
        forest: [mkBird(ACORN_WOODPECKER), mkBird(ACORN_WOODPECKER), mkBird(ACORN_WOODPECKER)],
        grassland: [],
        wetland: [],
      },
      humTrack: { bee: 5, brilliant: 2, emerald: 0, mango: 0, topaz: 0 }, // bee=4 pts, brilliant=1 pt
    });
    // 2050 = Total of egg limits (blue side: ÷ 5)
    expect(goalScore(s, 'p1', 2050)).toBe(2);
    // 2049 = Hummingbird Points (blue side: best track = 4 pts)
    expect(goalScore(s, 'p1', 2049)).toBe(4);
    // 2051 = [bee] column (blue side: point value of bee token = 4 pts)
    expect(goalScore(s, 'p1', 2051)).toBe(4);
  });

  it('ranks a player with 0 or negative humPoints on green side when they moved up the track', () => {
    let s = createGame({
      playerNames: ['A', 'B', 'C'],
      playerTypes: ['human', 'human', 'human'],
      playerColors: ['red', 'blue', 'orange'],
      seed: 15,
      settings: { sets: ['core', 'americas'], goalSide: 'green' },
    });
    s = autoSetup(s);
    // p1: bee at 5 (4 pts), brilliant at 5 (4 pts), emerald at 2 (1 pt), mango at 0 (-3), topaz at 0 (-3) -> sum = +3?
    // Wait: make p1 sum to exactly 0: bee at 4 (3 pts), brilliant at 4 (3 pts), emerald at 1 (0 pts), mango at 0 (-3), topaz at 0 (-3) => 3+3+0-3-3 = 0!
    s = edit(s, 'p1', {
      humTrack: { bee: 4, brilliant: 4, emerald: 1, mango: 0, topaz: 0 },
    });
    // p2: moved once (bee at 1 = 0 pts, others at 0 = -3 each) => sum = -12!
    s = edit(s, 'p2', {
      humTrack: { bee: 1, brilliant: 0, emerald: 0, mango: 0, topaz: 0 },
    });
    // p3: never moved at all => sum = -15 (ineligible to score!).
    s = edit(s, 'p3', {
      humTrack: { bee: 0, brilliant: 0, emerald: 0, mango: 0, topaz: 0 },
    });
    expect(goalScore(s, 'p1', 2049)).toBe(0);
    expect(goalScore(s, 'p2', 2049)).toBe(-12);
    expect(goalScore(s, 'p3', 2049)).toBe(-15);
    s = {
      ...s,
      phase: 'roundEnd',
      round: 1, // Round 2 green points: [5, 2, 1]
      roundEndQueue: [],
      goalTiles: [2049, 2049, 2049, 2049],
    };
    s = finishRound(s);
    const idx1 = s.playerOrder.indexOf('p1');
    const idx2 = s.playerOrder.indexOf('p2');
    const idx3 = s.playerOrder.indexOf('p3');
    expect(s.goalScores[1]![idx1]).toBe(5); // 1st place (0 > -12)
    expect(s.goalScores[1]![idx2]).toBe(2); // 2nd place (-12, moved once)
    expect(s.goalScores[1]![idx3]).toBe(0); // unmoved (-15) cannot score
  });

  it('counts food icons in bird costs for costIncludes goals and ignores wild/nectar', () => {
    let s = autoSetup(newGame(7, ['core', 'oceania']));
    // Acorn Woodpecker (id 2) costs 3 seed; Grey Warbler (id 294) costs 1 invertebrate/seed/fruit ('or');
    // Woodcock (id 13) costs 2 invertebrate + 1 seed.
    s = edit(s, 'p1', {
      board: {
        forest: [mkBird(2), mkBird(294), mkBird(WOODCOCK)],
        grassland: [],
        wetland: [],
      },
    });
    // 2030 = [fruit] + [seed] in food cost of your birds:
    // Acorn Woodpecker = 3 seed; Grey Warbler ('or' inv/seed/fruit) = 1; Woodcock = 1 seed -> total 5!
    expect(goalScore(s, 'p1', 2030)).toBe(5);
    // 2031 = [invertebrate] in food cost of your birds:
    // Acorn Woodpecker = 0; Grey Warbler ('or') = 1; Woodcock = 2 inv -> total 3!
    expect(goalScore(s, 'p1', 2031)).toBe(3);
  });

  it('noGoal tile keeps the round action cube (+1 turn in following rounds) and resets cubesOnPlayBird', () => {
    let s = autoSetup(newGame(7, ['core', 'oceania']));
    s = edit(s, 'p1', { cubesOnPlayBird: 3 });
    s = {
      ...s,
      phase: 'roundEnd',
      round: 0,
      roundEndQueue: [],
      goalTiles: [2033, CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL, CARDS_IN_HAND_GOAL],
    };
    s = finishRound(s);
    expect(s.goalScores[0]).toEqual([0, 0]);
    // Round 2 normally gives 7 cubes; after round 1 noGoal, players get 8 cubes!
    for (const pl of s.players) {
      expect(pl.actionCubes).toBe(8);
      expect(pl.cubesOnPlayBird).toBe(0);
    }
  });
});

describe('oceania & asia & americas rule audit fixes', () => {
  it('splits nectar majority ties (rounded down) in standard mode and uses friendly ties in flock mode', () => {
    let s = createGame({
      playerNames: ['A', 'B', 'C'],
      playerTypes: ['human', 'human', 'human'],
      playerColors: ['red', 'blue', 'orange'],
      seed: 9,
      settings: { sets: ['core', 'oceania'] },
    });
    s = autoSetup(s);
    // Forest: p1 & p2 tied for 1st (2 each) -> floor((5+2)/2) = 3 each; p3 has 1 -> 3rd place = 0.
    // Grassland: p1 has 3 (1st = 5); p2 & p3 tied for 2nd (1 each) -> floor(2/2) = 1 each.
    // Wetland: all have 0 -> 0 pts.
    s = edit(s, 'p1', { nectarSpent: { forest: 2, grassland: 3, wetland: 0 } });
    s = edit(s, 'p2', { nectarSpent: { forest: 2, grassland: 1, wetland: 0 } });
    s = edit(s, 'p3', { nectarSpent: { forest: 1, grassland: 1, wetland: 0 } });
    expect(nectarPoints(s, 'p1')).toBe(3 + 5);
    expect(nectarPoints(s, 'p2')).toBe(3 + 1);
    expect(nectarPoints(s, 'p3')).toBe(0 + 1);

    // Flock mode: friendly ties (tied 1st gets 5 each, next-highest still gets 2).
    const flock: GameState = { ...s, settings: { ...s.settings, mode: 'flock' } };
    expect(nectarPoints(flock, 'p1')).toBe(5 + 5);
    expect(nectarPoints(flock, 'p2')).toBe(5 + 2);
    expect(nectarPoints(flock, 'p3')).toBe(2 + 2);
  });

  it('scores Oceania bonus cards (Mechanical Engineer, Site Selection Expert, Data Analyst)', () => {
    let s = autoSetup(newGame(7, ['core', 'oceania']));
    // 573 Acadian Flycatcher = wild nest (23cm); 2 Acorn Woodpecker = cavity (46cm);
    // 13 Woodcock = ground (46cm); 94 Common Yellowthroat = bowl (18cm).
    s = edit(s, 'p1', {
      board: {
        forest: [mkBird(94), mkBird(573), mkBird(2), mkBird(13)], // bowl(18), wild(23), cavity(46), ground(46)
        grassland: [mkBird(94)], // col 0 has bowl + bowl
        wetland: [mkBird(573)], // col 0 has bowl + bowl + wild = trio!
      },
    });
    const p = getPlayer(s, 'p1');
    // Mechanical Engineer (1036): bowl + cavity + ground + wild (substitutes platform) = 1 full set -> 3 VP.
    expect(bonusUnits(p, 'Mechanical Engineer')).toBe(1);
    expect(bonusCardVp(p, 1036)).toBe(3);
    // Site Selection Expert (1037): col 0 has bowl, bowl, wild = 3 matching nests -> 3 VP.
    expect(bonusCardVp(p, 1037)).toBe(3);
    // Forest Data Analyst (1034): 18 <= 23 <= 46 <= 46 = 4 consecutive ascending/equal birds -> 5 VP.
    expect(bonusUnits(p, 'Forest Data Analyst')).toBe(4);
    expect(bonusCardVp(p, 1034)).toBe(5);
  });

  it('Pūkeko lays an egg on orthogonally adjacent birds above/below as well as left/right', () => {
    const PUKEKO = 327;
    let s = autoSetup(newGame(7, ['core', 'oceania']));
    s = edit(s, 'p1', {
      board: {
        forest: [mkBird(WOODCOCK)], // col 0, above grassland col 0
        grassland: [mkBird(PUKEKO)], // col 0
        wetland: [],
      },
    });
    s = runPower(s, 'p1', ref('grassland', 0));
    expect(s.pending[0]?.kind).toBe('chooseBirdForEgg');
    s = autoResolve(s);
    expect(getPlayer(s, 'p1').board.forest[0]!.eggs).toBe(1);
  });

  it('verifies printed Duet Map bonus coordinates, Flock goal table, and Hummingbird bonus spaces', () => {
    expect(DUET_MAP.length).toBe(36);
    expect(DUET_MAP[0]).toEqual({ habitat: 'forest', criterion: { type: 'nest', nest: 'cavity' }, bonus: 'food' });
    expect(DUET_MAP[1]).toEqual({ habitat: 'forest', criterion: { type: 'wingspan', lt50: true }, bonus: 'card' });
    expect(DUET_MAP[4]).toEqual({ habitat: 'forest', criterion: { type: 'nest', nest: 'bowl' }, bonus: 'egg' });
    expect(DUET_MAP[18]).toEqual({ habitat: 'wetland', criterion: { type: 'nest', nest: 'platform' }, bonus: 'card' });
    expect(DUET_MAP[24]).toEqual({ habitat: 'wetland', criterion: { type: 'nest', nest: 'ground' }, bonus: 'egg' });
    expect(DUET_MAP[28]).toEqual({ habitat: 'grassland', criterion: { type: 'nest', nest: 'bowl' }, bonus: null });
    expect(FLOCK_GOAL_POINTS[2]).toEqual([7, 4, 3, 2, 1]);
    expect(FLOCK_GOAL_POINTS[3]).toEqual([8, 5, 4, 3, 2]);
    expect(HUM_BONUS_SPACES).toEqual({
      bee: [4, 8],
      brilliant: [2, 6],
      emerald: [1, 5],
      mango: [3, 7],
      topaz: [4, 8],
    });
    // Spending nectar on a wild-cost bird qualifies for any base food on the Duet map.
    expect(duetFoodsFor(bird(294), ['nectar'])).toEqual(['invertebrate', 'seed', 'fruit']);
  });
});

describe('promo bird powers', () => {
  it('runs Daurian Jackdaw, Lesser Prairie-Chicken, Western Yellow Wagtail, and California Scrub-Jay', () => {
    const DAURIAN_JACKDAW = 455;
    const PRAIRIE_CHICKEN = 587;
    const YELLOW_WAGTAIL = 570;
    const SCRUB_JAY = 583;
    let s = autoSetup(
      createGame({
        playerNames: ['A', 'B'],
        playerTypes: ['human', 'human'],
        playerColors: ['red', 'blue'],
        seed: 21,
        settings: { sets: ['core', 'promoAsia', 'promoUS', 'promoUK'] },
      }),
    );
    // 1. Daurian Jackdaw: caches goal tile (1 cached food) and sets round goal to noGoal (2033).
    s = edit(s, 'p1', {
      board: { forest: [mkBird(DAURIAN_JACKDAW)], grassland: [mkBird(PRAIRIE_CHICKEN)], wetland: [mkBird(YELLOW_WAGTAIL)] },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(getPlayer(s, 'p1').board.forest[0]!.cached.length).toBe(1);
    expect(s.goalTiles[s.round]).toBe(2033);

    // 2. Lesser Prairie-Chicken: draws 2 bonus cards, keeps 1, reveals the other for all players to score.
    s = runPower(s, 'p1', ref('grassland', 0));
    s = autoResolve(s);
    expect(getPlayer(s, 'p1').copiedBonus.length).toBe(1);
    expect(getPlayer(s, 'p2').copiedBonus).toEqual(getPlayer(s, 'p1').copiedBonus);

    // 3. Western Yellow Wagtail: counts double toward qualifying bonus cards (e.g. Anatomist).
    expect(bonusUnits(getPlayer(s, 'p1'), 'Anatomist')).toBeGreaterThanOrEqual(2);

    // 4. California Scrub-Jay: triggers when another player upgrades an action.
    s = edit(s, 'p2', {
      board: { forest: [mkBird(SCRUB_JAY)], grassland: [], wetland: [] },
    });
    s = firePinkTriggers(s, 'p1', { kind: 'actionUpgrade', food: 'seed' });
    expect(getPlayer(s, 'p2').board.forest[0]!.cached).toEqual(['seed']);
  });

  it('completes a full AI game with all promo sets enabled', () => {
    let s = createGame({
      playerNames: ['A', 'B'],
      playerTypes: ['ai', 'ai'],
      playerColors: ['red', 'blue'],
      seed: 33,
      settings: {
        sets: ['core', 'promoUS', 'promoEurope', 'promoAsia', 'promoNZ', 'promoCA', 'promoUK'],
      },
    });
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 5000) {
      const head = s.pending[0];
      const pid = head?.playerId ?? (s.phase === 'setup' ? s.setupRemaining[0] : actingPlayerId(s));
      if (!pid) break;
      const a = chooseAction(s, pid);
      if (!a) break;
      s = applyAction(s, a);
    }
    s = settle(s);
    expect(s.phase).toBe('gameOver');
    expect(s.finalScores).not.toBeNull();
  });
});

describe('activation order', () => {
  it('activates brown powers right to left', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = edit(s, pid, {
      board: {
        forest: [mkBird(ACORN_WOODPECKER), mkBird(KILLDEER), mkBird(COMMON_YELLOWTHROAT)],
        grassland: [],
        wetland: [],
      },
    });
    s = internals.startActivation(s, pid, 'forest');
    expect(s.activation?.remaining).toEqual([2, 1, 0]);
    // Stepping through activates the rightmost bird first.
    s = applyAction(s, { type: 'activatePower', playerId: pid });
    expect(s.activation?.remaining).toEqual([1, 0]);
    s = applyAction(s, { type: 'activatePower', playerId: pid });
    expect(s.activation?.remaining).toEqual([0]);
    s = applyAction(s, { type: 'activatePower', playerId: pid });
    expect(s.activation).toBeNull();
  });
});

describe('bonus card, goal tile, and edge-case audit', () => {
  it('exercises bonusCardVp across every non-automa bonus card in bonusCards.json (none return 0 when qualifying)', () => {
    const base = autoSetup(
      createGame({
        playerNames: ['A', 'B'],
        playerTypes: ['human', 'human'],
        playerColors: ['red', 'blue'],
        seed: 1,
        settings: {
          sets: [
            'core',
            'european',
            'oceania',
            'asia',
            'americas',
            'promoUS',
            'promoEurope',
            'promoAsia',
            'promoNZ',
            'promoCA',
            'promoUK',
          ],
        },
      }),
    );
    const p0 = getPlayer(base, 'p1');

    const nonAutoma = BONUS_CARDS.filter((bc) => !bc.name.startsWith('[automa]'));
    expect(nonAutoma.length).toBe(56);

    for (const bc of nonAutoma) {
      let p: PlayerState = { ...p0 };
      if (
        bc.name === 'Apiarist' ||
        bc.name === 'Brilliant Specialist' ||
        bc.name === 'Emerald Specialist' ||
        bc.name === 'Mango Specialist' ||
        bc.name === 'Topaz Specialist' ||
        bc.name === 'Hummingbird Counter' ||
        bc.name === 'Hummingbird Gardener'
      ) {
        p = {
          ...p,
          humTrack: { bee: 8, brilliant: 8, emerald: 8, mango: 8, topaz: 8 },
        };
      } else if (bc.name === 'Ecolodge Owner') {
        // Difference 0 between highest and lowest token values -> 6 VP.
        p = {
          ...p,
          humTrack: { bee: 5, brilliant: 5, emerald: 5, mango: 5, topaz: 5 },
        };
      } else if (bc.name === 'Visionary Leader') {
        p = { ...p, hand: [1, 2, 3, 4, 5, 6, 7, 8] };
      } else if (bc.name === 'Winter Feeder') {
        p = {
          ...p,
          food: { invertebrate: 3, seed: 3, fish: 2, fruit: 0, rodent: 0, nectar: 0 },
        };
      } else if (bc.name === 'Pellet Dissector') {
        p = {
          ...p,
          board: {
            forest: [mkBird(WOODCOCK, { cached: ['fish', 'fish', 'rodent', 'rodent'] })],
            grassland: [],
            wetland: [],
          },
        };
      } else if (bc.name === 'Behaviorist' || bc.name === 'Ethologist') {
        // Column 0 has brown (Acorn Woodpecker 2), white/none (Woodcock 13), pink (Eastern Kingbird 104).
        // Forest row also has brown, white, pink -> 3 power colors in one habitat.
        p = {
          ...p,
          board: {
            forest: [mkBird(ACORN_WOODPECKER), mkBird(WOODCOCK), mkBird(EASTERN_KINGBIRD)],
            grassland: [mkBird(WOODCOCK)],
            wetland: [mkBird(EASTERN_KINGBIRD)],
          },
        };
      } else if (bc.name === 'Mechanical Engineer' || bc.name === 'Site Selection Expert') {
        // 94 Common Yellowthroat = bowl, 2 Acorn Woodpecker = cavity, 13 Woodcock = ground, 573 Acadian Flycatcher = wild.
        p = {
          ...p,
          board: {
            forest: [mkBird(94), mkBird(2), mkBird(13), mkBird(573)],
            grassland: [mkBird(94)],
            wetland: [mkBird(573)],
          },
        };
      } else if (bc.name.endsWith('Data Analyst') || bc.name.endsWith('Ranger')) {
        // Strictly ascending points AND ascending wingspans:
        const b1 = BIRDS.find((b) => b.points === 1 && typeof b.wingspan === 'number' && b.wingspan <= 30)!;
        const b2 = BIRDS.find((b) => b.points === 3 && typeof b.wingspan === 'number' && b.wingspan > 30 && b.wingspan <= 60)!;
        const b3 = BIRDS.find((b) => b.points >= 6 && typeof b.wingspan === 'number' && b.wingspan > 60)!;
        const row = [mkBird(b1.id), mkBird(b2.id), mkBird(b3.id)];
        p = {
          ...p,
          board: { forest: row, grassland: row, wetland: row },
        };
      } else if (bc.name.endsWith('Population Monitor')) {
        // Bowl (94), cavity (2), ground (13), wild (573), wild (573) = 5 nest types!
        const row = [mkBird(94), mkBird(2), mkBird(13), mkBird(573), mkBird(573)];
        p = {
          ...p,
          board: { forest: row, grassland: row, wetland: row },
        };
      } else {
        // Find qualifying birds for this bonus card and populate all 15 board spaces with them
        // (with full eggs and tucked cards so Oologist, Breeding Manager, Avian Theriogenologist,
        // Citizen Scientist, Ecologist, Omnivore Specialist, etc. all qualify).
        const matchingBirds = BIRDS.filter((b) => {
          if (bc.name === 'Omnivore Specialist') {
            return (
              b.cost.kind === 'any' ||
              (b.cost.kind === 'and' && b.cost.items.some((i) => i.food === 'any'))
            );
          }
          if (bc.name === 'Diet Specialist') {
            if (b.cost.kind === 'none') return false;
            if (b.cost.kind === 'any') return b.cost.count === 3;
            if (b.cost.kind === 'or') return false;
            return b.cost.items.reduce((n, i) => n + i.count, 0) === 3;
          }
          if (bc.name === 'Endangered Species Protector') return b.bonusPower;
          if (bc.name === '[Fan Made] Caprimulgiform Specialist') {
            return /hummingbird|swift|needletail|nightjar|nighthawk|poor-?will|widow|frogmouth|potoo|pauraque|oilbird/i.test(
              b.name,
            );
          }
          if (
            bc.name === 'Breeding Manager' ||
            bc.name === 'Oologist' ||
            bc.name === 'Avian Theriogenologist' ||
            bc.name === 'Citizen Scientist' ||
            bc.name === 'Ecologist'
          ) {
            return b.eggLimit >= 4;
          }
          return b.bonusFlags.includes(bc.name);
        });
        expect(matchingBirds.length, `no matching birds found for ${bc.name}`).toBeGreaterThan(0);
        const makeRow = (offset: number) =>
          Array.from({ length: 5 }, (_, i) => {
            const c = matchingBirds[(offset + i) % matchingBirds.length]!;
            return mkBird(c.id, {
              eggs: Math.max(4, c.eggLimit),
              tucked: [1],
            });
          });
        p = {
          ...p,
          board: {
            forest: makeRow(0),
            grassland: makeRow(5),
            wetland: makeRow(10),
          },
        };
      }

      const units = bonusUnits(p, bc.name);
      const vp = bonusCardVp(p, bc.id);
      if (bc.name !== 'Ecolodge Owner') {
        expect(units, `${bc.name} (${bc.id}) units`).toBeGreaterThan(0);
      }
      expect(vp, `${bc.name} (${bc.id}) vp`).toBeGreaterThan(0);
    }
  });

  it('scores Duet tile 2042 in pairs of 2 tokens and maintains exact ScoreBreakdown sums', () => {
    let s = autoSetup(
      createGame({
        playerNames: ['A', 'B'],
        playerTypes: ['human', 'human'],
        playerColors: ['red', 'blue'],
        seed: 7,
        settings: { sets: ['core', 'asia'], mode: 'duet' },
      }),
    );
    const map = s.duet!.map.slice();
    // Find 3 spaces on DUET_MAP with the exact same criterion (e.g. forest cavity at indices 0 and 8, wetland cavity at 26).
    map[0] = 'p1';
    map[8] = 'p1';
    map[26] = 'p1';
    s = { ...s, duet: { ...s.duet!, map } };
    // 3 tokens on cavity nest spaces = 1 pair = 2 qualifying tokens (the 3rd has no partner).
    expect(goalScore(s, 'p1', 2042)).toBe(2);

    const bd = finalScore(s, 'p1');
    expect(bd.total).toBe(
      bd.birdPoints +
        bd.bonusPoints +
        bd.goalPoints +
        bd.eggs +
        bd.cached +
        bd.tucked +
        bd.nectar +
        bd.duetTokens +
        bd.hummingbirds,
    );
  });

  it('handles sideways bird cover/swap, empty deck+discard, amCubeMove humAction, and foodDiscount', () => {
    const BLACKBIRD = 77; // sideways forest bird
    const RED_KITE = 195; // cover bird
    const CASSOWARY = 342; // swap forest bird
    const GREAT_KISKADEE = 630; // moveWithCube
    const RED_CROWNED_CRANE = BIRDS.find(
      (b) => b.powerText === 'Play 1 additional bird in your [grassland]. You may ignore 1 [seed] or 1 [egg] in its cost.',
    )!.id;

    let s = autoSetup(
      newGame(12, ['core', 'european', 'oceania', 'asia', 'americas']),
    );
    const pid = actingPlayerId(s);

    // 1. Covering a sideways bird removes its ghost placeholder.
    s = edit(s, pid, {
      hand: [RED_KITE],
      board: {
        forest: [mkBird(BLACKBIRD), mkBird(BLACKBIRD, { ghost: true })],
        grassland: [],
        wetland: [],
      },
    });
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: RED_KITE,
      habitat: 'forest',
      eggPayments: [],
      foodPayments: [],
      coverBird: { habitat: 'forest', index: 0 },
    });
    expect(getPlayer(s, pid).board.forest.length).toBe(1);
    expect(getPlayer(s, pid).board.forest[0]!.cardId).toBe(RED_KITE);

    // 2. Cassowary swapping out a sideways bird removes its ghost placeholder too.
    s = edit(s, pid, {
      board: {
        forest: [mkBird(BLACKBIRD), mkBird(BLACKBIRD, { ghost: true }), mkBird(CASSOWARY)],
        grassland: [],
        wetland: [],
      },
    });
    s = runPower(s, pid, ref('forest', 2));
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'birds', birds: [ref('forest', 0)] },
    });
    expect(getPlayer(s, pid).board.forest.length).toBe(1);
    expect(getPlayer(s, pid).board.forest[0]!.cardId).toBe(CASSOWARY);

    // 3. Great Kiskadee (moveWithCube) as the last brown bird in forest moves the owed humAction to wetland.
    s = {
      ...s,
      turnTookAction: true,
      humAction: 'forest',
      activation: { habitat: 'forest', remaining: [0] },
    };
    s = edit(s, pid, {
      board: { forest: [mkBird(GREAT_KISKADEE)], grassland: [], wetland: [] },
      humBoard: { forest: null, grassland: null, wetland: null },
    });
    s = applyAction(s, { type: 'activatePower', playerId: pid });
    // Before resolving moveBirdHabitat, forest's humAction must NOT have been queued yet!
    expect(s.pending.map((st) => st.kind)).toEqual(['moveBirdHabitat']);
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'habitat', habitat: 'wetland' },
    });
    // Now wetland's humAction is queued!
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumSource', habitat: 'wetland' });
    s = autoResolve(s);

    // 4. chooseAdditionalPlay with foodDiscount allows playing a 1-seed grassland bird with 0 food!
    const oneSeedGrassland = BIRDS.find(
      (b) =>
        b.habitats.includes('grassland') &&
        b.cost.kind === 'and' &&
        b.cost.items.length === 1 &&
        b.cost.items[0]!.food === 'seed' &&
        b.cost.items[0]!.count === 1,
    )!;
    s = edit(s, pid, {
      hand: [oneSeedGrassland.id],
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
      board: { forest: [], grassland: [], wetland: [mkBird(RED_CROWNED_CRANE)] },
    });
    s = runPower(s, pid, ref('wetland', 0));
    expect(s.pending[0]?.kind).toBe('chooseAdditionalPlay');
    s = autoResolve(s);
    expect(getPlayer(s, pid).board.grassland.some((b) => b.cardId === oneSeedGrassland.id)).toBe(true);
  });
});

