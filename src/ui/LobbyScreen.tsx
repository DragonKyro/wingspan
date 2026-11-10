// Online room lobby supporting Wingspan, Wyrmspan, and Finspan, modeled on
// card-collecting's OnlineLobby.tsx.

import { lazy, Suspense, useEffect, useState } from 'react';
import { useNetworkStore } from '@/store/networkStore';
import {
  GAME_TITLES,
  LOBBY_SETS,
  defaultLobbyGame,
  lobbyGameLabel,
  lobbyStartProblem,
  normalizeLobbyGame,
} from '@/store/lobbyGame';
import { roomLink } from '@/net';
import type { GameId } from '@/net/types';
import { WINGSPAN_SETS as SETS } from '@/games/catalog';
import { ColorSwatchPicker, OptionGroup, Pill } from './MenuScreen';
import { preloadGame } from './screens';

const RulesModal = lazy(() => import('./RulesBook').then((m) => ({ default: m.RulesModal })));

export function LobbyScreen() {
  const {
    lobby,
    role,
    roomCode,
    connection,
    myUuid,
    hostAddAISeat,
    hostRemoveSeat,
    hostSetGame,
    hostStartGame,
    setSeatColor,
    leaveRoom,
    onlineUuids,
    chat,
    sendChat,
  } = useNetworkStore();

  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [showRules, setShowRules] = useState(false);

  const g = normalizeLobbyGame(lobby.game);
  const gameId: GameId = g.gameId ?? 'wingspan';
  // Fetch the room's game chunks while everyone waits in the lobby.
  useEffect(() => preloadGame(gameId), [gameId]);
  const isHost = role === 'host';
  const problem = lobbyStartProblem(lobby);

  const copy = (what: 'code' | 'link') => {
    if (!roomCode) return;
    void navigator.clipboard?.writeText(what === 'code' ? roomCode : roomLink(roomCode));
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  const toggleWingspanSet = (id: string) => {
    const cur = g.sets;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length) hostSetGame({ ...g, sets: next });
  };

  return (
    <div className="lobby-single">
      <div className="lobby-topbar">
        <button type="button" className="secondary" onClick={leaveRoom}>
          ← Leave Room
        </button>
        <button type="button" className="secondary" onClick={() => setShowRules(true)}>
          📖 Rules
        </button>
      </div>

      <section className="lobby-panel">
        <div className="online-lobby-head">
          {isHost ? (
            <div className="pill-group">
              {(['wingspan', 'wyrmspan', 'finspan'] as const).map((gid) => (
                <Pill key={gid} on={gameId === gid} onClick={() => hostSetGame(defaultLobbyGame(gid))}>
                  {GAME_TITLES[gid].name}
                </Pill>
              ))}
            </div>
          ) : (
            <h3>{lobbyGameLabel(g)}</h3>
          )}

          {roomCode && (
            <div className="online-room-box">
              <span className="muted">Room</span>
              <code className="room-code-badge">{roomCode}</code>
              <button type="button" className="secondary" onClick={() => copy('code')}>
                {copied === 'code' ? '✓ Copied' : 'Copy Code'}
              </button>
              <button type="button" className="secondary" onClick={() => copy('link')}>
                {copied === 'link' ? '✓ Copied' : 'Copy Invite Link'}
              </button>
            </div>
          )}
        </div>

        {/* Seats */}
        <h4 className="lobby-section-h">Seats ({lobby.seats.length})</h4>
        <div className="seat-list">
          {lobby.seats.map((seat, i) => {
            const mine = seat.uuid === myUuid;
            const editable = mine || (isHost && seat.isAI);
            const offline = seat.uuid !== null && !onlineUuids.has(seat.uuid);
            return (
              <div key={i} className="seat-row">
                <ColorSwatchPicker
                  value={seat.color}
                  disabled={!editable}
                  onChange={(c) => setSeatColor(i, c)}
                />
                <span className="seat-name" style={{ fontWeight: mine ? 700 : 500 }}>
                  {seat.name}
                </span>
                <div className="row">
                  {mine && <span className="badge">YOU</span>}
                  {i === 0 && <span className="expansion-pill">HOST</span>}
                  {seat.isAI && <span className="expansion-pill">🤖 AI</span>}
                  {offline && <span className="badge" style={{ background: 'var(--danger)', color: '#fff' }}>OFFLINE</span>}
                </div>
                {isHost && i > 0 && (
                  <button
                    type="button"
                    className="secondary seat-remove"
                    onClick={() => hostRemoveSeat(i)}
                    title="Remove seat"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {isHost && lobby.seats.length < 7 && (
          <div style={{ marginTop: 8 }}>
            <button type="button" className="secondary" onClick={hostAddAISeat}>
              + Add AI Seat
            </button>
          </div>
        )}

        {/* Options */}
        <h4 className="lobby-section-h">Options {isHost ? '' : '(set by host)'}</h4>
        {gameId === 'wingspan' && (
          <div className="options-stack">
            <OptionGroup label="Mode:">
              {(['standard', 'duet', 'flock'] as const).map((m) => (
                <Pill
                  key={m}
                  on={(g.mode ?? 'standard') === m}
                  disabled={!isHost}
                  onClick={() => hostSetGame({ ...g, mode: m })}
                >
                  {m === 'standard' ? 'Standard' : m === 'duet' ? 'Asia Duet (2p)' : 'Asia Flock (6–7p)'}
                </Pill>
              ))}
            </OptionGroup>
            <OptionGroup label="Goal Side:">
              <Pill
                on={(g.goalSide ?? 'green') === 'green'}
                disabled={!isHost}
                onClick={() => hostSetGame({ ...g, goalSide: 'green' })}
              >
                🟩 Green (Majority)
              </Pill>
              <Pill
                on={g.goalSide === 'blue'}
                disabled={!isHost}
                onClick={() => hostSetGame({ ...g, goalSide: 'blue' })}
              >
                🟦 Blue (1 pt/item)
              </Pill>
            </OptionGroup>
            <OptionGroup label="Sets:">
              {LOBBY_SETS.filter((s) => (SETS as string[]).includes(s.id)).map((s) => {
                const on = g.sets.includes(s.id);
                return (
                  <Pill key={s.id} on={on} check disabled={!isHost} onClick={() => toggleWingspanSet(s.id)}>
                    {s.label}
                  </Pill>
                );
              })}
            </OptionGroup>
          </div>
        )}

        {gameId === 'wyrmspan' && (
          <div className="options-stack">
            <OptionGroup label="Expansions:">
              <Pill on check disabled>Base Wyrmspan</Pill>
              <Pill
                on={!!g.expansions?.includes('academy')}
                check
                disabled={!isHost}
                onClick={() => {
                  const has = g.expansions?.includes('academy');
                  const expansions: ('base' | 'academy')[] = has ? ['base'] : ['base', 'academy'];
                  hostSetGame({ ...g, sets: expansions, expansions });
                }}
              >
                Dragon Academy
              </Pill>
            </OptionGroup>
          </div>
        )}

        {gameId === 'finspan' && (
          <div className="options-stack">
            <OptionGroup label="Expansions:">
              <Pill on check disabled>Base Finspan</Pill>
              <Pill
                on={g.sets.includes('sr')}
                check
                disabled={!isHost}
                onClick={() => {
                  const has = g.sets.includes('sr');
                  hostSetGame({ ...g, sets: has ? ['base'] : ['base', 'sr'] });
                }}
              >
                Sharks & Reefs
              </Pill>
            </OptionGroup>
            <OptionGroup label="Achievements:">
              <Pill
                on={(g.achievementSide ?? 'A') === 'A'}
                disabled={!isHost}
                onClick={() => hostSetGame({ ...g, achievementSide: 'A' })}
              >
                Side A
              </Pill>
              <Pill
                on={g.achievementSide === 'B'}
                disabled={!isHost}
                onClick={() => hostSetGame({ ...g, achievementSide: 'B' })}
              >
                Side B (+3 Leader Bonus)
              </Pill>
            </OptionGroup>
          </div>
        )}

        <div className="lobby-launch-row">
          {isHost ? (
            <>
              <button
                type="button"
                className="primary btn-lg"
                onClick={() => void hostStartGame()}
                disabled={!!problem}
              >
                ▶ Start Match
              </button>
              {problem && <span className="error">{problem}</span>}
            </>
          ) : (
            <span className="muted">Waiting for the host to start the match…</span>
          )}
          {connection === 'in-game' && <span className="muted">Match starting…</span>}
        </div>

        {/* Chat */}
        <h4 className="lobby-section-h">Room Chat</h4>
        <div className="log" style={{ maxHeight: 140, marginBottom: 8 }}>
          {chat.map((m) => (
            <div key={m.id}>
              <b>{m.senderName}:</b> {m.text}
            </div>
          ))}
        </div>
        <ChatInput onSend={sendChat} />
      </section>

      {showRules && (
        <Suspense fallback={null}>
          <RulesModal gameId={gameId} onClose={() => setShowRules(false)} />
        </Suspense>
      )}
    </div>
  );
}

function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const input = (e.target as HTMLFormElement).elements.namedItem('msg') as HTMLInputElement;
        if (input.value.trim()) onSend(input.value);
        input.value = '';
      }}
    >
      <input name="msg" type="text" style={{ flex: 1 }} placeholder="Send a message…" />
      <button type="submit">Send</button>
    </form>
  );
}
