import { useEffect } from 'react';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';
import { chooseAction } from '@/wingspan/ai/chooseAction';
import { actingPlayerId, getPlayer } from '@/wingspan/helpers';
import type { PlayerId } from '@/wingspan/types';

/** Who the game is waiting on right now. */
function actorNeeded(s: NonNullable<ReturnType<typeof useGameStore.getState>['game']>): PlayerId | null {
  if (s.phase === 'gameOver' || s.phase === 'gameEnd') return null;
  const head = s.pending[0];
  if (head) return head.playerId;
  if (s.phase === 'roundEnd') return null; // queue drains automatically
  if (s.phase === 'setup') return s.setupRemaining[0] ?? null;
  return actingPlayerId(s);
}

/** Runs AI seats: when the game waits on an AI player, feed it chooseAction
 *  results until a human (or the game over screen) is reached. */
export function AIDriver() {
  const game = useGameStore((s) => s.game);
  const dispatch = useGameStore((s) => s.dispatch);
  const role = useNetworkStore((s) => s.role);
  const connection = useNetworkStore((s) => s.connection);

  useEffect(() => {
    if (!game) return;
    const pid = actorNeeded(game);
    if (!pid) return;
    const player = getPlayer(game, pid);
    if (!player.isAI) return;
    // Offline: this device drives every AI. Online: the host drives AI seats.
    const online = connection === 'in-game';
    if (online && role !== 'host') return;
    const action = chooseAction(game, pid);
    if (!action) return;
    const t = setTimeout(() => dispatch(action), 250);
    return () => clearTimeout(t);
  }, [game, dispatch, role, connection]);

  return null;
}
