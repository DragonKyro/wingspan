// Lazy per-game engines. Each game's rules, AI and card data live in their own
// bundle chunk and are fetched only when that game is chosen. The stores and
// the AI driver reach an engine through this registry, never by importing
// `@/wingspan/*`, `@/wyrmspan/*` or `@/finspan/*` code directly (types are fine).
//
//   await loadEngine(id)   — fetch + cache (call before creating a game)
//   getEngine(id)          — synchronous access once loaded (a game state of
//                            that kind can only exist after its engine loaded)

import type { AnyAction, GameId } from '@/net/types';

/** What the app needs from a game engine. Method syntax keeps the per-game
 *  state/action/options types assignable to these erased signatures. */
export interface GameEngine {
  createGame(options: never): unknown;
  applyAction(state: never, action: never): unknown;
  /** The AI seat that must act now, or null (a human must act, or the game is over). */
  aiToAct(state: never): string | null;
  hasHuman(state: never): boolean;
  chooseAction(state: never, playerId: string): AnyAction | null;
}

const LOADERS: Record<GameId, () => Promise<{ engine: GameEngine }>> = {
  wingspan: () => import('./wingspanEngine'),
  wyrmspan: () => import('./wyrmspanEngine'),
  finspan: () => import('./finspanEngine'),
};

const loaded: Partial<Record<GameId, GameEngine>> = {};
const inflight: Partial<Record<GameId, Promise<GameEngine>>> = {};

export function loadEngine(id: GameId): Promise<GameEngine> {
  const ready = loaded[id];
  if (ready) return Promise.resolve(ready);
  return (inflight[id] ??= LOADERS[id]().then(
    (m) => (loaded[id] = m.engine),
    (e: unknown) => {
      delete inflight[id]; // allow a retry after a failed fetch
      throw e;
    },
  ));
}

export function getEngine(id: GameId): GameEngine {
  const e = loaded[id];
  if (!e) throw new Error(`The ${id} engine isn't loaded yet.`);
  return e;
}

export function isEngineLoaded(id: GameId): boolean {
  return !!loaded[id];
}
