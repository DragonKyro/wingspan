import { create } from 'zustand';
import type { Action as WingspanAction, CreateGameOptions as WingspanOptions, GameState as WingspanState } from '@/wingspan/types';
import { applyAction as applyWingspan } from '@/wingspan/engine';
import { createGame as createWingspan } from '@/wingspan/createGame';
import type { Action as WyrmspanAction, GameState as WyrmspanState } from '@/wyrmspan/types';
import { applyAction as applyWyrmspan } from '@/wyrmspan/engine';
import { createGame as createWyrmspan, type CreateGameOptions as WyrmspanOptions } from '@/wyrmspan/createGame';
import type { Action as FinspanAction, CreateGameOptions as FinspanOptions, GameState as FinspanState } from '@/finspan/types';
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

function currentSnap(s: AppStore): GameSnapshot | null {
  if (!s.game && !s.wyrmspanGame && !s.finspanGame) return null;
  return {
    gameId: s.activeGameId,
    game: s.game,
    wyrmspanGame: s.wyrmspanGame,
    finspanGame: s.finspanGame,
  };
}

export const useGameStore = create<AppStore>((set, get) => ({
  activeGameId: 'wingspan',
  game: null,
  wyrmspanGame: null,
  finspanGame: null,
  undoStack: [],
  lastStart: null,
  error: null,
  startedAt: null,
  aiSpeed: 'normal',

  setGameState: (state, startedAt) => {
    set({
      activeGameId: 'wingspan',
      game: state,
      wyrmspanGame: null,
      finspanGame: null,
      undoStack: [],
      startedAt: startedAt ?? null,
      error: null,
    });
  },

  setWyrmspanState: (state, startedAt) => {
    set({
      activeGameId: 'wyrmspan',
      game: null,
      wyrmspanGame: state,
      finspanGame: null,
      undoStack: [],
      startedAt: startedAt ?? null,
      error: null,
    });
  },

  setFinspanState: (state, startedAt) => {
    set({
      activeGameId: 'finspan',
      game: null,
      wyrmspanGame: null,
      finspanGame: state,
      undoStack: [],
      startedAt: startedAt ?? null,
      error: null,
    });
  },

  startLocalGame: (options) => {
    try {
      const game = createWingspan(options);
      set({
        activeGameId: 'wingspan',
        game,
        wyrmspanGame: null,
        finspanGame: null,
        undoStack: [],
        lastStart: { gameId: 'wingspan', options },
        startedAt: Date.now(),
        error: null,
      });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  startLocalWyrmspan: (options) => {
    try {
      const wyrmspanGame = createWyrmspan(options);
      set({
        activeGameId: 'wyrmspan',
        game: null,
        wyrmspanGame,
        finspanGame: null,
        undoStack: [],
        lastStart: { gameId: 'wyrmspan', options },
        startedAt: Date.now(),
        error: null,
      });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  startLocalFinspan: (options) => {
    try {
      const finspanGame = createFinspan(options);
      set({
        activeGameId: 'finspan',
        game: null,
        wyrmspanGame: null,
        finspanGame,
        undoStack: [],
        lastStart: { gameId: 'finspan', options },
        startedAt: Date.now(),
        error: null,
      });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  playAgainLocal: () => {
    const last = get().lastStart;
    if (!last) return;
    const seed = Math.floor(Math.random() * 0xffffffff);
    if (last.gameId === 'wingspan') {
      get().startLocalGame({ ...last.options, seed });
    } else if (last.gameId === 'wyrmspan') {
      get().startLocalWyrmspan({ ...last.options, seed });
    } else {
      get().startLocalFinspan({ ...last.options, seed });
    }
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
      if (s.activeGameId === 'wingspan' && s.game) {
        const next = applyWingspan(s.game, action as WingspanAction);
        set({ game: next, undoStack: nextUndo, error: null });
      } else if (s.activeGameId === 'wyrmspan' && s.wyrmspanGame) {
        const next = applyWyrmspan(s.wyrmspanGame, action as WyrmspanAction);
        set({ wyrmspanGame: next, undoStack: nextUndo, error: null });
      } else if (s.activeGameId === 'finspan' && s.finspanGame) {
        const next = applyFinspan(s.finspanGame, action as FinspanAction);
        set({ finspanGame: next, undoStack: nextUndo, error: null });
      } else {
        return;
      }
      broadcastHandler?.(action, before, at);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  applyLocal: (action) => {
    const s = get();
    try {
      if (s.activeGameId === 'wingspan' && s.game) {
        set({ game: applyWingspan(s.game, action as WingspanAction) });
        return true;
      }
      if (s.activeGameId === 'wyrmspan' && s.wyrmspanGame) {
        set({ wyrmspanGame: applyWyrmspan(s.wyrmspanGame, action as WyrmspanAction) });
        return true;
      }
      if (s.activeGameId === 'finspan' && s.finspanGame) {
        set({ finspanGame: applyFinspan(s.finspanGame, action as FinspanAction) });
        return true;
      }
      return false;
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
    set({
      activeGameId: prev.gameId,
      game: prev.game,
      wyrmspanGame: prev.wyrmspanGame,
      finspanGame: prev.finspanGame,
      undoStack: stack.slice(0, -1),
      error: null,
    });
  },

  setAiSpeed: (aiSpeed) => set({ aiSpeed }),

  takeSnapshot: () => currentSnap(get()),

  restoreSnapshot: (snap) => {
    set({
      activeGameId: snap.gameId,
      game: snap.game,
      wyrmspanGame: snap.wyrmspanGame,
      finspanGame: snap.finspanGame,
    });
  },

  dismissError: () => set({ error: null }),
}));
