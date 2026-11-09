import type { Action as WingspanAction, CreateGameOptions as WingspanOptions, PlayerColor } from '@/wingspan/types';
import type { Action as WyrmspanAction } from '@/wyrmspan/types';
import type { CreateGameOptions as WyrmspanOptions } from '@/wyrmspan/createGame';
import type { Action as FinspanAction, CreateGameOptions as FinspanOptions } from '@/finspan/types';

export type GameId = 'wingspan' | 'wyrmspan' | 'finspan';
export type AnyAction = WingspanAction | WyrmspanAction | FinspanAction;

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

/** Which game and expansions/options the room is configured to play. */
export interface LobbyGame {
  gameId?: GameId;
  sets: string[];
  mode?: 'standard' | 'duet' | 'flock';
  goalSide?: 'green' | 'blue';
  achievementSide?: 'A' | 'B';
  expansions?: ('base' | 'academy')[];
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
  gameId?: GameId;
  options: WingspanOptions;
  wyrmspanOptions?: WyrmspanOptions;
  finspanOptions?: FinspanOptions;
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
  action: AnyAction;
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
