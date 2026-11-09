import { create } from 'zustand';
import type { GameState, PlayerColor, PlayerId } from '@/wingspan/types';
import { createGame } from '@/wingspan/createGame';
import type { CreateGameOptions } from '@/wingspan/types';
import {
  type ChatMessage,
  type ConnectionState,
  type LobbyGame,
  type LobbySeat,
  type LobbyState,
  type LocalRole,
  type Presence,
  type RoomConnection,
  type RoomEvents,
  type RoomTransport,
  type StartRecord,
  ServerUnreachableError,
  generateRoomCode,
  getOrCreateUuid,
  getSavedDisplayName,
  normalizeRoomCode,
  saveDisplayName,
  setRoomCodeInUrl,
} from '@/net';
import {
  registerBroadcastHandler,
  registerDispatchGuard,
  registerOnlinePredicate,
  useGameStore,
  type GameSnapshot,
} from './gameStore';
import { ActionSync } from './actionSync';
import {
  MAX_SEATS,
  defaultLobbyGame,
  lobbySettings,
  lobbyStartProblem,
  normalizeLobbyGame,
} from './lobbyGame';

const DEFAULT_COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'purple'];
const SYSTEM_NAME = 'System';
/** The build this page runs (rooms record the build that made them). */
export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

/** Why a join gave up, for the error screen. */
export interface JoinFailure {
  code: string;
  /** notFound: the server has no room with this code. unreachable: this device couldn't reach the server. */
  reason: 'notFound' | 'unreachable';
  detail?: string;
}

/** FNV-1a over the state's JSON: devices compare it to know they built the same starting game. */
export function gameChecksum(state: GameState): string {
  const json = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const UNREACHABLE_TEXT =
  "Couldn't reach the game server. Check this device's internet connection, then try again.";

interface NetStore {
  connection: ConnectionState;
  errorMessage: string | null;
  role: LocalRole;
  myUuid: string;
  myDisplayName: string;
  roomCode: string | null;
  hostUuid: string | null;
  joinFailure: JoinFailure | null;
  /** This device's link to the server; false while it reconnects (moves wait, then go through). */
  serverConnected: boolean;
  lobby: LobbyState;
  onlineUuids: Set<string>;
  chat: ChatMessage[];

  setDisplayName: (name: string) => void;
  createRoom: (name: string) => Promise<void>;
  joinRoom: (code: string, name: string) => Promise<void>;
  /** Join the room of the last failed join again. */
  retryJoin: () => void;
  leaveRoom: () => void;
  clearError: () => void;

  hostAddAISeat: () => void;
  hostRemoveSeat: (slot: number) => void;
  hostSetAiLevel: (level: number) => void;
  hostSetGame: (game: LobbyGame) => void;
  hostStartGame: () => Promise<void>;
  /** Recolor a seat: your own, or (host) an AI seat. A seat already wearing the color swaps to the old one. */
  setSeatColor: (slot: number, color: PlayerColor) => void;

  sendChat: (text: string) => void;
  uuidForPlayer: (playerId: PlayerId) => string | null;
  isOnlinePlayer: (playerId: PlayerId) => boolean;
}

// Loaded on first use so the Firebase SDK isn't in the main bundle.
// (Tests swap the module for src/net/fakeTransport.ts.)
type LoadedTransport = RoomTransport & { warmUp: () => void };
let transportPromise: Promise<LoadedTransport> | null = null;
function loadTransport(): Promise<LoadedTransport> {
  transportPromise ??= import('@/net/firebaseRoom')
    .then((m) => m.getTransport())
    .catch((e: unknown) => {
      transportPromise = null;
      throw new ServerUnreachableError(`Could not load the online code (${(e as Error).message}).`);
    });
  return transportPromise;
}

/** Load the online code and sign in ahead of time (call when the online menu opens). */
export function warmUpNetwork(): void {
  loadTransport().then((t) => t.warmUp(), () => {});
}

// Internal (non-reactive) session state.
let conn: RoomConnection | null = null;
let session = 0; // bumped on every create / join / leave; stale callbacks compare against it
let sync: ActionSync<GameSnapshot> | null = null;
let seatToUuid: (string | null)[] = []; // index = playerId 'pN' slot minus 1
let gameStarted = false;
let lastPresence: Map<string, string> | null = null; // uuid → name

function emptyLobby(): LobbyState {
  return { hostUuid: '', seats: [], seed: 0, game: defaultLobbyGame() };
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}

function freeColor(seats: LobbySeat[]): PlayerColor {
  for (const c of DEFAULT_COLORS) {
    if (!seats.some((s) => s.color === c)) return c;
  }
  return DEFAULT_COLORS[seats.length % DEFAULT_COLORS.length]!;
}

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sysMessage(text: string, myUuid: string): ChatMessage {
  return { id: messageId(), senderUuid: myUuid, senderName: SYSTEM_NAME, text, timestamp: Date.now(), kind: 'system' };
}

function userMessage(text: string, uuid: string, name: string): ChatMessage {
  return { id: messageId(), senderUuid: uuid, senderName: name, text, timestamp: Date.now(), kind: 'user' };
}

/** Take (or keep) a seat for `uuid` while the lobby is open. */
function seatEdit(lobby: LobbyState, uuid: string, name: string): LobbyState | null {
  if (lobby.started) return null;
  const i = lobby.seats.findIndex((s) => s.uuid === uuid);
  if (i >= 0) {
    if (lobby.seats[i]!.name === name) return null;
    return { ...lobby, seats: lobby.seats.map((s, j) => (j === i ? { ...s, name } : s)) };
  }
  if (lobby.seats.length >= MAX_SEATS) return null;
  return { ...lobby, seats: [...lobby.seats, { uuid, name, isAI: false, color: freeColor(lobby.seats) }] };
}

function nextAiName(seats: LobbySeat[]): string {
  for (let n = 1; ; n++) {
    const name = `AI ${n}`;
    if (!seats.some((s) => s.name === name)) return name;
  }
}

export const useNetworkStore = create<NetStore>((set, get) => {
  registerOnlinePredicate(() => {
    const c = get().connection;
    return c === 'lobby' || c === 'in-game';
  });
  registerBroadcastHandler((action, before, at) => sync?.local(action, before, at));
  // Act only for your own seat (the host also for AI seats), so nothing is
  // ever written for a seat this device doesn't own.
  registerDispatchGuard((action) => {
    const s = get();
    if (s.connection !== 'in-game') return null;
    if (s.role === 'spectator') return "You're watching this game, not playing in it.";
    const owner = s.uuidForPlayer(action.playerId);
    if (owner === s.myUuid || (owner === null && s.role === 'host')) return null;
    return "That's another player's seat.";
  });

  const myUuid = getOrCreateUuid();

  /** End the current session (if any) and start a new one; returns its id. */
  function beginSession(): number {
    session++;
    sync?.close();
    sync = null;
    conn?.leave();
    conn = null;
    seatToUuid = [];
    gameStarted = false;
    lastPresence = null;
    return session;
  }

  function addSystem(text: string): void {
    set({ chat: [...get().chat, sysMessage(text, get().myUuid)] });
  }

  function makeSync(): ActionSync<GameSnapshot> {
    return new ActionSync<GameSnapshot>({
        apply: (entry) => {
          useGameStore.getState().applyLocal(entry.action, entry.at);
        },
        reapply: (entry) => useGameStore.getState().applyLocal(entry.action, entry.at),
        snapshot: () => useGameStore.getState().takeSnapshot()!,
        restore: (snap) => useGameStore.getState().restoreSnapshot(snap),
        write: (seq, entry) => (conn ? conn.appendAction(seq, entry) : Promise.resolve(false)),
        dropped: (_action, why) => {
          useGameStore.setState({
            error:
              why === 'overtaken'
                ? "Another player's move went through first, so yours was taken back."
                : 'The server refused that move.',
          });
        },
    });
  }

  function onLobby(raw: LobbyState): void {
    const lobby: LobbyState = { ...raw, game: normalizeLobbyGame(raw.game ?? defaultLobbyGame()) };
    const s = get();
    const me = s.myUuid;
    // A started lobby means the game record is on its way: stay on the
    // "joining" card rather than flash the lobby.
    const toLobby = s.connection === 'connecting' && !gameStarted && !lobby.started;
    set({
      lobby,
      hostUuid: lobby.hostUuid,
      role: gameStarted ? s.role : lobby.hostUuid === me ? 'host' : 'guest',
      connection: toLobby ? 'lobby' : s.connection,
    });
  }

  function onStart(rec: StartRecord): void {
    if (gameStarted) return; // written once; ignore repeats
    gameStarted = true;
    seatToUuid = rec.seatUuids.slice();
    const me = get().myUuid;
    const wasInLobby = get().connection === 'lobby';
    const isPlayer = seatToUuid.includes(me);
    const role: LocalRole = rec.hostUuid === me ? 'host' : isPlayer ? 'guest' : 'spectator';
    set({
      connection: 'in-game',
      role,
      hostUuid: rec.hostUuid,
      errorMessage: null,
      joinFailure: null,
    });
    addSystem(wasInLobby ? 'Game started' : isPlayer ? 'Rejoined the game' : 'Spectating');
    // Every device builds the starting game from the same inputs.
    let game: GameState;
    try {
      game = createGame(rec.options);
    } catch (e) {
      addSystem(`This device couldn't set up the game (${(e as Error).message}). Reload the page.`);
      return;
    }
    if (gameChecksum(game) !== rec.check) {
      addSystem(
        "This device set up a different game from the host's, so moves won't line up. "
          + "Reload every device's page so they all run the same version.",
      );
    }
    useGameStore.getState().setGameState(game, rec.startedAt);
    // Replay the log from the start: every device ends up with the same game.
    sync?.begin();
  }

  function onChat(msg: ChatMessage): void {
    if (get().chat.some((c) => c.id === msg.id)) return;
    set({ chat: [...get().chat, msg] });
  }

  function onPresence(people: Presence[]): void {
    const me = get().myUuid;
    const now = new Map<string, string>(people.map((p) => [p.uuid, p.name]));
    const online = new Set(now.keys());
    online.add(me);
    const lines: string[] = [];
    if (lastPresence) {
      for (const [uuid, name] of now) {
        if (!lastPresence.has(uuid) && uuid !== me) lines.push(`${name || 'A player'} joined`);
      }
      for (const [uuid, name] of lastPresence) {
        if (!now.has(uuid) && uuid !== me) lines.push(`${name || 'A player'} disconnected`);
      }
    }
    lastPresence = now;
    set({
      onlineUuids: online,
      chat: lines.length ? [...get().chat, ...lines.map((l) => sysMessage(l, me))] : get().chat,
    });
  }

  function roomEvents(my: number): RoomEvents {
    const live = () => my === session;
    return {
      lobby: (lobby) => live() && onLobby(lobby),
      start: (rec) => live() && onStart(rec),
      action: (seq, entry) => live() && sync?.receive(seq, entry),
      chat: (msg) => live() && onChat(msg),
      presence: (people) => live() && onPresence(people),
      connected: (up) => live() && set({ serverConnected: up }),
    };
  }

  function editLobby(edit: (lobby: LobbyState) => LobbyState | null): Promise<LobbyState | null> {
    if (!conn) return Promise.resolve(null);
    const normalized = (l: LobbyState) => edit({ ...l, game: normalizeLobbyGame(l.game ?? defaultLobbyGame()) });
    return conn.updateLobby(normalized).catch((e: unknown) => {
      console.warn('[net] lobby update failed:', (e as Error).message);
      return null;
    });
  }

  function failJoin(code: string, reason: JoinFailure['reason'], detail?: string): void {
    beginSession();
    if (reason === 'notFound') setRoomCodeInUrl(null);
    set({
      connection: 'error',
      joinFailure: { code, reason, detail },
      errorMessage:
        reason === 'notFound'
          ? `There's no room with code ${code}. Check the code with the host (rooms are cleared a week after they're made).`
          : UNREACHABLE_TEXT,
    });
  }

  return {
    connection: 'disconnected',
    errorMessage: null,
    role: 'solo',
    myUuid,
    myDisplayName: getSavedDisplayName() || 'Player',
    roomCode: null,
    hostUuid: null,
    joinFailure: null,
    serverConnected: true,
    lobby: emptyLobby(),
    onlineUuids: new Set(),
    chat: [],

    setDisplayName: (name) => {
      saveDisplayName(name);
      set({ myDisplayName: name });
    },

    createRoom: async (name) => {
      saveDisplayName(name);
      const my = beginSession();
      const me = get().myUuid;
      const lobby: LobbyState = {
        hostUuid: me,
        seats: [{ uuid: me, name, isAI: false, color: DEFAULT_COLORS[0]! }],
        seed: randomSeed(),
        game: defaultLobbyGame(),
      };
      sync = makeSync();
      set({
        connection: 'connecting',
        role: 'host',
        myDisplayName: name,
        roomCode: null,
        hostUuid: me,
        joinFailure: null,
        errorMessage: null,
        serverConnected: true,
        lobby,
        onlineUuids: new Set([me]),
        chat: [],
      });
      try {
        const transport = await loadTransport();
        let c: RoomConnection | null = null;
        // A code still in use by a live room is refused; draw another.
        for (let attempt = 0; attempt < 6 && !c && my === session; attempt++) {
          c = await transport.createRoom(
            generateRoomCode(),
            { hostUuid: me, createdAt: Date.now(), build: APP_BUILD },
            lobby,
            { uuid: me, name },
            roomEvents(my),
          );
        }
        if (my !== session) {
          c?.leave();
          return;
        }
        if (!c) throw new Error('Could not find a free room code. Try again.');
        conn = c;
        setRoomCodeInUrl(c.code);
        set({ roomCode: c.code, connection: get().connection === 'connecting' ? 'lobby' : get().connection });
      } catch (e) {
        if (my !== session) return;
        console.error('[net] failed to create room', e);
        beginSession();
        set({
          connection: 'error',
          joinFailure: null,
          errorMessage: e instanceof ServerUnreachableError ? UNREACHABLE_TEXT : (e as Error).message,
        });
      }
    },

    joinRoom: async (code, name) => {
      saveDisplayName(name);
      const upper = normalizeRoomCode(code);
      const my = beginSession();
      const me = get().myUuid;
      sync = makeSync();
      set({
        connection: 'connecting',
        role: 'guest',
        myDisplayName: name,
        roomCode: upper,
        hostUuid: null,
        lobby: emptyLobby(),
        chat: [],
        errorMessage: null,
        joinFailure: null,
        serverConnected: true,
        onlineUuids: new Set([me]),
      });
      let c: RoomConnection | null;
      try {
        const transport = await loadTransport();
        c = await transport.joinRoom(upper, { uuid: me, name }, roomEvents(my));
      } catch (e) {
        if (my !== session) return;
        console.error('[net] failed to join room', e);
        failJoin(upper, 'unreachable', (e as Error).message);
        return;
      }
      if (my !== session) {
        c?.leave();
        return;
      }
      if (!c) {
        failJoin(upper, 'notFound');
        return;
      }
      conn = c;
      setRoomCodeInUrl(upper);
      if (c.meta.build !== APP_BUILD) {
        addSystem(
          `This room was made by another version of the game (${c.meta.build}; this device runs ${APP_BUILD}). `
            + "If moves stop lining up, reload every device's page.",
        );
      }
      // Take a seat while the lobby is open (rejoining keeps yours).
      await editLobby((lobby) => seatEdit(lobby, me, name));
    },

    retryJoin: () => {
      const code = get().joinFailure?.code ?? get().roomCode;
      if (code) void get().joinRoom(code, get().myDisplayName);
    },

    leaveRoom: () => {
      const s = get();
      const c = conn;
      conn = null;
      // A guest leaving the lobby gives up their seat.
      if (c && s.connection === 'lobby' && s.role !== 'host') {
        const me = s.myUuid;
        c.updateLobby((l) =>
          l.started || !l.seats.some((x) => x.uuid === me)
            ? null
            : { ...l, seats: l.seats.filter((x) => x.uuid !== me) },
        )
          .catch(() => null)
          .finally(() => c.leave());
      } else {
        c?.leave();
      }
      beginSession();
      setRoomCodeInUrl(null);
      set({
        connection: 'disconnected',
        errorMessage: null,
        role: 'solo',
        roomCode: null,
        hostUuid: null,
        joinFailure: null,
        serverConnected: true,
        lobby: emptyLobby(),
        onlineUuids: new Set(),
        chat: [],
      });
    },

    clearError: () => {
      beginSession();
      setRoomCodeInUrl(null);
      set({ connection: 'disconnected', role: 'solo', errorMessage: null, joinFailure: null, roomCode: null });
    },

    hostAddAISeat: () => {
      if (get().role !== 'host') return;
      void editLobby((l) =>
        l.started || l.seats.length >= MAX_SEATS
          ? null
          : {
              ...l,
              seats: [...l.seats, { uuid: null, name: nextAiName(l.seats), isAI: true, color: freeColor(l.seats) }],
            },
      );
    },

    hostRemoveSeat: (slot) => {
      if (get().role !== 'host' || slot <= 0) return; // can't remove the host
      const target = get().lobby.seats[slot];
      if (!target) return;
      const same = (s: LobbySeat) => s.uuid === target.uuid && s.name === target.name && s.isAI === target.isAI;
      void editLobby((l) => {
        const i = l.seats.findIndex(same);
        return l.started || i <= 0 ? null : { ...l, seats: l.seats.filter((_, j) => j !== i) };
      });
    },

    hostSetAiLevel: (level) => {
      if (get().role !== 'host') return;
      void editLobby((l) => (l.started ? null : { ...l, aiLevel: level }));
    },

    hostSetGame: (game) => {
      if (get().role !== 'host') return;
      const next = normalizeLobbyGame(game);
      void editLobby((l) => (l.started ? null : { ...l, game: next }));
    },

    hostStartGame: async () => {
      const c = conn;
      const my = session;
      if (get().role !== 'host' || !c || lobbyStartProblem(get().lobby)) return;
      // Lock the seats and settings first, atomically: a guest taking a seat
      // at the same moment either makes it in or finds the lobby closed.
      const final = await editLobby((l) => (l.started || lobbyStartProblem(l) ? null : { ...l, started: true }));
      if (!final || my !== session) return;
      const reopen = (why: string) => {
        addSystem(`Couldn't start the game: ${why}`);
        void editLobby((l) => ({ ...l, started: false }));
      };
      const options: CreateGameOptions = {
        playerNames: final.seats.map((s) => s.name),
        playerTypes: final.seats.map((s) => (s.isAI ? 'ai' : 'human')),
        playerColors: final.seats.map((s) => s.color),
        seed: final.seed,
        settings: lobbySettings(final),
      };
      let check: string;
      try {
        check = gameChecksum(createGame(options));
      } catch (e) {
        reopen((e as Error).message);
        return;
      }
      try {
        await c.start({
          options,
          seatUuids: final.seats.map((s) => s.uuid),
          hostUuid: get().myUuid,
          startedAt: Date.now(),
          check,
        });
      } catch (e) {
        if (my === session && !gameStarted) reopen((e as Error).message);
      }
    },

    setSeatColor: (slot, color) => {
      const s = get();
      const target = s.lobby.seats[slot];
      if (!target || s.connection !== 'lobby') return;
      const mine = target.uuid === s.myUuid;
      if (!mine && !(target.isAI && s.role === 'host')) return;
      const same = (x: LobbySeat) => x.uuid === target.uuid && x.name === target.name && x.isAI === target.isAI;
      void editLobby((l) => {
        const i = l.seats.findIndex(same);
        const seat = l.seats[i];
        if (l.started || !seat || seat.color === color) return null;
        return {
          ...l,
          seats: l.seats.map((x, j) =>
            j === i ? { ...x, color } : x.color === color ? { ...x, color: seat.color } : x,
          ),
        };
      });
    },

    sendChat: (text) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const msg = userMessage(trimmed, get().myUuid, get().myDisplayName);
      // Shown at once; the room's copy is de-duplicated by id.
      set({ chat: [...get().chat, msg] });
      conn?.sendChat(msg).catch((e: unknown) => console.warn('[net] chat send failed:', (e as Error).message));
    },

    uuidForPlayer: (playerId) => {
      // 'p1' → seatToUuid[0]
      const idx = Number(playerId.slice(1)) - 1;
      return seatToUuid[idx] ?? null;
    },

    isOnlinePlayer: (playerId: PlayerId): boolean => {
      const state = get();
      const uuid = state.uuidForPlayer(playerId);
      if (!uuid) return false;
      return state.onlineUuids.has(uuid);
    },
  };
});

// Helper: are we currently controlling player `pid`?
export function isMyPlayer(playerId: PlayerId): boolean {
  const s = useNetworkStore.getState();
  if (s.connection === 'disconnected' || s.role === 'solo') return true;
  const uuid = s.uuidForPlayer(playerId);
  return uuid === s.myUuid;
}

// Helper: the player id for our local seat, or null if spectator / hot-seat.
export function getMyPlayerId(game: GameState | null): PlayerId | null {
  if (!game) return null;
  const s = useNetworkStore.getState();
  if (s.connection === 'disconnected' || s.role === 'solo') {
    return null; // hot-seat: many players on one device, no single "me"
  }
  for (let i = 0; i < game.players.length; i++) {
    if (s.uuidForPlayer(game.players[i]!.id) === s.myUuid) return game.players[i]!.id;
  }
  return null;
}
