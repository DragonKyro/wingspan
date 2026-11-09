// Regressions found by AI self-play fuzzing (thousands of seeded games across
// every set combination and mode). Each test pins the specific rule hole the
// fuzzer hit; src/selfplay.test.ts keeps the broad net.

import { describe, expect, it } from 'vitest';
import { greedyChoice } from '@/wingspan/ai/choices';
import { createGame } from './createGame';
import { applyAction, settle } from './engine';
import { actingPlayerId, getPlayer, playEggCost } from './helpers';
import { pushPending, queueHumAction, runPower, setPlayer } from './powers';
import type { BirdRef, FoodType, GameState, PlayedBird, PlayerState } from './types';

const GRAY_CATBIRD = 131; // brown: repeat a brown power on another bird in this habitat
const NORTHERN_MOCKINGBIRD = 180; // same text
const WOODCOCK = 13; // core, no power
const RUBY_TOPAZ = 2030; // hummingbird

function newGame(sets: string[] = ['core', 'americas']): GameState {
  let s = createGame({
    playerNames: ['A', 'B'],
    playerTypes: ['human', 'human'],
    playerColors: ['red', 'blue'],
    seed: 42,
    settings: { sets, goalSide: 'green' },
  });
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

function edit(s: GameState, pid: `p${number}`, patch: Partial<PlayerState>): GameState {
  return setPlayer(s, { ...getPlayer(s, pid), ...patch });
}

function mkBird(cardId: number, extra: Partial<PlayedBird> = {}): PlayedBird {
  return { cardId, eggs: 0, tucked: [], cached: [] as FoodType[], ...extra };
}

const ref = (habitat: 'forest' | 'grassland' | 'wetland', index: number): BirdRef => ({ habitat, index });

/** Answer pending steps with the greedy AI until none are left (bounded). */
function autoResolve(s: GameState, limit = 100): GameState {
  let n = 0;
  while (s.pending.length > 0 && n++ < limit) {
    const step = s.pending[0]!;
    const choice = greedyChoice(s, step);
    if (!choice) throw new Error(`no greedy answer for ${step.kind}`);
    s = applyAction(s, { type: 'resolveChoice', playerId: step.playerId, choice });
  }
  return s;
}

describe('self-play regressions', () => {
  it('playEggCost includes the Rufous Hornero placeholder discount', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    s = edit(s, pid, { board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    const p = getPlayer(s, pid);
    expect(playEggCost(p, 'forest')).toBe(1); // column 2 normally costs 1 egg
    expect(playEggCost({ ...p, horneroEggs: ['forest'] }, 'forest')).toBe(0);
    expect(playEggCost({ ...p, horneroEggs: ['forest'] }, 'wetland')).toBe(0); // column 1 is free anyway
    expect(playEggCost({ ...p, horneroEggs: ['wetland'] }, 'forest')).toBe(1); // other rows unaffected
  });

  it('two "repeat a brown power" birds in one row cannot trigger each other forever', () => {
    let s = newGame(['core']);
    const pid = actingPlayerId(s);
    s = edit(s, pid, {
      board: { forest: [mkBird(GRAY_CATBIRD), mkBird(NORTHERN_MOCKINGBIRD)], grassland: [], wetland: [] },
    });
    s = runPower(s, pid, ref('forest', 0));
    s = autoResolve(s, 20);
    // Catbird -> Mockingbird -> (Catbird is already in the chain) ends there.
    expect(s.pending).toEqual([]);
  });

  it('a row-owed hummingbird action re-decides attract vs return when it comes up', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    s = edit(s, pid, { humBoard: { forest: null, grassland: null, wetland: null } });
    // An "any habitat" power and the row's owed action both target the empty
    // grassland space; the first one fills it.
    s = queueHumAction(s, pid, 'grassland');
    s = queueHumAction(s, pid, 'grassland', undefined, true);
    expect(s.pending.map((st) => st.kind)).toEqual(['chooseHumSource', 'chooseHumSource']);
    s = applyAction(s, { type: 'resolveChoice', playerId: pid, choice: { kind: 'humPick', source: 0 } });
    expect(getPlayer(s, pid).humBoard.grassland).not.toBeNull();
    // The owed action is now a return, not a (now impossible) attract.
    const head = s.pending.find((st) => st.kind === 'chooseHumCover' || st.kind === 'chooseHumSource');
    expect(head?.kind).toBe('chooseHumCover');
    s = autoResolve(s);
    expect(s.pending).toEqual([]);
  });

  it('drops a stale non-lazy attract once the hummingbird space is occupied', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    s = edit(s, pid, { humBoard: { forest: null, grassland: RUBY_TOPAZ, wetland: null } });
    s = pushPending(s, { kind: 'chooseHumSource', playerId: pid, habitat: 'grassland' });
    s = settle(s);
    expect(s.pending).toEqual([]); // no unanswerable step left to soft-lock the game
  });

  it('rejects discarding more eggs from a bird than it holds', () => {
    let s = newGame(['core']);
    const pid = actingPlayerId(s);
    s = edit(s, pid, {
      board: {
        forest: [mkBird(WOODCOCK, { eggs: 1 }), mkBird(WOODCOCK, { eggs: 1 })],
        grassland: [],
        wetland: [],
      },
    });
    s = pushPending(s, { kind: 'chooseBirdForEggDiscard', playerId: pid, count: 2 });
    const twice = { kind: 'birds' as const, birds: [ref('forest', 0), ref('forest', 0)] };
    expect(() => applyAction(s, { type: 'resolveChoice', playerId: pid, choice: twice })).toThrow(/no eggs/);
    // Spreading across the two birds is fine.
    const spread = { kind: 'birds' as const, birds: [ref('forest', 0), ref('forest', 1)] };
    const next = applyAction(s, { type: 'resolveChoice', playerId: pid, choice: spread });
    expect(getPlayer(next, pid).board.forest.map((b) => b.eggs)).toEqual([0, 0]);
  });

  it('shows the player the clamped count a pending step will actually accept', () => {
    let s = newGame(['core']);
    const pid = actingPlayerId(s);
    s = edit(s, pid, {
      board: { forest: [mkBird(WOODCOCK, { eggs: 1 })], grassland: [], wetland: [] },
    });
    s = pushPending(s, { kind: 'chooseBirdForEggDiscard', playerId: pid, count: 3 });
    s = settle(s);
    const head = s.pending[0];
    expect(head?.kind === 'chooseBirdForEggDiscard' && head.count).toBe(1);
  });

  it('the greedy answer for an egg discard can use several eggs on one bird', () => {
    let s = newGame(['core']);
    const pid = actingPlayerId(s);
    s = edit(s, pid, {
      board: { forest: [mkBird(WOODCOCK, { eggs: 2 })], grassland: [], wetland: [] },
    });
    s = pushPending(s, { kind: 'chooseBirdForEggDiscard', playerId: pid, count: 2 });
    s = settle(s);
    s = autoResolve(s);
    expect(s.pending).toEqual([]);
    expect(getPlayer(s, pid).board.forest[0]!.eggs).toBe(0);
  });
});
