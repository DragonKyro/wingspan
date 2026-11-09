import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore, warmUpNetwork } from '@/store/networkStore';
import { SETS } from '@/wingspan/cards';
import type { GameMode, PlayerColor } from '@/wingspan/types';

const COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'purple', 'pink', 'teal'];
const OFFICIAL_SETS = ['core', 'european', 'oceania', 'asia', 'americas'];

/** Valid total seat counts per mode (asia duet = 2, flock = 6-7). */
const MODE_SEATS: Record<GameMode, number[]> = {
  standard: [1, 2, 3, 4, 5],
  duet: [2],
  flock: [6, 7],
};

export function MenuScreen() {
  const startLocalGame = useGameStore((s) => s.startLocalGame);
  const { createRoom, joinRoom, connection, errorMessage, joinFailure, retryJoin, clearError, myDisplayName, setDisplayName } =
    useNetworkStore();
  const [humans, setHumans] = useState(1);
  const [ais, setAis] = useState(1);
  const [sets, setSets] = useState<string[]>(['core']);
  const [mode, setMode] = useState<GameMode>('standard');
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState(myDisplayName);

  const seatsOk = MODE_SEATS[mode].includes(humans + ais);

  const startLocal = () => {
    const names = [...Array.from({ length: humans }, (_, i) => `Player ${i + 1}`), ...Array.from({ length: ais }, (_, i) => `AI ${i + 1}`)];
    const types: ('human' | 'ai')[] = [
      ...Array.from({ length: humans }, () => 'human' as const),
      ...Array.from({ length: ais }, () => 'ai' as const),
    ];
    startLocalGame({
      playerNames: names,
      playerTypes: types,
      playerColors: COLORS.slice(0, names.length),
      seed: Math.floor(Math.random() * 0xffffffff),
      settings: { sets, goalSide: 'green', mode },
    });
  };

  const toggleSet = (id: string) => {
    setSets((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return next.length ? next : cur;
    });
  };

  return (
    <div className="menu">
      <div className="card">
        <h2>New local game</h2>
        <div className="row">
          <label>Mode:</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as GameMode)}>
            <option value="standard">Standard (1-5)</option>
            <option value="duet">Asia Duet (2)</option>
            <option value="flock">Asia Flock (6-7)</option>
          </select>
          <label>Humans:</label>
          <select value={humans} onChange={(e) => setHumans(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <label>AI:</label>
          <select value={ais} onChange={(e) => setAis(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="row">
          <label>Sets:</label>
          {OFFICIAL_SETS.filter((s) => (SETS as string[]).includes(s)).map((id) => (
            <label key={id}>
              <input type="checkbox" checked={sets.includes(id)} onChange={() => toggleSet(id)} /> {id}
            </label>
          ))}
        </div>
        <div>
          <button className="primary" onClick={startLocal} disabled={!seatsOk}>
            Start game
          </button>
          {!seatsOk && (
            <span className="muted" style={{ fontSize: '0.8rem', marginLeft: 8 }}>
              {mode === 'duet'
                ? 'Duet needs exactly 2 players.'
                : mode === 'flock'
                  ? 'Flock needs 6-7 players.'
                  : 'Standard needs 1-5 players.'}
            </span>
          )}
        </div>
        <div className="muted" style={{ fontSize: '0.8rem' }}>
          Hot-seat: humans share this device; AI seats play themselves.
        </div>
      </div>

      <div className="card" onFocus={warmUpNetwork}>
        <h2>Play online</h2>
        <div className="row">
          <label>Name:</label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDisplayName(e.target.value);
            }}
          />
        </div>
        <div className="row">
          <button className="primary" onClick={() => void createRoom(name)} disabled={connection === 'connecting'}>
            Create room
          </button>
          <input
            type="text"
            placeholder="Room code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            style={{ width: 110 }}
          />
          <button onClick={() => void joinRoom(joinCode, name)} disabled={joinCode.length < 3 || connection === 'connecting'}>
            Join
          </button>
        </div>
        {connection === 'connecting' && <div className="muted">Connecting…</div>}
        {errorMessage && (
          <div className="error">
            {errorMessage}{' '}
            {joinFailure && <button onClick={retryJoin}>Retry</button>}
            <button onClick={clearError}>Dismiss</button>
          </div>
        )}
      </div>
    </div>
  );
}
