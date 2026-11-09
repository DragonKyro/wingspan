// Oceania Expansion coverage: nectar (wild food, spent-nectar tracking,
// round-end discard, end-game majorities), the Oceania player mat, and a
// spread of the new pending-step power mechanics.

import { describe, expect, it } from 'vitest';
import { greedyChoice } from '@/wingspan/ai/choices';
import { chooseAction } from '@/wingspan/ai/chooseAction';
import { bird } from './cards';
import { createGame } from './createGame';
import { applyAction, settle } from './engine';
import {
  actingPlayerId,
  birdCount,
  getPlayer,
  payFoodPlan,
} from './helpers';
import { runPower, setPlayer } from './powers';
import { nectarPoints } from './scoring';
import type { BirdRef, FoodType, GameState, PlayerState } from './types';

const COLORS = ['red', 'blue'] as const;

// oceania card ids used below (see src/wingspan/data/birds.json).
const TUI = 350; // copy a brown power on a forest bird of the player to your left.
const RED_WINGED_PARROT = 333; // give 1 nectar; lay 2 eggs on this bird or gain 2 dice.
const COCKATIEL = 280; // discard 1 seed → take a tray card and tuck it behind this bird.
const SHELDUCK = 271; // take a cavity/star tray card; may reset the tray first.
const MISTLETOEBIRD = 314; // gain 1 fruit, or discard 1 fruit to gain 1 nectar.
const CASSOWARY = 342; // white: discard a forest bird, take its place, lay 4 eggs + 2 fruit.
const DRONGO = 343; // pink: when another player gains nectar, gain 1 nectar.
const RAVEN = 269; // yellow: cache up to 5 wild from your supply on this bird.
const KERERU = 300; // if the player to your left has nectar, gain 1 nectar.
const EASTERN_ROSELLA = 284; // all players gain 1 nectar; you also gain 1 seed.
const WOODCOCK = 13; // core, no power.
const GREY_WARBLER = 294; // oceania or-cost invertebrate/seed/fruit.

function newGame(seed = 42): GameState {
  return createGame({
    playerNames: ['A', 'B'],
    playerTypes: ['human', 'human'],
    playerColors: [...COLORS],
    seed,
    settings: { sets: ['core', 'oceania'] },
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

/** Drain pending steps with the greedy AI answers. */
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

function mkBird(cardId: number, extra: Partial<import('./types').PlayedBird> = {}) {
  return {
    cardId,
    eggs: 0,
    tucked: [] as number[],
    cached: [] as FoodType[],
    ...extra,
  };
}

const ref = (habitat: 'forest' | 'grassland' | 'wetland', index: number): BirdRef => ({
  habitat,
  index,
});

describe('oceania expansion', () => {
  it('starts each player with 1 nectar and uses nectar dice (no split face)', () => {
    const s = newGame();
    for (const p of s.players) {
      expect(p.food.nectar).toBe(1);
      expect(p.nectarSpent).toEqual({ forest: 0, grassland: 0, wetland: 0 });
    }
    expect(s.feederIn).not.toContain('split');
    expect(s.deck.some((id) => bird(id).set === 'oceania')).toBe(true);
  });

  it('forbids discarding nectar during setup keeps', () => {
    const s = newGame();
    const pid = s.setupRemaining[0]!;
    const p = getPlayer(s, pid);
    expect(() =>
      applyAction(s, {
        type: 'keepSetup',
        playerId: pid,
        keepBirds: p.hand.slice(0, 1),
        keepBonus: p.bonusHand[0]!,
        discardFood: ['nectar'],
      }),
    ).toThrow(/nectar/);
  });

  it('lets nectar pay a pick-one (or) food cost as a wild substitute', () => {
    const plan = payFoodPlan(
      { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 1 },
      bird(GREY_WARBLER).cost,
    );
    expect(plan).toEqual(['nectar']);
  });

  it('tracks nectar spent per habitat when playing a bird', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = edit(s, pid, {
      hand: [GREY_WARBLER],
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 1 },
    });
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: GREY_WARBLER,
      habitat: 'forest',
      eggPayments: [],
      foodPayments: ['nectar'],
    });
    const p = getPlayer(s, pid);
    expect(p.food.nectar).toBe(0);
    expect(p.nectarSpent.forest).toBe(1);
  });

  it('discards unused supply nectar at round end (cached/spent nectar survives)', () => {
    let s = autoSetup(newGame());
    const p1 = getPlayer(s, 'p1');
    s = setPlayer(s, {
      ...p1,
      food: { ...p1.food, nectar: 2 },
      board: {
        forest: [mkBird(WOODCOCK, { cached: ['nectar'] })],
        grassland: [],
        wetland: [],
      },
      nectarSpent: { forest: 1, grassland: 0, wetland: 0 },
    });
    s = {
      ...s,
      goalTiles: [2003, ...s.goalTiles.slice(1)],
      phase: 'main',
      currentPlayerIndex: 0,
      players: s.players.map((pl) => ({ ...pl, actionCubes: 0 })),
    };
    s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
    s = settle(s);
    const pl = getPlayer(s, 'p1');
    expect(pl.food.nectar).toBe(0);
    expect(pl.board.forest[0]!.cached).toEqual(['nectar']);
    expect(pl.nectarSpent.forest).toBe(1);
    expect(s.round).toBe(1);
  });

  it('scores nectar majorities per habitat (5/2, ties split summed rank points)', () => {
    const s = autoSetup(newGame());
    // p1: most in forest, tied most in grassland; p2: most in wetland.
    // Per Oceania p.3, a 2-way tie for 1st splits (5 + 2) / 2 = 3 pts each.
    const p1 = getPlayer(s, 'p1');
    const p2 = getPlayer(s, 'p2');
    let g = setPlayer(s, { ...p1, nectarSpent: { forest: 3, grassland: 2, wetland: 0 } });
    g = setPlayer(g, { ...p2, nectarSpent: { forest: 1, grassland: 2, wetland: 4 } });
    expect(nectarPoints(g, 'p1')).toBe(5 + 3); // forest 1st (5) + grassland tie-1st (3)
    expect(nectarPoints(g, 'p2')).toBe(2 + 3 + 5); // forest 2nd (2) + grassland tie-1st (3) + wetland 1st (5)
  });

  it('runs the Tūī copy power on a neighbour forest bird', () => {
    let s = autoSetup(newGame());
    // p2 sits left of whichever player is left of p2's left... give BOTH
    // players a Tūī target: the power reads the neighbour's forest row.
    const pid = 'p1';
    const left = s.playerOrder[(s.playerOrder.indexOf(pid) + 1) % s.playerOrder.length]!;
    s = edit(s, pid, {
      board: { forest: [mkBird(TUI)], grassland: [], wetland: [] },
    });
    s = edit(s, left as `p${number}`, {
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 2, rodent: 0, nectar: 0 },
      board: { forest: [mkBird(MISTLETOEBIRD)], grassland: [], wetland: [] },
    });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseCopyPower');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'repeatTarget', bird: ref('forest', 0) },
    });
    // The copied Mistletoebird asks p1 for fruit-vs-nectar.
    expect(s.pending[0]?.kind).toBe('chooseOption');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'option', option: 'gainFruit' },
    });
    s = autoResolve(s);
    expect(getPlayer(s, pid).food.fruit).toBeGreaterThan(0);
  });

  it('runs the Red-Winged Parrot give-nectar chain', () => {
    let s = autoSetup(newGame());
    const pid = 'p1';
    const other = 'p2';
    s = edit(s, pid, {
      food: { ...getPlayer(s, pid).food, nectar: 1 },
      board: { forest: [mkBird(RED_WINGED_PARROT)], grassland: [], wetland: [] },
    });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('choosePlayer');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'player', playerId: other },
    });
    // The nectar moved; the bird now offers eggs-or-dice.
    expect(getPlayer(s, pid).food.nectar).toBe(0);
    expect(getPlayer(s, other).food.nectar).toBeGreaterThan(0);
    expect(s.pending[0]?.kind).toBe('chooseOption');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'option', option: 'selfEggs2' },
    });
    expect(getPlayer(s, pid).board.forest[0]!.eggs).toBe(2);
  });

  it('tucks a tray card behind the Cockatiel after discarding a seed', () => {
    let s = autoSetup(newGame());
    const pid = 'p1';
    s = edit(s, pid, {
      food: { ...getPlayer(s, pid).food, seed: 1 },
      board: { forest: [mkBird(COCKATIEL)], grassland: [], wetland: [] },
    });
    const trayId = s.tray.find((id) => id != null)!;
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseFoodDiscard');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'supplyFood', foods: ['seed'] },
    });
    expect(s.pending[0]?.kind).toBe('chooseTrayCardEx');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'trayPick', cardId: trayId },
    });
    expect(getPlayer(s, pid).board.forest[0]!.tucked).toEqual([trayId]);
  });

  it('lets the Shelduck reset the tray before drawing a matching card', () => {
    let s = autoSetup(newGame());
    const pid = 'p1';
    s = edit(s, pid, {
      board: { forest: [mkBird(SHELDUCK)], grassland: [], wetland: [] },
    });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseTrayCardEx');
    // Choose 'reset': tray discards+refills and the pick re-queues (unless
    // the fresh tray has no cavity/star bird — then the power fizzles).
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'trayPick', mode: 'reset' },
    });
    s = autoResolve(s);
    expect(s.pending.length).toBe(0);
  });

  it('fires the Spangled Drongo pink power when another player gains nectar', () => {
    let s = autoSetup(newGame());
    // p2 owns the Drongo; p1 gains nectar via Eastern Rosella.
    s = edit(s, 'p1', {
      board: { forest: [mkBird(EASTERN_ROSELLA)], grassland: [], wetland: [] },
    });
    s = edit(s, 'p2', {
      board: { forest: [mkBird(DRONGO)], grassland: [], wetland: [] },
    });
    const before = getPlayer(s, 'p2').food.nectar;
    s = runPower(s, 'p1', ref('forest', 0));
    s = autoResolve(s);
    // +1 from "all players gain nectar" and +1 from the Drongo watch.
    expect(getPlayer(s, 'p2').food.nectar).toBe(before + 2);
  });

  it('runs the Kererū neighbour-nectar check', () => {
    let s = autoSetup(newGame());
    const pid = 'p1';
    const left = s.playerOrder[(s.playerOrder.indexOf(pid) + 1) % s.playerOrder.length]!;
    s = edit(s, pid, { board: { forest: [mkBird(KERERU)], grassland: [], wetland: [] } });
    // Left neighbour has no nectar → no gain.
    s = edit(s, left as `p${number}`, { food: { ...getPlayer(s, left).food, nectar: 0 } });
    const before = getPlayer(s, pid).food.nectar;
    s = runPower(s, pid, ref('forest', 0));
    expect(getPlayer(s, pid).food.nectar).toBe(before);
    // Now give the neighbour nectar → +1.
    s = edit(s, left as `p${number}`, { food: { ...getPlayer(s, left).food, nectar: 1 } });
    s = runPower(s, pid, ref('forest', 0));
    expect(getPlayer(s, pid).food.nectar).toBe(before + 1);
  });

  it('swaps the Southern Cassowary into a discarded bird’s slot', () => {
    let s = autoSetup(newGame());
    const pid = 'p1';
    s = edit(s, pid, {
      hand: [CASSOWARY],
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 2, rodent: 1, nectar: 0 },
      board: {
        forest: [mkBird(WOODCOCK), mkBird(CASSOWARY)],
        grassland: [],
        wetland: [],
      },
    });
    s = runPower(s, pid, ref('forest', 1));
    expect(s.pending[0]?.kind).toBe('chooseBirds');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'birds', birds: [ref('forest', 0)] },
    });
    const row = getPlayer(s, pid).board.forest;
    expect(row.length).toBe(1);
    expect(row[0]!.cardId).toBe(CASSOWARY);
    expect(row[0]!.eggs).toBe(4);
    expect(getPlayer(s, pid).food.fruit).toBeGreaterThanOrEqual(2);
  });

  it('runs the Australian Raven game-end cache step', () => {
    let s = autoSetup(newGame());
    const pid = 'p1';
    s = edit(s, pid, {
      food: { invertebrate: 1, seed: 1, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
      board: { forest: [mkBird(RAVEN)], grassland: [], wetland: [] },
    });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseCacheFromSupply');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'supplyFood', foods: ['invertebrate', 'seed'] },
    });
    const b = getPlayer(s, pid).board.forest[0]!;
    expect(b.cached).toEqual(['invertebrate', 'seed']);
    expect(getPlayer(s, pid).food.invertebrate).toBe(0);
  });

  it('lets the AI complete a full oceania game deterministically', () => {
    const run = (seed: number) => {
      let s = createGame({
        playerNames: ['A', 'B', 'C'],
        playerTypes: ['ai', 'ai', 'ai'],
        playerColors: ['red', 'blue', 'orange'],
        seed,
        settings: { sets: ['core', 'oceania'] },
      });
      let guard = 0;
      while (s.phase !== 'gameOver' && guard++ < 6000) {
        const head = s.pending[0];
        const pid = head?.playerId ?? (s.phase === 'setup' ? s.setupRemaining[0] : actingPlayerId(s));
        if (!pid) break;
        const a = chooseAction(s, pid);
        if (!a) break;
        s = applyAction(s, a);
      }
      return s;
    };
    const s1 = run(77);
    const s2 = run(77);
    expect(s1.phase).toBe('gameOver');
    expect(s1.goalScores.length).toBe(4);
    expect(s1.finalScores).not.toBeNull();
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    expect(s1.winner!.length).toBeGreaterThan(0);
    expect(s1.players.some((p) => birdCount(p) > 0)).toBe(true);
    for (const seed of [3, 19, 55, 128]) {
      const s = run(seed);
      expect(s.phase).toBe('gameOver');
      expect(s.goalScores.length).toBe(4);
    }
  });
});
