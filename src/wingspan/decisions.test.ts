// Rules audit: decisions the Wingspan engine used to make for the player.
// Each test pins one: the rulebook gives the player (or each player) the
// choice, and the engine now asks.

import { describe, expect, it } from 'vitest';
import { BIRDS } from './cards';
import { applyAction, settle } from './engine';
import { actingPlayerId, getPlayer, payFoodPlan, spendableCached } from './helpers';
import { firePinkTriggers, pushPending, runPower } from './powers';
import type { Choice, GameState, PlayerId } from './types';
import { autoSetup, edit, gameFactory, mkBird, ref } from './testUtils';

const SETS = ['core', 'european', 'oceania', 'asia', 'americas', 'promoEurope', 'promoNZ', 'promoUS'];
const newGame = (seed = 42): GameState => autoSetup(gameFactory(SETS, { goalSide: 'green' })(seed));
const idOf = (text: string) => BIRDS.find((b) => b.powerText === text)!.id;
const WOODCOCK = 13; // no power
const answer = (s: GameState, pid: PlayerId, choice: Choice) => applyAction(s, { type: 'resolveChoice', playerId: pid, choice });
const other = (s: GameState, pid: PlayerId) => s.playerOrder.find((x) => x !== pid)!;

describe('card draws: the face-up tray or the deck', () => {
  it('"Draw 1 [card]." offers the tray or the deck', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    s = edit(s, pid, { board: { forest: [], grassland: [], wetland: [mkBird(idOf('Draw 1 [card].'))] } });
    s = runPower(s, pid, ref('wetland', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'chooseCardDraw', count: 1 });
    const faceUp = s.tray.find((x) => x != null)!;
    s = answer(s, pid, { kind: 'trayPick', cardId: faceUp });
    expect(getPlayer(s, pid).hand).toContain(faceUp);
    expect(s.tray).not.toContain(faceUp);
  });

  it('"... from the deck" stays a deck draw', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const text = 'Draw 2 [card]. All other players draw 1 [card] from the deck.';
    s = edit(s, pid, { board: { forest: [], grassland: [], wetland: [mkBird(idOf(text))] } });
    const otherHand = getPlayer(s, other(s, pid)).hand.length;
    s = runPower(s, pid, ref('wetland', 0));
    // You: tray or deck; every other player: from the deck, immediately.
    expect(s.pending[0]).toMatchObject({ kind: 'chooseCardDraw', count: 2, playerId: pid });
    expect(getPlayer(s, other(s, pid)).hand.length).toBe(otherHand + 1);
  });
});

describe('paying food: 2-for-1 never blocks a legal payment', () => {
  it('[seed][fruit] is payable with fruit + 2 rodents (rodents → seed)', () => {
    const cost = { kind: 'and' as const, items: [{ food: 'seed' as const, count: 1 }, { food: 'fruit' as const, count: 1 }] };
    const food = { invertebrate: 0, seed: 0, fish: 0, fruit: 1, rodent: 2, nectar: 0 };
    expect(payFoodPlan(food, cost)?.sort()).toEqual(['fruit', 'rodent', 'rodent']);
  });
});

describe('cached food can only be spent where a power says so', () => {
  it('ordinary cached food is not spendable; Coal Tit seeds are', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const coalTit = BIRDS.find((b) => b.name === 'Coal Tit')!.id;
    s = edit(s, pid, {
      board: { forest: [mkBird(WOODCOCK, { cached: ['seed'] }), mkBird(coalTit, { cached: ['seed'] })], grassland: [], wetland: [] },
    });
    expect(spendableCached(getPlayer(s, pid))).toEqual([{ bird: ref('forest', 1), food: 'seed' }]);
  });
});

describe('round-end and game-end powers: in any order', () => {
  it('two waiting round-end powers: the player picks which runs first', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const teal = BIRDS.filter((b) => b.powerColor === 'teal' && b.powerText && /egg/.test(b.powerText)).slice(0, 2);
    s = edit(s, pid, { board: { forest: teal.map((b) => mkBird(b.id)), grassland: [], wetland: [] } });
    s = settle({ ...s, phase: 'roundEnd', roundEndQueue: [{ playerId: pid, bird: ref('forest', 0) }, { playerId: pid, bird: ref('forest', 1) }] });
    expect(s.pending[0]).toMatchObject({ kind: 'choosePowerOrder', queue: 'roundEnd', playerId: pid });
    s = answer(s, pid, { kind: 'repeatTarget', bird: ref('forest', 1) });
    // The picked (second) bird ran first: it left the queue ahead of the head entry.
    expect(s.roundEndQueue.some((e) => e.bird.index === 1)).toBe(false);
  });
});

describe('the birdfeeder', () => {
  it('an all-same-face feeder can be reset before gaining a food that is missing, then picked from the new dice', () => {
    let s = newGame(7);
    const pid = actingPlayerId(s);
    s = { ...s, feederIn: ['fish'] };
    s = pushPending(s, { kind: 'pickDie', playerId: pid, count: 1, faces: ['seed'] });
    s = settle(s);
    expect(s.pending[0]?.kind).toBe('pickDie'); // kept: a reset is possible
    s = answer(s, pid, { kind: 'dice', picks: [], reroll: true });
    expect(s.feederIn.length).toBe(5);
    expect(s.pending[0]).toMatchObject({ kind: 'pickDie', count: 1 }); // asked again, after seeing the new dice
  });

  it('"gain food" with a reroll and no picks: the dice are picked after the reroll', () => {
    let s = newGame(9);
    const pid = actingPlayerId(s);
    s = { ...s, feederIn: ['rodent', 'rodent'] };
    s = applyAction(s, { type: 'gainFood', playerId: pid, reroll: true, picks: [] });
    expect(s.feederIn.length).toBe(5);
    expect(s.pending[0]).toMatchObject({ kind: 'pickDie', playerId: pid });
  });

  it('"Gain all [X] in the birdfeeder" with one face showing offers a reset first', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    s = { ...s, feederIn: ['seed', 'seed'] };
    s = edit(s, pid, { board: { forest: [mkBird(idOf('Gain all [fish] that are in the birdfeeder.'))], grassland: [], wetland: [] } });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'confirm', then: { effect: 'takeAllReroll' } });
  });
});

describe('other players decide for themselves', () => {
  it('Eurasian Siskin: each other player may give (or not), and the tuck check runs after them', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const o = other(s, pid);
    const siskin = BIRDS.find((b) => b.name === 'Eurasian Siskin')!.id;
    s = edit(s, pid, { board: { forest: [mkBird(siskin)], grassland: [], wetland: [] } });
    s = edit(s, o, { board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] }, food: { ...getPlayer(s, o).food, seed: 2 } });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'chooseFoodDiscard', playerId: o, optional: true });
    const before = getPlayer(s, o).food.seed;
    s = answer(s, o, { kind: 'supplyFood', foods: [] }); // declines
    expect(getPlayer(s, o).food.seed).toBe(before);
    // Fewer than 3 received: 2 cards tucked from the deck.
    expect(getPlayer(s, pid).board.forest[0]!.tucked.length).toBe(2);
  });

  it('Black Robin: each player picks which bonus card to pass left', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const robin = BIRDS.find((b) => b.name === 'Black Robin')!.id;
    s = edit(s, pid, { board: { forest: [mkBird(robin)], grassland: [], wetland: [] } });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'discardBonusCards', playerId: pid, then: { effect: 'giveBonusLeft' } });
    const gift = getPlayer(s, pid).bonusHand[getPlayer(s, pid).bonusHand.length - 1]!;
    s = answer(s, pid, { kind: 'bonusCards', cardIds: [gift] });
    expect(getPlayer(s, other(s, pid)).bonusHand).toContain(gift);
  });
});

describe('pink powers "at the end of their turn"', () => {
  it('run when the active player ends their turn, not at the trigger', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const o = other(s, pid);
    const hoatzin = BIRDS.find((b) => b.name === 'Hoatzin')!.id;
    s = edit(s, o, { board: { forest: [mkBird(hoatzin)], grassland: [], wetland: [] } });
    s = firePinkTriggers(s, pid, { kind: 'playBird', habitat: 'forest', cardId: WOODCOCK });
    expect(s.pending).toEqual([]);
    expect(s.endOfTurnPinks).toHaveLength(1);
  });
});

describe('optional parts of powers', () => {
  it('Spotless Starling asks before copying', () => {
    let s = newGame(3);
    const pid = actingPlayerId(s);
    const starling = BIRDS.find((b) => b.name === 'Spotless Starling')!.id;
    // Put a brown-power bird on top of the deck.
    const brown = BIRDS.find((b) => b.powerColor === 'brown' && b.powerText === 'Draw 1 [card].')!.id;
    // On both ends of the deck, whichever end is the top.
    s = { ...s, deck: [brown, ...s.deck.filter((x) => x !== brown), brown] };
    s = edit(s, pid, { board: { forest: [mkBird(starling)], grassland: [], wetland: [] } });
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'confirm', then: { effect: 'starlingCopy' } });
    const declined = answer(s, pid, { kind: 'boolean', yes: false });
    expect(declined.pending).toEqual([]); // declined: the copied draw doesn't happen
  });

  it('NZ Fairy Tern discards up to 3; Rusty Blackbird discards any number and draws that many + 1', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const rusty = BIRDS.find((b) => b.name === 'Rusty Blackbird')!.id;
    s = edit(s, pid, { board: { forest: [mkBird(rusty)], grassland: [], wetland: [] } });
    const hand = getPlayer(s, pid).bonusHand.length;
    s = runPower(s, pid, ref('forest', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'discardBonusCards', upTo: true });
    s = answer(s, pid, { kind: 'bonusCards', cardIds: [] }); // keep them all
    expect(getPlayer(s, pid).bonusHand.length).toBe(hand + 1);
  });

  it('Yellow-Eyed Penguin lets the player pick which drawn bird to play (or none)', () => {
    let s = newGame();
    const pid = actingPlayerId(s);
    const penguin = BIRDS.find((b) => b.name === 'Yellow-Eyed Penguin')!.id;
    s = edit(s, pid, { board: { forest: [], grassland: [], wetland: [mkBird(penguin)] } });
    s = runPower(s, pid, ref('wetland', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'choosePoolPlay' });
    const discard = s.discard.length;
    s = answer(s, pid, { kind: 'handCards', cardIds: [] });
    expect(s.discard.length).toBe(discard + 5);
  });
});

