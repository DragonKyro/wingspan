// applyAction: the single entry point for all state mutations, plus `settle`
// which drains turn/round/game transitions after every action (mirroring the
// wingspan engine's structure).

import { entice, excavate, exchange, explore, nextTurnPlayer, pass } from './actions';
import { buildAutomaRoundDeck, executeAutomaTurn } from './automa';
import { cardAbilityTypes, dragonCard, parseIcons } from './cards';
import { collectIncome, pushPending, resolveChoice, runAbility } from './effects';
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
      // Free conversion, but only on your own turn.
      if (s.phase !== 'main' || s.turn !== action.playerId || s.pending.length) return s;
      s = exchange(s, action.playerId, action.give, action.get);
      break;
    case 'automaTurn':
      if (!s.automa || s.phase !== 'main' || s.turn !== action.playerId || s.pending.length) return s;
      s = executeAutomaTurn(s, action.playerId);
      s = endAction(s);
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
  if (p.coins > 9) {
    const q = clone(p);
    q.coins = 9;
    s = { ...s, players: s.players.map((pl) => (pl.id === q.id ? q : pl)) };
  }
  const cur = player(s, s.turn);
  const res = cur.resources.meat + cur.resources.gold + cur.resources.crystal + cur.resources.milk;
  if (cur.hand.length > 9 || res > 9) {
    s = pushDiscardDown(s, cur.id);
    return { ...s, turnEnding: true };
  }
  // Rulebook p.11: "Do not refill dragons or cave cards into the card display
  // board until the end of each player's turn."
  s = refillDisplayGaps(s);
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

/**
 * Round end, step 1: queue every "once per round" dragon ability in turn
 * order starting with that round's start player. settle() drains the queue
 * (see below) before scoring the objective; abilities that queue choices
 * pause the drain until those choices resolve.
 */
function endRound(state: GameState): GameState {
  let s = state;
  s = log(s, `round ${s.round} ended`);

  const startIdx = s.playerOrder.indexOf(s.startPlayer);
  const order = [...s.playerOrder.slice(startIdx), ...s.playerOrder.slice(0, startIdx)];
  const queue: GameState['roundEndQueue'] = [];
  for (const pid of order) {
    const p = player(s, pid);
    for (const [cave, row] of p.caves.entries()) {
      for (const [space, sp] of row.spaces.entries()) {
        if (!sp.dragon) continue;
        const card = dragonCard(sp.dragon.cardId);
        if (!cardAbilityTypes(card).includes('OncePerRound')) continue;
        // Fledgling purple abilities are inactive until fully trained.
        if (card.size === 'Fledgling') {
          const track = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
          if ((sp.dragon.training ?? 0) < track) continue;
        }
        queue.push({ playerId: pid, pos: [cave, space] });
      }
    }
  }
  return { ...s, phase: 'roundEnd', roundEndQueue: queue, turnEnding: false };
}

/**
 * Round end, steps 2+: score the objective (once), then refresh displays,
 * rotate the start player, and either collect Academy income or run the
 * base upkeep and begin the next round. Called by settle() once the
 * once-per-round queue has fully drained.
 */
function finishRound(state: GameState): GameState {
  let s = state;

  // Score the round objective.
  const scores = scoreObjective(s, s.round - 1);
  s = {
    ...s,
    players: s.players.map((p) => ({ ...p, objectiveVps: [...p.objectiveVps, scores[p.id] ?? 0] })),
    automa: s.automa ? { ...s.automa, objectiveCoins: 0 } : undefined,
  };
  s = log(s, `objective scored: ${JSON.stringify(scores)}`);

  if (s.round >= 4) {
    return endGame(s);
  }

  // Ravel Mode (dragon automa.txt line 403): "In Ravel Mode only, you may not
  // store more than 2 coins between rounds."
  if (s.automa?.ravelMode) {
    s = {
      ...s,
      players: s.players.map((p) => (p.id === 'p1' ? { ...p, coins: Math.min(2, p.coins) } : p)),
    };
  }

  // Refresh both displays.
  s = refreshDisplays(s);

  // Between-round Automa upkeep (dragon automa.txt lines 435-438):
  //   1. Move 1 player marker from the round tracker beside the Dragon Guild.
  //   2. Shuffle the 8 decision cards (including the 1 set aside) and set 1 aside unseen.
  if (s.automa) {
    const [built, sAuto] = buildAutomaRoundDeck(s, s.automa.allCards);
    s = {
      ...sAuto,
      automa: {
        ...sAuto.automa!,
        deck: built.deck,
        discard: built.discard,
        setAside: built.setAside,
        lastCard: null,
        availableGuildMarkers: sAuto.automa!.availableGuildMarkers + 1,
      },
    };
  }

  // Rotate the start player marker (in Base Automa without Dragon Academy, p1
  // is the starting player for every round: dragon automa.txt line 163).
  const shouldRotateStart = !s.automa || s.expansions.includes('academy');
  const startIdx = shouldRotateStart
    ? (s.playerOrder.indexOf(s.startPlayer) + 1) % s.playerOrder.length
    : s.playerOrder.indexOf('p1');
  const start = s.playerOrder[startIdx]!;
  s = { ...s, startPlayer: start };

  if (s.expansions.includes('academy')) {
    // Academy: each player collects the income space they claimed when
    // passing, in turn order from the new start player. Automa does not
    // collect income (academy_p06.png). settle() drains incomeQueue and begins
    // the next round once empty.
    const order = [...s.playerOrder.slice(startIdx), ...s.playerOrder.slice(0, startIdx)].filter(
      (pid) => !(s.automa && pid === 'p2'),
    );
    s = { ...s, incomeQueue: order };
    return s;
  }

  // Base upkeep: +6 coins, +1 egg, adventurers retrieved (Automa never gains
  // coins, eggs, or resources).
  const players = s.players.map((p) => {
    const q = clone(p);
    if (!(s.automa && q.id === 'p2')) {
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
    }
    q.explores = { crimson: 0, golden: 0, amethyst: 0 };
    q.passed = false;
    return q;
  });
  s = {
    ...s,
    players,
    phase: 'main',
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
    // Round end: once-per-round abilities drain first, then the objective is
    // scored, displays refresh, the start player rotates, and (Academy) the
    // income queue drains between pending answers.
    if (s.phase === 'roundEnd' && s.pending.length === 0) {
      // Drafted display cards are immediately refilled.
      s = refillDisplayGaps(s);
      if (s.roundEndQueue.length) {
        // The next player's once-per-round dragons activate. With several,
        // the owner picks the activation order via oncePerRoundPick.
        const pid = s.roundEndQueue[0]!.playerId;
        const mine = s.roundEndQueue.filter((e) => e.playerId === pid);
        s = { ...s, roundEndQueue: s.roundEndQueue.filter((e) => e.playerId !== pid) };
        if (mine.length === 1) {
          const [cave, space] = mine[0]!.pos;
          s = runAbility(s, pid, { cave, space }, ['OncePerRound']);
        } else {
          s = pushPending(s, {
            kind: 'oncePerRoundPick',
            playerId: pid,
            positions: mine.map((e) => e.pos),
          });
        }
        continue;
      }
      if (!s.players.every((p) => p.objectiveVps.length >= s.round)) {
        s = finishRound(s);
        continue;
      }
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
