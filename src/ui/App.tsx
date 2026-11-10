import { useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import { GAME_TITLES } from '@/store/lobbyGame';
import { roomCodeFromUrl } from '@/net';
import { MenuScreen } from './MenuScreen';
import { LobbyScreen } from './LobbyScreen';
import { GameScreen } from './GameScreen';
import { WyrmspanScreen } from './WyrmspanScreen';
import { FinspanScreen } from './FinspanScreen';
import { AIDriver } from './AIDriver';
import { ArtDefs } from './art/core';

export function App() {
  const activeGameId = useGameStore((s) => s.activeGameId);
  const game = useGameStore((s) => s.game);
  const wyrmspanGame = useGameStore((s) => s.wyrmspanGame);
  const finspanGame = useGameStore((s) => s.finspanGame);
  const clearGame = useGameStore((s) => s.clearGame);
  const connection = useNetworkStore((s) => s.connection);
  const joinRoom = useNetworkStore((s) => s.joinRoom);
  const myDisplayName = useNetworkStore((s) => s.myDisplayName);
  const error = useGameStore((s) => s.error);
  const dismissError = useGameStore((s) => s.dismissError);

  const hasActiveGame = !!(game || wyrmspanGame || finspanGame);

  useEffect(() => {
    const code = roomCodeFromUrl();
    if (code && connection === 'disconnected') {
      void joinRoom(code, myDisplayName);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="app-shell">
      <ArtDefs />
      <header className="app-header">
        <div
          className="brand"
          onClick={() => {
            if (connection === 'disconnected') clearGame();
          }}
          style={{ cursor: connection === 'disconnected' ? 'pointer' : 'default' }}
        >
          <span className="brand-icon">🪶</span>
          <strong>
            {hasActiveGame ? GAME_TITLES[activeGameId].name : 'Span Trilogy'}
          </strong>
          <span className="brand-sub">Wingspan · Wyrmspan · Finspan</span>
        </div>
        <div className="spacer" />
        {error && (
          <button className="error-banner" onClick={dismissError}>
            ⚠ {error} ✕
          </button>
        )}
      </header>
      <main className="screen">
        {activeGameId === 'wingspan' && game ? (
          <GameScreen />
        ) : activeGameId === 'wyrmspan' && wyrmspanGame ? (
          <WyrmspanScreen />
        ) : activeGameId === 'finspan' && finspanGame ? (
          <FinspanScreen />
        ) : connection === 'lobby' || connection === 'in-game' ? (
          <LobbyScreen />
        ) : (
          <MenuScreen />
        )}
        <AIDriver />
      </main>
    </div>
  );
}
