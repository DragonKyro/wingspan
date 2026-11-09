import { create } from 'zustand';
import type { Action, GameState } from '@/wingspan/types';
import { applyAction } from '@/wingspan/engine';
import { createGame } from '@/wingspan/createGame';
import type { CreateGameOptions } from '@/wingspan/types';

/** The state captured for online rollbacks (just the game — the log is inside it). */
export type GameSnapshot = GameState;

// Optional broadcast hook — when the network layer is active it registers a
// function here so dispatched actions are sent to the room as a side effect.
// `before` is the state the action was applied to (the room may roll back to
// it). Kept here (rather than in networkStore) to avoid a circular import.
let broadcastHandler: ((action: Action, before: GameSnapshot, at: number) => void) | null = null;
export function registerBroadcastHandler(
  fn: ((action: Action, before: GameSnapshot, at: number) => void) | null,
): void {
  broadcastHandler = fn;
}

// Online, a device may only act for its own seat (and the host for AI
// seats). The network layer registers the check; it returns an error
// message to refuse the action, or null to allow it.
let dispatchGuard: ((action: Action) => string | null) | null = null;
export function registerDispatchGuard(fn: ((action: Action) => string | null) | null): void {
  dispatchGuard = fn;
}

// Some store behavior needs to know if we're in an online session.
let isOnlinePredicate: () => boolean = () => false;
export function registerOnlinePredicate(fn: () => boolean): void {
  isOnlinePredicate = fn;
}
export function isOnline(): boolean {
  return isOnlinePredicate();
}

interface AppStore {
  game: GameState | null;
  error: string | null;
  /** Wall-clock time the game started (from the room's start record; local games use now). */
  startedAt: number | null;

  setGameState: (state: GameState, startedAt?: number) => void;
  /** Start a local game (solo or hot-seat). */
  startLocalGame: (options: CreateGameOptions) => void;
  clearGame: () => void;
  dispatch: (action: Action) => void;
  /** Apply an action without broadcasting it (moves from the room). False when the engine rejects it. */
  applyLocal: (action: Action, at?: number) => boolean;
  takeSnapshot: () => GameSnapshot | null;
  restoreSnapshot: (snap: GameSnapshot) => void;
  dismissError: () => void;
}

export const useGameStore = create<AppStore>((set, get) => ({
  game: null,
  error: null,
  startedAt: null,

  setGameState: (state, startedAt) => {
    set({ game: state, startedAt: startedAt ?? null, error: null });
  },

  startLocalGame: (options) => {
    try {
      const game = createGame(options);
      set({ game, startedAt: Date.now(), error: null });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  clearGame: () => {
    set({ game: null, startedAt: null, error: null });
  },

  dispatch: (action) => {
    const before = get().game;
    if (!before) return;
    const refused = dispatchGuard?.(action);
    if (refused) {
      set({ error: refused });
      return;
    }
    const at = Date.now();
    try {
      const next = applyAction(before, action);
      set({ game: next, error: null });
      broadcastHandler?.(action, before, at);
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  applyLocal: (action) => {
    const before = get().game;
    if (!before) return false;
    try {
      const next = applyAction(before, action);
      set({ game: next });
      return true;
    } catch (e) {
      console.warn('[gameStore] applyLocal rejected action:', (e as Error).message);
      return false;
    }
  },

  takeSnapshot: () => get().game,

  restoreSnapshot: (snap) => {
    set({ game: snap });
  },

  dismissError: () => set({ error: null }),
}));
