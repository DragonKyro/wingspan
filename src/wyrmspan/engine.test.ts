import { describe, expect, it } from 'vitest';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { answerFor, chooseAction } from './ai';
import { exploreCost } from './actions';
import { isDragonCard } from './cards';
import { GUILD_TILES, INCOME_SECTIONS } from './guild';
import type { GameState, PlayerId } from './types';
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

/** `pid` passes and answers the income-space choice their pass produces. */
function passAndAnswer(s: GameState, pid: PlayerId): GameState {
  s = applyAction(s, { type: 'pass', playerId: pid });
  while (s.pending.length && s.pending[0]!.kind === 'chooseIncomeSpace') {
    const who = s.pending[0]!.playerId;
    s = applyAction(s, { type: 'resolveChoice', playerId: who, answer: { kind: 'index', index: 0 } });
  }
  return s;
}

function playerOf(s: GameState, pid: PlayerId) {
  return s.players.find((p) => p.id === pid)!;
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
    // First path segment MAT_ICONS[0][0] ("gain 1 any resource") runs before space 0.
    expect(s.pending[0]?.kind).toBe('chooseResource');
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'resources', resources: ['gold'] } });
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
    expect(s.pending[0]?.kind).toBe('chooseResource');
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'resources', resources: ['gold'] } });
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

describe('audit regressions', () => {
  it('caching "any" resource from your supply spends that resource', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Knowing Guardian: "Cache [AnyResource] from your supply here. If you do,
    // draw [DragonCard]." (once per round)
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 119, eggs: 0, tucked: [], cached: [] };
    p1.resources.gold = 1;
    p1.hand = [];
    let s = passAndAnswer(st, 'p1');
    s = passAndAnswer(s, 'p2');

    const head = s.pending[0];
    expect(head?.kind).toBe('chooseCache');
    expect(head?.playerId).toBe('p1');
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'resources', resources: ['gold'] } });

    const after = playerOf(s, 'p1');
    expect(after.resources.gold).toBe(0); // the cached gold came out of the supply
    expect(after.caves[0]!.spaces[0]!.dragon!.cached).toEqual(['gold']);
    // "If you do, draw" — didPrecede was true, so a dragon card was drawn.
    expect(after.hand.filter(isDragonCard)).toHaveLength(1);
  });

  it('a declined once-per-round tuck does not pay the cost or lay the egg', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Guarding Horned Drake: "Tuck [DragonCard] from your hand here. If you
    // do, lay [Egg] here." — the tuck is a cost the owner may decline.
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 62, eggs: 0, tucked: [], cached: [] };
    p1.hand = [9];
    let s = passAndAnswer(st, 'p1');
    s = passAndAnswer(s, 'p2');

    const head = s.pending[0];
    expect(head?.kind).toBe('chooseTuck');
    if (head?.kind !== 'chooseTuck') throw new Error('unreachable');
    expect(head.upTo).toBe(true);
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'decline' } });

    const d = playerOf(s, 'p1').caves[0]!.spaces[0]!.dragon!;
    expect(d.tucked).toEqual([]);
    expect(d.eggs).toBe(0);
  });

  it('a performed once-per-round tuck lays the conditional egg', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 62, eggs: 0, tucked: [], cached: [] };
    p1.hand = [9];
    let s = passAndAnswer(st, 'p1');
    s = passAndAnswer(s, 'p2');

    expect(s.pending[0]?.kind).toBe('chooseTuck');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      answer: { kind: 'assignTucks', assignments: [{ cardId: 9, pos: [0, 0] }] },
    });
    // The tucked card paid off: now choose where the egg lands.
    expect(s.pending[0]?.kind).toBe('chooseEggSpot');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      answer: { kind: 'eggSpots', spots: [{ kind: 'dragon', pos: [0, 0] }] },
    });
    const d = playerOf(s, 'p1').caves[0]!.spaces[0]!.dragon!;
    expect(d.tucked).toEqual([9]);
    expect(d.eggs).toBe(1);
  });

  it('runs once-per-round abilities in turn order from the start player, with owner-chosen order', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    const p2 = playerOf(st, 'p2');
    // p1 has TWO once-per-round dragons; p2 has one.
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 138, eggs: 0, tucked: [], cached: [] }; // Oracular Dragon
    p1.caves[0]!.spaces[1]!.excavated = true;
    p1.caves[0]!.spaces[1]!.dragon = { cardId: 153, eggs: 0, tucked: [], cached: [] }; // Contrary Lung Dragon
    p2.caves[0]!.spaces[0]!.dragon = { cardId: 153, eggs: 0, tucked: [], cached: [] };
    let s = passAndAnswer(st, 'p1');
    s = passAndAnswer(s, 'p2');

    // p1 goes first (start player) and picks which dragon to activate.
    const head = s.pending[0];
    expect(head?.kind).toBe('oncePerRoundPick');
    if (head?.kind !== 'oncePerRoundPick') throw new Error('unreachable');
    expect(head.playerId).toBe('p1');
    expect(head.positions).toEqual([
      [0, 0],
      [0, 1],
    ]);
    // Pick the SECOND dragon (Contrary Lung Dragon): gains meat, may cache.
    const meatBefore = playerOf(s, 'p1').resources.meat;
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 1 } });
    expect(playerOf(s, 'p1').resources.meat).toBe(meatBefore + 1);
    expect(s.pending[0]?.kind).toBe('chooseCache');
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'decline' } });

    // The un-picked dragon is re-queued: Oracular Dragon lays an egg.
    expect(s.pending[0]?.kind).toBe('chooseEggSpot');
    expect(s.pending[0]?.playerId).toBe('p1');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      answer: { kind: 'eggSpots', spots: [{ kind: 'dragon', pos: [0, 0] }] },
    });
    expect(playerOf(s, 'p1').caves[0]!.spaces[0]!.dragon!.eggs).toBe(1);

    // Only then does p2's once-per-round ability run.
    expect(s.pending[0]?.kind).toBe('chooseCache');
    expect(s.pending[0]?.playerId).toBe('p2');
  });

  it('playDragonFree with discount "full" charges the printed cost', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Galvanic Wyrm (fully trained fledgling): "Play [DragonCard] from your
    // hand. Pay its printed costs."
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 272, eggs: 0, tucked: [], cached: [], training: 2 };
    p1.caves[0]!.spaces[1]!.excavated = true;
    p1.hand = [9]; // Melodious Firedragon: costs milk + egg
    p1.resources.milk = 1;
    p1.nestEggs = 1;
    let s = passAndAnswer(st, 'p1');
    s = passAndAnswer(s, 'p2');

    expect(s.pending[0]?.kind).toBe('choosePlayDragon');
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });

    const after = playerOf(s, 'p1');
    expect(after.caves[0]!.spaces[1]!.dragon?.cardId).toBe(9);
    expect(after.resources.milk).toBe(0); // printed milk paid
    expect(after.nestEggs).toBe(0); // printed egg paid from the mat
    expect(after.hand).not.toContain(9);
  });

  it('playDragonFree with an item discount lets the player pick what to waive', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 138, eggs: 0, tucked: [], cached: [] };
    p1.caves[0]!.spaces[1]!.excavated = true;
    p1.hand = [9]; // costs milk + egg
    p1.resources.milk = 1;
    p1.nestEggs = 1;
    // Cave cards 234-236: "Immediately play [DragonCard] with a discount of 1
    // [Egg] or [AnyResource]."
    st.pending = [
      {
        kind: 'choosePlayDragon',
        playerId: 'p1',
        source: 'handOrDisplay',
        discount: [[{ kind: 'egg', count: 1 }], [{ kind: 'resource', res: 'any', count: 1 }]],
      },
    ];
    let s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });

    const head = s.pending[0];
    expect(head?.kind).toBe('payDragonCost');
    if (head?.kind !== 'payDragonCost') throw new Error('unreachable');
    expect(head.options.map((o) => o.label)).toEqual(['discount 1 egg', 'discount 1 milk']);
    // Waive the egg: only the milk is charged.
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'option', index: 0 } });

    const after = playerOf(s, 'p1');
    expect(after.caves[0]!.spaces[1]!.dragon?.cardId).toBe(9);
    expect(after.resources.milk).toBe(0);
    expect(after.nestEggs).toBe(1); // egg was discounted away, not paid
  });

  it('guild tile squares reject a second marker (unlimited square excepted)', () => {
    const st = structuredClone(inMain());
    st.guild.tile = 'seafarers';
    st.guild.squares = GUILD_TILES.seafarers.squares.map(() => []);
    st.guild.squares[0] = ['p2'];
    st.guild.squares[4] = ['p2']; // the unlimited rectangle
    st.pending = [
      { kind: 'chooseGuildSquare', playerId: 'p1' },
      { kind: 'chooseGuildSquare', playerId: 'p1' },
    ];
    let s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });
    expect(s.guild.squares[0]).toEqual(['p2']); // square holds 1 marker
    expect(playerOf(s, 'p1').guildMarkersPlaced).toBe(0);
    // But the unlimited rectangle accepts a second player's marker.
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 4 } });
    expect(s.guild.squares[4]).toEqual(['p2', 'p1']);
    expect(playerOf(s, 'p1').guildMarkersPlaced).toBe(1);
  });

  it('egg-cost fledgling training boxes consume an egg from the mat', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Speckled Manta track is [Egg][Milk]: the first box costs an egg.
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 262, eggs: 0, tucked: [], cached: [], training: 0 };
    p1.nestEggs = 1;
    st.pending = [{ kind: 'chooseTrain', playerId: 'p1', times: 1, free: false, target: 'any', pos: [0, 0] }];
    const s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'dragon', pos: [0, 0] } });
    const after = playerOf(s, 'p1');
    expect(after.caves[0]!.spaces[0]!.dragon!.training).toBe(1);
    expect(after.nestEggs).toBe(0); // the egg box cost was actually paid
  });

  it('rejects a 4th explore of the same cave in a round and charges egg tiers', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    expect(exploreCost(p1, 0)).toEqual([{ kind: 'coin', count: 1 }]);
    p1.explores.crimson = 1;
    expect(exploreCost(p1, 0)).toEqual([
      { kind: 'coin', count: 1 },
      { kind: 'egg', count: 1 },
    ]);
    p1.explores.crimson = 2;
    expect(exploreCost(p1, 0)).toEqual([
      { kind: 'coin', count: 1 },
      { kind: 'egg', count: 2 },
    ]);
    p1.explores.crimson = 3; // 3rd entry is the max per round
    const s = applyAction(st, { type: 'explore', playerId: 'p1', cave: 0 });
    expect(playerOf(s, 'p1').explores.crimson).toBe(3);
    expect(s.log[s.log.length - 1]).toContain('3 times');
  });

  it('rejects resource exchange on another player\'s turn', () => {
    const st = structuredClone(inMain());
    expect(st.turn).toBe('p1');
    playerOf(st, 'p1').resources.meat = 2;
    playerOf(st, 'p2').resources.gold = 2;
    const goldBefore = playerOf(st, 'p1').resources.gold;
    let s = applyAction(st, { type: 'exchange', playerId: 'p2', give: ['gold', 'gold'], get: 'meat' });
    expect(playerOf(s, 'p2').resources.gold).toBe(2); // rejected
    s = applyAction(s, { type: 'exchange', playerId: 'p1', give: ['meat', 'meat'], get: 'gold' });
    expect(playerOf(s, 'p1').resources.meat).toBe(0);
    expect(playerOf(s, 'p1').resources.gold).toBe(goldBefore + 1);
  });

  it('ignore-cost entice still pays only the 1-coin action cost', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Two fledglings already on the mat satisfy the ignore-cost clause; card
    // 314's printed cost is exactly 1 coin — the bug charged 2 coins total.
    p1.caves[1]!.spaces[0]!.dragon = { cardId: 258, eggs: 0, tucked: [], cached: [], training: 0 };
    p1.caves[2]!.spaces[0]!.dragon = { cardId: 262, eggs: 0, tucked: [], cached: [], training: 0 };
    p1.hand = [314];
    p1.coins = 6;
    const s = applyAction(st, { type: 'entice', playerId: 'p1', cave: 0, cardId: 314 });
    const after = playerOf(s, 'p1');
    expect(after.coins).toBe(5);
    expect(after.coinsSpentEntice).toBe(1);
    expect(after.caves[0]!.spaces[0]!.dragon?.cardId).toBe(314);
  });

  it('activates the printed mat icon on the path segment before the stopping space', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 138, eggs: 0, tucked: [], cached: [] };
    p1.caves[0]!.spaces[1]!.excavated = true; // empty: the adventurer stops here
    const s = applyAction(st, { type: 'explore', playerId: 'p1', cave: 0 });
    // MAT_ICONS[0][1] ("gain any resource") is passed before reaching space 2.
    const head = s.pending[0];
    expect(head?.kind).toBe('chooseResource');
    expect(head?.playerId).toBe('p1');
  });

  it('AI chooseTrain counts training-track icons, not string length', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Hovering Polychromatic Stripling: 4-icon track, fully trained.
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 287, eggs: 0, tucked: [], cached: [], training: 4 };
    st.pending = [{ kind: 'chooseTrain', playerId: 'p1', times: 1, free: false, target: 'any' }];
    // A fully-trained fledgling is not a trainable target.
    expect(answerFor(st, 'p1')).toEqual({ kind: 'decline' });
  });

  it('pauses explore walk on mid-walk pending choices before resolving subsequent spaces', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Space 0: dragon 0 (White-Bellied Grazer, hatchling: cache 1 milk from supply -> gain 1 cave card).
    // Space 1: dragon 55 (Hoarding Flyer: Adventurer "Gain [Gold].").
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 0, eggs: 0, tucked: [], cached: [] };
    p1.caves[0]!.spaces[1]!.excavated = true;
    p1.caves[0]!.spaces[1]!.dragon = { cardId: 55, eggs: 0, tucked: [], cached: [] };
    p1.resources = { meat: 0, gold: 0, crystal: 0, milk: 0 };

    // Start exploring Crimson Cavern: MAT_ICONS[0][0] ("Gain [AnyResource]") queues chooseResource.
    let s = applyAction(st, { type: 'explore', playerId: 'p1', cave: 0 });
    expect(s.pending[0]?.kind).toBe('chooseResource');
    // Neither space 0's hatchling nor MAT_ICONS[0][1] (guild advance) nor space 1's Hoarding Flyer
    // should have executed yet!
    expect(s.guild.track.p1).toBe(0);
    expect(playerOf(s, 'p1').resources.gold).toBe(0);

    // Gain 1 milk from MAT_ICONS[0][0]; now space 0's hatchling queues chooseCache.
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'resources', resources: ['milk'] } });
    expect(s.pending[0]?.kind).toBe('chooseCache');
    expect(s.guild.track.p1).toBe(0);
    expect(playerOf(s, 'p1').resources.gold).toBe(0);

    // Cache the milk just gained on space 0 -> triggers hatchling recurring gain (1 cave card),
    // then walks over MAT_ICONS[0][1] (guild advance to space 1 = lay 1 egg -> chooseEggSpot).
    const cavesBefore = playerOf(s, 'p1').hand.filter((id) => !isDragonCard(id)).length;
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'resources', resources: ['milk'] } });
    expect(playerOf(s, 'p1').caves[0]!.spaces[0]!.dragon!.cached).toEqual(['milk']);
    expect(playerOf(s, 'p1').hand.filter((id) => !isDragonCard(id)).length).toBe(cavesBefore + 1);
    expect(s.guild.track.p1).toBe(1);
    expect(s.pending[0]?.kind).toBe('chooseEggSpot');
    // Space 1's Hoarding Flyer STILL hasn't granted its gold yet!
    expect(playerOf(s, 'p1').resources.gold).toBe(0);

    // Resolve the egg from guild track space 1 -> adventurer reaches space 1 (Hoarding Flyer: +1 gold)
    // and then MAT_ICONS[0][2] ("Gain [AnyResource]") before stopping at empty space 2.
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'eggSpots', spots: [{ kind: 'nest' }] } });
    expect(playerOf(s, 'p1').resources.gold).toBe(1);
    expect(s.pending[0]?.kind).toBe('chooseResource');
  });

  it('grants a resource from the tucked dragon\'s printed cost (matchTuckGainCost)', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Card 79 "Hawkish Firevern": "Tuck [DragonCard] from your hand here to gain
    // [AnyResource] of the cost printed on the tucked dragon."
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 79, eggs: 0, tucked: [], cached: [] };
    // Card 119 "Knowing Guardian" has cost { meat: 1, gold: 1 }.
    p1.hand = [119];
    p1.resources = { meat: 0, gold: 0, crystal: 0, milk: 0 };

    // Explore cave 0: resolve MAT_ICONS[0][0] first (pick crystal).
    let s = applyAction(st, { type: 'explore', playerId: 'p1', cave: 0 });
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'resources', resources: ['crystal'] } });

    // Now Hawkish Firevern prompts to tuck a dragon card from hand.
    expect(s.pending[0]?.kind).toBe('chooseTuck');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      answer: { kind: 'assignTucks', assignments: [{ cardId: 119, pos: [0, 0] }] },
    });

    // Tucked card 119 costs meat + gold -> chooseResource is restricted to ['meat', 'gold'].
    const head = s.pending[0];
    expect(head?.kind).toBe('chooseResource');
    if (head?.kind !== 'chooseResource') throw new Error('unreachable');
    expect(head.allowed).toEqual(['meat', 'gold']);

    // Picking gold grants 1 gold; trying to pick milk (not in allowed) clamps to allowed[0] ('meat').
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'resources', resources: ['gold'] } });
    expect(playerOf(s, 'p1').resources.gold).toBe(1);
  });

  it('deduplicates Dragon Academy replacement cards (5 dragons and cave cards 50 & 51)', () => {
    const baseGame = createGame({ seed: 10, expansions: ['base'] });
    const allBaseDragons = [
      ...baseGame.dragonDeck,
      ...baseGame.dragonDisplay.filter((c): c is number => c !== null),
      ...Object.values(baseGame.setupOffers).flat().filter(isDragonCard),
    ];
    const allBaseCaves = [
      ...baseGame.caveDeck,
      ...baseGame.caveDisplay.filter((c): c is number => c !== null),
      ...Object.values(baseGame.setupOffers).flat().filter((c) => !isDragonCard(c)),
    ];
    expect(allBaseDragons).toHaveLength(183);
    expect(allBaseCaves).toHaveLength(75);
    // Base game contains base Chameleon Coatl (id 118), not Academy Chameleon Coatyl (id 363).
    expect(allBaseDragons).toContain(118);
    expect(allBaseDragons).not.toContain(363);

    const acadGame = createGame({ seed: 10, expansions: ['base', 'academy'] });
    const allAcadDragons = [
      ...acadGame.dragonDeck,
      ...acadGame.dragonDisplay.filter((c): c is number => c !== null),
      ...Object.values(acadGame.setupOffers).flat().filter(isDragonCard),
    ];
    const allAcadCaves = [
      ...acadGame.caveDeck,
      ...acadGame.caveDisplay.filter((c): c is number => c !== null),
      ...Object.values(acadGame.setupOffers).flat().filter((c) => !isDragonCard(c)),
    ];
    // 183 base + 80 academy = 263 dragons; 75 base + 25 academy = 100 caves (no duplicate replacement copies).
    expect(allAcadDragons).toHaveLength(263);
    expect(allAcadCaves).toHaveLength(100);
    // Academy replacement ids (363..367 for dragons, 368..369 for caves) replace base ids (118, 123, 130, 131, 133, 232, 233).
    for (const repId of [363, 364, 365, 366, 367]) expect(allAcadDragons).toContain(repId);
    for (const oldId of [118, 123, 130, 131, 133]) expect(allAcadDragons).not.toContain(oldId);
    for (const repCaveId of [368, 369]) expect(allAcadCaves).toContain(repCaveId);
    for (const oldCaveId of [232, 233]) expect(allAcadCaves).not.toContain(oldCaveId);
  });

  it('implements all 5 Dragon Academy guild tiles (merchants, gamblers, kings, veterinary, magicians)', () => {
    // 1. Guild of Merchants: pay 1 coin, excavate 1 space free from hand and activate its ability 2x.
    {
      const st = structuredClone(inMain());
      st.guild.tile = 'merchants';
      st.guild.squares = GUILD_TILES.merchants.squares.map(() => []);
      const p1 = playerOf(st, 'p1');
      // Cave card 228 (number 46): "Gain [Meat][Milk]."
      p1.hand = [228];
      p1.coins = 2;
      p1.resources = { meat: 0, gold: 0, crystal: 0, milk: 0 };
      st.pending = [{ kind: 'chooseGuildSquare', playerId: 'p1' }];
      let s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });
      expect(s.pending[0]?.kind).toBe('choosePay');
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'option', index: 0 } });
      expect(s.pending[0]?.kind).toBe('chooseExcavate');
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });
      const after = playerOf(s, 'p1');
      expect(after.coins).toBe(1);
      expect(after.caves[0]!.spaces[1]!.excavated).toBe(true);
      // Activated 2x -> +2 meat and +2 milk!
      expect(after.resources.meat).toBe(2);
      expect(after.resources.milk).toBe(2);
    }

    // 2. King's Guild: pay 2 tithes (mixing 1 resource + 1 egg) for +8 end-game VP on square 3.
    {
      const st = structuredClone(inMain());
      st.guild.tile = 'kings';
      st.guild.squares = GUILD_TILES.kings.squares.map(() => []);
      const p1 = playerOf(st, 'p1');
      p1.resources = { meat: 1, gold: 0, crystal: 0, milk: 0 };
      p1.hand = [];
      p1.nestEggs = 1;
      st.pending = [{ kind: 'chooseGuildSquare', playerId: 'p1' }];
      let s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 3 } });
      expect(s.pending[0]?.kind).toBe('choosePay');
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'option', index: 0 } });
      const after = playerOf(s, 'p1');
      expect(after.resources.meat).toBe(0);
      expect(after.nestEggs).toBe(0);
      expect(s.guild.squares[3]).toEqual(['p1']);
    }

    // 3. Veterinary Guild: square 1 caches 2 from general supply across 2 dragons (1 each).
    {
      const st = structuredClone(inMain());
      st.guild.tile = 'veterinary';
      st.guild.squares = GUILD_TILES.veterinary.squares.map(() => []);
      const p1 = playerOf(st, 'p1');
      p1.caves[0]!.spaces[0]!.dragon = { cardId: 138, eggs: 0, tucked: [], cached: [] };
      p1.caves[1]!.spaces[0]!.dragon = { cardId: 55, eggs: 0, tucked: [], cached: [] };
      st.pending = [{ kind: 'chooseGuildSquare', playerId: 'p1' }];
      let s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 1 } });
      expect(s.pending[0]?.kind).toBe('chooseOption');
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'option', index: 0 } });
      expect(s.pending[0]?.kind).toBe('chooseCache');
      s = applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        answer: { kind: 'dragons', positions: [[0, 0], [1, 0]] },
      });
      const after = playerOf(s, 'p1');
      expect(after.caves[0]!.spaces[0]!.dragon!.cached).toHaveLength(1);
      expect(after.caves[1]!.spaces[0]!.dragon!.cached).toHaveLength(1);
    }

    // 4. Guild of Magicians: square 0 swaps a dragon on the mat with a dragon in hand, transferring contents,
    // and square 1 swaps an uncovered cave card on the mat with a cave card in hand.
    {
      const st = structuredClone(inMain());
      st.guild.tile = 'magicians';
      st.guild.squares = GUILD_TILES.magicians.squares.map(() => []);
      const p1 = playerOf(st, 'p1');
      p1.caves[0]!.spaces[0]!.dragon = { cardId: 138, eggs: 1, tucked: [9], cached: ['meat'] };
      p1.caves[0]!.spaces[1]!.excavated = true;
      p1.caves[0]!.spaces[1]!.caveCardId = 183;
      // Hand has dragon 55 (Hoarding Flyer, capacity 2) and cave 228 (Gain [Meat][Milk]).
      p1.hand = [55, 228];
      p1.coins = 2;
      p1.resources = { meat: 0, gold: 0, crystal: 0, milk: 0 };

      // Square 0: swap dragon 138 with dragon 55 from hand.
      st.pending = [{ kind: 'chooseGuildSquare', playerId: 'p1' }];
      let s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });
      expect(s.pending[0]?.kind).toBe('choosePay');
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'option', index: 0 } });
      expect(s.pending[0]?.kind).toBe('chooseHandDragonSwap');
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });
      let after = playerOf(s, 'p1');
      expect(after.caves[0]!.spaces[0]!.dragon?.cardId).toBe(55);
      expect(after.caves[0]!.spaces[0]!.dragon?.eggs).toBe(1);
      expect(after.caves[0]!.spaces[0]!.dragon?.tucked).toEqual([9]);
      expect(after.caves[0]!.spaces[0]!.dragon?.cached).toEqual(['meat']);
      expect(after.hand).toContain(138);

      // Square 1: swap uncovered cave card 183 at [0, 1] with cave card 228 from hand.
      s.pending = [{ kind: 'chooseGuildSquare', playerId: 'p1' }];
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 1 } });
      expect(s.pending[0]?.kind).toBe('chooseCaveCardSwap');
      s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 0 } });
      after = playerOf(s, 'p1');
      expect(after.caves[0]!.spaces[1]!.caveCardId).toBe(228);
      expect(after.hand).toContain(183);
      expect(after.resources.meat).toBe(1);
      expect(after.resources.milk).toBe(1);
    }

    // 5. Gambler's Guild: square 3 draws 4 dragon cards, scores printed VP on top 2, and discards all 4.
    {
      const st = structuredClone(inMain());
      st.guild.tile = 'gamblers';
      st.guild.squares = GUILD_TILES.gamblers.squares.map(() => []);
      const top4 = st.dragonDeck.slice(0, 4);
      const discardBefore = st.dragonDiscard.length;
      st.pending = [{ kind: 'chooseGuildSquare', playerId: 'p1' }];
      const s = applyAction(st, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'index', index: 3 } });
      expect(s.dragonDiscard.length).toBe(discardBefore + 4);
      for (const id of top4) expect(s.dragonDiscard).toContain(id);
      expect(s.guild.gamblerVp?.p1).toBeGreaterThanOrEqual(0);
    }
  });

  it('offers the 4th-column player-mat when-covered exchange (3 items -> 1 coin) on excavation', () => {
    const st = structuredClone(inMain());
    const p1 = playerOf(st, 'p1');
    // Pre-excavate columns 1, 2, 3 so column 4 (index 3) is the next empty space.
    p1.caves[0]!.spaces[1]!.excavated = true;
    p1.caves[0]!.spaces[1]!.caveCardId = 183;
    p1.caves[0]!.spaces[2]!.excavated = true;
    p1.caves[0]!.spaces[2]!.caveCardId = 184;
    // Cave card 231 (number 49): "Gain [Milk][Milk]." (synchronous).
    p1.hand = [231, 9];
    p1.coins = 2;
    p1.nestEggs = 2; // column 4 excavation costs 1 coin + 2 eggs
    p1.resources = { meat: 0, gold: 0, crystal: 0, milk: 0 };

    let s = applyAction(st, { type: 'excavate', playerId: 'p1', cave: 0, cardId: 231 });
    // Cave card 231 gave 2 milk, plus 1 dragon card (9) in hand = 3 items -> 4th-column choosePay offered!
    expect(s.pending[0]?.kind).toBe('choosePay');
    expect(playerOf(s, 'p1').coins).toBe(1);
    s = applyAction(s, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'option', index: 0 } });
    const after = playerOf(s, 'p1');
    expect(after.coins).toBe(2); // gained 1 coin from spending the 2 milk + 1 hand card
    expect(after.resources.milk).toBe(0);
    expect(after.hand).toHaveLength(0);
  });
});
