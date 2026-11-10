// Step interpreter + pending-step resolution for the Wyrmspan engine.
// `runSteps` executes a Step[] list left-to-right; steps that need a player
// choice enqueue a PendingStep carrying a `resume` continuation (remaining
// steps + context). `resolveChoice` answers the head pending step and then
// continues its resume. This mirrors the wingspan engine's powers/resolve
// split, folded into one file.

import * as shared from '../shared/state';
import { parseAbility, warnUnsupported } from './abilities';
import { automaCacheTokensForMaySteps, grantAutomaCacheTokens } from './automa';
import { cardAbilityTypes, cardName, caveCard, dragonCard, dragonMatchesCond, isDragonCard } from './cards';
import { GUILD_TILES, GUILD_TRACK, INCOME_SECTIONS, incomeSectionIndex } from './guild';
import {
  allDragons,
  canPay,
  clone,
  countCounter,
  dragonPrintedCost,
  dragonTargetPositions,
  drawCards,
  eggTargetSpots,
  eggsOnMatCount,
  evalCond,
  hasAnyEggSpot,
  log,
  orderedOthers,
  otherPlayers,
  payItems,
  player,
  setPlayer,
  removeEggs,
  takeFromDisplay,
  type Pos,
} from './helpers';
import { parseIcons } from './cards';
import type {
  AbilityCandidate,
  ChoiceAnswer,
  EffectCtx,
  GameState,
  GainItem,
  PendingStep,
  PlayedDragon,
  PlayerId,
  PlayerState,
  Resource,
  Resume,
  Step,
} from './types';
import { RESOURCES } from './types';

// ---------------------------------------------------------------------------
// Small state helpers

export const pushPending: (state: GameState, ...steps: PendingStep[]) => GameState = shared.pushPending;

/** Combine an inner continuation with an outer continuation that should run after it. */
function mergeResume(inner: Resume | undefined, outer: Resume | undefined): Resume | undefined {
  if (!outer || outer.steps.length === 0) return inner;
  if (!inner || inner.steps.length === 0) return outer;
  return {
    ctx: inner.ctx,
    steps: [...inner.steps, { op: 'withCtx', ctx: outer.ctx, steps: outer.steps }],
  };
}

/**
 * If `state.pending` grew past `beforePendingLen`, attach `rest` (under `ctx`)
 * to the last newly-queued pending step's resume; otherwise execute `rest` now.
 */
function chainWithPending(
  beforePendingLen: number,
  state: GameState,
  rest: Step[],
  ctx: EffectCtx,
): GameState {
  if (!rest.length) return state;
  if (state.pending.length > beforePendingLen) {
    const pend = [...state.pending];
    const lastIdx = pend.length - 1;
    const last = pend[lastIdx]!;
    const prevResume = 'resume' in last ? last.resume : undefined;
    pend[lastIdx] = {
      ...last,
      resume: mergeResume(prevResume, { steps: rest, ctx }),
    } as PendingStep;
    return { ...state, pending: pend };
  }
  return runSteps(state, rest, ctx);
}

/** Apply non-interactive parts of a gain item; returns [itemsDeferred, state]. */
function applyGainItems(state: GameState, p: PlayerState, items: GainItem[]): [GainItem[], GameState] {
  let s = state;
  let q = clone(p);
  const deferred: GainItem[] = [];
  for (const it of items) {
    switch (it.kind) {
      case 'resource':
        if (it.res === 'any') deferred.push(it);
        else q.resources[it.res] += it.count;
        break;
      case 'coin':
        q.coins += it.count;
        break;
      case 'vp':
        q.bonusVP += it.count;
        break;
      case 'card': {
        if (it.source === 'display') {
          deferred.push(it);
          break;
        }
        const [drawn, s2] = drawCards(s, it.deck, it.count);
        s = s2;
        q.hand.push(...drawn);
        break;
      }
      case 'egg':
        deferred.push(it);
        break;
      case 'guild':
        deferred.push(it);
        break;
    }
  }
  s = setPlayer(s, q);
  return [deferred, s];
}

/** Advance `n` spaces on the guild track sequentially; pauses on brown/choice spaces. */
function advanceGuild(state: GameState, playerId: PlayerId, n: number, resume?: Resume): GameState {
  const steps: Step[] = [{ op: 'advanceGuild', count: n }];
  if (resume && resume.steps.length) {
    steps.push({ op: 'withCtx', ctx: resume.ctx, steps: resume.steps });
  }
  return runSteps(state, steps, { playerId });
}

// ---------------------------------------------------------------------------
// Gain → pending decomposition

/** Enqueue the interactive parts of `items`, then continue `rest`. */
function gainWithChoices(
  state: GameState,
  items: GainItem[],
  ctx: EffectCtx,
  rest: Step[],
): GameState {
  let s = state;
  const p = player(s, ctx.playerId);
  const [deferred, s2] = applyGainItems(s, p, items);
  s = s2;
  const before = s.pending.length;
  const guildSteps: Step[] = [];
  for (const it of deferred) {
    if (it.kind === 'resource' && it.res === 'any') {
      s = pushPending(s, {
        kind: 'chooseResource',
        playerId: ctx.playerId,
        count: it.count,
        mode: 'gain',
        resume: { steps: [], ctx },
      });
    } else if (it.kind === 'card' && it.source === 'display') {
      s = pushPending(s, {
        kind: 'chooseDisplay',
        playerId: ctx.playerId,
        deck: it.deck,
        resume: { steps: [], ctx },
      });
    } else if (it.kind === 'egg') {
      s = pushPending(s, {
        kind: 'chooseEggSpot',
        playerId: ctx.playerId,
        count: it.count,
        target: { kind: 'any' },
        resume: { steps: [], ctx },
      });
    } else if (it.kind === 'guild') {
      guildSteps.push({ op: 'advanceGuild', count: it.count });
    }
  }
  return chainWithPending(before, s, [...guildSteps, ...rest], ctx);
}

// ---------------------------------------------------------------------------
// Recurring hooks ("Any time you cache/tuck X here ...")

export function ensureDragonHooks(d: PlayedDragon, initialCountFromExisting = false): void {
  if (d.hooks !== undefined) return;
  const card = dragonCard(d.cardId);
  const def = parseAbility(card);
  const recSteps = def.steps.filter((st): st is Extract<Step, { op: 'recurring' }> => st.op === 'recurring');
  d.hooks = recSteps.map((st) => {
    const existing = initialCountFromExisting
      ? st.trigger === 'tuck'
        ? d.tucked.length
        : d.cached.filter((r) => r === st.key).length
      : 0;
    return {
      trigger: st.trigger,
      key: st.key,
      eachSteps: st.eachSteps,
      thirdGain: st.thirdGain,
      count: existing,
      thirdFired: false,
    };
  });
}

export function fireRecurring(
  state: GameState,
  playerId: PlayerId,
  pos: Pos,
  trigger: 'cache' | 'tuck',
  key: string,
): GameState {
  let s = state;
  const p = player(s, playerId);
  const d = p.caves[pos.cave]!.spaces[pos.space]!.dragon;
  if (!d) return s;
  const q = clone(p);
  const dq = q.caves[pos.cave]!.spaces[pos.space]!.dragon!;
  ensureDragonHooks(dq, false);
  if (!dq.hooks?.length) return s;
  const triggeredSteps: Step[] = [];
  for (const hook of dq.hooks) {
    if (hook.trigger === trigger && hook.key === key) {
      hook.count = (hook.count ?? 0) + 1;
      triggeredSteps.push(...hook.eachSteps);
      if (hook.count >= 3 && !hook.thirdFired && hook.thirdGain.length) {
        hook.thirdFired = true;
        triggeredSteps.push(...hook.thirdGain);
      }
    }
  }
  s = setPlayer(s, q);
  if (triggeredSteps.length) {
    const before = s.pending.length;
    s = runSteps(s, triggeredSteps, { playerId, dragon: [pos.cave, pos.space], sourceCardId: dq.cardId });
    void before;
  }
  return s;
}

// ---------------------------------------------------------------------------
// The interpreter

export function runSteps(state: GameState, steps: Step[], ctx: EffectCtx): GameState {
  let s = state;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!;
    const rest = steps.slice(i + 1);
    const p = player(s, ctx.playerId);
    const ctxPos = ctx.dragon;
    switch (step.op) {
      case 'unsupported':
        warnUnsupported(step.text);
        break;

      case 'gain': {
        s = gainWithChoices(s, step.items, ctx, rest);
        return s;
      }

      case 'gainPer': {
        const n = countCounter(s, p, step.counter, ctxPos);
        if (n <= 0) break;
        const items = step.items.map((it) => ({ ...it, count: it.count * n }) as GainItem);
        s = gainWithChoices(s, items, ctx, rest);
        return s;
      }

      case 'vp':
        s = setPlayer(s, { ...clone(p), bonusVP: p.bonusVP + step.count });
        break;

      case 'opponentsGain': {
        // Clockwise order starting with the player after the owner.
        for (const op of orderedOthers(s, ctx.playerId)) {
          if (s.automa && op.id === 'p2') {
            // Base Automa (dragon automa.txt line 398): "When you trigger an
            // ability or benefit, if other players are supposed to gain
            // something, Automa gains nothing."
            // Dragon Academy (academy_p07.png): Automa gains 2 cache tokens
            // for each thing she will gain without paying a cost.
            const things = step.items.reduce((a, it) => a + it.count, 0);
            s = grantAutomaCacheTokens(s, 2 * things);
            continue;
          }
          const [deferred, s2] = applyGainItems(s, op, step.items);
          s = s2;
          for (const it of deferred) {
            if (it.kind === 'resource' && it.res === 'any') {
              s = pushPending(s, { kind: 'chooseResource', playerId: op.id, count: it.count, mode: 'gain' });
            } else if (it.kind === 'egg') {
              s = autoLayEggs(s, op.id, it.count);
            } else if (it.kind === 'guild') {
              s = advanceGuild(s, op.id, it.count);
            }
          }
        }
        break;
      }

      case 'opponentsMay': {
        // Queue one pending per opponent in clockwise order starting with the
        // player after the owner; the last carries the continuation.
        const ops = orderedOthers(s, ctx.playerId);
        if (!ops.length) break;
        const humanOps: PlayerState[] = [];
        for (const op of ops) {
          if (s.automa && op.id === 'p2') {
            const tokens = automaCacheTokensForMaySteps(step.steps);
            s = grantAutomaCacheTokens(s, tokens);
          } else {
            humanOps.push(op);
          }
        }
        if (!humanOps.length) break;
        humanOps.forEach((op, i) => {
          s = pushPending(s, {
            kind: 'opponentMay',
            playerId: op.id,
            label: 'an offered benefit',
            steps: step.steps,
            resume: i === humanOps.length - 1 ? { steps: rest, ctx } : undefined,
          });
        });
        return s;
      }

      case 'layEggs': {
        if (step.target.kind.startsWith('each')) {
          const spots = eggTargetSpots(p, step.target, ctxPos) as Pos[];
          if (spots.length === 0) break;
          const q = clone(p);
          for (const pos of spots) {
            const d = q.caves[pos.cave]!.spaces[pos.space]!.dragon!;
            d.eggs = Math.min(d.eggs + step.count, dragonCard(d.cardId).capacity);
          }
          s = setPlayer(s, q);
          break;
        }
        if (!hasAnyEggSpot(p, step.target, ctxPos)) break;
        s = pushPending(s, {
          kind: 'chooseEggSpot',
          playerId: ctx.playerId,
          count: step.count,
          target: step.target,
          optional: true,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'layPer': {
        const n = countCounter(s, p, step.counter, ctxPos);
        if (n <= 0) break;
        s = runSteps(s, [{ op: 'layEggs', count: step.per * n, target: step.target }, ...rest], ctx);
        return s;
      }

      case 'cache': {
        if (step.target.kind === 'eachInCave' || step.target.kind === 'eachOnMat') {
          const spots = dragonTargetPositions(p, step.target, ctxPos);
          const q = clone(p);
          const res = step.res === 'any' ? 'meat' : step.res; // auto-pick for eachX
          for (const pos of spots) {
            const d = q.caves[pos.cave]!.spaces[pos.space]!.dragon!;
            for (let k = 0; k < step.count; k++) d.cached.push(res);
          }
          s = setPlayer(s, q);
          for (const pos of spots) s = fireRecurring(s, ctx.playerId, pos, 'cache', res);
          break;
        }
        s = pushPending(s, {
          kind: 'chooseCache',
          playerId: ctx.playerId,
          count: step.count,
          res: step.res,
          from: step.from,
          target: step.target,
          upTo: step.upTo,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'tuck': {
        if (step.target.kind === 'eachInCave' || step.target.kind === 'eachOnMat') {
          const spots = dragonTargetPositions(p, step.target, ctxPos);
          for (const pos of spots) {
            for (let k = 0; k < step.count; k++) {
              const [drawn, s2] = drawCards(s, 'dragon', 1);
              s = s2;
              if (!drawn.length) break;
              const q = clone(player(s, ctx.playerId));
              q.caves[pos.cave]!.spaces[pos.space]!.dragon!.tucked.push(drawn[0]!);
              s = setPlayer(s, q);
              s = fireRecurring(s, ctx.playerId, pos, 'tuck', 'dragonCard');
            }
          }
          break;
        }
        // 'tuckedHere' tracking: mark ctx so a following `if` can test it.
        s = pushPending(s, {
          kind: 'chooseTuck',
          playerId: ctx.playerId,
          count: step.count,
          from: step.from,
          target: step.target,
          upTo: step.upTo,
          resume: { steps: rest, ctx: { ...ctx, data: { ...ctx.data, tuckTargetHere: ctxPos ? ctxPos.join(',') : '' } } },
        });
        return s;
      }

      case 'tuckPer': {
        const n = countCounter(s, p, step.counter, ctxPos);
        if (n <= 0) break;
        s = runSteps(s, [{ op: 'tuck', count: step.per * n, from: step.from, target: step.target, upTo: false }, ...rest], ctx);
        return s;
      }

      case 'pay': {
        if (!canPay(p, step.cost)) {
          const ctx2: EffectCtx = { ...ctx, data: { ...ctx.data, didPrecede: false } };
          return runSteps(s, rest, ctx2);
        }
        s = pushPending(s, {
          kind: 'choosePay',
          playerId: ctx.playerId,
          tiers: [{ cost: step.cost, then: step.then }],
          repeat: step.repeat,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'discardFromHand': {
        // "Discard X to do Y" is a trade: the player may decline the discard,
        // which skips `then` but continues with the rest of the ability.
        s = pushPending(s, {
          kind: 'chooseHandCards',
          playerId: ctx.playerId,
          count: step.count,
          what: step.what,
          purpose: 'discard',
          upTo: true,
          perCard: step.perCard,
          activateDiscarded: step.activateDiscarded,
          then: step.then,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'drawDistribute': {
        const [drawn, s2] = drawCards(s, step.deck, step.count);
        s = s2;
        if (!drawn.length) break;
        s = pushPending(s, {
          kind: 'distributeCards',
          playerId: ctx.playerId,
          cardIds: drawn,
          keep: step.keep,
          tuck: step.tuck,
          discard: step.discard,
          playFree: step.playFree,
          orKeep: step.orKeep,
          tuckTarget: step.tuckTarget,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'drawPer': {
        const n = countCounter(s, p, step.counter, ctxPos);
        if (n <= 0) break;
        const [drawn, s2] = drawCards(s, step.deck, n);
        s = s2;
        const q = clone(player(s, ctx.playerId));
        q.hand.push(...drawn);
        s = setPlayer(s, q);
        if (step.tuck && step.tuck > 0) {
          s = pushPending(s, {
            kind: 'chooseTuck',
            playerId: ctx.playerId,
            count: step.tuck,
            from: 'hand',
            target: step.tuckTarget ?? { kind: 'here' },
            upTo: true,
            resume: { steps: rest, ctx },
          });
          return s;
        }
        break;
      }

      case 'reveal': {
        const [drawn, s2] = drawCards(s, 'dragon', 1);
        s = s2;
        if (!drawn.length) break;
        const revealed = drawn[0]!;
        const card = dragonCard(revealed);
        const ok = step.cond === null || dragonMatchesCond(card, step.cond);
        const ctx2: EffectCtx = { ...ctx, data: { ...ctx.data, revealed } };
        const branch = ok ? step.yes : step.no;
        return runSteps(s, [...branch, ...rest], ctx2);
      }

      case 'keepRevealed': {
        const id = Number(ctx.data?.revealed);
        if (id) {
          const q = clone(p);
          q.hand.push(id);
          s = setPlayer(s, q);
        }
        break;
      }
      case 'discardRevealed': {
        const id = Number(ctx.data?.revealed);
        if (id) s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
        break;
      }
      case 'tuckRevealed': {
        const id = Number(ctx.data?.revealed);
        if (!id) break;
        const positions = dragonTargetPositions(p, step.target, ctxPos);
        if (step.target.kind === 'here' && ctxPos) {
          const q = clone(p);
          q.caves[ctxPos[0]]!.spaces[ctxPos[1]]!.dragon!.tucked.push(id);
          s = setPlayer(s, q);
          const before = s.pending.length;
          s = fireRecurring(s, ctx.playerId, { cave: ctxPos[0], space: ctxPos[1] }, 'tuck', 'dragonCard');
          return chainWithPending(before, s, rest, ctx);
        } else if (positions.length === 1) {
          const pos = positions[0]!;
          const q = clone(p);
          q.caves[pos.cave]!.spaces[pos.space]!.dragon!.tucked.push(id);
          s = setPlayer(s, q);
          const before = s.pending.length;
          s = fireRecurring(s, ctx.playerId, pos, 'tuck', 'dragonCard');
          return chainWithPending(before, s, rest, ctx);
        } else {
          const q = clone(p);
          q.hand.push(id);
          s = setPlayer(s, q); // fallback: keep it
        }
        break;
      }

      case 'excavateFree': {
        s = pushPending(s, {
          kind: 'chooseExcavate',
          playerId: ctx.playerId,
          source: step.source,
          count: step.count,
          activateTimes: step.activateTimes,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'playDragonFree': {
        s = pushPending(s, {
          kind: 'choosePlayDragon',
          playerId: ctx.playerId,
          source: step.source,
          discount: step.discount,
          onTop: step.onTop,
          cond: step.cond,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'activateAbility': {
        const candidates = abilityCandidates(s, ctx.playerId, step, ctxPos);
        if (!candidates.length) break;
        s = pushPending(s, {
          kind: 'chooseAbility',
          playerId: ctx.playerId,
          candidates,
          count: Math.min(step.count, candidates.length),
          distinct: step.distinct,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'trainFledgling': {
        s = pushPending(s, {
          kind: 'chooseTrain',
          playerId: ctx.playerId,
          times: step.times,
          free: step.free,
          gainItem: step.gainItem,
          target: step.target,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'gainCoveredItem': {
        const covered = ctx.data?.coveredItem;
        if (typeof covered === 'string') {
          try {
            const item = JSON.parse(covered) as GainItem;
            s = gainWithChoices(s, [item], ctx, rest);
            return s;
          } catch {
            /* ignore */
          }
        }
        break;
      }

      case 'swapDragons': {
        s = pushPending(s, { kind: 'chooseSwap', playerId: ctx.playerId, resume: { steps: rest, ctx } });
        return s;
      }

      case 'swapHandDragon': {
        const hasMatDragon = allDragons(p).length > 0;
        const hasHandDragon = p.hand.some(isDragonCard);
        if (!hasMatDragon || !hasHandDragon) break;
        s = pushPending(s, { kind: 'chooseHandDragonSwap', playerId: ctx.playerId, resume: { steps: rest, ctx } });
        return s;
      }

      case 'swapCaveCard': {
        const hasUncoveredCave = p.caves.some((row) =>
          row.spaces.some((sp) => sp.excavated && sp.caveCardId !== null && !sp.dragon),
        );
        const hasHandCave = p.hand.some((id) => !isDragonCard(id));
        if (!hasUncoveredCave || !hasHandCave) break;
        s = pushPending(s, { kind: 'chooseCaveCardSwap', playerId: ctx.playerId, resume: { steps: rest, ctx } });
        return s;
      }

      case 'gamblerDraw': {
        const [drawn, s2] = drawCards(s, 'dragon', 1);
        s = s2;
        if (!drawn.length) break;
        const cardId = drawn[0]!;
        s = { ...s, dragonDiscard: [...s.dragonDiscard, cardId] };
        const printed = dragonPrintedCost(cardId);
        s = pushPending(s, {
          kind: 'chooseOption',
          playerId: ctx.playerId,
          options: [
            { label: `gain printed cost of ${cardName(cardId)}`, steps: printed.length ? [{ op: 'gain', items: printed }] : [] },
            { label: `discard ${cardName(cardId)} to gain 1 coin`, steps: [{ op: 'gain', items: [{ kind: 'coin', count: 1 }] }] },
          ],
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'gamblerEndGameDraw': {
        const [drawn, s2] = drawCards(s, 'dragon', 4);
        s = s2;
        if (!drawn.length) break;
        s = { ...s, dragonDiscard: [...s.dragonDiscard, ...drawn] };
        const fledglings = allDragons(p).filter((d) => dragonCard(d.dragon.cardId).size === 'Fledgling').length;
        const vps = drawn
          .map((id) => {
            const c = dragonCard(id);
            return c.size === 'Fledgling' ? fledglings : c.vp;
          })
          .sort((a, b) => b - a);
        const scored = vps.slice(0, 2).reduce((a, b) => a + b, 0);
        const prev = s.guild.gamblerVp?.[ctx.playerId] ?? 0;
        s = {
          ...s,
          guild: {
            ...s.guild,
            gamblerVp: { ...(s.guild.gamblerVp ?? {}), [ctx.playerId]: prev + scored },
          },
        };
        break;
      }

      case 'gainTuckedPrintedResource': {
        const tuckedId = Number(ctx.data?.lastTuckedCardId);
        if (!Number.isFinite(tuckedId) || !isDragonCard(tuckedId)) break;
        const card = dragonCard(tuckedId);
        const allowed = RESOURCES.filter((r) => (card.cost[r] ?? 0) > 0);
        if (allowed.length === 0) break;
        if (allowed.length === 1) {
          const q = clone(p);
          q.resources[allowed[0]!] += step.count;
          s = setPlayer(s, q);
          break;
        }
        s = pushPending(s, {
          kind: 'chooseResource',
          playerId: ctx.playerId,
          count: step.count,
          mode: 'gain',
          allowed,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'exploreStep': {
        const iconSteps = MAT_ICONS[step.cave]?.[step.index] ?? [];
        const nextSteps: Step[] = step.index < 4 ? [{ op: 'exploreSpace', cave: step.cave, space: step.index }] : [];
        return runSteps(s, [...iconSteps, ...nextSteps, ...rest], ctx);
      }

      case 'exploreSpace': {
        const sp = p.caves[step.cave]?.spaces[step.space];
        if (!sp || !sp.excavated || !sp.dragon) break;
        const card = dragonCard(sp.dragon.cardId);
        const types = cardAbilityTypes(card);
        let canActivate = types.includes('Adventurer') && !!card.ability;
        if (canActivate && card.size === 'Fledgling') {
          const track = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
          if ((sp.dragon.training ?? 0) < track) canActivate = false;
        }
        const abilitySteps: Step[] = [];
        if (canActivate) {
          const def = parseAbility(card);
          if (def.steps.length) {
            abilitySteps.push({
              op: 'withCtx',
              ctx: { playerId: ctx.playerId, dragon: [step.cave, step.space], sourceCardId: card.id },
              steps: def.steps,
            });
          }
        }
        return runSteps(
          s,
          [
            ...abilitySteps,
            { op: 'offerFledglingTrain', cave: step.cave, space: step.space },
            { op: 'exploreStep', cave: step.cave, index: step.space + 1 },
            ...rest,
          ],
          ctx,
        );
      }

      case 'offerFledglingTrain': {
        const walked = p.caves[step.cave]?.spaces[step.space]?.dragon;
        if (walked && walked.cardId >= 0) {
          const card = dragonCard(walked.cardId);
          const track = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
          if (card.size === 'Fledgling' && track > 0 && (walked.training ?? 0) < track) {
            s = pushPending(s, {
              kind: 'chooseTrain',
              playerId: ctx.playerId,
              times: 1,
              free: false,
              target: 'any',
              pos: [step.cave, step.space],
              resume: { steps: rest, ctx },
            });
            return s;
          }
        }
        break;
      }

      case 'advanceGuild': {
        if (step.count <= 0) break;
        const trackPos = ((s.guild.track[ctx.playerId] ?? 0) + 1) % GUILD_TRACK.length;
        const space = GUILD_TRACK[trackPos]!;
        s = { ...s, guild: { ...s.guild, track: { ...s.guild.track, [ctx.playerId]: trackPos } } };
        s = log(s, `${p.name} advanced 1 on the Dragon Guild`);
        const rem: Step[] = step.count > 1 ? [{ op: 'advanceGuild', count: step.count - 1 }, ...rest] : rest;
        if (space.brown) {
          if ((player(s, ctx.playerId).guildMarkersPlaced ?? 0) < 4) {
            s = pushPending(s, {
              kind: 'chooseGuildSquare',
              playerId: ctx.playerId,
              resume: { steps: rem, ctx },
            });
            return s;
          }
          return runSteps(s, rem, ctx);
        }
        if (space.steps.length) {
          return runSteps(s, [{ op: 'withCtx', ctx: { playerId: ctx.playerId }, steps: space.steps }, ...rem], ctx);
        }
        return runSteps(s, rem, ctx);
      }

      case 'withCtx': {
        const before = s.pending.length;
        s = runSteps(s, step.steps, step.ctx);
        return chainWithPending(before, s, rest, ctx);
      }

      case 'chooseBenefits': {
        s = pushPending(s, {
          kind: 'chooseBenefits',
          playerId: ctx.playerId,
          count: step.count,
          options: step.options,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'chooseOption': {
        s = pushPending(s, {
          kind: 'chooseOption',
          playerId: ctx.playerId,
          options: step.options,
          resume: { steps: rest, ctx },
        });
        return s;
      }

      case 'chooseResourceGain': {
        s = pushPending(s, {
          kind: 'chooseResource',
          playerId: ctx.playerId,
          count: 1,
          mode: 'gain',
          resume: {
            steps: [],
            ctx: { ...ctx, data: { ...ctx.data, chooseGainSelf: step.selfCount, chooseGainOpp: step.oppCount, chooseGainRest: JSON.stringify(rest) } },
          },
        });
        return s;
      }

      case 'repeat': {
        s = pushPending(s, {
          kind: 'chooseOption',
          playerId: ctx.playerId,
          options: [
            { label: 'do it', steps: [] },
            { label: 'stop', steps: [] },
          ],
          resume: {
            steps: [],
            ctx: { ...ctx, data: { ...ctx.data, repeatSteps: JSON.stringify(step.steps), repeatLeft: step.times, repeatRest: JSON.stringify(rest) } },
          },
        });
        return s;
      }

      case 'if': {
        let ok: boolean;
        if (step.cond.kind === 'didPrecede') ok = ctx.data?.didPrecede === true;
        else if (step.cond.kind === 'tuckedHere') ok = ctx.data?.tuckedHere === true;
        else ok = evalCond(s, p, step.cond, ctxPos);
        const branch = ok ? step.then : (step.else ?? []);
        if (branch.length) {
          return runSteps(s, [...branch, ...rest], ctx);
        }
        break;
      }

      case 'recurring': {
        if (ctxPos) {
          const q = clone(p);
          const d = q.caves[ctxPos[0]]!.spaces[ctxPos[1]]!.dragon;
          if (d) {
            ensureDragonHooks(d, false);
            s = setPlayer(s, q);
          }
        }
        break;
      }
    }
  }
  return s;
}

/** Candidates for an activateAbility step. */
function abilityCandidates(
  state: GameState,
  playerId: PlayerId,
  step: Extract<Step, { op: 'activateAbility' }>,
  ctxPos?: [number, number],
): AbilityCandidate[] {
  const p = player(state, playerId);
  const out: AbilityCandidate[] = [];
  for (const d of allDragons(p)) {
    const card = dragonCard(d.dragon.cardId);
    const types = cardAbilityTypes(card);
    // Fledgling purple abilities are inactive until fully trained.
    if (card.size === 'Fledgling') {
      const track = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
      if ((d.dragon.training ?? 0) < track) continue;
    }
    const kinds = step.kinds.filter((k) => types.includes(k));
    if (!kinds.length) continue;
    out.push({ dragon: [d.cave, d.space], kinds, label: card.name });
  }
  if (step.printedOnMat) {
    // Printed mat path icons count as Adventurer abilities.
    for (const [cave, row] of MAT_ICONS.entries()) {
      row.forEach((icons, space) => {
        if (icons.length) {
          out.push({
            matIcon: { cave, icon: space },
            kinds: ['Adventurer'],
            label: `mat icon (${['crimson', 'golden', 'amethyst'][cave]} space ${space + 1})`,
          });
        }
      });
    }
  }
  void ctxPos;
  return out;
}

// ---------------------------------------------------------------------------
// Player-mat path icons matching the printed player mat (dragon_p03.png / p10.png).
// Each cave has 5 path segments: [0..3] before spaces 0..3, and [4] after space 3.

export const MAT_ICONS: Step[][][] = [
  // Crimson Cavern
  [
    [{ op: 'gain', items: [{ kind: 'resource', res: 'any', count: 1 }] }],
    [{ op: 'gain', items: [{ kind: 'guild', count: 1 }] }],
    [{ op: 'gain', items: [{ kind: 'resource', res: 'any', count: 1 }] }],
    [{ op: 'layEggs', count: 1, target: { kind: 'any' } }],
    [{ op: 'cache', count: 2, res: 'any', from: 'supply', target: { kind: 'any' }, upTo: true }],
  ],
  // Golden Grotto
  [
    [{ op: 'gain', items: [{ kind: 'card', deck: 'dragon', count: 1 }] }],
    [{ op: 'gain', items: [{ kind: 'guild', count: 1 }] }],
    [{ op: 'gain', items: [{ kind: 'card', deck: 'dragon', count: 1 }] }],
    [{ op: 'layEggs', count: 1, target: { kind: 'any' } }],
    [{ op: 'tuck', count: 2, from: 'hand', target: { kind: 'any' }, upTo: true }],
  ],
  // Amethyst Abyss
  [
    [{ op: 'gain', items: [{ kind: 'card', deck: 'cave', count: 1 }] }],
    [{ op: 'gain', items: [{ kind: 'guild', count: 1 }] }],
    [{ op: 'gain', items: [{ kind: 'card', deck: 'cave', count: 1 }] }],
    [{ op: 'layEggs', count: 1, target: { kind: 'any' } }],
    [
      {
        op: 'discardFromHand',
        what: 'cave',
        count: 2,
        perCard: true,
        then: [{ op: 'layEggs', count: 1, target: { kind: 'any' } }],
      },
    ],
  ],
];

/**
 * Printed "when covered" (when excavated) benefits on the player mat:
 * Column 4 (index 3) of every cave allows spending 3 items (resources, dragon
 * cards, or cave cards in any combination) to gain 1 coin.
 */
export const MAT_COVERED_ICONS: Step[][][] = [
  [
    [],
    [],
    [],
    [{ op: 'pay', cost: [{ kind: 'item', count: 3 }], then: [{ op: 'gain', items: [{ kind: 'coin', count: 1 }] }] }],
  ],
  [
    [],
    [],
    [],
    [{ op: 'pay', cost: [{ kind: 'item', count: 3 }], then: [{ op: 'gain', items: [{ kind: 'coin', count: 1 }] }] }],
  ],
  [
    [],
    [],
    [],
    [{ op: 'pay', cost: [{ kind: 'item', count: 3 }], then: [{ op: 'gain', items: [{ kind: 'coin', count: 1 }] }] }],
  ],
];

// ---------------------------------------------------------------------------
// Pending-step resolution

export function resolveChoice(state: GameState, playerId: PlayerId, answer: ChoiceAnswer): GameState {
  const head = state.pending[0];
  if (!head || head.playerId !== playerId) return state;
  let s = { ...state, pending: state.pending.slice(1) };
  const basePendingLen = s.pending.length;
  const resumeSteps = (resume: Resume | undefined, overrideCtx?: EffectCtx): GameState => {
    if (!resume || resume.steps.length === 0) return s;
    return chainWithPending(basePendingLen, s, resume.steps, overrideCtx ?? resume.ctx);
  };

  switch (head.kind) {
    case 'setupCards': {
      if (answer.kind !== 'cards') return state;
      const q = clone(player(s, playerId));
      const keepSet = new Set(answer.cardIds.slice(0, head.keep));
      for (const id of head.offer) {
        if (keepSet.has(id)) q.hand.push(id);
        else if (isDragonCard(id)) s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
        else s = { ...s, caveDiscard: [...s.caveDiscard, id] };
      }
      s = setPlayer(s, q);
      if (!s.pending.length && !Object.values(state.setupOffers).length) {
        // handled by engine settle
      }
      delete s.setupOffers[playerId];
      return s;
    }

    case 'setupResources': {
      if (answer.kind === 'resources') {
        const q = clone(player(s, playerId));
        for (const r of answer.resources.slice(0, head.count)) q.resources[r] += 1;
        s = setPlayer(s, q);
      }
      return s;
    }

    case 'chooseResource': {
      const ctx = head.resume?.ctx;
      if (answer.kind === 'decline' && head.upTo) return resumeSteps(head.resume);
      if (answer.kind !== 'resources') return state;
      const q = clone(player(s, playerId));
      const pickedList: Resource[] = [];
      for (const rawR of answer.resources.slice(0, head.count)) {
        const r = head.allowed && !head.allowed.includes(rawR) ? head.allowed[0]! : rawR;
        pickedList.push(r);
        if (head.mode === 'gain') q.resources[r] += 1;
        else if (q.resources[r] > 0) q.resources[r] -= 1;
      }
      s = setPlayer(s, q);
      // chooseResourceGain continuation: opponents gain the same resource.
      if (ctx?.data?.chooseGainSelf !== undefined && pickedList[0]) {
        const res = pickedList[0];
        const selfN = Number(ctx.data.chooseGainSelf);
        const oppN = Number(ctx.data.chooseGainOpp);
        const q2 = clone(player(s, playerId));
        q2.resources[res] += selfN - 1; // already got 1 above
        s = setPlayer(s, q2);
        for (const op of otherPlayers(s, playerId)) {
          if (s.automa && op.id === 'p2') {
            s = grantAutomaCacheTokens(s, 2 * oppN);
            continue;
          }
          const oq = clone(op);
          oq.resources[res] += oppN;
          s = setPlayer(s, oq);
        }
        const rest = JSON.parse(String(ctx.data.chooseGainRest ?? '[]')) as Step[];
        return runSteps(s, rest, { playerId });
      }
      return resumeSteps(head.resume);
    }

    case 'chooseEggSpot': {
      if (answer.kind === 'decline') {
        const ctx = { ...(head.resume?.ctx ?? { playerId }), data: { ...(head.resume?.ctx.data ?? {}), didPrecede: false } };
        return resumeSteps(head.resume, ctx);
      }
      if (answer.kind !== 'eggSpots') return state;
      const q = clone(player(s, playerId));
      let placed = 0;
      for (const spot of answer.spots.slice(0, head.count)) {
        if (spot.kind === 'nest' && q.nestEggs < 2) {
          q.nestEggs += 1;
          placed++;
        } else if (spot.kind === 'dragon') {
          const d = q.caves[spot.pos[0]]!.spaces[spot.pos[1]]!.dragon;
          if (d && d.eggs < dragonCard(d.cardId).capacity) {
            d.eggs += 1;
            placed++;
          }
        }
      }
      s = setPlayer(s, q);
      const ctx = { ...(head.resume?.ctx ?? { playerId }), data: { ...(head.resume?.ctx.data ?? {}), didPrecede: placed > 0 } };
      return resumeSteps(head.resume, ctx);
    }

    case 'chooseEggPayment': {
      if (answer.kind !== 'eggSpots') return state;
      const q = clone(player(s, playerId));
      for (const spot of answer.spots.slice(0, head.count)) {
        if (spot.kind === 'nest') q.nestEggs -= 1;
        else {
          const d = q.caves[spot.pos[0]]!.spaces[spot.pos[1]]!.dragon;
          if (d && d.eggs > 0) d.eggs -= 1;
        }
      }
      s = setPlayer(s, q);
      return resumeSteps(head.resume);
    }

    case 'chooseCache': {
      if (answer.kind === 'decline') {
        const ctx = { ...(head.resume?.ctx ?? { playerId }), data: { ...(head.resume?.ctx.data ?? {}), didPrecede: false } };
        return resumeSteps(head.resume, ctx);
      }
      // answer.resources = resource types picked; answer.dragon = target pos
      if (answer.kind !== 'resources' && answer.kind !== 'dragons') return state;
      const resList = answer.kind === 'resources' ? answer.resources : [];
      const positions = answer.kind === 'dragons'
        ? answer.positions.map((t) => ({ cave: t[0], space: t[1] }))
        : dragonTargetPositions(player(s, playerId), head.target, head.resume?.ctx.dragon);
      const q = clone(player(s, playerId));
      let used = 0;
      const cachedEvents: { pos: Pos; res: Resource }[] = [];
      if (positions.length > 0) {
        for (let k = 0; k < head.count; k++) {
          const pos = positions[k % positions.length]!;
          const d = q.caves[pos.cave]?.spaces[pos.space]?.dragon;
          if (!d) continue;
          const r: Resource =
            head.res === 'any'
              ? (resList[k] ?? RESOURCES.find((rr) => q.resources[rr] > 0) ?? 'meat')
              : head.res;
          if (head.from === 'supply') {
            if (q.resources[r] <= 0) continue;
            q.resources[r] -= 1;
          }
          d.cached.push(r);
          cachedEvents.push({ pos, res: r });
          used++;
        }
      }
      s = setPlayer(s, q);
      for (const ev of cachedEvents) {
        s = fireRecurring(s, playerId, ev.pos, 'cache', ev.res);
      }
      const ctx = { ...(head.resume?.ctx ?? { playerId }), data: { ...(head.resume?.ctx.data ?? {}), didPrecede: used > 0 } };
      return resumeSteps(head.resume, ctx);
    }

    case 'chooseTuck': {
      const ctx0 = head.resume?.ctx ?? { playerId };
      if (answer.kind === 'decline') {
        const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: false } };
        return resumeSteps(head.resume, ctx);
      }
      const tuckedHereCtx: EffectCtx = { ...ctx0, data: { ...ctx0.data, didPrecede: true, tuckedHere: false } };
      if (head.from === 'deck') {
        // Auto-tuck top-of-deck under chosen target(s).
        const positions = answer.kind === 'dragons'
          ? answer.positions.map((t) => ({ cave: t[0], space: t[1] }))
          : dragonTargetPositions(player(s, playerId), head.target, ctx0.dragon);
        const count = Math.min(head.count, positions.length ? head.count : 0);
        let tucked = 0;
        for (let k = 0; k < count; k++) {
          const pos = positions[k % positions.length] ?? positions[0];
          if (!pos) break;
          const [drawn, s2] = drawCards(s, 'dragon', 1);
          s = s2;
          if (!drawn.length) break;
          const q = clone(player(s, playerId));
          q.caves[pos.cave]!.spaces[pos.space]!.dragon!.tucked.push(drawn[0]!);
          s = setPlayer(s, q);
          s = fireRecurring(s, playerId, pos, 'tuck', 'dragonCard');
          tucked++;
          tuckedHereCtx.data!.lastTuckedCardId = drawn[0]!;
          if (ctx0.dragon && pos.cave === ctx0.dragon[0] && pos.space === ctx0.dragon[1]) {
            tuckedHereCtx.data!.tuckedHere = true;
          }
        }
        tuckedHereCtx.data!.didPrecede = tucked > 0;
        return resumeSteps(head.resume, tuckedHereCtx);
      }
      // from hand: assignments cardId -> pos
      if (answer.kind === 'assignTucks') {
        const q = clone(player(s, playerId));
        let tucked = 0;
        const tuckedPositions: Pos[] = [];
        for (const a of answer.assignments.slice(0, head.count)) {
          const i = q.hand.indexOf(a.cardId);
          if (i < 0) continue;
          q.hand.splice(i, 1);
          q.caves[a.pos[0]]!.spaces[a.pos[1]]!.dragon!.tucked.push(a.cardId);
          tucked++;
          tuckedPositions.push({ cave: a.pos[0], space: a.pos[1] });
          tuckedHereCtx.data!.lastTuckedCardId = a.cardId;
          if (ctx0.dragon && a.pos[0] === ctx0.dragon[0] && a.pos[1] === ctx0.dragon[1]) {
            tuckedHereCtx.data!.tuckedHere = true;
          }
        }
        tuckedHereCtx.data!.didPrecede = tucked > 0;
        s = setPlayer(s, q);
        for (const pos of tuckedPositions) {
          s = fireRecurring(s, playerId, pos, 'tuck', 'dragonCard');
        }
        return resumeSteps(head.resume, tuckedHereCtx);
      }
      if (answer.kind === 'dragons') {
        // Tuck any hand cards (auto-pick first N).
        const q = clone(player(s, playerId));
        const positions = answer.positions.map((t) => ({ cave: t[0], space: t[1] }));
        const n = Math.min(head.count, q.hand.filter(isDragonCard).length, positions.length * head.count);
        let k = 0;
        let tucked = 0;
        const tuckedPositions: Pos[] = [];
        outer2: for (const pos of positions) {
          for (let c = 0; c < q.hand.length; c++) {
            if (k >= n) break outer2;
            const id = q.hand[c]!;
            if (!isDragonCard(id)) continue;
            q.hand.splice(c, 1);
            q.caves[pos.cave]!.spaces[pos.space]!.dragon!.tucked.push(id);
            tuckedHereCtx.data!.lastTuckedCardId = id;
            if (ctx0.dragon && pos.cave === ctx0.dragon[0] && pos.space === ctx0.dragon[1]) tuckedHereCtx.data!.tuckedHere = true;
            tuckedPositions.push(pos);
            k++;
            tucked++;
            break;
          }
        }
        tuckedHereCtx.data!.didPrecede = tucked > 0;
        s = setPlayer(s, q);
        for (const pos of tuckedPositions) {
          s = fireRecurring(s, playerId, pos, 'tuck', 'dragonCard');
        }
        return resumeSteps(head.resume, tuckedHereCtx);
      }
      return state;
    }

    case 'choosePay': {
      const ctx0 = head.resume?.ctx ?? { playerId };
      if (answer.kind === 'decline') {
        const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: false } };
        return resumeSteps(head.resume, ctx);
      }
      const tierIdx = answer.kind === 'option' ? answer.index : 0;
      const tier = head.tiers[tierIdx] ?? head.tiers[0]!;
      const p = player(s, playerId);
      if (!canPay(p, tier.cost)) {
        const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: false } };
        return resumeSteps(head.resume, ctx);
      }
      s = chargeItems(s, playerId, tier.cost);
      const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: true } };
      s = runSteps(s, tier.then, ctx);
      // repeat: offer the same pay again via re-queued choosePay (if still affordable)
      if (head.repeat && head.repeat > 1) {
        const repeatStep: Step = {
          op: 'pay',
          cost: tier.cost,
          then: tier.then,
          repeat: head.repeat - 1,
        };
        const nextSteps = [repeatStep, ...(head.resume?.steps ?? [])];
        return chainWithPending(basePendingLen, s, nextSteps, ctx);
      }
      return resumeSteps(head.resume, ctx);
    }

    case 'chooseHandCards': {
      const ctx0 = head.resume?.ctx ?? { playerId };
      if (answer.kind === 'decline' && head.upTo) {
        // Declined trades skip their `then` but continue the ability.
        const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: false } };
        return resumeSteps(head.resume, ctx);
      }
      if (answer.kind !== 'cards') return state;
      const q = clone(player(s, playerId));
      let discarded = 0;
      const discardedIds: number[] = [];
      for (const id of answer.cardIds.slice(0, head.count)) {
        const i = q.hand.indexOf(id);
        if (i < 0) continue;
        if (head.what !== 'any' && (head.what === 'dragon') !== isDragonCard(id)) continue;
        q.hand.splice(i, 1);
        discarded++;
        discardedIds.push(id);
        if (isDragonCard(id)) s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
        else s = { ...s, caveDiscard: [...s.caveDiscard, id] };
      }
      s = setPlayer(s, q);
      const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: discarded > 0 } };
      if (discarded === 0) {
        return resumeSteps(head.resume, ctx);
      }
      let thenSteps: Step[] = [];
      if (head.activateDiscarded && discardedIds[0] !== undefined) {
        const dId = discardedIds[0];
        const card = isDragonCard(dId) ? dragonCard(dId) : caveCard(dId);
        if (card?.ability) {
          thenSteps = parseAbility(card).steps;
        }
      } else if (head.perCard && head.then) {
        for (let k = 0; k < discarded; k++) thenSteps.push(...head.then);
      } else if (discarded >= head.count && head.then) {
        thenSteps = head.then;
      }
      const steps = [...thenSteps, ...(head.resume?.steps ?? [])];
      return steps.length ? runSteps(s, steps, ctx) : s;
    }

    case 'chooseDisplay': {
      if (answer.kind !== 'index' && answer.kind !== 'decline') return state;
      const key = head.deck === 'dragon' ? 'dragonDisplay' : 'caveDisplay';
      const id = answer.kind === 'index' ? s[key][answer.index] : null;
      if (id == null) {
        // Rulebook: if there are no face-up cards in the display, draw from the top of the deck.
        const [drawn, s2] = drawCards(s, head.deck, 1);
        s = s2;
        if (drawn.length) {
          const q = clone(player(s, playerId));
          q.hand.push(...drawn);
          s = setPlayer(s, q);
        }
        return resumeSteps(head.resume);
      }
      s = takeFromDisplay(s, head.deck, id);
      const q = clone(player(s, playerId));
      q.hand.push(id);
      s = setPlayer(s, q);
      return resumeSteps(head.resume);
    }

    case 'distributeCards': {
      // Simplified: answer.indexes = indices into cardIds kept; rest follow
      // tuck/discard/playFree defaults (kept-first heuristic).
      const ids = head.cardIds;
      if (head.playFree) {
        // "Play 1 for free and keep/discard the other N": the answer's first
        // index is the card played; the rest go to hand ("keep") or the
        // discard pile. (Playing last — it may trigger further effects.)
        const first = answer.kind === 'indexes' ? answer.indexes[0] : undefined;
        const pick = first != null && ids[first] != null ? first : 0;
        const playId = ids[pick]!;
        const others = ids.filter((_, i) => i !== pick);
        if (head.keep != null) {
          const q = clone(player(s, playerId));
          q.hand.push(...others);
          s = setPlayer(s, q);
        } else {
          for (const id of others) {
            s = isDragonCard(id)
              ? { ...s, dragonDiscard: [...s.dragonDiscard, id] }
              : { ...s, caveDiscard: [...s.caveDiscard, id] };
          }
        }
        s = tryPlayFree(s, playerId, playId, head.resume?.ctx, head.orKeep);
        return resumeSteps(head.resume);
      }
      const keepIdx = answer.kind === 'indexes' ? new Set(answer.indexes) : new Set(ids.map((_, i) => i));
      const q = clone(player(s, playerId));
      const keepN = head.keep ?? ids.length;
      let kept = 0;
      const leftovers: number[] = [];
      for (let i = 0; i < ids.length; i++) {
        if (keepIdx.has(i) && kept < keepN) {
          q.hand.push(ids[i]!);
          kept++;
        } else {
          leftovers.push(ids[i]!);
        }
      }
      s = setPlayer(s, q);
      // leftovers: tuck up to tuck, discard the rest
      let tuckN = head.tuck === 'rest' ? leftovers.length : (head.tuck ?? 0);
      const target = head.tuckTarget ?? { kind: 'any' };
      const positions = dragonTargetPositions(player(s, playerId), target, head.resume?.ctx.dragon);
      for (const id of leftovers) {
        if (tuckN > 0 && isDragonCard(id) && positions.length) {
          const pos = positions[0]!;
          const q2 = clone(player(s, playerId));
          q2.caves[pos.cave]!.spaces[pos.space]!.dragon!.tucked.push(id);
          s = setPlayer(s, q2);
          s = fireRecurring(s, playerId, pos, 'tuck', 'dragonCard');
          tuckN--;
        } else if (isDragonCard(id)) {
          s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
        } else {
          s = { ...s, caveDiscard: [...s.caveDiscard, id] };
        }
      }
      return resumeSteps(head.resume);
    }

    case 'chooseAbility': {
      if (answer.kind === 'decline') return resumeSteps(head.resume);
      const idxs = answer.kind === 'indexes' ? answer.indexes : answer.kind === 'index' ? [answer.index] : [];
      if (!idxs.length) return state;
      const taken = new Set<string>();
      const abilitySteps: Step[] = [];
      for (const i of idxs.slice(0, head.count)) {
        const cand = head.candidates[i];
        if (!cand) continue;
        if (head.distinct && cand.dragon && taken.has(cand.dragon.join(','))) continue;
        if (cand.dragon) taken.add(cand.dragon.join(','));
        if (cand.matIcon) {
          const icons = MAT_ICONS[cand.matIcon.cave]?.[cand.matIcon.icon] ?? [];
          if (icons.length) abilitySteps.push({ op: 'withCtx', ctx: { playerId }, steps: icons });
        } else if (cand.dragon) {
          const d = player(s, playerId).caves[cand.dragon[0]]!.spaces[cand.dragon[1]]!.dragon;
          if (d) {
            const card = dragonCard(d.cardId);
            if (card.ability) {
              const def = parseAbility(card);
              abilitySteps.push({
                op: 'withCtx',
                ctx: { playerId, dragon: [cand.dragon[0], cand.dragon[1]], sourceCardId: card.id },
                steps: def.steps,
              });
            }
          }
        }
      }
      if (abilitySteps.length) {
        s = runSteps(s, abilitySteps, { playerId });
      }
      return resumeSteps(head.resume);
    }

    case 'chooseExcavate': {
      if (answer.kind === 'decline') return resumeSteps(head.resume);
      if (answer.kind !== 'index' && answer.kind !== 'dragon') return state;
      // We encode excavation as: option index = cave card choice (0..n-1 from
      // the source pool) packed with cave index via answer.dragon pos.
      const p = player(s, playerId);
      let cardId: number | null = null;
      let cave = 0;
      if (answer.kind === 'index') {
        // index packs [sourcePoolIndex, cave] as index = poolIdx*3 + cave
        const poolIdx = Math.floor(answer.index / 3);
        cave = answer.index % 3;
        const pool =
          head.source === 'hand'
            ? p.hand.filter((c) => !isDragonCard(c))
            : head.source === 'display'
              ? s.caveDisplay.filter((c): c is number => c !== null)
              : head.source === 'handOrDisplay'
                ? p.hand.filter((c) => !isDragonCard(c)).concat(s.caveDisplay.filter((c): c is number => c !== null))
                : [];
        cardId = pool[poolIdx] ?? null;
        if (head.source === 'deck') {
          const [drawn, s2] = drawCards(s, 'cave', 1);
          s = s2;
          cardId = drawn[0] ?? null;
        } else if (cardId != null) {
          const q = clone(p);
          if (q.hand.includes(cardId)) {
            q.hand.splice(q.hand.indexOf(cardId), 1);
            s = setPlayer(s, q);
          } else {
            s = takeFromDisplay(s, 'cave', cardId);
          }
        }
      }
      if (cardId == null) return resumeSteps(head.resume);
      s = excavateAt(s, playerId, cave, cardId, head.activateTimes ?? 1);
      if (head.count > 1) {
        // Re-queue the remaining excavations after any pending effects of the 1st excavation.
        const nextExcavate: Step = {
          op: 'excavateFree',
          source: head.source,
          count: head.count - 1,
          activateTimes: head.activateTimes,
        };
        const nextSteps = [nextExcavate, ...(head.resume?.steps ?? [])];
        return chainWithPending(basePendingLen, s, nextSteps, head.resume?.ctx ?? { playerId });
      }
      return resumeSteps(head.resume);
    }

    case 'choosePlayDragon': {
      if (answer.kind === 'decline') return resumeSteps(head.resume);
      if (answer.kind !== 'index' && answer.kind !== 'dragon') return state;
      const p = player(s, playerId);
      let cardId: number | undefined;
      if (head.source === 'deck') {
        const [drawn, s2] = drawCards(s, 'dragon', 1);
        s = s2;
        cardId = drawn[0];
        if (cardId != null && head.cond && !dragonMatchesCond(dragonCard(cardId), head.cond)) {
          s = { ...s, dragonDiscard: [...s.dragonDiscard, cardId] };
          return resumeSteps(head.resume);
        }
      } else {
        const rawPool =
          head.source === 'hand'
            ? p.hand.filter(isDragonCard)
            : head.source === 'display'
              ? s.dragonDisplay.filter((c): c is number => c !== null)
              : p.hand.filter(isDragonCard).concat(s.dragonDisplay.filter((c): c is number => c !== null));
        const pool = head.cond ? rawPool.filter((id) => dragonMatchesCond(dragonCard(id), head.cond!)) : rawPool;
        cardId = answer.kind === 'index' ? pool[answer.index] : pool[0];
      }
      if (cardId == null) return resumeSteps(head.resume);
      const pos = answer.kind === 'dragon' ? { cave: answer.pos[0], space: answer.pos[1] } : undefined;
      const placed = tryPlayDragonAt(s, playerId, cardId, head, pos);
      s = placed.state;
      if (!placed.ok && head.source === 'deck') {
        s = { ...s, dragonDiscard: [...s.dragonDiscard, cardId] };
      }
      return resumeSteps(head.resume);
    }

    case 'chooseGuildSquare': {
      const p = player(s, playerId);
      const tile = GUILD_TILES[s.guild.tile];
      if (answer.kind === 'index' || answer.kind === 'option') {
        const idx = answer.index;
        const square = tile.squares[idx];
        if (square) {
          const squares = s.guild.squares.map((row) => [...row]);
          // Rulebook: "Each square can hold 1 player marker." Only the long
          // rectangle (unlimited) holds any number.
          if (square.unlimited || (squares[idx] ?? []).length === 0) {
            squares[idx] = [...(squares[idx] ?? []), playerId];
            const q = clone(p);
            q.guildMarkersPlaced += 1;
            s = setPlayer(s, q);
            s = { ...s, guild: { ...s.guild, squares } };
            if (square.immediate) s = runSteps(s, square.immediate, { playerId });
          }
        }
      }
      return resumeSteps(head.resume);
    }

    case 'chooseOption': {
      if (answer.kind === 'decline') return resumeSteps(head.resume);
      const idx = answer.kind === 'option' || answer.kind === 'index' ? answer.index : 0;
      const ctx0 = head.resume?.ctx ?? { playerId };
      // repeat machinery
      if (ctx0.data?.repeatSteps !== undefined) {
        const repSteps = JSON.parse(String(ctx0.data.repeatSteps)) as Step[];
        const repRest = JSON.parse(String(ctx0.data.repeatRest ?? '[]')) as Step[];
        const left = Number(ctx0.data.repeatLeft ?? 0);
        if (idx === 0 && left > 0) {
          s = runSteps(s, repSteps, { ...ctx0, data: { ...ctx0.data, didPrecede: true } });
          const nextSteps: Step[] =
            left - 1 > 0
              ? [{ op: 'repeat', times: left - 1, steps: repSteps }, ...repRest]
              : repRest;
          return chainWithPending(basePendingLen, s, nextSteps, ctx0);
        }
        return runSteps(s, repRest, ctx0);
      }
      const opt = head.options[idx];
      if (opt?.steps) s = runSteps(s, opt.steps, ctx0);
      if (opt?.items) s = runSteps(s, [{ op: 'gain', items: opt.items }], ctx0);
      return resumeSteps(head.resume);
    }

    case 'chooseTrain': {
      if (answer.kind === 'decline') {
        const ctx0 = head.resume?.ctx ?? { playerId };
        const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: false } };
        return resumeSteps(head.resume, ctx);
      }
      if (answer.kind !== 'dragon' && answer.kind !== 'index') return state;
      const pos = head.pos
        ? { cave: head.pos[0], space: head.pos[1] }
        : answer.kind === 'dragon'
          ? { cave: answer.pos[0], space: answer.pos[1] }
          : undefined;
      if (!pos) return state;
      s = trainAt(s, playerId, pos, head);
      const ctx0 = head.resume?.ctx ?? { playerId };
      const ctx = { ...ctx0, data: { ...ctx0.data, didPrecede: true } };
      return resumeSteps(head.resume, ctx);
    }

    case 'chooseSwap': {
      if (answer.kind === 'dragons' && answer.positions.length >= 2) {
        const q = clone(player(s, playerId));
        const [a, b] = answer.positions;
        const dA = q.caves[a[0]]!.spaces[a[1]]!.dragon;
        const dB = q.caves[b[0]]!.spaces[b[1]]!.dragon;
        q.caves[a[0]]!.spaces[a[1]]!.dragon = dB;
        q.caves[b[0]]!.spaces[b[1]]!.dragon = dA;
        s = setPlayer(s, q);
      }
      return resumeSteps(head.resume);
    }

    case 'chooseHandDragonSwap': {
      if (answer.kind === 'decline') return resumeSteps(head.resume);
      const p = player(s, playerId);
      const matDragons = allDragons(p);
      const handDragons = p.hand.filter(isDragonCard);
      if (!matDragons.length || !handDragons.length) return resumeSteps(head.resume);
      let targetPos: Pos = { cave: matDragons[0]!.cave, space: matDragons[0]!.space };
      let newCardId: number = handDragons[0]!;
      if (answer.kind === 'assignTucks' && answer.assignments[0]) {
        const a = answer.assignments[0];
        if (p.hand.includes(a.cardId) && isDragonCard(a.cardId)) newCardId = a.cardId;
        if (p.caves[a.pos[0]]?.spaces[a.pos[1]]?.dragon) targetPos = { cave: a.pos[0], space: a.pos[1] };
      } else if (answer.kind === 'dragon') {
        if (p.caves[answer.pos[0]]?.spaces[answer.pos[1]]?.dragon) {
          targetPos = { cave: answer.pos[0], space: answer.pos[1] };
        }
      } else if (answer.kind === 'index') {
        const handIdx = Math.floor(answer.index / matDragons.length);
        const matIdx = answer.index % matDragons.length;
        if (handDragons[handIdx] != null) newCardId = handDragons[handIdx]!;
        if (matDragons[matIdx]) targetPos = { cave: matDragons[matIdx]!.cave, space: matDragons[matIdx]!.space };
      }
      const q = clone(p);
      const sp = q.caves[targetPos.cave]!.spaces[targetPos.space]!;
      const old = sp.dragon!;
      const handPos = q.hand.indexOf(newCardId);
      if (handPos >= 0) q.hand.splice(handPos, 1);
      q.hand.push(old.cardId);
      const newCard = dragonCard(newCardId);
      const newTrackLen = newCard.trainingTrack ? parseIcons(newCard.trainingTrack).length : 0;
      const nd: PlayedDragon = {
        cardId: newCardId,
        eggs: Math.min(old.eggs, newCard.capacity),
        tucked: [...old.tucked],
        cached: [...old.cached],
        training: newCard.size === 'Fledgling' ? Math.min(old.training ?? 0, newTrackLen) : undefined,
      };
      ensureDragonHooks(nd, true);
      sp.dragon = nd;
      s = setPlayer(s, q);
      s = log(s, `${q.name} swapped ${cardName(old.cardId)} with ${newCard.name}`);
      if (cardAbilityTypes(newCard).includes('WhenPlayed') && newCard.ability) {
        const def = parseAbility(newCard);
        s = runSteps(s, def.steps, { playerId, dragon: [targetPos.cave, targetPos.space], sourceCardId: newCardId });
      }
      return resumeSteps(head.resume);
    }

    case 'chooseCaveCardSwap': {
      if (answer.kind === 'decline') return resumeSteps(head.resume);
      const p = player(s, playerId);
      const uncovered: Pos[] = [];
      p.caves.forEach((row, cave) =>
        row.spaces.forEach((sp, space) => {
          if (sp.excavated && sp.caveCardId !== null && !sp.dragon) uncovered.push({ cave, space });
        }),
      );
      const handCaves = p.hand.filter((id) => !isDragonCard(id));
      if (!uncovered.length || !handCaves.length) return resumeSteps(head.resume);
      let targetPos: Pos = uncovered[0]!;
      let newCaveId: number = handCaves[0]!;
      if (answer.kind === 'cards' && answer.cardIds[0] != null) {
        if (handCaves.includes(answer.cardIds[0])) newCaveId = answer.cardIds[0];
      } else if (answer.kind === 'dragon') {
        const found = uncovered.find((u) => u.cave === answer.pos[0] && u.space === answer.pos[1]);
        if (found) targetPos = found;
      } else if (answer.kind === 'index') {
        const handIdx = Math.floor(answer.index / uncovered.length);
        const spaceIdx = answer.index % uncovered.length;
        if (handCaves[handIdx] != null) newCaveId = handCaves[handIdx]!;
        if (uncovered[spaceIdx]) targetPos = uncovered[spaceIdx]!;
      }
      const q = clone(p);
      const sp = q.caves[targetPos.cave]!.spaces[targetPos.space]!;
      const oldCaveId = sp.caveCardId!;
      const handPos = q.hand.indexOf(newCaveId);
      if (handPos >= 0) q.hand.splice(handPos, 1);
      q.hand.push(oldCaveId);
      sp.caveCardId = newCaveId;
      s = setPlayer(s, q);
      s = log(s, `${q.name} swapped cave card ${cardName(oldCaveId)} with ${cardName(newCaveId)}`);
      const card = caveCard(newCaveId);
      if (card?.ability) {
        const def = parseAbility(card);
        s = runSteps(s, def.steps, { playerId, dragon: [targetPos.cave, targetPos.space], sourceCardId: newCaveId });
      }
      return resumeSteps(head.resume);
    }

    case 'opponentMay': {
      if (answer.kind === 'confirm') {
        s = runSteps(s, head.steps, { playerId });
      }
      return resumeSteps(head.resume);
    }

    case 'discardDown': {
      if (answer.kind === 'cards' || answer.kind === 'resources') {
        const q = clone(player(s, playerId));
        if (answer.kind === 'cards') {
          for (const id of answer.cardIds) {
            const i = q.hand.indexOf(id);
            if (i >= 0) {
              q.hand.splice(i, 1);
              if (isDragonCard(id)) s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
              else s = { ...s, caveDiscard: [...s.caveDiscard, id] };
            }
          }
          while (q.hand.length > 9) {
            const id = q.hand.pop()!;
            if (isDragonCard(id)) s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
            else s = { ...s, caveDiscard: [...s.caveDiscard, id] };
          }
        } else {
          for (const r of answer.resources) if (q.resources[r] > 0) q.resources[r] -= 1;
          while (RESOURCES.reduce((a, r) => a + q.resources[r], 0) > 9) {
            const best = [...RESOURCES].sort((a, b) => q.resources[b] - q.resources[a])[0]!;
            if (q.resources[best] <= 0) break;
            q.resources[best] -= 1;
          }
        }
        // trim coins to 9 automatically
        q.coins = Math.min(q.coins, 9);
        s = setPlayer(s, q);
      }
      return s;
    }

    case 'oncePerRoundPick': {
      // The owner picks which of their remaining once-per-round dragons
      // activates next; the rest go back on the queue.
      const idx = answer.kind === 'index' || answer.kind === 'option' ? answer.index : 0;
      const chosen = Math.max(0, Math.min(idx, head.positions.length - 1));
      const pos = head.positions[chosen];
      if (pos) {
        const rest = head.positions.filter((_, i) => i !== chosen);
        if (rest.length) {
          s = {
            ...s,
            roundEndQueue: [...rest.map((p) => ({ playerId, pos: p })), ...s.roundEndQueue],
          };
        }
        s = runAbility(s, playerId, { cave: pos[0], space: pos[1] }, ['OncePerRound']);
      }
      return resumeSteps(head.resume);
    }

    case 'payDragonCost': {
      if (answer.kind === 'decline') return resumeSteps(head.resume);
      const idx = answer.kind === 'option' || answer.kind === 'index' ? answer.index : 0;
      const opt = head.options[idx] ?? head.options[0];
      const cost = applyDiscount(dragonPrintedCost(head.cardId), opt?.waive ?? []);
      const p = player(s, playerId);
      if (!canPay(p, cost)) {
        s = log(s, `${p.name} could not pay for ${cardName(head.cardId)}`);
        return resumeSteps(head.resume);
      }
      s = chargeItems(s, playerId, cost);
      s = placeDragonAt(s, playerId, head.cardId, { cave: head.pos[0], space: head.pos[1] }, head.onTop);
      return resumeSteps(head.resume);
    }

    case 'chooseBenefits': {
      if (answer.kind === 'indexes' || answer.kind === 'index') {
        const idxs = answer.kind === 'indexes' ? answer.indexes : [answer.index];
        const items: GainItem[] = [];
        for (const i of idxs.slice(0, head.count)) {
          const opt = head.options[i];
          if (opt) items.push(...opt);
        }
        if (items.length) s = runSteps(s, [{ op: 'gain', items }], { playerId });
      }
      return resumeSteps(head.resume);
    }

    case 'chooseIncomeSpace': {
      if (answer.kind !== 'index' && answer.kind !== 'option') return state;
      const spaceIdx = head.options[answer.index];
      if (spaceIdx === undefined) return state;
      const section = INCOME_SECTIONS[incomeSectionIndex(s.round)]!;
      s = {
        ...s,
        incomeChoices: { ...s.incomeChoices, [playerId]: spaceIdx },
      };
      return log(s, `${player(s, playerId).name} claimed income: ${section[spaceIdx]!.label}`);
    }
  }
  return s;
}

/** Collect one player's claimed income space (Academy round end, step 5). */
export function collectIncome(state: GameState, playerId: PlayerId): GameState {
  if (state.automa && playerId === 'p2') return state;
  const section = INCOME_SECTIONS[incomeSectionIndex(state.round)]!;
  const idx = state.incomeChoices[playerId];
  const space = idx !== undefined ? section[idx] : undefined;
  if (!space) return state;
  let s = log(state, `${player(state, playerId).name} collects income: ${space.label}`);
  s = runSteps(s, [{ op: 'gain', items: space.items }], { playerId });
  return s;
}

// ---------------------------------------------------------------------------
// Excavation / entice support used by both actions and free-play effects.

export function excavateAt(
  state: GameState,
  playerId: PlayerId,
  cave: number,
  caveCardId: number,
  activateTimes = 1,
): GameState {
  let s = state;
  const p = clone(player(s, playerId));
  const row = p.caves[cave]!;
  const idx = row.spaces.findIndex((sp) => !sp.excavated);
  if (idx < 0) return s;
  row.spaces[idx]!.excavated = true;
  row.spaces[idx]!.caveCardId = caveCardId;
  s = setPlayer(s, p);
  s = log(s, `${p.name} excavated space ${idx + 1} of cave ${cave + 1} with ${cardName(caveCardId)}`);
  const card = caveCard(caveCardId);
  const steps: Step[] = [];
  if (card?.ability) {
    const def = parseAbility(card);
    for (let t = 0; t < activateTimes; t++) {
      steps.push(...def.steps);
    }
  }
  const coveredSteps = MAT_COVERED_ICONS[cave]?.[idx] ?? [];
  steps.push(...coveredSteps);
  if (steps.length) {
    s = runSteps(s, steps, { playerId, dragon: [cave, idx], sourceCardId: caveCardId });
  }
  return s;
}

interface PlayResult {
  state: GameState;
  ok: boolean;
}

/** Charge a concrete cost (resources/coins/eggs/cards/items/tithes) to a player. */
function chargeItems(state: GameState, playerId: PlayerId, items: GainItem[]): GameState {
  let s = state;
  const q = payItems(clone(player(s, playerId)), items, undefined);
  for (const it of items) {
    if (it.kind === 'card') {
      let left = it.count;
      for (let c = q.hand.length - 1; c >= 0 && left > 0; c--) {
        const id = q.hand[c]!;
        const match = it.deck === 'dragon' ? isDragonCard(id) : !isDragonCard(id);
        if (match) {
          q.hand.splice(c, 1);
          if (it.deck === 'dragon') s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
          else s = { ...s, caveDiscard: [...s.caveDiscard, id] };
          left--;
        }
      }
    } else if (it.kind === 'egg') {
      removeEggs(q, it.count);
    }
  }
  // Pay generic 'item' (resource or card) and 'tithe' (resource, card, or egg).
  for (const it of items) {
    if (it.kind !== 'item' && it.kind !== 'tithe') continue;
    for (let k = 0; k < it.count; k++) {
      const bestRes = [...RESOURCES].sort((a, b) => q.resources[b] - q.resources[a])[0]!;
      if (q.resources[bestRes] > 0) {
        q.resources[bestRes] -= 1;
      } else if (q.hand.length > 0) {
        const id = q.hand.pop()!;
        if (isDragonCard(id)) s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
        else s = { ...s, caveDiscard: [...s.caveDiscard, id] };
      } else if (it.kind === 'tithe' && eggsOnMatCount(q) > 0) {
        removeEggs(q, 1);
      }
    }
  }
  return setPlayer(s, q);
}

function itemKey(it: GainItem): string {
  if (it.kind === 'resource') return `r:${it.res}`;
  if (it.kind === 'card') return `c:${it.deck}`;
  return it.kind;
}

/** Remove each `waive` item (up to its count) from a cost list. */
function applyDiscount(cost: GainItem[], waive: GainItem[]): GainItem[] {
  const out = cost.map((i) => ({ ...i }));
  for (const w of waive) {
    const idx = out.findIndex((i) => itemKey(i) === itemKey(w) && i.count > 0);
    if (idx >= 0) out[idx]!.count = Math.max(0, out[idx]!.count - w.count);
  }
  return out.filter((i) => i.count > 0);
}

/**
 * The single-item discounts a player may pick for a discounted play: only
 * items actually present in the printed cost can be waived ('any' expands to
 * each resource type the cost contains).
 */
function discountOptions(printed: GainItem[], discounts: GainItem[][]): { label: string; waive: GainItem[] }[] {
  const options: { label: string; waive: GainItem[] }[] = [];
  const inCost = (res: Resource) => printed.some((i) => i.kind === 'resource' && i.res === res);
  for (const d of discounts) {
    for (const w of d) {
      if (w.kind === 'egg' && printed.some((i) => i.kind === 'egg')) {
        options.push({ label: 'discount 1 egg', waive: [{ kind: 'egg', count: 1 }] });
      } else if (w.kind === 'coin' && printed.some((i) => i.kind === 'coin')) {
        options.push({ label: 'discount 1 coin', waive: [{ kind: 'coin', count: 1 }] });
      } else if (w.kind === 'resource') {
        const rs = w.res === 'any' ? RESOURCES.filter(inCost) : [w.res];
        for (const r of rs) {
          if (inCost(r)) options.push({ label: `discount 1 ${r}`, waive: [{ kind: 'resource', res: r, count: 1 }] });
        }
      }
    }
  }
  return options;
}

/** Place `cardId` at `pos`, firing its when-played ability. */
function placeDragonAt(state: GameState, playerId: PlayerId, cardId: number, pos: Pos, onTop?: boolean): GameState {
  let s = state;
  const card = dragonCard(cardId);
  const p = player(s, playerId);
  const q = clone(p);
  if (q.hand.includes(cardId)) q.hand.splice(q.hand.indexOf(cardId), 1);
  else s = takeFromDisplay(s, 'dragon', cardId);

  const space = q.caves[pos.cave]!.spaces[pos.space]!;
  if (space.dragon && onTop) {
    // transfer contents to the new dragon; old dragon becomes tucked
    const old = space.dragon;
    const nd: PlayedDragon = {
      cardId,
      eggs: Math.min(old.eggs, card.capacity),
      tucked: [...old.tucked, old.cardId],
      cached: old.cached,
      training: Math.min(old.training ?? 0, card.trainingTrack ? parseIcons(card.trainingTrack).length : 0),
      recurCount: old.recurCount,
    };
    ensureDragonHooks(nd, true);
    space.dragon = nd;
  } else {
    const nd: PlayedDragon = { cardId, eggs: 0, tucked: [], cached: [] };
    ensureDragonHooks(nd, false);
    space.dragon = nd;
  }
  s = setPlayer(s, q);
  s = log(s, `${q.name} enticed ${card.name}`);

  const ctx: EffectCtx = { playerId, dragon: [pos.cave, pos.space], sourceCardId: cardId };
  const def = parseAbility(card);
  if (cardAbilityTypes(card).includes('WhenPlayed')) {
    s = runSteps(s, def.steps, ctx);
  }
  return s;
}

/** Try to play `cardId` from hand/display into its leftmost legal space. */
export function tryPlayDragonAt(
  state: GameState,
  playerId: PlayerId,
  cardId: number,
  head: { discount?: GainItem[][] | 'full'; onTop?: boolean },
  pos?: Pos,
): PlayResult {
  let s = state;
  const card = dragonCard(cardId);
  const p = player(s, playerId);
  const prefCaves = card.caves
    .map((n) => (n === 'Crimson Cavern' ? 0 : n === 'Golden Grotto' ? 1 : 2))
    .filter((i) => i >= 0);
  let target: Pos | null = pos ?? null;
  if (target && (p.caves[target.cave]!.spaces[target.space]!.dragon || !p.caves[target.cave]!.spaces[target.space]!.excavated)) {
    if (!head.onTop) target = null;
  }
  if (!target) {
    outer: for (const c of prefCaves) {
      const row = p.caves[c]!;
      for (let i = 0; i < row.spaces.length; i++) {
        const sp = row.spaces[i]!;
        if (sp.excavated && !sp.dragon) {
          target = { cave: c, space: i };
          break outer;
        }
      }
    }
  }
  if (!target && head.onTop) {
    // play on top of any dragon in a preferred cave
    outer2: for (const c of prefCaves) {
      const row = p.caves[c]!;
      for (let i = 0; i < row.spaces.length; i++) {
        if (row.spaces[i]!.dragon) {
          target = { cave: c, space: i };
          break outer2;
        }
      }
    }
  }
  if (!target) return { state: s, ok: false };

  // Costed plays ("Pay its printed costs", "a discount of 1 X or Y") charge
  // the printed cost instead of playing for free.
  if (head.discount === 'full') {
    const printed = dragonPrintedCost(cardId);
    if (!canPay(p, printed)) {
      return { state: log(s, `${p.name} cannot pay ${card.name}'s printed cost`), ok: false };
    }
    s = chargeItems(s, playerId, printed);
  } else if (Array.isArray(head.discount)) {
    // The player picks which single item to discount, then pays the rest;
    // placement continues in the payDragonCost pending step.
    const options = discountOptions(dragonPrintedCost(cardId), head.discount);
    s = pushPending(s, {
      kind: 'payDragonCost',
      playerId,
      cardId,
      pos: [target.cave, target.space],
      onTop: head.onTop,
      options,
    });
    return { state: s, ok: true };
  }

  s = placeDragonAt(s, playerId, cardId, target, head.onTop);
  return { state: s, ok: true };
}

function tryPlayFree(state: GameState, playerId: PlayerId, cardId: number, ctx?: EffectCtx, orKeep?: boolean): GameState {
  void ctx;
  if (!isDragonCard(cardId)) {
    // Playing a cave card = excavating with it, into the first cave that
    // still has an unexcavated space (no space anywhere: keep if orKeep, else discard).
    const cave = player(state, playerId).caves.findIndex((row) => row.spaces.some((sp) => !sp.excavated));
    if (cave < 0) {
      if (orKeep) {
        const q = clone(player(state, playerId));
        q.hand.push(cardId);
        return setPlayer(state, q);
      }
      return { ...state, caveDiscard: [...state.caveDiscard, cardId] };
    }
    return excavateAt(state, playerId, cave, cardId);
  }
  const r = tryPlayDragonAt(state, playerId, cardId, {}, undefined);
  if (!r.ok && isDragonCard(cardId)) {
    if (orKeep) {
      const q = clone(player(state, playerId));
      q.hand.push(cardId);
      return setPlayer(state, q);
    }
    return { ...state, dragonDiscard: [...state.dragonDiscard, cardId] };
  }
  return r.state;
}

/** Run a dragon's ability of the given kind(s) at a position. */
export function runAbility(
  state: GameState,
  playerId: PlayerId,
  pos: Pos,
  kinds: import('./types').AbilityType[],
): GameState {
  const d = player(state, playerId).caves[pos.cave]!.spaces[pos.space]!.dragon;
  if (!d) return state;
  const card = dragonCard(d.cardId);
  const types = cardAbilityTypes(card);
  if (!kinds.some((k) => types.includes(k))) return state;
  if (!card.ability) return state;
  // Fledgling purple ability requires full training.
  if (card.size === 'Fledgling') {
    const track = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
    if ((d.training ?? 0) < track) return state;
  }
  const def = parseAbility(card);
  return runSteps(state, def.steps, { playerId, dragon: [pos.cave, pos.space], sourceCardId: card.id });
}

/** Train a fledgling at pos per a chooseTrain pending. */
function trainAt(
  state: GameState,
  playerId: PlayerId,
  pos: Pos,
  head: Extract<PendingStep, { kind: 'chooseTrain' }>,
): GameState {
  let s = state;
  const q = clone(player(s, playerId));
  // NOTE: re-fetch the dragon each iteration — payItems deep-clones `q`, so a
  // held reference goes stale the moment a box cost is paid.
  const dragon = () => q.caves[pos.cave]!.spaces[pos.space]!.dragon;
  const d0 = dragon();
  if (!d0) return s;
  const card = dragonCard(d0.cardId);
  if (card.size !== 'Fledgling' || !card.trainingTrack) return s;
  const track = parseIcons(card.trainingTrack)
    .map((t): GainItem | null => {
      switch (t.kind) {
        case 'resource': return { kind: 'resource', res: t.res, count: 1 };
        case 'card': return { kind: 'card', deck: t.deck, count: 1 };
        case 'coin': return { kind: 'coin', count: 1 };
        case 'egg': return { kind: 'egg', count: 1 };
        default: return null;
      }
    })
    .filter((i): i is GainItem => i !== null);
  const times = head.times === 'full' ? track.length - (d0.training ?? 0) : head.times;
  for (let i = 0; i < times; i++) {
    const d = dragon();
    if (!d) break;
    const boxIdx = d.training ?? 0;
    if (boxIdx >= track.length) break;
    const cost = track[boxIdx]!;
    if (head.gainItem) {
      // gain the covered item instead of paying
      const covered = cost;
      d.training = boxIdx + 1;
      s = setPlayer(s, q);
      s = runSteps(s, [{ op: 'gain', items: [covered] }], { playerId, dragon: [pos.cave, pos.space] });
      continue;
    }
    if (!head.free && !canPay(q, [cost])) break;
    if (!head.free) {
      const paid = payItems(q, [cost], undefined);
      Object.assign(q, paid);
      // Egg box costs are paid with eggs from anywhere on the mat (Academy
      // rules: items spent training are returned to the general supply).
      if (cost.kind === 'egg') removeEggs(q, cost.count);
      if (cost.kind === 'card') {
        for (let c = q.hand.length - 1; c >= 0; c--) {
          const id = q.hand[c]!;
          if ((cost.deck === 'dragon') === isDragonCard(id)) {
            q.hand.splice(c, 1);
            if (cost.deck === 'dragon') s = { ...s, dragonDiscard: [...s.dragonDiscard, id] };
            else s = { ...s, caveDiscard: [...s.caveDiscard, id] };
            break;
          }
        }
      }
    }
    dragon()!.training = boxIdx + 1;
  }
  s = setPlayer(s, q);
  s = log(s, `${player(s, playerId).name} trained ${card.name}`);
  return s;
}

/** Auto-place eggs on first available capacity (used for opponent egg gains). */
function autoLayEggs(state: GameState, playerId: PlayerId, n: number): GameState {
  const q = clone(player(state, playerId));
  let left = n;
  for (const d of allDragons(q)) {
    const dd = q.caves[d.cave]!.spaces[d.space]!.dragon!;
    const cap = dragonCard(dd.cardId).capacity;
    while (left > 0 && dd.eggs < cap) {
      dd.eggs++;
      left--;
    }
    if (left <= 0) break;
  }
  if (left > 0) q.nestEggs = Math.min(2, q.nestEggs + left);
  return setPlayer(state, q);
}
