// Turn actions: playFish, dive, endTurn. Each turn costs exactly one diver
// (turnTookAction gates this); pending steps must be drained first. Week
// transitions happen inside endTurn (score achievement, reset divers,
// rotate the first-player token); the final week hands off to the gameEnd
// phase, whose queue drains in engine.settle().

import { parseAbility } from './abilities';
import { fish } from './cards';
import { DIVE_BONUSES, MAX_CORAL } from './constants';
import {
  allSlots,
  appendLog,
  applyPayments,
  drawFromDeck,
  getPlayer,
  placeFish,
  placementError,
  setPlayer,
  slotAt,
  topFish,
  validatePayments,
  zoneHasFish,
} from './helpers';
import { fireAbility } from './powers';
import { scoreAchievement } from './scoring';
import type {
  Action,
  Benefit,
  DiveAction,
  EndTurnAction,
  GameState,
  PendingStep,
  PlayFishAction,
  PlayerId,
  SlotRef,
} from './types';
import { DIVERS_PER_WEEK, zoneOfRow, ZONES } from './types';

function actor(state: GameState): PlayerId {
  return state.playerOrder[state.currentPlayerIndex]!;
}

function requireTurn(state: GameState, action: Action): void {
  if (state.phase !== 'main') throw new Error('not in the main phase');
  if (state.pending.length) throw new Error('resolve pending choices first');
  if (state.turnTookAction) throw new Error('already took an action this turn');
  if (action.playerId !== actor(state)) throw new Error('not your turn');
}

function pushStep(state: GameState, step: PendingStep): GameState {
  return { ...state, pending: [...state.pending, step] };
}

// === play a fish ==========================================================

export function doPlayFish(state: GameState, a: PlayFishAction): GameState {
  requireTurn(state, a);
  const card = fish(a.cardId);
  if (card.forage) throw new Error('forage fish cannot be played from hand');
  let p = getPlayer(state, a.playerId);
  if (!p.hand.includes(a.cardId)) throw new Error('card not in hand');

  const ref: SlotRef = { row: a.row, col: a.col };
  const err = placementError(p.ocean, card, ref);
  if (err) throw new Error(`illegal placement: ${err}`);

  validatePayments(p, card, a);
  p = applyPayments(p, card, a);
  p = { ...p, hand: p.hand.filter((id) => id !== a.cardId) };
  p = placeFish(p, card, ref);
  p = { ...p, diversUsed: p.diversUsed + 1 };

  let s = setPlayer(state, p);
  s = appendLog(s, `${p.name} plays ${card.name} at r${a.row}c${a.col}`);
  s = { ...s, turnTookAction: true };

  if (card.abilityType === 'WhenPlayed' && card.ability) {
    s = fireAbility(s, a.playerId, card.ability, ref, `${card.name} (when played)`);
  }
  return s;
}

// === dive =================================================================

/** Grant a printed dive-site benefit to the diving player. */
function grantBenefit(state: GameState, playerId: PlayerId, benefit: Benefit): GameState {
  const p = getPlayer(state, playerId);
  const slots = [...allSlots(p.ocean)];
  switch (benefit) {
    case 'drawCard':
      return drawFromDeck(state, playerId, 1);
    case 'egg': {
      const hasTarget = slots.some(({ slot }) => slot.stack.length > 0 && slot.eggs === 0);
      if (!hasTarget) return state;
      return pushStep(state, { kind: 'chooseEggTargets', playerId, count: 1, optional: true });
    }
    case 'hatch': {
      if (!slots.some(({ slot }) => slot.eggs > 0)) return state;
      return pushStep(state, { kind: 'chooseHatch', playerId, count: 1, optional: true });
    }
    case 'move': {
      if (!slots.some(({ slot }) => slot.young > 0 || slot.school)) return state;
      return pushStep(state, { kind: 'chooseMove', playerId, count: 1, optional: true });
    }
    case 'recoverCard': {
      if (p.discard.length === 0) {
        // Official FAQ: with an empty discard pile, draw from the deck instead.
        return drawFromDeck(state, playerId, 1);
      }
      return pushStep(state, { kind: 'chooseRecover', playerId, count: 1, optional: true });
    }
    default:
      return state;
  }
}

export function doDive(state: GameState, a: DiveAction): GameState {
  requireTurn(state, a);
  const col = a.col;
  if (col < 0 || col > 2) throw new Error('invalid dive site');
  const isSR = state.settings.sets.includes('sr');
  const bonuses = DIVE_BONUSES[col]!;

  let s = appendLog(state, `${getPlayer(state, a.playerId).name} dives the ${['blue', 'purple', 'green'][col]} site`);

  for (let zi = 0; zi < ZONES.length; zi++) {
    const zone = ZONES[zi]!;
    const isTwilight = zi === 1;
    // Re-read the player each step: activated abilities can mutate the ocean.
    let p = getPlayer(s, a.playerId);

    if (isSR && isTwilight) {
      // Reef overlay replaces the printed twilight bonus: optionally discard
      // the indicated item to place 1 coral (no fish requirement).
      if (p.ocean.corals[col]! < MAX_CORAL) {
        const item = s.settings.reefCosts?.[s.playerOrder.indexOf(a.playerId)] ?? 'egg';
        const pl = [...allSlots(p.ocean)];
        const feasible =
          (item === 'egg' && pl.some((x) => x.slot.eggs > 0)) ||
          (item === 'young' && pl.some((x) => x.slot.young > 0)) ||
          (item === 'card' && p.hand.length > 0);
        if (feasible) s = pushStep(s, { kind: 'chooseReefDiscard', playerId: a.playerId, col, item });
      }
    } else if (zoneHasFish(p.ocean, col, zone)) {
      s = grantBenefit(s, a.playerId, bonuses.zones[zi]!);
    }

    // IF ACTIVATED abilities, top to bottom within this zone (snapshot the
    // refs now — abilities may add fish but the pass order is fixed).
    p = getPlayer(s, a.playerId);
    const refs = [...allSlots(p.ocean)]
      .filter(({ ref }) => ref.col === col && zoneOfRow(ref.row) === zone)
      .map(({ ref }) => ref);
    for (const ref of refs) {
      const card = topFish(slotAt(getPlayer(s, a.playerId).ocean, ref));
      if (card && card.abilityType === 'IfActivated' && card.ability) {
        s = fireAbility(s, a.playerId, card.ability, ref, `${card.name} (if activated)`);
      }
    }
  }

  // Bottom bonus: only the first diver to bottom this site this week.
  let p = getPlayer(s, a.playerId);
  if (!p.bottomTaken[col]) {
    p = { ...p, bottomTaken: p.bottomTaken.map((b, i) => (i === col ? true : b)) };
    s = setPlayer(s, p);
    s = appendLog(s, `${p.name} reaches the bottom first (bottom bonus)`);
    s = grantBenefit(s, a.playerId, bonuses.bottom);
  }

  p = getPlayer(s, a.playerId);
  s = setPlayer(s, { ...p, diversUsed: p.diversUsed + 1 });
  return { ...s, turnTookAction: true };
}

// === end turn / week =======================================================

export function doEndTurn(state: GameState, a: EndTurnAction): GameState {
  if (state.phase !== 'main') throw new Error('not in the main phase');
  if (state.pending.length) throw new Error('resolve pending choices first');
  if (!state.turnTookAction) throw new Error('take an action first');
  if (a.playerId !== actor(state)) throw new Error('not your turn');

  let s = { ...state, turnTookAction: false };
  const n = s.playerOrder.length;

  // Next player in turn order who still has divers this week.
  for (let i = 1; i <= n; i++) {
    const idx = (s.currentPlayerIndex + i) % n;
    if (getPlayer(s, s.playerOrder[idx]!).diversUsed < DIVERS_PER_WEEK) {
      return { ...s, currentPlayerIndex: idx };
    }
  }

  // Everyone is out of divers -> end of week.
  s = appendLog(s, `week ${s.week + 1} ends`);

  if (s.week < 3) {
    const ach = s.achievements[s.week]!;
    const weekly = s.playerOrder.map((pid) => ({ pid, pts: scoreAchievement(getPlayer(s, pid), ach) }));
    for (const { pid, pts } of weekly) {
      const p = getPlayer(s, pid);
      s = setPlayer(s, { ...p, achievementPoints: p.achievementPoints + pts });
      s = appendLog(s, `${p.name} scores ${pts} for "${ach.name}"`);
    }
    // Side-B leader bonus: player(s) with the most points this week get +3.
    if (s.settings.achievementSide === 'B') {
      const best = Math.max(...weekly.map((x) => x.pts));
      if (best > 0) {
        for (const { pid } of weekly.filter((x) => x.pts === best)) {
          const p = getPlayer(s, pid);
          s = setPlayer(s, { ...p, achievementPoints: p.achievementPoints + 3 });
          s = appendLog(s, `${p.name} gains the 3-point achievement leader bonus`);
        }
      }
    }
    // New week: divers + bottom bonuses reset, first player rotates.
    s = {
      ...s,
      week: s.week + 1,
      firstPlayerIndex: (s.firstPlayerIndex + 1) % n,
      players: s.players.map((pl) => ({
        ...pl,
        diversUsed: 0,
        bottomTaken: [false, false, false],
      })),
    };
    s = { ...s, currentPlayerIndex: s.firstPlayerIndex };
    return appendLog(s, `week ${s.week + 1} begins`);
  }

  // End of week 4 -> game end phase: queue non-point GAME END abilities.
  const queue: { playerId: PlayerId; slot: SlotRef }[] = [];
  for (let i = 0; i < n; i++) {
    const pid = s.playerOrder[(s.firstPlayerIndex + i) % n]!;
    const p = getPlayer(s, pid);
    for (const { ref } of allSlots(p.ocean)) {
      const card = topFish(slotAt(p.ocean, ref));
      if (!card || card.abilityType !== 'GameEnd' || !card.ability) continue;
      const parsed = parseAbility(card.ability);
      if (parsed && !parsed.wave && parsed.effects.length > 0) {
        queue.push({ playerId: pid, slot: ref });
      }
    }
  }
  return appendLog(
    { ...s, phase: 'gameEnd', gameEndQueue: queue, pending: [] },
    `game end: ${queue.length} non-point abilities to resolve`,
  );
}
