// The four Wingspan turn actions and end-turn controls.

import { bird } from '@/wingspan/cards';
import {
  FOREST_DICE,
  GRASSLAND_EGGS,
  OCEANIA_FOREST_DICE,
  OCEANIA_GRASSLAND_EGGS,
  OCEANIA_WETLAND_CARDS,
  WETLAND_CARDS,
} from '@/wingspan/constants';
import {
  actingPlayerId,
  actionSlot,
  autoPayBird,
  getPlayer,
  isOceania,
  rowFull,
} from '@/wingspan/helpers';
import { useGameStore } from '@/store/gameStore';
import type { FoodType, GameState, PlayerId } from '@/wingspan/types';
import { FoodIcon, HabitatIcon } from '../svgArt';
import type { Draft } from './draft';

export function ActionsPanel({
  game,
  draft,
  setDraft,
  canAct,
  dispatch,
}: {
  game: GameState;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  canAct: (pid: PlayerId) => boolean;
  dispatch: (a: Parameters<ReturnType<typeof useGameStore.getState>['dispatch']>[0]) => void;
}) {
  const acting = actingPlayerId(game);
  const p = getPlayer(game, acting);
  const mine = canAct(acting);
  const fresh = mine && !game.turnTookAction && game.phase === 'main';
  const inActivation = !!game.activation && game.activation.remaining.length > 0;

  const oceania = isOceania(game);
  const diceCount = (oceania ? OCEANIA_FOREST_DICE : FOREST_DICE)[actionSlot(p, 'forest', oceania)]!;
  const eggCount = (oceania ? OCEANIA_GRASSLAND_EGGS : GRASSLAND_EGGS)[actionSlot(p, 'grassland', oceania)]!;
  const cardCount = (oceania ? OCEANIA_WETLAND_CARDS : WETLAND_CARDS)[actionSlot(p, 'wetland', oceania)]!;

  return (
    <div className="card">
      <h3>⚡ Turn Actions</h3>
      {game.phase === 'setup' && (
        <div className="muted">Setup in progress — choose birds and 1 bonus card in your hand below.</div>
      )}
      {draft?.kind === 'gainFood' && (
        <div className="row" style={{ marginBottom: 8 }}>
          {draft.picks.some((idx) => game.feederIn[idx] === 'split') && (
            <div className="row">
              <span className="muted">Split die:</span>
              <button
                type="button"
                className={draft.splitTake === 'invertebrate' ? 'primary' : 'secondary'}
                onClick={() => setDraft({ ...draft, splitTake: 'invertebrate' })}
              >
                <FoodIcon food="invertebrate" size={14} /> Invert
              </button>
              <button
                type="button"
                className={draft.splitTake === 'seed' ? 'primary' : 'secondary'}
                onClick={() => setDraft({ ...draft, splitTake: 'seed' })}
              >
                <FoodIcon food="seed" size={14} /> Seed
              </button>
            </div>
          )}
          <button
            className="primary"
            disabled={
              draft.picks.length !== diceCount &&
              !(draft.reroll && draft.picks.length === 0)
            }
            onClick={() => {
              // Convert displayed feeder indices to live shrinking-feeder indices:
              const livePicks = draft.picks.map((origIdx, k) => {
                const shift = draft.picks.slice(0, k).filter((pIdx) => pIdx < origIdx).length;
                return { die: origIdx - shift, take: draft.splitTake as FoodType };
              });
              // Rerolling before picking: the dice are picked after the reroll
              // (the engine asks once the new dice are showing).
              const finalPicks = livePicks;
              dispatch({
                type: 'gainFood',
                playerId: acting,
                reroll: draft.reroll || undefined,
                picks: finalPicks,
              });
              setDraft(null);
            }}
          >
            {draft.reroll && draft.picks.length === 0
              ? `Reroll, then pick ${diceCount}`
              : `Take Food (${draft.picks.length}/${diceCount})`}
          </button>
          <button onClick={() => setDraft(null)}>Cancel</button>
        </div>
      )}
      {draft?.kind === 'layEggs' && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className="primary"
            onClick={() => {
              dispatch({ type: 'layEggs', playerId: acting, placements: draft.placements });
              setDraft(null);
            }}
          >
            Lay {draft.placements.length} Egg{draft.placements.length === 1 ? '' : 's'}
          </button>
          <button onClick={() => setDraft(null)}>Cancel</button>
        </div>
      )}
      {draft?.kind === 'drawCards' && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className="primary"
            disabled={draft.picks.length !== cardCount}
            onClick={() => {
              dispatch({ type: 'drawCards', playerId: acting, picks: draft.picks });
              setDraft(null);
            }}
          >
            Draw {draft.picks.length}/{cardCount}
          </button>
          <button onClick={() => setDraft(null)}>Cancel</button>
        </div>
      )}
      {draft?.kind === 'playBird' && (
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="muted">
            Playing <b>{bird(draft.cardId).name}</b> in <b>{draft.habitat}</b> — click the highlighted
            slot, or switch habitat:
          </span>
          {bird(draft.cardId).habitats.map((h) => (
            <button
              key={h}
              className={draft.habitat === h ? 'primary' : 'secondary'}
              disabled={rowFull(p, h) || autoPayBird(p, draft.cardId) == null}
              onClick={() => setDraft({ ...draft, habitat: h })}
            >
              {h}
            </button>
          ))}
          <button onClick={() => setDraft(null)}>Cancel</button>
        </div>
      )}
      {!draft && fresh && (
        <div className="action-btn-stack">
          <button
            onClick={() =>
              setDraft({ kind: 'gainFood', reroll: false, picks: [], splitTake: 'seed' })
            }
          >
            <HabitatIcon habitat="forest" size={16} /> Gain Food (×{diceCount})
          </button>
          <button onClick={() => setDraft({ kind: 'layEggs', placements: [] })}>
            <HabitatIcon habitat="grassland" size={16} /> Lay Eggs (×{eggCount})
          </button>
          <button onClick={() => setDraft({ kind: 'drawCards', picks: [] })}>
            <HabitatIcon habitat="wetland" size={16} /> Draw Cards (×{cardCount})
          </button>
        </div>
      )}
      {!draft &&
        mine &&
        game.phase === 'main' &&
        !inActivation &&
        game.duet?.reset.includes(acting) && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="muted">Duet reset token:</span>
            <button
              onClick={() => dispatch({ type: 'duetReset', playerId: acting, target: 'feeder' })}
            >
              Reset Feeder
            </button>
            <button
              onClick={() => dispatch({ type: 'duetReset', playerId: acting, target: 'tray' })}
            >
              Reset Tray
            </button>
          </div>
        )}
      {inActivation && mine && (
        <div className="row" style={{ marginTop: 8 }}>
          <span>
            Activate{' '}
            <b>
              {
                bird(
                  p.board[game.activation!.habitat][game.activation!.remaining[0]!]!.cardId,
                ).name
              }
            </b>
            &apos;s brown power?
          </span>
          <button
            className="primary"
            onClick={() => dispatch({ type: 'activatePower', playerId: acting })}
          >
            Activate
          </button>
          <button onClick={() => dispatch({ type: 'skipPower', playerId: acting })}>Skip</button>
          <button onClick={() => dispatch({ type: 'skipPower', playerId: acting, all: true })}>
            Skip All
          </button>
        </div>
      )}
      {mine && game.turnTookAction && !inActivation && (
        <div style={{ marginTop: 8 }}>
          <button
            className="primary"
            onClick={() => dispatch({ type: 'endTurn', playerId: acting })}
          >
            End Turn →
          </button>
        </div>
      )}
    </div>
  );
}
