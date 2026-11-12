// Wyrmspan pending-choice bar (setup keeps, resources, display picks, …).

import { useState } from 'react';
import { chooseAction as chooseWyrmAI } from '@/wyrmspan/ai';
import { RESOURCES, cardName, caveCard, dragonCard, isDragonCard } from '@/wyrmspan/cards';
import { GUILD_TILES, INCOME_SECTIONS, incomeSectionIndex } from '@/wyrmspan/guild';
import { player } from '@/wyrmspan/helpers';
import type { Action, GameState, PendingStep, Resource } from '@/wyrmspan/types';
import { WyrmResourceIcon } from '../svgArt';
import { WyrmCaveCardView, WyrmDragonCardView } from './CardViews';

/**
 * Steps the engine lets the player decline (abilities are optional — rulebook:
 * "These benefits are not mandatory"; opponents still collect their share).
 * Steps with `upTo` / `optional` are declinable too.
 */
const DECLINABLE = new Set<PendingStep['kind']>([
  'choosePay', 'opponentMay', 'chooseTrain', 'chooseTuck', 'chooseCache', 'chooseOption', 'chooseExcavate',
  'choosePlayDragon', 'payDragonCost', 'chooseAbility', 'chooseSwap', 'chooseHandDragonSwap', 'chooseCaveCardSwap',
]);

export function WyrmspanPendingBar({
  state,
  step,
  controls,
  dispatch,
}: {
  state: GameState;
  step: PendingStep;
  controls: boolean;
  dispatch: (a: Action) => void;
}) {
  const p = player(state, step.playerId);
  const [setupKeeps, setSetupKeeps] = useState<number[]>(() =>
    step.kind === 'setupCards' ? step.offer.slice(0, step.keep) : [],
  );
  const [setupRes, setSetupRes] = useState<Resource[]>(['meat', 'gold', 'crystal']);

  if (!controls) {
    return (
      <div className="pending-bar">
        <span>Waiting for {p.name} ({step.kind})…</span>
      </div>
    );
  }

  const autoAnswer = () => {
    const aiMove = chooseWyrmAI(state, step.playerId);
    if (aiMove) dispatch(aiMove);
  };

  return (
    <div className="pending-bar">
      <span className="badge">{p.name}</span>
      <b>{step.kind}</b>

      {step.kind === 'setupCards' && (
        <div className="row">
          <span className="muted">Pick {step.keep} of 6 cards to keep:</span>
          <div className="setup-card-row">
            {step.offer.map((cid) => {
              const on = setupKeeps.includes(cid);
              const toggle = () =>
                setSetupKeeps((cur) =>
                  cur.includes(cid)
                    ? cur.filter((x) => x !== cid)
                    : cur.length < step.keep
                      ? [...cur, cid]
                      : [...cur.slice(1), cid],
                );
              return isDragonCard(cid) ? (
                <WyrmDragonCardView key={cid} card={dragonCard(cid)} zone="setup" selectable selected={on} onClick={toggle} />
              ) : (
                <WyrmCaveCardView key={cid} card={caveCard(cid)} zone="setup" selectable selected={on} onClick={toggle} />
              );
            })}
          </div>
          <button
            type="button"
            className="primary"
            disabled={setupKeeps.length !== step.keep}
            onClick={() =>
              dispatch({
                type: 'resolveChoice',
                playerId: step.playerId,
                answer: { kind: 'cards', cardIds: setupKeeps },
              })
            }
          >
            ✓ Keep {setupKeeps.length}/{step.keep} selected
          </button>
        </div>
      )}

      {step.kind === 'setupResources' && (
        <div className="row">
          <span className="muted">Pick {step.count} starting resources:</span>
          {Array.from({ length: step.count }, (_, slotIdx) => (
            <span key={slotIdx} className="res-picker" role="group" aria-label={`Starting resource ${slotIdx + 1}`}>
              {RESOURCES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={setupRes[slotIdx] === r ? 'primary' : 'secondary'}
                  title={r}
                  onClick={() => {
                    const next = setupRes.slice();
                    next[slotIdx] = r;
                    setSetupRes(next);
                  }}
                >
                  <WyrmResourceIcon kind={r} size={18} />
                </button>
              ))}
            </span>
          ))}
          <button
            type="button"
            className="primary"
            onClick={() =>
              dispatch({
                type: 'resolveChoice',
                playerId: step.playerId,
                answer: { kind: 'resources', resources: setupRes.slice(0, step.count) },
              })
            }
          >
            ✓ Gain{' '}
            {setupRes.slice(0, step.count).map((r, i) => (
              <WyrmResourceIcon key={i} kind={r} size={15} />
            ))}
          </button>
        </div>
      )}

      {step.kind === 'chooseDisplay' && (
        <div className="row">
          {(step.deck === 'dragon' ? state.dragonDisplay : state.caveDisplay).map((cid, idx) =>
            cid != null ? (
              <button
                key={idx}
                type="button"
                className="primary"
                onClick={() =>
                  dispatch({
                    type: 'resolveChoice',
                    playerId: step.playerId,
                    answer: { kind: 'index', index: idx },
                  })
                }
              >
                Take {cardName(cid)}
              </button>
            ) : null,
          )}
          {step.orDeck && (
            <button
              type="button"
              className="secondary"
              onClick={() =>
                dispatch({ type: 'resolveChoice', playerId: step.playerId, answer: { kind: 'decline' } })
              }
            >
              Draw from the deck
            </button>
          )}
        </div>
      )}

      {step.kind === 'chooseResource' && (
        <div className="row">
          {(step.allowed ?? RESOURCES).map((r) => (
            <button
              key={r}
              type="button"
              className="primary"
              onClick={() =>
                dispatch({
                  type: 'resolveChoice',
                  playerId: step.playerId,
                  answer: {
                    kind: 'resources',
                    resources: Array.from({ length: step.count }, () => r),
                  },
                })
              }
            >
              <WyrmResourceIcon kind={r} size={15} /> {step.count}× {r}
            </button>
          ))}
        </div>
      )}

      {step.kind === 'chooseOption' && (
        <div className="row">
          {step.options.map((opt, idx) => (
            <button
              key={idx}
              type="button"
              className="primary"
              onClick={() =>
                dispatch({
                  type: 'resolveChoice',
                  playerId: step.playerId,
                  answer: { kind: 'index', index: idx },
                })
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {step.kind === 'chooseGuildSquare' && (
        <div className="row">
          {GUILD_TILES[state.guild.tile]?.squares.map((sq, idx) => {
            const occ = state.guild.squares[idx] ?? [];
            const canPick = sq.unlimited || occ.length === 0;
            return (
              <button
                key={idx}
                type="button"
                className="primary"
                disabled={!canPick}
                onClick={() =>
                  dispatch({
                    type: 'resolveChoice',
                    playerId: step.playerId,
                    answer: { kind: 'index', index: idx },
                  })
                }
              >
                Sq {idx + 1}: {sq.label.slice(0, 28)}
              </button>
            );
          })}
        </div>
      )}

      {step.kind === 'chooseIncomeSpace' && (
        <div className="row">
          {step.options.map((spaceIdx, optIdx) => {
            const sec = INCOME_SECTIONS[incomeSectionIndex(state.round)]!;
            const sp = sec[spaceIdx];
            return (
              <button
                key={spaceIdx}
                type="button"
                className="primary"
                onClick={() =>
                  dispatch({
                    type: 'resolveChoice',
                    playerId: step.playerId,
                    answer: { kind: 'index', index: optIdx },
                  })
                }
              >
                {sp?.label ?? `Income #${spaceIdx + 1}`}
              </button>
            );
          })}
        </div>
      )}

      <button type="button" className="primary" onClick={autoAnswer}>
        ✓ Auto-Resolve ({step.kind})
      </button>

      {('upTo' in step && step.upTo) ||
      ('optional' in step && step.optional) ||
      DECLINABLE.has(step.kind) ? (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            dispatch({
              type: 'resolveChoice',
              playerId: step.playerId,
              answer: { kind: 'decline' },
            })
          }
        >
          Decline
        </button>
      ) : null}
    </div>
  );
}
