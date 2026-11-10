import { describe, expect, it } from 'vitest';
import { chooseAction } from './ai';
import {
  AUTOMA_CARDS,
  AUTOMA_CARD_IDS,
  automaCardIdsForConfig,
  computeAutomaGuildSteps,
  placeAutomaGuildMarker,
} from './automa';
import { createGame, type CreateGameOptions } from './createGame';
import { applyAction } from './engine';
import { GUILD_TILES } from './guild';
import {
  AUTOMA_OBJECTIVE_BASE,
  AUTOMA_OBJECTIVE_MAX,
  OBJECTIVE_IDS,
  automaObjectiveUnits,
  scoreObjective,
} from './objectives';
import { scoreGame, scorePlayer } from './scoring';
import type { AutomaCardId, GameState, PlayerId } from './types';

function inAutomaMain(opts: CreateGameOptions = {}): GameState {
  let s = createGame({ seed: 11, playerNames: ['Solo'], automa: { difficulty: 1 }, ...opts });
  while (s.pending.length) {
    const pid = s.pending[0]!.playerId;
    s = applyAction(s, chooseAction(s, pid)!);
  }
  expect(s.phase).toBe('main');
  return s;
}

function playAutomaGame(seed: number, opts: CreateGameOptions = {}): GameState {
  let s = createGame({
    seed,
    playerNames: ['Solo'],
    automa: { difficulty: 1 },
    ...opts,
  });
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
    const a = chooseAction(s, s.turn);
    if (!a) throw new Error(`AI stuck on turn ${s.turn} round ${s.round}`);
    s = applyAction(s, a);
  }
  expect(s.phase).toBe('gameEnd');
  return s;
}

function playerOf(s: GameState, pid: PlayerId) {
  return s.players.find((p) => p.id === pid)!;
}

describe('wyrmspan automa — deck & setup', () => {
  it('defines all 16 official Automa decision cards', () => {
    expect(AUTOMA_CARD_IDS).toHaveLength(16);
    const expected: AutomaCardId[] = [
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '1/4',
      '2/5',
      '3/6',
      'R1/4',
      'R2',
      'R2/5',
      'R3/6',
      'R8',
    ];
    expect(new Set(AUTOMA_CARD_IDS)).toEqual(new Set(expected));
  });

  it('constructs the exact 8-card sets for Difficulty 1/2/3 and Ravel Mode 1/2/3', () => {
    // Base Automa (dragon_automa_p02.png)
    expect(automaCardIdsForConfig(1, false)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(automaCardIdsForConfig(2, false)).toEqual(['1/4', '2/5', '3/6', '4', '5', '6', '7', '8']);
    expect(automaCardIdsForConfig(3, false)).toEqual(['1', '2', '3', '1/4', '2/5', '3/6', '7', '8']);

    // Ravel Mode (dragon_automa_p06.png)
    expect(automaCardIdsForConfig(1, true)).toEqual(['R1/4', 'R2', 'R3/6', '4', '5', '6', '7', 'R8']);
    expect(automaCardIdsForConfig(2, true)).toEqual(['1', '2', '3', 'R1/4', 'R2/5', 'R3/6', '7', 'R8']);
    expect(automaCardIdsForConfig(3, true)).toEqual(['R1/4', 'R2/5', 'R3/6', '1/4', '2/5', '3/6', '7', 'R8']);
  });

  it('sets up a 1-player Automa game with 7 active cards + 1 set aside, p1-only setup, and no guildMarkers objective', () => {
    for (const ravelMode of [false, true]) {
      for (const difficulty of [1, 2, 3] as const) {
        const s = createGame({
          seed: 100 + difficulty,
          playerNames: ['Alice'],
          expansions: ['base'],
          automa: { difficulty, ravelMode },
        });
        expect(s.players).toHaveLength(2);
        expect(s.players[0]!.name).toBe('Alice');
        expect(s.players[1]!.id).toBe('p2');
        expect(s.players[1]!.name).toBe('Automa');
        expect(s.players[1]!.isAI).toBe(true);
        expect(s.players[1]!.coins).toBe(0);
        expect(s.players[1]!.nestEggs).toBe(0);

        // Only p1 has setup pending steps.
        expect(s.pending.map((p) => ({ kind: p.kind, playerId: p.playerId }))).toEqual([
          { kind: 'setupCards', playerId: 'p1' },
          { kind: 'setupResources', playerId: 'p1' },
        ]);
        expect(s.setupOffers.p2).toBeUndefined();

        // 7 active cards + 1 set aside = the 8 configured cards.
        expect(s.automa).toBeDefined();
        expect(s.automa!.deck).toHaveLength(7);
        expect(s.automa!.setAside).not.toBeNull();
        const combined = [...s.automa!.deck, s.automa!.setAside!];
        expect(new Set(combined)).toEqual(new Set(automaCardIdsForConfig(difficulty, ravelMode)));

        // Guild token on START (0) and 1 available guild marker.
        expect(s.guild.track.p2).toBe(0);
        expect(s.automa!.availableGuildMarkers).toBe(1);

        // Position on Dragon Guild (guildMarkers) is excluded.
        expect(s.objectives).not.toContain('guildMarkers');
      }
    }
  });
});

describe('wyrmspan automa — decision card resolution & brown spaces', () => {
  it('passes immediately without resolving when the last card has passIfLast: true', () => {
    const s0 = structuredClone(inAutomaMain({ expansions: ['base'] }));
    s0.turn = 'p2';
    s0.turnIndex = 1;
    // Card '7' has passIfLast: true, refreshDragons: true, objectiveCoinDelta: +1.
    s0.automa!.deck = ['7'];
    s0.automa!.objectiveCoins = 0;
    const dispBefore = [...s0.dragonDisplay];
    const trackBefore = s0.guild.track.p2;

    const s1 = applyAction(s0, { type: 'automaTurn', playerId: 'p2' });
    expect(playerOf(s1, 'p2').passed).toBe(true);
    // None of card 7's actions ran.
    expect(s1.dragonDisplay).toEqual(dispBefore);
    expect(s1.automa!.objectiveCoins).toBe(0);
    expect(s1.guild.track.p2).toBe(trackBefore);
  });

  it('resolves the last card when passIfLast is false, then passes on the next turn when deck is empty', () => {
    const s0 = structuredClone(inAutomaMain({ expansions: ['base'] }));
    s0.turn = 'p2';
    s0.turnIndex = 1;
    // Card '1' has passIfLast: false, steps [1, 2, 2, 2].
    s0.automa!.deck = ['1'];
    s0.guild.track.p2 = 0;

    const s1 = applyAction(s0, { type: 'automaTurn', playerId: 'p2' });
    expect(playerOf(s1, 'p2').passed).toBe(false);
    expect(s1.guild.track.p2).toBe(1); // advanced 1 step in round 1
    expect(s1.automa!.deck).toHaveLength(0);

    // Next turn for p2 with empty deck -> passes.
    const s2 = applyAction({ ...s1, turn: 'p2', turnIndex: 1 }, { type: 'automaTurn', playerId: 'p2' });
    expect(playerOf(s2, 'p2').passed).toBe(true);
  });

  it('refreshes the dragon display, adjusts objective coins (floored at 0), and advances guild steps', () => {
    const s0 = structuredClone(inAutomaMain({ expansions: ['base'] }));
    s0.turn = 'p2';
    s0.turnIndex = 1;
    // Card '7' (with another card underneath so it is not the last card):
    // refreshDragons: true, objectiveCoinDelta: +1, steps [1, 1, 2, 3].
    s0.automa!.deck = ['7', '1'];
    s0.automa!.objectiveCoins = 0;
    s0.guild.track.p2 = 1;
    const oldDragons = [...s0.dragonDisplay];
    const oldCaves = [...s0.caveDisplay];

    const s1 = applyAction(s0, { type: 'automaTurn', playerId: 'p2' });
    expect(s1.dragonDisplay).not.toEqual(oldDragons);
    for (const d of oldDragons) {
      if (d !== null) expect(s1.dragonDiscard).toContain(d);
    }
    expect(s1.caveDisplay).toEqual(oldCaves); // cave display untouched
    expect(s1.automa!.objectiveCoins).toBe(1);
    expect(s1.guild.track.p2).toBe(2);

    // Now test -1 coin delta with card '4' (objectiveCoinDelta: -1): 1 -> 0, and 0 -> 0 (floor).
    const s2 = structuredClone(s1);
    s2.turn = 'p2';
    s2.turnIndex = 1;
    s2.automa!.deck = ['4', '4', '1'];
    const s3 = applyAction(s2, { type: 'automaTurn', playerId: 'p2' });
    expect(s3.automa!.objectiveCoins).toBe(0);
    const s4 = applyAction({ ...s3, turn: 'p2', turnIndex: 1 }, { type: 'automaTurn', playerId: 'p2' });
    expect(s4.automa!.objectiveCoins).toBe(0);
  });

  it('triggers IF BROWN SPACE when landing on or passing space 0 or 6 (display take+refill and guild marker placement)', () => {
    const s0 = structuredClone(inAutomaMain({ expansions: ['base'] }));
    s0.turn = 'p2';
    s0.turnIndex = 1;
    s0.round = 3;
    // Card '2': refreshDragons: false, round 3 steps = 2; brownSpace: { dragonSlot: 2, caveSlot: 2, guildOval: 2 }.
    s0.automa!.deck = ['2', '1'];
    s0.automa!.availableGuildMarkers = 1;
    // Start at space 5: advancing 2 steps passes brown space 6 and ends on space 7.
    s0.guild.track.p2 = 5;
    // Occupy square 0 so available squares are [1, 2, 3, 4]; oval 2 should pick availIndices[1] = square 2.
    s0.guild.squares = GUILD_TILES[s0.guild.tile].squares.map(() => []);
    s0.guild.squares[0] = ['p1'];

    const dSlot1 = s0.dragonDisplay[1]!;
    const cSlot1 = s0.caveDisplay[1]!;

    const s1 = applyAction(s0, { type: 'automaTurn', playerId: 'p2' });
    expect(s1.guild.track.p2).toBe(7);
    expect(s1.automa!.collectedDragons).toBe(1);
    expect(s1.automa!.dragonCards).toEqual([dSlot1]);
    expect(s1.automa!.collectedCaves).toBe(1);
    expect(s1.automa!.caveCards).toEqual([cSlot1]);
    // Both display slots were immediately refilled.
    expect(s1.dragonDisplay.every((c) => c !== null)).toBe(true);
    expect(s1.caveDisplay.every((c) => c !== null)).toBe(true);
    // Guild marker placed on square 2 (2nd available row since square 0 was occupied).
    expect(s1.guild.squares[2]).toEqual(['p2']);
    expect(s1.automa!.availableGuildMarkers).toBe(0);
    expect(playerOf(s1, 'p2').guildMarkersPlaced).toBe(1);
  });

  it('wraps around available guild rows when placing an Automa guild marker', () => {
    let s = structuredClone(inAutomaMain({ expansions: ['base'] }));
    s.guild.squares = GUILD_TILES[s.guild.tile].squares.map(() => []);
    // Occupy squares 0, 1, 2 so only [3, 4] are available.
    s.guild.squares[0] = ['p1'];
    s.guild.squares[1] = ['p1'];
    s.guild.squares[2] = ['p1'];
    s.automa!.availableGuildMarkers = 1;
    // Oval = 3 -> count 1 is sq 3, count 2 is sq 4, wrap around count 3 is sq 3.
    s = placeAutomaGuildMarker(s, 3);
    expect(s.guild.squares[3]).toEqual(['p2']);
  });
});

describe('wyrmspan automa — objectives & Ravel Mode', () => {
  it('defines 4-round base values for every ObjectiveId and caps at physical maximum', () => {
    for (const id of OBJECTIVE_IDS) {
      expect(AUTOMA_OBJECTIVE_BASE[id]).toHaveLength(4);
    }
    const s = structuredClone(inAutomaMain({ expansions: ['base'] }));
    // Example 2 from rulebook (dragon automa.txt line 417): Round 2, mediumDragonsOnMat base is 1 + 2 coins = 3.
    s.objectives[1] = 'mediumDragonsOnMat';
    s.automa!.objectiveCoins = 2;
    expect(automaObjectiveUnits(s, 1)).toBe(3);

    // Physical cap: cardsInCrimson has max 7 (3 cave cards + 4 dragons).
    s.objectives[3] = 'cardsInCrimson';
    s.automa!.objectiveCoins = 5; // base 5 + 5 = 10 -> capped at 7
    expect(AUTOMA_OBJECTIVE_MAX.cardsInCrimson).toBe(7);
    expect(automaObjectiveUnits(s, 3)).toBe(7);

    // 0 units scores 0 VP.
    s.objectives[0] = 'hatchlingsOnMat'; // round 1 base = 0
    s.automa!.objectiveCoins = 0;
    expect(automaObjectiveUnits(s, 0)).toBe(0);
    const vp = scoreObjective(s, 0);
    expect(vp.p2).toBe(0);
  });

  it('computes Ravel Mode steps from p1 mostExcavated (+1) and leastExcavated caves', () => {
    const s = structuredClone(inAutomaMain({ automa: { difficulty: 1, ravelMode: true } }));
    const p1 = playerOf(s, 'p1');
    // Excavate 3 spaces total in Crimson (indices 0, 1, 2), 2 in Golden (0, 1), 1 in Amethyst (0).
    p1.caves[0]!.spaces[1]!.excavated = true;
    p1.caves[0]!.spaces[2]!.excavated = true;
    p1.caves[1]!.spaces[1]!.excavated = true;

    expect(computeAutomaGuildSteps(s, AUTOMA_CARDS['R3/6'])).toBe(3); // mostExcavated = 3
    expect(computeAutomaGuildSteps(s, AUTOMA_CARDS['R8'])).toBe(4); // mostExcavated + 1 = 4
    expect(computeAutomaGuildSteps(s, AUTOMA_CARDS['R2'])).toBe(1); // leastExcavated = 1
  });

  it('caps p1 coins at 2 when passing in Ravel Mode and scores fixed-VP guild squares for Automa', () => {
    let s = structuredClone(
      inAutomaMain({ expansions: ['base'], automa: { difficulty: 1, ravelMode: true } }),
    );
    playerOf(s, 'p1').coins = 6;
    s = applyAction(s, { type: 'pass', playerId: 'p1' });
    expect(playerOf(s, 'p1').coins).toBe(2);

    // In Ravel Mode, fixed-VP guild squares (e.g. King's Guild square 3 = 8 VP, square 4 = 3 VP)
    // score for Automa, while variable-VP squares (with counters) do not.
    s.guild.tile = 'kings';
    s.guild.squares = GUILD_TILES.kings.squares.map(() => []);
    s.guild.squares[3] = ['p2']; // +8 fixed VP
    s.guild.squares[4] = ['p2']; // +3 fixed VP
    s.guild.track.p2 = 2; // 2 steps past brown space 0 = +2 VP
    const bd = scorePlayer(s, playerOf(s, 'p2'));
    expect(bd.guildTile).toBe(2 + 8 + 3);
  });
});

describe('wyrmspan automa — Dragon Academy rules', () => {
  it('rotates start player between p1 and p2 each round with Academy, but keeps p1 every round in Base', () => {
    // Base game: p1 is startPlayer in round 1 and remains startPlayer in round 2.
    let base = inAutomaMain({ expansions: ['base'] });
    expect(base.startPlayer).toBe('p1');
    base.automa!.deck = []; // Automa will pass on next turn
    base = applyAction(base, { type: 'pass', playerId: 'p1' });
    base = applyAction(base, { type: 'automaTurn', playerId: 'p2' });
    expect(base.round).toBe(2);
    expect(base.startPlayer).toBe('p1');
    expect(base.turn).toBe('p1');

    // Academy game: startPlayer rotates at round end.
    let acad = inAutomaMain({ expansions: ['base', 'academy'] });
    const r1Start = acad.startPlayer;
    acad.automa!.deck = [];
    if (acad.turn === 'p2') {
      acad = applyAction(acad, { type: 'automaTurn', playerId: 'p2' });
      acad = applyAction(acad, { type: 'pass', playerId: 'p1' });
    } else {
      acad = applyAction(acad, { type: 'pass', playerId: 'p1' });
      acad = applyAction(acad, chooseAction(acad, 'p1')!); // resolve chooseIncomeSpace
      acad = applyAction(acad, { type: 'automaTurn', playerId: 'p2' });
    }
    while (acad.pending.length) {
      const pid = acad.pending[0]!.playerId;
      acad = applyAction(acad, chooseAction(acad, pid)!);
    }
    expect(acad.round).toBe(2);
    expect(acad.startPlayer).toBe(r1Start === 'p1' ? 'p2' : 'p1');
  });

  it('blocks 6-coin income spaces when Automa passes before p1 in Rounds 1-3', () => {
    // Round 1: Automa passes first -> space 5 ('6 coins') is blocked.
    let s = structuredClone(inAutomaMain({ expansions: ['base', 'academy'] }));
    s.turn = 'p2';
    s.turnIndex = 1;
    s.automa!.deck = [];
    s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
    expect(playerOf(s, 'p2').passed).toBe(true);
    expect(s.incomeChoices.p2).toBe(5);

    s = applyAction(s, { type: 'pass', playerId: 'p1' });
    const head1 = s.pending[0];
    expect(head1?.kind).toBe('chooseIncomeSpace');
    if (head1?.kind === 'chooseIncomeSpace') {
      expect(head1.options).toEqual([0, 1, 2, 3, 4]);
    }

    // Round 3: Automa passes first -> both 6-coin spaces (indices 4 and 5) are blocked.
    let s3 = structuredClone(inAutomaMain({ expansions: ['base', 'academy'] }));
    s3.round = 3;
    s3.turn = 'p2';
    s3.turnIndex = 1;
    s3.automa!.deck = [];
    s3 = applyAction(s3, { type: 'automaTurn', playerId: 'p2' });
    s3 = applyAction(s3, { type: 'pass', playerId: 'p1' });
    const head3 = s3.pending[0];
    expect(head3?.kind).toBe('chooseIncomeSpace');
    if (head3?.kind === 'chooseIncomeSpace') {
      expect(head3.options).toEqual([0, 1, 2, 3]);
    }
  });

  it('grants Automa Cache tokens on opponent benefits in Academy (and nothing in Base)', () => {
    // Example 1 (academy_p07.png): "Gain [Milk][Milk]. All opponents gain [Milk]." -> 2 cache tokens.
    // Example 2 (academy_p07.png): "Up to 3x, pay [AnyResource] to gain [DragonGuild]. Each opponent may do this 1x." -> 1 cache token.
    // Example 3 (academy_p07.png): "Up to 3x, pay [DragonCard] to lay [Egg][Egg]. Each opponent may do this 1x." -> 2 cache tokens.
    let acad = structuredClone(inAutomaMain({ expansions: ['base', 'academy'] }));
    acad.turn = 'p1';
    acad.turnIndex = 0;
    const p1 = playerOf(acad, 'p1');
    // Cave card 251 (number 69): "Up to 3x, pay [AnyResource] to gain [DragonGuild]. Each opponent may do this 1x."
    // Cave card 255 (number 73): "Up to 3x, pay [DragonCard] to lay [Egg][Egg]. Each opponent may do this 1x."
    p1.hand = [251, 255];
    p1.coins = 4;

    acad = applyAction(acad, { type: 'excavate', playerId: 'p1', cave: 0, cardId: 251 });
    while (acad.pending.length) {
      acad = applyAction(acad, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'decline' } });
    }
    expect(acad.automa!.cacheTokens).toBe(1);

    acad.turn = 'p1';
    acad.turnIndex = 0;
    acad = applyAction(acad, { type: 'excavate', playerId: 'p1', cave: 1, cardId: 255 });
    while (acad.pending.length) {
      acad = applyAction(acad, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'decline' } });
    }
    expect(acad.automa!.cacheTokens).toBe(3); // 1 + 2 = 3 tokens

    // Base mode: Automa gains nothing (0 cache tokens, no pending opponentMay).
    let base = structuredClone(inAutomaMain({ expansions: ['base'] }));
    base.turn = 'p1';
    base.turnIndex = 0;
    playerOf(base, 'p1').hand = [251];
    base = applyAction(base, { type: 'excavate', playerId: 'p1', cave: 0, cardId: 251 });
    while (base.pending.length) {
      expect(base.pending[0]!.playerId).toBe('p1');
      base = applyAction(base, { type: 'resolveChoice', playerId: 'p1', answer: { kind: 'decline' } });
    }
    expect(base.automa!.cacheTokens).toBe(0);
  });

  it('scores Automa end-game breakdown and awards ties to p1 ("In the event of a tie, you win!")', () => {
    const s = structuredClone(
      inAutomaMain({ expansions: ['base', 'academy'], automa: { difficulty: 3, ravelMode: false } }),
    );
    s.automa!.collectedDragons = 2; // 2 * 8 VP (Level 3 non-Ravel) = 16 VP
    s.automa!.collectedCaves = 3; // 3 * 2 VP = 6 VP
    s.automa!.cacheTokens = 5; // floor(5 / 2) = 2 VP
    s.guild.track.p2 = 10; // 10 % 6 = 4 VP beyond brown space 6
    playerOf(s, 'p2').objectiveVps = [4, 2, 0, 3]; // 9 VP
    const p2Score = scorePlayer(s, playerOf(s, 'p2'));
    expect(p2Score.printedDragonVp).toBe(16);
    expect(p2Score.tucked).toBe(6);
    expect(p2Score.cached).toBe(2);
    expect(p2Score.guildTile).toBe(4);
    expect(p2Score.objectives).toBe(9);
    expect(p2Score.total).toBe(37);

    // Force a tie at 37 total VP (even with Automa having more visibleDragons).
    const p1 = playerOf(s, 'p1');
    p1.caves = p1.caves.map((r) => ({
      spaces: r.spaces.map((sp) => ({ ...sp, dragon: null, caveCardId: null })),
    })) as typeof p1.caves;
    p1.coins = 37;
    p1.nestEggs = 0;
    p1.hand = [];
    p1.resources = { meat: 0, gold: 0, crystal: 0, milk: 0 };
    p1.objectiveVps = [];
    p1.bonusVP = 0;

    const res = scoreGame(s);
    expect(res.scores.find((x) => x.playerId === 'p1')!.total).toBe(37);
    expect(res.scores.find((x) => x.playerId === 'p2')!.total).toBe(37);
    expect(res.winners).toEqual(['p1']);
  });
});

describe('wyrmspan automa — full deterministic games', () => {
  it('completes full Base, Ravel Mode, and Dragon Academy Automa games across Difficulties 1/2/3', () => {
    for (const expansions of [['base'], ['base', 'academy']] as const) {
      for (const ravelMode of [false, true]) {
        for (const difficulty of [1, 2, 3] as const) {
          const s = playAutomaGame(20 + difficulty, {
            expansions: [...expansions],
            automa: { difficulty, ravelMode },
          });
          expect(s.round).toBe(4);
          expect(s.finalScores).toHaveLength(2);
          expect(s.winners?.length).toBe(1);
          for (const sc of s.finalScores!) {
            expect(sc.total).toBe(
              sc.guildTile +
                sc.printedDragonVp +
                sc.endGameAbilities +
                sc.eggs +
                sc.cached +
                sc.tucked +
                sc.objectives +
                sc.coins +
                sc.leftovers +
                sc.bonusVP,
            );
          }
        }
      }
    }
  }, 30000);

  it('is deterministic for a fixed seed', () => {
    const a = playAutomaGame(77, { automa: { difficulty: 2, ravelMode: true } });
    const b = playAutomaGame(77, { automa: { difficulty: 2, ravelMode: true } });
    expect(a.finalScores).toEqual(b.finalScores);
  });
});
