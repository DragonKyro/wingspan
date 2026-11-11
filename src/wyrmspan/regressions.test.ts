// Regressions: the Academy "Play 1 for free and keep/discard the other N" draw
// abilities (cards 321 and 322, found by AI self-play fuzzing), an egg-target
// crash found by the benchmark heuristic, and a rules audit of decisions the
// engine used to make on the player's behalf.

import { describe, expect, it } from 'vitest';
import { CAVES, DRAGONS, isDragonCard } from './cards';
import { createGame } from './createGame';
import { applyAction } from './engine';
import { parseAbility } from './abilities';
import { runSteps } from './effects';
import { eggTargetSpots, hasAnyEggSpot, player } from './helpers';
import { aiPlay, toMain } from './testUtils';
import type { ChoiceAnswer, GameState, PendingStep, PlayedDragon, PlayerId, PlayerState } from './types';

/** Reach the 'main' phase of a fresh 2-player game. */
const inMain = (): GameState => toMain(createGame({ seed: 3, playerNames: ['P1', 'P2'] }));

const me = player;
const excavated = (s: GameState, pid: PlayerId) =>
  me(s, pid).caves.reduce((n, row) => n + row.spaces.filter((sp) => sp.excavated).length, 0);

function withStep(s: GameState, step: PendingStep): GameState {
  return { ...s, pending: [step, ...s.pending] };
}

describe('distributeCards "play 1 for free"', () => {
  it('"play 1 free and keep the other 2" excavates a drawn cave card instead of crashing', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const drawn = CAVES.slice(0, 3).map((c) => c.id);
    expect(drawn.some(isDragonCard)).toBe(false);
    const before = excavated(s0, pid);
    const s = applyAction(
      withStep(s0, { kind: 'distributeCards', playerId: pid, cardIds: drawn, keep: 2, playFree: 1 }),
      { type: 'resolveChoice', playerId: pid, answer: { kind: 'indexes', indexes: [0, 1, 2] } },
    );
    // The first card was played (excavated); the other two are kept in hand.
    expect(excavated(s, pid)).toBeGreaterThan(before);
    for (const id of drawn.slice(1)) expect(me(s, pid).hand).toContain(id);
    expect(me(s, pid).hand).not.toContain(drawn[0]);
  });

  it('honors the chosen index as the card played for free', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const drawn = CAVES.slice(0, 3).map((c) => c.id);
    const s = applyAction(
      withStep(s0, { kind: 'distributeCards', playerId: pid, cardIds: drawn, keep: 2, playFree: 1 }),
      { type: 'resolveChoice', playerId: pid, answer: { kind: 'indexes', indexes: [2] } },
    );
    expect(me(s, pid).hand).toContain(drawn[0]);
    expect(me(s, pid).hand).toContain(drawn[1]);
    expect(me(s, pid).hand).not.toContain(drawn[2]);
  });

  it('"play 1 free and discard the other 2" discards the rest instead of keeping them', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const drawn = DRAGONS.slice(0, 3).map((d) => d.id);
    const handBefore = me(s0, pid).hand.length;
    const discardBefore = s0.dragonDiscard.length;
    const s = applyAction(
      withStep(s0, { kind: 'distributeCards', playerId: pid, cardIds: drawn, playFree: 1, discard: 2 }),
      { type: 'resolveChoice', playerId: pid, answer: { kind: 'indexes', indexes: [0, 1, 2] } },
    );
    for (const id of drawn.slice(1)) {
      expect(me(s, pid).hand).not.toContain(id);
      expect(s.dragonDiscard).toContain(id);
    }
    expect(s.dragonDiscard.length).toBeGreaterThanOrEqual(discardBefore + 2);
    expect(me(s, pid).hand.length).toBeLessThanOrEqual(handBefore);
  });
});

// Found by the heuristic benchmark's lookahead: a "lay an egg here" step whose
// context is an empty space (cave-card effects run with the excavated space as
// their context) crashed eggTargetSpots on the missing dragon.
describe('egg targets on an empty context space', () => {
  it('an empty "here" space is no egg spot (and does not throw)', () => {
    const s = inMain();
    const p = me(s, s.turn);
    expect(p.caves[0].spaces[0].dragon).toBeNull();
    expect(eggTargetSpots(p, { kind: 'here' }, [0, 0])).toEqual([]);
    expect(hasAnyEggSpot(p, { kind: 'here' }, [0, 0])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rules audit: player decisions the engine used to make itself.

const dragon = (cardId: number, eggs = 0): PlayedDragon => ({ cardId, eggs, tucked: [], cached: [] });
const edit = (s: GameState, pid: PlayerId, f: (p: PlayerState) => void): GameState => {
  const p = structuredClone(me(s, pid));
  f(p);
  return { ...s, players: s.players.map((q) => (q.id === pid ? p : q)) };
};
const answer = (s: GameState, pid: PlayerId, a: ChoiceAnswer) => applyAction(s, { type: 'resolveChoice', playerId: pid, answer: a });

describe('rules audit: gaining cards', () => {
  it('"gain a card" offers each card from the display or the deck; "draw" goes straight to the hand', () => {
    const s0 = inMain();
    const pid = s0.turn;
    let s = runSteps(s0, [{ op: 'gain', items: [{ kind: 'card', deck: 'dragon', count: 2 }] }], { playerId: pid });
    expect(s.pending.map((p) => p.kind)).toEqual(['chooseDisplay', 'chooseDisplay']);
    expect(s.pending[0]).toMatchObject({ deck: 'dragon', orDeck: true });
    const faceUp = s.dragonDisplay[1]!;
    const top = s.dragonDeck[0]!;
    s = answer(s, pid, { kind: 'index', index: 1 }); // a face-up card
    s = answer(s, pid, { kind: 'decline' }); // the top of the deck
    expect(me(s, pid).hand).toEqual(expect.arrayContaining([faceUp, top]));

    const d = runSteps(s0, [{ op: 'gain', items: [{ kind: 'card', deck: 'dragon', count: 2, source: 'deck' }] }], { playerId: pid });
    expect(d.pending).toHaveLength(0);
    expect(me(d, pid).hand).toEqual(expect.arrayContaining(s0.dragonDeck.slice(0, 2)));
  });

  it('"from the display" is face-up only: declining it gains nothing', () => {
    const s0 = inMain();
    const pid = s0.turn;
    let s = runSteps(s0, [{ op: 'gain', items: [{ kind: 'card', deck: 'cave', count: 1, source: 'display' }] }], { playerId: pid });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseDisplay', orDeck: false });
    s = answer(s, pid, { kind: 'decline' });
    expect(me(s, pid).hand).toEqual(me(s0, pid).hand);
  });

  it('parses "Draw ... from the deck" as a deck draw and "Gain ..." as a choice', () => {
    const cardItems = (c: (typeof DRAGONS)[number]) =>
      parseAbility(c).steps.flatMap((st) => (st.op === 'gain' ? st.items : [])).filter((i) => i.kind === 'card');
    const draw = DRAGONS.find((d) => d.ability === 'Draw [DragonCard][CaveCard] from the deck.')!; // Northern Pane Dragon
    const gain = DRAGONS.find((d) => /^Gain \[DragonCard\]\./.test(d.ability ?? ''))!;
    expect(cardItems(draw).length).toBeGreaterThan(0);
    expect(cardItems(draw).every((i) => i.kind === 'card' && i.source === 'deck')).toBe(true);
    expect(cardItems(gain).every((i) => i.kind === 'card' && i.source === undefined)).toBe(true);
  });
});

describe('rules audit: paying costs your way', () => {
  it("4th-column exchange: the 3 items are the player's mix (here: hand cards, keeping resources)", () => {
    const s0 = inMain();
    const pid = s0.turn;
    const cards = [CAVES[20]!.id, DRAGONS[30]!.id, DRAGONS[31]!.id];
    let s = edit(s0, pid, (p) => {
      p.hand = [...cards];
      p.resources = { meat: 3, gold: 0, crystal: 0, milk: 0 };
    });
    s = runSteps(s, [{ op: 'pay', cost: [{ kind: 'item', count: 3 }], then: [{ op: 'gain', items: [{ kind: 'coin', count: 1 }] }] }], { playerId: pid });
    const coins = me(s, pid).coins;
    s = answer(s, pid, { kind: 'option', index: 0, payment: cards.map((cardId) => ({ kind: 'card' as const, cardId })) });
    expect(me(s, pid).coins).toBe(coins + 1);
    expect(me(s, pid).resources.meat).toBe(3);
    expect(me(s, pid).hand).toEqual([]);
    expect(s.caveDiscard).toContain(cards[0]);
    expect(s.dragonDiscard).toEqual(expect.arrayContaining(cards.slice(1)));
  });

  it('tithes may be paid with an egg, from the spot the player names', () => {
    const s0 = inMain();
    const pid = s0.turn;
    let s = edit(s0, pid, (p) => {
      p.nestEggs = 1;
      p.caves[1].spaces[0].dragon = dragon(DRAGONS.find((d) => d.capacity >= 2 && d.caves.includes('Golden Grotto'))!.id, 2);
      p.resources = { meat: 1, gold: 0, crystal: 0, milk: 0 };
    });
    s = runSteps(s, [{ op: 'pay', cost: [{ kind: 'tithe', count: 1 }], then: [{ op: 'gain', items: [{ kind: 'coin', count: 2 }] }] }], { playerId: pid });
    s = answer(s, pid, { kind: 'option', index: 0, payment: [{ kind: 'egg', spot: { kind: 'dragon', pos: [1, 0] } }] });
    expect(me(s, pid).resources.meat).toBe(1);
    expect(me(s, pid).nestEggs).toBe(1);
    expect(me(s, pid).caves[1].spaces[0].dragon!.eggs).toBe(1);
  });

  it('egg costs of turn actions come from the eggs the player names (here: the nest, not the dragon)', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const cave = CAVES[5]!.id;
    let s = edit(s0, pid, (p) => {
      p.caves[0].spaces[1] = { excavated: true, caveCardId: CAVES[6]!.id, dragon: null };
      p.caves[0].spaces[0].dragon = dragon(DRAGONS.find((d) => d.capacity >= 1 && d.caves.includes('Crimson Cavern'))!.id, 1);
      p.nestEggs = 1;
      p.hand = [cave];
      p.coins = 5;
    });
    // Column 3 costs 1 coin + 1 egg.
    s = applyAction(s, { type: 'excavate', playerId: pid, cave: 0, cardId: cave, payment: [{ kind: 'egg', spot: { kind: 'nest' } }] });
    expect(me(s, pid).caves[0].spaces[2].excavated).toBe(true);
    expect(me(s, pid).nestEggs).toBe(0);
    expect(me(s, pid).caves[0].spaces[0].dragon!.eggs).toBe(1);
  });
});

describe('rules audit: resource exchange at any point', () => {
  it('a "pay X" step is offered when an exchange makes it affordable, and the exchange works mid-choice', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const other = s0.playerOrder.find((x) => x !== pid)!;
    let s = edit(s0, pid, (p) => (p.resources = { meat: 0, gold: 2, crystal: 0, milk: 0 }));
    s = runSteps(s, [{ op: 'pay', cost: [{ kind: 'resource', res: 'meat', count: 1 }], then: [{ op: 'gain', items: [{ kind: 'coin', count: 1 }] }] }], { playerId: pid });
    expect(s.pending[0]?.kind).toBe('choosePay');
    // Only the deciding player may exchange.
    expect(applyAction(s, { type: 'exchange', playerId: other, give: ['gold', 'gold'], get: 'meat' })).toBe(s);
    s = applyAction(s, { type: 'exchange', playerId: pid, give: ['gold', 'gold'], get: 'meat' });
    expect(me(s, pid).resources).toMatchObject({ meat: 1, gold: 0 });
    const coins = me(s, pid).coins;
    s = answer(s, pid, { kind: 'option', index: 0 });
    expect(me(s, pid).coins).toBe(coins + 1);
    expect(me(s, pid).resources.meat).toBe(0);
  });
});

describe('rules audit: where free plays go', () => {
  it('a free play goes into the cave the player picks (leftmost space); illegal picks fall back', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const multi = DRAGONS.find((d) => d.caves.length === 3 && !d.abilityType.includes('WhenPlayed'))!.id;
    const base = edit(s0, pid, (p) => (p.hand = [multi]));
    const step: PendingStep = { kind: 'choosePlayDragon', playerId: pid, source: 'hand' };
    const s = answer({ ...base, pending: [step] }, pid, { kind: 'play', index: 0, pos: [2, 0] });
    expect(me(s, pid).caves[2].spaces[0].dragon?.cardId).toBe(multi);
    const bad = answer({ ...base, pending: [step] }, pid, { kind: 'play', index: 0, pos: [2, 3] });
    expect(me(bad, pid).caves[0].spaces[0].dragon?.cardId).toBe(multi); // default placement
  });

  it('"play 1 for free" with a cave card excavates the cave the player picks', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const drawn = CAVES.slice(30, 33).map((c) => c.id);
    const s = answer(
      { ...s0, pending: [{ kind: 'distributeCards', playerId: pid, cardIds: drawn, playFree: 1, discard: 2 }] },
      pid,
      { kind: 'play', index: 1, pos: [2, 1] },
    );
    expect(me(s, pid).caves[2].spaces[1]).toMatchObject({ excavated: true, caveCardId: drawn[1] });
    expect(me(s, pid).caves[0].spaces[1].excavated).toBe(false);
  });
});

describe('rules audit: tucks and caches', () => {
  it('"keep 1, discard 1, tuck 1 under any dragon": the player picks the tucked card and the dragon', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const a = DRAGONS.find((d) => d.caves.includes('Crimson Cavern'))!.id;
    const b = DRAGONS.find((d) => d.caves.includes('Golden Grotto') && d.id !== a)!.id;
    const base = edit(s0, pid, (p) => {
      p.caves[0].spaces[0].dragon = dragon(a);
      p.caves[1].spaces[0].dragon = dragon(b);
    });
    const drawn = DRAGONS.slice(100, 103).map((d) => d.id);
    const s = answer(
      { ...base, pending: [{ kind: 'distributeCards', playerId: pid, cardIds: drawn, keep: 1, tuck: 1, discard: 1, tuckTarget: { kind: 'any' } }] },
      pid,
      { kind: 'indexes', indexes: [0], tucks: [{ index: 2, pos: [1, 0] }] },
    );
    expect(me(s, pid).hand).toContain(drawn[0]);
    expect(me(s, pid).caves[1].spaces[0].dragon!.tucked).toEqual([drawn[2]]);
    expect(me(s, pid).caves[0].spaces[0].dragon!.tucked).toEqual([]);
    expect(s.dragonDiscard).toContain(drawn[1]);
  });

  it("Machiavelli's Dragon tucks up to 2 cards from the hand per SHY dragon (not free cards from the deck)", () => {
    const s0 = inMain();
    const pid = s0.turn;
    const mach = DRAGONS.find((d) => d.name.startsWith('Machiavelli'))!;
    const shy = DRAGONS.filter((d) => d.personality === 'Shy' && d.caves.includes('Golden Grotto') && d.id !== mach.id).slice(0, 2);
    const hand = DRAGONS.slice(120, 123).map((d) => d.id);
    let s = edit(s0, pid, (p) => {
      p.caves[1].spaces[0].dragon = dragon(shy[0]!.id);
      p.caves[1].spaces[1] = { excavated: true, caveCardId: CAVES[1]!.id, dragon: dragon(shy[1]!.id) };
      p.caves[1].spaces[2] = { excavated: true, caveCardId: CAVES[2]!.id, dragon: dragon(mach.id) };
      p.hand = [...hand];
    });
    const deck = s.dragonDeck.length;
    s = runSteps(s, parseAbility(mach).steps, { playerId: pid, dragon: [1, 2] });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseTuck', from: 'hand', upTo: true });
    s = answer(s, pid, { kind: 'assignTucks', assignments: hand.slice(0, 2).map((cardId) => ({ cardId, pos: [1, 0] as [number, number] })) });
    s = answer(s, pid, { kind: 'decline' }); // nothing under the second SHY dragon
    expect(me(s, pid).caves[1].spaces[0].dragon!.tucked).toEqual(hand.slice(0, 2));
    expect(me(s, pid).caves[1].spaces[1].dragon!.tucked).toEqual([]);
    expect(me(s, pid).hand).toEqual([hand[2]]);
    expect(s.dragonDeck.length).toBe(deck);
  });

  it('"cache up to N" may cache fewer', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const d = DRAGONS.find((x) => x.caves.includes('Crimson Cavern'))!.id;
    let s = edit(s0, pid, (p) => {
      p.caves[0].spaces[0].dragon = dragon(d);
      p.resources = { meat: 2, gold: 1, crystal: 0, milk: 0 };
    });
    s = runSteps(s, [{ op: 'cache', count: 2, res: 'any', from: 'supply', target: { kind: 'any' }, upTo: true }], { playerId: pid });
    s = answer(s, pid, { kind: 'dragons', positions: [[0, 0]], resources: ['gold'] });
    expect(me(s, pid).caves[0].spaces[0].dragon!.cached).toEqual(['gold']);
    expect(me(s, pid).resources).toMatchObject({ meat: 2, gold: 0 });
  });
});

describe('rules audit: laying eggs is the layer\'s choice', () => {
  it('"each opponent lays an egg" lets each opponent place it', () => {
    const s0 = inMain();
    const pid = s0.turn;
    const other = s0.playerOrder.find((x) => x !== pid)!;
    const s = runSteps(s0, [{ op: 'opponentsGain', items: [{ kind: 'egg', count: 1 }] }], { playerId: pid });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseEggSpot', playerId: other, count: 1 });
  });

  it("the base game's round-upkeep egg is placed by each player, in turn order from the start player", () => {
    let s = toMain(createGame({ seed: 5, playerNames: ['P1', 'P2'], expansions: ['base'] }));
    s = aiPlay(s, (t) => t.round >= 2);
    expect(s.round).toBe(2);
    const eggSteps = s.pending.filter((p) => p.kind === 'chooseEggSpot');
    expect(eggSteps.length).toBeGreaterThan(0);
    expect(eggSteps[0]!.playerId).toBe(s.startPlayer);
  });
});
