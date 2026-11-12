// Finspan (+ Sharks & Reefs) game screen. Lazy-loaded with the Finspan engine
// chunk (see src/games/engines.ts).

import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import { fish } from '@/finspan/cards';
import {
  allSlots,
  canPlayFish,
  getPlayer,
  legalSlots,
  totalConsumed,
  totalEggs,
  totalSchools,
  totalYoung,
} from '@/finspan/helpers';
import { scoreAchievement, scorePlayer } from '@/finspan/scoring';
import type { Action, GameState, PlayerId, SlotRef } from '@/finspan/types';
import { DIVERS_PER_WEEK } from '@/finspan/types';
import { ActionToastBanner, FlipProvider, useFlipAnchor } from '../fx';
import { GameOverModal } from '../MatchCharts';
import { RulesModal } from '../RulesBook';
import { DiverMeepleSvg, FinIcon, playerColorHex } from '../svgArt';
import { OceanMatView } from './OceanMat';
import { FishCardView } from './FishCardView';
import { FinspanPendingBar } from './PendingBar';

export function FinspanScreen() {
  const state = useGameStore((s) => s.finspanGame)!;
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

  const deckAnchor = useFlipAnchor('fish-deck');

  const actingId =
    state.pending[0]?.playerId ?? state.playerOrder[state.currentPlayerIndex]!;
  const actingIdx = state.playerOrder.indexOf(actingId);
  const myIdx =
    connection === 'in-game'
      ? state.playerOrder.findIndex((pid) => uuidForPlayer(pid) === myUuid)
      : -1;
  const shownIdx = viewIdx ?? (myIdx >= 0 ? myIdx : Math.max(0, actingIdx));
  const shownId = state.playerOrder[shownIdx] ?? state.playerOrder[0]!;
  const shownP = getPlayer(state, shownId);
  const actingP = getPlayer(state, actingId);

  const controls = (pid: PlayerId): boolean => {
    if (connection !== 'in-game') return true;
    if (role === 'spectator') return false;
    const owner = uuidForPlayer(pid);
    return owner === myUuid || (owner === null && role === 'host');
  };

  const canActMain =
    state.phase === 'main' &&
    state.pending.length === 0 &&
    !state.turnTookAction &&
    actingP.diversUsed < DIVERS_PER_WEEK &&
    controls(actingId);

  const selectedCard =
    selectedCardId != null && actingP.hand.includes(selectedCardId)
      ? fish(selectedCardId)
      : null;
  const validTargets: SlotRef[] =
    selectedCard && canActMain && canPlayFish(actingP, selectedCard)
      ? legalSlots(actingP.ocean, selectedCard)
      : [];

  const playSelectedToSlot = (ref: SlotRef) => {
    if (!selectedCard || !canActMain) return;
    const handMinus = actingP.hand.filter((id) => id !== selectedCard.id);
    const discardCardIds = [...handMinus]
      .sort((a, b) => fish(a).points - fish(b).points)
      .slice(0, selectedCard.cost.cards);
    const slots = [...allSlots(actingP.ocean)];
    const eggSlots = slots
      .filter(({ slot }) => slot.eggs > 0)
      .map((x) => x.ref)
      .slice(0, selectedCard.cost.eggs);
    const youngSlots: SlotRef[] = [];
    for (const { ref: r, slot } of slots) {
      for (let i = 0; i < slot.young && youngSlots.length < selectedCard.cost.young; i++) {
        youngSlots.push(r);
      }
    }
    const schoolSlots = slots
      .filter(({ slot }) => slot.school)
      .map((x) => x.ref)
      .slice(0, selectedCard.cost.schools);

    const action: Action = {
      type: 'playFish',
      playerId: actingId,
      cardId: selectedCard.id,
      row: ref.row,
      col: ref.col,
      discardCardIds,
      eggSlots,
      youngSlots,
      schoolSlots,
    };
    dispatch(action);
    setSelectedCardId(null);
  };

  const headPending = state.pending[0];
  const isSR = state.settings.sets.includes('sr');

  return (
    <FlipProvider
      scene={`finspan:${state.phase === 'gameOver'}`}
      defaultOrigin="fish-deck"
    >
      <div className="game finspan-theme">
        <div>
          {/* Top status bar */}
          <div className="card topbar-card">
            <div className="row">
              <span className="badge">Week {state.week + 1} / 4</span>
              <span>
                Acting:{' '}
                <span
                  className="pcolor"
                  style={{ background: playerColorHex(actingP.color) }}
                />
                <b>{actingP.name}</b> ({DIVERS_PER_WEEK - actingP.diversUsed} divers left)
              </span>
              {state.turnTookAction && state.pending.length === 0 && (
                <button
                  type="button"
                  className="primary"
                  disabled={!controls(actingId)}
                  onClick={() => dispatch({ type: 'endTurn', playerId: actingId })}
                >
                  End Turn →
                </button>
              )}
              <div className="spacer" />
              <div ref={deckAnchor} className="deck-pill" title="Main fish deck">
                <FinIcon kind="fishfromhand" size={13} /> Deck: <b>{state.deck.length}</b>
              </div>
              {connection !== 'in-game' && (
                <button
                  type="button"
                  className="secondary"
                  disabled={undoCount === 0}
                  onClick={undo}
                  title="Undo last move"
                >
                  ↶ Undo
                </button>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => setAiSpeed(aiSpeed === 'normal' ? 'fast' : 'normal')}
                title="Toggle AI move speed"
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

            {/* Achievements strip */}
            <div className="achievements-strip">
              <span className="muted">
                Achievements (Side {state.settings.achievementSide}):
              </span>
              {state.achievements.map((ach, w) => {
                const myPts = scoreAchievement(shownP, ach);
                return (
                  <span
                    key={w}
                    className={`ach-chip${w === state.week ? ' active' : w < state.week ? ' done' : ''}`}
                    title={`Week ${w + 1}: ${ach.name} (${ach.per} VP each)`}
                  >
                    <b>W{w + 1}:</b> {ach.name} ({ach.per}pt) · <em>{myPts}pt</em>
                  </span>
                );
              })}
            </div>
          </div>

          <ActionToastBanner logMessages={state.log.map((e) => e.msg)} />

          {/* Player selector tabs */}
          <div className="player-tabs-row">
            {state.playerOrder.map((pid, i) => {
              const p = getPlayer(state, pid);
              const liveScore = scorePlayer(state, p).total;
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
                    <DiverMeepleSvg color={p.color} size={12} />×{DIVERS_PER_WEEK - p.diversUsed} · {liveScore}
                    <FinIcon kind="wave" size={12} />
                  </span>
                  {pid === actingId && <span className="turn-dot" />}
                </button>
              );
            })}
          </div>

          {/* Ocean Mat: 3 Dive Sites x 6 Depth Rows */}
          <OceanMatView
            state={state}
            player={shownP}
            isSR={isSR}
            canDive={canActMain && shownP.id === actingId}
            validTargets={shownP.id === actingId ? validTargets : []}
            onDive={(col) => dispatch({ type: 'dive', playerId: actingId, col })}
            onSelectSlot={playSelectedToSlot}
          />

          {/* Player Hand & Discard */}
          <div className="card">
            <div className="row" style={{ marginBottom: 8 }}>
              <h3>
                {shownP.name}&apos;s Hand ({shownP.hand.length})
              </h3>
              {selectedCard && (
                <span className="badge">
                  Click a highlighted ocean slot to play {selectedCard.name} — or{' '}
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
              <span className="muted">Discard pile: {shownP.discard.length} card(s)</span>
            </div>
            <div className="hand">
              {shownP.hand.map((cid) => {
                const c = fish(cid);
                const playable =
                  canActMain && shownP.id === actingId && !c.forage && canPlayFish(shownP, c);
                return (
                  <FishCardView
                    key={cid}
                    card={c}
                    zone={`hand:${shownP.id}`}
                    selectable={playable}
                    selected={selectedCardId === cid}
                    onClick={
                      playable
                        ? () => setSelectedCardId((cur) => (cur === cid ? null : cid))
                        : undefined
                    }
                  />
                );
              })}
              {shownP.hand.length === 0 && <div className="muted">No cards in hand.</div>}
            </div>
          </div>
        </div>

        {/* Right Side Panel */}
        <div className="side-column">
          <div className="card">
            <div className="side-tabs-bar">
              <button
                type="button"
                className={`side-tab-btn${sideTab === 'play' ? ' active' : ''}`}
                onClick={() => setSideTab('play')}
              >
                Ocean & Standings
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
                {state.nautoma && (
                  <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <h3>
                      ⚙️ Nautoma Solo Deck (⭐ {state.nautoma.difficulty}
                      {state.nautoma.ravelMode ? ` · Ravel X=${state.nautoma.ravelStrength}` : ''})
                    </h3>
                    <div className="stat-pills">
                      <span className="stat-pill">
                        🃏 Deck: <b>{state.nautoma.deck.length}</b> (Last: #{state.nautoma.lastCardId ?? '—'})
                      </span>
                      <span className="stat-pill">
                        <DiverMeepleSvg color="c4" size={12} /> Achievement divers: <b>{state.nautoma.achievementDivers}</b>
                      </span>
                      <span className="stat-pill">
                        <FinIcon kind="fishfromhand" size={12} /> Fish: <b>{state.nautoma.fish.length}</b>
                      </span>
                      <span className="stat-pill">
                        <FinIcon kind="school" size={12} /> Schools: <b>{state.nautoma.schools}</b>
                      </span>
                      <span className="stat-pill">
                        <FinIcon kind="young" size={12} /> Young: <b>{state.nautoma.young}</b> · <FinIcon kind="egg" size={12} /> Eggs: <b>{state.nautoma.eggs}</b>
                      </span>
                      {isSR && (
                        <span className="stat-pill">
                          <FinIcon kind="anycoral" size={12} /> Coral: <b>{state.nautoma.corals}</b>
                        </span>
                      )}
                      {state.nautoma.ravelMode && (
                        <span className="stat-pill">
                          🏖 Ravel ({state.nautoma.ravelCardId}): <b>+{state.nautoma.ravelPoints} VP</b>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <h3>Ocean Summary — {shownP.name}</h3>
                <div className="stat-pills" style={{ marginBottom: 10 }}>
                  <span className="stat-pill">
                    <FinIcon kind="egg" size={15} /> Eggs: <b>{totalEggs(shownP.ocean)}</b>
                  </span>
                  <span className="stat-pill">
                    <FinIcon kind="young" size={15} /> Young: <b>{totalYoung(shownP.ocean)}</b>
                  </span>
                  <span className="stat-pill">
                    <FinIcon kind="school" size={15} /> Schools (6pt): <b>{totalSchools(shownP.ocean)}</b>
                  </span>
                  <span className="stat-pill">
                    <FinIcon kind="consume" size={15} /> Consumed: <b>{totalConsumed(shownP.ocean)}</b>
                  </span>
                  {isSR && (
                    <span className="stat-pill">
                      <FinIcon kind="coral" size={15} /> Coral:{' '}
                      <b>{shownP.ocean.corals.join(' / ')}</b>
                    </span>
                  )}
                </div>

                <h3>🏆 Live Standings</h3>
                {state.players.map((p) => {
                  const sc = scorePlayer(state, p);
                  return (
                    <div key={p.id} className="standing-row">
                      <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
                      <b>{p.name}</b>
                      <span className="spacer" />
                      <span className="muted" style={{ fontSize: '0.75rem' }}>
                        <span title="Fish card points"><FinIcon kind="fishfromhand" size={12} />{sc.fishPoints}</span> ·{' '}
                        <span title="Eggs + young fish"><FinIcon kind="egg" size={12} /><FinIcon kind="young" size={12} />{sc.eggYoungPoints}</span> ·{' '}
                        <span title="Schools"><FinIcon kind="school" size={12} />{sc.schoolPoints}</span> ·{' '}
                        <span title="Achievements">🏆{sc.achievementPoints}</span>
                      </span>
                      <b className="badge">{sc.total} VP</b>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="log">
                {state.log.slice(-50).map((e) => (
                  <div key={e.seq}>{e.msg}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Pending step resolution bar */}
        {headPending && (
          <FinspanPendingBar
            state={state}
            step={headPending}
            controls={controls(headPending.playerId)}
            dispatch={dispatch}
          />
        )}

        {/* Game Over Modal with SVG Charts */}
        {state.phase === 'gameOver' && state.finalScores && (
          <FinspanGameOverModal
            state={state}
            onPlayAgain={playAgainLocal}
            onMenu={() => (connection === 'in-game' ? leaveRoom() : clearGame())}
          />
        )}

        {showRules && <RulesModal gameId="finspan" onClose={() => setShowRules(false)} />}
      </div>
    </FlipProvider>
  );
}

function FinspanGameOverModal({
  state,
  onPlayAgain,
  onMenu,
}: {
  state: GameState;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const scores = state.finalScores!;
  const pts = (k: Exclude<keyof (typeof scores)[PlayerId], 'total'>) => (id: PlayerId) => scores[id]![k];
  return (
    <GameOverModal
      title="Finspan"
      winners={(state.winner ?? []).map((id) => getPlayer(state, id).name).join(', ')}
      players={state.players}
      parts={[
        ['fish', 'Visible Fish', '#48cae4', pts('fishPoints')],
        ['consumed', 'Consumed Fish', '#e76f51', pts('consumedPoints')],
        ['tokens', 'Eggs & Young', '#ffd166', pts('eggYoungPoints')],
        ['schools', 'Schools (6pt)', '#0077b6', pts('schoolPoints')],
        ['achievements', 'Achievements', '#52b788', pts('achievementPoints')],
        ['wave', 'Game-End Abilities', '#9b5de5', pts('gameEndAbilityPoints')],
        ['coral', 'Coral & Reefs', '#f15bb5', pts('coralPoints')],
      ]}
      onPlayAgain={onPlayAgain}
      onMenu={onMenu}
    />
  );
}
