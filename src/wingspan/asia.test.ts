// Wingspan Asia coverage: the new power mechanics (compound pending steps,
// neighbour interactions, resource payments, rerolls), plus duet and flock
// modes end-to-end.

import { describe, expect, it } from 'vitest';
import { chooseAction } from '@/wingspan/ai/chooseAction';
import { bird, BIRDS } from './cards';
import { createGame } from './createGame';
import { applyAction } from './engine';
import {
  actingPlayerId,
  autoPayBird,
  getPlayer,
  playedBirds,
  totalEggs,
  totalFood,
} from './helpers';
import { firePinkTriggers, hasPowerImpl, runPower } from './powers';
import { bonusCardVp } from './scoring';
import type { GameState } from './types';
import { autoResolve, autoSetup, edit, gameFactory, mkBird, ref } from './testUtils';

const COLORS = ['red', 'blue', 'orange', 'white', 'purple', 'pink', 'teal'] as const;

// asia card ids used below (see src/wingspan/data/birds.json).
const ASIAN_KOEL = 359; // pink: egg on another platform bird, +3 over limit.
const BEARDED_REEDLING = 362; // teal: egg per other column bird with eggs.
const BLACK_DRONGO = 363; // discard tray cards; if a grassland bird → lay 1 egg.
const BLACK_STORK = 364; // teal: egg on each bird immediately left/right.
const BLACK_NAPED_ORIOLE = 365; // teal: all 4 action types → wild + egg + card.
const BLUE_ROCK_THRUSH = 366; // brown: move (card only) to left neighbour's mat.
const COMMON_TAILORBIRD = 374; // yellow: egg on largest same-nest group.
const EURASIAN_EAGLE_OWL = 382; // brown: draw up to 3, tuck if wingspan < 110.
const EURASIAN_HOOPOE = 383; // white: steal 1 inv from each neighbour.
const FOREST_OWLET = 388; // brown: risky roll (2 dice, inv/rodent).
const GOLDEN_PHEASANT = 389; // white: all lay 2 eggs, you lay 2 extra.
const GREAT_INDIAN_BUSTARD = 395; // white: score a bonus card now (seed caches).
const GREATER_ADJUTANT = 397; // yellow: copy a bonus card of the left player.
const HOUSE_CROW = 401; // teal: may cache 1 wild on each bird in this row.
const MANDARIN_DUCK = 409; // teal: draw 5 → 1 hand, 1 tuck, 1 given, rest off.
const PHILIPPINE_EAGLE = 413; // teal: reroll feeder up to 2×, ≥3 rodents → bonus.
const RED_AVADAVAT = 416; // brown: give 1 hand card away → draw 2.
const ROSE_RINGED_PARAKEET = 424; // white: copy a neighbour's when-played power.
const SMEW = 431; // white: draw 4, tuck 2, keep 2.
const VIOLET_CUCKOO = 440; // pink: egg on another wingspan<30 bird, +2 over.
const WOODCOCK = 13; // core, no power, ground nest.
const KILLDEER = 19; // Baird's Sparrow — core, ground nest, ws 23.
const AMERICAN_COOT = 5; // core platform nest, egg limit 5.

const newGame = gameFactory(['core', 'asia']);

const mainGame = (seed = 42): GameState => {
  const s = autoSetup(newGame(seed));
  return { ...s, phase: 'main', currentPlayerIndex: 0, turnTookAction: false };
};

describe('asia powers', () => {
  it('Golden Pheasant: everyone lays 2 eggs, the actor lays 2 more', () => {
    let s = mainGame();
    s = edit(s, 'p1', { board: { forest: [mkBird(GOLDEN_PHEASANT), mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    s = edit(s, 'p2', { board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseBirdForEgg');
    s = autoResolve(s);
    expect(totalEggs(getPlayer(s, 'p1'))).toBe(4);
    expect(totalEggs(getPlayer(s, 'p2'))).toBe(2);
  });

  it('Eurasian Hoopoe: steals an invertebrate from a neighbour, who then gains a wild', () => {
    let s = mainGame();
    s = edit(s, 'p1', { board: { forest: [mkBird(EURASIAN_HOOPOE)], grassland: [], wetland: [] } });
    s = edit(s, 'p2', { food: { ...getPlayer(s, 'p2').food, invertebrate: 1 } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(getPlayer(s, 'p2').food.invertebrate).toBe(0);
    expect(getPlayer(s, 'p1').food.invertebrate).toBeGreaterThanOrEqual(1);
    // The victim is offered a replacement wild food.
    expect(s.pending.some((st) => st.kind === 'chooseSupplyFood' && st.playerId === 'p2')).toBe(true);
    s = autoResolve(s);
    expect(totalFood(getPlayer(s, 'p2'))).toBeGreaterThanOrEqual(1);
  });

  it('Smew: draws 4, tucks 2 behind itself and keeps the other 2', () => {
    let s = mainGame();
    const handBefore = getPlayer(s, 'p1').hand.length;
    s = edit(s, 'p1', { board: { forest: [], grassland: [], wetland: [mkBird(SMEW)] } });
    s = runPower(s, 'p1', ref('wetland', 0));
    expect(s.pending[0]?.kind).toBe('choosePoolTuck');
    s = autoResolve(s);
    const b = getPlayer(s, 'p1').board.wetland[0]!;
    expect(b.tucked.length).toBe(2);
    expect(getPlayer(s, 'p1').hand.length).toBe(handBefore + 2);
  });

  it('Philippine Eagle: rerolls feeder dice then resets the birdfeeder', () => {
    let s = mainGame();
    s = edit(s, 'p1', { board: { forest: [mkBird(PHILIPPINE_EAGLE)], grassland: [], wetland: [] } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseReroll');
    s = autoResolve(s);
    expect(s.pending.length).toBe(0);
    expect(s.feederIn.length).toBe(5);
  });

  it('Eurasian Eagle-Owl: draws up to 3 and tucks/discards the pool', () => {
    let s = mainGame();
    // Seed the deck with tiny birds: 3 drawn hummingbirds (8cm each) total
    // 24cm < 110, so the whole pool tucks behind the owl.
    s = { ...s, deck: [36, 36, 36] };
    s = edit(s, 'p1', { board: { forest: [mkBird(EURASIAN_EAGLE_OWL)], grassland: [], wetland: [] } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('drawUpTo');
    s = autoResolve(s);
    const b = getPlayer(s, 'p1').board.forest[0]!;
    expect(b.tucked).toEqual([36, 36, 36]);
    expect(s.pending.length).toBe(0);
  });

  it('Blue Rock-Thrush: moves the card to the left neighbour’s board and draws 3', () => {
    let s = mainGame();
    s = edit(s, 'p1', {
      board: { forest: [mkBird(BLUE_ROCK_THRUSH)], grassland: [], wetland: [] },
      hand: [],
    });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('moveBirdToPlayer');
    s = autoResolve(s);
    expect(playedBirds(getPlayer(s, 'p1')).length).toBe(0);
    expect(playedBirds(getPlayer(s, 'p2')).some(({ bird: b }) => b.cardId === BLUE_ROCK_THRUSH)).toBe(true);
    expect(getPlayer(s, 'p1').hand.length).toBe(3);
  });

  it('Red Avadavat: gives a hand card to another player and draws 2', () => {
    let s = mainGame();
    s = edit(s, 'p1', {
      board: { forest: [mkBird(RED_AVADAVAT)], grassland: [], wetland: [] },
      hand: [WOODCOCK],
    });
    const p2Hand = getPlayer(s, 'p2').hand.length;
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseHandPick');
    s = autoResolve(s);
    expect(getPlayer(s, 'p2').hand.length).toBe(p2Hand + 1);
    expect(getPlayer(s, 'p2').hand).toContain(WOODCOCK);
    // Net: gave 1, drew 2.
    expect(getPlayer(s, 'p1').hand.length).toBe(2);
  });

  it('Great Indian Bustard: scores a bonus card now as seed caches', () => {
    let s = mainGame();
    const p1 = getPlayer(s, 'p1');
    const bonusId = p1.bonusHand[0]!;
    const vp = bonusCardVp(p1, bonusId);
    s = edit(s, 'p1', { board: { forest: [mkBird(GREAT_INDIAN_BUSTARD)], grassland: [], wetland: [] } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseBonusCards');
    s = autoResolve(s);
    const b = getPlayer(s, 'p1').board.forest[0]!;
    expect(b.cached.length).toBe(vp);
    expect(b.cached.every((f) => f === 'seed')).toBe(true);
    // The card stays in the bonus hand (scored again at game end).
    expect(getPlayer(s, 'p1').bonusHand).toContain(bonusId);
  });

  it('House Crow: may cache 1 wild on each bird in its row', () => {
    let s = mainGame();
    s = edit(s, 'p1', {
      board: { forest: [mkBird(HOUSE_CROW), mkBird(WOODCOCK)], grassland: [], wetland: [] },
      food: { ...getPlayer(s, 'p1').food, seed: 3 },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending.length).toBe(2);
    s = autoResolve(s);
    const row = getPlayer(s, 'p1').board.forest;
    expect(row[0]!.cached.length + row[1]!.cached.length).toBe(2);
  });

  it('Bearded Reedling: lays 1 egg per other column bird with eggs', () => {
    let s = mainGame();
    s = edit(s, 'p1', {
      board: {
        forest: [mkBird(BEARDED_REEDLING)],
        grassland: [mkBird(WOODCOCK, { eggs: 1 })],
        wetland: [mkBird(WOODCOCK)],
      },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(getPlayer(s, 'p1').board.forest[0]!.eggs).toBe(1);
  });

  it('Greater Adjutant: copies a bonus card from the player on the left', () => {
    let s = mainGame();
    s = edit(s, 'p1', { board: { forest: [mkBird(GREATER_ADJUTANT)], grassland: [], wetland: [] } });
    s = edit(s, 'p2', { bonusHand: [1000, 1001] });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseBonusCards');
    s = autoResolve(s);
    expect(getPlayer(s, 'p1').copiedBonus.length).toBe(1);
    expect(getPlayer(s, 'p2').bonusHand.length).toBe(2); // only copied
  });

  it('Rose-Ringed Parakeet: copies a neighbour’s when-played power', () => {
    let s = mainGame();
    s = edit(s, 'p1', { board: { forest: [mkBird(ROSE_RINGED_PARAKEET)], grassland: [], wetland: [] } });
    s = edit(s, 'p2', { board: { forest: [mkBird(GOLDEN_PHEASANT), mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseCopyPlayed');
    s = autoResolve(s);
    // The copied Golden Pheasant power ran for p1: both players lay eggs.
    expect(totalEggs(getPlayer(s, 'p1'))).toBeGreaterThanOrEqual(1);
    expect(totalEggs(getPlayer(s, 'p2'))).toBe(2);
  });

  it('Black Drongo: lays an egg when a discarded tray bird is a grassland bird', () => {
    let s = mainGame();
    // Force the tray to hold a grassland bird (Woodcock lives in grassland? no — use a known grassland card).
    const grasslandId = (s.deck.find((id) => bird(id).habitats.includes('grassland')))!;
    s = { ...s, tray: [grasslandId, null, null], deck: s.deck.filter((id) => id !== grasslandId) };
    s = edit(s, 'p1', { board: { forest: [mkBird(BLACK_DRONGO)], grassland: [], wetland: [] } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('chooseTrayDiscard');
    s = autoResolve(s);
    expect(getPlayer(s, 'p1').board.forest[0]!.eggs).toBe(1);
    expect(s.tray.every((id) => id != null)).toBe(true); // refilled
  });

  it('Black-Naped Oriole: rewards using all 4 action types', () => {
    let s = mainGame();
    s = edit(s, 'p1', {
      board: { forest: [mkBird(BLACK_NAPED_ORIOLE)], grassland: [], wetland: [] },
      roundCubes: { forest: 1, grassland: 1, wetland: 1, playBird: 1 },
    });
    const handBefore = getPlayer(s, 'p1').hand.length;
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending.length).toBe(2); // wild food + egg pick
    s = autoResolve(s);
    expect(getPlayer(s, 'p1').hand.length).toBe(handBefore + 1);
    expect(totalEggs(getPlayer(s, 'p1'))).toBe(1);
  });

  it('Black-Naped Oriole: no reward without all 4 action types', () => {
    let s = mainGame();
    s = edit(s, 'p1', {
      board: { forest: [mkBird(BLACK_NAPED_ORIOLE)], grassland: [], wetland: [] },
      roundCubes: { forest: 1, grassland: 0, wetland: 1, playBird: 1 },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending.length).toBe(0);
  });

  it('Forest Owlet: risky roll caches on a hit or ends cleanly', () => {
    let s = mainGame();
    s = edit(s, 'p1', { board: { forest: [mkBird(FOREST_OWLET)], grassland: [], wetland: [] } });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]?.kind).toBe('confirm');
    s = autoResolve(s);
    expect(s.pending.length).toBe(0);
  });

  it('Mandarin Duck: draw 5 → hand 1, tuck 1, give 1, discard rest', () => {
    let s = mainGame();
    const handBefore = getPlayer(s, 'p1').hand.length;
    const p2Hand = getPlayer(s, 'p2').hand.length;
    s = edit(s, 'p1', { board: { forest: [], grassland: [mkBird(MANDARIN_DUCK)], wetland: [] } });
    s = runPower(s, 'p1', ref('grassland', 0));
    s = autoResolve(s);
    expect(getPlayer(s, 'p1').board.grassland[0]!.tucked.length).toBe(1);
    expect(getPlayer(s, 'p2').hand.length).toBe(p2Hand + 1);
    expect(getPlayer(s, 'p1').hand.length).toBe(handBefore + 1);
  });

  it('Black Stork: lays an egg on each bird immediately left and right', () => {
    let s = mainGame();
    s = edit(s, 'p1', {
      board: {
        forest: [mkBird(WOODCOCK), mkBird(BLACK_STORK), mkBird(KILLDEER)],
        grassland: [],
        wetland: [],
      },
    });
    s = runPower(s, 'p1', ref('forest', 1));
    const row = getPlayer(s, 'p1').board.forest;
    expect(row[0]!.eggs).toBe(1);
    expect(row[2]!.eggs).toBe(1);
    expect(row[1]!.eggs).toBe(0);
  });

  it('Common Tailorbird: lays eggs on the largest same-nest group', () => {
    let s = mainGame();
    const bowl = (id: number) => mkBird(id, { eggs: 0 });
    // WOODCOCK nest = platform; KILLDEER nest = bowl.
    s = edit(s, 'p1', {
      board: {
        forest: [mkBird(COMMON_TAILORBIRD)],
        grassland: [bowl(KILLDEER), bowl(KILLDEER), mkBird(WOODCOCK)],
        wetland: [],
      },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    const p1 = getPlayer(s, 'p1');
    const eggs = playedBirds(p1).reduce((n, { bird: b }) => n + b.eggs, 0);
    expect(eggs).toBeGreaterThan(0);
  });

  it('Asian Koel pink: lays an egg on another platform bird over the limit', () => {
    let s = mainGame();
    s = edit(s, 'p2', {
      board: {
        forest: [mkBird(ASIAN_KOEL), mkBird(AMERICAN_COOT, { eggs: bird(AMERICAN_COOT).eggLimit })],
        grassland: [],
        wetland: [],
      },
    });
    // p1 takes a lay-eggs action: trigger fires for p2's koel.
    s = firePinkTriggers(s, 'p1', { kind: 'layEggs' });
    expect(s.pending[0]?.kind).toBe('chooseBirdForEgg');
    s = autoResolve(s);
    // The egg lands on the platform bird, 1 over its printed egg limit.
    const row = getPlayer(s, 'p2').board.forest;
    expect(row[1]!.eggs).toBe(bird(AMERICAN_COOT).eggLimit + 1);
  });

  it('Violet Cuckoo pink: lays an egg on a small-wingspan bird', () => {
    let s = mainGame();
    // Woodcock has wingspan 66 — too big. Find a small bird for the target.
    const small = BIRDS.find((b) => b.set === 'core' && typeof b.wingspan === 'number' && b.wingspan < 30)!;
    s = edit(s, 'p2', {
      board: {
        forest: [mkBird(VIOLET_CUCKOO), mkBird(small.id, { eggs: small.eggLimit })],
        grassland: [],
        wetland: [],
      },
    });
    s = firePinkTriggers(s, 'p1', { kind: 'layEggs' });
    expect(s.pending[0]?.kind).toBe('chooseBirdForEgg');
    s = autoResolve(s);
    const row = getPlayer(s, 'p2').board.forest;
    expect(row[1]!.eggs).toBe(small.eggLimit + 1);
  });

  it('has implementations for every asia power text', () => {
    const missing = BIRDS.filter((b) => b.set === 'asia' && b.powerText && !hasPowerImpl(b.id));
    expect(missing.map((b) => `${b.id} ${b.name}`)).toEqual([]);
  });
});

describe('duet mode', () => {
  const newDuet = (seed = 7) =>
    createGame({
      playerNames: ['A', 'B'],
      playerTypes: ['ai', 'ai'],
      playerColors: ['red', 'blue'],
      seed,
      settings: { sets: ['core', 'asia'], mode: 'duet' },
    });

  it('creates a 36-space map and duet goal tiles', () => {
    const s = newDuet();
    expect(s.duet).toBeTruthy();
    expect(s.duet!.map.length).toBe(36);
    expect(s.duet!.map.every((x) => x == null)).toBe(true);
    expect(s.goalTiles.length).toBe(4);
    expect(s.settings.mode).toBe('duet');
  });

  it('places a duet token when a bird is played', () => {
    let s = autoSetup(newDuet());
    const pid = actingPlayerId(s);
    // Give enough food/eggs to pay anything.
    s = edit(s, pid as `p${number}`, {
      food: { invertebrate: 9, seed: 9, fish: 9, fruit: 9, rodent: 9, nectar: 0 },
    });
    const p = getPlayer(s, pid);
    const playable = p.hand.find((id) => autoPayBird(getPlayer(s, pid), id) != null);
    expect(playable).toBeDefined();
    const card = bird(playable!);
    const habitat = card.habitats[0]!;
    const pay = autoPayBird(getPlayer(s, pid), playable!)!;
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: playable!,
      habitat,
      eggPayments: [],
      foodPayments: pay.foodPayments,
      cachedFoodPayments: pay.cachedFoodPayments,
      cardPayments: pay.cardPayments,
    });
    expect(s.pending[0]?.kind).toBe('chooseDuetSpace');
    s = autoResolve(s);
    expect(s.duet!.map.some((x) => x === pid)).toBe(true);
  });

  it('plays a full duet game deterministically to game over', () => {
    const run = (seed: number) => {
      let s = newDuet(seed);
      let guard = 0;
      while (s.phase !== 'gameOver' && guard++ < 6000) {
        const head = s.pending[0];
        const pid = head?.playerId ?? (s.phase === 'setup' ? s.setupRemaining[0] : actingPlayerId(s));
        if (!pid) break;
        const a = chooseAction(s, pid);
        if (!a) break;
        s = applyAction(s, a);
      }
      return s;
    };
    const s1 = run(31);
    const s2 = run(31);
    expect(s1.phase).toBe('gameOver');
    expect(JSON.stringify(s1)).toBe(JSON.stringify(s2));
    expect(s1.duet!.map.some((x) => x != null)).toBe(true);
    expect(s1.goalScores.length).toBe(4);
    expect(s1.finalScores).not.toBeNull();
  });
});

describe('flock mode', () => {
  it('plays a 6-player game to completion', () => {
    let s = createGame({
      playerNames: ['A', 'B', 'C', 'D', 'E', 'F'],
      playerTypes: ['ai', 'ai', 'ai', 'ai', 'ai', 'ai'],
      playerColors: [...COLORS],
      seed: 11,
      settings: { sets: ['core', 'asia'], mode: 'flock' },
    });
    expect(s.settings.mode).toBe('flock');
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 12000) {
      const head = s.pending[0];
      const pid = head?.playerId ?? (s.phase === 'setup' ? s.setupRemaining[0] : actingPlayerId(s));
      if (!pid) break;
      const a = chooseAction(s, pid);
      if (!a) break;
      s = applyAction(s, a);
    }
    expect(s.phase).toBe('gameOver');
    expect(s.goalScores.length).toBe(4);
    expect(s.finalScores).not.toBeNull();
  });
});
