import { describe, expect, it } from 'vitest';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { chooseAction } from './ai';
import { INCOME_SECTIONS } from './guild';
import type { GameState } from './types';
import type { CreateGameOptions } from './createGame';

/** Drive the game with the AI until it ends or we hit a safety cap. */
function playOut(seed: number, players = 2, opts: CreateGameOptions = {}): GameState {
  const names = Array.from({ length: players }, (_, i) => `P${i + 1}`);
  let s = createGame({ seed, playerNames: names, ...opts });
  let steps = 0;
  while (s.phase !== 'gameEnd' && steps < 20000) {
    steps++;
    if (s.pending.length) {
      const pid = s.pending[0]!.playerId;
      const a = chooseAction(s, pid);
      if (!a) throw new Error(`AI stuck on pending ${JSON.stringify(s.pending[0])}`);
      s = applyAction(s, a);
      continue;
    }
    if (s.phase === 'setup' || s.phase === 'roundEnd') {
      throw new Error(`${s.phase} phase with no pending steps`);
    }
    const a = chooseAction(s, s.turn);
    if (!a) throw new Error(`AI stuck on turn ${s.turn} round ${s.round}`);
    s = applyAction(s, a);
  }
  expect(s.phase).toBe('gameEnd');
  return s;
}

/** Drive with the AI until `pred` holds (or a step cap). */
function playUntil(s: GameState, pred: (s: GameState) => boolean): GameState {
  let steps = 0;
  while (s.phase !== 'gameEnd' && !pred(s) && steps < 20000) {
    steps++;
    if (s.pending.length) {
      const pid = s.pending[0]!.playerId;
      const a = chooseAction(s, pid);
      if (!a) throw new Error(`AI stuck on pending ${JSON.stringify(s.pending[0])}`);
      s = applyAction(s, a);
      continue;
    }
    const a = chooseAction(s, s.turn);
    if (!a) throw new Error(`AI stuck on turn ${s.turn} round ${s.round}`);
    s = applyAction(s, a);
  }
  expect(pred(s) || s.phase === 'gameEnd').toBe(true);
  return s;
}

/** Reach the 'main' phase of a fresh game (resolves setup offers via AI). */
function inMain(opts: CreateGameOptions = {}): GameState {
  let s = createGame({ seed: 3, playerNames: ['P1', 'P2'], ...opts });
  while (s.pending.length) {
    const pid = s.pending[0]!.playerId;
    s = applyAction(s, chooseAction(s, pid)!);
  }
  expect(s.phase).toBe('main');
  return s;
}

describe('wyrmspan engine', () => {
  it('creates a game with setup pending', () => {
    const s = createGame({ seed: 1, playerNames: ['P1', 'P2'] });
    expect(s.phase).toBe('setup');
    expect(s.players).toHaveLength(2);
    expect(s.pending.length).toBeGreaterThan(0);
    for (const p of s.players) {
      expect(s.setupOffers[p.id]).toHaveLength(6);
      expect(p.coins).toBe(6);
      expect(p.nestEggs).toBe(1);
    }
  });

  it('plays a full 2-player game to completion', () => {
    const s = playOut(1, 2);
    expect(s.round).toBe(4);
    expect(s.finalScores).toBeDefined();
    expect(s.finalScores).toHaveLength(2);
    expect(s.winners?.length).toBeGreaterThan(0);
    for (const sc of s.finalScores!) {
      expect(sc.total).toBeGreaterThan(0);
      expect(sc.total).toBe(
        sc.guildTile + sc.printedDragonVp + sc.endGameAbilities + sc.eggs + sc.cached + sc.tucked + sc.objectives + sc.coins + sc.leftovers + sc.bonusVP,
      );
    }
  }, 30000);

  it('is deterministic for a fixed seed', () => {
    const a = playOut(7, 2);
    const b = playOut(7, 2);
    expect(a.finalScores).toEqual(b.finalScores);
  }, 30000);

  it('plays a full 2-player base-only game to completion', () => {
    const s = playOut(1, 2, { expansions: ['base'] });
    expect(s.round).toBe(4);
    expect(s.finalScores).toHaveLength(2);
  }, 30000);

  it('is deterministic for a fixed seed (base only)', () => {
    const a = playOut(7, 2, { expansions: ['base'] });
    const b = playOut(7, 2, { expansions: ['base'] });
    expect(a.finalScores).toEqual(b.finalScores);
  }, 30000);
});

describe('dragon academy round tracker', () => {
  it('passing in rounds 1-3 queues an income-space choice with unique claims', () => {
    let s = inMain();
    expect(s.turn).toBe('p1');
    s = applyAction(s, { type: 'pass', playerId: 'p1' });
    const head = s.pending[0];
    expect(head?.kind).toBe('chooseIncomeSpace');
    expect(head?.playerId).toBe('p1');
    if (head?.kind !== 'chooseIncomeSpace') throw new Error('unreachable');
    expect(head.options).toEqual([0, 1, 2, 3, 4, 5]);
    // p1 claims space 5 ('6 coins').
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 5 } });
    expect(s.incomeChoices.p1).toBe(5);
    expect(s.turn).toBe('p2');

    s = applyAction(s, { type: 'pass', playerId: 'p2' });
    const head2 = s.pending[0];
    expect(head2?.kind).toBe('chooseIncomeSpace');
    if (head2?.kind !== 'chooseIncomeSpace') throw new Error('unreachable');
    // p1's claim is unavailable.
    expect(head2.options).toEqual([0, 1, 2, 3, 4]);
  });

  it('collects claimed income at round end, in order from the new start player', () => {
    let s = inMain();
    s = applyAction(s, { type: 'pass', playerId: 'p1' });
    // p1 picks the '6 coins' space (section A index 5).
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 5 } });
    s = applyAction(s, { type: 'pass', playerId: 'p2' });
    // p2 picks '5 coins + 2 eggs' (option 0).
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p2', answer: { kind: 'index', index: 0 } });
    expect(s.incomeChoices.p2).toBe(0);

    // Round ended: new start player is p2; p2 collects first -> egg placement.
    expect(s.phase).toBe('roundEnd');
    expect(s.startPlayer).toBe('p2');
    expect(s.pending[0]?.kind).toBe('chooseEggSpot');
    expect(s.pending[0]?.playerId).toBe('p2');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p2',
      answer: { kind: 'eggSpots', spots: [{ kind: 'nest' }, { kind: 'nest' }] },
    });

    // Income drained: round 2 starts with p2 to act.
    expect(s.phase).toBe('main');
    expect(s.round).toBe(2);
    expect(s.turn).toBe('p2');
    expect(s.incomeChoices).toEqual({});
    // p1 collected 6 coins on top of the 6 it held; p2 got 5.
    expect(s.players.find((p) => p.id === 'p1')!.coins).toBe(12);
    expect(s.players.find((p) => p.id === 'p2')!.coins).toBe(11);
    // p2 laid at most 1 egg onto its nest (started with 1, max 2).
    expect(s.players.find((p) => p.id === 'p2')!.nestEggs).toBe(2);
  });

  it('drafts an income card from the display and refills it immediately', () => {
    let s = inMain();
    s = applyAction(s, { type: 'pass', playerId: 'p1' });
    // section A index 1 = '5 coins + 1 egg + dragon card'.
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 1 } });
    s = applyAction(s, { type: 'pass', playerId: 'p2' });
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p2', answer: { kind: 'index', index: 0 } });

    // p2 (new start player) places eggs first, then p1's egg spot, then p1 drafts.
    let drafted: number | null = null;
    while (s.pending.length) {
      const head = s.pending[0]!;
      if (head.kind === 'chooseDisplay') {
        expect(head.playerId).toBe('p1');
        const idx = s.dragonDisplay.findIndex((c) => c !== null);
        drafted = s.dragonDisplay[idx]!;
        s = applyAction(s, { type: 'resolveChoice', playerId: head.playerId, answer: { kind: 'index', index: idx } });
        break;
      }
      const a = chooseAction(s, head.playerId);
      if (!a) throw new Error(`AI stuck on ${head.kind}`);
      s = applyAction(s, a);
    }
    // Drain the rest of income collection.
    while (s.pending.length) {
      const head = s.pending[0]!;
      s = applyAction(s, chooseAction(s, head.playerId)!);
    }
    expect(s.phase).toBe('main');
    // Display was refilled.
    expect(s.dragonDisplay.every((c) => c !== null)).toBe(true);
    // p1 holds the drafted dragon card.
    const p1 = s.players.find((p) => p.id === 'p1')!;
    expect(p1.coins).toBe(11); // 6 start + 5 income
    expect(drafted).not.toBeNull();
    expect(p1.hand).toContain(drafted);
  });

  it('uses the round-3 section when passing in round 3', () => {
    // Drive to round 3, then force a pass and inspect the options' benefits.
    let s = inMain();
    s = playUntil(s, (g) => g.round === 3 && g.phase === 'main' && !g.pending.length);
    const pid = s.turn;
    s = applyAction(s, { type: 'pass', playerId: pid });
    const head = s.pending[0];
    expect(head?.kind).toBe('chooseIncomeSpace');
    if (head?.kind !== 'chooseIncomeSpace') throw new Error('unreachable');
    // Round-3 section has 6 spaces incl. two 6-coin options.
    expect(head.options).toHaveLength(6);
    const coinsOf = (i: number) =>
      INCOME_SECTIONS[1]![head.options[i]!]!.items.reduce((a, it) => a + (it.kind === 'coin' ? it.count : 0), 0);
    const sixes = head.options.map((_, i) => coinsOf(i)).filter((c) => c === 6);
    expect(sixes).toHaveLength(2);
  });

  it('offers a training token when the adventurer walks over a fledgling', () => {
    let s = inMain();
    expect(s.turn).toBe('p1');
    const st = structuredClone(s);
    const p1 = st.players.find((p) => p.id === 'p1')!;
    // Card 258 "Curious Feline Dragonette": fledgling, track [Milk][Meat].
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 258, eggs: 0, tucked: [], cached: [], training: 0 };
    p1.resources.milk = 1;
    s = applyAction(st, { type: 'explore', playerId: 'p1', cave: 0 });
    const head = s.pending[0];
    expect(head?.kind).toBe('chooseTrain');
    if (head?.kind !== 'chooseTrain') throw new Error('unreachable');
    expect(head.pos).toEqual([0, 0]);
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'dragon', pos: [0, 0] } });
    const after = s.players.find((p) => p.id === 'p1')!;
    expect(after.caves[0]!.spaces[0]!.dragon!.training).toBe(1);
    expect(after.resources.milk).toBe(0); // first box cost paid
  });

  it('lets the adventurer decline training a walked-over fledgling', () => {
    let s = inMain();
    const st = structuredClone(s);
    const p1 = st.players.find((p) => p.id === 'p1')!;
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 258, eggs: 0, tucked: [], cached: [], training: 0 };
    s = applyAction(st, { type: 'explore', playerId: 'p1', cave: 0 });
    expect(s.pending[0]?.kind).toBe('chooseTrain');
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'decline' } });
    expect(s.players.find((p) => p.id === 'p1')!.caves[0]!.spaces[0]!.dragon!.training ?? 0).toBe(0);
  });

  it('tracks coins spent enticing dragons for the objective tile', () => {
    let s = inMain();
    expect(s.turn).toBe('p1');
    const st = structuredClone(s);
    const p1 = st.players.find((p) => p.id === 'p1')!;
    // Card 9 "Melodious Firedragon" (Crimson Cavern, costs milk + egg; entice
    // always costs 1 coin on top).
    p1.hand = [9];
    p1.resources.milk = 1;
    s = applyAction(st, { type: 'entice', playerId: 'p1', cave: 0, cardId: 9 });
    const after = s.players.find((p) => p.id === 'p1')!;
    expect(after.coinsSpentEntice).toBe(1);
    expect(after.caves[0]!.spaces[0]!.dragon?.cardId).toBe(9);
  });

  it('does not offer income spaces in round 4 (or in base-only games)', () => {
    let s = inMain();
    s = playUntil(s, (g) => g.round === 4 && g.phase === 'main' && !g.pending.length);
    const pid = s.turn;
    const before = s.pending.length;
    s = applyAction(s, { type: 'pass', playerId: pid });
    expect(s.pending.length).toBe(before); // no chooseIncomeSpace queued

    let b = inMain({ expansions: ['base'] });
    const bpid = b.turn;
    b = applyAction(b, { type: 'pass', playerId: bpid });
    expect(b.pending.filter((p) => p.kind === 'chooseIncomeSpace')).toHaveLength(0);
  });
});
