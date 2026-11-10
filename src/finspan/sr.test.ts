// Sharks & Reefs expansion tests: reef overlay dives, coral requirements and
// scoring, two-part "also, if" abilities, unique-tag achievement counting,
// school scattering, and side-B tile pools. Verifies base games are
// unaffected when 'sr' is not in settings.sets.

import { describe, expect, it } from 'vitest';
import { parseAbility } from './abilities';
import { FISH, sideBTilePool } from './cards';
import { REEF_DISCARD_ITEMS, REEF_OVERLAY_SIDES, MAX_CORAL, REEF_COMPLETION_BONUS } from './constants';
import { applyAction } from './engine';
import { addEgg, addYoung, allSlots, getPlayer, placeCoral, setPlayer, slotAt } from './helpers';
import { fireAbility } from './powers';
import { achievementUnits, scoreAchievement, scorePlayer } from './scoring';
import { DIVERS_PER_WEEK } from './types';
import type { GameState, SlotRef } from './types';
import { aiGame, runAI } from './testUtils';

type ReefCosts = ('egg' | 'young' | 'card')[][];

const srGame = (seed = 1, players = 2, side: 'A' | 'B' = 'A', reefCosts?: ReefCosts): GameState =>
  aiGame(seed, players, { sets: ['base', 'sr'], achievementSide: side, reefCosts });

/** Both players on the same fixed overlay: blue=egg, purple=young, green=card. */
const FIXED_REEF: ReefCosts = [
  ['egg', 'young', 'card'],
  ['egg', 'young', 'card'],
];

const baseGame = (seed = 1, players = 2): GameState => aiGame(seed, players, { sets: ['base'], achievementSide: 'A' });

const runGame = (seed: number, players: number, sets: string[], side: 'A' | 'B', maxActions = 8000) =>
  runAI(aiGame(seed, players, { sets, achievementSide: side }), maxActions);

const firstSlotWith = (s: GameState, pid: 'p1', pred: (slot: { eggs: number; young: number; school: boolean }) => boolean): SlotRef => {
  for (const { ref, slot } of allSlots(getPlayer(s, pid).ocean)) if (pred(slot)) return ref;
  throw new Error('no matching slot');
};

describe('reef overlay dives', () => {
  it('offers the overlay\'s discard item for 1 coral at the twilight stop', () => {
    for (let col = 0; col < 3; col++) {
      const s = applyAction(srGame(3, 2, 'A', FIXED_REEF), { type: 'dive', playerId: 'p1', col });
      const step = s.pending.find((x) => x.kind === 'chooseReefDiscard');
      expect(step).toBeTruthy();
      expect(step!.kind === 'chooseReefDiscard' && step!.item).toBe(REEF_DISCARD_ITEMS[col]);
      expect(step!.kind === 'chooseReefDiscard' && step!.col).toBe(col);
    }
  });

  it('uses the player\'s own overlay when reefCosts differ', () => {
    // p1's overlay: all eggs. p2's overlay: all cards.
    const costs: ReefCosts = [
      ['egg', 'egg', 'egg'],
      ['card', 'card', 'card'],
    ];
    let s = applyAction(srGame(3, 2, 'A', costs), { type: 'dive', playerId: 'p1', col: 2 });
    const step = s.pending.find((x) => x.kind === 'chooseReefDiscard')!;
    expect(step.kind === 'chooseReefDiscard' && step.item).toBe('egg');
    // Finish p1's turn (decline the sunlight hatch + the reef offer + the bottom move).
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', choice: { kind: 'decline' } });
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'reefDiscard', use: false },
    });
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', choice: { kind: 'decline' } });
    s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
    s = applyAction(s, { type: 'dive', playerId: 'p2', col: 2 });
    const step2 = s.pending.find((x) => x.kind === 'chooseReefDiscard')!;
    expect(step2.kind === 'chooseReefDiscard' && step2.item).toBe('card');
  });

  it('deals each player a printed reef overlay side from REEF_OVERLAY_SIDES when reefCosts is unset', () => {
    const s = srGame(4);
    expect(REEF_OVERLAY_SIDES.length).toBe(10);
    for (const side of REEF_OVERLAY_SIDES) {
      expect(side).toEqual(['egg', 'young', 'card']);
    }
    expect(s.settings.reefCosts).toEqual([
      ['egg', 'young', 'card'],
      ['egg', 'young', 'card'],
    ]);
    // Base games leave reefCosts unset.
    expect(baseGame(4).settings.reefCosts).toBeUndefined();
  });

  it('discarding the indicated item places 1 coral; declining does not', () => {
    // Blue site wants an egg (forage fish start with eggs).
    let s = applyAction(srGame(3, 2, 'A', FIXED_REEF), { type: 'dive', playerId: 'p1', col: 0 });
    const eggSlot = firstSlotWith(s, 'p1', (x) => x.eggs > 0);
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'reefDiscard', use: true, eggSlot },
    });
    // The reef step resolved; coral was placed (other pending steps may remain).
    expect(getPlayer(s, 'p1').ocean.corals[0]).toBe(1);

    // Green site wants a card; decline the sunlight hatch first, then the reef offer.
    let s2 = applyAction(srGame(3, 2, 'A', FIXED_REEF), { type: 'dive', playerId: 'p1', col: 2 });
    s2 = applyAction(s2, { type: 'resolveChoice', playerId: 'p1', choice: { kind: 'decline' } });
    s2 = applyAction(s2, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'reefDiscard', use: false },
    });
    expect(getPlayer(s2, 'p1').ocean.corals[2]).toBe(0);
  });

  it('offers no reef step when the site already has 6 coral', () => {
    let s = srGame(3);
    let p = getPlayer(s, 'p1');
    for (let i = 0; i < MAX_CORAL; i++) p = placeCoral(p, 0);
    s = setPlayer(s, p);
    s = applyAction(s, { type: 'dive', playerId: 'p1', col: 0 });
    expect(s.pending.some((x) => x.kind === 'chooseReefDiscard')).toBe(false);
  });

  it('base games keep the printed twilight bonus (no reef step)', () => {
    // Purple twilight holds a forage fish -> printed benefit is an egg choice.
    const s = applyAction(baseGame(3), { type: 'dive', playerId: 'p1', col: 1 });
    expect(s.pending.some((x) => x.kind === 'chooseReefDiscard')).toBe(false);
    expect(s.pending.some((x) => x.kind === 'chooseEggTargets')).toBe(true);
  });

  it('S&R replaces the twilight bonus even where a twilight fish exists', () => {
    // Purple column: Showy Bristlemouth is in twilight; reef step replaces the
    // twilight egg bonus, and the bottom 'egg' bonus still applies.
    const s = applyAction(srGame(3), { type: 'dive', playerId: 'p1', col: 1 });
    const kinds = s.pending.map((x) => x.kind);
    expect(kinds).toEqual(['chooseReefDiscard', 'chooseEggTargets']);
  });
});

describe('coral requirements and scoring', () => {
  const reefFish = FISH.find((c) => c.set === 'sr' && c.coralCost && !c.cost.consume && c.cost.cards === 0 && c.cost.eggs === 0 && c.cost.young === 0 && c.cost.schools === 0)!;

  it('reef fish need the stated coral and live only in the sunlight zone', () => {
    expect(reefFish).toBeTruthy();
    let s = srGame(5);
    let p = getPlayer(s, 'p1');
    p = { ...p, hand: [...p.hand, reefFish.id] };
    s = setPlayer(s, p);
    const col = reefFish.coralCost!.site === 'any' ? 0 : ['blue', 'purple', 'green'].indexOf(reefFish.coralCost!.site);
    const row = 0; // empty estuary slot, sunlight zone

    // Not enough coral -> illegal.
    expect(() =>
      applyAction(s, { type: 'playFish', playerId: 'p1', cardId: reefFish.id, row, col }),
    ).toThrow(/coral|placement/i);

    // Enough coral -> legal in sunlight; still illegal in twilight.
    let p2 = getPlayer(s, 'p1');
    for (let i = 0; i < reefFish.coralCost!.count; i++) p2 = placeCoral(p2, col);
    s = setPlayer(s, p2);
    expect(() =>
      applyAction(s, { type: 'playFish', playerId: 'p1', cardId: reefFish.id, row: 3, col }),
    ).toThrow();
    const s2 = applyAction(s, { type: 'playFish', playerId: 'p1', cardId: reefFish.id, row, col });
    expect(slotAt(getPlayer(s2, 'p1').ocean, { row, col }).stack).toContain(reefFish.id);
  });

  it('scores 1 point per coral plus the reef completion bonus', () => {
    let s = srGame(5);
    let p = getPlayer(s, 'p1');
    for (let i = 0; i < 6; i++) p = placeCoral(p, 0); // complete blue reef
    for (let i = 0; i < 3; i++) p = placeCoral(p, 1);
    s = setPlayer(s, p);
    const score = scorePlayer(s, getPlayer(s, 'p1'));
    expect(score.coralPoints).toBe(9 + REEF_COMPLETION_BONUS[0]!);
  });

  it('never exceeds 6 coral per site', () => {
    let p = getPlayer(srGame(5), 'p1');
    for (let i = 0; i < 10; i++) p = placeCoral(p, 2);
    expect(p.ocean.corals[2]).toBe(MAX_CORAL);
  });

  it('ignores coral entirely in base games', () => {
    let s = baseGame(5);
    let p = getPlayer(s, 'p1');
    for (let i = 0; i < 6; i++) p = placeCoral(p, 0);
    s = setPlayer(s, p);
    expect(scorePlayer(s, getPlayer(s, 'p1')).coralPoints).toBe(0);
  });
});

describe('S&R abilities', () => {
  it('gates the "also, if N coral" second benefit on this dive site and maps [Discard] to chooseRecover', () => {
    // Furry Coffinfish: [Discard] also, if 3 blue coral: [SchoolFeederMove].
    // [Discard] is the sideways fish-skeleton icon (recover a card from your discard pile).
    const card = FISH.find((c) => c.name === 'Furry Coffinfish')!;
    let s = srGame(7);
    let p = getPlayer(s, 'p1');
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[3]![0] = { stack: [card.id], eggs: 0, young: 0, school: false };
    p = { ...p, ocean: { ...p.ocean, slots }, hand: [1, 2, 3], discard: [4] };
    s = setPlayer(s, p);
    const ref: SlotRef = { row: 3, col: 0 };

    const noCoral = fireAbility(s, 'p1', card.ability, ref, 'test');
    expect(noCoral.pending.map((x) => x.kind)).toEqual(['chooseRecover']);

    let p2 = getPlayer(s, 'p1');
    for (let i = 0; i < 3; i++) p2 = placeCoral(p2, 0);
    s = setPlayer(s, p2);
    const withCoral = fireAbility(s, 'p1', card.ability, ref, 'test');
    const kinds = withCoral.pending.map((x) => x.kind);
    expect(kinds[0]).toBe('chooseRecover');
    expect(kinds).toContain('chooseMove');
  });

  it('allows forming a school in an earlier effect and scattering it with [UnSchoolFish]', () => {
    // Ninja Lanternshark: "[YoungFish][UnSchoolFish]"
    let s = srGame(7);
    let p = getPlayer(s, 'p1');
    // Put 2 young on r0c0 (no school yet anywhere).
    p = addYoung(p, { row: 0, col: 0 }, 2);
    s = setPlayer(s, p);
    s = fireAbility(s, 'p1', '[YoungFish][UnSchoolFish]', { row: 3, col: 0 }, 'test');
    expect(s.pending.map((x) => x.kind)).toEqual(['chooseYoungSlots', 'chooseUnSchool']);
    // Place the young on r0c0 -> forms a school there!
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'slots', slots: [{ row: 0, col: 0 }] },
    });
    expect(slotAt(getPlayer(s, 'p1').ocean, { row: 0, col: 0 }).school).toBe(true);
    // Now chooseUnSchool is at the head and can scatter that newly formed school.
    expect(s.pending[0]!.kind).toBe('chooseUnSchool');
  });

  it('scatters a school into 4 young (or 1 young with no school)', () => {
    const raw = '[UnSchoolFish]';
    let s = srGame(7);
    let p = getPlayer(s, 'p1');
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[0]![0] = { stack: [1], eggs: 0, young: 0, school: true };
    p = { ...p, ocean: { ...p.ocean, slots } };
    s = setPlayer(s, p);

    const fired = fireAbility(s, 'p1', raw, { row: 0, col: 0 }, 'test');
    expect(fired.pending[0]!.kind).toBe('chooseUnSchool');
    const resolved = applyAction(fired, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: {
        kind: 'unSchool',
        schoolSlot: { row: 0, col: 0 },
        youngSlots: [
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 0 },
          { row: 2, col: 0 },
        ],
      },
    });
    const ocean = getPlayer(resolved, 'p1').ocean;
    expect(slotAt(ocean, { row: 0, col: 0 }).school).toBe(false);
    expect(slotAt(ocean, { row: 0, col: 1 }).young).toBe(1);

    // No school anywhere -> fallback is a single young.
    let p3 = getPlayer(s, 'p1');
    const slots3 = p3.ocean.slots.map((r) => r.map((x) => ({ ...x, school: false, young: 0 })));
    p3 = { ...p3, ocean: { ...p3.ocean, slots: slots3 } };
    const s3 = setPlayer(s, p3);
    const fired3 = fireAbility(s3, 'p1', raw, { row: 0, col: 0 }, 'test');
    expect(fired3.pending[0]!.kind).toBe('chooseYoungSlots');

    // Double [UnSchoolFish][UnSchoolFish] with only 1 school: first scatters the
    // school into 4 young; second converts to the 1-young fallback.
    const firedDouble = fireAbility(s, 'p1', '[UnSchoolFish][UnSchoolFish]', { row: 0, col: 0 }, 'test');
    expect(firedDouble.pending.map((x) => x.kind)).toEqual(['chooseUnSchool', 'chooseUnSchool']);
    const afterFirst = applyAction(firedDouble, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: {
        kind: 'unSchool',
        schoolSlot: { row: 0, col: 0 },
        youngSlots: [
          { row: 0, col: 1 },
          { row: 0, col: 2 },
          { row: 1, col: 0 },
          { row: 2, col: 0 },
        ],
      },
    });
    expect(afterFirst.pending[0]!.kind).toBe('chooseYoungSlots');
  });
});

describe('S&R achievements', () => {
  it('counts über predator as predator + über, discharge as electrolocation + discharge', () => {
    const uber = FISH.find((c) => c.tags.predator === 2)!;
    const bio = FISH.find((c) => c.tags.bioluminescent > 0)!;
    let s = srGame(7);
    let p = getPlayer(s, 'p1');
    const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[0]![0] = { stack: [uber.id], eggs: 0, young: 0, school: false };
    slots[0]![1] = { stack: [bio.id], eggs: 0, young: 0, school: false };
    p = { ...p, ocean: { ...p.ocean, slots } };
    // über + predator + bioluminescent = 3 unique tags from 2 fish.
    expect(achievementUnits(p, 'uniqueTags')).toBe(3);
    // Unique Tags tile (s2) awards 2 points per unique tag (sharks_p07.png).
    const s2Tile = sideBTilePool(2, ['base', 'sr']).find((t) => t.id === 's2')!;
    expect(scoreAchievement(p, s2Tile)).toBe(6);
    // Coral tile (s4) awards 2 points per coral (sharks_p01.png).
    const s4Tile = sideBTilePool(2, ['base', 'sr']).find((t) => t.id === 's4')!;
    p = placeCoral(placeCoral(p, 0), 1);
    expect(scoreAchievement(p, s4Tile)).toBe(4);
  });

  it('side-B pools include S&R tiles on their printed week lines only with sr on', () => {
    const w1 = sideBTilePool(1, ['base', 'sr']).map((t) => t.id);
    const w2 = sideBTilePool(2, ['base', 'sr']).map((t) => t.id);
    const w3 = sideBTilePool(3, ['base', 'sr']).map((t) => t.id);
    expect(w1).toContain('s3'); // fish in the sunlight zone (1 week-line, 1 pt)
    expect(w2).toContain('s2'); // unique tags (2 week-lines, 2 pts)
    expect(w2).toContain('s4'); // coral (2 week-lines, 2 pts)
    expect(w3).toContain('s1'); // <4 fish between 1-3 points (3 week-lines, 1 pt)
    expect(w3).not.toContain('s4');
    const w1Base = sideBTilePool(1, ['base']).map((t) => t.id);
    const w2Base = sideBTilePool(2, ['base']).map((t) => t.id);
    const w3Base = sideBTilePool(3, ['base']).map((t) => t.id);
    expect(w1Base).not.toContain('s3');
    expect(w2Base).not.toContain('s2');
    expect(w2Base).not.toContain('s4');
    expect(w3Base).not.toContain('s1');
  });

  it('side-B tile draws respect week lines at setup', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = srGame(seed, 2, 'B');
      s.achievements.forEach((a, i) => expect(a.week).toBe(i + 1));
    }
  });

  it('awards the side-B 3-point leader bonus at week end', () => {
    let s = srGame(3, 2, 'B');
    // Give p1 an edge that wins every possible week-1 side-B tile
    // (eggs, young, eggs-and-young, 1-3pt fish, sunlight fish): a cheap
    // sunlight fish with an egg plus extra young.
    const cheap = FISH.find(
      (c) => !c.forage && c.points >= 1 && c.points <= 3 && c.set === 'base',
    )!;
    let p1 = getPlayer(s, 'p1');
    const slots = p1.ocean.slots.map((r) => r.map((x) => ({ ...x })));
    slots[0]![0] = { stack: [cheap.id], eggs: 0, young: 0, school: false };
    p1 = { ...p1, ocean: { ...p1.ocean, slots } };
    p1 = addEgg(p1, { row: 0, col: 0 });
    p1 = addYoung(p1, { row: 0, col: 1 }, 4);
    p1 = { ...p1, diversUsed: DIVERS_PER_WEEK };
    s = setPlayer(s, p1);
    const p2 = getPlayer(s, 'p2');
    s = setPlayer(s, { ...p2, diversUsed: DIVERS_PER_WEEK });
    // It is p2's turn with the week's action already taken.
    s = { ...s, currentPlayerIndex: 1, turnTookAction: true };

    const ach = s.achievements[0]!;
    const pts1 = scoreAchievement(getPlayer(s, 'p1'), ach);
    const pts2 = scoreAchievement(getPlayer(s, 'p2'), ach);
    expect(pts1).toBeGreaterThan(pts2);

    s = applyAction(s, { type: 'endTurn', playerId: 'p2' });
    expect(getPlayer(s, 'p1').achievementPoints).toBe(pts1 + 3);
    expect(getPlayer(s, 'p2').achievementPoints).toBe(pts2);
    expect(s.week).toBe(1);
    expect(s.log.some((l) => l.msg.includes('leader bonus'))).toBe(true);
  });
});

describe('S&R full games', () => {
  it('runs a 3-player S&R side-A game to completion', () => {
    const s = runGame(11, 3, ['base', 'sr'], 'A');
    expect(s.phase).toBe('gameOver');
    expect(s.winner).not.toBeNull();
    for (const p of s.players) {
      expect(s.finalScores![p.id]!.coralPoints).toBeGreaterThanOrEqual(0);
    }
  }, 30000);

  it('runs a 4-player S&R side-B game to completion', () => {
    const s = runGame(21, 4, ['base', 'sr'], 'B');
    expect(s.phase).toBe('gameOver');
    expect(s.winner).not.toBeNull();
    const totalCoral = s.players.reduce(
      (a, p) => a + s.finalScores![p.id]!.coralPoints,
      0,
    );
    expect(totalCoral).toBeGreaterThan(0); // reef diving should produce coral
  }, 30000);

  it('parses every distinct S&R ability text into effects', () => {
    for (const c of FISH.filter((x) => x.set === 'sr' && x.ability)) {
      const p = parseAbility(c.ability)!;
      expect(p.effects.length > 0 || p.wave || p.alsoIf).toBeTruthy();
    }
  });

  it('completes 20 seeds of base and S&R games across sides A and B without errors', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s1 = runGame(seed, (seed % 4) + 2, ['base'], seed % 2 === 0 ? 'A' : 'B');
      expect(s1.phase).toBe('gameOver');
      const s2 = runGame(seed, (seed % 4) + 2, ['base', 'sr'], seed % 2 === 0 ? 'B' : 'A');
      expect(s2.phase).toBe('gameOver');
    }
  }, 30000);
});
