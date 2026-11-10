// Turn actions: playFish, dive, endTurn. Each turn costs exactly one diver
// (turnTookAction gates this); pending steps must be drained first. Week
// transitions happen inside endTurn (score achievement, reset divers,
// rotate the first-player token); the final week hands off to the gameEnd
// phase, whose queue drains in engine.settle().

import { shuffle } from '../shared/rng';
import { parseAbility } from './abilities';
import {
  dealNautomaDeck,
  getNautomaDecisionCard,
  nautomaAchievementBase,
  scoreRavelWeek,
} from './automa';
import { fish } from './cards';
import { DIVE_BONUSES, MAX_CORAL, REEF_DISCARD_ITEMS } from './constants';
import {
  allSlots,
  appendLog,
  applyPayments,
  drawFromDeck,
  getPlayer,
  placeCoral,
  placeFish,
  placementError,
  setPlayer,
  siteIndex,
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
  NautomaState,
  NautomaTurnAction,
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

/** Grant a printed dive-site bonus benefit to the diving player. Every
 *  Benefit kind maps to either an immediate effect or a queued optional
 *  PendingStep (infeasible steps are auto-dropped by resolve.dropInfeasible). */
export function grantBenefit(state: GameState, playerId: PlayerId, benefit: Benefit): GameState {
  const p = getPlayer(state, playerId);
  const slots = [...allSlots(p.ocean)];
  const hasPending = state.pending.length > 0;
  switch (benefit) {
    case 'drawCard':
      return drawFromDeck(state, playerId, 1);
    case 'discardCard': {
      if (p.hand.length === 0 && !hasPending) return state;
      return pushStep(state, { kind: 'chooseHandDiscard', playerId, count: 1, optional: true });
    }
    case 'egg': {
      const hasTarget = slots.some(({ slot }) => slot.stack.length > 0 && slot.eggs === 0);
      if (!hasTarget && !hasPending) return state;
      return pushStep(state, { kind: 'chooseEggTargets', playerId, count: 1, optional: true });
    }
    case 'hatch': {
      if (!slots.some(({ slot }) => slot.eggs > 0) && !hasPending) return state;
      return pushStep(state, { kind: 'chooseHatch', playerId, count: 1, optional: true });
    }
    case 'young':
      return pushStep(state, { kind: 'chooseYoungSlots', playerId, count: 1, optional: true });
    case 'move': {
      if (!slots.some(({ slot }) => slot.young > 0 || slot.school) && !hasPending) return state;
      return pushStep(state, { kind: 'chooseMove', playerId, count: 1, optional: true });
    }
    case 'consumeHand': {
      if (p.hand.length === 0 && !hasPending) return state;
      return pushStep(state, { kind: 'chooseConsume', playerId, count: 1, optional: true });
    }
    case 'recoverCard': {
      if (p.discard.length === 0 && !hasPending) {
        // Official FAQ: with an empty discard pile, draw from the deck instead.
        return drawFromDeck(state, playerId, 1);
      }
      return pushStep(state, { kind: 'chooseRecover', playerId, count: 1, optional: true });
    }
    case 'unSchool': {
      // "Discard a school token, then place 1 young in each of four different
      //  slots. If you do not have a school token to discard, place 1 young."
      if (slots.some(({ slot }) => slot.school) || hasPending) {
        return pushStep(state, { kind: 'chooseUnSchool', playerId, count: 1, optional: true });
      }
      return pushStep(state, { kind: 'chooseYoungSlots', playerId, count: 1, optional: true });
    }
    case 'coralBlue':
    case 'coralPurple':
    case 'coralGreen': {
      const col = siteIndex(benefit === 'coralBlue' ? 'blue' : benefit === 'coralPurple' ? 'purple' : 'green');
      if (p.ocean.corals[col]! >= MAX_CORAL) return state;
      return setPlayer(state, placeCoral(p, col));
    }
    case 'coralAny': {
      if (p.ocean.corals.every((c) => c >= MAX_CORAL)) return state;
      return pushStep(state, { kind: 'chooseCoralSite', playerId, count: 1, optional: true });
    }
    default: {
      console.warn(`finspan: unhandled benefit kind ${benefit as string} — benefit dropped`);
      return state;
    }
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
        const item =
          s.settings.reefCosts?.[s.playerOrder.indexOf(a.playerId)]?.[col] ??
          REEF_DISCARD_ITEMS[col]!;
        const pl = [...allSlots(p.ocean)];
        const feasible =
          s.pending.length > 0 ||
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

// === nautoma turn =========================================================

export function doNautomaTurn(state: GameState, a: NautomaTurnAction): GameState {
  requireTurn(state, a);
  if (!state.nautoma || a.playerId !== 'p2') {
    throw new Error('nautomaTurn is only valid for Nautoma (p2)');
  }

  let s = state;
  const p2 = getPlayer(s, 'p2');
  s = setPlayer(s, { ...p2, diversUsed: p2.diversUsed + 1 });

  let nautoma: NautomaState = { ...s.nautoma! };
  if (nautoma.deck.length === 0) {
    throw new Error('Nautoma decision deck is empty');
  }
  const cardId = nautoma.deck[nautoma.deck.length - 1]!;
  nautoma.deck = nautoma.deck.slice(0, -1);
  nautoma.lastCardId = cardId;
  const card = getNautomaDecisionCard(cardId);

  s = appendLog(s, `Nautoma draws decision card #${cardId}`);

  // 1. Adjust Achievement Marker (ignored at difficulty 1 or during week 4).
  if (nautoma.difficulty !== 1 && s.week !== 3) {
    if (card.achievementDelta === 1) {
      nautoma.achievementDivers += 1;
    } else if (card.achievementDelta === -1) {
      nautoma.achievementDivers = Math.max(0, nautoma.achievementDivers - 1);
    }
  }

  // 2. Dive (1x 3 young -> 1 school; <=4x egg -> young; gain eggs).
  if (card.dive) {
    if (nautoma.young >= 3) {
      nautoma.young -= 3;
      nautoma.schools += 1;
    }
    const flip = Math.min(4, nautoma.eggs);
    nautoma.eggs -= flip;
    nautoma.young += flip;
    nautoma.eggs += card.diveEggs;
  }

  // S&R: Add Coral (convert 1 egg -> 1 coral, or 2 coral at difficulty 4-5).
  if (s.settings.sets.includes('sr') && card.addCoral && nautoma.eggs >= 1) {
    nautoma.eggs -= 1;
    nautoma.corals += nautoma.difficulty >= 4 ? 2 : 1;
  }

  // 3. Play a Fish Card (draw 1 fish; if (all players), human gains benefit once).
  let drawnFishId: number | null = null;
  if (card.playFish) {
    if (s.deck.length === 0) {
      const pool = s.players.flatMap((pl) => pl.discard);
      if (pool.length > 0) {
        const [deck, rng] = shuffle(s.rngState, pool);
        s = {
          ...s,
          deck,
          rngState: rng,
          players: s.players.map((pl) => ({ ...pl, discard: [] })),
        };
        s = appendLog(s, 'fish deck reshuffled from all discard piles');
      }
    }
    if (s.deck.length > 0) {
      drawnFishId = s.deck[s.deck.length - 1]!;
      s = { ...s, deck: s.deck.slice(0, -1) };
      nautoma.fish = [...nautoma.fish, drawnFishId];
    }
  }

  s = { ...s, nautoma, turnTookAction: true };

  if (drawnFishId != null) {
    const drawnCard = fish(drawnFishId);
    s = appendLog(s, `Nautoma gains fish ${drawnCard.name}`);
    const parsed = parseAbility(drawnCard.ability);
    if (parsed?.allPlayers) {
      s = fireAbility(s, 'p2', drawnCard.ability, undefined, `${drawnCard.name} (Nautoma all players)`);
    }
  }

  return s;
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

  // Ravel Mode end-of-week scoring (all 4 weeks, fish_automa_p06.png..p07.png).
  if (s.nautoma?.ravelMode && s.nautoma.ravelCardId) {
    const ravelPts = scoreRavelWeek(
      getPlayer(s, 'p1'),
      s.nautoma.ravelCardId,
      s.nautoma.ravelStrength,
    );
    s = {
      ...s,
      nautoma: { ...s.nautoma, ravelPoints: s.nautoma.ravelPoints + ravelPts },
    };
    s = appendLog(s, `Nautoma gains ${ravelPts} Ravel Mode points`);
  }

  if (s.week < 3) {
    const ach = s.achievements[s.week]!;
    const weekly: { pid: PlayerId; pts: number }[] = s.playerOrder.map((pid) => {
      if (s.nautoma && pid === 'p2') {
        if (s.nautoma.difficulty === 1) return { pid, pts: 0 };
        const side = s.nautoma.difficulty <= 3 ? 'calm' : 'stormy';
        const base = nautomaAchievementBase(s.week + 1, ach.kind, side);
        const units = Math.max(0, base + s.nautoma.achievementDivers);
        return { pid, pts: units * ach.per };
      }
      return { pid, pts: scoreAchievement(getPlayer(s, pid), ach) };
    });
    for (const { pid, pts } of weekly) {
      const p = getPlayer(s, pid);
      s = setPlayer(s, { ...p, achievementPoints: p.achievementPoints + pts });
      s = appendLog(s, `${p.name} scores ${pts} for "${ach.name}"`);
    }
    // Leader +3 bonus: in multiplayer on Side B; in Nautoma games ONLY at difficulty 5.
    const awardLeaderBonus = s.nautoma
      ? s.nautoma.difficulty === 5
      : s.settings.achievementSide === 'B';
    if (awardLeaderBonus) {
      const best = Math.max(...weekly.map((x) => x.pts));
      if (best > 0) {
        for (const { pid } of weekly.filter((x) => x.pts === best)) {
          const p = getPlayer(s, pid);
          s = setPlayer(s, { ...p, achievementPoints: p.achievementPoints + 3 });
          s = appendLog(s, `${p.name} gains the 3-point achievement leader bonus`);
        }
      }
    }
    // New week: divers + bottom bonuses reset; in Nautoma games human always goes first
    // and the 7 decision cards are reshuffled with 1 set aside unseen.
    let nextRng = s.rngState;
    let nextNautoma = s.nautoma;
    if (nextNautoma) {
      const dealt = dealNautomaDeck(nextRng);
      nextRng = dealt.rng;
      nextNautoma = {
        ...nextNautoma,
        deck: dealt.deck,
        setAside: dealt.setAside,
        lastCardId: null,
        achievementDivers: 0,
      };
    }
    const nextFirst = s.nautoma ? 0 : (s.firstPlayerIndex + 1) % n;
    s = {
      ...s,
      rngState: nextRng,
      ...(nextNautoma ? { nautoma: nextNautoma } : {}),
      week: s.week + 1,
      firstPlayerIndex: nextFirst,
      currentPlayerIndex: nextFirst,
      players: s.players.map((pl) => ({
        ...pl,
        diversUsed: 0,
        bottomTaken: [false, false, false],
      })),
    };
    return appendLog(s, `week ${s.week + 1} begins`);
  }

  // End of week 4 -> game end phase: queue non-point GAME END abilities.
  const queue: { playerId: PlayerId; slot: SlotRef }[] = [];
  for (let i = 0; i < n; i++) {
    const pid = s.playerOrder[(s.firstPlayerIndex + i) % n]!;
    if (s.nautoma && pid === 'p2') continue;
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
