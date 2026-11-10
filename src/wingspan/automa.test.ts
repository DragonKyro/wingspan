import { describe, expect, it } from 'vitest';
import { chooseAction } from './ai/chooseAction';
import { finishRound } from './actions';
import {
  AUTOMA_CARDS,
  automaCard,
  automaFaceDownVp,
  automaGoalBase,
  automaGoalScore,
  birdMatchesAutomaBonus,
  isAutomaBonusEligible,
} from './automa';
import { BIRDS } from './cards';
import { createGame } from './createGame';
import { applyAction, settle } from './engine';
import { actingPlayerId, getPlayer, isAutoma } from './helpers';
import { setPlayer } from './powers';
import { goalScore, scorePlayer } from './scoring';
import type { GameSettings, GameState } from './types';

function createAutomaGame(seed = 42, settings?: Partial<GameSettings>): GameState {
  return createGame({
    playerNames: ['Solo'],
    playerTypes: ['human'],
    playerColors: ['blue'],
    seed,
    settings: {
      sets: ['core'],
      goalSide: 'green',
      automa: {},
      ...settings,
    },
  });
}

function finishSetup(s: GameState): GameState {
  const p1 = getPlayer(s, 'p1');
  return applyAction(s, {
    type: 'keepSetup',
    playerId: 'p1',
    keepBirds: p1.hand.slice(0, 3),
    keepBonus: p1.bonusHand[0]!,
    discardFood: ['invertebrate', 'seed', 'fish'],
  });
}

describe('Wingspan Automa solo mode', () => {
  describe('setup and deck composition', () => {
    it('creates the Automa seat automatically from 1 human player and keeps p1 first', () => {
      for (const seed of [1, 2, 3, 4, 5, 10, 25]) {
        const s = createAutomaGame(seed);
        expect(isAutoma(s)).toBe(true);
        expect(isAutoma(s, 'p1')).toBe(false);
        expect(isAutoma(s, 'p2')).toBe(true);
        expect(s.playerOrder).toEqual(['p1', 'p2']);
        expect(s.firstPlayerIndex).toBe(0);
        expect(s.currentPlayerIndex).toBe(0);
        expect(s.setupRemaining).toEqual(['p1']);
        expect(s.automa).toBeDefined();
        expect(s.automa!.difficulty).toBe('eagle');
        expect(s.automa!.deck.length).toBe(10);
        expect(s.automa!.discard).toEqual([]);
        expect(isAutomaBonusEligible(s.automa!.bonusCardId)).toBe(true);
        expect(s.automa!.bonusCardId).not.toBe(1001); // Backyard Birder
        expect(s.automa!.bonusCardId).not.toBe(1006); // Breeding Manager

        const p2 = getPlayer(s, 'p2');
        expect(p2.isAI).toBe(true);
        expect(p2.hand).toEqual([]);
        expect(p2.actionCubes).toBe(8);
      }
    });

    it('includes the 11th Automubon Society card when enabled and transitions to main after p1 keepSetup', () => {
      let s = createAutomaGame(7, {
        automa: { difficulty: 'eagleEyed', automubonSociety: true },
      });
      expect(s.automa!.difficulty).toBe('eagleEyed');
      expect(s.automa!.deck.length).toBe(11);
      expect(s.automa!.deck).toContain(11);
      expect(automaCard(11).name).toBe('Automubon Society');

      s = finishSetup(s);
      expect(s.phase).toBe('main');
      expect(actingPlayerId(s)).toBe('p1');
    });
  });

  describe('Automa turn actions', () => {
    it('Draw Cards discards all 3 face-up tray cards, draws 1 face-down bird, and refills tray', () => {
      let s = finishSetup(createAutomaGame(10));
      // Advance p1's turn to reach p2.
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      expect(actingPlayerId(s)).toBe('p2');

      // Card 6 in Round 1 has [{ kind: 'drawCards' }].
      const oldTray = s.tray.slice() as number[];
      const deckLenBefore = s.deck.length;
      s = {
        ...s,
        automa: { ...s.automa!, deck: [6] },
      };

      const aiMove = chooseAction(s, 'p2');
      expect(aiMove).toEqual({ type: 'automaTurn', playerId: 'p2' });
      s = applyAction(s, aiMove!);

      expect(s.automa!.lastCardId).toBe(6);
      expect(s.automa!.faceDownBirds).toBe(1);
      for (const id of oldTray) {
        expect(s.discard).toContain(id);
      }
      // 1 card drawn for faceDownBirds + 3 cards drawn to refill the tray = 4 cards off deck.
      expect(s.deck.length).toBe(deckLenBefore - 4);
      expect(s.tray.every((id) => id != null)).toBe(true);
      expect(actingPlayerId(s)).toBe('p1');
      expect(getPlayer(s, 'p2').actionCubes).toBe(7);
    });

    it('Gain Food removes all dice of the first matching face in the card key, and rerolls when all faces match', () => {
      let s = finishSetup(createAutomaGame(12));
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });

      // Card 9 in Round 1 has Gain Food with ORDER_D: ['seed', 'invertebrate', 'fish', 'fruit', 'split', 'rodent'].
      s = {
        ...s,
        feederIn: ['fish', 'rodent', 'fish', 'fruit', 'fish'],
        feederOut: [],
        automa: { ...s.automa!, deck: [9] },
      };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      // 'seed' and 'invertebrate' are not in feederIn; 'fish' is first present, so all 3 fish dice are removed.
      expect(s.feederIn).toEqual(['rodent', 'fruit']);
      expect(s.feederOut).toEqual(['fish', 'fish', 'fish']);

      // Now test all-same-face reroll before Gain Food removal.
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      s = {
        ...s,
        feederIn: ['rodent', 'rodent'],
        feederOut: ['seed', 'fish', 'fruit'],
        automa: { ...s.automa!, deck: [9] },
      };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      // All 5 dice were rerolled, and then at least 1 matching face was removed (or refilled if all 5 matched).
      expect(s.feederIn.length + s.feederOut.length).toBe(5);
    });

    it('Play a Bird keeps the highest-VP matching tray bird face-up and discards other matches, or draws face-down if none match', () => {
      let s = finishSetup(createAutomaGame(15));
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });

      const bonusId = 1007; // Cartographer
      const cartoBirds = BIRDS.filter((b) => birdMatchesAutomaBonus(b, bonusId))
        .sort((a, b) => a.points - b.points);
      const nonCarto = BIRDS.find((b) => !birdMatchesAutomaBonus(b, bonusId))!;
      const lowMatch = cartoBirds[0]!;
      const highMatch = cartoBirds[cartoBirds.length - 1]!;

      // Card 5 in Round 1 has [{ kind: 'playBird' }].
      s = {
        ...s,
        tray: [lowMatch.id, nonCarto.id, highMatch.id],
        automa: { ...s.automa!, bonusCardId: bonusId, deck: [5] },
      };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });

      expect(s.automa!.faceUpBirds).toEqual([highMatch.id]);
      expect(s.automa!.faceDownBirds).toBe(0);
      expect(s.discard).toContain(lowMatch.id);
      // The non-matching bird stayed in slot 1 while slots 0 and 2 refilled.
      expect(s.tray[1]).toBe(nonCarto.id);
      expect(s.tray.every((id) => id != null)).toBe(true);

      // Now test fallback when NO tray cards match the bonus card.
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      const nonMatches = BIRDS.filter((b) => !birdMatchesAutomaBonus(b, bonusId)).slice(0, 3);
      s = {
        ...s,
        tray: [nonMatches[0]!.id, nonMatches[1]!.id, nonMatches[2]!.id],
        automa: { ...s.automa!, bonusCardId: bonusId, deck: [5] },
      };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(s.automa!.faceUpBirds).toEqual([highMatch.id]);
      expect(s.automa!.faceDownBirds).toBe(1);
    });

    it('Lay Eggs, Goal Cube +/-, and Activate All Pink Powers work as specified', () => {
      let s = finishSetup(createAutomaGame(20));
      // Put a pink-power bird on p1's board: Loggerhead Shrike or Horned Lark or Eastern Phoebe / Lazuli Bunting.
      const pinkGainBird = BIRDS.find(
        (b) =>
          b.powerColor === 'pink' &&
          b.powerText === 'When another player plays a bird in their [forest], gain 1 [invertebrate] from the supply.',
      )!;
      const p1 = getPlayer(s, 'p1');
      s = setPlayer(s, {
        ...p1,
        board: {
          ...p1.board,
          forest: [{ cardId: pinkGainBird.id, eggs: 0, tucked: [], cached: [], pinkUsed: false }],
        },
      });

      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [{ habitat: 'forest', index: 0 }] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });

      // Card 2 in Round 1 has [{ kind: 'layEggs', count: 1 }, { kind: 'placeGoalCube' }].
      s = { ...s, automa: { ...s.automa!, deck: [2] } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(s.automa!.eggs).toBe(1);
      expect(s.automa!.goalCubes).toBe(1);

      // Card 4 in Round 3 has [{ kind: 'layEggs', count: 3 }, { kind: 'removeGoalCube' }].
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      s = { ...s, round: 2, automa: { ...s.automa!, deck: [4], goalCubes: 1 } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(s.automa!.eggs).toBe(4);
      expect(s.automa!.goalCubes).toBe(0);

      // Removing a goal cube when already at 0 stays at 0.
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      s = { ...s, round: 2, automa: { ...s.automa!, deck: [4], goalCubes: 0 } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(s.automa!.goalCubes).toBe(0);

      // Card 3 in Round 1 has Gain Food + Activate All Pink Powers.
      const invBefore = getPlayer(s, 'p1').food.invertebrate;
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      s = { ...s, round: 0, automa: { ...s.automa!, deck: [3] } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(getPlayer(s, 'p1').food.invertebrate).toBe(invBefore + 1);

      // If pinkUsed is already true on p1's bird before Automa's turn, it does NOT fire again.
      const invBefore2 = getPlayer(s, 'p1').food.invertebrate;
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      const p1Now = getPlayer(s, 'p1');
      s = setPlayer(s, {
        ...p1Now,
        board: {
          ...p1Now.board,
          forest: [{ ...p1Now.board.forest[0]!, pinkUsed: true }],
        },
      });
      s = { ...s, round: 0, automa: { ...s.automa!, deck: [3] } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(getPlayer(s, 'p1').food.invertebrate).toBe(invBefore2);
    });
  });

  describe('brown power comparisons, round-end goal scoring, and card removal', () => {
    it('Automa loses brown-power comparisons and never gets pending steps from p1 powers', () => {
      let s = finishSetup(createAutomaGame(30));
      // Give p1 a bird in wetland with "Player(s) with the fewest birds in their [wetland] draw 1 [card]."
      const fewestWetlandBird = BIRDS.find(
        (b) =>
          b.powerColor === 'brown' &&
          b.powerText === 'Player(s) with the fewest birds in their [wetland] draw 1 [card].',
      )!;
      const allLayEggBird = BIRDS.find(
        (b) =>
          b.powerColor === 'brown' &&
          b.powerText?.startsWith('All players lay 1 [egg] on any 1 [bowl] bird.'),
      )!;
      const p1 = getPlayer(s, 'p1');
      s = setPlayer(s, {
        ...p1,
        board: {
          ...p1.board,
          wetland: [
            { cardId: fewestWetlandBird.id, eggs: 0, tucked: [], cached: [] },
            { cardId: allLayEggBird.id, eggs: 0, tucked: [], cached: [] },
          ],
        },
      });

      const handBefore = getPlayer(s, 'p1').hand.length;
      s = applyAction(s, { type: 'drawCards', playerId: 'p1', picks: ['deck', 'deck'] });
      // Activate allLayEggBird (rightmost, index 1): queues chooseBirdForEgg for p1 ONLY, not p2!
      s = applyAction(s, { type: 'activatePower', playerId: 'p1' });
      expect(s.pending.every((st) => st.playerId === 'p1')).toBe(true);
      while (s.pending.length > 0) {
        s = applyAction(s, chooseAction(s, 'p1')!);
      }
      // Activate fewestWetlandBird (index 0): p1 has 2 wetland birds while p2 has 0 on its empty mat,
      // but Automa loses comparisons so p1 still draws 1 card!
      s = applyAction(s, { type: 'activatePower', playerId: 'p1' });
      expect(getPlayer(s, 'p1').hand.length).toBe(handBefore + 2 + 1);
      expect(getPlayer(s, 'p2').hand).toEqual([]);
    });

    it('computes round-end goal base + goalCubes, caps birdsInHabitat at 5, removes round card, and keeps p1 first', () => {
      let s = finishSetup(createAutomaGame(33));
      // Verify base values from End-of-Round Goal Scoring card.
      expect(automaGoalBase(2023, 0)).toBe(-1); // sets of 3 eggs in Round 1 = -1
      expect(automaGoalBase(2023, 1)).toBe(0);
      expect(automaGoalBase(2024, 0)).toBe(3); // total birds in Round 1 = 3
      expect(automaGoalBase(2024, 1)).toBe(5); // total birds in Round 2 = 5
      expect(automaGoalBase(2000, 3)).toBe(3); // birds in forest in Round 4 = 3

      // With tile 2023 in Round 1 (base -1) and 1 goalCube, total is 0 => scores 0.
      s = {
        ...s,
        round: 0,
        goalTiles: [2023, 2000, 2024, 2012],
        automa: { ...s.automa!, goalCubes: 1 },
      };
      expect(automaGoalScore(s, 2023)).toBe(0);
      expect(goalScore(s, 'p2', 2023)).toBe(0);

      // With tile 2000 (birdsInHabitat, base 3 in Round 4) and 4 goalCubes, capped at 5.
      const sR4 = { ...s, round: 3, automa: { ...s.automa!, goalCubes: 4 } };
      expect(automaGoalScore(sR4, 2000)).toBe(5);

      // Finish Round 1: removes card 1 ('Remove after round 1'), resets goalCubes, keeps firstPlayerIndex = 0.
      const sEndR1 = finishRound({
        ...s,
        phase: 'roundEnd',
        automa: {
          ...s.automa!,
          deck: [1, 2, 3, 4],
          discard: [5, 6, 7, 8, 9, 10],
          goalCubes: 3,
        },
      });
      expect(sEndR1.round).toBe(1);
      expect(sEndR1.firstPlayerIndex).toBe(0);
      expect(sEndR1.currentPlayerIndex).toBe(0);
      expect(sEndR1.automa!.goalCubes).toBe(0);
      expect(sEndR1.automa!.deck.length).toBe(9);
      expect(sEndR1.automa!.deck).not.toContain(1);
      expect(sEndR1.automa!.discard).toEqual([]);
      // With base -1 + 3 goalCubes = 2 units vs p1's 0 units, Automa won 1st place in Round 1 (4 pts).
      expect(sEndR1.goalScores[0]).toEqual([0, 4]);
    });
  });

  describe('difficulty levels, game-end scoring, Hoard, and tiebreaker', () => {
    it('scores Eaglet (3), Eagle (4), and Eagle-eyed Eagle (5) per face-down bird plus face-up birds, eggs, goals, and hoard', () => {
      expect(automaFaceDownVp('eaglet')).toBe(3);
      expect(automaFaceDownVp('eagle')).toBe(4);
      expect(automaFaceDownVp('eagleEyed')).toBe(5);

      const b5 = BIRDS.find((b) => b.points === 5)!;
      const b7 = BIRDS.find((b) => b.points === 7)!;

      for (const [diff, perBird] of [
        ['eaglet', 3],
        ['eagle', 4],
        ['eagleEyed', 5],
      ] as const) {
        let s = finishSetup(
          createAutomaGame(40, { automa: { difficulty: diff, hoard: true } }),
        );
        s = {
          ...s,
          goalScores: [[4, 1], [2, 5], [6, 3], [4, 7]],
          automa: {
            ...s.automa!,
            difficulty: diff,
            faceUpBirds: [b5.id, b7.id],
            faceDownBirds: 6,
            eggs: 9,
            hoardTokens: 4,
          },
        };
        const breakdown = scorePlayer(s, 'p2');
        expect(breakdown.birdPoints).toBe(12 + 6 * perBird);
        expect(breakdown.eggs).toBe(9);
        expect(breakdown.goalPoints).toBe(1 + 5 + 3 + 7);
        expect(breakdown.bonusPoints).toBe(4);
        expect(breakdown.total).toBe(12 + 6 * perBird + 9 + 16 + 4);
      }
    });

    it('uses 2 leftover food tokens for the Automa in the game-end tiebreaker', () => {
      let s = finishSetup(createAutomaGame(50));
      // Both p1 and p2 have 0 points; p1 with 1 food loses tiebreaker to Automa (2 food).
      const p1 = getPlayer(s, 'p1');
      s = setPlayer(s, {
        ...p1,
        board: { forest: [], grassland: [], wetland: [] },
        bonusHand: [],
        food: { invertebrate: 1, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
      });
      s = {
        ...s,
        phase: 'gameEnd',
        gameEndQueue: [],
        goalScores: [[0, 0], [0, 0], [0, 0], [0, 0]],
        automa: {
          ...s.automa!,
          faceUpBirds: [],
          faceDownBirds: 0,
          eggs: 0,
        },
      };
      const settledLose = settle(s);
      expect(settledLose.winner).toEqual(['p2']);

      // p1 with 3 food wins tiebreaker over Automa (2 food).
      const sWin = setPlayer(s, {
        ...getPlayer(s, 'p1'),
        food: { invertebrate: 3, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
      });
      const settledWin = settle(sWin);
      expect(settledWin.winner).toEqual(['p1']);
    });
  });

  describe('expansion Automa rules (Oceania, Asia Duet, Americas)', () => {
    it('handles Oceania nectar removal and end-game nectar majority scoring for Automa', () => {
      let s = finishSetup(
        createAutomaGame(60, { sets: ['core', 'oceania'] }),
      );
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });

      // Card 6 in Round 3 has Gain Food with ORDER_A (starts with 'split', which maps to 'nectar' in Oceania).
      s = {
        ...s,
        round: 2,
        feederIn: ['nectar', 'seed', 'nectar', 'fish'],
        feederOut: [],
        automa: { ...s.automa!, deck: [6] },
      };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(s.feederIn).toEqual(['seed', 'fish']);
      expect(s.automa!.nectarSpent.wetland).toBe(2);
      expect(scorePlayer(s, 'p2').nectar).toBe(5);
    });

    it('places Duet tokens for Automa in Asia Duet mode and scores largest contiguous group', () => {
      let s = finishSetup(
        createAutomaGame(70, { sets: ['asia'], mode: 'duet' }),
      );
      expect(s.duet).toBeDefined();
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });

      // Run two Play a Bird turns for Automa (Card 5 in Round 1).
      s = { ...s, automa: { ...s.automa!, deck: [5] } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });
      s = { ...s, automa: { ...s.automa!, deck: [5] } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });

      const automaTokens = s.duet!.map.filter((owner) => owner === 'p2').length;
      expect(automaTokens).toBe(2);
      expect(scorePlayer(s, 'p2').duetTokens).toBeGreaterThanOrEqual(1);
    });

    it('advances Automa hummingbird track in Americas expansion and refills the garden', () => {
      let s = finishSetup(
        createAutomaGame(80, { sets: ['core', 'americas'] }),
      );
      s = applyAction(s, { type: 'layEggs', playerId: 'p1', placements: [] });
      // Resolve p1's grassland hummingbird action at end of row activation.
      while (s.pending.length > 0) {
        const move = chooseAction(s, 'p1');
        expect(move).not.toBeNull();
        s = applyAction(s, move!);
      }
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });

      s = { ...s, automa: { ...s.automa!, deck: [5] } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      const totalTrackSteps = Object.values(s.automa!.humTrack).reduce((a, b) => a + b, 0);
      expect(totalTrackSteps).toBe(1);
      expect(s.humGarden.every((slot) => slot.length > 0)).toBe(true);
    });

    it('supports European steal powers (only when Automa has goal cubes) and teal powers against Automa', () => {
      let s = finishSetup(
        createAutomaGame(85, { sets: ['core', 'european'] }),
      );
      const stealBird = BIRDS.find(
        (b) =>
          b.powerColor === 'brown' &&
          b.powerText === "Steal 1 [seed] from another player's supply and cache it on this bird. They gain 1 [die] from the birdfeeder.",
      )!;
      const griffon = BIRDS.find(
        (b) =>
          b.powerColor === 'teal' &&
          b.powerText === 'Choose any 1 player (including yourself). Cache 1 [rodent] from the supply on this bird for each [predator] that player has.',
      )!;

      const p1 = getPlayer(s, 'p1');
      s = setPlayer(s, {
        ...p1,
        board: {
          ...p1.board,
          forest: [{ cardId: stealBird.id, eggs: 0, tucked: [], cached: [] }],
          grassland: [{ cardId: griffon.id, eggs: 0, tucked: [], cached: [] }],
        },
      });

      // With goalCubes === 0, stealing from Automa yields nothing.
      s = { ...s, automa: { ...s.automa!, goalCubes: 0 } };
      s = applyAction(s, {
        type: 'gainFood',
        playerId: 'p1',
        picks: [{ die: 0, take: s.feederIn[0] === 'split' ? 'seed' : undefined }],
      });
      s = applyAction(s, { type: 'activatePower', playerId: 'p1' });
      s = applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'player', playerId: 'p2' },
      });
      expect(getPlayer(s, 'p1').board.forest[0]!.cached).toEqual([]);
      expect(s.pending).toEqual([]);
      s = applyAction(s, { type: 'endTurn', playerId: 'p1' });

      // Advance Automa's turn so it's p1's turn again, now with goalCubes = 2.
      s = { ...s, automa: { ...s.automa!, deck: [2], goalCubes: 1 } };
      s = applyAction(s, { type: 'automaTurn', playerId: 'p2' });
      expect(s.automa!.goalCubes).toBe(2);

      s = applyAction(s, {
        type: 'gainFood',
        playerId: 'p1',
        picks: [{ die: 0, take: s.feederIn[0] === 'split' ? 'seed' : undefined }],
      });
      s = applyAction(s, { type: 'activatePower', playerId: 'p1' });
      s = applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'player', playerId: 'p2' },
      });
      // Cached 1 seed from supply, Automa kept its 2 goalCubes, and no pickDie queued for Automa!
      expect(getPlayer(s, 'p1').board.forest[0]!.cached).toEqual(['seed']);
      expect(s.automa!.goalCubes).toBe(2);
      expect(s.pending).toEqual([]);

      // Trigger Griffon Vulture teal power at round end choosing p2 (Automa has 2 goalCubes => 2 rodents cached).
      s = {
        ...s,
        phase: 'roundEnd',
        roundEndQueue: [{ playerId: 'p1', bird: { habitat: 'grassland', index: 0 } }],
      };
      s = settle(s);
      s = applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'player', playerId: 'p2' },
      });
      expect(getPlayer(s, 'p1').board.grassland[0]!.cached).toEqual(['rodent', 'rodent']);
    });

    it('matches Omnivore Specialist and Automa-only bonus cards', () => {
      const omniBird = BIRDS.find(
        (b) => b.cost.kind === 'and' && b.cost.items.some((i) => i.food === 'any'),
      )!;
      expect(birdMatchesAutomaBonus(omniBird, 1020)).toBe(true); // Omnivore Specialist

      const pt3Bird = BIRDS.find((b) => b.points === 3)!;
      const pt6Bird = BIRDS.find((b) => b.points === 6)!;
      expect(birdMatchesAutomaBonus(pt3Bird, 1032)).toBe(true); // [automa] Autwitcher (3-4 pts)
      expect(birdMatchesAutomaBonus(pt6Bird, 1033)).toBe(true); // [automa] RASPB Life Fellow (5-7 pts)
      expect(birdMatchesAutomaBonus(pt3Bird, 1050, 'eaglet')).toBe(true); // Avid Asian Avian Admirer (2-3 pts)
      expect(birdMatchesAutomaBonus(pt6Bird, 1051, 'eagle')).toBe(true); // Rare Species Lister (5-7 pts)
    });
  });

  describe('full deterministic Automa games to gameOver', () => {
    it.each([
      { label: 'Core Eaglet', sets: ['core'], mode: 'standard' as const, automa: { difficulty: 'eaglet' as const } },
      { label: 'European + Hoard + Automubon', sets: ['core', 'european'], mode: 'standard' as const, automa: { difficulty: 'eagleEyed' as const, automubonSociety: true, hoard: true } },
      { label: 'Oceania', sets: ['core', 'oceania'], mode: 'standard' as const, automa: { difficulty: 'eagle' as const } },
      { label: 'Asia Duet', sets: ['asia'], mode: 'duet' as const, automa: { difficulty: 'eagle' as const } },
      { label: 'Americas', sets: ['core', 'americas'], mode: 'standard' as const, automa: { difficulty: 'eagle' as const } },
      { label: 'All Expansions Combined', sets: ['core', 'european', 'oceania', 'asia', 'americas'], mode: 'standard' as const, automa: { difficulty: 'eagleEyed' as const, automubonSociety: true, hoard: true } },
    ])('completes a full game to gameOver ($label)', ({ sets, mode, automa }) => {
      let s = createAutomaGame(101, { sets, mode, automa });
      let steps = 0;
      while (s.phase !== 'gameOver' && steps++ < 500) {
        const pid = s.pending[0]?.playerId ?? actingPlayerId(s);
        const move = chooseAction(s, pid);
        expect(move).not.toBeNull();
        s = applyAction(s, move!);
      }
      expect(s.phase).toBe('gameOver');
      expect(s.finalScores).not.toBeNull();
      expect(s.winner).not.toBeNull();
      expect(s.goalScores.length).toBe(4);
      expect(s.finalScores!.p2!.birdPoints).toBeGreaterThan(0);
      expect(AUTOMA_CARDS.length).toBe(11);
    });
  });
});
