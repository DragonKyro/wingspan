// Achievement unit counts and final scoring.

import { parseAbility, type WaveCond } from './abilities';
import {
  allSlots,
  consumedCount,
  fullRows,
  slotAt,
  topFish,
  totalConsumed,
  totalEggs,
  totalSchools,
  totalYoung,
} from './helpers';
import {
  CONSUMED_POINTS,
  CORAL_POINTS,
  REEF_COMPLETION_BONUS,
  SCHOOL_POINTS,
  TOKEN_POINTS,
} from './constants';
import type {
  Achievement,
  AchievementKind,
  GameState,
  PlayerId,
  PlayerState,
  ScoreBreakdown,
  SlotRef,
} from './types';
import { DEEPWATER_ROW, zoneOfRow } from './types';

/** Units counted by an achievement for one player. */
export function achievementUnits(p: PlayerState, kind: AchievementKind): number {
  const slots = [...allSlots(p.ocean)];
  switch (kind) {
    case 'eggs':
      return totalEggs(p.ocean);
    case 'young':
      return totalYoung(p.ocean);
    case 'eggsAndYoung':
      return totalEggs(p.ocean) + totalYoung(p.ocean);
    case 'fullRows':
      return fullRows(p.ocean);
    case 'fish':
      return slots.filter(({ slot }) => slot.stack.length > 0).length;
    case 'tagPredator':
      return slots.filter(({ slot }) => {
        const c = topFish(slot);
        return c != null && !c.forage && c.tags.predator > 0;
      }).length;
    case 'schools':
      return totalSchools(p.ocean);
    case 'fishWithTokens':
      return slots.filter(({ slot }) => slot.stack.length > 0 && (slot.eggs > 0 || slot.young > 0 || slot.school)).length;
    case 'consumedFish':
      return totalConsumed(p.ocean);
    case 'fishPoints1to3':
      return slots.filter(({ slot }) => {
        const c = topFish(slot);
        return c != null && !c.forage && c.points >= 1 && c.points <= 3;
      }).length;
    case 'uniqueTags': {
      // S&R tile: count unique tag TYPES across visible fish. Über predator
      // "counts for all predator achievements" so it contributes both
      // 'predator' and 'über predator'; likewise electric discharge
      // contributes 'active electrolocation' + 'electric discharge'.
      const tags = new Set<string>();
      for (const { slot } of slots) {
        const c = topFish(slot);
        if (!c || c.forage) continue;
        if (c.tags.bioluminescent > 0) tags.add('bioluminescent');
        if (c.tags.camouflage > 0) tags.add('camouflage');
        if (c.tags.venomous > 0) tags.add('venomous');
        if (c.tags.electric === 1) tags.add('electrolocation');
        if (c.tags.electric >= 2) {
          tags.add('electrolocation');
          tags.add('electricDischarge');
        }
        if (c.tags.predator === 1) tags.add('predator');
        if (c.tags.predator >= 2) {
          tags.add('predator');
          tags.add('uberPredator');
        }
      }
      return tags.size;
    }
    case 'fishSunlight':
      return slots.filter(({ ref, slot }) => slot.stack.length > 0 && zoneOfRow(ref.row) === 'sunlight').length;
    case 'coral':
      return p.ocean.corals.reduce((a, b) => a + b, 0);
  }
}

export function scoreAchievement(p: PlayerState, ach: Achievement): number {
  return achievementUnits(p, ach.kind) * ach.per;
}

/** Evaluate a wave (GAME END point) condition against the fish at `ref`. */
export function waveCondMet(p: PlayerState, ref: SlotRef, cond: WaveCond): boolean {
  const slot = slotAt(p.ocean, ref);
  switch (cond.kind) {
    case 'noTokens':
      return slot.eggs === 0 && slot.young === 0 && !slot.school;
    case 'consumedAtLeast':
      return consumedCount(slot) >= cond.n;
    case 'exactlyYoung':
      return slot.young === cond.n;
    case 'schoolOnFish':
      return slot.school;
    case 'bottomRow':
      return ref.row === DEEPWATER_ROW;
    case 'eggYoungSchool':
      return slot.eggs > 0 && slot.young > 0 && slot.school;
    case 'coralEachSiteAtLeast':
      return p.ocean.corals.every((c) => c >= cond.n);
    case 'coralThisSiteAtLeast':
      return p.ocean.corals[ref.col]! >= cond.n;
  }
}

/** Wave points from this player's visible GAME END fish. */
export function gameEndWavePoints(p: PlayerState): number {
  let pts = 0;
  for (const { ref, slot } of allSlots(p.ocean)) {
    const c = topFish(slot);
    if (!c || c.forage || c.abilityType !== 'GameEnd' || !c.ability) continue;
    const parsed = parseAbility(c.ability);
    if (parsed?.wave && waveCondMet(p, ref, parsed.wave.cond)) {
      pts += parsed.wave.points;
    }
  }
  return pts;
}

export function scorePlayer(state: GameState, p: PlayerState): ScoreBreakdown {
  const isSR = state.settings.sets.includes('sr');
  let fishPoints = 0;
  let consumed = 0;
  for (const { slot } of allSlots(p.ocean)) {
    const c = topFish(slot);
    if (c) fishPoints += c.points;
    consumed += consumedCount(slot);
  }
  const coralCount = p.ocean.corals.reduce((a, b) => a + b, 0);
  const reefBonus = isSR
    ? p.ocean.corals.reduce((sum, c, i) => sum + (c >= 6 ? REEF_COMPLETION_BONUS[i]! : 0), 0)
    : 0;

  const eggYoung = (totalEggs(p.ocean) + totalYoung(p.ocean)) * TOKEN_POINTS;
  const schools = totalSchools(p.ocean) * SCHOOL_POINTS;
  const consumedPts = consumed * CONSUMED_POINTS;
  const coralPts = isSR ? coralCount * CORAL_POINTS + reefBonus : 0;
  const wavePts = gameEndWavePoints(p);

  const total =
    p.achievementPoints + wavePts + fishPoints + consumedPts + eggYoung + schools + coralPts;
  return {
    achievementPoints: p.achievementPoints,
    gameEndAbilityPoints: wavePts,
    fishPoints,
    consumedPoints: consumedPts,
    eggYoungPoints: eggYoung,
    schoolPoints: schools,
    coralPoints: coralPts,
    total,
  };
}

/** Final scores + winner. Tie-breaker: most fish cards in hand. */
export function finalScores(state: GameState): {
  scores: Record<PlayerId, ScoreBreakdown>;
  winner: PlayerId[];
} {
  const scores = {} as Record<PlayerId, ScoreBreakdown>;
  for (const p of state.players) scores[p.id] = scorePlayer(state, p);
  const best = Math.max(...state.players.map((p) => scores[p.id]!.total));
  let winner = state.players.filter((p) => scores[p.id]!.total === best).map((p) => p.id);
  if (winner.length > 1) {
    const handBest = Math.max(
      ...state.players.filter((p) => winner.includes(p.id)).map((p) => p.hand.length),
    );
    winner = winner.filter((id) => state.players.find((p) => p.id === id)!.hand.length === handBest);
  }
  return { scores, winner };
}
