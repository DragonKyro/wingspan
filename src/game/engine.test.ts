import { describe, expect, it } from 'vitest';
import { createGame } from './createGame';
import { applyAction } from './engine';
import type { Action, Choice, GameState } from './types';
import { actingPlayerId, getPlayer } from './helpers';
import { bird } from './cards';
import { drawFromDeck, setPlayer } from './powers';
import { settle } from './engine';
import { GOAL_POINTS } from './constants';

const COLORS = ['red', 'blue'] as const;

function newGame(seed = 42): GameState {
  return createGame({
    playerNames: ['A', 'B'],
    playerTypes: ['human', 'human'],
    playerColors: [...COLORS],
    seed,
  });
}

/** Auto-pick a legal setup keep: keep all 5 birds, discard all 5 food. */
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

/** Auto-resolve the head pending step with a greedy legal answer. */
function autoResolve(s: GameState): GameState {
  let guard = 0;
  while (s.pending.length > 0 && guard++ < 100) {
    const step = s.pending[0]!;
    const pid = step.playerId;
    const p = getPlayer(s, pid);
    let choice: Choice;
    switch (step.kind) {
      case 'pickDie': {
        const chosen = s.feederIn
          .map((f, i) => ({ die: i, face: f }))
          .filter(({ face }) =>
            step.faces
              ? step.faces.some(
                  (w) => face === w || (face === 'split' && (w === 'invertebrate' || w === 'seed')),
                )
              : true,
          )
          .slice(0, step.count);
        choice = {
          kind: 'dice',
          picks: chosen.map(({ die, face }, k) => ({
            die: die - k,
            take: face === 'split' ? ('seed' as const) : undefined,
          })),
        };
        break;
      }
      case 'chooseSupplyFood':
        choice = {
          kind: 'supplyFood',
          foods: Array.from(
            { length: step.count },
            (_, i) => (step.options === 'any' ? 'seed' : step.options[i % step.options.length]!),
          ),
        };
        break;
      case 'chooseBirdForEgg': {
        const birds: { habitat: 'forest'; index: number }[] = [];
        const targets: { habitat: 'forest' | 'grassland' | 'wetland'; index: number }[] = [];
        for (const h of ['forest', 'grassland', 'wetland'] as const) {
          p.board[h].forEach((b, index) => {
            const c = bird(b.cardId);
            const okNest =
              step.nest === 'any' || step.nest === 'other' || c.nest === step.nest || c.nest === 'wild';
            if (okNest && b.eggs < c.eggLimit + (step.overLimit ?? 0)) {
              if (!step.exclude || step.exclude.habitat !== h || step.exclude.index !== index) {
                targets.push({ habitat: h, index });
              }
            }
          });
        }
        choice = { kind: 'birds', birds: targets.slice(0, step.count) };
        void birds;
        break;
      }
      case 'chooseBirdForEggDiscard': {
        const targets: { habitat: 'forest' | 'grassland' | 'wetland'; index: number }[] = [];
        for (const h of ['forest', 'grassland', 'wetland'] as const) {
          p.board[h].forEach((b, index) => {
            if (b.eggs > 0 && (!step.exclude || step.exclude.habitat !== h || step.exclude.index !== index)) {
              targets.push({ habitat: h, index });
            }
          });
        }
        choice = { kind: 'birds', birds: targets.slice(0, step.count) };
        break;
      }
      case 'chooseHandDiscard':
        choice = { kind: 'handCards', cardIds: p.hand.slice(0, step.count) };
        break;
      case 'chooseHandTuck':
        choice = { kind: 'handCards', cardIds: p.hand.slice(0, 1) };
        break;
      case 'chooseDrawnCard':
        choice = { kind: 'handCards', cardIds: step.cardIds.slice(0, 1) };
        break;
      case 'chooseBonusCards':
        choice = { kind: 'bonusCards', cardIds: step.cardIds.slice(0, step.keep) };
        break;
      case 'discardBonusCards':
        choice = { kind: 'bonusCards', cardIds: p.bonusHand.slice(0, step.count) };
        break;
      case 'moveBirdHabitat':
        choice = { kind: 'habitat', habitat: 'grassland' };
        break;
      case 'chooseFirstPlayer':
        choice = { kind: 'player', playerId: pid };
        break;
      case 'chooseRepeatPower': {
        const row = p.board[step.habitat];
        const idx = row.findIndex(
          (b, i) =>
            !(step.then?.bird && step.then.bird.index === i) &&
            bird(b.cardId).powerColor === 'brown',
        );
        choice = { kind: 'repeatTarget', bird: { habitat: step.habitat, index: Math.max(0, idx) } };
        break;
      }
      case 'chooseAdditionalPlay':
        choice = { kind: 'handCards', cardIds: [p.hand[0]!] };
        break;
      case 'chooseCacheFood':
        choice = { kind: 'supplyFood', foods: Array.from({ length: step.count }, () => 'seed' as const) };
        break;
      case 'chooseWildTrade': {
        const give = (['invertebrate', 'seed', 'fish', 'fruit', 'rodent', 'nectar'] as const).find(
          (f) => p.food[f] > 0,
        )!;
        choice = { kind: 'wildTrade', give, to: 'seed' };
        break;
      }
      case 'chooseCacheGained':
        choice = { kind: 'boolean', yes: true };
        break;
      default:
        throw new Error('unknown pending kind');
    }
    s = applyAction(s, { type: 'resolveChoice', playerId: pid, choice });
  }
  return s;
}

/** Finish any activation track by activating all remaining powers. */
function autoActivate(s: GameState): GameState {
  let guard = 0;
  while (guard++ < 50) {
    s = autoResolve(s);
    if (!s.activation || s.activation.remaining.length === 0) break;
    s = applyAction(s, { type: 'activatePower', playerId: actingPlayerId(s) });
  }
  return autoResolve(s);
}

/** Play a full turn for the acting player: take a simple action, resolve, end. */
function takeSimpleTurn(s: GameState): GameState {
  const pid = actingPlayerId(s);
  const p = getPlayer(s, pid);
  let action: Action;
  if (p.food.invertebrate + p.food.seed + p.food.fish + p.food.fruit + p.food.rodent >= 2) {
    action = {
      type: 'layEggs',
      playerId: pid,
      placements: [],
    };
  } else {
    action = {
      type: 'gainFood',
      playerId: pid,
      picks: s.feederIn
        .map((f, i) => ({ die: i, take: f === 'split' ? ('seed' as const) : undefined }))
        .slice(0, 1),
    };
  }
  s = applyAction(s, action);
  s = autoActivate(s);
  s = applyAction(s, { type: 'endTurn', playerId: pid });
  return autoResolve(s);
}

describe('engine smoke test', () => {
  it('creates a game and finishes setup', () => {
    let s = newGame();
    expect(s.phase).toBe('setup');
    s = autoSetup(s);
    expect(s.phase).toBe('main');
    for (const p of s.players) {
      expect(p.hand.length).toBe(5);
      expect(p.bonusHand.length).toBe(1);
      expect(p.actionCubes).toBe(8);
    }
  });

  it('is deterministic for the same seed', () => {
    expect(newGame(7)).toEqual(newGame(7));
  });

  it('plays turns without crashing for 40 turns', () => {
    let s = autoSetup(newGame());
    for (let i = 0; i < 40 && s.phase === 'main'; i++) {
      s = takeSimpleTurn(s);
      if (s.phase === 'main' && getPlayer(s, actingPlayerId(s)).actionCubes === 0) break;
    }
    // Everyone should have spent some cubes.
    expect(s.players.some((p) => p.actionCubes < 8)).toBe(true);
  });

  it('plays a complete game to gameOver', () => {
    let s = autoSetup(newGame(11));
    let turns = 0;
    while (s.phase !== 'gameOver' && turns++ < 200) {
      s = takeSimpleTurn(s);
    }
    expect(s.phase).toBe('gameOver');
    expect(s.finalScores).not.toBeNull();
    expect(s.winner).not.toBeNull();
    expect(s.goalScores.length).toBe(4);
    const totals = s.playerOrder.map((pid) => s.finalScores![pid]!.total);
    expect(totals.every((t) => t >= 0)).toBe(true);
  });

  it('setup discards 1 food per bird kept', () => {
    const s = newGame();
    const pid = s.setupRemaining[0]!;
    const p = getPlayer(s, pid);
    // Keeping all 5 birds costs all 5 food; 4 discards is illegal.
    expect(() =>
      applyAction(s, {
        type: 'keepSetup',
        playerId: pid,
        keepBirds: p.hand.slice(),
        keepBonus: p.bonusHand[0]!,
        discardFood: ['invertebrate', 'seed', 'fish', 'fruit'],
      }),
    ).toThrow();
    const s2 = applyAction(s, {
      type: 'keepSetup',
      playerId: pid,
      keepBirds: p.hand.slice(),
      keepBonus: p.bonusHand[0]!,
      discardFood: ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'],
    });
    expect(Object.values(getPlayer(s2, pid).food).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('uses the official green-side goal points table', () => {
    expect(GOAL_POINTS[0]).toEqual([4, 1]);
    expect(GOAL_POINTS[1]).toEqual([5, 2, 1]);
    expect(GOAL_POINTS[2]).toEqual([6, 3, 2]);
    expect(GOAL_POINTS[3]).toEqual([7, 4, 3]);
  });

  it('reshuffles the discard pile into the deck when it empties', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const cardId = getPlayer(s, pid).hand[0]!;
    s = { ...s, deck: [], discard: [cardId] };
    const s2 = drawFromDeck(s, pid, 1);
    expect(getPlayer(s2, pid).hand.at(-1)).toBe(cardId);
    expect(s2.discard.length).toBe(0);
    expect(s2.deck.length).toBe(0);
  });

  it('drains roundEndQueue and returns to main; gameEndQueue ends the game', () => {
    let s = autoSetup(newGame());
    // Synthesize an expansion teal bird on p1's board (power impls may not
    // exist yet — draining is what matters).
    const p1 = getPlayer(s, 'p1');
    s = setPlayer(s, {
      ...p1,
      board: {
        ...p1.board,
        forest: [{ cardId: 600, eggs: 0, tucked: [], cached: [] }],
      },
    });
    s = {
      ...s,
      phase: 'roundEnd',
      roundEndQueue: [{ playerId: 'p1', bird: { habitat: 'forest', index: 0 } }],
    };
    s = settle(s);
    expect(s.roundEndQueue.length).toBe(0);
    expect(s.phase).toBe('main');

    s = {
      ...s,
      phase: 'gameEnd',
      gameEndQueue: [{ playerId: 'p1', bird: { habitat: 'forest', index: 0 } }],
    };
    s = settle(s);
    expect(s.phase).toBe('gameOver');
    expect(s.finalScores).not.toBeNull();
  });

  it('gainFood takes a die and credits food', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const before = getPlayer(s, pid);
    const total = Object.values(before.food).reduce((a, b) => a + b, 0);
    s = applyAction(s, {
      type: 'gainFood',
      playerId: pid,
      picks: [{ die: 0, take: s.feederIn[0] === 'split' ? 'seed' : undefined }],
    });
    const after = getPlayer(s, pid);
    expect(Object.values(after.food).reduce((a, b) => a + b, 0)).toBe(total + 1);
    expect(after.actionCubes).toBe(7);
  });
});
