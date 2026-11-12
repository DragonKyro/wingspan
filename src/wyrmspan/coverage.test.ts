import { describe, expect, it } from 'vitest';
import { abilityCoverage, parseAbility } from './abilities';
import { CAVES, DRAGONS } from './cards';
import { createGame } from './createGame';
import { ensureDragonHooks, fireRecurring } from './effects';
import { GUILD_TILE_IDS, GUILD_TILES } from './guild';
import { scoreObjective } from './objectives';
import { scorePlayer } from './scoring';

/**
 * Texts that PARSE to supported steps but whose runtime behavior is a
 * documented approximation. Keep this list honest: each entry must match at
 * least one printed ability text (the test below fails on stale entries) and
 * every approximation should eventually be replaced by a real implementation.
 */
const KNOWN_PARTIAL: { pattern: RegExp; note: string }[] = [];

describe('ability coverage', () => {
  it('parses every distinct ability text into fully-supported steps', () => {
    const r = abilityCoverage(DRAGONS, CAVES);
    expect(r.supported).toBe(r.total);
    expect(r.missing).toEqual([]);
  });

  it('keeps the known-partial allowlist honest', () => {
    const texts = [...DRAGONS, ...CAVES].map((c) => c.ability).filter((t): t is string => !!t);
    for (const kp of KNOWN_PARTIAL) {
      expect(
        texts.some((t) => kp.pattern.test(t)),
        `allowlist entry matches no card text — remove it or fix the impl: ${kp.note}`,
      ).toBe(true);
    }
  });

  it('verifies fledgling N^2 printed VP, trained-only EndGame purple abilities, Keening Amphiptere, Ordinary Resplendent Coatl, Striped Dragonette, pay-for-VP EndGame, friendly objective ties, and all 9 Guild tiles', () => {
    const s = createGame({ seed: 5, playerNames: ['P1', 'P2', 'P3'] });
    s.pending = [];
    const p1 = s.players[0]!;
    const p2 = s.players[1]!;
    const p3 = s.players[2]!;

    // 1. Fledglings: 3 fledglings on mat -> each scores 3 printed VP = 9 VP total.
    // Card 290 (Jejune Firedragon, Fledgling, Playful, track length 2):
    // EndGame "Gain +[VP-2] for each PLAYFUL dragon on your player mat."
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 290, eggs: 0, tucked: [], cached: [], training: 0 };
    p1.caves[1]!.spaces[0]!.dragon = { cardId: 258, eggs: 0, tucked: [], cached: [], training: 0 };
    p1.caves[2]!.spaces[0]!.dragon = { cardId: 259, eggs: 0, tucked: [], cached: [], training: 0 };

    const untrainedScore = scorePlayer(s, p1);
    expect(untrainedScore.printedDragonVp).toBe(9);
    // Untrained Jejune Firedragon's purple EndGame ability is inactive!
    expect(untrainedScore.endGameAbilities).toBe(0);

    // Once fully trained (training = 2), Jejune Firedragon's EndGame ability scores +2 VP per Playful dragon (290 & 258 = 4 VP).
    p1.caves[0]!.spaces[0]!.dragon!.training = 2;
    const trainedScore = scorePlayer(s, p1);
    expect(trainedScore.printedDragonVp).toBe(9);
    expect(trainedScore.endGameAbilities).toBe(4);

    // 2. Keening Amphiptere (id 17): recurring 3rd-tuck trigger + EndGame +1 VP per tucked card here.
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 17, eggs: 0, tucked: [1, 2], cached: [] };
    ensureDragonHooks(p1.caves[0]!.spaces[0]!.dragon!, true);
    p1.caves[1]!.spaces[0]!.dragon = null;
    p1.caves[2]!.spaces[0]!.dragon = null;
    expect(parseAbility(DRAGONS.find((d) => d.id === 17)!).endGame).toEqual({
      vpPer: 1,
      counter: { kind: 'tucked', where: 'here' },
    });
    p1.caves[0]!.spaces[0]!.dragon!.tucked.push(3);
    const sAfterTuck = fireRecurring(s, 'p1', { cave: 0, space: 0 }, 'tuck', 'dragonCard');
    // 3rd tucked card triggered "+2 DragonGuild" -> advanced p1 to space 1 (lay 1 egg) with 1 guild step remaining in resume!
    expect(sAfterTuck.guild.track.p1).toBe(1);
    expect(sAfterTuck.pending[0]?.kind).toBe('chooseEggSpot');
    const keeningScore = scorePlayer(sAfterTuck, sAfterTuck.players[0]!);
    expect(keeningScore.tucked).toBe(3);
    expect(keeningScore.endGameAbilities).toBe(3);

    // 3. Ordinary Resplendent Coatl (id 90): requires Hatchling + Small + Large in its cave.
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 90, eggs: 0, tucked: [], cached: [] }; // Medium
    p1.caves[0]!.spaces[1]!.excavated = true;
    p1.caves[0]!.spaces[1]!.dragon = { cardId: 16, eggs: 0, tucked: [], cached: [] }; // Hatchling
    expect(scorePlayer(s, p1).endGameAbilities).toBe(0); // missing Small and Large
    p1.caves[0]!.spaces[2]!.excavated = true;
    p1.caves[0]!.spaces[2]!.dragon = { cardId: 40, eggs: 0, tucked: [], cached: [] }; // Small (Striped Dragonette)
    p1.caves[0]!.spaces[3]!.excavated = true;
    p1.caves[0]!.spaces[3]!.dragon = { cardId: 41, eggs: 0, tucked: [], cached: [] }; // Large
    // Coatl (90) scores +8 VP; Great Golden Lung Dragon (41) scores +3*3 = 9 VP.
    expect(scorePlayer(s, p1).endGameAbilities).toBeGreaterThanOrEqual(17);

    // 4. Striped Dragonette (id 40): +2 VP per objective where your marker is placed the lowest (include ties).
    p1.caves[0]!.spaces = p1.caves[0]!.spaces.map((sp, i) => ({
      ...sp,
      dragon: i === 0 ? { cardId: 40, eggs: 0, tucked: [], cached: [] } : null,
    }));
    p1.objectiveVps = [4, 0, 2, 0];
    p2.objectiveVps = [1, 5, 2, 7];
    p3.objectiveVps = [1, 2, 6, 4];
    // p1 is lowest in rounds 1 (0), 2 (tied at 2), and 3 (0) = 3 objectives -> 6 VP.
    expect(scorePlayer(s, p1).endGameAbilities).toBe(6);

    // 5. Pay-for-VP EndGame dragons (85, 86, 143, 148): convert items into VP and deduct from leftovers.
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 85, eggs: 0, tucked: [], cached: [] }; // 2 dragon cards -> +3 VP
    p1.caves[1]!.spaces[0]!.dragon = { cardId: 148, eggs: 0, tucked: [], cached: [] }; // 1 res + 1 cave + 1 dragon -> +5 VP
    p1.hand = [1, 2, 3, 183]; // 3 dragon cards + 1 cave card
    p1.resources = { meat: 1, gold: 0, crystal: 0, milk: 0 }; // 1 resource
    const payScore = scorePlayer(s, p1);
    expect(payScore.endGameAbilities).toBe(8); // 3 + 5
    expect(payScore.leftovers).toBe(0); // all 5 items were spent on 85 and 148!

    // 6. Friendly ties on scoreObjective (compressed ranks: two tied for 1st -> next player gets 2nd place VP).
    s.objectives[0] = 'totalDragons';
    p1.caves[0]!.spaces[0]!.dragon = { cardId: 1, eggs: 0, tucked: [], cached: [] };
    p1.caves[1]!.spaces[0]!.dragon = { cardId: 2, eggs: 0, tucked: [], cached: [] }; // 2 dragons
    p2.caves[0]!.spaces[0]!.dragon = { cardId: 3, eggs: 0, tucked: [], cached: [] };
    p2.caves[1]!.spaces[0]!.dragon = { cardId: 4, eggs: 0, tucked: [], cached: [] }; // 2 dragons (tied for 1st)
    p3.caves[0]!.spaces[0]!.dragon = { cardId: 5, eggs: 0, tucked: [], cached: [] }; // 1 dragon (gets 2nd place!)
    expect(scoreObjective(s, 0)).toEqual({ p1: 4, p2: 4, p3: 1 });

    // 7. All 9 Guild tiles have working endGame squares.
    expect(GUILD_TILE_IDS.length).toBe(9);
    for (const tileId of GUILD_TILE_IDS) {
      const tile = GUILD_TILES[tileId];
      expect(tile.squares.some((sq) => sq.endGame != null)).toBe(true);
    }
  });
});
