// Executes parsed fish abilities. Choice-based benefits queue PendingSteps;
// unambiguous benefits (draw, "on each" eggs, fixed-site coral) apply
// immediately. "(all players)" abilities run for every player in clockwise
// order starting with the active player — each may decline their choice
// benefits (steps are optional).

import { parseAbility, type Effect } from './abilities';
import {
  addEgg,
  allSlots,
  appendLog,
  getPlayer,
  matchesSlotFilter,
  placeCoral,
  setPlayer,
  drawFromDeck,
  pushPending,
} from './helpers';
import { siteIndex } from './helpers';
import type { GameState, PlayerId, SlotFilter, SlotRef } from './types';
import { MAX_CORAL } from './constants';

/** Players in benefit order: active player first, then clockwise. */
export function benefitOrder(state: GameState, activeId: PlayerId): PlayerId[] {
  const idx = state.playerOrder.indexOf(activeId);
  const out: PlayerId[] = [];
  for (let i = 0; i < state.playerOrder.length; i++) {
    out.push(state.playerOrder[(idx + i) % state.playerOrder.length]!);
  }
  return out;
}

/** Does this egg step have any legal target right now? */
function eggTargetExists(state: GameState, playerId: PlayerId, filter?: SlotFilter): boolean {
  const p = getPlayer(state, playerId);
  for (const { ref, slot } of allSlots(p.ocean)) {
    if (slot.stack.length === 0 || slot.eggs > 0) continue;
    if (filter && !matchesSlotFilter(p.ocean, ref, filter)) continue;
    return true;
  }
  return false;
}

/** Auto-place eggs on every matching fish that lacks one ("on each"). */
function eggsOnEach(state: GameState, playerId: PlayerId, filter?: SlotFilter): GameState {
  let p = getPlayer(state, playerId);
  for (const { ref, slot } of allSlots(p.ocean)) {
    if (slot.stack.length === 0 || slot.eggs > 0) continue;
    if (filter && !matchesSlotFilter(p.ocean, ref, filter)) continue;
    p = addEgg(p, ref);
  }
  return setPlayer(state, p);
}

function hasAnyEgg(state: GameState, playerId: PlayerId): boolean {
  const p = getPlayer(state, playerId);
  for (const { slot } of allSlots(p.ocean)) if (slot.eggs > 0) return true;
  return false;
}

function hasAnySchool(state: GameState, playerId: PlayerId): boolean {
  const p = getPlayer(state, playerId);
  for (const { slot } of allSlots(p.ocean)) if (slot.school) return true;
  return false;
}

function hasAnyYoung(state: GameState, playerId: PlayerId): boolean {
  const p = getPlayer(state, playerId);
  for (const { slot } of allSlots(p.ocean)) if (slot.young > 0 || slot.school) return true;
  return false;
}

function canRecoverOrDraw(state: GameState, playerId: PlayerId): boolean {
  const p = getPlayer(state, playerId);
  return (
    p.discard.length > 0 ||
    state.deck.length > 0 ||
    state.players.some((pl) => pl.discard.length > 0)
  );
}

function applyEffect(
  state: GameState,
  playerId: PlayerId,
  source: SlotRef | undefined,
  e: Effect,
  optional: boolean,
): GameState {
  const hasPending = state.pending.length > 0;
  switch (e.kind) {
    case 'draw':
      return drawFromDeck(state, playerId, 1);
    case 'discard':
      // [Discard] in FinSearch is the sideways fish-skeleton card icon:
      // "Gain any card from your discard pile to your hand. If you have none
      //  remaining, draw the top card of the deck instead." (fish_p12.png)
      if (!canRecoverOrDraw(state, playerId) && !hasPending) return state;
      return pushPending(state, { kind: 'chooseRecover', playerId, count: 1, optional });
    case 'egg': {
      if (e.onEach) return eggsOnEach(state, playerId, e.filter);
      if (!eggTargetExists(state, playerId, e.filter) && !hasPending) return state;
      return pushPending(state, { kind: 'chooseEggTargets', playerId, count: 1, filter: e.filter, optional });
    }
    case 'hatch':
      if (!hasAnyEgg(state, playerId) && !hasPending) return state;
      return pushPending(state, { kind: 'chooseHatch', playerId, count: 1, optional });
    case 'young':
      return pushPending(state, { kind: 'chooseYoungSlots', playerId, count: 1, optional });
    case 'move':
      if (!hasAnyYoung(state, playerId) && !hasPending) return state;
      return pushPending(state, { kind: 'chooseMove', playerId, count: 1, optional });
    case 'consume': {
      // Skip when nothing in hand could be tucked and no prior step is pending.
      const p = getPlayer(state, playerId);
      if (p.hand.length === 0 && !hasPending) return state;
      const onto = e.onto === 'self' ? source : undefined;
      return pushPending(state, { kind: 'chooseConsume', playerId, count: e.n, onto, optional });
    }
    case 'playFromHand':
      if (getPlayer(state, playerId).hand.length === 0 && !hasPending) return state;
      return pushPending(state, {
        kind: 'choosePlayFromHand',
        playerId,
        free: false,
        restrict: e.restrict,
        optional,
      });
    case 'freePlayFromHand':
      if (getPlayer(state, playerId).hand.length === 0 && !hasPending) return state;
      return pushPending(state, {
        kind: 'choosePlayFromHand',
        playerId,
        free: true,
        filter: e.filter,
        restrict: e.restrict,
        optional,
      });
    case 'unSchool':
      if (hasAnySchool(state, playerId) || hasPending) {
        return pushPending(state, { kind: 'chooseUnSchool', playerId, count: 1, optional });
      }
      // "or place 1 young instead if you don't have a school token to discard"
      return pushPending(state, { kind: 'chooseYoungSlots', playerId, count: 1, optional });
    case 'coral': {
      const p = getPlayer(state, playerId);
      if (e.site !== 'any') {
        const col = siteIndex(e.site);
        return p.ocean.corals[col]! >= MAX_CORAL ? state : setPlayer(state, placeCoral(p, col));
      }
      if (p.ocean.corals.every((c) => c >= MAX_CORAL)) return state;
      return pushPending(state, { kind: 'chooseCoralSite', playerId, count: 1, optional });
    }
  }
}

/** Fire the ability on the fish at `ref` (undefined for non-slot sources).
 *  `optional` marks choice steps as decline-able (always true in practice —
 *  Finspan benefits are optional). */
export function fireAbility(
  state: GameState,
  playerId: PlayerId,
  rawAbility: string | null,
  ref: SlotRef | undefined,
  logLabel: string,
): GameState {
  const parsed = parseAbility(rawAbility);
  if (!parsed || parsed.wave) return state;

  let s = appendLog(state, `${logLabel} fires`);

  // "if no coral in this fish's dive site" gate.
  if (parsed.ifNoCoralThisSite && ref) {
    const p = getPlayer(s, playerId);
    if (p.ocean.corals[ref.col]! > 0) return appendLog(s, 'skipped (coral present)');
  }

  const targets = parsed.allPlayers ? benefitOrder(s, playerId) : [playerId];
  for (const pid of targets) {
    if (s.nautoma && pid === 'p2') {
      if (playerId !== 'p2' && parsed.allPlayers) {
        s = { ...s, nautoma: { ...s.nautoma, eggs: s.nautoma.eggs + 1 } };
        s = appendLog(s, 'Nautoma gains 1 egg from (all players) ability');
      }
      continue;
    }
    for (const e of parsed.effects) {
      s = applyEffect(s, pid, ref, e, true);
    }
  }

  // Two-part IfActivated: gated on >=count coral of `site` in THIS dive site.
  // The colored icon literally means "this dive site is the <site> site AND
  // it holds >= count coral" — a fish in the wrong site can never satisfy it.
  if (parsed.alsoIf && ref) {
    const p = getPlayer(s, playerId);
    const coralCol = siteIndex(parsed.alsoIf.site);
    if (ref.col === coralCol && p.ocean.corals[coralCol]! >= parsed.alsoIf.count) {
      s = appendLog(s, `coral-gated part activates (${parsed.alsoIf.count} ${parsed.alsoIf.site} coral)`);
      for (const e of parsed.alsoIf.effects) {
        s = applyEffect(s, playerId, ref, e, true);
      }
    }
  }

  return s;
}
