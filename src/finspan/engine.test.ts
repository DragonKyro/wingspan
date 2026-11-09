// Engine tests: parser coverage over every distinct ability text, plus
// full-game AI runs (determinism + termination + score sanity).

import { describe, expect, it } from 'vitest';
import { parseAbility } from './abilities';
import { chooseAction } from './ai/chooseAction';
import { FISH } from './cards';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { addYoung, allSlots, applyMove, buildInitialOcean, getPlayer, setPlayer, slotAt } from './helpers';
import { gameEndWavePoints } from './scoring';
import type { PlayerState } from './types';

function newGame(seed: number, players = 2, sets = ['base']) {
  return createGame({
    playerNames: Array.from({ length: players }, (_, i) => `P${i + 1}`),
    playerTypes: Array.from({ length: players }, () => 'ai' as const),
    playerColors: Array.from({ length: players }, (_, i) => `c${i}`),
    seed,
    settings: { sets, achievementSide: 'A' },
  });
}

/** Drive a game to completion with the heuristic AI. */
function runGame(seed: number, players = 2, sets = ['base'], maxActions = 5000) {
  let s = newGame(seed, players, sets);
  const actions: unknown[] = [];
  let n = 0;
  while (s.phase !== 'gameOver' && n < maxActions) {
    const pid = s.pending.length ? s.pending[0]!.playerId : s.playerOrder[s.currentPlayerIndex]!;
    const a = chooseAction(s, pid);
    if (!a) throw new Error(`AI stuck at action ${n} (phase ${s.phase})`);
    s = applyAction(s, a as never);
    actions.push(a);
    n++;
  }
  return { state: s, actions, actionCount: n };
}

describe('ability parser', () => {
  it('parses every distinct ability text in the data', () => {
    const texts = new Set<string>();
    for (const c of FISH) if (c.ability) texts.add(c.ability);
    expect(texts.size).toBeGreaterThan(80);
    for (const t of texts) {
      const p = parseAbility(t)!;
      expect(p).not.toBeNull();
      // Every ability must produce something meaningful.
      expect(p.effects.length > 0 || p.wave || p.alsoIf).toBeTruthy();
    }
  });

  it('parses wave game-end points', () => {
    const p = parseAbility('3 [Wave] if no tokens on this fish')!;
    expect(p.wave).toEqual({ points: 3, cond: { kind: 'noTokens' } });
  });

  it('parses arrow-down egg filters with on-each', () => {
    const p = parseAbility('(all players) [FishEgg][ArrowDown][FishLengthSmall] on each [AllPlayers]')!;
    expect(p.allPlayers).toBe(true);
    expect(p.effects).toEqual([{ kind: 'egg', filter: { size: 'small' }, onEach: true }]);
  });

  it('parses two-part also-if abilities', () => {
    const p = parseAbility('[Discard] also, if [BlueCoral][BlueCoral][BlueCoral] in this dive site: [DrawCard]')!;
    expect(p.effects).toEqual([{ kind: 'discard' }]);
    expect(p.alsoIf).toEqual({ site: 'blue', count: 3, effects: [{ kind: 'draw' }] });
  });

  it('parses free-play restrictions', () => {
    const p = parseAbility('[FreePlayFishFromHand][Bioluminescent] only')!;
    expect(p.effects[0]).toEqual({
      kind: 'freePlayFromHand',
      filter: { tag: 'bioluminescent' },
      restrict: undefined,
    });
    const loc = parseAbility('[FreePlayFishFromHand][FishLengthMedium]only')!;
    expect(loc.effects[0]).toMatchObject({ kind: 'freePlayFromHand', filter: { size: 'medium' } });
  });

  it('collapses duplicated all-players coral icons to one per player', () => {
    const p = parseAbility('(all players) [PurpleCoral][PurpleCoral] [AllPlayers]')!;
    expect(p.allPlayers).toBe(true);
    expect(p.effects).toEqual([{ kind: 'coral', site: 'purple' }]);
  });

  it('parses coral-site play restrictions', () => {
    const p = parseAbility('[FishFromHand][ArrowDown][AnyCoral][AnyCoral][AnyCoral] (in a dive site with at least 3)')!;
    expect(p.effects).toEqual([{ kind: 'playFromHand', restrict: { coralAtLeast: 3 } }]);
  });
});

describe('token mechanics', () => {
  function playerWithOcean(): PlayerState {
    return {
      id: 'p1',
      name: 'P1',
      color: 'c0',
      isAI: true,
      hand: [],
      discard: [],
      ocean: buildInitialOcean(),
      diversUsed: 0,
      bottomTaken: [false, false, false],
      achievementPoints: 0,
    };
  }

  it('forms a school at 3 young on one slot', () => {
    let p = playerWithOcean();
    p = addYoung(p, { row: 0, col: 0 }, 3);
    const s = slotAt(p.ocean, { row: 0, col: 0 });
    expect(s.school).toBe(true);
    expect(s.young).toBe(0);
  });

  it('keeps extra young when 6 share a slot with no school', () => {
    let p = playerWithOcean();
    p = addYoung(p, { row: 0, col: 0 }, 6);
    const s = slotAt(p.ocean, { row: 0, col: 0 });
    expect(s.school).toBe(true);
    expect(s.young).toBe(3);
  });

  it('stops a moving young on a 2-young slot and forms a school', () => {
    let p = playerWithOcean();
    p = addYoung(p, { row: 0, col: 0 }, 1);
    p = addYoung(p, { row: 0, col: 2 }, 2);
    p = applyMove(p, { row: 0, col: 0 }, { row: 0, col: 2 }, 'young');
    const s = slotAt(p.ocean, { row: 0, col: 2 });
    expect(s.school).toBe(true);
    expect(s.young).toBe(0);
  });

  it('blocks a school from crossing another school', () => {
    let p = playerWithOcean();
    p = addYoung(p, { row: 0, col: 0 }, 3);
    p = addYoung(p, { row: 0, col: 1 }, 3);
    expect(() => applyMove(p, { row: 0, col: 0 }, { row: 0, col: 2 }, 'school')).toThrow();
  });
});

describe('setup', () => {
  it('deals 2 starters + 3 mains and places forage + tokens', () => {
    const s = newGame(42);
    const p = getPlayer(s, 'p1');
    expect(p.hand.length).toBe(5);
    const forage = [...allSlots(p.ocean)].filter(({ slot }) => slot.stack.length > 0);
    expect(forage.length).toBe(3);
    expect(p.ocean.slots[1]![1]!.young).toBe(1); // Catalina Goby slot
    expect(p.ocean.slots[3]![1]!.eggs).toBe(1); // Showy Bristlemouth slot
    expect(p.ocean.slots[4]![0]!.eggs).toBe(1); // Glasshead Grenadier slot
    expect(s.deck.length).toBe(125 - 6); // 2 players x 3 mains
  });
});

describe('scoring', () => {
  it('awards wave points when conditions are met', () => {
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    // Card 1: "3 [Wave] if no tokens on this fish"; card 30: "6 [Wave] if exactly 2 young".
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[0]![0] = { stack: [1], eggs: 0, young: 0, school: false };
    slots[1]![0] = { stack: [30], eggs: 0, young: 2, school: false };
    p = { ...p, ocean: { ...p.ocean, slots } };
    s = setPlayer(s, p);
    expect(gameEndWavePoints(getPlayer(s, 'p1'))).toBe(9);
  });
});

describe('full games', () => {
  it('runs a 2-player base game to completion deterministically', () => {
    const { state, actionCount } = runGame(7);
    expect(state.phase).toBe('gameOver');
    expect(actionCount).toBeGreaterThan(40);
    expect(state.winner).not.toBeNull();
    expect(state.finalScores).not.toBeNull();
    const total = Object.values(state.finalScores!).map((x) => x.total);
    expect(Math.max(...total)).toBeGreaterThan(15);
    expect(state.week).toBe(3);
  });

  it('is deterministic for the same seed', () => {
    const a = runGame(99);
    const b = runGame(99);
    expect(a.actionCount).toBe(b.actionCount);
    expect(a.state.finalScores).toEqual(b.state.finalScores);
    expect(a.state.winner).toEqual(b.state.winner);
  });

  it('different seeds diverge', () => {
    const a = runGame(1);
    const b = runGame(2);
    expect(JSON.stringify(a.state.finalScores) === JSON.stringify(b.state.finalScores)).toBe(false);
  });

  it('runs a 3-player S&R game to completion', () => {
    const { state } = runGame(11, 3, ['base', 'sr']);
    expect(state.phase).toBe('gameOver');
    expect(state.winner).not.toBeNull();
  }, 30000);

  it('scores achievements across weeks 1-3', () => {
    const { state } = runGame(7);
    for (const p of state.players) {
      expect(p.achievementPoints).toBeGreaterThanOrEqual(0);
    }
    const scores = Object.values(state.finalScores!);
    expect(scores[0]!.achievementPoints).toBeGreaterThan(0);
  });
});
