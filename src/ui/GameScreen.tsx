import { useState } from 'react';
import { bird, bonusCard, goalTile } from '@/wingspan/cards';
import {
  COLUMN_EGG_COST,
  FOREST_DICE,
  GRASSLAND_EGGS,
  HUM_BONUS_SPACES,
  HUM_LADDER,
  OCEANIA_FOREST_DICE,
  OCEANIA_GRASSLAND_EGGS,
  OCEANIA_WETLAND_CARDS,
  WETLAND_CARDS,
} from '@/wingspan/constants';
import { DUET_MAP } from '@/wingspan/duetMap';
import {
  actingPlayerId,
  actionSlot,
  autoPayBird,
  getPlayer,
  isCoverBird,
  isOceania,
  playEggCost,
  playedBirds,
  rowFull,
  totalEggs,
} from '@/wingspan/helpers';
import { scorePlayer } from '@/wingspan/scoring';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import type {
  BirdRef,
  FoodType,
  GameState,
  Habitat,
  HumGroup,
  PlayerId,
  PlayerState,
} from '@/wingspan/types';
import { BASE_FOODS, FOOD_TYPES, HABITATS, HUM_GROUPS } from '@/wingspan/types';
import { BirdCardView, BonusCardView, HummingbirdCardView } from './BirdCardView';
import { ActionToastBanner, FlipProvider, useFlipAnchor } from './fx';
import { StackedBarChart, StatsTabs } from './MatchCharts';
import { PendingBar } from './PendingBar';
import { RulesModal } from './RulesBook';
import {
  ActionCubeSvg,
  DieFaceSvg,
  EggTokenSvg,
  FoodIcon,
  HabitatIcon,
  NestIcon,
  playerColorHex,
  renderWingspanText,
} from './svgArt';

type Draft =
  | { kind: 'playBird'; cardId: number; habitat: Habitat | null }
  | { kind: 'gainFood'; reroll: boolean; picks: number[] }
  | { kind: 'layEggs'; placements: BirdRef[] }
  | { kind: 'drawCards'; picks: ('deck' | number)[] }
  | { kind: 'setup'; keepBirds: number[]; keepBonus: number | null };

export function GameScreen() {
  const game = useGameStore((s) => s.game)!;
  const dispatch = useGameStore((s) => s.dispatch);
  const undo = useGameStore((s) => s.undo);
  const undoCount = useGameStore((s) => s.undoStack.length);
  const playAgainLocal = useGameStore((s) => s.playAgainLocal);
  const aiSpeed = useGameStore((s) => s.aiSpeed);
  const setAiSpeed = useGameStore((s) => s.setAiSpeed);
  const { role, connection, myUuid, uuidForPlayer, leaveRoom } = useNetworkStore();
  const clearGame = useGameStore((s) => s.clearGame);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);

  const acting = actingPlayerId(game);
  const actingIdx = game.playerOrder.indexOf(acting);
  const myIdx =
    connection === 'in-game'
      ? game.playerOrder.findIndex((pid) => uuidForPlayer(pid) === myUuid)
      : -1;
  const shownIdx = viewIdx ?? (myIdx >= 0 ? myIdx : actingIdx);
  const shown = game.playerOrder[shownIdx]!;
  const shownP = getPlayer(game, shown);

  const controls = (pid: PlayerId): boolean => {
    if (connection !== 'in-game') return true;
    if (role === 'spectator') return false;
    const owner = uuidForPlayer(pid);
    return owner === myUuid || (owner === null && role === 'host');
  };

  const canAct = (pid: PlayerId) => controls(pid) && game.pending.length === 0;
  const head = game.pending[0];

  return (
    <FlipProvider scene={`wingspan:${game.phase === 'gameOver'}`} defaultOrigin="deck">
      <div className="game">
        <div>
          <TopBar
            game={game}
            canUndo={connection !== 'in-game' && undoCount > 0}
            onUndo={undo}
            aiSpeed={aiSpeed}
            onToggleAiSpeed={() => setAiSpeed(aiSpeed === 'normal' ? 'fast' : 'normal')}
            onOpenRules={() => setShowRules(true)}
            onExit={() => (connection === 'in-game' ? leaveRoom() : clearGame())}
          />
          <ActionToastBanner logMessages={game.log.map((e) => e.msg)} />
          <CommonRow game={game} draft={draft} setDraft={setDraft} canAct={canAct} />

          {/* Player selector tabs */}
          <div className="player-tabs-row">
            {game.playerOrder.map((pid, i) => {
              const p = getPlayer(game, pid);
              const live = scorePlayer(game, p).total;
              return (
                <button
                  key={pid}
                  type="button"
                  className={`player-tab${i === shownIdx ? ' active' : ''}`}
                  onClick={() => setViewIdx(i)}
                >
                  <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
                  <b>{p.name}</b>
                  <span className="muted">
                    {p.actionCubes}🧊 · {live} VP
                  </span>
                  {i === actingIdx && <span className="turn-dot" />}
                </button>
              );
            })}
          </div>

          <PlayerMatView
            game={game}
            player={shownP}
            oceania={isOceania(game)}
            draft={draft}
            setDraft={setDraft}
            controls={controls(shown)}
            dispatch={dispatch}
          />

          {game.duet && <DuetMapPanel game={game} />}

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
          <ActionsPanel
            game={game}
            draft={draft}
            setDraft={setDraft}
            canAct={canAct}
            dispatch={dispatch}
          />

          {game.automa && (
            <div className="card">
              <h3>⚙️ Automa Solo Deck ({game.automa.difficulty})</h3>
              <div className="stat-pills">
                <span className="stat-pill">
                  📜 Bonus: <b>{bonusCard(game.automa.bonusCardId).name}</b>
                </span>
                <span className="stat-pill">
                  🃏 Deck: <b>{game.automa.deck.length}</b> (Last: #{game.automa.lastCardId ?? '—'})
                </span>
                <span className="stat-pill">
                  🎯 Goal Cubes: <b>{game.automa.goalCubes}</b>
                </span>
                <span className="stat-pill">
                  🪶 Face-Up: <b>{game.automa.faceUpBirds.length}</b> · Face-Down:{' '}
                  <b>{game.automa.faceDownBirds}</b>
                </span>
                <span className="stat-pill">
                  🥚 Eggs: <b>{game.automa.eggs}</b>
                </span>
                {game.automa.hoardTokens > 0 && (
                  <span className="stat-pill">
                    🧺 Hoard: <b>{game.automa.hoardTokens}</b>
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h3>🏆 Live Standings</h3>
            {game.playerOrder.map((pid) => {
              const p = getPlayer(game, pid);
              const sc = scorePlayer(game, p);
              return (
                <div key={pid} className="standing-row">
                  <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
                  <b>{p.name}</b>
                  <span className="spacer" />
                  <span className="muted" style={{ fontSize: '0.73rem' }}>
                    🪶{sc.birdPoints} · 🥚{sc.eggs} · 📜{sc.bonusPoints} · 🎯{sc.goalPoints}
                  </span>
                  <b className="badge">{sc.total} VP</b>
                </div>
              );
            })}
          </div>

          <div className="card">
            <h3>📜 Preserve Log</h3>
            <div className="log">
              {game.log.slice(-60).map((e) => (
                <div key={e.seq}>{e.msg}</div>
              ))}
            </div>
          </div>
        </div>

        {head && (
          <PendingBar
            game={game}
            step={head}
            controls={controls(head.playerId)}
            dispatch={dispatch}
          />
        )}

        {game.phase === 'gameOver' && (
          <GameOverCard
            game={game}
            onPlayAgain={playAgainLocal}
            onMenu={() => (connection === 'in-game' ? leaveRoom() : clearGame())}
          />
        )}

        {showRules && <RulesModal gameId="wingspan" onClose={() => setShowRules(false)} />}
      </div>
    </FlipProvider>
  );
}

function TopBar({
  game,
  canUndo,
  onUndo,
  aiSpeed,
  onToggleAiSpeed,
  onOpenRules,
  onExit,
}: {
  game: GameState;
  canUndo: boolean;
  onUndo: () => void;
  aiSpeed: 'normal' | 'fast';
  onToggleAiSpeed: () => void;
  onOpenRules: () => void;
  onExit: () => void;
}) {
  const acting = getPlayer(game, actingPlayerId(game));
  return (
    <div className="card topbar-card">
      <div className="row">
        <span className="badge">Round {Math.min(4, game.round + 1)} / 4</span>
        <span className="row" style={{ gap: 5 }}>
          Acting: <ActionCubeSvg color={acting.color} size={16} />
          <b>{acting.name}</b> ({acting.actionCubes} cubes)
        </span>
        {game.phase === 'setup' && (
          <span className="badge">Setup — keep birds (1 food each) & 1 bonus card</span>
        )}
        {game.turnTookAction && (
          <span className="muted">Action taken — resolve powers then end turn</span>
        )}
        <div className="spacer" />
        <button type="button" className="secondary" disabled={!canUndo} onClick={onUndo}>
          ↶ Undo
        </button>
        <button type="button" className="secondary" onClick={onToggleAiSpeed}>
          🤖 {aiSpeed === 'fast' ? 'Fast' : 'Normal'}
        </button>
        <button type="button" className="secondary" onClick={onOpenRules}>
          📖 Rules
        </button>
        <button type="button" className="secondary" onClick={onExit}>
          ⌂ Menu
        </button>
      </div>

      <div className="achievements-strip">
        <span className="muted">
          Round Goals ({game.settings.goalSide === 'blue' ? 'Blue 1pt/item' : 'Green Majority'}):
        </span>
        {game.goalTiles.map((id, r) => (
          <span
            key={`${id}-${r}`}
            className={`ach-chip${r === game.round ? ' active' : r < game.round ? ' done' : ''}`}
            title={goalTile(id).text}
          >
            <b>R{r + 1}:</b> {renderWingspanText(goalTile(id).text)}
          </span>
        ))}
      </div>
    </div>
  );
}

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
  const deckAnchor = useFlipAnchor('deck');
  const acting = actingPlayerId(game);
  const actingP = getPlayer(game, acting);
  const oceania = isOceania(game);
  const americas = game.settings.sets.includes('americas');

  const pickingDice = draft?.kind === 'gainFood';
  const diceNeeded = pickingDice
    ? (oceania ? OCEANIA_FOREST_DICE : FOREST_DICE)[actionSlot(actingP, 'forest', oceania)]!
    : 0;
  const allSame =
    game.feederIn.length > 0 && game.feederIn.every((f) => f === game.feederIn[0]);
  const pickingCards = draft?.kind === 'drawCards';
  const cardsNeeded = pickingCards
    ? (oceania ? OCEANIA_WETLAND_CARDS : WETLAND_CARDS)[actionSlot(actingP, 'wetland', oceania)]!
    : 0;

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        {/* Birdfeeder */}
        <div>
          <h3>🎲 Birdfeeder {pickingDice && `— pick ${diceNeeded}`}</h3>
          <div className="row">
            {game.feederIn.map((f, i) => (
              <span
                key={i}
                className={`die-wrap${pickingDice && canAct(acting) ? ' selectable' : ''}${
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
                title={`Die ${i + 1}: ${f}`}
              >
                <DieFaceSvg face={f} size={40} />
              </span>
            ))}
            {game.feederIn.length === 0 && <span className="muted">Empty (auto-refills)</span>}
            {pickingDice && allSame && !draft.reroll && (
              <button
                type="button"
                className="secondary"
                onClick={() => setDraft({ kind: 'gainFood', reroll: true, picks: [] })}
              >
                ↻ Reroll (all same)
              </button>
            )}
          </div>
        </div>

        {/* Bird Tray & Deck */}
        <div style={{ flex: 1 }}>
          <h3>🂠 Bird Tray {pickingCards && `— pick ${cardsNeeded}`}</h3>
          <div className="tray">
            <div
              ref={deckAnchor}
              className={`deck-stack${pickingCards && canAct(acting) ? ' selectable' : ''}`}
              title={`${game.deck.length} bird cards in deck · ${game.discard.length} in discard`}
              onClick={() => {
                if (!pickingCards || !canAct(acting) || draft.kind !== 'drawCards') return;
                if (draft.picks.length < cardsNeeded) {
                  setDraft({ ...draft, picks: [...draft.picks, 'deck'] });
                }
              }}
            >
              <div className="deck-count">{game.deck.length}</div>
              <div className="deck-sub">DECK</div>
            </div>
            {game.tray.map((id, i) =>
              id == null ? (
                <div key={i} className="slot empty" style={{ width: 132, minHeight: 150 }} />
              ) : (
                <BirdCardView
                  key={id}
                  cardId={id}
                  zone="tray"
                  compact
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

        {/* Americas Hummingbird Garden */}
        {americas && (
          <div>
            <h3>🌺 Hummingbird Garden (Deck: {game.humDeck.length})</h3>
            <div className="hum-garden-row">
              {game.humGarden.map((stack, i) => {
                const top = stack[stack.length - 1];
                return top != null ? (
                  <div key={i} className="hum-garden-slot">
                    <HummingbirdCardView cardId={top} />
                    {stack.length > 1 && (
                      <span className="hum-stack-depth">×{stack.length}</span>
                    )}
                  </div>
                ) : (
                  <div key={i} className="hum-garden-empty">
                    Empty
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PlayerMatView({
  game,
  player,
  oceania,
  draft,
  setDraft,
  controls,
  dispatch,
}: {
  game: GameState;
  player: PlayerState;
  oceania: boolean;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  controls: boolean;
  dispatch: (a: Parameters<ReturnType<typeof useGameStore.getState>['dispatch']>[0]) => void;
}) {
  const playing = draft?.kind === 'playBird' && draft.habitat;
  const laying = draft?.kind === 'layEggs';
  const americas = game.settings.sets.includes('americas');
  const eggsLeft = laying
    ? (oceania ? OCEANIA_GRASSLAND_EGGS : GRASSLAND_EGGS)[actionSlot(player, 'grassland', oceania)]! -
      draft.placements.length
    : 0;

  return (
    <div className="card mat">
      <div className="mat-head">
        <span className="pcolor" style={{ background: playerColorHex(player.color) }} />
        <span className="name">{player.name}&apos;s Preserve</span>
        <FoodCounts player={player} />
        <span className="muted">
          Hand: <b>{player.hand.length}</b> · Eggs: <b>{totalEggs(player)}</b>
        </span>
      </div>

      {/* Column Egg Cost Header */}
      <div className="mat-col-costs">
        <div className="hab-gutter" />
        {COLUMN_EGG_COST.map((cost, col) => (
          <div key={col} className="col-cost-cell">
            <span>Col {col + 1}</span>
            <span>
              {cost === 0 ? (
                'Free'
              ) : (
                <>
                  {Array.from({ length: cost }, (_, k) => (
                    <EggTokenSvg key={k} index={k} size={12} />
                  ))}
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {HABITATS.map((h) => {
        const activeBirdIdx =
          game.activation && game.activation.habitat === h
            ? game.activation.remaining[0]
            : undefined;
        const rowGain =
          h === 'forest'
            ? (oceania ? OCEANIA_FOREST_DICE : FOREST_DICE)[actionSlot(player, h, oceania)]
            : h === 'grassland'
              ? (oceania ? OCEANIA_GRASSLAND_EGGS : GRASSLAND_EGGS)[actionSlot(player, h, oceania)]
              : (oceania ? OCEANIA_WETLAND_CARDS : WETLAND_CARDS)[actionSlot(player, h, oceania)];

        return (
          <div key={h} className="hab-row">
            <div className={`hab-label hab-${h}`}>
              <HabitatIcon habitat={h} size={18} />
              <span>{h}</span>
              <span className="hab-gain-badge">+{rowGain}</span>
              {oceania && player.nectarSpent[h] > 0 && (
                <span className="hab-nectar-badge" title="Spent nectar in this habitat">
                  🌺{player.nectarSpent[h]}
                </span>
              )}
            </div>
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
                  !b.ghost &&
                  b.eggs < bird(b.cardId).eggLimit;
                const isActivating =
                  player.id === actingPlayerId(game) && activeBirdIdx === i;

                return (
                  <div
                    key={i}
                    className={`slot${b ? '' : ' empty'}${b?.ghost ? ' ghost' : ''}${
                      playHere || coverTarget || eggTarget ? ' targetable' : ''
                    }`}
                    onClick={() => {
                      if (!controls) return;
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
                        const pay = autoPayBird(player, draft.cardId);
                        if (!pay) return;
                        dispatch({
                          type: 'playBird',
                          playerId: player.id,
                          cardId: draft.cardId,
                          habitat: h,
                          eggPayments: autoEggs(player, playEggCost(player, h)),
                          foodPayments: pay.foodPayments,
                          cachedFoodPayments: pay.cachedFoodPayments,
                          cardPayments: pay.cardPayments,
                        });
                        setDraft(null);
                      } else if (eggTarget && laying && draft.kind === 'layEggs') {
                        setDraft({
                          ...draft,
                          placements: [...draft.placements, { habitat: h, index: i }],
                        });
                      }
                    }}
                  >
                    {b ? (
                      b.ghost ? (
                        <div className="sideways-ghost">
                          <span>↔ Sideways Bird</span>
                        </div>
                      ) : (
                        <BirdCardView
                          cardId={b.cardId}
                          played={b}
                          zone={`board:${player.id}:${h}:${i}`}
                          activating={isActivating}
                        />
                      )
                    ) : i === player.board[h].length ? (
                      <div className="next-slot-hint">
                        {playHere ? '▶ Click to Play Bird' : 'Next Slot'}
                      </div>
                    ) : null}
                    {b &&
                      laying &&
                      draft.placements.filter((r) => r.habitat === h && r.index === i).length >
                        0 && (
                        <span className="badge">
                          +
                          {
                            draft.placements.filter((r) => r.habitat === h && r.index === i)
                              .length
                          }{' '}
                          🥚
                        </span>
                      )}
                  </div>
                );
              })}

              {/* Americas Hummingbird Space at end of habitat row */}
              {americas && (
                <div className="hum-board-slot">
                  {player.humBoard[h] != null ? (
                    <HummingbirdCardView cardId={player.humBoard[h]!} />
                  ) : (
                    <div className="hum-empty-space">🌺 Hummingbird Space</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Americas Hummingbird Track */}
      {americas && (
        <div className="hum-track-bar">
          <span className="muted">🌺 Hummingbird Track:</span>
          {HUM_GROUPS.map((grp: HumGroup) => {
            const pos = player.humTrack[grp] ?? 0;
            const pts = HUM_LADDER[pos] ?? 0;
            const isBonus = HUM_BONUS_SPACES[grp]?.includes(pos);
            return (
              <span key={grp} className="stat-pill">
                <b>{grp}:</b> step {pos}/{HUM_LADDER.length - 1} ({pts >= 0 ? `+${pts}` : pts} VP)
                {isBonus ? ' ✨' : ''}
              </span>
            );
          })}
        </div>
      )}

      {laying && (
        <div className="muted">
          Placing eggs: <b>{eggsLeft}</b> left (click birds above, then confirm in Actions)
        </div>
      )}
    </div>
  );
}

function DuetMapPanel({ game }: { game: GameState }) {
  const duet = game.duet!;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3>☯️ Asia Duet Map (6×6)</h3>
        <span className="muted">
          Contiguous group = +1 VP per token · Reset space tokens:{' '}
          {duet.reset.length ? duet.reset.join(', ') : 'none'}
        </span>
      </div>
      <div className="duet-grid">
        {DUET_MAP.map((sp, i) => {
          const ownerId = duet.map[i];
          const owner = ownerId ? getPlayer(game, ownerId as PlayerId) : null;
          return (
            <div key={i} className={`duet-cell hab-${sp.habitat}`}>
              <div className="duet-crit">
                {sp.criterion.type === 'nest' && <NestIcon nest={sp.criterion.nest} size={15} />}
                {sp.criterion.type === 'food' && <FoodIcon food={sp.criterion.food} size={15} />}
                {sp.criterion.type === 'wingspan' && (
                  <span>{sp.criterion.lt50 ? '<50cm' : '≥50cm'}</span>
                )}
                {sp.criterion.type === 'beak' && (
                  <span>{sp.criterion.left ? '←Beak' : 'Beak→'}</span>
                )}
              </div>
              {sp.bonus && <span className="duet-bonus">+{sp.bonus}</span>}
              {owner && (
                <span
                  className="duet-token"
                  style={{ background: playerColorHex(owner.color) }}
                  title={owner.name}
                />
              )}
            </div>
          );
        })}
      </div>
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
        <span key={f} className="fc" title={f}>
          <FoodIcon food={f} size={17} />
          <b>{player.food[f]}</b>
        </span>
      ))}
    </span>
  );
}

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
        {player.name}&apos;s Hand ({player.hand.length} birds · {player.bonusHand.length} bonus)
        {inSetup && ' — select birds to keep (costs 1 food per bird kept) + 1 bonus card'}
      </h3>
      <div className="hand">
        {player.hand.map((id) => {
          const playingThis = draft?.kind === 'playBird' && draft.cardId === id;
          const kept = setupDraft?.keepBirds.includes(id);
          const c = bird(id);
          const payable = autoPayBird(player, id) != null;
          const playableHabitat = c.habitats.find((h) => !rowFull(player, h) && payable);
          const coverHabitat = isCoverBird(c)
            ? c.habitats.find((h) => player.board[h].some((b) => !b.ghost))
            : undefined;
          const canUse = playableHabitat != null || coverHabitat != null;
          return (
            <BirdCardView
              key={id}
              cardId={id}
              zone={`hand:${player.id}`}
              selectable={controls && (inSetup || canUse || playingThis)}
              selected={playingThis || kept}
              onClick={() => {
                if (!controls) return;
                if (inSetup) {
                  const cur = setupDraft?.keepBirds ?? [...player.hand];
                  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
                  setDraft({
                    kind: 'setup',
                    keepBirds: next,
                    keepBonus: setupDraft?.keepBonus ?? player.bonusHand[0] ?? null,
                  });
                } else if (playingThis) {
                  setDraft(null);
                } else if (canUse) {
                  setDraft({
                    kind: 'playBird',
                    cardId: id,
                    habitat: playableHabitat ?? coverHabitat ?? null,
                  });
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
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted">
            Keeping {(setupDraft?.keepBirds ?? player.hand).length} bird(s) discards{' '}
            {(setupDraft?.keepBirds ?? player.hand).length} food
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
            ✓ Confirm Setup Keeps
          </button>
          {!setupDraft && (
            <button
              onClick={() =>
                setDraft({
                  kind: 'setup',
                  keepBirds: [...player.hand],
                  keepBonus: player.bonusHand[0]!,
                })
              }
            >
              Choose Keeps
            </button>
          )}
        </div>
      )}
    </div>
  );
}

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
      <h3>⚡ Turn Actions</h3>
      {game.phase === 'setup' && (
        <div className="muted">Setup in progress — choose birds and 1 bonus card in your hand below.</div>
      )}
      {draft?.kind === 'gainFood' && (
        <div className="row" style={{ marginBottom: 8 }}>
          <button
            className="primary"
            disabled={
              draft.picks.length !== diceCount &&
              !(draft.reroll && draft.picks.length === diceCount)
            }
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
            Take Food ({draft.picks.length}/{diceCount})
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
          <button onClick={() => setDraft({ kind: 'gainFood', reroll: false, picks: [] })}>
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

function GameOverCard({
  game,
  onPlayAgain,
  onMenu,
}: {
  game: GameState;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const pids = game.playerOrder;
  const labels = pids.map((pid) => getPlayer(game, pid).name);
  const scores = game.finalScores ?? {};

  const series = [
    {
      id: 'birds',
      label: 'Birds',
      color: '#4a7c59',
      values: pids.map((pid) => scores[pid]?.birdPoints ?? 0),
    },
    {
      id: 'bonus',
      label: 'Bonus Cards',
      color: '#e0a458',
      values: pids.map((pid) => scores[pid]?.bonusPoints ?? 0),
    },
    {
      id: 'goals',
      label: 'Round Goals',
      color: '#4f8ba9',
      values: pids.map((pid) => scores[pid]?.goalPoints ?? 0),
    },
    {
      id: 'eggs',
      label: 'Eggs',
      color: '#bfe0e8',
      values: pids.map((pid) => scores[pid]?.eggs ?? 0),
    },
    {
      id: 'cached',
      label: 'Cached Food',
      color: '#c44569',
      values: pids.map((pid) => scores[pid]?.cached ?? 0),
    },
    {
      id: 'tucked',
      label: 'Tucked Cards',
      color: '#9a6ad0',
      values: pids.map((pid) => scores[pid]?.tucked ?? 0),
    },
    {
      id: 'nectar',
      label: 'Nectar Majority',
      color: '#e06397',
      values: pids.map((pid) => scores[pid]?.nectar ?? 0),
    },
    {
      id: 'duet',
      label: 'Duet / Hummingbirds',
      color: '#52b788',
      values: pids.map((pid) => (scores[pid]?.duetTokens ?? 0) + (scores[pid]?.hummingbirds ?? 0)),
    },
  ];

  const winners = (game.winner ?? []).map((pid) => getPlayer(game, pid).name).join(', ');

  return (
    <div className="rules-modal-backdrop">
      <div className="rules-modal gameover-modal">
        <div className="rules-modal-header">
          <h3>🏆 Wingspan — Final Scores (Winner: {winners})</h3>
          <div className="row">
            <button type="button" className="primary" onClick={onPlayAgain}>
              ↻ Play Again
            </button>
            <button type="button" className="secondary" onClick={onMenu}>
              ⌂ Main Menu
            </button>
          </div>
        </div>
        <div className="rules-modal-content">
          <StatsTabs tabs={[{ key: 'breakdown', label: 'Score Breakdown' }]}>
            {() => <StackedBarChart xLabels={labels} series={series} />}
          </StatsTabs>
        </div>
      </div>
    </div>
  );
}
