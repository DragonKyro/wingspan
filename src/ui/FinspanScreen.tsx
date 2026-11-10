// Finspan (+ Sharks & Reefs) full interactive UI with thematic SVG Ocean Mat,
// animated Fish Cards, Dive Sites, Coral Reef Overlays, Pending Choice Bar,
// and Post-Game SVG Match Statistics.

import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import { fish } from '@/finspan/cards';
import { DIVE_BONUSES, MAX_CORAL, REEF_COMPLETION_BONUS, REEF_DISCARD_ITEMS } from '@/finspan/constants';
import {
  allSlots,
  canPlayFish,
  consumedCount,
  getPlayer,
  legalSlots,
  slotAt,
  topFish,
  totalConsumed,
  totalEggs,
  totalSchools,
  totalYoung,
} from '@/finspan/helpers';
import { chooseForPending } from '@/finspan/ai/choices';
import { scoreAchievement, scorePlayer } from '@/finspan/scoring';
import type {
  Action,
  FishCard,
  GameState,
  PendingStep,
  PlayerId,
  PlayerState,
  SlotRef,
  SlotState,
} from '@/finspan/types';
import { DEEPWATER_ROW, DIVERS_PER_WEEK, ESTUARY_ROW, SITE_COLORS, zoneOfRow } from '@/finspan/types';
import { ActionToastBanner, FlipProvider, useFlipAnchor, useFlipCard, useValuePulse } from './fx';
import { GameOverModal } from './MatchCharts';
import { RulesModal } from './RulesBook';
import { CreatureCard, FreeCost } from './CreatureCard';
import {
  DiverMeepleSvg,
  FinIcon,
  FishIllustration,
  playerColorHex,
  renderFinspanText,
} from './svgArt';

const SITE_LABELS = [
  { color: 'blue', title: 'Blue Dive Site', subtitle: 'Draw Cards · Bottom: Recover' },
  { color: 'purple', title: 'Purple Dive Site', subtitle: 'Lay Eggs · Bottom: +1 Egg' },
  { color: 'green', title: 'Green Dive Site', subtitle: 'Hatch & Move · Bottom: Move' },
] as const;

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

function OceanMatView({
  state,
  player,
  isSR,
  canDive,
  validTargets,
  onDive,
  onSelectSlot,
}: {
  state: GameState;
  player: PlayerState;
  isSR: boolean;
  canDive: boolean;
  validTargets: SlotRef[];
  onDive: (col: number) => void;
  onSelectSlot: (ref: SlotRef) => void;
}) {
  const playerIdx = state.players.findIndex((p) => p.id === player.id);
  const reefItems = state.settings.reefCosts?.[playerIdx] ?? REEF_DISCARD_ITEMS;

  return (
    <div className="card ocean-mat">
      {/* Dive site column headers */}
      <div className="ocean-sites-header">
        <div className="ocean-zone-gutter">Depth Zone</div>
        {SITE_LABELS.map((site, col) => {
          const bonus = DIVE_BONUSES[col]!;
          const coral = player.ocean.corals[col] ?? 0;
          const reefItem = reefItems[col] ?? 'egg';
          return (
            <div key={site.color} className={`ocean-site-head site-${site.color}`}>
              <div className="row">
                <b>{site.title}</b>
                <div className="spacer" />
                <button
                  type="button"
                  className="primary dive-btn"
                  disabled={!canDive}
                  onClick={() => onDive(col)}
                >
                  <DiverMeepleSvg color={player.color} size={16} /> Dive Here
                </button>
              </div>
              <div className="site-bonuses-row">
                <span>
                  Zones:{' '}
                  {bonus.zones.map((b, idx) => (
                    <FinIcon key={idx} kind={b} size={14} />
                  ))}
                </span>
                <span>
                  Bottom {!player.bottomTaken[col] ? '(open)' : '(taken)'}:{' '}
                  <FinIcon kind={bonus.bottom} size={14} />
                </span>
              </div>
              {isSR && (
                <div className="reef-strip" title="Sharks & Reefs Coral Overlay">
                  <span>
                    <FinIcon kind="anycoral" size={12} /> Coral: <b>{coral}/{MAX_CORAL}</b> (+{REEF_COMPLETION_BONUS[col]}pt at 6)
                  </span>
                  <span className="muted">
                    Twilight cost: <FinIcon kind={reefItem === 'card' ? 'discard' : reefItem} size={13} />
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 6 Depth Rows */}
      {Array.from({ length: 6 }, (_, row) => {
        const zone = zoneOfRow(row);
        const [rowIcon, rowText] =
          row === ESTUARY_ROW
            ? ['estuary', 'Sunlight (Estuary)']
            : row <= 2
              ? ['sunlight', 'Sunlight']
              : row === 3
                ? ['twilight', isSR ? 'Twilight + Coral Reef' : 'Twilight']
                : row === DEEPWATER_ROW
                  ? ['deepwater', 'Midnight (Deepwater)']
                  : ['midnight', 'Midnight'];
        const rowLabel = (
          <>
            <FinIcon kind={rowIcon} size={15} /> {rowText}
          </>
        );
        return (
          <div key={row} className={`ocean-row zone-${zone}`}>
            <div className="ocean-zone-label">
              <span>{rowLabel}</span>
              <span className="muted">Row {row + 1}</span>
            </div>
            {[0, 1, 2].map((col) => {
              const slot = slotAt(player.ocean, { row, col });
              const top = topFish(slot);
              const consumed = consumedCount(slot);
              const isTarget = validTargets.some((t) => t.row === row && t.col === col);
              return (
                <div
                  key={col}
                  className={`ocean-slot site-border-${SITE_COLORS[col]}${
                    isTarget ? ' targetable' : ''
                  }`}
                  onClick={isTarget ? () => onSelectSlot({ row, col }) : undefined}
                >
                  {top ? (
                    <FishCardView
                      card={top}
                      slotState={slot}
                      consumedCount={consumed}
                      zone={`ocean:${player.id}:${row}:${col}`}
                      selectable={isTarget}
                      compact
                    />
                  ) : (
                    <div className="empty-ocean-slot">
                      <span className="muted">
                        {isTarget ? '▶ Click to place fish here' : 'Open water'}
                      </span>
                      <SlotTokensBadge slot={slot} consumed={0} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function SlotTokensBadge({ slot, consumed }: { slot: SlotState; consumed: number }) {
  const total = slot.eggs + slot.young + (slot.school ? 3 : 0) + consumed;
  const pulseRef = useValuePulse<HTMLDivElement>(total);
  if (total === 0) return null;
  return (
    <div ref={pulseRef} className="ocean-tokens-row">
      {slot.eggs > 0 && (
        <span className="tok-pill" title="Fish egg (1 VP)">
          <FinIcon kind="egg" size={15} /> ×{slot.eggs}
        </span>
      )}
      {slot.young > 0 && (
        <span className="tok-pill" title="Young fish (1 VP; 3 merge into a 6-VP School)">
          <FinIcon kind="young" size={15} /> ×{slot.young}
        </span>
      )}
      {slot.school && (
        <span className="tok-pill school-pill" title="School token (6 VP)">
          <FinIcon kind="school" size={17} /> School (6pt)
        </span>
      )}
      {consumed > 0 && (
        <span className="tok-pill consumed-pill" title={`${consumed} consumed fish tucked underneath (1 VP each)`}>
          <FinIcon kind="consume" size={14} /> ×{consumed}
        </span>
      )}
    </div>
  );
}

const FIN_ABILITY: Record<string, { label: string; cls: string }> = {
  WhenPlayed: { label: 'When played', cls: 'fab-whenplayed' },
  IfActivated: { label: 'If activated', cls: 'fab-ifactivated' },
  GameEnd: { label: 'Game end', cls: 'fab-gameend' },
};

const ZONE_STRIP = [
  { key: 'sunlight', label: 'Sunlight zone', color: '#2a9fd6' },
  { key: 'twilight', label: 'Twilight zone', color: '#1f5f8f' },
  { key: 'midnight', label: 'Midnight zone', color: '#16264a' },
] as const;

const TAG_ORDER = ['predator', 'venomous', 'electric', 'bioluminescent', 'camouflage'] as const;

export function FishCardView({
  card,
  slotState,
  consumedCount = 0,
  zone = 'fish',
  selectable,
  selected,
  onClick,
}: {
  card: FishCard;
  slotState?: SlotState;
  consumedCount?: number;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  /** @deprecated cards are one fixed size everywhere; kept for call-site compatibility. */
  compact?: boolean;
  onClick?: () => void;
}) {
  const flipRef = useFlipCard(`fish:${card.id}`, zone);
  const tokenTotal = slotState ? slotState.eggs + slotState.young + (slotState.school ? 3 : 0) + consumedCount : 0;
  const pulseRef = useValuePulse<HTMLDivElement>(tokenTotal);
  const c = card.cost;
  const rep = (n: number, kind: string) =>
    Array.from({ length: n }, (_, i) => <FinIcon key={`${kind}${i}`} kind={kind} size={15} />);
  const costIcons = [
    ...rep(c.cards, 'discard'),
    ...rep(c.eggs, 'egg'),
    ...rep(c.young, 'young'),
    ...rep(c.schools, 'school'),
    ...(c.consume ? rep(1, 'consume') : []),
  ];
  const coral = card.coralCost;
  const meta = card.abilityType ? FIN_ABILITY[card.abilityType] : undefined;
  const deep = card.zones.midnight === 'bottom';

  const overlay =
    slotState && tokenTotal > 0 ? (
      <div ref={pulseRef} className="cc-tokens">
        {slotState.eggs > 0 && (
          <span title={`${slotState.eggs} fish egg(s) — 1 VP each`}>
            <FinIcon kind="egg" size={12} />×{slotState.eggs}
          </span>
        )}
        {slotState.young > 0 && (
          <span title={`${slotState.young} young fish — 1 VP each; 3 merge into a 6-VP school`}>
            <FinIcon kind="young" size={12} />×{slotState.young}
          </span>
        )}
        {slotState.school && (
          <span title="School — 6 VP">
            <FinIcon kind="school" size={12} />6
          </span>
        )}
        {consumedCount > 0 && (
          <span title={`${consumedCount} consumed fish underneath — 1 VP each`}>
            <FinIcon kind="consume" size={12} />×{consumedCount}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <CreatureCard
      theme="fin"
      cardRef={flipRef}
      name={card.name}
      subtitle={card.latin}
      cost={
        <>
          {costIcons.length || coral ? costIcons : <FreeCost />}
          {coral &&
            Array.from({ length: coral.count }, (_, i) => (
              <FinIcon key={`cor${i}`} kind={coral.site === 'any' ? 'anycoral' : `${coral.site}coral`} size={15} />
            ))}
        </>
      }
      points={
        card.forage ? (
          <FinIcon kind="forage" size={20} />
        ) : (
          <>
            {card.points}
            <FinIcon kind="wave" size={16} />
          </>
        )
      }
      placements={ZONE_STRIP.map((z) => ({
        key: z.key,
        label: z.key === 'midnight' && deep ? 'Midnight zone — deepwater (bottom row) only' : z.label,
        color: z.color,
        icon: <FinIcon kind={z.key === 'midnight' && deep ? 'deepwater' : z.key} size={13} />,
        on: !!card.zones[z.key],
      }))}
      art={
        <FishIllustration
          id={card.id}
          name={card.name}
          size={card.size}
          tags={card.tags}
          forage={card.forage}
          zones={card.zones}
          coral={coral && coral.site !== 'any' ? coral.site : null}
        />
      }
      overlay={overlay}
      traits={
        <>
          <span className="cc-trait" title={`${card.size} fish · ${card.length} cm (can consume shorter fish)`}>
            <FinIcon kind={card.size} size={14} />
            {card.length}cm
          </span>
          {card.band && (
            <span className="cc-trait" title={`Only playable in the ${card.band} dive site`}>
              <FinIcon kind={`flipper${card.band}`} size={13} />
            </span>
          )}
          <span className="spacer" />
          {TAG_ORDER.filter((t) => (card.tags[t] ?? 0) > 0).map((t) => (
            <span key={t} className="cc-trait">
              <FinIcon kind={t} size={13} />
              {(card.tags[t] ?? 0) > 1 ? `×${card.tags[t]}` : ''}
            </span>
          ))}
        </>
      }
      powerClass={meta ? meta.cls : 'pband-none'}
      powerLabel={meta?.label}
      power={card.ability ? renderFinspanText(card.ability, 13) : <span className="muted">No ability</span>}
      tooltip={`${card.name} (${card.latin}) — ${card.forage ? 'forage fish' : `${card.points} VP`} · ${card.length} cm ${
        card.size
      }\n${card.ability ? `${meta?.label ?? 'Ability'}: ${card.ability}` : 'No ability'}`}
      selectable={selectable}
      selected={selected}
      onClick={onClick}
    />
  );
}

function FinspanPendingBar({
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
