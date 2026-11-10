// Drives AI seats for whichever game is active: when an AI seat must act, ask
// that game's engine (src/games/engines.ts) for a move after a short delay.
// In online games only the host runs AI seats.

import { useEffect } from 'react';
import { getEngine, isEngineLoaded } from '@/games/engines';
import { useGameStore } from '@/store/gameStore';
import { useNetworkStore } from '@/store/networkStore';

const SLOT = { wingspan: 'game', wyrmspan: 'wyrmspanGame', finspan: 'finspanGame' } as const;

export function AIDriver() {
  const activeGameId = useGameStore((s) => s.activeGameId);
  const state = useGameStore((s) => s[SLOT[s.activeGameId]]);
  const aiSpeed = useGameStore((s) => s.aiSpeed);
  const dispatch = useGameStore((s) => s.dispatch);
  const { connection, role } = useNetworkStore();

  useEffect(() => {
    if (connection === 'in-game' && role !== 'host') return;
    if (!state || !isEngineLoaded(activeGameId)) return;
    const engine = getEngine(activeGameId);
    const pid = engine.aiToAct(state as never);
    if (!pid) return;
    const delay = !engine.hasHuman(state as never) || aiSpeed === 'fast' ? 85 : 310;
    const timer = setTimeout(() => {
      const cur = useGameStore.getState()[SLOT[activeGameId]];
      if (!cur || engine.aiToAct(cur as never) !== pid) return;
      const action = engine.chooseAction(cur as never, pid);
      if (action) dispatch(action);
    }, delay);
    return () => clearTimeout(timer);
  }, [activeGameId, state, aiSpeed, connection, role, dispatch]);

  return null;
}
