// Wyrmspan (+ Dragon Academy) full interactive UI with thematic SVG Cavern Mat,
// Dragon & Cave Cards, Dragon Guild Rondel & Guild Tile, Academy Income Tracker,
// Pending Choice Bar, and Post-Game SVG Match Statistics.

import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import {
  dragonCost,
  excavateEggCost,
  exploreCost,
  nextEmptySpace,
  nextEnticeSpace,
} from '@/wyrmspan/actions';
import { chooseAction as chooseWyrmAI } from '@/wyrmspan/ai';
import {
  CAVE_NAMES,
  RESOURCES,
  cardName,
  caveCard,
  dragonCard,
  isDragonCard,
  parseIcons,
} from '@/wyrmspan/cards';
import { GUILD_TILES, GUILD_TRACK, INCOME_SECTIONS, incomeSectionIndex } from '@/wyrmspan/guild';
import { canPay, player } from '@/wyrmspan/helpers';
import { OBJECTIVES, ROUND_OBJECTIVE_VP } from '@/wyrmspan/objectives';
import { scorePlayer } from '@/wyrmspan/scoring';
import type {
  Action,
  CaveCard,
  DragonCard,
  GameState,
  PendingStep,
  PlayedDragon,
  PlayerId,
  Resource,
} from '@/wyrmspan/types';
import { ActionToastBanner, FlipProvider, useFlipAnchor, useFlipCard, useValuePulse } from './fx';
import { GameOverModal } from './MatchCharts';
import { RulesModal } from './RulesBook';
import {
  AdventurerMeepleSvg,
  DragonIllustration,
  WyrmResourceIcon,
  playerColorHex,
  renderWyrmspanText,
} from './svgArt';

const CAVE_THEMES = [
  { id: 'crimson' as const, name: 'Crimson Cavern', color: '#9e2a2b', accent: '#f28482' },
  { id: 'golden' as const, name: 'Golden Grotto', color: '#b07d1a', accent: '#ffd166' },
  { id: 'amethyst' as const, name: 'Amethyst Abyss', color: '#5a3286', accent: '#e0aaff' },
];

export function WyrmspanScreen() {
  const state = useGameStore((s) => s.wyrmspanGame)!;
  const dispatch = useGameStore((s) => s.dispatch);
  const undo = useGameStore((s) => s.undo);
  const undoCount = useGameStore((s) => s.undoStack.length);
  const clearGame = useGameStore((s) => s.clearGame);
  const playAgainLocal = useGameStore((s) => s.playAgainLocal);
  const aiSpeed = useGameStore((s) => s.aiSpeed);
  const setAiSpeed = useGameStore((s) => s.setAiSpeed);
  const { connection, role, myUuid, uuidForPlayer, leaveRoom } = useNetworkStore();

  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [viewIdx, setViewIdx] = useState<number | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [sideTab, setSideTab] = useState<'play' | 'log'>('play');
  const [giveRes, setGiveRes] = useState<[Resource, Resource]>(['meat', 'meat']);
  const [getRes, setGetRes] = useState<Resource>('gold');

  const dragonDeckAnchor = useFlipAnchor('wyrm-deck');

  const actingId = state.pending[0]?.playerId ?? state.turn;
  const actingIdx = state.playerOrder.indexOf(actingId);
  const myIdx =
    connection === 'in-game'
      ? state.playerOrder.findIndex((pid) => uuidForPlayer(pid) === myUuid)
      : -1;
  const shownIdx = viewIdx ?? (myIdx >= 0 ? myIdx : Math.max(0, actingIdx));
  const shownId = state.playerOrder[shownIdx] ?? state.playerOrder[0]!;
  const shownP = player(state, shownId);
  const actingP = player(state, actingId);

  const controls = (pid: PlayerId): boolean => {
    if (connection !== 'in-game') return true;
    if (role === 'spectator') return false;
    const owner = uuidForPlayer(pid);
    return owner === myUuid || (owner === null && role === 'host');
  };

  const canActMain =
    state.phase === 'main' &&
    state.pending.length === 0 &&
    !actingP.passed &&
    controls(actingId);

  const selIsDragon =
    selectedCardId != null && actingP.hand.includes(selectedCardId) && isDragonCard(selectedCardId);
  const selIsCave =
    selectedCardId != null && actingP.hand.includes(selectedCardId) && !isDragonCard(selectedCardId);

  const headPending = state.pending[0];

  return (
    <FlipProvider
      scene={`wyrmspan:${state.phase === 'gameEnd'}`}
      defaultOrigin="wyrm-deck"
    >
      <div className="game wyrmspan-theme">
        <div>
          {/* Top Bar */}
          <div className="card topbar-card">
            <div className="row">
              <span className="badge">Round {state.round} / 4</span>
              <span>
                Acting:{' '}
                <span className="pcolor" style={{ background: playerColorHex(actingP.color) }} />
                <b>{actingP.name}</b> ({actingP.coins} 🪙 · {actingP.nestEggs} nest 🥚)
              </span>
              {state.phase === 'setup' && (
                <span className="badge">Setup — keep 4 cards & pick 3 resources</span>
              )}
              <div className="spacer" />
              <div ref={dragonDeckAnchor} className="deck-pill" title="Dragon & Cave decks">
                🐉 {state.dragonDeck.length} · 🪨 {state.caveDeck.length}
              </div>
              {connection !== 'in-game' && (
                <button
                  type="button"
                  className="secondary"
                  disabled={undoCount === 0}
                  onClick={undo}
                >
                  ↶ Undo
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => setAiSpeed(aiSpeed === 'normal' ? 'fast' : 'normal')}
              >
                🤖 {aiSpeed === 'fast' ? 'Fast' : 'Normal'}
              </button>
              <button type="button" className="secondary" onClick={() => setShowRules(true)}>
                📖 Rules
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => (connection === 'in-game' ? leaveRoom() : clearGame())}
              >
                ⌂ Menu
              </button>
            </div>

            {/* Public Objectives Strip */}
            <div className="achievements-strip">
              <span className="muted">Round Objectives:</span>
              {state.objectives.map((objId, r) => {
                const def = OBJECTIVES[objId];
                const myUnits = def ? def.unit(state, shownP) : 0;
                const vpTier = ROUND_OBJECTIVE_VP[r]!;
                return (
                  <span
                    key={r}
                    className={`ach-chip${r + 1 === state.round ? ' active' : r + 1 < state.round ? ' done' : ''}`}
                    title={`Round ${r + 1}: ${def?.label ?? objId} (${vpTier.join('/')} VP)`}
                  >
                    <b>R{r + 1}:</b> {def?.label ?? objId} · <em>({myUnits})</em>
                  </span>
                );
              })}
            </div>
          </div>

          <ActionToastBanner logMessages={state.log} />

          {/* Dragon & Cave Card Displays + Dragon Guild */}
          <div className="card">
            <div className="wyrm-common-grid">
              <div>
                <h3>🐉 Dragon Display</h3>
                <div className="tray">
                  {state.dragonDisplay.map((id, i) =>
                    id != null ? (
                      <WyrmDragonCardView
                        key={`${id}-${i}`}
                        card={dragonCard(id)}
                        zone={`display-d:${i}`}
                        compact
                      />
                    ) : (
                      <div key={i} className="slot empty">
                        Empty
                      </div>
                    ),
                  )}
                </div>
              </div>
              <div>
                <h3>🪨 Cave Display</h3>
                <div className="tray">
                  {state.caveDisplay.map((id, i) =>
                    id != null ? (
                      <WyrmCaveCardView
                        key={`${id}-${i}`}
                        card={caveCard(id)}
                        zone={`display-c:${i}`}
                      />
                    ) : (
                      <div key={i} className="slot empty">
                        Empty
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Player tabs */}
          <div className="player-tabs-row">
            {state.playerOrder.map((pid, i) => {
              const p = player(state, pid);
              const sc = scorePlayer(state, p).total;
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
                    {p.coins}🪙 · {sc} VP {p.passed ? '(passed)' : ''}
                  </span>
                  {pid === actingId && <span className="turn-dot" />}
                </button>
              );
            })}
          </div>

          {/* Player Sanctuary Mat: 3 Caverns x 4 Spaces */}
          <div className="card wyrm-mat">
            <div className="mat-head">
              <span className="name">{shownP.name}&apos;s Dragon Sanctuary</span>
              <div className="food-counts">
                <span className="fc" title="Silver coins">
                  <WyrmResourceIcon kind="coin" size={16} /> <b>{shownP.coins}</b>
                </span>
                <span className="fc" title="Nest eggs on player mat">
                  <WyrmResourceIcon kind="egg" size={16} /> <b>{shownP.nestEggs}/2</b>
                </span>
                {RESOURCES.map((r) => (
                  <span key={r} className="fc" title={r}>
                    <WyrmResourceIcon kind={r} size={16} /> <b>{shownP.resources[r]}</b>
                  </span>
                ))}
              </div>
              <div className="spacer" />
              {canActMain && shownP.id === actingId && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => dispatch({ type: 'pass', playerId: actingId })}
                >
                  Pass Round ⏭
                </button>
              )}
            </div>

            {CAVE_THEMES.map((cave, cIdx) => {
              const row = shownP.caves[cIdx]!;
              const emptyIdx = nextEmptySpace(shownP, cIdx);
              const enticeIdx = nextEnticeSpace(shownP, cIdx);
              const expCount = shownP.explores[cave.id];
              const expCost = exploreCost(shownP, cIdx);
              const canExp =
                canActMain &&
                shownP.id === actingId &&
                expCount < 3 &&
                canPay(shownP, expCost);

              const canExcavateHere =
                canActMain &&
                shownP.id === actingId &&
                selIsCave &&
                emptyIdx >= 0 &&
                canPay(shownP, [
                  { kind: 'coin', count: 1 },
                  ...(excavateEggCost(emptyIdx)
                    ? [{ kind: 'egg' as const, count: excavateEggCost(emptyIdx) }]
                    : []),
                ]);

              const selDragon =
                selIsDragon && selectedCardId != null ? dragonCard(selectedCardId) : null;
              const dragonLivesHere =
                selDragon != null && selDragon.caves.includes(CAVE_NAMES[cave.id]);
              const canEnticeHere =
                canActMain &&
                shownP.id === actingId &&
                selDragon != null &&
                dragonLivesHere &&
                enticeIdx >= 0 &&
                (canPay(shownP, dragonCost(selDragon.id)) || !!selDragon.ignoreCost);

              return (
                <div
                  key={cave.id}
                  className="wyrm-cave-row"
                  style={{ borderLeft: `5px solid ${cave.color}` }}
                >
                  <div className="wyrm-cave-header">
                    <div>
                      <strong style={{ color: cave.accent }}>{cave.name}</strong>
                      <div className="muted" style={{ fontSize: '0.72rem' }}>
                        Explored {expCount}/3 this round
                      </div>
                    </div>
                    <div className="wyrm-cave-btns">
                      <button
                        type="button"
                        className="primary"
                        disabled={!canExp}
                        onClick={() =>
                          dispatch({ type: 'explore', playerId: actingId, cave: cIdx })
                        }
                        title="Walk your adventurer left-to-right through this cavern"
                      >
                        <AdventurerMeepleSvg color={shownP.color} size={15} /> Explore (1🪙
                        {expCount > 0 ? `+${expCount}🥚` : ''})
                      </button>
                      {selIsCave && (
                        <button
                          type="button"
                          className="primary"
                          disabled={!canExcavateHere}
                          onClick={() => {
                            if (selectedCardId == null) return;
                            dispatch({
                              type: 'excavate',
                              playerId: actingId,
                              cave: cIdx,
                              cardId: selectedCardId,
                            });
                            setSelectedCardId(null);
                          }}
                        >
                          ⛏ Excavate Col {(emptyIdx ?? 0) + 1}
                        </button>
                      )}
                      {selIsDragon && (
                        <button
                          type="button"
                          className="primary"
                          disabled={!canEnticeHere}
                          onClick={() => {
                            if (selectedCardId == null) return;
                            dispatch({
                              type: 'entice',
                              playerId: actingId,
                              cave: cIdx,
                              cardId: selectedCardId,
                            });
                            setSelectedCardId(null);
                          }}
                        >
                          🐉 Entice Col {(enticeIdx ?? 0) + 1}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="slots">
                    {row.spaces.map((sp, sIdx) => {
                      const isExcTarget = canExcavateHere && sIdx === emptyIdx;
                      const isEntTarget = canEnticeHere && sIdx === enticeIdx;
                      return (
                        <div
                          key={sIdx}
                          className={`slot wyrm-slot${!sp.excavated ? ' unexcavated' : ''}${
                            isExcTarget || isEntTarget ? ' targetable' : ''
                          }`}
                          onClick={() => {
                            if (isExcTarget && selectedCardId != null) {
                              dispatch({
                                type: 'excavate',
                                playerId: actingId,
                                cave: cIdx,
                                cardId: selectedCardId,
                              });
                              setSelectedCardId(null);
                            } else if (isEntTarget && selectedCardId != null) {
                              dispatch({
                                type: 'entice',
                                playerId: actingId,
                                cave: cIdx,
                                cardId: selectedCardId,
                              });
                              setSelectedCardId(null);
                            }
                          }}
                        >
                          {sp.dragon ? (
                            <WyrmDragonCardView
                              card={dragonCard(sp.dragon.cardId)}
                              played={sp.dragon}
                              zone={`cave:${shownP.id}:${cIdx}:${sIdx}`}
                            />
                          ) : sp.excavated ? (
                            <div className="excavated-empty">
                              <span className="badge">Excavated Space {sIdx + 1}</span>
                              {sp.caveCardId != null && (
                                <div className="muted" style={{ fontSize: '0.7rem', marginTop: 4 }}>
                                  🪨 {cardName(sp.caveCardId)}
                                </div>
                              )}
                              {isEntTarget && (
                                <div className="target-hint">▶ Click to Entice Dragon here</div>
                              )}
                            </div>
                          ) : (
                            <div className="unexcavated-box">
                              <span className="muted">
                                Unexcavated (Col {sIdx + 1} · 1🪙
                                {excavateEggCost(sIdx) ? `+${excavateEggCost(sIdx)}🥚` : ''})
                              </span>
                              {isExcTarget && (
                                <div className="target-hint">▶ Click to Excavate here</div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Player Hand + 2-for-1 Resource Exchange */}
          <div className="card">
            <div className="row" style={{ marginBottom: 8 }}>
              <h3>
                {shownP.name}&apos;s Hand ({shownP.hand.length})
              </h3>
              {selectedCardId != null && (
                <span className="badge">
                  Selected: {cardName(selectedCardId)} — click a highlighted cavern space above or{' '}
                  <button
                    type="button"
                    className="secondary"
                    style={{ padding: '1px 6px', marginLeft: 4 }}
                    onClick={() => setSelectedCardId(null)}
                  >
                    Cancel
                  </button>
                </span>
              )}
              <div className="spacer" />
              {/* 2-for-1 Resource Exchange */}
              {canActMain && shownP.id === actingId && (
                <div className="row exchange-bar">
                  <span className="muted">2→1 Trade:</span>
                  <select
                    value={giveRes[0]}
                    onChange={(e) => setGiveRes([e.target.value as Resource, giveRes[1]])}
                  >
                    {RESOURCES.map((r) => (
                      <option key={r} value={r}>
                        -{r}
                      </option>
                    ))}
                  </select>
                  <select
                    value={giveRes[1]}
                    onChange={(e) => setGiveRes([giveRes[0], e.target.value as Resource])}
                  >
                    {RESOURCES.map((r) => (
                      <option key={r} value={r}>
                        -{r}
                      </option>
                    ))}
                  </select>
                  <span>→</span>
                  <select
                    value={getRes}
                    onChange={(e) => setGetRes(e.target.value as Resource)}
                  >
                    {RESOURCES.map((r) => (
                      <option key={r} value={r}>
                        +{r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      dispatch({
                        type: 'exchange',
                        playerId: actingId,
                        give: giveRes,
                        get: getRes,
                      })
                    }
                  >
                    Trade
                  </button>
                </div>
              )}
            </div>

            <div className="hand">
              {shownP.hand.map((cid, idx) =>
                isDragonCard(cid) ? (
                  <WyrmDragonCardView
                    key={`${cid}-${idx}`}
                    card={dragonCard(cid)}
                    zone={`hand:${shownP.id}`}
                    selectable={canActMain && shownP.id === actingId}
                    selected={selectedCardId === cid}
                    onClick={
                      canActMain && shownP.id === actingId
                        ? () => setSelectedCardId((cur) => (cur === cid ? null : cid))
                        : undefined
                    }
                  />
                ) : (
                  <WyrmCaveCardView
                    key={`${cid}-${idx}`}
                    card={caveCard(cid)}
                    zone={`hand:${shownP.id}`}
                    selectable={canActMain && shownP.id === actingId}
                    selected={selectedCardId === cid}
                    onClick={
                      canActMain && shownP.id === actingId
                        ? () => setSelectedCardId((cur) => (cur === cid ? null : cid))
                        : undefined
                    }
                  />
                ),
              )}
              {shownP.hand.length === 0 && <div className="muted">No cards in hand.</div>}
            </div>
          </div>
        </div>

        {/* Right Side Panel: Dragon Guild + Standings + Log */}
        <div className="side-column">
          <div className="card">
            <div className="side-tabs-bar">
              <button
                type="button"
                className={`side-tab-btn${sideTab === 'play' ? ' active' : ''}`}
                onClick={() => setSideTab('play')}
              >
                🧭 Guild & Standings
              </button>
              <button
                type="button"
                className={`side-tab-btn${sideTab === 'log' ? ' active' : ''}`}
                onClick={() => setSideTab('log')}
              >
                📜 Log ({state.log.length})
              </button>
            </div>

            {sideTab === 'play' ? (
              <>
                {state.automa && (
                  <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <h3>
                      ⚙️ Automa Solo Deck (Level {state.automa.difficulty}
                      {state.automa.ravelMode ? ' · Ravel' : ''})
                    </h3>
                    <div className="stat-pills">
                      <span className="stat-pill">
                        🃏 Deck: <b>{state.automa.deck.length}</b> (Last: {state.automa.lastCard ?? '—'})
                      </span>
                      <span className="stat-pill">
                        🪙 Obj Coins: <b>{state.automa.objectiveCoins}</b>
                      </span>
                      <span className="stat-pill">
                        🐉 Dragons: <b>{state.automa.collectedDragons}</b>
                      </span>
                      <span className="stat-pill">
                        🪨 Caves: <b>{state.automa.collectedCaves}</b>
                      </span>
                      <span className="stat-pill">
                        🛡 Guild Markers Left: <b>{state.automa.availableGuildMarkers}</b>
                      </span>
                      {state.automa.cacheTokens > 0 && (
                        <span className="stat-pill">
                          💎 Cache Tokens: <b>{state.automa.cacheTokens}</b>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <h3 style={{ marginTop: 4 }}>🏆 Live Standings</h3>
                {state.players.map((p) => {
                  const sc = scorePlayer(state, p);
                  return (
                    <div key={p.id} className="standing-row">
                      <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
                      <b>{p.name}</b>
                      <span className="spacer" />
                      <span className="muted" style={{ fontSize: '0.74rem' }}>
                        🐉{sc.printedDragonVp} · 🥚{sc.eggs} · 💎{sc.cached} · 🛡{sc.guildTile}
                      </span>
                      <b className="badge">{sc.total} VP</b>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="log">
                {state.log.slice(-50).map((msg, i) => (
                  <div key={i}>{msg}</div>
                ))}
              </div>
            )}
          </div>

          <DragonGuildPanel state={state} />
        </div>

        {headPending && (
          <WyrmspanPendingBar
            state={state}
            step={headPending}
            controls={controls(headPending.playerId)}
            dispatch={dispatch}
          />
        )}

        {state.phase === 'gameEnd' && state.finalScores && (
          <WyrmspanGameOverModal
            state={state}
            onPlayAgain={playAgainLocal}
            onMenu={() => (connection === 'in-game' ? leaveRoom() : clearGame())}
          />
        )}

        {showRules && <RulesModal gameId="wyrmspan" onClose={() => setShowRules(false)} />}
      </div>
    </FlipProvider>
  );
}

function DragonGuildPanel({ state }: { state: GameState }) {
  const tile = GUILD_TILES[state.guild.tile];
  return (
    <div className="card">
      <h3>🧭 {tile?.name ?? state.guild.tile}</h3>
      <div className="muted" style={{ fontSize: '0.74rem', marginBottom: 6 }}>
        Guild Track positions (spaces 0 & 6 = Brown Marker Placement):
      </div>
      <div className="guild-track-chips">
        {state.players.map((p) => {
          const pos = state.guild.track[p.id] ?? 0;
          const sp = GUILD_TRACK[pos];
          return (
            <span key={p.id} className="stat-pill" title={sp?.label}>
              <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
              {p.name}: Space <b>{pos}</b> ({p.guildMarkersPlaced}/4 markers)
            </span>
          );
        })}
      </div>
      <div className="guild-squares-list">
        {tile?.squares.map((sq, i) => {
          const occ = state.guild.squares[i] ?? [];
          return (
            <div key={i} className="guild-sq-row">
              <span className="guild-sq-label">{sq.label}</span>
              <div className="row">
                {occ.map((pid, k) => {
                  if (!pid) return null;
                  const pl = player(state, pid);
                  return (
                    <span
                      key={k}
                      className="pcolor"
                      style={{ background: playerColorHex(pl.color) }}
                      title={pl.name}
                    />
                  );
                })}
                {occ.length === 0 && <span className="muted">open</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function WyrmDragonCardView({
  card,
  played,
  zone = 'dragon',
  selectable,
  selected,
  compact,
  onClick,
}: {
  card: DragonCard;
  played?: PlayedDragon;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  compact?: boolean;
  onClick?: () => void;
}) {
  const flipRef = useFlipCard(`wyrm-d:${card.id}`, zone);
  const tokenTotal =
    (played?.eggs ?? 0) +
    (played?.cached.length ?? 0) +
    (played?.tucked.length ?? 0) +
    (played?.training ?? 0);
  const pulseRef = useValuePulse<HTMLDivElement>(tokenTotal);
  const trackLen = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;

  const pers = card.personality ?? 'Shy';
  return (
    <div
      ref={flipRef}
      className={`bird wyrm-dragon-card pers-${pers.toLowerCase()}${
        compact ? ' bird-compact' : ''
      }${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={`${card.name} (#${card.number}) — ${card.size} ${pers} · ${card.vp} VP\n${card.ability ?? ''}`}
    >
      <div className="bcard-top">
        <div className="bcard-badge">
          <div className="bcard-cost">
            {(card.cost.meat ?? 0) > 0 && <WyrmResourceIcon kind="meat" size={13} />}
            {(card.cost.gold ?? 0) > 0 && <WyrmResourceIcon kind="gold" size={13} />}
            {(card.cost.crystal ?? 0) > 0 && <WyrmResourceIcon kind="crystal" size={13} />}
            {(card.cost.milk ?? 0) > 0 && <WyrmResourceIcon kind="milk" size={13} />}
            {(card.cost.egg ?? 0) > 0 && <WyrmResourceIcon kind="egg" size={13} />}
            {(card.cost.coin ?? 0) > 0 && <WyrmResourceIcon kind="coin" size={13} />}
          </div>
          <div className="muted" style={{ fontSize: '0.62rem' }}>
            {card.caves.map((c) => c[0]).join('/')}
          </div>
        </div>
        <div className="bcard-titles">
          <div className="bname">{card.name}</div>
          <div className="bsci">
            {card.size} · {pers} · 🛡{card.vp}
            {card.size === 'Fledgling' ? '/fledg' : ''}
          </div>
        </div>
      </div>

      <div className="bcard-art">
        <DragonIllustration id={card.id} name={card.name} personality={pers} size={card.size} caves={card.caves} />
      </div>

      {card.trainingTrack && (
        <div className="fledgling-track">
          <span>Train ({played?.training ?? 0}/{trackLen}):</span>
          {renderWyrmspanText(card.trainingTrack)}
        </div>
      )}

      {card.ability && (
        <div className="bcard-power pband-brown">
          <div className="bpower">
            <b>[{card.abilityType}]</b> {renderWyrmspanText(card.ability)}
          </div>
        </div>
      )}

      {played && (
        <div ref={pulseRef} className="bcard-played-overlay">
          <div className="tokens">
            {played.eggs > 0 && (
              <span className="tok-pill" title="Eggs on dragon (1 VP each)">
                <WyrmResourceIcon kind="egg" size={14} /> ×{played.eggs}/{card.capacity}
              </span>
            )}
            {played.cached.map((r, i) => (
              <span key={i} title={`Cached ${r} (1 VP)`}>
                <WyrmResourceIcon kind={r} size={14} />
              </span>
            ))}
            {played.tucked.length > 0 && (
              <span className="tucked-count" title="Tucked dragons (1 VP each)">
                🂠 ×{played.tucked.length}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WyrmCaveCardView({
  card,
  zone = 'cave',
  selectable,
  selected,
  onClick,
}: {
  card: CaveCard;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const flipRef = useFlipCard(`wyrm-c:${card.id}`, zone);
  return (
    <div
      ref={flipRef}
      className={`wyrm-cave-card${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={`Cave #${card.number}\nWhen Excavated: ${card.ability}`}
    >
      <div className="wcc-head">🪨 Cave #{card.number}</div>
      <div className="wcc-body">{renderWyrmspanText(card.ability)}</div>
    </div>
  );
}

function WyrmspanPendingBar({
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
          {step.offer.map((cid) => {
            const on = setupKeeps.includes(cid);
            return (
              <button
                key={cid}
                type="button"
                className={on ? 'primary' : 'secondary'}
                onClick={() => {
                  setSetupKeeps((cur) =>
                    cur.includes(cid)
                      ? cur.filter((x) => x !== cid)
                      : cur.length < step.keep
                        ? [...cur, cid]
                        : [...cur.slice(1), cid],
                  );
                }}
              >
                {on ? '✓ ' : ''}
                {isDragonCard(cid) ? '🐉 ' : '🪨 '}
                {cardName(cid)}
              </button>
            );
          })}
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
            ✓ Keep {setupKeeps.length}/{step.keep} Cards
          </button>
        </div>
      )}

      {step.kind === 'setupResources' && (
        <div className="row">
          <span className="muted">Pick {step.count} starting resources:</span>
          {[0, 1, 2].map((slotIdx) => (
            <select
              key={slotIdx}
              value={setupRes[slotIdx] ?? 'meat'}
              onChange={(e) => {
                const next = setupRes.slice();
                next[slotIdx] = e.target.value as Resource;
                setSetupRes(next);
              }}
            >
              {RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
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
            ✓ Gain {setupRes.slice(0, step.count).join(' + ')}
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
      step.kind === 'choosePay' ||
      step.kind === 'opponentMay' ||
      step.kind === 'chooseTrain' ? (
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

function WyrmspanGameOverModal({
  state,
  onPlayAgain,
  onMenu,
}: {
  state: GameState;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const byId = new Map(state.finalScores!.map((s) => [s.playerId, s]));
  type Part = 'guildTile' | 'printedDragonVp' | 'endGameAbilities' | 'eggs' | 'cached' | 'tucked' | 'objectives' | 'coins' | 'leftovers' | 'bonusVP';
  const pts = (k: Part) => (id: PlayerId) => byId.get(id)?.[k] ?? 0;
  return (
    <GameOverModal
      title="Wyrmspan"
      winners={(state.winners ?? []).map((id) => player(state, id).name).join(', ')}
      players={state.players}
      parts={[
        ['guild', 'Dragon Guild', '#9b5de5', pts('guildTile')],
        ['dragons', 'Printed Dragon VP', '#e07a5f', pts('printedDragonVp')],
        ['endgame', 'End-Game Abilities', '#f4a261', pts('endGameAbilities')],
        ['eggs', 'Eggs', '#ffd166', pts('eggs')],
        ['cached', 'Cached Resources', '#52b788', pts('cached')],
        ['tucked', 'Tucked Cards', '#48cae4', pts('tucked')],
        ['objectives', 'Public Objectives', '#3a86ff', pts('objectives')],
        ['leftovers', 'Coins & Items', '#adb5bd', (id) => pts('coins')(id) + pts('leftovers')(id) + pts('bonusVP')(id)],
      ]}
      onPlayAgain={onPlayAgain}
      onMenu={onMenu}
    />
  );
}
