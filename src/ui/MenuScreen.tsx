import { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore, warmUpNetwork } from '@/store/networkStore';
import { SETS } from '@/game/cards';
import type { PlayerColor } from '@/game/types';

const COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'purple'];
const OFFICIAL_SETS = ['core', 'european', 'oceania', 'asia', 'americas'];

export function MenuScreen() {
  const startLocalGame = useGameStore((s) => s.startLocalGame);
  const { createRoom, joinRoom, connection, errorMessage, joinFailure, retryJoin, clearError, myDisplayName, setDisplayName } =
    useNetworkStore();
  const [humans, setHumans] = useState(1);
  const [ais, setAis] = useState(1);
  const [sets, setSets] = useState<string[]>(['core']);
  const [joinCode, setJoinCode] = useState('');
  const [name, setName] = useState(myDisplayName);

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
      settings: { sets, goalSide: 'blue' },
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
          <label>Humans:</label>
          <select value={humans} onChange={(e) => setHumans(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <label>AI:</label>
          <select value={ais} onChange={(e) => setAis(Number(e.target.value))}>
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
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
          <button className="primary" onClick={startLocal} disabled={humans + ais < 1 || humans + ais > 5}>
            Start game
          </button>
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
