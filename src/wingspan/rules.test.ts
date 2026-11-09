// Targeted rule tests for engine mechanics that were previously covered
// only indirectly: end-of-turn discards, the all-same-face reroll, feeder
// auto-refill, pink once-per-turn timing, goal tie-splitting and
// zero-unit exclusion, and right-to-left power activation.

import { describe, expect, it } from 'vitest';
import { greedyChoice } from '@/wingspan/ai/choices';
import { finishRound, internals } from './actions';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { actingPlayerId, getPlayer } from './helpers';
import { firePinkTriggers, resetPinkFlags, runPower, setPlayer } from './powers';
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
    map[9] = 'p2'; // forest bonus space (food die)
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
