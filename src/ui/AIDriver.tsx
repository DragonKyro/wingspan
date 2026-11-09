import { useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import { chooseAction as chooseWingspanAction } from '@/wingspan/ai/chooseAction';
import { actingPlayerId, getPlayer as getWingspanPlayer } from '@/wingspan/helpers';
import type { PlayerId } from '@/wingspan/types';
import { chooseAction as chooseWyrmspanAction } from '@/wyrmspan/ai';
import { player as getWyrmspanPlayer } from '@/wyrmspan/helpers';
import { chooseAction as chooseFinspanAction } from '@/finspan/ai/chooseAction';
import { getPlayer as getFinspanPlayer } from '@/finspan/helpers';

function wingspanActorNeeded(
  s: NonNullable<ReturnType<typeof useGameStore.getState>['game']>,
): PlayerId | null {
  if (s.phase === 'gameOver') return null;
  if (s.pending.length > 0) return s.pending[0]!.playerId;
  if (s.phase === 'setup') return s.setupRemaining[0] ?? null;
  if (s.phase === 'roundEnd' || s.phase === 'gameEnd') return null;
  return actingPlayerId(s);
}

export function AIDriver() {
  const activeGameId = useGameStore((s) => s.activeGameId);
  const game = useGameStore((s) => s.game);
  const wyrmspanGame = useGameStore((s) => s.wyrmspanGame);
  const finspanGame = useGameStore((s) => s.finspanGame);
  const aiSpeed = useGameStore((s) => s.aiSpeed);
  const dispatch = useGameStore((s) => s.dispatch);
  const { connection, role } = useNetworkStore();

  useEffect(() => {
    // In online games only the host runs AI seats.
    if (connection === 'in-game' && role !== 'host') return;

    if (activeGameId === 'wingspan' && game) {
      const pid = wingspanActorNeeded(game);
      if (!pid) return;
      const p = getWingspanPlayer(game, pid);
      if (!p.isAI) return;
      const anyHuman = game.players.some((pl) => !pl.isAI);
      const delay = !anyHuman || aiSpeed === 'fast' ? 85 : 310;
      const timer = setTimeout(() => {
        const cur = useGameStore.getState().game;
        if (!cur) return;
        const action = chooseWingspanAction(cur, pid);
        if (action) dispatch(action);
      }, delay);
      return () => clearTimeout(timer);
    }

    if (activeGameId === 'wyrmspan' && wyrmspanGame) {
      if (wyrmspanGame.phase === 'gameEnd') return;
      const pid = wyrmspanGame.pending[0]?.playerId ?? wyrmspanGame.turn;
      if (!pid) return;
      const p = getWyrmspanPlayer(wyrmspanGame, pid);
      if (!p.isAI) return;
      const anyHuman = wyrmspanGame.players.some((pl) => !pl.isAI);
      const delay = !anyHuman || aiSpeed === 'fast' ? 85 : 310;
      const timer = setTimeout(() => {
        const cur = useGameStore.getState().wyrmspanGame;
        if (!cur || cur.phase === 'gameEnd') return;
        const action = chooseWyrmspanAction(cur, pid);
        if (action) dispatch(action);
      }, delay);
      return () => clearTimeout(timer);
    }

    if (activeGameId === 'finspan' && finspanGame) {
      if (finspanGame.phase === 'gameOver') return;
      const pid =
        finspanGame.pending[0]?.playerId ??
        finspanGame.playerOrder[finspanGame.currentPlayerIndex] ??
        null;
      if (!pid) return;
      const p = getFinspanPlayer(finspanGame, pid);
      if (!p.isAI) return;
      const anyHuman = finspanGame.players.some((pl) => !pl.isAI);
      const delay = !anyHuman || aiSpeed === 'fast' ? 85 : 310;
      const timer = setTimeout(() => {
        const cur = useGameStore.getState().finspanGame;
        if (!cur || cur.phase === 'gameOver') return;
        const action = chooseFinspanAction(cur, pid);
        if (action) dispatch(action);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [activeGameId, game, wyrmspanGame, finspanGame, aiSpeed, connection, role, dispatch]);

  return null;
}
