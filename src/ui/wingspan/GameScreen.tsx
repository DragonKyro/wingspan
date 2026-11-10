// Wingspan game screen: top bar, layout and game-over card. Lazy-loaded with
// the Wingspan engine chunk (see src/games/engines.ts).

import { useState } from 'react';
import { bonusCard, goalTile } from '@/wingspan/cards';
import { actingPlayerId, getPlayer, isOceania } from '@/wingspan/helpers';
import { scorePlayer } from '@/wingspan/scoring';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import type { GameState, PlayerId, ScoreBreakdown } from '@/wingspan/types';
import { ActionToastBanner, FlipProvider } from '../fx';
import { GameOverModal } from '../MatchCharts';
import { RulesModal } from '../RulesBook';
import {
  ActionCubeSvg,
  EggTokenSvg,
  FoodIcon,
  playerColorHex,
  renderWingspanText,
  TokenIcon,
} from '../svgArt';
import type { Draft } from './draft';
import { CommonRow, DuetMapPanel } from './CommonBoard';
import { PlayerMatView } from './PlayerMat';
import { HandArea } from './HandArea';
import { ActionsPanel } from './ActionsPanel';
import { PendingBar } from './PendingBar';

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
  const [sideTab, setSideTab] = useState<'play' | 'log'>('play');

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
                    <ActionCubeSvg color={p.color} size={12} />×{p.actionCubes} · {live}
                    <TokenIcon kind="feather" size={12} />
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

        <div className="side-column">
          <ActionsPanel
            game={game}
            draft={draft}
            setDraft={setDraft}
            canAct={canAct}
            dispatch={dispatch}
          />

          <div className="card">
            <div className="side-tabs-bar">
              <button
                type="button"
                className={`side-tab-btn${sideTab === 'play' ? ' active' : ''}`}
                onClick={() => setSideTab('play')}
              >
                🏆 Standings {game.automa ? '& Automa' : ''}
              </button>
              <button
                type="button"
                className={`side-tab-btn${sideTab === 'log' ? ' active' : ''}`}
                onClick={() => setSideTab('log')}
              >
                Log ({game.log.length})
              </button>
            </div>

            {sideTab === 'play' ? (
              <>
                {game.automa && (
                  <div style={{ marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                    <h3>⚙️ Automa Solo Deck ({game.automa.difficulty})</h3>
                    <div className="stat-pills">
                      <span className="stat-pill">
                        <TokenIcon kind="bonus" size={13} /> Bonus: <b>{bonusCard(game.automa.bonusCardId).name}</b>
                      </span>
                      <span className="stat-pill">
                        🃏 Deck: <b>{game.automa.deck.length}</b> (Last: #{game.automa.lastCardId ?? '—'})
                      </span>
                      <span className="stat-pill">
                        <ActionCubeSvg color="#9aa0a6" size={12} /> Goal cubes: <b>{game.automa.goalCubes}</b>
                      </span>
                      <span className="stat-pill">
                        <TokenIcon kind="card" size={13} /> Face-up birds: <b>{game.automa.faceUpBirds.length}</b> · Face-Down:{' '}
                        <b>{game.automa.faceDownBirds}</b>
                      </span>
                      <span className="stat-pill">
                        <EggTokenSvg index={0} size={12} /> Eggs: <b>{game.automa.eggs}</b>
                      </span>
                      {game.automa.hoardTokens > 0 && (
                        <span className="stat-pill">
                          <FoodIcon food="any" size={12} /> Hoard: <b>{game.automa.hoardTokens}</b>
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {game.playerOrder.map((pid) => {
                  const p = getPlayer(game, pid);
                  const sc = scorePlayer(game, p);
                  return (
                    <div key={pid} className="standing-row">
                      <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
                      <b>{p.name}</b>
                      <span className="spacer" />
                      <span className="muted" style={{ fontSize: '0.73rem' }}>
                        <span title="Bird card points"><TokenIcon kind="bird" size={12} />{sc.birdPoints}</span> ·{' '}
                        <span title="Eggs"><EggTokenSvg index={0} size={11} />{sc.eggs}</span> ·{' '}
                        <span title="Bonus cards"><TokenIcon kind="bonus" size={12} />{sc.bonusPoints}</span> ·{' '}
                        <span title="Round goals">goals {sc.goalPoints}</span>
                      </span>
                      <b className="badge">{sc.total} VP</b>
                    </div>
                  );
                })}
              </>
            ) : (
              <div className="log">
                {game.log.slice(-60).map((e) => (
                  <div key={e.seq}>{e.msg}</div>
                ))}
              </div>
            )}
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

function GameOverCard({
  game,
  onPlayAgain,
  onMenu,
}: {
  game: GameState;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const scores = game.finalScores ?? {};
  const pts = (k: Exclude<keyof ScoreBreakdown, 'total'>) => (pid: PlayerId) => scores[pid]?.[k] ?? 0;
  return (
    <GameOverModal
      title="Wingspan"
      winners={(game.winner ?? []).map((pid) => getPlayer(game, pid).name).join(', ')}
      players={game.playerOrder.map((pid) => ({ id: pid, name: getPlayer(game, pid).name }))}
      parts={[
        ['birds', 'Birds', '#4a7c59', pts('birdPoints')],
        ['bonus', 'Bonus Cards', '#e0a458', pts('bonusPoints')],
        ['goals', 'Round Goals', '#4f8ba9', pts('goalPoints')],
        ['eggs', 'Eggs', '#bfe0e8', pts('eggs')],
        ['cached', 'Cached Food', '#c44569', pts('cached')],
        ['tucked', 'Tucked Cards', '#9a6ad0', pts('tucked')],
        ['nectar', 'Nectar Majority', '#e06397', pts('nectar')],
        ['duet', 'Duet / Hummingbirds', '#52b788', (pid) => pts('duetTokens')(pid) + pts('hummingbirds')(pid)],
      ]}
      onPlayAgain={onPlayAgain}
      onMenu={onMenu}
    />
  );
}
