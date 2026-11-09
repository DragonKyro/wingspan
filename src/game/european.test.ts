// European Expansion coverage: sideways birds, alternative costs, cached food
// spending, teal (round-end) powers and their ordering vs goal scoring,
// european bonus cards, and a full AI game on the combined deck.

import { describe, expect, it } from 'vitest';
import { greedyChoice } from '@/ai/choices';
import { chooseAction } from '@/ai/chooseAction';
import { bird } from './cards';
import { createGame } from './createGame';
import { applyAction, settle } from './engine';
import {
  actingPlayerId,
  birdCount,
  getPlayer,
  playedBirds,
} from './helpers';
import { bonusPoints } from './scoring';
import { setPlayer } from './powers';
import type { GameState, PlayerState } from './types';

const COLORS = ['red', 'blue'] as const;

// european card ids used below (see src/game/data/birds.json).
const BLACKBIRD = 77; // Place sideways covering 2 [forest] spaces.
const SPARROWHAWK = 116; // pay 1 [card] per [rodent] in cost.
const RED_KITE = 195; // play on top of another bird.
const COAL_TIT = 76; // cache 1 [seed] on this card; may spend it.
const CHAFFINCH = 79; // cheap: invertebrate OR seed.
const BLACK_REDSTART = 29; // teal: lay 1 egg on each bird in a no-egg habitat.
const CETTIS_WARBLER = 69; // teal: counts double toward the goal.
const DUNNOCK = 101; // teal: eggs per other player's grassland cubes.
const WOODCOCK = 13; // core, no power.

const BONUS_CITIZEN = 1008; // birds with tucked cards.
const BONUS_DIET = 1009; // birds costing 3 food.
const BONUS_ETHOLOGIST = 1012; // per power color in one habitat.
const BONUS_BEHAVIORIST = 1002; // per column with 3 power colors.

function newGame(seed = 42, sets = ['core', 'european']): GameState {
  return createGame({
    playerNames: ['A', 'B'],
    playerTypes: ['human', 'human'],
    playerColors: [...COLORS],
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
      keepBirds: p.hand.slice(),
      keepBonus: p.bonusHand[0]!,
      discardFood: ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'],
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

function setHand(s: GameState, pid: `p${number}`, p: Partial<PlayerState>): GameState {
  return setPlayer(s, { ...getPlayer(s, pid), ...p });
}

function mkBird(cardId: number, extra: Partial<import('./types').PlayedBird> = {}) {
  return { cardId, eggs: 0, tucked: [] as number[], cached: [] as import('./types').FoodType[], ...extra };
}

describe('european expansion', () => {
  it('deals european birds and goals into the deck', () => {
    const s = newGame();
    expect(s.deck.some((id) => bird(id).set === 'european')).toBe(true);
    // Automa-only bonus cards never appear in the bonus deck.
    for (const id of [...s.bonusDeck, ...s.players.flatMap((p) => p.bonusHand)]) {
      expect(id).not.toBe(1032);
      expect(id).not.toBe(1033);
    }
  });

  it('plays a sideways bird covering 2 spaces for the lower egg cost', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = setHand(s, pid, {
      hand: [BLACKBIRD],
      food: { invertebrate: 1, seed: 0, fish: 0, fruit: 2, rodent: 0, nectar: 0 },
    });
    // Put a bird with an egg in grassland so the column-2 egg cost would be
    // payable but is skipped anyway (lower of the two covered columns = 0).
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: BLACKBIRD,
      habitat: 'forest',
      eggPayments: [],
      foodPayments: ['invertebrate', 'fruit', 'fruit'],
    });
    const row = getPlayer(s, pid).board.forest;
    expect(row.length).toBe(2);
    expect(row[0]!.cardId).toBe(BLACKBIRD);
    expect(row[0]!.ghost).toBeUndefined();
    expect(row[1]!.ghost).toBe(true);
    // The covered space is not a bird.
    expect(birdCount(getPlayer(s, pid))).toBe(1);
    expect(playedBirds(getPlayer(s, pid)).length).toBe(1);
  });

  it('lets a sideways bird be played normally when asked (coverTwo false)', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = setHand(s, pid, {
      hand: [BLACKBIRD],
      food: { invertebrate: 1, seed: 0, fish: 0, fruit: 2, rodent: 0, nectar: 0 },
    });
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: BLACKBIRD,
      habitat: 'forest',
      eggPayments: [],
      foodPayments: ['invertebrate', 'fruit', 'fruit'],
      coverTwo: false,
    });
    expect(getPlayer(s, pid).board.forest.length).toBe(1);
  });

  it('pays [rodent] cost items with hand cards that tuck behind the bird', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = setHand(s, pid, {
      hand: [SPARROWHAWK, WOODCOCK],
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
    });
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: SPARROWHAWK,
      habitat: 'forest',
      eggPayments: [],
      foodPayments: [],
      cardPayments: [WOODCOCK],
    });
    const played = getPlayer(s, pid).board.forest[0]!;
    expect(played.cardId).toBe(SPARROWHAWK);
    expect(played.tucked).toEqual([WOODCOCK]);
    expect(getPlayer(s, pid).hand).toEqual([]);
  });

  it('rejects card payments on birds without the power', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = setHand(s, pid, {
      hand: [CHAFFINCH, WOODCOCK],
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
    });
    expect(() =>
      applyAction(s, {
        type: 'playBird',
        playerId: pid,
        cardId: CHAFFINCH,
        habitat: 'forest',
        eggPayments: [],
        foodPayments: [],
        cardPayments: [WOODCOCK],
      }),
    ).toThrow();
  });

  it('plays a cover bird on top of another bird, tucking it', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    // Existing bird with eggs + cached food gets buried: both are discarded.
    const p = getPlayer(s, pid);
    s = setPlayer(s, {
      ...p,
      hand: [RED_KITE],
      board: {
        ...p.board,
        forest: [mkBird(WOODCOCK, { eggs: 2, tucked: [CHAFFINCH], cached: ['seed'] })],
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
    const top = getPlayer(s, pid).board.forest[0]!;
    expect(top.cardId).toBe(RED_KITE);
    expect(top.tucked).toEqual([CHAFFINCH, WOODCOCK]);
    expect(top.eggs).toBe(0);
    expect(top.cached).toEqual([]);
    expect(getPlayer(s, pid).board.forest.length).toBe(1);
  });

  it('spends cached food via cachedFoodPayments', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const p = getPlayer(s, pid);
    s = setPlayer(s, {
      ...p,
      hand: [CHAFFINCH],
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
      board: {
        ...p.board,
        forest: [mkBird(COAL_TIT, { eggs: 1, cached: ['seed'] })],
      },
    });
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: CHAFFINCH,
      habitat: 'forest',
      eggPayments: [{ habitat: 'forest', index: 0 }],
      foodPayments: [],
      cachedFoodPayments: [{ bird: { habitat: 'forest', index: 0 }, food: 'seed' }],
    });
    const pl = getPlayer(s, pid);
    expect(pl.board.forest.length).toBe(2);
    expect(pl.board.forest[0]!.cached).toEqual([]);
  });

  it('runs teal powers before goal scoring and lets them change the goal', () => {
    let s = autoSetup(newGame());
    // p1: Black Redstart (teal) + a forest bird; p2: one bird, no eggs.
    const p1 = getPlayer(s, 'p1');
    const p2 = getPlayer(s, 'p2');
    s = setPlayer(s, {
      ...p1,
      board: {
        forest: [],
        grassland: [mkBird(BLACK_REDSTART), mkBird(WOODCOCK)],
        wetland: [],
      },
    });
    s = setPlayer(s, { ...p2, board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    // Round 0 goal: birds with no eggs (european tile 2004).
    s = {
      ...s,
      goalTiles: [2004, ...s.goalTiles.slice(1)],
      phase: 'main',
      currentPlayerIndex: 0,
      players: s.players.map((pl) => ({ ...pl, actionCubes: 0 })),
    };
    s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
    // The teal power asked for a habitat with no eggs; grassland qualifies.
    expect(s.phase).toBe('roundEnd');
    expect(s.pending[0]?.kind).toBe('chooseHabitat');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'habitat', habitat: 'grassland' },
    });
    s = settle(s);
    // Teal power laid 1 egg on each grassland bird — before the goal scored.
    const pl = getPlayer(s, 'p1');
    expect(pl.board.grassland[0]!.eggs).toBe(1);
    expect(pl.board.grassland[1]!.eggs).toBe(1);
    // p1 now has 0 no-egg birds → 0 goal points; p2 still has 1 → ranks 1st (4).
    expect(s.phase).toBe('main');
    expect(s.round).toBe(1);
    const p1Idx = s.playerOrder.indexOf('p1');
    const p2Idx = s.playerOrder.indexOf('p2');
    expect(s.goalScores[0]![p1Idx]).toBe(0);
    expect(s.goalScores[0]![p2Idx]).toBe(4);
  });

  it('counts a count-double bird twice toward the round goal', () => {
    let s = autoSetup(newGame());
    const p1 = getPlayer(s, 'p1');
    const p2 = getPlayer(s, 'p2');
    s = setPlayer(s, {
      ...p1,
      board: { forest: [], grassland: [], wetland: [mkBird(CETTIS_WARBLER)] },
    });
    s = setPlayer(s, { ...p2, board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    s = {
      ...s,
      goalTiles: [2003, ...s.goalTiles.slice(1)], // birds in one row
      phase: 'main',
      currentPlayerIndex: 0,
      players: s.players.map((pl) => ({ ...pl, actionCubes: 0 })),
    };
    s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
    s = settle(s);
    // Both players have 1 bird in a row — but the warbler counts double:
    // p1 units 2 vs p2 units 1 → p1 ranks first (4), p2 second (1).
    const p1Idx = s.playerOrder.indexOf('p1');
    const p2Idx = s.playerOrder.indexOf('p2');
    expect(s.goalScores[0]![p1Idx]).toBe(4);
    expect(s.goalScores[0]![p2Idx]).toBe(1);
  });

  it('tracks roundCubes per action column for teal powers', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const other = s.playerOrder.find((x) => x !== pid)!;
    const p = getPlayer(s, pid);
    // Give the acting player grassland birds to lay eggs on.
    s = setPlayer(s, {
      ...p,
      board: { ...p.board, grassland: [mkBird(WOODCOCK), mkBird(CHAFFINCH)] },
    });
    s = applyAction(s, { type: 'layEggs', playerId: pid, placements: [] });
    s = autoResolve(s);
    expect(getPlayer(s, pid).roundCubes.grassland).toBe(1);
    expect(getPlayer(s, pid).roundCubes.forest).toBe(0);
    void other;
  });

  it('fires the Dunnock teal power per grassland cube on the chosen player', () => {
    let s = autoSetup(newGame());
    // p1 has Dunnock; p2 spent 2 cubes on grassland.
    const p1 = getPlayer(s, 'p1');
    const p2 = getPlayer(s, 'p2');
    s = setPlayer(s, {
      ...p1,
      board: { forest: [mkBird(DUNNOCK)], grassland: [], wetland: [] },
    });
    s = setPlayer(s, {
      ...p2,
      roundCubes: { forest: 0, grassland: 2, wetland: 0, playBird: 0 },
      board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] },
    });
    s = {
      ...s,
      goalTiles: [2003, ...s.goalTiles.slice(1)],
      phase: 'main',
      currentPlayerIndex: 0,
      players: s.players.map((pl) => ({ ...pl, actionCubes: 0 })),
    };
    s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
    // Dunnock: choose a player → lay 1 egg per grassland cube they used.
    expect(s.pending[0]?.kind).toBe('choosePlayer');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'player', playerId: 'p2' },
    });
    s = settle(s);
    expect(getPlayer(s, 'p1').board.forest[0]!.eggs).toBe(2);
  });

  it('scores european bonus cards', () => {
    let s = autoSetup(newGame());
    const p1 = getPlayer(s, 'p1');
    s = setPlayer(s, {
      ...p1,
      bonusHand: [BONUS_CITIZEN, BONUS_DIET, BONUS_ETHOLOGIST, BONUS_BEHAVIORIST],
      board: {
        // Column 0: brown (Coal Tit), no-power (Woodcock→white), teal
        // (Cetti's Warbler) — 3 different power colors for Behaviorist.
        forest: [mkBird(COAL_TIT, { tucked: [1, 2, 3] }), mkBird(WOODCOCK)],
        grassland: [mkBird(WOODCOCK, { tucked: [4] })],
        wetland: [mkBird(CETTIS_WARBLER)],
      },
    });
    const pl = getPlayer(s, 'p1');
    // Sanity on the synthetic board.
    expect(playedBirds(pl).length).toBe(4);
    const colors = [COAL_TIT, WOODCOCK, CETTIS_WARBLER].map((id) => bird(id).powerColor ?? 'white');
    expect(new Set(colors).size).toBe(3);
    // Citizen Scientist: 2 tucked-card birds — below the 4-bird tier → 0.
    // Diet Specialist: both Woodcocks cost 3 → 2 birds → tier "2 to 3" → 3.
    // Ethologist: forest column has {brown, white} → 2 colors × 2 pts → 4.
    // Behaviorist: column 0 has 3 power colors → 3 pts.
    expect(bonusPoints(pl)).toBe(10);
  });

  it('lets the AI complete a full combined-deck game deterministically', () => {
    const run = (seed: number) => {
      let s = createGame({
        playerNames: ['A', 'B', 'C'],
        playerTypes: ['ai', 'ai', 'ai'],
        playerColors: ['red', 'blue', 'orange'],
        seed,
        settings: { sets: ['core', 'european'] },
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
      return s;
    };
    const s1 = run(77);
    const s2 = run(77);
    expect(s1.phase).toBe('gameOver');
    expect(s1.goalScores.length).toBe(4);
    expect(s1.finalScores).not.toBeNull();
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    // Somebody played birds and someone won.
    expect(s1.winner!.length).toBeGreaterThan(0);
    expect(s1.players.some((p) => birdCount(p) > 0)).toBe(true);
    // A spread of seeds all terminate normally.
    for (const seed of [3, 19, 55, 128]) {
      const s = run(seed);
      expect(s.phase).toBe('gameOver');
      expect(s.goalScores.length).toBe(4);
    }
  });
});
