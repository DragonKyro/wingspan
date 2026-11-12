// Heuristic seat driver. Priority: answer my pending step -> take my turn
// (play the best fish or dive the most rewarding site) -> endTurn. Returns
// null when there is nothing for this player to do.

import { fish } from '../cards';
import {
  allSlots,
  canPlayFish,
  getPlayer,
  legalSlots,
  slotAt,
  topFish,
  zoneHasFish,
} from '../helpers';
import { chooseForPending } from './choices';
import type { Action, GameState, PlayerId } from '../types';
import { DIVERS_PER_WEEK, ZONES, zoneOfRow } from '../types';

/** Rough value of diving site `col` right now. */
function diveValue(state: GameState, p: ReturnType<typeof getPlayer>, col: number): number {
  const isSR = state.settings.sets.includes('sr');
  let v = 0;
  const slots = [...allSlots(p.ocean)];
  for (let zi = 0; zi < ZONES.length; zi++) {
    const zone = ZONES[zi]!;
    if (zoneHasFish(p.ocean, col, zone)) v += 1.5; // printed zone bonus (twilight's is reprinted on the reef overlay)
    if (isSR && zi === 1 && p.ocean.corals[col]! < 6) v += 1.2; // reef option
    for (const { ref } of slots) {
      if (ref.col !== col || zoneOfRow(ref.row) !== zone) continue;
      const c = topFish(slotAt(p.ocean, ref));
      if (c?.abilityType === 'IfActivated' && c.ability) v += 1.6;
    }
  }
  if (!p.bottomTaken[col]) v += 1.5;
  return v;
}

/** Rough value of playing `card` now. */
function playValue(_p: ReturnType<typeof getPlayer>, card: ReturnType<typeof fish>): number {
  let v = card.points + 0.5 * card.length * 0.05;
  if (card.abilityType === 'WhenPlayed' && card.ability) v += 2;
  if (card.abilityType === 'IfActivated' && card.ability) v += 1.5;
  if (card.abilityType === 'GameEnd' && card.ability) v += 1.5;
  // Consuming a fish is also +1 point at scoring.
  v += 0.5;
  return v;
}

export function chooseAction(state: GameState, playerId: PlayerId): Action | null {
  if (state.phase === 'gameOver') return null;

  // Answer my pending step first.
  if (state.pending.length && state.pending[0]!.playerId === playerId) {
    return { type: 'resolveChoice', playerId, choice: chooseForPending(state, state.pending[0]!) };
  }
  if (state.pending.length) return null;
  if (state.phase !== 'main') return null;

  const me = state.playerOrder[state.currentPlayerIndex]!;
  if (me !== playerId) return null;
  if (state.turnTookAction) return { type: 'endTurn', playerId };

  const p = getPlayer(state, playerId);
  if (p.diversUsed >= DIVERS_PER_WEEK) return { type: 'endTurn', playerId };

  if (state.nautoma && playerId === 'p2') {
    return { type: 'nautomaTurn', playerId: 'p2' };
  }

  // Best playable fish.
  const playable = p.hand
    .map((id) => fish(id))
    .filter((c) => !c.forage && canPlayFish(p, c))
    .sort((a, b) => playValue(p, b) - playValue(p, a));

  const best = playable[0];
  const bestPlayValue = best ? playValue(p, best) : -1;

  // Best dive site.
  let bestCol = 0;
  let bestDive = -1;
  for (let col = 0; col < 3; col++) {
    const v = diveValue(state, p, col);
    if (v > bestDive) {
      bestDive = v;
      bestCol = col;
    }
  }

  // Play when it beats diving, or when the hand is bloated and a slot exists.
  if (best && (bestPlayValue >= bestDive || p.hand.length >= 6 || bestDive <= 0)) {
    const spots = legalSlots(p.ocean, best);
    const ref = spots[0]!;
    const handMinusCard = p.hand.filter((x) => x !== best.id);
    const discardCardIds = [...handMinusCard]
      .sort((a, b) => fish(a).points - fish(b).points)
      .slice(0, best.cost.cards);
    const slots = [...allSlots(p.ocean)];
    const eggSlots = slots.filter(({ slot }) => slot.eggs > 0).map((x) => x.ref).slice(0, best.cost.eggs);
    const youngSlots: { row: number; col: number }[] = [];
    for (const { ref, slot } of slots) {
      for (let i = 0; i < slot.young && youngSlots.length < best.cost.young; i++) youngSlots.push(ref);
    }
    const schoolSlots = slots.filter(({ slot }) => slot.school).map((x) => x.ref).slice(0, best.cost.schools);
    return {
      type: 'playFish',
      playerId,
      cardId: best.id,
      row: ref.row,
      col: ref.col,
      discardCardIds,
      eggSlots,
      youngSlots,
      schoolSlots,
    };
  }

  // Diving is always legal (a diver travels the whole column regardless).
  return { type: 'dive', playerId, col: bestCol };
}
