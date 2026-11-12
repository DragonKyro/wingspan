// Americas Expansion coverage: hummingbird garden/mat/track (attract &
// return actions, benefits, bonus spaces, no-takebacks), feeder-reset and
// draw-cards pink triggers, Rufous Hornero placeholder eggs, the new goal
// tiles and bonus cards, plus a full-game smoke test.

import { describe, expect, it } from 'vitest';
import { chooseAction } from '@/wingspan/ai/chooseAction';
import { hummingbird } from './cards';
import { HUM_BONUS_SPACES, HUM_GARDEN_SLOTS, HUM_LADDER } from './constants';
import { createGame } from './createGame';
import { applyAction, settle } from './engine';
import { actingPlayerId, getPlayer } from './helpers';
import { feederReset, moveHumToken, pinkTriggerFor, queueHumAction, runPower } from './powers';
import { bonusUnits, goalScore } from './scoring';
import { autoResolve, autoSetup, edit, gameFactory, mkBird, ref, takeSimpleTurn } from './testUtils';

const COLORS = ['red', 'blue'] as const;

// americas card ids (see src/wingspan/data/birds.json).
const ALTAMIRA_ORIOLE = 598; // attract 1 hummingbird to another row.
const AMAZON_KINGFISHER = 599; // reset the birdfeeder; cache all fish shown.
const ANTIOQUIA_BRUSHFINCH = 605; // white: per hummingbird on mat, draw bonus, keep 1.
const BANANAQUIT = 606; // return the hummingbird in your forest.
const COMMON_PAURAQUE = 621; // white: all players may attract, your choice first.
const CRESTED_OROPENDOLA = 623; // move a track marker down 1 to tuck 2 from the deck.
const GOLDEN_MANAKIN = 627; // attract or return 1 emerald/mango hummingbird.
const GREAT_KISKADEE = 630; // rightmost: move it + the cube to another habitat.
const MAGNIFICENT_FRIGATEBIRD = 648; // pink: other draws cards, you both draw 1.
const MUSCOVY_DUCK = 651; // teal: attract up to 2 hummingbirds.
const RED_LEGGED_SERIEMA = 665; // discard 1 seed → reset feeder, gain seeds, cache rodent.
const RUFOUS_HORNERO = 670; // white: placeholder eggs on first empty slots.
const SCARLET_MACAW = 675; // tuck 1 from hand to return 1 hummingbird.
const RUDDY_GROUND_DOVE = 668; // pink: other resets feeder → 1 egg on this bird.
const BARRED_ANTSHRIKE = 607; // pink: invertebrate shown after reset → gain 1.
const VERDIN = 700; // discard 1 invertebrate to take a hummingbird action.
const WOODCOCK = 13; // core, no power.

// hummingbird ids with known benefits (see src/wingspan/data/hummingbirds.json).
const RUFOUS_BREASTED_HERMIT = 2035; // nectar
const RUBY_TOPAZ = 2030; // card
const LONG_BILLED_HERMIT = 2033; // advance
const SPARKLING_VIOLETEAR = 2031; // egg (mango group)

const newGame = gameFactory(['core', 'americas']);

describe('americas expansion', () => {
  it('deals a 5-slot garden, a grassland hummingbird per player, and 5 track tokens', () => {
    const s = newGame();
    expect(s.humGarden.length).toBe(HUM_GARDEN_SLOTS);
    for (const slot of s.humGarden) expect(slot.length).toBe(1);
    // 40 hummingbirds: 5 garden + 2 players = 7 dealt.
    expect(s.humDeck.length).toBe(33);
    for (const p of s.players) {
      expect(p.humBoard.grassland).not.toBeNull();
      expect(p.humBoard.forest).toBeNull();
      expect(p.humBoard.wetland).toBeNull();
      for (const g of Object.values(p.humTrack)) expect(g).toBe(0);
    }
    expect(s.humAction).toBeNull();
    expect(s.humDiscard).toEqual([]);
  });

  it('does not deal hummingbirds without the americas set', () => {
    const s = createGame({
      playerNames: ['A', 'B'],
      playerTypes: ['human', 'human'],
      playerColors: [...COLORS],
      seed: 42,
    });
    expect(s.humDeck.length).toBe(0);
    expect(s.humGarden.every((slot) => slot.length === 0)).toBe(true);
    for (const p of s.players) expect(p.humBoard.grassland).toBeNull();
  });

  it('queues an attract action after a row action on an empty hummingbird space', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = applyAction(s, {
      type: 'gainFood',
      playerId: pid,
      picks: [{ die: 0, take: s.feederIn[0] === 'split' ? 'seed' : undefined }],
    });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumSource', habitat: 'forest' });
  });

  it('queues a return action when the row’s hummingbird space is occupied', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    // The grassland hum space starts occupied — lay eggs to trigger a return.
    s = applyAction(s, { type: 'layEggs', playerId: pid, placements: [] });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumCover', habitat: 'grassland' });
  });

  it('attracts a garden hummingbird and grants its benefit', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    // Put a known-benefit hummingbird on top of garden slot 0.
    s = { ...s, humGarden: s.humGarden.map((slot, i) => (i === 0 ? [RUBY_TOPAZ] : slot)) };
    s = applyAction(s, {
      type: 'gainFood',
      playerId: pid,
      picks: [{ die: 0, take: s.feederIn[0] === 'split' ? 'seed' : undefined }],
    });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumSource' });
    const handBefore = getPlayer(s, pid).hand.length;
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'humPick', source: 0 },
    });
    // The 'card' benefit is a draw: a face-up tray card or the deck.
    expect(s.pending[0]).toMatchObject({ kind: 'chooseCardDraw', count: 1 });
    s = applyAction(s, { type: 'resolveChoice', playerId: pid, choice: { kind: 'trayPick' } });
    const p = getPlayer(s, pid);
    expect(p.humBoard.forest).toBe(RUBY_TOPAZ);
    expect(s.humGarden[0]).toEqual([]); // slot is empty until end-of-turn refill
    expect(p.hand.length).toBe(handBefore + 1); // 'card' benefit drew 1
  });

  it('can attract a hummingbird straight from the deck', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const top = s.humDeck[s.humDeck.length - 1]!;
    s = applyAction(s, {
      type: 'gainFood',
      playerId: pid,
      picks: [{ die: 0, take: s.feederIn[0] === 'split' ? 'seed' : undefined }],
    });
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'humPick', source: 'deck' },
    });
    expect(getPlayer(s, pid).humBoard.forest).toBe(top);
    expect(s.humDeck).not.toContain(top);
  });

  it('grants an egg benefit, a nectar benefit, and an advance step', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = edit(s, pid, { board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] } });
    // Egg benefit → chooseBirdForEgg step; place it on the woodcock.
    s = queueHumAction(s, pid, 'forest');
    s = { ...s, humGarden: s.humGarden.map((slot, i) => (i === 0 ? [SPARKLING_VIOLETEAR] : slot)) };
    s = applyAction(s, { type: 'resolveChoice', playerId: pid, choice: { kind: 'humPick', source: 0 } });
    expect(s.pending[0]).toMatchObject({ kind: 'chooseBirdForEgg', count: 1 });
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'birds', birds: [ref('forest', 0)] },
    });
    expect(getPlayer(s, pid).board.forest[0]!.eggs).toBe(1);
    // Advance benefit → chooseHumColumn step.
    let s2 = queueHumAction(s, pid, 'wetland');
    s2 = { ...s2, humGarden: s2.humGarden.map((slot, i) => (i === 1 ? [LONG_BILLED_HERMIT] : slot)) };
    s2 = applyAction(s2, { type: 'resolveChoice', playerId: pid, choice: { kind: 'humPick', source: 1 } });
    expect(s2.pending.some((st) => st.kind === 'chooseHumColumn')).toBe(true);
    // Nectar benefit → +1 nectar in supply.
    const before = getPlayer(s, pid).food.nectar;
    let s3 = queueHumAction(s, pid, 'wetland');
    s3 = { ...s3, humGarden: s3.humGarden.map((slot, i) => (i === 2 ? [RUFOUS_BREASTED_HERMIT] : slot)) };
    s3 = applyAction(s3, { type: 'resolveChoice', playerId: pid, choice: { kind: 'humPick', source: 2 } });
    expect(getPlayer(s3, pid).food.nectar).toBe(before + 1);
  });

  it('returning a hummingbird covers a garden slot and moves a token up', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const humId = getPlayer(s, pid).humBoard.grassland!;
    const covered = s.humGarden[0]![0]!;
    s = applyAction(s, { type: 'layEggs', playerId: pid, placements: [] });
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'humCover', slot: 0 },
    });
    let p = getPlayer(s, pid);
    expect(p.humBoard.grassland).toBeNull();
    expect(s.humGarden[0]).toEqual([covered, humId]);
    expect(p.humReturned).toContain(humId);
    // The column choice offers the returned and covered birds' groups.
    const step = s.pending[0]!;
    expect(step.kind).toBe('chooseHumColumn');
    if (step.kind === 'chooseHumColumn') {
      expect(step.groups).toEqual(
        expect.arrayContaining([hummingbird(humId).group, hummingbird(covered).group]),
      );
    }
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: pid,
      choice: { kind: 'humColumn', group: hummingbird(humId).group },
    });
    p = getPlayer(s, pid);
    expect(p.humTrack[hummingbird(humId).group]).toBe(1);
  });

  it('forbids re-attracting a hummingbird returned this turn', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const humId = getPlayer(s, pid).humBoard.grassland!;
    s = edit(s, pid, { humReturned: [humId] });
    // Put the returned hummingbird on top of garden slot 0.
    s = { ...s, humGarden: s.humGarden.map((slot, i) => (i === 0 ? [humId] : slot)) };
    s = queueHumAction(s, pid, 'forest');
    expect(() =>
      applyAction(s, {
        type: 'resolveChoice',
        playerId: pid,
        choice: { kind: 'humPick', source: 0 },
      }),
    ).toThrow(/pickable/);
  });

  it('grants another hummingbird action on a hummingbird-icon space', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    // HUM_BONUS_SPACES.bee = [4, 8]: one step up from 3 lands on an icon.
    s = edit(s, pid, { humTrack: { bee: 3, brilliant: 0, emerald: 0, mango: 0, topaz: 0 } });
    expect(HUM_BONUS_SPACES.bee).toContain(4);
    s = moveHumToken(s, pid, 'bee');
    expect(getPlayer(s, pid).humTrack.bee).toBe(4);
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumHabitat', mode: 'either' });
  });

  it('leaves a topped-out token and offers a different column instead', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    const top = HUM_LADDER.length - 1;
    s = edit(s, pid, { humTrack: { bee: top, brilliant: 0, emerald: 0, mango: 0, topaz: 0 } });
    s = moveHumToken(s, pid, 'bee');
    expect(getPlayer(s, pid).humTrack.bee).toBe(top);
    const step = s.pending[0]!;
    expect(step.kind).toBe('chooseHumColumn');
    if (step.kind === 'chooseHumColumn') expect(step.groups).not.toContain('bee');
  });

  it('refills empty garden slots at end of turn and resets the garden at round end', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    // Empty one slot; end turn refills it.
    s = { ...s, humGarden: s.humGarden.map((slot, i) => (i === 0 ? [] : slot)) };
    s = applyAction(s, { type: 'endTurn', playerId: pid });
    expect(s.humGarden.every((slot) => slot.length === 1)).toBe(true);
    // Force round end; the garden is discarded and restocked.
    s = {
      ...s,
      players: s.players.map((pl) => ({ ...pl, actionCubes: 0 })),
    };
    s = applyAction(s, { type: 'endTurn', playerId: actingPlayerId(s) });
    s = settle(s);
    expect(s.round).toBe(1);
    expect(s.humDiscard.length).toBe(HUM_GARDEN_SLOTS);
    expect(s.humGarden.every((slot) => slot.length === 1)).toBe(true);
  });

  it('keeps pink feeder-reset powers asleep on your own reset', () => {
    // The watches only fire for OTHER players' resets.
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(RUDDY_GROUND_DOVE)], grassland: [], wetland: [] },
    });
    s = feederReset(s, 'p1');
    expect(getPlayer(s, 'p1').board.forest[0]!.eggs).toBe(0);
  });

  it('fires americas pinks on another player’s feeder reset', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p2', {
      board: { forest: [mkBird(RUDDY_GROUND_DOVE), mkBird(BARRED_ANTSHRIKE)], grassland: [], wetland: [] },
      food: { invertebrate: 0, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
    });
    // Force the rerolled feeder to show an invertebrate for the antshrike.
    s = feederReset(s, 'p1');
    const dove = getPlayer(s, 'p2').board.forest[0]!;
    expect(dove.eggs).toBe(1);
    // The antshrike gained only if a post-reset die shows invertebrate —
    // check the pink fn directly for determinism.
    s = { ...s, feederIn: ['invertebrate', 'seed', 'fish', 'fruit', 'rodent'] };
    const def = pinkTriggerFor(BARRED_ANTSHRIKE)!;
    const before = getPlayer(s, 'p2').food.invertebrate;
    s = def.fn(s, 'p2', ref('forest', 1), { actor: 'p1' });
    expect(getPlayer(s, 'p2').food.invertebrate).toBe(before + 1);
  });

  it('fires the draw-cards pink for both players', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p2', {
      board: { forest: [], grassland: [], wetland: [mkBird(MAGNIFICENT_FRIGATEBIRD)] },
    });
    const me = actingPlayerId(s);
    const other = me === 'p1' ? 'p2' : 'p1';
    const before1 = getPlayer(s, me).hand.length;
    const before2 = getPlayer(s, other).hand.length;
    s = applyAction(s, { type: 'drawCards', playerId: me, picks: ['deck'] });
    expect(getPlayer(s, me).hand.length).toBe(before1 + 2); // pick + pink share
    expect(getPlayer(s, other).hand.length).toBe(before2 + 1);
  });

  it('attracts to another row (Altamira Oriole excludes the power’s row)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(ALTAMIRA_ORIOLE)], grassland: [], wetland: [] },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    const step = s.pending[0]!;
    expect(step).toMatchObject({ kind: 'chooseHumHabitat', mode: 'attract', exclude: 'forest' });
  });

  it('restricts group-named attracts to those groups (Golden-Headed Manakin)', () => {
    let s = autoSetup(newGame());
    const EMERALD = 2020; // Rufous-Tailed Hummingbird — emerald group.
    expect(hummingbird(EMERALD).group).toBe('emerald');
    s = edit(s, 'p1', {
      board: { forest: [mkBird(GOLDEN_MANAKIN)], grassland: [], wetland: [] },
    });
    // Guarantee a legal attract target: emerald hummingbirds in the garden.
    s = { ...s, humGarden: s.humGarden.map(() => [EMERALD]) };
    s = runPower(s, 'p1', ref('forest', 0));
    const step = s.pending[0]!;
    expect(step).toMatchObject({
      kind: 'chooseHumHabitat',
      mode: 'either',
      groups: ['emerald', 'mango'],
    });
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'habitat', habitat: 'wetland' },
    });
    const src = s.pending[0]!;
    expect(src.kind).toBe('chooseHumSource');
    if (src.kind === 'chooseHumSource') expect(src.groups).toEqual(['emerald', 'mango']);
    // Resolving 'deck' is illegal for a group-restricted attract.
    expect(() =>
      applyAction(s, {
        type: 'resolveChoice',
        playerId: 'p1',
        choice: { kind: 'humPick', source: 'deck' },
      }),
    ).toThrow();
  });

  it('returns a hummingbird with a bird power (Bananaquit)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [], grassland: [], wetland: [mkBird(BANANAQUIT)] },
      humBoard: { forest: SPARKLING_VIOLETEAR, grassland: null, wetland: null },
    });
    s = runPower(s, 'p1', ref('wetland', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumCover', habitat: 'forest' });
  });

  it('returns a hummingbird behind a tuck (Scarlet Macaw) and via a food discard (Verdin)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(SCARLET_MACAW), mkBird(VERDIN)], grassland: [], wetland: [] },
      humBoard: { forest: null, grassland: getPlayer(s, 'p1').humBoard.grassland, wetland: null },
      hand: [WOODCOCK],
      food: { invertebrate: 1, seed: 0, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHandTuck', optional: true });
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'handCards', cardIds: [WOODCOCK] },
    });
    expect(getPlayer(s, 'p1').board.forest[0]!.tucked).toEqual([WOODCOCK]);
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumHabitat', mode: 'return' });
    // Verdin: discard 1 invertebrate → take a hummingbird action.
    s = autoResolve(s);
    s = runPower(s, 'p1', ref('forest', 1));
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'supplyFood', foods: ['invertebrate'] },
    });
    expect(getPlayer(s, 'p1').food.invertebrate).toBe(0);
    expect(s.pending[0]).toMatchObject({ kind: 'chooseHumHabitat', mode: 'either' });
  });

  it('moves a marker down to tuck 2 from the deck (Crested Oropendola)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(CRESTED_OROPENDOLA)], grassland: [], wetland: [] },
      humTrack: { bee: 1, brilliant: 0, emerald: 0, mango: 0, topaz: 0 },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    const step = s.pending[0]!;
    expect(step).toMatchObject({ kind: 'chooseHumColumn', down: true });
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'humColumn', group: 'bee' },
    });
    const p = getPlayer(s, 'p1');
    expect(p.humTrack.bee).toBe(0);
    expect(p.board.forest[0]!.tucked.length).toBe(2);
  });

  it('offers a down move only for tokens above START', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(CRESTED_OROPENDOLA)], grassland: [], wetland: [] },
      humTrack: { bee: 0, brilliant: 0, emerald: 0, mango: 0, topaz: 0 },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    // No token can move down — the step (and its tuck) drops entirely.
    s = settle(s);
    expect(s.pending.length).toBe(0);
    expect(getPlayer(s, 'p1').board.forest[0]!.tucked.length).toBe(0);
  });

  it('lets every player take an optional hummingbird action (Common Pauraque)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [], grassland: [], wetland: [mkBird(COMMON_PAURAQUE)] },
    });
    s = runPower(s, 'p1', ref('wetland', 0));
    // First pick the starting player, then 2 optional steps queue up.
    expect(s.pending[0]!.kind).toBe('choosePlayer');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'player', playerId: 'p2' },
    });
    const humSteps = s.pending.filter((st) => st.kind === 'chooseHumHabitat');
    expect(humSteps.length).toBe(2);
    expect(humSteps[0]!.playerId).toBe('p2');
    expect(humSteps.every((st) => st.kind === 'chooseHumHabitat' && st.optional)).toBe(true);
  });

  it('attracts up to 2 hummingbirds with one power (Muscovy Duck)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(MUSCOVY_DUCK)], grassland: [], wetland: [] },
    });
    s = runPower(s, 'p1', ref('forest', 0));
    const steps = s.pending.filter((st) => st.kind === 'chooseHumHabitat');
    expect(steps.length).toBe(2);
    expect(steps.every((st) => st.kind === 'chooseHumHabitat' && st.mode === 'attract' && st.optional)).toBe(true);
  });

  it('resets the feeder then gains/caches from it (Red-Legged Seriema)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [], grassland: [mkBird(RED_LEGGED_SERIEMA)], wetland: [] },
      food: { invertebrate: 0, seed: 1, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
    });
    s = runPower(s, 'p1', ref('grassland', 0));
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'supplyFood', foods: ['seed'] },
    });
    const p = getPlayer(s, 'p1');
    expect(p.food.seed).toBe(s.feederIn.filter((f) => f === 'seed').length);
    // Rodent cached only if a post-reset die shows one (capped at 1).
    const rodents = s.feederIn.filter((f) => f === 'rodent').length;
    expect(p.board.grassland[0]!.cached).toEqual(rodents > 0 ? ['rodent'] : []);
  });

  it('caches at most 1 fish after a feeder reset (Amazon Kingfisher)', () => {
    let s = autoSetup(newGame());
    s = { ...s, feederIn: ['fish', 'fish', 'fish', 'fish', 'fish'] };
    s = edit(s, 'p1', {
      board: { forest: [], grassland: [], wetland: [mkBird(AMAZON_KINGFISHER)] },
    });
    s = runPower(s, 'p1', ref('wetland', 0));
    // At most 1 fish cached, and only when the reroll shows fish.
    const hasFish = s.feederIn.some((f) => f === 'fish');
    expect(getPlayer(s, 'p1').board.wetland[0]!.cached).toEqual(hasFish ? ['fish'] : []);
    expect(s.feederIn.length).toBe(5); // dice were reset, not removed
  });

  it('moves the bird and its action cube to another habitat (Great Kiskadee)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(WOODCOCK), mkBird(GREAT_KISKADEE)], grassland: [], wetland: [] },
    });
    s = { ...s, humAction: 'forest' };
    s = runPower(s, 'p1', ref('forest', 1));
    expect(s.pending[0]!.kind).toBe('moveBirdHabitat');
    s = applyAction(s, {
      type: 'resolveChoice',
      playerId: 'p1',
      choice: { kind: 'habitat', habitat: 'wetland' },
    });
    const p = getPlayer(s, 'p1');
    expect(p.board.forest.length).toBe(1);
    expect(p.board.wetland[0]!.cardId).toBe(GREAT_KISKADEE);
    // The row action continues in the new habitat — its hum action moves too.
    expect(s.humAction).toBe('wetland');
  });

  it('places Hornero placeholder eggs and discounts the column egg cost', () => {
    let s = autoSetup(newGame());
    const pid = actingPlayerId(s);
    s = edit(s, pid, {
      board: { forest: [mkBird(WOODCOCK)], grassland: [mkBird(RUFOUS_HORNERO)], wetland: [] },
      hand: [13],
      food: { invertebrate: 2, seed: 1, fish: 0, fruit: 0, rodent: 0, nectar: 0 },
    });
    s = runPower(s, pid, ref('grassland', 0));
    expect(getPlayer(s, pid).horneroEggs).toEqual(expect.arrayContaining(['forest', 'wetland']));
    // Playing in the forest's second column normally costs 1 egg — the
    // placeholder covers it.
    s = applyAction(s, {
      type: 'playBird',
      playerId: pid,
      cardId: 13,
      habitat: 'forest',
      eggPayments: [],
      foodPayments: ['invertebrate', 'invertebrate', 'seed'],
    });
    const p = getPlayer(s, pid);
    expect(p.board.forest.length).toBe(2);
    expect(p.horneroEggs).not.toContain('forest');
    expect(p.horneroEggs).toContain('wetland'); // the others stay until used
  });

  it('draws a bonus card per hummingbird on the mat (Antioquia Brushfinch)', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [], grassland: [mkBird(ANTIOQUIA_BRUSHFINCH)], wetland: [] },
      humBoard: { forest: SPARKLING_VIOLETEAR, grassland: RUBY_TOPAZ, wetland: null },
    });
    const deckBefore = s.bonusDeck.length;
    s = runPower(s, 'p1', ref('grassland', 0));
    const step = s.pending[0]!;
    expect(step.kind).toBe('chooseBonusCards');
    if (step.kind === 'chooseBonusCards') {
      expect(step.cardIds.length).toBe(2); // one per hummingbird
      expect(step.keep).toBe(1);
    }
    expect(deckBefore - s.bonusDeck.length).toBe(2);
  });

  it('counts hummingbirds as birds in habitat goals and eggless goals', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      board: { forest: [mkBird(WOODCOCK)], grassland: [], wetland: [] },
      humBoard: { forest: SPARKLING_VIOLETEAR, grassland: null, wetland: null },
    });
    // birdsInHabitat(forest): 1 bird + 1 hummingbird = 2.
    s = { ...s, goalTiles: [2000, ...s.goalTiles.slice(1)] };
    expect(goalScore(s, 'p1', 2000)).toBe(2);
  });

  it('scores hummingbird-track goals from the canonical ladder', () => {
    let s = autoSetup(newGame());
    s = edit(s, 'p1', {
      humTrack: { bee: 8, brilliant: 5, emerald: 2, mango: 1, topaz: 0 },
    });
    // humPoints: 10 + 4 + 1 + 0 - 3 = 12.
    expect(goalScore(s, 'p1', 2049)).toBe(
      HUM_LADDER[8]! + HUM_LADDER[5]! + HUM_LADDER[2]! + HUM_LADDER[1]! + HUM_LADDER[0]!,
    );
    expect(goalScore(s, 'p1', 2051)).toBe(8); // bee column progress
    expect(goalScore(s, 'p1', 2055)).toBe(0); // topaz unmoved
  });

  it('scores the americas bonus cards from the hummingbird track', () => {
    let s = autoSetup(newGame());
    const p1 = edit(s, 'p1', {
      humTrack: { bee: 8, brilliant: 5, emerald: 3, mango: 1, topaz: 0 },
    });
    const p = getPlayer(p1, 'p1');
    // "Point value of your [group] token" — bee is at index 8 → 10 points.
    expect(bonusUnits(p, 'Apiarist')).toBe(10);
    expect(bonusUnits(p, 'Brilliant Specialist')).toBe(4);
    expect(bonusUnits(p, 'Emerald Specialist')).toBe(2);
    expect(bonusUnits(p, 'Mango Specialist')).toBe(0);
    expect(bonusUnits(p, 'Topaz Specialist')).toBe(-3);
    // Ecolodge: difference between best (10) and worst (-3) is 13.
    expect(bonusUnits(p, 'Ecolodge Owner')).toBe(13);
    // Hummingbird Counter: bonus-icon spaces reached (bee 3,6 → 2; brilliant
    // 4 → 1; emerald 3 → 1; mango none; topaz none) = 4.
    expect(bonusUnits(p, 'Hummingbird Counter')).toBe(4);
    // Hummingbird Gardener: tokens worth ≥4 — bee (10) and brilliant (4) = 2.
    expect(bonusUnits(p, 'Hummingbird Gardener')).toBe(2);
  });

  it('counts hummingbirds toward name-based bonus cards', () => {
    let s = autoSetup(newGame());
    // Violet Sabrewing carries 'Photographer' (violet is a color).
    const VIOLET_SABREWING = 2023;
    expect(hummingbird(VIOLET_SABREWING).bonusFlags).toContain('Photographer');
    s = edit(s, 'p1', {
      humBoard: { forest: VIOLET_SABREWING, grassland: null, wetland: null },
    });
    expect(bonusUnits(getPlayer(s, 'p1'), 'Photographer')).toBe(1);
  });

  it('plays a complete game to gameOver and is deterministic', () => {
    const playGame = () => {
      let s = autoSetup(newGame(11));
      let turns = 0;
      while (s.phase !== 'gameOver' && turns++ < 300) s = takeSimpleTurn(s);
      return s;
    };
    const s = playGame();
    expect(s.phase).toBe('gameOver');
    expect(s.finalScores).not.toBeNull();
    expect(s.winner).not.toBeNull();
    for (const pid of s.playerOrder) {
      expect(typeof s.finalScores![pid]!.hummingbirds).toBe('number');
    }
    const s2 = playGame();
    expect(s2.finalScores).toEqual(s.finalScores);
    expect(s2.winner).toEqual(s.winner);
  });

  it('the heuristic AI completes an americas game (all new pending kinds answerable)', () => {
    let s = createGame({
      playerNames: ['A', 'B'],
      playerTypes: ['ai', 'ai'],
      playerColors: [...COLORS],
      seed: 7,
      settings: { sets: ['core', 'americas'] },
    });
    let guard = 0;
    while (s.phase !== 'gameOver' && guard++ < 4000) {
      const head = s.pending[0];
      const pid = head?.playerId ?? (s.phase === 'setup' ? s.setupRemaining[0] : actingPlayerId(s));
      if (!pid) break;
      const action = chooseAction(s, pid);
      if (!action) break;
      s = applyAction(s, action);
    }
    expect(s.phase).toBe('gameOver');
    expect(s.finalScores).not.toBeNull();
    // Hummingbird actions happened: garden slots were covered and/or mat
    // spaces filled, and someone moved up the track.
    expect(
      s.players.some((p) => Object.values(p.humTrack).some((n) => n > 0)),
    ).toBe(true);
  });
});
