import { create } from 'zustand';
import type { CreateGameOptions as WingspanOptions, PlayerColor, PlayerId } from '@/wingspan/types';
import type { CreateGameOptions as WyrmspanOptions } from '@/wyrmspan/createGame';
import { loadEngine, type GameEngine } from '@/games/engines';
import type { CreateGameOptions as FinspanOptions } from '@/finspan/types';
import {
  type AnyAction,
  type ChatMessage,
  type ConnectionState,
  type GameId,
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

const DEFAULT_COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'purple', 'pink', 'teal'];
const SYSTEM_NAME = 'System';
export const APP_BUILD = typeof __APP_BUILD__ === 'string' ? __APP_BUILD__ : 'dev';

export interface JoinFailure {
  code: string;
  reason: 'notFound' | 'unreachable';
  detail?: string;
}

/** FNV-1a over the state's JSON: devices compare it to know they built the same starting game. */
export function gameChecksum(state: unknown): string {
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
  serverConnected: boolean;
  lobby: LobbyState;
  onlineUuids: Set<string>;
  chat: ChatMessage[];

  setDisplayName: (name: string) => void;
  createRoom: (name: string, initialGame?: LobbyGame) => Promise<void>;
  joinRoom: (code: string, name: string) => Promise<void>;
  retryJoin: () => void;
  leaveRoom: () => void;
  clearError: () => void;

  hostAddAISeat: () => void;
  hostRemoveSeat: (slot: number) => void;
  hostSetAiLevel: (level: number) => void;
  hostSetGame: (game: LobbyGame) => void;
  hostStartGame: () => Promise<void>;
  setSeatColor: (slot: number, color: PlayerColor) => void;

  sendChat: (text: string) => void;
  uuidForPlayer: (playerId: PlayerId) => string | null;
  isOnlinePlayer: (playerId: PlayerId) => boolean;
}

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

export function warmUpNetwork(): void {
  loadTransport().then((t) => t.warmUp(), () => {});
}

let conn: RoomConnection | null = null;
let session = 0;
let sync: ActionSync<GameSnapshot> | null = null;
let seatToUuid: (string | null)[] = [];
let gameStarted = false;
let lastPresence: Map<string, string> | null = null;

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
  registerDispatchGuard((action: AnyAction) => {
    const s = get();
    if (s.connection !== 'in-game') return null;
    if (s.role === 'spectator') return "You're watching this game, not playing in it.";
    const owner = s.uuidForPlayer(action.playerId as PlayerId);
    if (owner === s.myUuid || (owner === null && s.role === 'host')) return null;
    return "That's another player's seat.";
  });

  const myUuid = getOrCreateUuid();

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
    const toLobby = s.connection === 'connecting' && !gameStarted && !lobby.started;
    set({
      lobby,
      hostUuid: lobby.hostUuid,
      role: gameStarted ? s.role : lobby.hostUuid === me ? 'host' : 'guest',
      connection: toLobby ? 'lobby' : s.connection,
    });
  }

  function onStart(rec: StartRecord): void {
    if (gameStarted) return;
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
    const gameId: GameId = rec.gameId ?? 'wingspan';
    // Every device builds the game from the host's options; the checksum
    // catches a device whose build or data differs from the host's. The
    // engine chunk loads on demand; log entries arriving meanwhile are held
    // by the sync until begin().
    const options =
      gameId === 'wyrmspan' ? rec.wyrmspanOptions : gameId === 'finspan' ? rec.finspanOptions : rec.options;
    const mySync = sync;
    loadEngine(gameId)
      .then((engine) => {
        if (sync !== mySync) return; // left the room while the game was loading
        const store = useGameStore.getState();
        const setState = (
          gameId === 'wyrmspan' ? store.setWyrmspanState : gameId === 'finspan' ? store.setFinspanState : store.setGameState
        ) as (g: never, startedAt?: number) => void;
        try {
          if (!options) throw new Error('missing game options');
          const g = engine.createGame(options as never);
          if (gameChecksum(g) !== rec.check) {
            addSystem("This device set up a different game from the host's. Reload every device's page.");
          }
          setState(g as never, rec.startedAt);
        } catch (e) {
          addSystem(`This device couldn't set up the game (${(e as Error).message}). Reload the page.`);
          return;
        }
        sync?.begin();
      })
      .catch((e: unknown) => addSystem(`Couldn't load the game (${(e as Error).message}). Check your connection and reload.`));
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

    createRoom: async (name, initialGame) => {
      saveDisplayName(name);
      const my = beginSession();
      const me = get().myUuid;
      const lobby: LobbyState = {
        hostUuid: me,
        seats: [{ uuid: me, name, isAI: false, color: DEFAULT_COLORS[0]! }],
        seed: randomSeed(),
        game: normalizeLobbyGame(initialGame ?? defaultLobbyGame()),
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
      if (get().role !== 'host' || slot <= 0) return;
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
      const final = await editLobby((l) => (l.started || lobbyStartProblem(l) ? null : { ...l, started: true }));
      if (!final || my !== session) return;
      const reopen = (why: string) => {
        addSystem(`Couldn't start the game: ${why}`);
        void editLobby((l) => ({ ...l, started: false }));
      };
      const g = normalizeLobbyGame(final.game);
      const gameId: GameId = g.gameId ?? 'wingspan';
      const options: WingspanOptions = {
        playerNames: final.seats.map((s) => s.name),
        playerTypes: final.seats.map((s) => (s.isAI ? 'ai' : 'human')),
        playerColors: final.seats.map((s) => s.color),
        seed: final.seed,
        settings: lobbySettings(final),
      };
      let engine: GameEngine;
      try {
        engine = await loadEngine(gameId);
      } catch (e) {
        reopen((e as Error).message);
        return;
      }
      if (my !== session) return;
      let wyrmspanOptions: WyrmspanOptions | undefined;
      let finspanOptions: FinspanOptions | undefined;
      let check: string;
      try {
        if (gameId === 'wyrmspan') {
          wyrmspanOptions = {
            seed: final.seed,
            playerNames: final.seats.map((s) => s.name),
            isAI: final.seats.map((s) => s.isAI),
            expansions: g.expansions ?? ['base', 'academy'],
          };
          check = gameChecksum(engine.createGame(wyrmspanOptions as never));
        } else if (gameId === 'finspan') {
          finspanOptions = {
            playerNames: final.seats.map((s) => s.name),
            playerTypes: final.seats.map((s) => (s.isAI ? 'ai' : 'human')),
            playerColors: final.seats.map((s) => s.color),
            seed: final.seed,
            settings: {
              sets: g.sets,
              achievementSide: g.achievementSide ?? 'A',
            },
          };
          check = gameChecksum(engine.createGame(finspanOptions as never));
        } else {
          check = gameChecksum(engine.createGame(options as never));
        }
      } catch (e) {
        reopen((e as Error).message);
        return;
      }
      try {
        await c.start({
          gameId,
          options,
          wyrmspanOptions,
          finspanOptions,
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
      const aiForHost = s.role === 'host' && target.isAI;
      if (!mine && !aiForHost) return;
      void editLobby((l) => {
        if (l.started) return null;
        const me = l.seats[slot];
        if (!me || me.color === color) return null;
        const other = l.seats.findIndex((x, i) => i !== slot && x.color === color);
        return {
          ...l,
          seats: l.seats.map((x, i) =>
            i === slot ? { ...x, color } : i === other ? { ...x, color: me.color } : x,
          ),
        };
      });
    },

    sendChat: (text) => {
      const clean = text.trim().slice(0, 500);
      if (!clean || !conn) return;
      const s = get();
      const msg = userMessage(clean, s.myUuid, s.myDisplayName);
      onChat(msg);
      void conn.sendChat(msg);
    },

    uuidForPlayer: (playerId) => {
      const idx = Number(playerId.slice(1)) - 1;
      return seatToUuid[idx] ?? null;
    },

    isOnlinePlayer: (playerId) => {
      const uuid = get().uuidForPlayer(playerId);
      return uuid !== null && get().onlineUuids.has(uuid);
    },
  };
});
