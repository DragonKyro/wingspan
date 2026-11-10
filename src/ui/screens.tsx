// Game screens are code-split: each one (with its engine, AI and card data)
// loads only when its game is chosen. `preloadGame` starts both fetches early,
// e.g. as soon as a game is picked in the menu, so Start feels instant.

import { lazy } from 'react';
import { loadEngine } from '@/games/engines';
import type { GameId } from '@/net/types';

const SCREENS = {
  wingspan: () => import('./wingspan/GameScreen').then((m) => ({ default: m.GameScreen })),
  wyrmspan: () => import('./wyrmspan/WyrmspanScreen').then((m) => ({ default: m.WyrmspanScreen })),
  finspan: () => import('./finspan/FinspanScreen').then((m) => ({ default: m.FinspanScreen })),
} satisfies Record<GameId, unknown>;

export const WingspanScreen = lazy(SCREENS.wingspan);
export const WyrmspanScreen = lazy(SCREENS.wyrmspan);
export const FinspanScreen = lazy(SCREENS.finspan);

/** Start fetching a game's engine + screen chunks. Errors surface later, on start. */
export function preloadGame(id: GameId): void {
  loadEngine(id).catch(() => {});
  SCREENS[id]().catch(() => {});
}
