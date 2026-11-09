import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import { MenuScreen } from './MenuScreen';
import { LobbyScreen } from './LobbyScreen';
import { GameScreen } from './GameScreen';
import { AIDriver } from './AIDriver';
import { roomCodeFromUrl } from '@/net';
import { useEffect } from 'react';

export function App() {
  const game = useGameStore((s) => s.game);
  const connection = useNetworkStore((s) => s.connection);
  const joinRoom = useNetworkStore((s) => s.joinRoom);
  const myDisplayName = useNetworkStore((s) => s.myDisplayName);
  const error = useGameStore((s) => s.error);
  const dismissError = useGameStore((s) => s.dismissError);

  // A ?room=CODE link on load joins the room directly.
  useEffect(() => {
    const code = roomCodeFromUrl();
    if (code && connection === 'disconnected') {
      void joinRoom(code, myDisplayName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="screen">
      <div className="row">
        <h1>Wingspan</h1>
        <div className="spacer" />
        {error && (
          <button className="error" onClick={dismissError}>
            {error} ✕
          </button>
        )}
      </div>
      {game ? (
        <GameScreen />
      ) : connection === 'lobby' || connection === 'in-game' ? (
        <LobbyScreen />
      ) : (
        <MenuScreen />
      )}
      <AIDriver />
    </div>
  );
}
