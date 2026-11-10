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
import { CreatureCard, FreeCost } from './CreatureCard';
import {
  AdventurerMeepleSvg,
  DragonIllustration,
  WYRM_CAVE_COLOR,
  WyrmResourceIcon,
  WyrmVp,
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
                <b>{actingP.name}</b> (<WyrmResourceIcon kind="coin" size={13} />{actingP.coins} · <WyrmResourceIcon kind="egg" size={13} />{actingP.nestEggs} in nests)
              </span>
              {state.phase === 'setup' && (
                <span className="badge">Setup — keep 4 cards & pick 3 resources</span>
              )}
              <div className="spacer" />
              <div ref={dragonDeckAnchor} className="deck-pill" title="Dragon & Cave decks">
                <WyrmResourceIcon kind="dragoncard" size={13} /> {state.dragonDeck.length} · <WyrmResourceIcon kind="cavecard" size={13} /> {state.caveDeck.length}
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
                <h3><WyrmResourceIcon kind="dragoncard" size={16} /> Dragon Display</h3>
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
                <h3><WyrmResourceIcon kind="cavecard" size={16} /> Cave Display</h3>
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
                    <WyrmResourceIcon kind="coin" size={12} />{p.coins} · <WyrmVp n={sc} size={15} /> {p.passed ? '(passed)' : ''}
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
                        <AdventurerMeepleSvg color={shownP.color} size={15} /> Explore (1<WyrmResourceIcon kind="coin" size={12} />
                        {expCount > 0 && <>+{expCount}<WyrmResourceIcon kind="egg" size={12} /></>})
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
                          <WyrmResourceIcon kind="cavecard" size={14} /> Excavate Col {(emptyIdx ?? 0) + 1}
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
                          <WyrmResourceIcon kind="dragoncard" size={14} /> Entice Col {(enticeIdx ?? 0) + 1}
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
                                  <WyrmResourceIcon kind="cavecard" size={12} /> {cardName(sp.caveCardId)}
                                </div>
                              )}
                              {isEntTarget && (
                                <div className="target-hint">▶ Click to Entice Dragon here</div>
                              )}
                            </div>
                          ) : (
                            <div className="unexcavated-box">
                              <span className="muted">
                                Unexcavated (Col {sIdx + 1} · 1<WyrmResourceIcon kind="coin" size={12} />
                                {excavateEggCost(sIdx) > 0 && <>+{excavateEggCost(sIdx)}<WyrmResourceIcon kind="egg" size={12} /></>})
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
                  <span className="res-picker" role="group" aria-label="Give">
                    {RESOURCES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={giveRes[0] === r ? 'primary' : 'secondary'}
                        title={`Give: ${r}`}
                        onClick={() => setGiveRes([r, giveRes[1]])}
                      >
                        <WyrmResourceIcon kind={r} size={16} />
                      </button>
                    ))}
                  </span>
                  <span className="res-picker" role="group" aria-label="Give">
                    {RESOURCES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={giveRes[1] === r ? 'primary' : 'secondary'}
                        title={`Give: ${r}`}
                        onClick={() => setGiveRes([giveRes[0], r])}
                      >
                        <WyrmResourceIcon kind={r} size={16} />
                      </button>
                    ))}
                  </span>
                  <span>→</span>
                  <span className="res-picker" role="group" aria-label="Get">
                    {RESOURCES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={getRes === r ? 'primary' : 'secondary'}
                        title={`Get: ${r}`}
                        onClick={() => setGetRes(r)}
                      >
                        <WyrmResourceIcon kind={r} size={16} />
                      </button>
                    ))}
                  </span>
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
                <WyrmResourceIcon kind="guild" size={14} /> Guild & Standings
              </button>
              <button
                type="button"
                className={`side-tab-btn${sideTab === 'log' ? ' active' : ''}`}
                onClick={() => setSideTab('log')}
              >
                Log ({state.log.length})
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
                        <WyrmResourceIcon kind="coin" size={12} /> Objective coins: <b>{state.automa.objectiveCoins}</b>
                      </span>
                      <span className="stat-pill">
                        <WyrmResourceIcon kind="dragoncard" size={12} /> Dragons: <b>{state.automa.collectedDragons}</b>
                      </span>
                      <span className="stat-pill">
                        <WyrmResourceIcon kind="cavecard" size={12} /> Caves: <b>{state.automa.collectedCaves}</b>
                      </span>
                      <span className="stat-pill">
                        <WyrmResourceIcon kind="guild" size={12} /> Guild markers left: <b>{state.automa.availableGuildMarkers}</b>
                      </span>
                      {state.automa.cacheTokens > 0 && (
                        <span className="stat-pill">
                          <WyrmResourceIcon kind="cached" size={12} /> Cache tokens: <b>{state.automa.cacheTokens}</b>
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
                        <span title="Printed dragon VP"><WyrmResourceIcon kind="dragoncard" size={12} />{sc.printedDragonVp}</span> ·{' '}
                        <span title="Eggs"><WyrmResourceIcon kind="egg" size={12} />{sc.eggs}</span> ·{' '}
                        <span title="Cached resources"><WyrmResourceIcon kind="cached" size={12} />{sc.cached}</span> ·{' '}
                        <span title="Guild tile"><WyrmResourceIcon kind="guild" size={12} />{sc.guildTile}</span>
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

/** Icon for a guild-track space, derived from its reward. */
function trackIcon(sp: { brown?: boolean; label: string }): string {
  if (sp.brown) return 'guild';
  const l = sp.label.toLowerCase();
  if (l.includes('dragon card')) return 'dragoncard';
  if (l.includes('cave card')) return 'cavecard';
  for (const k of ['egg', 'meat', 'gold', 'crystal', 'milk', 'coin']) if (l.includes(k)) return k;
  return 'any';
}

function DragonGuildPanel({ state }: { state: GameState }) {
  const tile = GUILD_TILES[state.guild.tile];
  const n = GUILD_TRACK.length;
  const posOf = (pid: PlayerId) => state.guild.track[pid] ?? 0;
  return (
    <div className="card">
      <h3>
        <WyrmResourceIcon kind="guild" size={16} /> {tile?.name ?? state.guild.tile}
      </h3>
      <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 6 }}>
        Each <WyrmResourceIcon kind="guild" size={12} /> moves you 1 space clockwise and gives that space&apos;s reward.{' '}
        <WyrmResourceIcon kind="guild" size={12} /> spaces = place a guild marker on the tile.
      </div>
      <div className="guild-track">
        {GUILD_TRACK.map((sp, i) => {
          const here = state.players.filter((p) => posOf(p.id) === i);
          const nextFor = state.players.filter((p) => (posOf(p.id) + 1) % n === i);
          return (
            <div
              key={i}
              className={`gt-space${sp.brown ? ' brown' : ''}${nextFor.length ? ' next' : ''}`}
              title={`Space ${i}: ${sp.label}${nextFor.length ? `\nNext reward for: ${nextFor.map((p) => p.name).join(', ')}` : ''}`}
            >
              <span className="gt-num">{i}</span>
              <WyrmResourceIcon kind={trackIcon(sp)} size={20} />
              <div className="gt-tokens">
                {here.map((p) => (
                  <span key={p.id} className="pcolor" style={{ background: playerColorHex(p.color) }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="guild-upcoming">
        {state.players.map((p) => {
          const pos = posOf(p.id);
          return (
            <div key={p.id} className="guild-up-row">
              <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
              <b>{p.name}</b>
              <span className="muted">
                space {pos} · {p.guildMarkersPlaced}/4 markers · next:
              </span>
              {[1, 2, 3].map((d) => {
                const sp = GUILD_TRACK[(pos + d) % n]!;
                return (
                  <span key={d} className={`guild-up-item${d === 1 ? ' first' : ''}`} title={`+${d}: ${sp.label}`}>
                    <WyrmResourceIcon kind={trackIcon(sp)} size={d === 1 ? 18 : 15} />
                  </span>
                );
              })}
            </div>
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
                    <span key={k} className="pcolor" style={{ background: playerColorHex(pl.color) }} title={pl.name} />
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

const ABILITY_META: Record<string, { label: string; cls: string; icon: string }> = {
  WhenPlayed: { label: 'When played', cls: 'ab-whenplayed', icon: 'whenplayed' },
  OncePerRound: { label: 'Once per round', cls: 'ab-onceperround', icon: 'onceperround' },
  EndGame: { label: 'Game end', cls: 'ab-endgame', icon: 'endgame' },
  Adventurer: { label: 'Adventurer', cls: 'ab-adventurer', icon: 'adventurer' },
  'Adventurer, EndGame': { label: 'Adventurer · Game end', cls: 'ab-adventurer', icon: 'adventurer' },
};

const COST_ORDER = ['meat', 'gold', 'crystal', 'milk', 'egg', 'coin'] as const;

function caveStrip(caves: readonly string[]) {
  return CAVE_THEMES.map((t) => ({
    key: t.id,
    label: t.name,
    color: WYRM_CAVE_COLOR[t.id]!,
    icon: <WyrmResourceIcon kind={t.id} size={13} />,
    on: caves.some((c) => c.toLowerCase().startsWith(t.id)),
  }));
}

function tally(items: readonly string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()];
}

export function WyrmDragonCardView({
  card,
  played,
  zone = 'dragon',
  selectable,
  selected,
  onClick,
}: {
  card: DragonCard;
  played?: PlayedDragon;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  /** @deprecated cards are one fixed size everywhere; kept for call-site compatibility. */
  compact?: boolean;
  onClick?: () => void;
}) {
  const flipRef = useFlipCard(`wyrm-d:${card.id}`, zone);
  const tokenTotal =
    (played?.eggs ?? 0) + (played?.cached.length ?? 0) + (played?.tucked.length ?? 0) + (played?.training ?? 0);
  const pulseRef = useValuePulse<HTMLDivElement>(tokenTotal);
  const trackLen = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
  const pers = card.personality ?? 'Shy';
  const meta = ABILITY_META[card.abilityType] ?? { label: card.abilityType, cls: 'ab-whenplayed', icon: 'whenplayed' };
  const costIcons = COST_ORDER.flatMap((r) =>
    Array.from({ length: card.cost[r] ?? 0 }, (_, i) => <WyrmResourceIcon key={`${r}${i}`} kind={r} size={15} />),
  );

  const overlay =
    played && tokenTotal > 0 ? (
      <div ref={pulseRef} className="cc-tokens">
        {played.eggs > 0 && (
          <span title={`${played.eggs} egg(s) — 1 VP each`}>
            <WyrmResourceIcon kind="egg" size={12} />×{played.eggs}
          </span>
        )}
        {tally(played.cached).map(([r, n]) => (
          <span key={r} title={`${n} cached ${r} — 1 VP each`}>
            <WyrmResourceIcon kind={r} size={12} />×{n}
          </span>
        ))}
        {played.tucked.length > 0 && (
          <span title={`${played.tucked.length} tucked dragon(s) — 1 VP each`}>
            <WyrmResourceIcon kind="tucked" size={12} />×{played.tucked.length}
          </span>
        )}
        {(played.training ?? 0) > 0 && (
          <span title={`Training ${played.training}/${trackLen}`}>
            <WyrmResourceIcon kind="fledglingarrow" size={12} />
            {played.training}/{trackLen}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <CreatureCard
      theme="wyrm"
      cardRef={flipRef}
      name={card.name}
      subtitle={`#${card.number} · ${card.size} · ${pers}`}
      cost={
        <>
          {costIcons.length ? costIcons : <FreeCost />}
          {card.ignoreCost && (
            <span className="cc-free" title="This dragon's cost can be ignored (see its ability)">
              *
            </span>
          )}
        </>
      }
      points={<WyrmVp n={card.vp} size={22} />}
      placements={caveStrip(card.caves)}
      art={<DragonIllustration id={card.id} name={card.name} personality={pers} size={card.size} caves={card.caves} />}
      overlay={overlay}
      traits={
        <>
          <span className="cc-trait">
            <WyrmResourceIcon kind={card.size.toLowerCase()} size={14} />
          </span>
          <span className="cc-trait">
            <WyrmResourceIcon kind={pers.toLowerCase()} size={14} />
          </span>
          <span className="cc-trait" title={card.capacity ? `Holds up to ${card.capacity} egg(s)` : 'Cannot hold eggs'}>
            <WyrmResourceIcon kind="egg" size={13} />
            {played ? `${played.eggs}/${card.capacity}` : `×${card.capacity}`}
          </span>
        </>
      }
      powerClass={card.ability ? meta.cls : 'pband-none'}
      powerIcon={card.ability ? <WyrmResourceIcon kind={meta.icon} size={11} /> : undefined}
      powerLabel={card.ability ? meta.label : undefined}
      preface={
        card.trainingTrack ? (
          <div className="cc-preface" title="Fledgling training track">
            Train {played?.training ?? 0}/{trackLen}: {renderWyrmspanText(card.trainingTrack, 12)}
          </div>
        ) : undefined
      }
      power={card.ability ? renderWyrmspanText(card.ability, 13) : <span className="muted">No ability</span>}
      tooltip={`${card.name} (#${card.number}) — ${card.size} · ${pers} · ${card.vp} VP · ${card.caves.join(' / ')}\n${
        card.ability ? `${meta.label}: ${card.ability}` : 'No ability'
      }`}
      selectable={selectable}
      selected={selected}
      onClick={onClick}
    />
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
    <CreatureCard
      theme="wyrm"
      cardRef={flipRef}
      name={card.name ?? `Cave card #${card.number}`}
      subtitle={`Cave #${card.number} · excavate into any cave`}
      cost={
        <span className="cc-free" title="Cave card — the excavation cost depends on the column">
          CAVE
        </span>
      }
      points={<WyrmResourceIcon kind="cavecard" size={20} />}
      placements={caveStrip(['crimson', 'golden', 'amethyst'])}
      art={<div className="cc-cave-art" />}
      traits={<span className="muted">Excavates 1 cave space</span>}
      powerClass="ab-cave"
      powerIcon={<WyrmResourceIcon kind="cavecard" size={11} />}
      powerLabel="When excavated"
      power={card.ability ? renderWyrmspanText(card.ability, 13) : <span className="muted">No effect</span>}
      tooltip={`Cave #${card.number}\nWhen excavated: ${card.ability ?? '—'}`}
      selectable={selectable}
      selected={selected}
      onClick={onClick}
    />
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
