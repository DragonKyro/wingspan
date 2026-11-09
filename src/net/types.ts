import type { Action, PlayerColor } from '@/wingspan/types';
import type { CreateGameOptions } from '@/wingspan/types';

export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'lobby'
  | 'in-game'
  | 'error';
export type LocalRole = 'solo' | 'host' | 'guest' | 'spectator';

export interface LobbySeat {
  // null UUID means this seat is open (humans only) or AI (when isAI is true).
  uuid: string | null;
  name: string;
  isAI: boolean;
  color: PlayerColor;
}

/** Which card sets the game shuffles into the deck. */
export interface LobbyGame {
  sets: string[];
}

export interface LobbyState {
  hostUuid: string;
  seats: LobbySeat[];
  seed: number;
  aiLevel?: number;
  game: LobbyGame;
  /** Set by the host, atomically with the final seat list, as the game starts. */
  started?: boolean;
}

export interface ChatMessage {
  id: string;
  senderUuid: string;
  senderName: string;
  text: string;
  timestamp: number;
  kind: 'user' | 'system';
}

// === What a room stores ===

/** Written once, by the host, when the room is made. */
export interface RoomMeta {
  hostUuid: string;
  createdAt: number;
  /** The app build that made the room (devices on other builds may not stay in step). */
  build: string;
}

/**
 * How the game began. It carries createGame's inputs rather than the
 * starting GameState (a few hundred bytes instead of 30-100 KB): createGame
 * is deterministic, so every device builds the same game from them, then
 * applies the action log.
 */
export interface StartRecord {
  options: CreateGameOptions;
  // Seat → UUID, so each device can tell which seat is theirs (or that
  // they're a spectator when their UUID isn't on any seat).
  seatUuids: (string | null)[];
  hostUuid: string;
  /** When the host started the game (ms since epoch); the game clock counts from here. */
  startedAt: number;
  /** Checksum of the starting GameState, so a device that built a different one (another app version) can tell. */
  check: string;
}

/** One move in the room's action log. */
export interface LoggedAction {
  action: Action;
  /** Short random id, so the author recognises its own move in the log. */
  nonce: string;
  /** When the move was made (ms since epoch, the author's clock): the game clock and per-player time stats. */
  at: number;
}

/** A device currently connected to the room. */
export interface Presence {
  uuid: string;
  name: string;
}
