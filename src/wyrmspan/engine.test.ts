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
});
