// applyAction: the single entry point for all state mutations, plus `settle`
// which drains turn/round/game transitions after every action (mirroring the
// wingspan engine's structure).

import { entice, excavate, exchange, explore, nextTurnPlayer, pass } from './actions';
import { cardAbilityTypes, dragonCard } from './cards';
import { collectIncome, resolveChoice, runAbility } from './effects';
import { clone, log, player, refreshDisplays, refillDisplayGaps } from './helpers';
import { scoreObjective } from './objectives';
import { scoreGame } from './scoring';
import type { Action, GameState, PlayerId } from './types';

export function applyAction(state: GameState, action: Action): GameState {
  let s = state;
  switch (action.type) {
    case 'keepSetup': {
      // Combined setup answer: keep 4 of 6 cards, then choose 3 resources.
      s = resolveChoice(s, action.playerId, { kind: 'cards', cardIds: action.keepCards });
      if (s.pending[0]?.kind === 'setupResources' && s.pending[0].playerId === action.playerId) {
        s = resolveChoice(s, action.playerId, { kind: 'resources', resources: action.resources });
      }
      break;
    }
    case 'resolveChoice':
      s = resolveChoice(s, action.playerId, action.answer);
      break;
    case 'excavate':
      if (s.phase !== 'main' || s.turn !== action.playerId || s.pending.length) return s;
      s = excavate(s, action.playerId, action.cave, action.cardId);
      s = endAction(s);
      break;
    case 'entice':
      if (s.phase !== 'main' || s.turn !== action.playerId || s.pending.length) return s;
      s = entice(s, action.playerId, action.cave, action.cardId);
      s = endAction(s);
      break;
    case 'explore':
      if (s.phase !== 'main' || s.turn !== action.playerId || s.pending.length) return s;
      s = explore(s, action.playerId, action.cave);
      s = endAction(s);
      break;
    case 'pass':
      if (s.phase !== 'main' || s.turn !== action.playerId || s.pending.length) return s;
      s = pass(s, action.playerId);
      s = endAction(s);
      break;
    case 'exchange':
      if (s.phase !== 'main' || s.pending.length) return s;
      s = exchange(s, action.playerId, action.give, action.get);
      break;
  }
  return settle(s);
}

// ---------------------------------------------------------------------------
// Turn / round / game flow

/** After a turn action: discard-down check, then hand off or end the round. */
function endAction(state: GameState): GameState {
  let s = state;
  // Effects may have queued pending steps — resolve those first; the turn
  // handoff happens once they drain (handled in settle via turnEnding flag).
  if (s.pending.length) {
    return { ...s, turnEnding: true };
  }
  return advanceTurn(s);
}

function advanceTurn(state: GameState): GameState {
  let s = state;
  const p = player(s, s.turn);
  // Discard down to 9 coins / 9 cards / 9 resources.
  const res = p.resources.meat + p.resources.gold + p.resources.crystal + p.resources.milk;
  if (p.coins > 9 || p.hand.length > 9 || res > 9) {
    s = pushDiscardDown(s, p.id);
    return { ...s, turnEnding: true };
  }
  if (s.players.every((q) => q.passed)) {
    return endRound(s);
  }
  const next = nextTurnPlayer(s);
  s = { ...s, turn: next, turnIndex: s.playerOrder.indexOf(next), turnEnding: false };
  return s;
}

function pushDiscardDown(state: GameState, playerId: PlayerId): GameState {
  const p = clone(player(state, playerId));
  // Auto-trim coins; cards/resources need a choice (coarse: auto-discard extras).
  p.coins = Math.min(p.coins, 9);
  let s = { ...state, players: state.players.map((q) => (q.id === p.id ? p : q)) };
  s = { ...s, pending: [...s.pending, { kind: 'discardDown', playerId }] };
  return s;
}

function endRound(state: GameState): GameState {
  let s = state;
  s = log(s, `round ${s.round} ended`);

  // 1. Once-per-round abilities, in turn order from the start player.
  const order = [...s.playerOrder.slice(s.playerOrder.indexOf(s.startPlayer)), ...s.playerOrder.slice(0, s.playerOrder.indexOf(s.startPlayer))];
  for (const pid of order) {
    const p = player(s, pid);
    for (const [cave, row] of p.caves.entries()) {
      for (const [space, sp] of row.spaces.entries()) {
        if (!sp.dragon) continue;
        const card = dragonCard(sp.dragon.cardId);
        if (cardAbilityTypes(card).includes('OncePerRound')) {
          s = runAbility(s, pid, { cave, space }, ['OncePerRound']);
        }
      }
    }
  }

  // 2. Score the round objective.
  const scores = scoreObjective(s, s.round - 1);
  s = {
    ...s,
    players: s.players.map((p) => ({ ...p, objectiveVps: [...p.objectiveVps, scores[p.id] ?? 0] })),
  };
  s = log(s, `objective scored: ${JSON.stringify(scores)}`);

  if (s.round >= 4) {
    return endGame(s);
  }

  // 3. Refresh both displays.
  s = refreshDisplays(s);

  // 4. Rotate the start player marker.
  const startIdx = (s.playerOrder.indexOf(s.startPlayer) + 1) % s.playerOrder.length;
  const start = s.playerOrder[startIdx]!;
  s = { ...s, startPlayer: start };

  if (s.expansions.includes('academy')) {
    // 5. Academy: each player collects the income space they claimed when
    // passing, in turn order from the new start player. settle() drains
    // incomeQueue and begins the next round once empty.
    const order = [...s.playerOrder.slice(startIdx), ...s.playerOrder.slice(0, startIdx)];
    s = { ...s, phase: 'roundEnd', incomeQueue: order };
    return s;
  }

  // Base upkeep: +6 coins, +1 egg, adventurers retrieved.
  const players = s.players.map((p) => {
    const q = clone(p);
    q.coins += 6;
    // gain an egg if there's room (mat nests or any dragon capacity)
    if (q.nestEggs < 2) q.nestEggs += 1;
    else {
      outer: for (const row of q.caves) {
        for (const sp of row.spaces) {
          if (sp.dragon && sp.dragon.eggs < dragonCard(sp.dragon.cardId).capacity) {
            sp.dragon.eggs += 1;
            break outer;
          }
        }
      }
    }
    q.explores = { crimson: 0, golden: 0, amethyst: 0 };
    q.passed = false;
    return q;
  });
  s = {
    ...s,
    players,
    round: s.round + 1,
    turn: start,
    turnIndex: startIdx,
    turnEnding: false,
  };
  s = log(s, `round ${s.round} begins`);
  return s;
}

function endGame(state: GameState): GameState {
  let s: GameState = { ...state, phase: 'gameEnd' };
  const { scores, winners } = scoreGame(s);
  s = { ...s, finalScores: scores, winners };
  s = log(s, `game over: ${winners.join(', ')} win(s)`);
  return s;
}

// ---------------------------------------------------------------------------
// settle: after every action, finish phase transitions once pending drains.

export function settle(state: GameState): GameState {
  let s = state;
  for (;;) {
    // Setup complete -> main phase.
    if (s.phase === 'setup' && s.pending.length === 0) {
      s = { ...s, phase: 'main' };
      continue;
    }
    // Academy round end: drain the income queue between pending answers.
    if (s.phase === 'roundEnd' && s.pending.length === 0) {
      // Drafted display cards are immediately refilled.
      s = refillDisplayGaps(s);
      if (s.incomeQueue.length) {
        const pid = s.incomeQueue[0]!;
        s = { ...s, incomeQueue: s.incomeQueue.slice(1) };
        s = collectIncome(s, pid);
        continue;
      }
      // All income collected — begin the next round.
      s = {
        ...s,
        phase: 'main',
        round: s.round + 1,
        turn: s.startPlayer,
        turnIndex: s.playerOrder.indexOf(s.startPlayer),
        turnEnding: false,
        incomeChoices: {},
        players: s.players.map((p) => {
          const q = clone(p);
          q.explores = { crimson: 0, golden: 0, amethyst: 0 };
          q.passed = false;
          return q;
        }),
      };
      s = log(s, `round ${s.round} begins`);
      continue;
    }
    // A turn action finished resolving its pending chain -> advance the turn.
    if (s.phase === 'main' && s.turnEnding && s.pending.length === 0) {
      s = { ...s, turnEnding: false };
      s = advanceTurn(s);
      continue;
    }
    break;
  }
  return s;
}
