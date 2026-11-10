// Game picker + per-game local/online lobby screen, modeled on card-collecting
// (GameLobby.tsx + App.tsx) and catan (HomeMenu.tsx + NewGame.tsx).

import { useState, type CSSProperties, type ReactNode } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore, warmUpNetwork } from '@/store/networkStore';
import { GAME_TITLES, LOBBY_SETS } from '@/store/lobbyGame';
import type { GameId, LobbyGame } from '@/net/types';
import { SETS } from '@/wingspan/cards';
import type { GameMode, PlayerColor } from '@/wingspan/types';
import { RulesModal } from './RulesBook';
import {
  FinspanThumbnail,
  PLAYER_COLOR_HEX,
  WingspanThumbnail,
  WyrmspanThumbnail,
} from './svgArt';

const COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'purple', 'pink', 'teal'];
const OFFICIAL_SETS = ['core', 'european', 'oceania', 'asia', 'americas'];
const PROMO_SETS = ['promoUS', 'promoEurope', 'promoAsia', 'promoNZ', 'promoCA', 'promoUK'];

const MODE_SEATS: Record<GameMode, number[]> = {
  standard: [1, 2, 3, 4, 5],
  duet: [2],
  flock: [6, 7],
};

interface SeatDraft {
  id: string;
  name: string;
  color: PlayerColor;
  isAI: boolean;
}

/** A labelled row of option pills (menu + lobby settings). */
export function OptionGroup({ label, style, children }: { label: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className="option-group" style={style}>
      <span className="option-label">{label}</span>
      <div className="pill-group">{children}</div>
    </div>
  );
}

/** Option pill: highlighted when `on`; `check` adds a ✓ while it's on. */
export function Pill({
  on,
  check,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  check?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={on ? 'primary' : 'secondary'} disabled={disabled} onClick={onClick}>
      {check && on ? '✓ ' : ''}
      {children}
    </button>
  );
}

export function ColorSwatchPicker({
  value,
  onChange,
  disabled,
}: {
  value: PlayerColor;
  onChange: (c: PlayerColor) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        className="swatch-btn"
        style={{ background: PLAYER_COLOR_HEX[value] ?? '#4a90d9' }}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        title={`Color: ${value}`}
        aria-label={`Color: ${value}`}
      />
      {open && !disabled && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 20 }}
          />
          <div className="swatch-popover" onClick={(e) => e.stopPropagation()}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch-option${c === value ? ' active' : ''}`}
                style={{ background: PLAYER_COLOR_HEX[c] }}
                onClick={() => {
                  onChange(c);
                  setOpen(false);
                }}
                title={c}
              />
            ))}
          </div>
        </>
      )}
    </span>
  );
}

export function MenuScreen() {
  const startLocalGame = useGameStore((s) => s.startLocalGame);
  const startLocalWyrmspan = useGameStore((s) => s.startLocalWyrmspan);
  const startLocalFinspan = useGameStore((s) => s.startLocalFinspan);
  const {
    createRoom,
    joinRoom,
    connection,
    errorMessage,
    joinFailure,
    retryJoin,
    clearError,
    myDisplayName,
    setDisplayName,
  } = useNetworkStore();

  const [selectedGame, setSelectedGame] = useState<GameId | null>(null);
  const [rulesGame, setRulesGame] = useState<GameId | null>(null);
  const [seats, setSeats] = useState<SeatDraft[]>([
    { id: 's1', name: 'Player 1', color: 'red', isAI: false },
    { id: 's2', name: 'AI 1', color: 'blue', isAI: true },
  ]);

  // Wingspan options
  const [sets, setSets] = useState<string[]>(['core', 'european', 'oceania', 'asia', 'americas']);
  const [mode, setMode] = useState<GameMode>('standard');
  const [goalSide, setGoalSide] = useState<'green' | 'blue'>('green');

  // Wyrmspan options
  const [wyrmAcademy, setWyrmAcademy] = useState(true);

  // Finspan options
  const [finSr, setFinSr] = useState(true);
  const [finSide, setFinSide] = useState<'A' | 'B'>('A');

  // Official Automa Solo Mode options
  const [automaOn, setAutomaOn] = useState(false);
  const [wingAutomaDiff, setWingAutomaDiff] = useState<'eaglet' | 'eagle' | 'eagleEyed'>('eagle');
  const [wingAutomubon, setWingAutomubon] = useState(false);
  const [wingHoard, setWingHoard] = useState(false);
  const [wyrmAutomaDiff, setWyrmAutomaDiff] = useState<1 | 2 | 3>(2);
  const [wyrmRavel, setWyrmRavel] = useState(false);
  const [finAutomaDiff, setFinAutomaDiff] = useState<1 | 2 | 3 | 4 | 5>(2);
  const [finRavel, setFinRavel] = useState(false);
  const [finRavelStrength, setFinRavelStrength] = useState<2 | 3 | 4>(2);

  // Online join / host
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState(myDisplayName);

  const activeGameId = selectedGame ?? 'wingspan';
  const maxPlayers =
    activeGameId === 'wingspan'
      ? mode === 'flock'
        ? 7
        : mode === 'duet'
          ? 2
          : 5
      : 5;
  const minPlayers = activeGameId === 'wingspan' && mode === 'flock' ? 6 : activeGameId === 'wingspan' && mode === 'duet' ? 2 : 1;

  const seatsOk = automaOn
    ? true
    : activeGameId === 'wingspan'
      ? MODE_SEATS[mode].includes(seats.length)
      : seats.length >= 1 && seats.length <= 5;

  const addSeat = () => {
    if (seats.length >= 7) return;
    const used = new Set(seats.map((s) => s.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[seats.length % COLORS.length]!;
    const aiCount = seats.filter((s) => s.isAI).length;
    setSeats([
      ...seats,
      {
        id: `s-${Date.now()}-${seats.length}`,
        name: `AI ${aiCount + 1}`,
        color,
        isAI: true,
      },
    ]);
  };

  const removeSeat = (id: string) => {
    if (seats.length <= 1) return;
    setSeats(seats.filter((s) => s.id !== id));
  };

  const updateSeat = (id: string, patch: Partial<SeatDraft>) => {
    setSeats(seats.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const changeMode = (nextMode: GameMode) => {
    setMode(nextMode);
    if (nextMode === 'duet' && seats.length !== 2) {
      setSeats([
        seats[0] ?? { id: 's1', name: 'Player 1', color: 'red', isAI: false },
        seats[1] ?? { id: 's2', name: 'AI 1', color: 'blue', isAI: true },
      ]);
    } else if (nextMode === 'flock' && seats.length < 6) {
      const next = seats.slice();
      while (next.length < 6) {
        const idx = next.length;
        next.push({
          id: `s-flock-${idx}`,
          name: `AI ${idx}`,
          color: COLORS[idx % COLORS.length]!,
          isAI: true,
        });
      }
      setSeats(next);
    } else if (nextMode === 'standard' && seats.length > 5) {
      setSeats(seats.slice(0, 5));
    }
  };

  const toggleSet = (id: string) => {
    setSets((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return next.length ? next : cur;
    });
  };

  const startLocal = () => {
    const seed = Math.floor(Math.random() * 0xffffffff);
    const first = seats[0] ?? { id: 's1', name: 'Player 1', color: 'red' as const, isAI: false };
    if (activeGameId === 'wyrmspan') {
      if (automaOn) {
        startLocalWyrmspan({
          seed,
          playerNames: [first.name.trim() || 'Player 1'],
          isAI: [first.isAI],
          expansions: wyrmAcademy ? ['base', 'academy'] : ['base'],
          automa: { difficulty: wyrmAutomaDiff, ravelMode: wyrmRavel },
        });
        return;
      }
      startLocalWyrmspan({
        seed,
        playerNames: seats.map((s) => s.name.trim() || 'Player'),
        isAI: seats.map((s) => s.isAI),
        expansions: wyrmAcademy ? ['base', 'academy'] : ['base'],
      });
      return;
    }
    if (activeGameId === 'finspan') {
      if (automaOn) {
        startLocalFinspan({
          seed,
          playerNames: [first.name.trim() || 'Player 1'],
          playerTypes: [first.isAI ? 'ai' : 'human'],
          playerColors: [first.color],
          settings: {
            sets: finSr ? ['base', 'sr'] : ['base'],
            achievementSide: finSide,
            automa: {
              difficulty: finAutomaDiff,
              ravelMode: finRavel,
              ravelStrength: finRavelStrength,
            },
          },
        });
        return;
      }
      startLocalFinspan({
        seed,
        playerNames: seats.map((s) => s.name.trim() || 'Player'),
        playerTypes: seats.map((s) => (s.isAI ? 'ai' : 'human')),
        playerColors: seats.map((s) => s.color),
        settings: {
          sets: finSr ? ['base', 'sr'] : ['base'],
          achievementSide: finSide,
        },
      });
      return;
    }
    if (automaOn) {
      startLocalGame({
        playerNames: [first.name.trim() || 'Player 1'],
        playerTypes: [first.isAI ? 'ai' : 'human'],
        playerColors: [first.color],
        seed,
        settings: {
          sets,
          goalSide,
          mode: mode === 'flock' ? 'standard' : mode,
          automa: {
            difficulty: wingAutomaDiff,
            automubonSociety: wingAutomubon,
            hoard: wingHoard,
          },
        },
      });
      return;
    }
    startLocalGame({
      playerNames: seats.map((s) => s.name.trim() || 'Player'),
      playerTypes: seats.map((s) => (s.isAI ? 'ai' : 'human')),
      playerColors: seats.map((s) => s.color),
      seed,
      settings: { sets, goalSide, mode },
    });
  };

  const buildLobbyGame = (): LobbyGame => {
    if (activeGameId === 'wyrmspan') {
      const expansions: ('base' | 'academy')[] = wyrmAcademy ? ['base', 'academy'] : ['base'];
      return { gameId: 'wyrmspan', sets: expansions, expansions };
    }
    if (activeGameId === 'finspan') {
      return {
        gameId: 'finspan',
        sets: finSr ? ['base', 'sr'] : ['base'],
        achievementSide: finSide,
      };
    }
    return { gameId: 'wingspan', sets, mode, goalSide };
  };

  return (
    <div className="picker-wrap">
      {/* Online room bar at top (like card-collecting's JoinRoomBox) */}
      <div className="join-room-bar" onFocus={warmUpNetwork} onPointerEnter={warmUpNetwork}>
        <div className="join-room-title">
          <strong>🌐 Online Multiplayer</strong>
          <span className="muted">Join a friend&apos;s room code or host a room from any game below</span>
        </div>
        <div className="row">
          <input
            type="text"
            placeholder="Your name"
            value={name}
            maxLength={24}
            onChange={(e) => {
              setName(e.target.value);
              setDisplayName(e.target.value);
            }}
            style={{ width: 140 }}
          />
          <input
            type="text"
            placeholder="Room code"
            value={joinCode}
            maxLength={6}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            style={{ width: 110, textTransform: 'uppercase', letterSpacing: '0.08em' }}
          />
          <button
            className="primary"
            onClick={() => void joinRoom(joinCode, name)}
            disabled={joinCode.trim().length < 3 || connection === 'connecting'}
          >
            {connection === 'connecting' ? 'Joining…' : 'Join Room'}
          </button>
          <button
            className="secondary"
            onClick={() => void createRoom(name, buildLobbyGame())}
            disabled={!name.trim() || connection === 'connecting'}
          >
            Host Room
          </button>
        </div>
        {errorMessage && (
          <div className="error row" style={{ width: '100%', marginTop: 4 }}>
            <span>{errorMessage}</span>
            {joinFailure && <button onClick={retryJoin}>Retry</button>}
            <button onClick={clearError}>Dismiss</button>
          </div>
        )}
      </div>

      {/* 3-Game Picker Cards (Wingspan, Wyrmspan, Finspan) */}
      {selectedGame === null ? (
        <div className="game-list">
          {(
            [
              {
                id: 'wingspan' as const,
                badge: '1–7p · +4 Expansions',
                tags: ['Base', 'European', 'Oceania', 'Asia Duet & Flock', 'Americas'],
                Thumb: WingspanThumbnail,
              },
              {
                id: 'wyrmspan' as const,
                badge: '1–5p · +Dragon Academy',
                tags: ['Base Caverns', 'Dragon Guilds', 'Dragon Academy', 'Fledglings'],
                Thumb: WyrmspanThumbnail,
              },
              {
                id: 'finspan' as const,
                badge: '1–5p · +Sharks & Reefs',
                tags: ['Base Ocean', 'Schools & Diving', 'Sharks & Reefs', 'Coral'],
                Thumb: FinspanThumbnail,
              },
            ] as const
          ).map(({ id, badge, tags, Thumb }) => {
            const meta = GAME_TITLES[id];
            return (
              <div
                key={id}
                className="game-card"
                onClick={() => {
                  setSelectedGame(id);
                  if (id !== 'wingspan' && seats.length > 5) {
                    setSeats(seats.slice(0, 5));
                  }
                }}
              >
                <div className="game-card-art">
                  <Thumb />
                </div>
                <div className="game-card-body">
                  <div className="game-card-meta">
                    <h2>{meta.name}</h2>
                    <span className="player-range">{badge}</span>
                  </div>
                  <p className="game-card-desc">{meta.subtitle}</p>
                  <div className="game-card-tags">
                    {tags.map((t) => (
                      <span key={t} className="expansion-pill">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="game-card-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => setSelectedGame(id)}
                    >
                      Configure & Play →
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setRulesGame(id)}
                    >
                      📖 Rulebook
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Single-Game Lobby Panel (modeled on card-collecting's GameLobby.tsx) */
        <div className="lobby-single">
          <div className="lobby-topbar">
            <button type="button" className="secondary" onClick={() => setSelectedGame(null)}>
              ← All Games
            </button>
            <div className="lobby-game-tabs">
              {(['wingspan', 'wyrmspan', 'finspan'] as const).map((gid) => (
                <button
                  key={gid}
                  type="button"
                  className={`lobby-game-tab${selectedGame === gid ? ' active' : ''}`}
                  onClick={() => {
                    setSelectedGame(gid);
                    if (gid !== 'wingspan' && seats.length > 5) setSeats(seats.slice(0, 5));
                  }}
                >
                  {GAME_TITLES[gid].name}
                </button>
              ))}
            </div>
            <button type="button" className="secondary" onClick={() => setRulesGame(selectedGame)}>
              📖 Rules
            </button>
          </div>

          <section className="lobby-panel">
            <div className="lobby-panel-header">
              <div>
                <h2>{GAME_TITLES[selectedGame].name}</h2>
                <p className="muted" style={{ margin: '2px 0 0' }}>
                  {GAME_TITLES[selectedGame].subtitle}
                </p>
              </div>
              <span className="player-range">
                {minPlayers === maxPlayers ? `${minPlayers} players` : `${minPlayers}–${maxPlayers} players`}
              </span>
            </div>

            {/* Seats section */}
            <h4 className="lobby-section-h">Seats ({seats.length})</h4>
            <div className="seat-list">
              {seats.map((s) => (
                <div key={s.id} className="seat-row">
                  <ColorSwatchPicker
                    value={s.color}
                    onChange={(color) => updateSeat(s.id, { color })}
                  />
                  <input
                    type="text"
                    className="seat-name"
                    value={s.name}
                    maxLength={24}
                    onChange={(e) => updateSeat(s.id, { name: e.target.value })}
                  />
                  <div className="seat-type-toggle" role="group" aria-label="Seat type">
                    <button
                      type="button"
                      className={!s.isAI ? 'active' : 'secondary'}
                      onClick={() => updateSeat(s.id, { isAI: false })}
                    >
                      👤 Human
                    </button>
                    <button
                      type="button"
                      className={s.isAI ? 'active' : 'secondary'}
                      onClick={() => updateSeat(s.id, { isAI: true })}
                    >
                      🤖 AI
                    </button>
                  </div>
                  <button
                    type="button"
                    className="secondary seat-remove"
                    onClick={() => removeSeat(s.id)}
                    disabled={seats.length <= 1}
                    title="Remove seat"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button
                type="button"
                className="secondary"
                onClick={addSeat}
                disabled={seats.length >= maxPlayers}
              >
                + Add Seat
              </button>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Hot-seat humans share this screen; AI seats play automatically.
              </span>
            </div>

            {/* Game-specific options */}
            <h4 className="lobby-section-h">Solo Automa & Game Options</h4>
            <OptionGroup label="Solo Mode:" style={{ marginBottom: 10 }}>
              <Pill on={!automaOn} onClick={() => setAutomaOn(false)}>👥 Multiplayer / Standard AI Bots</Pill>
              <Pill on={automaOn} onClick={() => setAutomaOn(true)}>
                ⚙️ Official Automa Solo Deck (1p vs Automa)
              </Pill>
            </OptionGroup>

            {automaOn && selectedGame === 'wingspan' && (
              <div className="options-stack" style={{ marginBottom: 10 }}>
                <OptionGroup label="Automa Level:">
                  {(
                    [
                      { id: 'eaglet', label: 'Eaglet (3 pt / face-down bird)' },
                      { id: 'eagle', label: 'Eagle — Normal (4 pt)' },
                      { id: 'eagleEyed', label: 'Eagle-eyed Eagle (5 pt)' },
                    ] as const
                  ).map((d) => (
                    <Pill key={d.id} on={wingAutomaDiff === d.id} onClick={() => setWingAutomaDiff(d.id)}>
                      {d.label}
                    </Pill>
                  ))}
                  <Pill on={wingAutomubon} check onClick={() => setWingAutomubon((v) => !v)}>
                    Automubon Society Card
                  </Pill>
                  <Pill on={wingHoard} check onClick={() => setWingHoard((v) => !v)}>
                    Automa&apos;s Hoard
                  </Pill>
                </OptionGroup>
              </div>
            )}

            {automaOn && selectedGame === 'wyrmspan' && (
              <div className="options-stack" style={{ marginBottom: 10 }}>
                <OptionGroup label="Automa Level:">
                  {([1, 2, 3] as const).map((lv) => (
                    <Pill key={lv} on={wyrmAutomaDiff === lv} onClick={() => setWyrmAutomaDiff(lv)}>
                      Level {lv} {lv === 3 && !wyrmRavel ? '(8 VP/dragon)' : ''}
                    </Pill>
                  ))}
                  <Pill on={wyrmRavel} check onClick={() => setWyrmRavel((v) => !v)}>Ravel Mode Variant</Pill>
                </OptionGroup>
              </div>
            )}

            {automaOn && selectedGame === 'finspan' && (
              <div className="options-stack" style={{ marginBottom: 10 }}>
                <OptionGroup label="Nautoma Diff:">
                  {([1, 2, 3, 4, 5] as const).map((lv) => (
                    <Pill key={lv} on={finAutomaDiff === lv} onClick={() => setFinAutomaDiff(lv)}>
                      ⭐ {lv} {lv <= 3 && lv >= 2 ? '(Calm)' : lv >= 4 ? '(Stormy)' : '(No Ach)'}
                    </Pill>
                  ))}
                  <Pill on={finRavel} check onClick={() => setFinRavel((v) => !v)}>Ravel Mode</Pill>
                  {finRavel &&
                    ([2, 3, 4] as const).map((st) => (
                      <Pill key={st} on={finRavelStrength === st} onClick={() => setFinRavelStrength(st)}>
                        X={st}
                      </Pill>
                    ))}
                </OptionGroup>
              </div>
            )}

            {selectedGame === 'wingspan' && (
              <div className="options-stack">
                <OptionGroup label="Mode:">
                  {(
                    [
                      { id: 'standard', label: 'Standard (1–5p)' },
                      { id: 'duet', label: 'Asia Duet Map (2p)' },
                      { id: 'flock', label: 'Asia Flock Mode (6–7p)' },
                    ] as const
                  ).map((m) => (
                    <Pill key={m.id} on={mode === m.id} onClick={() => changeMode(m.id)}>{m.label}</Pill>
                  ))}
                </OptionGroup>

                <OptionGroup label="Goal Board:">
                  <Pill on={goalSide === 'green'} onClick={() => setGoalSide('green')}>
                    🟩 Green (Ranked Majority: 4/1 → 7/4/3)
                  </Pill>
                  <Pill on={goalSide === 'blue'} onClick={() => setGoalSide('blue')}>
                    🟦 Blue (1 pt per item, max 5)
                  </Pill>
                </OptionGroup>

                <OptionGroup label="Card Sets:">
                  {OFFICIAL_SETS.filter((s) => (SETS as string[]).includes(s)).map((id) => {
                    const lbl = LOBBY_SETS.find((x) => x.id === id)?.label ?? id;
                    const on = sets.includes(id);
                    return (
                      <Pill key={id} on={on} check onClick={() => toggleSet(id)}>
                        {lbl}
                      </Pill>
                    );
                  })}
                  <Pill
                    on={PROMO_SETS.every((p) => sets.includes(p))}
                    check
                    onClick={() => {
                      const allOn = PROMO_SETS.every((p) => sets.includes(p));
                      if (allOn) {
                        const filtered = sets.filter((s) => !PROMO_SETS.includes(s));
                        setSets(filtered.length ? filtered : ['core']);
                      } else {
                        setSets([...new Set([...sets, ...PROMO_SETS])]);
                      }
                    }}
                  >
                    Promo Packs
                  </Pill>
                </OptionGroup>
              </div>
            )}

            {selectedGame === 'wyrmspan' && (
              <div className="options-stack">
                <OptionGroup label="Expansions:">
                  <Pill on check disabled>Base Wyrmspan</Pill>
                  <Pill on={wyrmAcademy} check onClick={() => setWyrmAcademy((v) => !v)}>
                    Dragon Academy (Fledglings, Pass Income & New Guilds)
                  </Pill>
                </OptionGroup>
              </div>
            )}

            {selectedGame === 'finspan' && (
              <div className="options-stack">
                <OptionGroup label="Expansions:">
                  <Pill on check disabled>Base Finspan</Pill>
                  <Pill on={finSr} check onClick={() => setFinSr((v) => !v)}>
                    Sharks & Reefs (Coral Reefs, Sharks & S&R Tiles)
                  </Pill>
                </OptionGroup>
                <OptionGroup label="Achievement Board:">
                  <Pill on={finSide === 'A'} onClick={() => setFinSide('A')}>
                    Side A (Fixed Weekly Achievements)
                  </Pill>
                  <Pill on={finSide === 'B'} onClick={() => setFinSide('B')}>
                    Side B (Random Tiles + 3 VP Weekly Leader Bonus)
                  </Pill>
                </OptionGroup>
              </div>
            )}

            {/* Launch bar */}
            <div className="lobby-launch-row">
              <button
                type="button"
                className="primary btn-lg"
                onClick={startLocal}
                disabled={!seatsOk}
              >
                ▶ Start {GAME_TITLES[selectedGame].name}
              </button>
              <button
                type="button"
                className="secondary btn-lg"
                onClick={() => void createRoom(name || 'Host', buildLobbyGame())}
                disabled={connection === 'connecting'}
              >
                🌐 Host Online Room
              </button>
              {!seatsOk && (
                <span className="error">
                  {mode === 'duet'
                    ? 'Duet Mode requires exactly 2 seats.'
                    : mode === 'flock'
                      ? 'Flock Mode requires 6–7 seats.'
                      : 'Requires 1–5 seats.'}
                </span>
              )}
            </div>
          </section>
        </div>
      )}

      {rulesGame && <RulesModal gameId={rulesGame} onClose={() => setRulesGame(null)} />}
    </div>
  );
}
