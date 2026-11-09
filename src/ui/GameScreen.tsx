import { useState } from 'react';
import { bird, goalTile } from '@/game/cards';
import {
  FOREST_DICE,
  GRASSLAND_EGGS,
  OCEANIA_FOREST_DICE,
  OCEANIA_GRASSLAND_EGGS,
  OCEANIA_WETLAND_CARDS,
  WETLAND_CARDS,
} from '@/game/constants';
import {
  actingPlayerId,
  actionSlot,
  autoPayBird,
  columnEggCost,
  getPlayer,
  isCoverBird,
  isOceania,
  playedBirds,
  rowFull,
  totalEggs,
} from '@/game/helpers';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import type {
  BirdRef,
  DieFace,
  FoodType,
  GameState,
  Habitat,
  PlayerId,
  PlayerState,
} from '@/game/types';
import { BASE_FOODS, FOOD_TYPES, HABITATS } from '@/game/types';
import { BirdCardView, BonusCardView } from './BirdCardView';
import { PendingBar } from './PendingBar';

type Draft =
  | { kind: 'playBird'; cardId: number; habitat: Habitat | null }
  | { kind: 'gainFood'; reroll: boolean; picks: number[] }
  | { kind: 'layEggs'; placements: BirdRef[] }
  | { kind: 'drawCards'; picks: ('deck' | number)[] }
  | { kind: 'setup'; keepBirds: number[]; keepBonus: number | null };

export function GameScreen() {
  const game = useGameStore((s) => s.game)!;
  const dispatch = useGameStore((s) => s.dispatch);
  const { role, connection, myUuid, uuidForPlayer, leaveRoom } = useNetworkStore();
  const clearGame = useGameStore((s) => s.clearGame);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);

  const acting = actingPlayerId(game);
  const actingIdx = game.playerOrder.indexOf(acting);
  const myIdx =
    connection === 'in-game'
      ? game.playerOrder.findIndex((pid) => uuidForPlayer(pid) === myUuid)
      : -1;
  const shownIdx = viewIdx ?? (myIdx >= 0 ? myIdx : actingIdx);
  const shown = game.playerOrder[shownIdx]!;
  const shownP = getPlayer(game, shown);

  /** This device controls `pid`'s moves. */
  const controls = (pid: PlayerId): boolean => {
    if (connection !== 'in-game') return true; // solo / hot-seat
    if (role === 'spectator') return false;
    const owner = uuidForPlayer(pid);
    return owner === myUuid || (owner === null && role === 'host');
  };

  const canAct = (pid: PlayerId) => controls(pid) && game.pending.length === 0;

  const head = game.pending[0];

  return (
    <div className="game">
      <div>
        <TopBar game={game} />
        <CommonRow game={game} draft={draft} setDraft={setDraft} canAct={canAct} />
        <PlayerMatView
          player={shownP}
          oceania={isOceania(game)}
          draft={draft}
          setDraft={setDraft}
          controls={controls(shown)}
          dispatch={dispatch}
        />
        <div className="row" style={{ margin: '8px 0' }}>
          {game.playerOrder.map((pid, i) => (
            <button
              key={pid}
              onClick={() => setViewIdx(i)}
              style={i === shownIdx ? { borderColor: 'var(--accent)' } : undefined}
            >
              <span className={`pcolor c-${getPlayer(game, pid).color}`} />
              {getPlayer(game, pid).name}
              {i === actingIdx && <span className="turn-dot" />}
            </button>
          ))}
        </div>
        <HandArea
          game={game}
          player={shownP}
          draft={draft}
          setDraft={setDraft}
          controls={controls(shown)}
          dispatch={dispatch}
        />
      </div>
      <div>
        <ActionsPanel game={game} draft={draft} setDraft={setDraft} canAct={canAct} dispatch={dispatch} />
        <div className="card">
          <h3>Log</h3>
          <div className="log">
            {game.log.slice(-60).map((e) => (
              <div key={e.seq}>{e.msg}</div>
            ))}
          </div>
        </div>
        <button
          onClick={() => {
            if (connection === 'in-game') leaveRoom();
            else clearGame();
          }}
        >
          {connection === 'in-game' ? 'Leave room' : 'Back to menu'}
        </button>
      </div>
      {head && (
        <PendingBar
          game={game}
          step={head}
          controls={controls(head.playerId)}
          dispatch={dispatch}
        />
      )}
      {game.phase === 'gameOver' && <GameOverCard game={game} />}
    </div>
  );
}

function TopBar({ game }: { game: GameState }) {
  const acting = getPlayer(game, actingPlayerId(game));
  return (
    <div className="card row">
      <b>Round {game.round + 1}/4</b>
      <span>
        Acting: <span className={`pcolor c-${acting.color}`} />
        {acting.name} ({acting.actionCubes} cubes)
      </span>
      {game.phase === 'setup' && <span className="badge">setup — each player keeps birds</span>}
      {game.turnTookAction && <span className="muted">action taken — powers then end turn</span>}
      <div className="spacer" />
      {game.goalTiles.map((id, r) => (
        <span key={id} className={r === game.round ? 'badge' : 'muted'} title={goalTile(id).text}>
          R{r + 1}: {goalTile(id).text}
        </span>
      ))}
    </div>
  );
}

/** Feeder, tray and deck — the shared middle area. */
function CommonRow({
  game,
  draft,
  setDraft,
  canAct,
}: {
  game: GameState;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  canAct: (pid: PlayerId) => boolean;
}) {
  const acting = actingPlayerId(game);
  const actingP = getPlayer(game, acting);
  const oceania = isOceania(game);
  const pickingDice = draft?.kind === 'gainFood';
  const diceNeeded = pickingDice
    ? (oceania ? OCEANIA_FOREST_DICE : FOREST_DICE)[actionSlot(actingP, 'forest', oceania)]! +
      (0 /* trade adds later */)
    : 0;
  const allSame = game.feederIn.length > 0 && game.feederIn.every((f) => f === game.feederIn[0]);
  const pickingCards = draft?.kind === 'drawCards';
  const cardsNeeded = pickingCards
    ? (oceania ? OCEANIA_WETLAND_CARDS : WETLAND_CARDS)[actionSlot(actingP, 'wetland', oceania)]!
    : 0;

  return (
    <div className="card">
      <div className="row">
        <div>
          <h3>Birdfeeder {pickingDice && `— pick ${diceNeeded}`}</h3>
          <div className="row">
            {game.feederIn.map((f, i) => (
              <span
                key={i}
                className={`die${pickingDice && canAct(acting) ? ' selectable' : ''}${
                  pickingDice && draft.picks.includes(i) ? ' picked' : ''
                }`}
                onClick={() => {
                  if (!pickingDice || !canAct(acting) || draft.kind !== 'gainFood') return;
                  if (draft.picks.includes(i)) {
                    setDraft({ ...draft, picks: draft.picks.filter((x) => x !== i) });
                  } else if (draft.picks.length < diceNeeded) {
                    setDraft({ ...draft, picks: [...draft.picks, i] });
                  }
                }}
              >
                {dieLabel(f)}
              </span>
            ))}
            {pickingDice && allSame && !draft.reroll && (
              <button onClick={() => setDraft({ kind: 'gainFood', reroll: true, picks: [] })}>
                Reroll (all same)
              </button>
            )}
          </div>
        </div>
        <div className="spacer" />
        <div>
          <h3>Tray {pickingCards && `— pick ${cardsNeeded}`}</h3>
          <div className="tray">
            <div
              className={`deck-stack${pickingCards && canAct(acting) ? ' selectable' : ''}`}
              title={`${game.deck.length} in deck`}
              onClick={() => {
                if (!pickingCards || !canAct(acting) || draft.kind !== 'drawCards') return;
                if (draft.picks.length < cardsNeeded) setDraft({ ...draft, picks: [...draft.picks, 'deck'] });
              }}
            >
              {game.deck.length}
            </div>
            {game.tray.map((id, i) =>
              id == null ? (
                <div key={i} className="slot empty" style={{ width: 110, minHeight: 130 }} />
              ) : (
                <BirdCardView
                  key={id}
                  cardId={id}
                  selectable={pickingCards && canAct(acting) && !draft.picks.includes(i)}
                  selected={pickingCards && draft.picks.includes(i)}
                  onClick={() => {
                    if (!pickingCards || !canAct(acting) || draft.kind !== 'drawCards') return;
                    if (draft.picks.length < cardsNeeded && !draft.picks.includes(i)) {
                      setDraft({ ...draft, picks: [...draft.picks, i] });
                    }
                  }}
                />
              ),
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function dieLabel(f: DieFace): string {
  return f === 'split' ? 'inv/seed' : f === 'invertebrate' ? 'invert' : f;
}

/** One player's mat: three habitat rows, five slots each. */
function PlayerMatView({
  player,
  oceania,
  draft,
  setDraft,
  controls,
  dispatch,
}: {
  player: PlayerState;
  oceania: boolean;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  controls: boolean;
  dispatch: (a: Parameters<ReturnType<typeof useGameStore.getState>['dispatch']>[0]) => void;
}) {
  const playing = draft?.kind === 'playBird' && draft.habitat;
  const laying = draft?.kind === 'layEggs';
  const eggsLeft = laying
    ? (oceania ? OCEANIA_GRASSLAND_EGGS : GRASSLAND_EGGS)[actionSlot(player, 'grassland', oceania)]! -
      draft.placements.length
    : 0;

  return (
    <div className="card mat">
      <div className="mat-head">
        <span className={`pcolor c-${player.color}`} />
        <span className="name">{player.name}</span>
        <FoodCounts player={player} />
        <span className="muted">hand {player.hand.length} · eggs {totalEggs(player)}</span>
      </div>
      {HABITATS.map((h) => (
        <div key={h} className="hab-row">
          <div className={`hab-label hab-${h}`}>{h}</div>
          <div className="slots">
            {Array.from({ length: 5 }, (_, i) => {
              const b = player.board[h][i];
              const playHere = playing && draft.habitat === h && i === player.board[h].length;
              const coverTarget =
                playing &&
                draft.kind === 'playBird' &&
                isCoverBird(bird(draft.cardId)) &&
                b &&
                !b.ghost &&
                bird(draft.cardId).habitats.includes(h);
              const eggTarget =
                laying &&
                controls &&
                b &&
                b.eggs < bird(b.cardId).eggLimit;
              return (
                <div
                  key={i}
                  className={`slot${b ? '' : ' empty'}${b?.ghost ? ' ghost' : ''}`}
                  onClick={() => {
                    if (!controls) return;
                    // European cover predators: click an existing bird to play
                    // on top of it (tucks the covered bird, pays nothing).
                    if (playing && draft.kind === 'playBird') {
                      const card = bird(draft.cardId);
                      if (isCoverBird(card) && b && !b.ghost && card.habitats.includes(h)) {
                        dispatch({
                          type: 'playBird',
                          playerId: player.id,
                          cardId: draft.cardId,
                          habitat: h,
                          eggPayments: [],
                          foodPayments: [],
                          coverBird: { habitat: h, index: i },
                        });
                        setDraft(null);
                        return;
                      }
                    }
                    if (playHere && controls) {
                      const col = i;
                      const pay = autoPayBird(player, draft.cardId);
                      if (!pay) return;
                      dispatch({
                        type: 'playBird',
                        playerId: player.id,
                        cardId: draft.cardId,
                        habitat: h,
                        eggPayments: autoEggs(player, columnEggCost(col)),
                        foodPayments: pay.foodPayments,
                        cachedFoodPayments: pay.cachedFoodPayments,
                        cardPayments: pay.cardPayments,
                      });
                      setDraft(null);
                    } else if (eggTarget && laying && draft.kind === 'layEggs') {
                      setDraft({ ...draft, placements: [...draft.placements, { habitat: h, index: i }] });
                    }
                  }}
                  style={
                    playHere
                      ? { borderColor: 'var(--accent)', borderStyle: 'solid', cursor: 'pointer' }
                      : coverTarget
                        ? { borderColor: '#d98a8a', borderStyle: 'dashed', cursor: 'pointer' }
                        : eggTarget
                          ? { borderColor: '#f2d38a', cursor: 'pointer' }
                          : undefined
                  }
                >
                  {b ? (
                    <>
                      <BirdCardView cardId={b.cardId} played={b} />
                      {b.ghost && <span className="muted">covered</span>}
                    </>
                  ) : i === player.board[h].length ? 'next' : ''}
                  {b && laying && draft.placements.filter((r) => r.habitat === h && r.index === i).length > 0 && (
                    <span className="badge">
                      +{draft.placements.filter((r) => r.habitat === h && r.index === i).length}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {laying && <div className="muted">Placing eggs: {eggsLeft} left (click birds, confirm below)</div>}
    </div>
  );
}

function autoEggs(p: PlayerState, count: number): BirdRef[] {
  const out: BirdRef[] = [];
  for (const { ref, bird: b } of playedBirds(p)) {
    for (let i = 0; i < b.eggs && out.length < count; i++) out.push(ref);
    if (out.length >= count) break;
  }
  return out;
}

function FoodCounts({ player }: { player: PlayerState }) {
  return (
    <span className="food-counts">
      {FOOD_TYPES.filter((f) => player.food[f] > 0).map((f) => (
        <span key={f} className="fc">
          <span className={`fchip f-${f}`}>{f[0].toUpperCase()}</span>
          {player.food[f]}
        </span>
      ))}
    </span>
  );
}

/** Hand + bonus cards for the viewed player. */
function HandArea({
  game,
  player,
  draft,
  setDraft,
  controls,
  dispatch,
}: {
  game: GameState;
  player: PlayerState;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  controls: boolean;
  dispatch: (a: Parameters<ReturnType<typeof useGameStore.getState>['dispatch']>[0]) => void;
}) {
  const inSetup = game.phase === 'setup' && game.setupRemaining.includes(player.id);
  const setupDraft = draft?.kind === 'setup' ? draft : null;

  return (
    <div className="card">
      <h3>
        {player.name}'s hand
        {inSetup && ' — choose birds to keep (1 food each) + 1 bonus card'}
      </h3>
      <div className="hand">
        {player.hand.map((id) => {
          const playingThis = draft?.kind === 'playBird' && draft.cardId === id;
          const kept = setupDraft?.keepBirds.includes(id);
          const c = bird(id);
          const payable = autoPayBird(player, id) != null;
          const playableHabitat = c.habitats.find((h) => !rowFull(player, h) && payable);
          // European cover predators are also playable on top of a bird.
          const coverHabitat = isCoverBird(c)
            ? c.habitats.find((h) => player.board[h].some((b) => !b.ghost))
            : undefined;
          const canUse = playableHabitat != null || coverHabitat != null;
          return (
            <BirdCardView
              key={id}
              cardId={id}
              selectable={controls && (inSetup || canUse || playingThis)}
              selected={playingThis || kept}
              onClick={() => {
                if (!controls) return;
                if (inSetup) {
                  const cur = setupDraft?.keepBirds ?? [...player.hand];
                  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
                  setDraft({ kind: 'setup', keepBirds: next, keepBonus: setupDraft?.keepBonus ?? null });
                } else if (playingThis) {
                  setDraft(null);
                } else if (canUse) {
                  setDraft({ kind: 'playBird', cardId: id, habitat: playableHabitat ?? coverHabitat ?? null });
                }
              }}
            />
          );
        })}
        {player.bonusHand.map((id) => (
          <BonusCardView
            key={id}
            cardId={id}
            selectable={controls && inSetup}
            selected={setupDraft?.keepBonus === id}
            onClick={() => {
              if (!controls || !inSetup) return;
              setDraft({
                kind: 'setup',
                keepBirds: setupDraft?.keepBirds ?? [...player.hand],
                keepBonus: id,
              });
            }}
          />
        ))}
      </div>
      {inSetup && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">
            Keeping {(setupDraft?.keepBirds ?? player.hand).length} birds costs {(setupDraft?.keepBirds ?? player.hand).length} food
          </span>
          <button
            className="primary"
            disabled={!setupDraft || setupDraft.keepBonus == null}
            onClick={() => {
              if (!setupDraft || setupDraft.keepBonus == null) return;
              dispatch({
                type: 'keepSetup',
                playerId: player.id,
                keepBirds: setupDraft.keepBirds,
                keepBonus: setupDraft.keepBonus,
                discardFood: BASE_FOODS.slice(0, setupDraft.keepBirds.length),
              });
              setDraft(null);
            }}
          >
            Confirm setup
          </button>
          {!setupDraft && (
            <button
              onClick={() =>
                setDraft({ kind: 'setup', keepBirds: [...player.hand], keepBonus: player.bonusHand[0]! })
              }
            >
              Start choosing
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The main action buttons + draft confirmation. */
function ActionsPanel({
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
      <h3>Actions</h3>
      {game.phase === 'setup' && <div className="muted">Setup in progress — each player chooses their keeps.</div>}
      {draft?.kind === 'gainFood' && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className="primary"
            disabled={draft.picks.length !== diceCount && !(draft.reroll && draft.picks.length === diceCount)}
            onClick={() => {
              dispatch({
                type: 'gainFood',
                playerId: acting,
                reroll: draft.reroll || undefined,
                picks: draft.picks.map((die) => ({ die, take: 'seed' as FoodType })),
              });
              setDraft(null);
            }}
          >
            Take food
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
            Lay {draft.placements.length} egg{draft.placements.length === 1 ? '' : 's'}
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
            Playing {bird(draft.cardId).name} in {draft.habitat} — click the highlighted slot, or pick a
            habitat:
          </span>
          {bird(draft.cardId).habitats.map((h) => (
            <button
              key={h}
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
        <div className="row">
          <button onClick={() => setDraft({ kind: 'gainFood', reroll: false, picks: [] })}>
            Gain food (×{diceCount})
          </button>
          <button onClick={() => setDraft({ kind: 'layEggs', placements: [] })}>
            Lay eggs (×{eggCount})
          </button>
          <button onClick={() => setDraft({ kind: 'drawCards', picks: [] })}>
            Draw cards (×{cardCount})
          </button>
        </div>
      )}
      {/* Duet mode: a token on the reset space resets the feeder or tray,
          usable at any point during the player's turn. */}
      {!draft && mine && game.phase === 'main' && !inActivation && game.duet?.reset.includes(acting) && (
        <div className="row" style={{ marginTop: 8 }}>
          <span className="muted">Duet reset token:</span>
          <button onClick={() => dispatch({ type: 'duetReset', playerId: acting, target: 'feeder' })}>
            Reset feeder
          </button>
          <button onClick={() => dispatch({ type: 'duetReset', playerId: acting, target: 'tray' })}>
            Reset tray
          </button>
        </div>
      )}
      {inActivation && mine && (
        <div className="row" style={{ marginTop: 8 }}>
          <span>
            Activate {bird(p.board[game.activation!.habitat][game.activation!.remaining[0]!]!.cardId).name}'s
            power?
          </span>
          <button className="primary" onClick={() => dispatch({ type: 'activatePower', playerId: acting })}>
            Use
          </button>
          <button onClick={() => dispatch({ type: 'skipPower', playerId: acting })}>Skip</button>
          <button onClick={() => dispatch({ type: 'skipPower', playerId: acting, all: true })}>Skip all</button>
        </div>
      )}
      {mine && game.turnTookAction && !inActivation && (
        <div style={{ marginTop: 8 }}>
          <button className="primary" onClick={() => dispatch({ type: 'endTurn', playerId: acting })}>
            End turn
          </button>
        </div>
      )}
    </div>
  );
}

function GameOverCard({ game }: { game: GameState }) {
  const rows = game.playerOrder.map((pid) => ({
    p: getPlayer(game, pid),
    s: game.finalScores?.[pid],
    won: game.winner?.includes(pid),
  }));
  return (
    <div className="card" style={{ position: 'fixed', inset: '10% 20%', zIndex: 20, overflow: 'auto' }}>
      <h2>Game over</h2>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Birds</th>
            <th>Bonus</th>
            <th>Eggs</th>
            <th>Cached</th>
            <th>Tucked</th>
            <th>Goals</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, s, won }) => (
            <tr key={p.id}>
              <td>
                <span className={`pcolor c-${p.color}`} />
                {p.name} {won ? '🏆' : ''}
              </td>
              <td>{s?.birdPoints}</td>
              <td>{s?.bonusPoints}</td>
              <td>{s?.eggs}</td>
              <td>{s?.cached}</td>
              <td>{s?.tucked}</td>
              <td>{s?.goalPoints}</td>
              <td><b>{s?.total}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
