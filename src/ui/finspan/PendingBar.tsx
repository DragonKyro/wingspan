// Finspan pending-choice bar.

import { fish } from '@/finspan/cards';
import { MAX_CORAL } from '@/finspan/constants';
import { getPlayer, slotAt, topFish } from '@/finspan/helpers';
import { effectLabel } from '@/finspan/powers';
import { chooseForPending } from '@/finspan/ai/choices';
import type { Action, GameState, PendingStep } from '@/finspan/types';
import { SITE_COLORS } from '@/finspan/types';

export function FinspanPendingBar({
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
  const p = getPlayer(state, step.playerId);
  if (!controls) {
    return (
      <div className="pending-bar">
        <span>Waiting for {p.name} to resolve {step.kind}…</span>
      </div>
    );
  }

  const autoAnswer = () => {
    const choice = chooseForPending(state, step);
    dispatch({ type: 'resolveChoice', playerId: step.playerId, choice });
  };

  return (
    <div className="pending-bar">
      <span className="badge">{p.name}</span>
      <span>
        <b>{step.kind}</b>
      </span>
      {step.kind === 'confirmBenefit' && <span>Take {step.label}? (optional)</span>}
      {step.kind === 'chooseEffectOrder' && (
        <div className="row">
          <span>Which benefit first?</span>
          {step.effects.map((e, i) => (
            <button
              key={i}
              type="button"
              className="primary"
              onClick={() => dispatch({ type: 'resolveChoice', playerId: step.playerId, choice: { kind: 'index', index: i } })}
            >
              {effectLabel(e)}
            </button>
          ))}
        </div>
      )}
      {step.kind === 'chooseGameEndAbility' && (
        <div className="row">
          <span>Next GAME END ability:</span>
          {step.slots.map((ref) => (
            <button
              key={`${ref.row}-${ref.col}`}
              type="button"
              className="primary"
              onClick={() => dispatch({ type: 'resolveChoice', playerId: step.playerId, choice: { kind: 'slots', slots: [ref] } })}
            >
              {topFish(slotAt(p.ocean, ref))?.name ?? `r${ref.row}c${ref.col}`}
            </button>
          ))}
        </div>
      )}
      {step.kind === 'chooseCoralSite' && (
        <div className="row">
          {SITE_COLORS.map((site, col) => (
            <button
              key={site}
              type="button"
              className="primary"
              disabled={p.ocean.corals[col]! >= MAX_CORAL}
              onClick={() =>
                dispatch({
                  type: 'resolveChoice',
                  playerId: step.playerId,
                  choice: { kind: 'site', col },
                })
              }
            >
              +1 {site} Coral ({p.ocean.corals[col]}/{MAX_CORAL})
            </button>
          ))}
        </div>
      )}
      {step.kind === 'chooseRecover' && p.discard.length > 0 && step.count === 1 && (
        <div className="row">
          {p.discard.map((cid) => (
            <button
              key={cid}
              type="button"
              className="primary"
              onClick={() =>
                dispatch({
                  type: 'resolveChoice',
                  playerId: step.playerId,
                  choice: { kind: 'handCards', cardIds: [cid] },
                })
              }
            >
              Recover {fish(cid).name}
            </button>
          ))}
        </div>
      )}
      {step.kind === 'chooseHandDiscard' && p.hand.length > 0 && step.count === 1 && (
        <div className="row">
          {p.hand.map((cid) => (
            <button
              key={cid}
              type="button"
              className="primary"
              onClick={() =>
                dispatch({
                  type: 'resolveChoice',
                  playerId: step.playerId,
                  choice: { kind: 'handCards', cardIds: [cid] },
                })
              }
            >
              Discard {fish(cid).name}
            </button>
          ))}
        </div>
      )}
      <button type="button" className="primary" onClick={autoAnswer}>
        ✓ Confirm Smart Choice
      </button>
      {'optional' in step && step.optional && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            dispatch({
              type: 'resolveChoice',
              playerId: step.playerId,
              choice: { kind: 'decline' },
            })
          }
        >
          Decline
        </button>
      )}
      {step.kind === 'chooseReefDiscard' && (
        <button
          type="button"
          className="secondary"
          onClick={() =>
            dispatch({
              type: 'resolveChoice',
              playerId: step.playerId,
              choice: { kind: 'reefDiscard', use: false },
            })
          }
        >
          Skip Reef Coral
        </button>
      )}
    </div>
  );
}
