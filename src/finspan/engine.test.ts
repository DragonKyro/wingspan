// Engine tests: parser coverage over every distinct ability text, plus
// full-game AI runs (determinism + termination + score sanity).

import { describe, expect, it } from 'vitest';
import { parseAbility } from './abilities';
import { grantBenefit } from './actions';
import { ACHIEVEMENTS, FISH } from './cards';
import {
  DIVE_BONUSES,
  FORAGE_CATALINA_GOBY,
  FORAGE_GLASSHEAD_GRENADIER,
  FORAGE_SHOWY_BRISTLEMOUTH,
  INITIAL_OCEAN,
} from './constants';
import { applyAction } from './engine';
import {
  addYoung,
  allSlots,
  applyMove,
  buildInitialOcean,
  drawFromDeck,
  getPlayer,
  removeSchool,
  setPlayer,
  slotAt,
} from './helpers';
import { gameEndWavePoints, scoreAchievement, scorePlayer, waveCondMet } from './scoring';
import type { PlayerState } from './types';
import { aiGame, runAI } from './testUtils';

const newGame = (seed: number, players = 2, sets = ['base']) => aiGame(seed, players, { sets, achievementSide: 'A' });

/** Drive a game to completion with the heuristic AI. */
function runGame(seed: number, players = 2, sets = ['base'], maxActions = 5000) {
  const actions: unknown[] = [];
  const state = runAI(newGame(seed, players, sets), maxActions, (a) => actions.push(a));
  return { state, actions, actionCount: actions.length };
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

  it('parses arrow-down egg filters with on-each (including cards omitting "on each")', () => {
    const p = parseAbility('(all players) [FishEgg][ArrowDown][FishLengthSmall] on each [AllPlayers]')!;
    expect(p.allPlayers).toBe(true);
    expect(p.effects).toEqual([{ kind: 'egg', filter: { size: 'small' }, onEach: true }]);
    // Cards like European Anchovy / Kawakawa omit the literal "on each" after [FishEgg][ArrowDown].
    const p2 = parseAbility('[FishEgg][ArrowDown][Estuary]')!;
    expect(p2.effects).toEqual([{ kind: 'egg', filter: { estuary: true }, onEach: true }]);
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

  it('re-forms a school when the school token leaves a slot with 3+ young', () => {
    // Rulebook: "if you have 3 or more young in a slot with a school and then
    // move that school, 3 of those young immediately form another school" —
    // the same applies when the school is discarded as a cost.
    let p = playerWithOcean();
    p = addYoung(p, { row: 0, col: 0 }, 6); // school + 3 leftover young
    let s = slotAt(p.ocean, { row: 0, col: 0 });
    expect(s.school).toBe(true);
    expect(s.young).toBe(3);
    p = removeSchool(p, { row: 0, col: 0 });
    s = slotAt(p.ocean, { row: 0, col: 0 });
    expect(s.school).toBe(true); // leftover young instantly re-form
    expect(s.young).toBe(0);
  });
});

describe('setup', () => {
  it('deals 2 starters + 3 mains and places printed forage fish + tokens per ocean mat', () => {
    const s = newGame(42);
    const p = getPlayer(s, 'p1');
    expect(p.hand.length).toBe(5);
    const forage = [...allSlots(p.ocean)].filter(({ slot }) => slot.stack.length > 0);
    expect(forage.length).toBe(3);
    // Verified against fish_p03.png, fish_p07.png, fish_p10.png:
    expect(INITIAL_OCEAN).toEqual([
      [FORAGE_CATALINA_GOBY, 1, 2, 1, 0],
      [null, 2, 1, 0, 1],
      [FORAGE_SHOWY_BRISTLEMOUTH, 3, 1, 0, 0],
      [FORAGE_GLASSHEAD_GRENADIER, 4, 0, 1, 0],
    ]);
    expect(p.ocean.slots[1]![2]!.stack).toEqual([FORAGE_CATALINA_GOBY]);
    expect(p.ocean.slots[1]![2]!.eggs).toBe(1);
    expect(p.ocean.slots[2]![1]!.stack).toEqual([]);
    expect(p.ocean.slots[2]![1]!.young).toBe(1);
    expect(p.ocean.slots[3]![1]!.stack).toEqual([FORAGE_SHOWY_BRISTLEMOUTH]);
    expect(p.ocean.slots[3]![1]!.eggs).toBe(0);
    expect(p.ocean.slots[4]![0]!.stack).toEqual([FORAGE_GLASSHEAD_GRENADIER]);
    expect(p.ocean.slots[4]![0]!.eggs).toBe(1);
    expect(DIVE_BONUSES).toEqual([
      { zones: ['drawCard', 'drawCard', 'drawCard'], bottom: 'recoverCard' },
      { zones: ['egg', 'egg', 'egg'], bottom: 'egg' },
      { zones: ['hatch', 'hatch', 'move'], bottom: 'move' },
    ]);
    expect(s.deck.length).toBe(125 - 6); // 2 players x 3 mains
  });

  it('keeps every card drawn when the deck reshuffles mid-draw', () => {
    let s = newGame(42);
    const [a, b, c, d] = s.deck.slice(-4) as [number, number, number, number];
    // 1 card left in the deck; 3 in the discard piles (shuffled in on empty).
    s = { ...s, deck: [a] };
    s = setPlayer(s, { ...getPlayer(s, 'p1'), discard: [b] });
    s = setPlayer(s, { ...getPlayer(s, 'p2'), discard: [c, d] });
    const before = getPlayer(s, 'p1').hand;
    s = drawFromDeck(s, 'p1', 3);
    const drawn = getPlayer(s, 'p1').hand.slice(before.length);
    expect(drawn).toHaveLength(3);
    expect(drawn[0]).toBe(a);
    expect([...drawn.slice(1), ...s.deck].sort()).toEqual([b, c, d].sort());
    expect(s.players.every((p) => p.discard.length === 0)).toBe(true);
  });
});

describe('payment validation', () => {
  // Clown Anemonefish (id 30): sunlight fish, costs 2 cards, no other costs.
  it('rejects duplicate card ids in a playFish payment', () => {
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    p = { ...p, hand: [30, 5, 6] };
    s = setPlayer(s, p);
    expect(() =>
      applyAction(s, {
        type: 'playFish',
        playerId: 'p1',
        cardId: 30,
        row: 0,
        col: 0,
        discardCardIds: [5, 5],
      }),
    ).toThrow(/duplicate/i);
    // The same payment with two distinct cards is legal.
    const s2 = applyAction(s, {
      type: 'playFish',
      playerId: 'p1',
      cardId: 30,
      row: 0,
      col: 0,
      discardCardIds: [5, 6],
    });
    expect(getPlayer(s2, 'p1').hand).toEqual([]);
    expect(getPlayer(s2, 'p1').discard.sort()).toEqual([5, 6]);
  });

  it('rejects duplicate card ids in a pending hand discard', () => {
    let s = newGame(1);
    const hand = getPlayer(s, 'p1').hand;
    s = { ...s, pending: [{ kind: 'chooseHandDiscard', playerId: 'p1', count: 2 }] };
    expect(() =>
      applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'handCards', cardIds: [hand[0]!, hand[0]!] },
      }),
    ).toThrow(/duplicate/i);
    // Distinct cards still work.
    const s2 = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'handCards', cardIds: [hand[0]!, hand[1]!] },
    });
    expect(getPlayer(s2, 'p1').discard.length).toBe(2);
  });

  it('rejects duplicate card ids in a consume choice (no phantom fish)', () => {
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[0]![0] = { stack: [7], eggs: 0, young: 0, school: false }; // 450cm tuna
    p = { ...p, ocean: { ...p.ocean, slots }, hand: [1, 2] }; // 12cm + 90cm
    s = setPlayer(s, p);
    s = {
      ...s,
      pending: [
        { kind: 'chooseConsume', playerId: 'p1', count: 2, onto: { row: 0, col: 0 } },
      ],
    };
    expect(() =>
      applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'consume', onto: { row: 0, col: 0 }, cardIds: [1, 1] },
      }),
    ).toThrow(/duplicate/i);
    const s2 = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'consume', onto: { row: 0, col: 0 }, cardIds: [1, 2] },
    });
    // Both fish really left the hand and are consumed beneath the tuna
    // (consumed cards tuck below the visible top fish), and the step is done —
    // no leftover count demanding a third card.
    const p2 = getPlayer(s2, 'p1');
    expect(p2.hand).toEqual([]);
    expect(slotAt(p2.ocean, { row: 0, col: 0 }).stack).toEqual([1, 2, 7]);
    expect(s2.pending.length).toBe(0);
  });
});

describe('dive benefits', () => {
  it('grantBenefit produces a step or effect for every benefit kind', () => {
    const s = newGame(1);
    expect(grantBenefit(s, 'p1', 'young').pending[0]!.kind).toBe('chooseYoungSlots');
    expect(grantBenefit(s, 'p1', 'discardCard').pending[0]!.kind).toBe('chooseHandDiscard');
    expect(grantBenefit(s, 'p1', 'consumeHand').pending[0]!.kind).toBe('chooseConsume');
    expect(grantBenefit(s, 'p1', 'unSchool').pending[0]!.kind).toBe('chooseYoungSlots');
    expect(grantBenefit(s, 'p1', 'coralAny').pending[0]!.kind).toBe('chooseCoralSite');
    // Fixed-site coral applies immediately.
    expect(getPlayer(grantBenefit(s, 'p1', 'coralGreen'), 'p1').ocean.corals[2]).toBe(1);
  });

  it('unSchool benefit offers the school scatter when a school exists', () => {
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    p = addYoung(p, { row: 0, col: 0 }, 3); // -> school
    s = setPlayer(s, p);
    expect(grantBenefit(s, 'p1', 'unSchool').pending[0]!.kind).toBe('chooseUnSchool');
  });
});

describe('scoring', () => {
  it('converts achievement units into points (units x per)', () => {
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    p = addYoung(p, { row: 0, col: 0 }, 1);
    // Initial ocean holds 2 eggs + 1 young; +1 young = 4 units on the
    // week-1 side-A tile "Eggs and/or Young" (1 point each).
    expect(scoreAchievement(p, ACHIEVEMENTS.sideA[0]!)).toBe(4);
  });

  it('awards wave points when conditions are met across all 8 WaveCond kinds and verifies ScoreBreakdown total', () => {
    let s = newGame(1, 2, ['base', 'sr']);
    let p = getPlayer(s, 'p1');
    // Card 1: "3 [Wave] if no tokens on this fish"
    // Card 30: "6 [Wave] if [YoungFish][YoungFish] (exactly 2 on this fish)"
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[0]![0] = { stack: [1], eggs: 0, young: 0, school: false };
    slots[1]![0] = { stack: [30], eggs: 0, young: 2, school: false };
    p = { ...p, ocean: { ...p.ocean, slots } };
    s = setPlayer(s, p);
    expect(gameEndWavePoints(getPlayer(s, 'p1'))).toBe(9);

    // Exercise every GameEnd [Wave] fish in FISH against waveCondMet:
    const waveFish = FISH.filter((c) => c.abilityType === 'GameEnd' && c.ability?.includes('[Wave]'));
    expect(waveFish.length).toBeGreaterThanOrEqual(10);
    for (const c of waveFish) {
      const parsed = parseAbility(c.ability)!;
      expect(parsed.wave).toBeDefined();
      const cond = parsed.wave!.cond;
      let testP = getPlayer(s, 'p1');
      const testSlots = testP.ocean.slots.map((r) => r.map((x) => ({ ...x })));
      const ref = { row: cond.kind === 'bottomRow' ? 5 : 0, col: 0 };
      testSlots[ref.row]![ref.col] = {
        stack: cond.kind === 'consumedAtLeast' ? [1, 2, 3, c.id] : [c.id],
        eggs: cond.kind === 'eggYoungSchool' ? 1 : 0,
        young: cond.kind === 'exactlyYoung' ? cond.n : cond.kind === 'eggYoungSchool' ? 1 : 0,
        school: cond.kind === 'schoolOnFish' || cond.kind === 'eggYoungSchool',
      };
      const corals: [number, number, number] =
        cond.kind === 'coralEachSiteAtLeast' || cond.kind === 'coralThisSiteAtLeast'
          ? [5, 5, 5]
          : [0, 0, 0];
      testP = { ...testP, ocean: { slots: testSlots, corals } };
      expect(waveCondMet(testP, ref, cond), `${c.name}: ${c.ability}`).toBe(true);
    }

    const bd = scorePlayer(s, getPlayer(s, 'p1'));
    expect(bd.total).toBe(
      bd.achievementPoints +
        bd.gameEndAbilityPoints +
        bd.fishPoints +
        bd.consumedPoints +
        bd.eggYoungPoints +
        bd.schoolPoints +
        bd.coralPoints,
    );
  });

  it('counts 2 predator tags on über predators for the Predator Tag achievement', () => {
    const uber = FISH.find((c) => c.tags.predator === 2)!;
    const pred = FISH.find((c) => c.tags.predator === 1)!;
    const tile = ACHIEVEMENTS.sideBTiles.find((t) => t.kind === 'tagPredator')!;
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[0]![0] = { stack: [uber.id], eggs: 0, young: 0, school: false };
    slots[0]![1] = { stack: [pred.id], eggs: 0, young: 0, school: false };
    p = { ...p, ocean: { ...p.ocean, slots } };
    // 2 tags (über) + 1 tag (predator) = 3 predator tags x 2 pts = 6 pts.
    expect(scoreAchievement(p, tile)).toBe(6);
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
      // scorePlayer echoes the banked achievement points exactly.
      expect(state.finalScores![p.id]!.achievementPoints).toBe(p.achievementPoints);
    }
    const scores = Object.values(state.finalScores!);
    expect(scores[0]!.achievementPoints).toBeGreaterThan(0);
  });

  it('rejects duplicate card ids or under-recovery in chooseRecover, and falls back to deck when discard is empty', () => {
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    p = { ...p, discard: [10, 11] };
    s = setPlayer(s, p);
    s = { ...s, pending: [{ kind: 'chooseRecover', playerId: 'p1', count: 2 }] };
    expect(() =>
      applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'handCards', cardIds: [10, 10] },
      }),
    ).toThrow(/duplicate/i);
    expect(() =>
      applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'handCards', cardIds: [] },
      }),
    ).toThrow(/must recover/i);
    const s2 = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'handCards', cardIds: [10, 11] },
    });
    expect(getPlayer(s2, 'p1').discard).toEqual([]);
    expect(getPlayer(s2, 'p1').hand).toContain(10);
    expect(getPlayer(s2, 'p1').hand).toContain(11);

    const deckBefore = s2.deck.length;
    const handBefore = getPlayer(s2, 'p1').hand.length;
    const s3 = applyAction(
      { ...s2, pending: [{ kind: 'chooseRecover', playerId: 'p1', count: 1 }] },
      { type: 'resolveChoice', playerId: 'p1', choice: { kind: 'handCards', cardIds: [] } },
    );
    expect(s3.deck.length).toBe(deckBefore - 1);
    expect(getPlayer(s3, 'p1').hand.length).toBe(handBefore + 1);
  });

  it('activates a non-point GameEnd ability on a fish played during the gameEnd phase', () => {
    // Card 10 (Barramundi): GameEnd "[FishFromHand][ArrowDown][Estuary]"
    // Card 41 (European Anchovy, sunlight fish): GameEnd "[FishEgg][ArrowDown][Estuary]"
    let s = newGame(1);
    let p = getPlayer(s, 'p1');
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[1]![0] = { stack: [10], eggs: 0, young: 0, school: false };
    p = { ...p, ocean: { ...p.ocean, slots }, hand: [41, 1, 2, 3] };
    s = setPlayer(s, p);
    s = {
      ...s,
      phase: 'gameEnd',
      gameEndQueue: [],
      pending: [{ kind: 'choosePlayFromHand', playerId: 'p1', free: true, restrict: { estuary: true }, optional: true }],
    };
    const s2 = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'playFromHand', cardId: 41, row: 0, col: 0 },
    });
    expect(s2.phase).toBe('gameOver');
    expect(slotAt(getPlayer(s2, 'p1').ocean, { row: 0, col: 0 }).eggs).toBe(1);
  });
});
