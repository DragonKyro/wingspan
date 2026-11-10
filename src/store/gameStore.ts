import { create } from 'zustand';
import type {
  CreateGameOptions as WingspanOptions,
  GameState as WingspanState,
} from '@/wingspan/types';
import { applyAction as applyWingspan } from '@/wingspan/engine';
import { createGame as createWingspan } from '@/wingspan/createGame';
import type { GameState as WyrmspanState } from '@/wyrmspan/types';
import { applyAction as applyWyrmspan } from '@/wyrmspan/engine';
import { createGame as createWyrmspan, type CreateGameOptions as WyrmspanOptions } from '@/wyrmspan/createGame';
import type {
  CreateGameOptions as FinspanOptions,
  GameState as FinspanState,
} from '@/finspan/types';
import { applyAction as applyFinspan } from '@/finspan/engine';
import { createGame as createFinspan } from '@/finspan/createGame';
import type { AnyAction, GameId } from '@/net/types';

/** Snapshot of whichever game is active, used for online rollbacks and solo undo. */
export interface GameSnapshot {
  gameId: GameId;
  game: WingspanState | null;
  wyrmspanGame: WyrmspanState | null;
  finspanGame: FinspanState | null;
}

let broadcastHandler: ((action: AnyAction, before: GameSnapshot, at: number) => void) | null = null;
export function registerBroadcastHandler(
  fn: ((action: AnyAction, before: GameSnapshot, at: number) => void) | null,
): void {
  broadcastHandler = fn;
}

let dispatchGuard: ((action: AnyAction) => string | null) | null = null;
export function registerDispatchGuard(fn: ((action: AnyAction) => string | null) | null): void {
  dispatchGuard = fn;
}

let isOnlinePredicate: () => boolean = () => false;
export function registerOnlinePredicate(fn: () => boolean): void {
  isOnlinePredicate = fn;
}
export function isOnline(): boolean {
  return isOnlinePredicate();
}

interface AppStore {
  activeGameId: GameId;
  game: WingspanState | null;
  wyrmspanGame: WyrmspanState | null;
  finspanGame: FinspanState | null;
  /** Undo history stack for solo / hot-seat play. */
  undoStack: GameSnapshot[];
  /** Last start options so "Play Again" can start a fresh match with a new seed. */
  lastStart:
    | { gameId: 'wingspan'; options: WingspanOptions }
    | { gameId: 'wyrmspan'; options: WyrmspanOptions }
    | { gameId: 'finspan'; options: FinspanOptions }
    | null;
  error: string | null;
  startedAt: number | null;
  /** AI speed in human games: 'normal' (380ms) or 'fast' (90ms). */
  aiSpeed: 'normal' | 'fast';

  setGameState: (state: WingspanState, startedAt?: number) => void;
  setWyrmspanState: (state: WyrmspanState, startedAt?: number) => void;
  setFinspanState: (state: FinspanState, startedAt?: number) => void;

  startLocalGame: (options: WingspanOptions) => void;
  startLocalWyrmspan: (options: WyrmspanOptions) => void;
  startLocalFinspan: (options: FinspanOptions) => void;
  playAgainLocal: () => void;

  clearGame: () => void;
  dispatch: (action: AnyAction) => void;
  applyLocal: (action: AnyAction, at?: number) => boolean;
  undo: () => void;
  setAiSpeed: (speed: 'normal' | 'fast') => void;
  takeSnapshot: () => GameSnapshot | null;
  restoreSnapshot: (snap: GameSnapshot) => void;
  dismissError: () => void;
}

type AnyState = WingspanState | WyrmspanState | FinspanState;

/** Each game's store slot, reducer and constructor. A slot only ever holds
 *  its own game's state, so the casts at the call sites are safe. */
const SLOT = { wingspan: 'game', wyrmspan: 'wyrmspanGame', finspan: 'finspanGame' } as const;
const APPLY: Record<GameId, (state: never, action: never) => AnyState> = {
  wingspan: applyWingspan,
  wyrmspan: applyWyrmspan,
  finspan: applyFinspan,
};
const CREATE: Record<GameId, (options: never) => AnyState> = {
  wingspan: createWingspan,
  wyrmspan: createWyrmspan,
  finspan: createFinspan,
};

/** Store fields making `gameId` the active game (other slots cleared). */
function activate(gameId: GameId, state: AnyState): Partial<AppStore> {
  return {
      activeGameId: gameId,
      game: null,
      wyrmspanGame: null,
      finspanGame: null,
      [SLOT[gameId]]: state,
      undoStack: [],
      error: null,
    };
  }

  const fromSnap = (snap: GameSnapshot): Partial<AppStore> => ({
    activeGameId: snap.gameId,
    game: snap.game,
    wyrmspanGame: snap.wyrmspanGame,
    finspanGame: snap.finspanGame,
  });

  function currentSnap(s: AppStore): GameSnapshot | null {
    if (!s.game && !s.wyrmspanGame && !s.finspanGame) return null;
    return {
      gameId: s.activeGameId,
      game: s.game,
      wyrmspanGame: s.wyrmspanGame,
      finspanGame: s.finspanGame,
    };
  }

  export const useGameStore = create<AppStore>((set, get) => {
    /** Start a fresh local match (remembered for Play Again). */
    const startLocal = (start: NonNullable<AppStore['lastStart']>) => {
      try {
        const state = CREATE[start.gameId](start.options as never);
        set({ ...activate(start.gameId, state), lastStart: start, startedAt: Date.now() });
      } catch (e) {
        set({ error: (e as Error).message });
      }
    };
    return {
    activeGameId: 'wingspan',
    game: null,
    wyrmspanGame: null,
    finspanGame: null,
    undoStack: [],
    lastStart: null,
    error: null,
    startedAt: null,
    aiSpeed: 'normal',

    setGameState: (state, startedAt) => set({ ...activate('wingspan', state), startedAt: startedAt ?? null }),
    setWyrmspanState: (state, startedAt) => set({ ...activate('wyrmspan', state), startedAt: startedAt ?? null }),
    setFinspanState: (state, startedAt) => set({ ...activate('finspan', state), startedAt: startedAt ?? null }),

    startLocalGame: (options) => startLocal({ gameId: 'wingspan', options }),
    startLocalWyrmspan: (options) => startLocal({ gameId: 'wyrmspan', options }),
    startLocalFinspan: (options) => startLocal({ gameId: 'finspan', options }),

    playAgainLocal: () => {
      const last = get().lastStart;
      if (!last) return;
      const seed = Math.floor(Math.random() * 0xffffffff);
      startLocal({ ...last, options: { ...last.options, seed } } as NonNullable<AppStore['lastStart']>);
    },

    clearGame: () => {
      set({
        game: null,
        wyrmspanGame: null,
        finspanGame: null,
        undoStack: [],
        startedAt: null,
        error: null,
      });
    },

    dispatch: (action) => {
      const s = get();
      const before = currentSnap(s);
      if (!before) return;
      const refused = dispatchGuard?.(action);
      if (refused) {
        set({ error: refused });
        return;
      }
      const at = Date.now();
      try {
        const nextUndo = isOnline() ? [] : [...s.undoStack.slice(-24), before];
        const cur = s[SLOT[s.activeGameId]];
        if (!cur) return;
        const next = APPLY[s.activeGameId](cur as never, action as never);
        set({ [SLOT[s.activeGameId]]: next, undoStack: nextUndo, error: null });
        broadcastHandler?.(action, before, at);
      } catch (e) {
        set({ error: (e as Error).message });
      }
    },

    applyLocal: (action) => {
      const s = get();
      try {
        const cur = s[SLOT[s.activeGameId]];
        if (!cur) return false;
        set({ [SLOT[s.activeGameId]]: APPLY[s.activeGameId](cur as never, action as never) });
        return true;
      } catch (e) {
        console.warn('[gameStore] applyLocal rejected action:', (e as Error).message);
        return false;
      }
    },

    undo: () => {
      if (isOnline()) return;
      const stack = get().undoStack;
      if (stack.length === 0) return;
      const prev = stack[stack.length - 1]!;
      set({ ...fromSnap(prev), undoStack: stack.slice(0, -1), error: null });
    },

    setAiSpeed: (aiSpeed) => set({ aiSpeed }),

    takeSnapshot: () => currentSnap(get()),

    restoreSnapshot: (snap) => set(fromSnap(snap)),

    dismissError: () => set({ error: null }),
  };
});
