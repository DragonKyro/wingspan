import { describe, expect, it } from 'vitest';
import { parseAbility } from './abilities';
import {
  NAUTOMA_DECISION_CARDS,
  RAVEL_SCORING_CARDS,
  nautomaAchievementBase,
  scoreRavelWeek,
} from './automa';
import { ACHIEVEMENTS, FISH } from './cards';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { getPlayer, setPlayer } from './helpers';
import { fireAbility } from './powers';
import { finalScores, scorePlayer } from './scoring';
import { DIVERS_PER_WEEK } from './types';
import type { GameSettings, GameState } from './types';
import { runAI } from './testUtils';

function soloGame(
  seed = 1,
  automaOpts: NonNullable<GameSettings['automa']> = { difficulty: 2 },
  sets: string[] = ['base'],
  achievementSide: 'A' | 'B' = 'A',
): GameState {
  return createGame({
    playerNames: ['Solo'],
    playerTypes: ['ai'],
    playerColors: ['blue'],
    seed,
    settings: {
      sets,
      achievementSide,
      automa: automaOpts,
    },
  });
}

function runSoloGame(
  seed: number,
  automaOpts: NonNullable<GameSettings['automa']>,
  sets: string[] = ['base'],
  achievementSide: 'A' | 'B' = 'A',
  maxActions = 5000,
): GameState {
  return runAI(soloGame(seed, automaOpts, sets, achievementSide), maxActions);
}

describe('Nautoma setup & components', () => {
  it('auto-adds Nautoma as p2, sets human first, and initializes starting tokens + 6-card deck + 1 set aside', () => {
    const s = soloGame(42, { difficulty: 2 });
    expect(s.playerOrder).toEqual(['p1', 'p2']);
    expect(getPlayer(s, 'p1').name).toBe('Solo');
    expect(getPlayer(s, 'p2').name).toBe('Nautoma');
    expect(getPlayer(s, 'p2').isAI).toBe(true);
    expect(s.firstPlayerIndex).toBe(0);
    expect(s.currentPlayerIndex).toBe(0);
    expect(getPlayer(s, 'p1').hand.length).toBe(5);
    expect(getPlayer(s, 'p2').hand.length).toBe(0);

    expect(s.nautoma).toBeDefined();
    const n = s.nautoma!;
    expect(n.difficulty).toBe(2);
    expect(n.eggs).toBe(2);
    expect(n.young).toBe(1);
    expect(n.schools).toBe(0);
    expect(n.corals).toBe(0);
    expect(n.fish).toEqual([]);
    expect(n.achievementDivers).toBe(0);
    expect(n.ravelPoints).toBe(0);
    expect(n.ravelMode).toBe(false);
    expect(n.ravelCardId).toBeNull();
    expect(n.deck.length).toBe(6);
    expect(NAUTOMA_DECISION_CARDS.length).toBe(7);
    const all7 = [...n.deck, n.setAside].sort((a, b) => a - b);
    expect(all7).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('draws a Ravel Mode scoring card (R1..R6) when ravelMode is enabled', () => {
    const s = soloGame(7, { difficulty: 3, ravelMode: true, ravelStrength: 4 });
    expect(s.nautoma!.ravelMode).toBe(true);
    expect(s.nautoma!.ravelStrength).toBe(4);
    expect(RAVEL_SCORING_CARDS.map((c) => c.id)).toContain(s.nautoma!.ravelCardId);
  });
});

describe('Nautoma turn: Dive 3-step conversion order', () => {
  it('executes 1. 3 young -> 1 school (1x), 2. <=4 eggs -> young, 3. gain 2 eggs in strict order', () => {
    // Card 5: achievementDelta +1, dive: true (2 eggs), playFish: false.
    let s = soloGame(1, { difficulty: 2 });
    // Put p2 on turn with Card 5 and Card 4 on top of Nautoma's deck.
    s = {
      ...s,
      currentPlayerIndex: 1,
      nautoma: { ...s.nautoma!, deck: [1, 2, 3, 6, 4, 5] },
    };

    // First Dive from starting resources (2 eggs, 1 young, 0 schools):
    // Step 1: 1 young < 3 -> no school formed.
    // Step 2: 2 eggs flip -> +2 young (now 3 young, 0 eggs).
    // Step 3: gain 2 eggs (now 2 eggs, 3 young, 0 schools).
    s = applyAction(s, { type: 'nautomaTurn', playerId: 'p2' });
    expect(s.nautoma!.lastCardId).toBe(5);
    expect(s.nautoma!.achievementDivers).toBe(1);
    expect(s.nautoma!.schools).toBe(0);
    expect(s.nautoma!.young).toBe(3);
    expect(s.nautoma!.eggs).toBe(2);

    // Second Dive (Card 4: +1 diver, dive):
    // Step 1: 3 young -> 1 school (now 0 young, 1 school).
    // Step 2: 2 eggs flip -> 2 young (now 2 young, 0 eggs).
    // Step 3: gain 2 eggs (now 2 eggs, 2 young, 1 school).
    s = { ...s, turnTookAction: false, currentPlayerIndex: 1 };
    s = applyAction(s, { type: 'nautomaTurn', playerId: 'p2' });
    expect(s.nautoma!.lastCardId).toBe(4);
    expect(s.nautoma!.achievementDivers).toBe(2);
    expect(s.nautoma!.schools).toBe(1);
    expect(s.nautoma!.young).toBe(2);
    expect(s.nautoma!.eggs).toBe(2);
  });

  it('caps school conversion at 1x per Dive and egg-to-young conversion at 4x per Dive', () => {
    let s = soloGame(1, { difficulty: 2 });
    s = {
      ...s,
      currentPlayerIndex: 1,
      nautoma: {
        ...s.nautoma!,
        deck: [3], // Card 3: 0 diver, dive
        young: 7,
        eggs: 6,
        schools: 0,
      },
    };
    s = applyAction(s, { type: 'nautomaTurn', playerId: 'p2' });
    // Step 1: 7 young -> 4 young + 1 school (only 1x conversion!).
    // Step 2: 6 eggs -> flip max 4 -> 2 eggs left, +4 young (now 8 young).
    // Step 3: +2 eggs (now 4 eggs).
    expect(s.nautoma!.schools).toBe(1);
    expect(s.nautoma!.young).toBe(8);
    expect(s.nautoma!.eggs).toBe(4);
  });
});

describe('Nautoma turn: Play a Fish Card & (all players) interactions', () => {
  it('grants p1 the benefit of a drawn (all players) fish card even when abilityType is IfActivated', () => {
    // Find an IfActivated (all players) draw card (e.g. "[DrawCard] [AllPlayers]" or similar).
    const ifActAll = FISH.find(
      (c) =>
        c.abilityType === 'IfActivated' &&
        parseAbility(c.ability)?.allPlayers &&
        parseAbility(c.ability)?.effects.some((e) => e.kind === 'draw'),
    )!;
    expect(ifActAll).toBeDefined();

    let s = soloGame(1, { difficulty: 2 });
    const handBefore = getPlayer(s, 'p1').hand.length;
    const eggsBefore = s.nautoma!.eggs;

    // Put Card 2 (playFish: true, achievementDelta: 0) on top of Nautoma's deck
    // and ifActAll on top of the global fish deck.
    s = {
      ...s,
      currentPlayerIndex: 1,
      deck: [...s.deck, ifActAll.id],
      nautoma: { ...s.nautoma!, deck: [2] },
    };

    s = applyAction(s, { type: 'nautomaTurn', playerId: 'p2' });
    expect(s.nautoma!.fish).toEqual([ifActAll.id]);
    // p1 drew a card from the IfActivated (all players) ability!
    expect(getPlayer(s, 'p1').hand.length).toBe(handBefore + 1);
    // Nautoma did NOT gain an extra egg from her own card.
    expect(s.nautoma!.eggs).toBe(eggsBefore);
  });

  it('gives Nautoma 1 egg instead of the ability when p1 triggers WhenPlayed or IfActivated (all players)', () => {
    let s = soloGame(1, { difficulty: 2 });
    const eggsBefore = s.nautoma!.eggs;
    const p1HandBefore = getPlayer(s, 'p1').hand.length;

    // p1 triggers an (all players) draw ability.
    s = fireAbility(s, 'p1', '(all players) [DrawCard] [AllPlayers]', undefined, 'test all players');
    expect(getPlayer(s, 'p1').hand.length).toBe(p1HandBefore + 1);
    expect(getPlayer(s, 'p2').hand.length).toBe(0);
    expect(s.nautoma!.eggs).toBe(eggsBefore + 1);
  });

  it('S&R Add Coral converts 1 egg into 1 coral (diff 1-3) or 2 coral (diff 4-5) on cards 1, 2, 6', () => {
    let sCalm = soloGame(1, { difficulty: 3 }, ['base', 'sr']);
    sCalm = {
      ...sCalm,
      currentPlayerIndex: 1,
      nautoma: { ...sCalm.nautoma!, deck: [1], eggs: 2, corals: 0 },
    };
    sCalm = applyAction(sCalm, { type: 'nautomaTurn', playerId: 'p2' });
    expect(sCalm.nautoma!.eggs).toBe(1);
    expect(sCalm.nautoma!.corals).toBe(1);

    let sStormy = soloGame(1, { difficulty: 4 }, ['base', 'sr']);
    sStormy = {
      ...sStormy,
      currentPlayerIndex: 1,
      nautoma: { ...sStormy.nautoma!, deck: [1], eggs: 2, corals: 0 },
    };
    sStormy = applyAction(sStormy, { type: 'nautomaTurn', playerId: 'p2' });
    expect(sStormy.nautoma!.eggs).toBe(1);
    expect(sStormy.nautoma!.corals).toBe(2);
  });
});

describe('Achievement markers, Calm vs Stormy base values, and weekly transitions', () => {
  it('ignores achievement marker adjustments at difficulty 1 and in week 4, and floors at 0', () => {
    // Card 6 has achievementDelta: -1; Card 1 has achievementDelta: +1.
    let s1 = soloGame(1, { difficulty: 1 });
    s1 = { ...s1, currentPlayerIndex: 1, nautoma: { ...s1.nautoma!, deck: [1] } };
    s1 = applyAction(s1, { type: 'nautomaTurn', playerId: 'p2' });
    expect(s1.nautoma!.achievementDivers).toBe(0);

    // Week 4 (state.week === 3) ignores +1.
    let sW4 = soloGame(1, { difficulty: 3 });
    sW4 = { ...sW4, week: 3, currentPlayerIndex: 1, nautoma: { ...sW4.nautoma!, deck: [1] } };
    sW4 = applyAction(sW4, { type: 'nautomaTurn', playerId: 'p2' });
    expect(sW4.nautoma!.achievementDivers).toBe(0);

    // -1 when at 0 stays at 0.
    let sFloor = soloGame(1, { difficulty: 2 });
    sFloor = { ...sFloor, currentPlayerIndex: 1, nautoma: { ...sFloor.nautoma!, deck: [6], achievementDivers: 0 } };
    sFloor = applyAction(sFloor, { type: 'nautomaTurn', playerId: 'p2' });
    expect(sFloor.nautoma!.achievementDivers).toBe(0);
  });

  it('transcribes Calm vs Stormy base values across Weeks 1-3 and S&R tiles', () => {
    // Week 1 Side A: Eggs and/or Young -> Calm 3, Stormy 6
    expect(nautomaAchievementBase(1, 'eggsAndYoung', 'calm')).toBe(3);
    expect(nautomaAchievementBase(1, 'eggsAndYoung', 'stormy')).toBe(6);
    expect(nautomaAchievementBase(1, 'young', 'calm')).toBe(0);
    expect(nautomaAchievementBase(1, 'young', 'stormy')).toBe(4);
    expect(nautomaAchievementBase(1, 'fishSunlight', 'calm')).toBe(2);
    expect(nautomaAchievementBase(1, 'fishSunlight', 'stormy')).toBe(5);

    // Week 2 Side A: Rows of Fish -> Calm 0, Stormy 2
    expect(nautomaAchievementBase(2, 'fullRows', 'calm')).toBe(0);
    expect(nautomaAchievementBase(2, 'fullRows', 'stormy')).toBe(2);
    expect(nautomaAchievementBase(2, 'young', 'calm')).toBe(1);
    expect(nautomaAchievementBase(2, 'young', 'stormy')).toBe(5);
    expect(nautomaAchievementBase(2, 'uniqueTags', 'calm')).toBe(2);
    expect(nautomaAchievementBase(2, 'uniqueTags', 'stormy')).toBe(5);
    expect(nautomaAchievementBase(2, 'coral', 'calm')).toBe(1);
    expect(nautomaAchievementBase(2, 'coral', 'stormy')).toBe(4);

    // Week 3 Side A: Schools -> Calm 0, Stormy 2
    expect(nautomaAchievementBase(3, 'schools', 'calm')).toBe(0);
    expect(nautomaAchievementBase(3, 'schools', 'stormy')).toBe(2);
    expect(nautomaAchievementBase(3, 'young', 'calm')).toBe(3);
    expect(nautomaAchievementBase(3, 'young', 'stormy')).toBe(6);
    expect(nautomaAchievementBase(3, 'fishWithTokens', 'calm')).toBe(3);
    expect(nautomaAchievementBase(3, 'fishWithTokens', 'stormy')).toBe(7);
    expect(nautomaAchievementBase(3, 'fishPoints1to3', 'calm')).toBe(3);
    expect(nautomaAchievementBase(3, 'fishPoints1to3', 'stormy')).toBe(6);
  });

  it('scores weekly achievements per difficulty (0 at diff 1; +3 leader bonus ONLY at diff 5) and keeps human first', () => {
    function finishWeek1(difficulty: 1 | 2 | 3 | 4 | 5, divers: number, side: 'A' | 'B' = 'B'): GameState {
      let s = soloGame(1, { difficulty }, ['base'], side);
      // Force Week 1 achievement to Side A's Eggs and/or Young (per: 1, Calm: 3, Stormy: 6).
      s = { ...s, achievements: [...ACHIEVEMENTS.sideA] };
      const p1 = getPlayer(s, 'p1');
      const p2 = getPlayer(s, 'p2');
      s = setPlayer(s, { ...p1, diversUsed: DIVERS_PER_WEEK });
      s = setPlayer(s, { ...p2, diversUsed: DIVERS_PER_WEEK });
      s = {
        ...s,
        currentPlayerIndex: 1,
        turnTookAction: true,
        nautoma: { ...s.nautoma!, achievementDivers: divers },
      };
      return applyAction(s, { type: 'endTurn', playerId: 'p2' });
    }

    // Difficulty 1: Nautoma scores 0 for achievements.
    const d1 = finishWeek1(1, 3);
    expect(getPlayer(d1, 'p2').achievementPoints).toBe(0);
    // Even on Side B, no +3 leader bonus at difficulty 1!
    expect(getPlayer(d1, 'p1').achievementPoints).toBe(3); // p1 starts with 2 eggs + 1 young = 3
    expect(d1.firstPlayerIndex).toBe(0);
    expect(d1.currentPlayerIndex).toBe(0);
    expect(d1.nautoma!.achievementDivers).toBe(0);
    expect(d1.nautoma!.deck.length).toBe(6);

    // Difficulty 2 (Calm): base 3 + 2 divers = 5 pts (no +3 bonus even on Side B).
    const d2 = finishWeek1(2, 2, 'B');
    expect(getPlayer(d2, 'p2').achievementPoints).toBe(5);

    // Difficulty 4 (Stormy): base 6 + 2 divers = 8 pts (no +3 bonus).
    const d4 = finishWeek1(4, 2, 'B');
    expect(getPlayer(d4, 'p2').achievementPoints).toBe(8);

    // Difficulty 5 (Stormy + 3-pt leader bonus): base 6 + 2 divers = 8 + 3 leader bonus = 11 pts!
    const d5 = finishWeek1(5, 2, 'A');
    expect(getPlayer(d5, 'p2').achievementPoints).toBe(11);
  });
});

describe('Ravel Mode weekly scoring', () => {
  it('matches the official R6 example from fish_automa_p07.png and floors at 0', () => {
    const s = soloGame(1, { difficulty: 2, ravelMode: true, ravelStrength: 2 });
    let p1 = getPlayer(s, 'p1');
    // Build the exact ocean layout from fish_automa_p07.png:
    // Green site (col 2) has 3 fish: r1c2, r2c2, r4c2.
    // Rows 1 & 2 have 4 fish: r1c0, r1c1, r1c2 (3 in row 1) and r2c2 (1 in row 2).
    const slots = p1.ocean.slots.map((r) => r.map(() => ({ stack: [] as number[], eggs: 0, young: 0, school: false })));
    slots[0]![0]!.stack = [1];
    slots[1]![0]!.stack = [2];
    slots[1]![1]!.stack = [3];
    slots[1]![2]!.stack = [900]; // Catalina Goby (forage)
    slots[2]![2]!.stack = [4];
    slots[3]![0]!.stack = [5];
    slots[3]![1]!.stack = [901];
    slots[4]![0]!.stack = [902];
    slots[4]![2]!.stack = [6];
    p1 = { ...p1, ocean: { ...p1.ocean, slots } };

    // Strength 2: 2 * 3 - 4 = 2 points.
    expect(scoreRavelWeek(p1, 'R6', 2)).toBe(2);
    // Strength 4: 4 * 3 - 4 = 8 points.
    expect(scoreRavelWeek(p1, 'R6', 4)).toBe(8);

    // When highlighted rows have more fish than X * siteFish, floors at 0 (never negative).
    slots[2]![0]!.stack = [7];
    slots[2]![1]!.stack = [8];
    slots[4]![2]!.stack = []; // now only 2 fish in col 2, 6 fish in rows 1 & 2 -> 2*2 - 6 = -2 -> 0
    expect(scoreRavelWeek(p1, 'R6', 2)).toBe(0);
  });

  it('accumulates Ravel points at the end of all 4 weeks', () => {
    let s = soloGame(1, { difficulty: 2, ravelMode: true, ravelStrength: 4 });
    // Force R6 (col 2: Catalina Goby at r1c2 = 1 fish; rows 1-2: Catalina Goby at r1c2 = 1 fish -> 4*1 - 1 = 3 pts/week).
    s = { ...s, nautoma: { ...s.nautoma!, ravelCardId: 'R6' } };
    for (let w = 0; w < 4; w++) {
      const p1 = getPlayer(s, 'p1');
      const p2 = getPlayer(s, 'p2');
      s = setPlayer(s, { ...p1, diversUsed: DIVERS_PER_WEEK });
      s = setPlayer(s, { ...p2, diversUsed: DIVERS_PER_WEEK });
      s = { ...s, currentPlayerIndex: 1, turnTookAction: true };
      s = applyAction(s, { type: 'endTurn', playerId: 'p2' });
    }
    expect(s.nautoma!.ravelPoints).toBe(12); // 3 pts x 4 weeks
    expect(s.finalScores!.p2.achievementPoints).toBe(getPlayer(s, 'p2').achievementPoints + 12);
  });
});

describe('Nautoma end-of-game scoring & tiebreaker', () => {
  it('calculates ScoreBreakdown per difficulty (3/4 fish, 5/6 schools, 1 young, floor(eggs/2), S&R coral)', () => {
    let s2 = soloGame(1, { difficulty: 2, ravelMode: true }, ['base', 'sr']);
    s2 = setPlayer(s2, { ...getPlayer(s2, 'p2'), achievementPoints: 7 });
    s2 = {
      ...s2,
      nautoma: {
        ...s2.nautoma!,
        fish: [1, 2, 3, 4], // 4 fish x 3 = 12
        schools: 2, // 2 schools x 5 = 10
        young: 3, // 3 young x 1 = 3
        eggs: 5, // floor(5/2) = 2
        corals: 6, // 6 x 1 = 6 (no +5 bonus at diff 2)
        ravelPoints: 4, // achievementPoints = 7 + 4 = 11
      },
    };
    const b2 = scorePlayer(s2, getPlayer(s2, 'p2'));
    expect(b2).toEqual({
      achievementPoints: 11,
      gameEndAbilityPoints: 0,
      fishPoints: 12,
      consumedPoints: 0,
      eggYoungPoints: 5,
      schoolPoints: 10,
      coralPoints: 6,
      total: 44,
    });

    // Difficulty 3: 4 pts/fish, 6 pts/school, +5 bonus per 6 coral.
    let s3 = { ...s2, nautoma: { ...s2.nautoma!, difficulty: 3 as const } };
    const b3 = scorePlayer(s3, getPlayer(s3, 'p2'));
    expect(b3.fishPoints).toBe(16);
    expect(b3.schoolPoints).toBe(12);
    expect(b3.coralPoints).toBe(11); // 6 + 5
    expect(b3.total).toBe(55);
  });

  it('awards ties to the human player ("In the event of a tie, you win!")', () => {
    let s = soloGame(1, { difficulty: 2 });
    const p1Score = scorePlayer(s, getPlayer(s, 'p1')).total;
    // Set Nautoma's young to match p1Score exactly (with 0 fish, 0 schools, 0 eggs, 0 achievements).
    s = {
      ...s,
      nautoma: {
        ...s.nautoma!,
        fish: [],
        schools: 0,
        young: p1Score,
        eggs: 0,
        corals: 0,
        ravelPoints: 0,
      },
    };
    const { scores, winner } = finalScores(s);
    expect(scores.p1.total).toBe(scores.p2.total);
    expect(winner).toEqual(['p1']);
  });
});

describe('Full Nautoma games', () => {
  it('completes deterministic solo games across difficulties 1-5, Ravel Mode, and Sharks & Reefs', () => {
    for (const difficulty of [1, 2, 3, 4, 5] as const) {
      const s = runSoloGame(10 + difficulty, {
        difficulty,
        ravelMode: difficulty % 2 === 1,
        ravelStrength: 3,
      });
      expect(s.phase).toBe('gameOver');
      expect(s.finalScores).not.toBeNull();
      expect(s.winner).not.toBeNull();
      expect(s.nautoma!.fish.length).toBeGreaterThan(0);
    }

    const srSolo = runSoloGame(
      99,
      { difficulty: 4, ravelMode: true, ravelStrength: 2 },
      ['base', 'sr'],
      'B',
    );
    expect(srSolo.phase).toBe('gameOver');
    expect(srSolo.nautoma!.corals).toBeGreaterThan(0);
    expect(srSolo.finalScores!.p2.coralPoints).toBeGreaterThan(0);

    // Determinism check
    const srSolo2 = runSoloGame(
      99,
      { difficulty: 4, ravelMode: true, ravelStrength: 2 },
      ['base', 'sr'],
      'B',
    );
    expect(srSolo.finalScores).toEqual(srSolo2.finalScores);
    expect(srSolo.winner).toEqual(srSolo2.winner);
  });
});
