// Rules audit: player decisions the Finspan engine used to make itself.
//   - "These benefits are optional for each affected player": an egg on each
//     fish and a fixed-site coral are confirmed (or declined) per player.
//   - "If there is more than one benefit, you may choose the order" (WHEN PLAYED).
//   - GAME END abilities activate "in any order".
//   - A two-part ability's coral requirement is checked when its second part is
//     reached ("you only gain the second benefit after you gain or decline the
//     first"), so coral gained earlier in the same dive counts.
//   - The S&R reef overlay reprints the twilight bonus (covered in sr.test.ts).

import { describe, expect, it } from 'vitest';
import { FISH } from './cards';
import { applyAction, settle } from './engine';
import { addEgg, getPlayer, placeCoral, setPlayer, slotAt } from './helpers';
import { fireAbility } from './powers';
import { aiGame } from './testUtils';
import type { Choice, GameState, PlayerId, PlayerState, SlotRef } from './types';
import { TWILIGHT_ROW } from './types';

const byName = (name: string) => FISH.find((c) => c.name === name)!;
const answer = (s: GameState, pid: PlayerId, choice: Choice) => applyAction(s, { type: 'resolveChoice', playerId: pid, choice });

function put(p: PlayerState, ref: SlotRef, cardId: number, extra: { eggs?: number; young?: number } = {}): PlayerState {
  const slots = p.ocean.slots.map((r) => r.map((x) => ({ ...x })));
  slots[ref.row]![ref.col] = { stack: [cardId], eggs: extra.eggs ?? 0, young: extra.young ?? 0, school: false };
  return { ...p, ocean: { ...p.ocean, slots } };
}

const base = (seed = 1) => aiGame(seed, 2, { sets: ['base'], achievementSide: 'A' });
const sr = (seed = 1) =>
  aiGame(seed, 2, {
    sets: ['base', 'sr'],
    achievementSide: 'A',
    reefCosts: [['egg', 'young', 'card'], ['egg', 'young', 'card']],
  });

describe('rules audit: optional automatic benefits', () => {
  it('"an egg on each" can be declined (e.g. to keep a "no tokens on this fish" bonus)', () => {
    let s = base();
    s = setPlayer(s, put(getPlayer(s, 'p1'), { row: 0, col: 0 }, byName('Barramundi').id));
    const fired = fireAbility(s, 'p1', byName('European Anchovy').ability, undefined, 'test');
    expect(fired.pending[0]).toMatchObject({ kind: 'confirmBenefit', benefit: 'eggsOnEach' });
    const declined = answer(fired, 'p1', { kind: 'decline' });
    expect(slotAt(getPlayer(declined, 'p1').ocean, { row: 0, col: 0 }).eggs).toBe(0);
    const taken = answer(fired, 'p1', { kind: 'confirm' });
    expect(slotAt(getPlayer(taken, 'p1').ocean, { row: 0, col: 0 }).eggs).toBe(1);
  });

  it('an all-players fixed coral is each player\'s own choice', () => {
    const s = base();
    const fired = fireAbility(s, 'p1', byName('Great Barracuda').ability, { row: 0, col: 0 }, 'test');
    expect(fired.pending.map((x) => [x.kind, x.playerId])).toEqual([['confirmBenefit', 'p1'], ['confirmBenefit', 'p2']]);
    const after = answer(answer(fired, 'p1', { kind: 'decline' }), 'p2', { kind: 'confirm' });
    expect(getPlayer(after, 'p1').ocean.corals[0]).toBe(0);
    expect(getPlayer(after, 'p2').ocean.corals[0]).toBe(1);
  });
});

describe('rules audit: order of benefits', () => {
  it('WHEN PLAYED with several benefits: the player picks which comes first', () => {
    let s = base();
    // Young to move and a pair to school, so every benefit has something to do.
    let p = getPlayer(s, 'p1');
    p = put(p, { row: 1, col: 0 }, byName('Barramundi').id, { young: 1 });
    s = setPlayer(s, p);
    const shark = byName('Angular Roughshark'); // move, move, unschool
    const fired = fireAbility(s, 'p1', shark.ability, { row: 0, col: 1 }, 'test', { orderable: true });
    expect(fired.pending[0]).toMatchObject({ kind: 'chooseEffectOrder' });
    // Un-school first (no school → its "place 1 young" fallback), then the moves.
    const first = answer(fired, 'p1', { kind: 'index', index: 2 });
    expect(['chooseUnSchool', 'chooseYoungSlots']).toContain(first.pending[0]!.kind);
    const next = answer(first, 'p1', { kind: 'decline' });
    expect(next.pending[0]?.kind).toBe('chooseMove');
  });

  it('GAME END abilities: the player picks the order', () => {
    let s = base();
    let p = getPlayer(s, 'p1');
    p = put(p, { row: 1, col: 0 }, byName('Atlantic Salmon').id);
    p = put(p, { row: 1, col: 1 }, byName('European Anchovy').id);
    p = put(p, { row: 0, col: 2 }, byName('Barramundi').id);
    s = setPlayer(s, { ...p, hand: [] });
    s = settle({
      ...s,
      phase: 'gameEnd',
      pending: [],
      gameEndQueue: [{ playerId: 'p1', slot: { row: 1, col: 0 } }, { playerId: 'p1', slot: { row: 1, col: 1 } }],
    });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseGameEndAbility', playerId: 'p1' });
    // Anchovy first (an egg on each estuary fish), then the Salmon.
    s = answer(s, 'p1', { kind: 'slots', slots: [{ row: 1, col: 1 }] });
    expect(s.pending[0]).toMatchObject({ kind: 'confirmBenefit', benefit: 'eggsOnEach' });
    s = answer(s, 'p1', { kind: 'confirm' });
    expect(slotAt(getPlayer(s, 'p1').ocean, { row: 0, col: 2 }).eggs).toBe(1);
    // With one ability left there is no order to pick: the Salmon fires (empty
    // hand, nothing to play) and the game ends.
    expect(s.gameEndQueue).toEqual([]);
    expect(s.phase).toBe('gameOver');
  });
});

describe('rules audit: coral requirements', () => {
  it('coral placed by the reef earlier in the same dive unlocks a two-part second benefit', () => {
    let s = sr(3);
    let p = getPlayer(s, 'p1');
    // Furry Coffinfish (twilight, blue site): [Discard] also, if 3 blue coral: [SchoolFeederMove].
    p = put(p, { row: TWILIGHT_ROW, col: 0 }, byName('Furry Coffinfish').id);
    p = put(p, { row: 0, col: 1 }, byName('Barramundi').id, { young: 1 });
    p = addEgg(p, { row: 0, col: 1 });
    p = placeCoral(placeCoral(p, 0), 0); // 2 blue: one short
    s = setPlayer(s, { ...p, discard: [byName('Barramundi').id] });
    s = applyAction(s, { type: 'dive', playerId: 'p1', col: 0 });
    let sawMove = false;
    for (let k = 0; k < 20 && s.pending.length; k++) {
      const head = s.pending[0]!;
      if (head.playerId !== 'p1') break;
      if (head.kind === 'chooseMove') {
        sawMove = true;
        break;
      }
      s = head.kind === 'chooseReefDiscard'
        ? answer(s, 'p1', { kind: 'reefDiscard', use: true, eggSlot: { row: 0, col: 1 } })
        : answer(s, 'p1', { kind: 'decline' });
    }
    expect(getPlayer(s, 'p1').ocean.corals[0]).toBe(3);
    expect(sawMove).toBe(true);
  });
});

