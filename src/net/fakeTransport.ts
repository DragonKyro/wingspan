// Test-only: an in-memory stand-in for firebaseRoom.ts
// (vi.mock('@/net/firebaseRoom', () => import('@/net/fakeTransport'))).
// Each "device" in a test is its own module graph (vi.resetModules) with its
// own stores; they all share one server on globalThis, which behaves like the
// Realtime Database as the app uses it: write-once log slots, atomic lobby
// edits, presence that disappears when a device leaves, payloads through JSON,
// and every event delivered asynchronously (the author's own writes too).
// `fakeServer().up = false` models a device that can't reach the server.
// `fakeServer().holdWrites = true` queues log writes until `releaseWrites()`,
// so tests can make two devices race for the same slot.
// Not imported by production code.

import {
  DAY_MS,
  ROOM_LIFETIME_MS,
  ServerUnreachableError,
  decodeAction,
  encodeAction,
  type RoomConnection,
  type RoomEvents,
  type RoomTransport,
} from './transport';
import type { LobbyState, Presence, RoomMeta, StartRecord } from './types';

interface Listener {
  id: number;
  me: Presence;
  events: RoomEvents;
}

interface FakeRoom {
  meta: RoomMeta;
  lobby: string;
  start: string | null;
  actions: Map<number, string>;
  chat: string[];
  listeners: Map<number, Listener>;
}

interface FakeServer {
  rooms: Map<string, FakeRoom>;
  up: boolean;
  holdWrites: boolean;
  held: (() => void)[];
  nextId: number;
}

const KEY = '__wingspanFakeServer';

export function fakeServer(): FakeServer {
  const g = globalThis as unknown as Record<string, FakeServer | undefined>;
  return (g[KEY] ??= { rooms: new Map(), up: true, holdWrites: false, held: [], nextId: 0 });
}

export function resetFakeServer(): void {
  delete (globalThis as unknown as Record<string, FakeServer | undefined>)[KEY];
}

/** Let held log writes reach the server, in the order they were made. */
export function releaseWrites(): void {
  const s = fakeServer();
  s.holdWrites = false;
  const held = s.held.splice(0);
  held.forEach((f) => f());
}

const later = (f: () => void) => {
  void Promise.resolve().then(f);
};

function presenceOf(room: FakeRoom): Presence[] {
  return [...room.listeners.values()].map((l) => ({ ...l.me }));
}

function broadcast(room: FakeRoom, f: (l: Listener) => void): void {
  for (const l of [...room.listeners.values()]) later(() => room.listeners.has(l.id) && f(l));
}

function requireServer(): FakeServer {
  const s = fakeServer();
  if (!s.up) throw new ServerUnreachableError('Fake server is down.');
  return s;
}

function open(code: string, room: FakeRoom, me: Presence, events: RoomEvents): RoomConnection {
  const server = fakeServer();
  const id = server.nextId++;
  const listener: Listener = { id, me: { ...me }, events };
  room.listeners.set(id, listener);

  // Initial load, as the database's listeners deliver it.
  later(() => {
    if (!room.listeners.has(id)) return;
    events.connected(true);
    events.lobby(JSON.parse(room.lobby) as LobbyState);
    if (room.start) events.start(JSON.parse(room.start) as StartRecord);
    [...room.actions.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([seq, value]) => events.action(seq, decodeAction(value)!));
    room.chat.forEach((json) => events.chat(JSON.parse(json)));
  });
  broadcast(room, (l) => l.events.presence(presenceOf(room)));

  return {
    code,
    meta: { ...room.meta },
    updateLobby: async (edit) => {
      requireServer();
      const next = edit(JSON.parse(room.lobby) as LobbyState);
      if (!next) return null;
      if (room.start) throw new Error('PERMISSION_DENIED: the game has started');
      room.lobby = JSON.stringify(next);
      broadcast(room, (l) => l.events.lobby(JSON.parse(room.lobby) as LobbyState));
      return JSON.parse(room.lobby) as LobbyState;
    },
    start: async (record) => {
      requireServer();
      if (room.start) throw new Error('PERMISSION_DENIED: already started');
      if (me.uuid !== room.meta.hostUuid) throw new Error('PERMISSION_DENIED: not the host');
      room.start = JSON.stringify(record);
      const json = room.start;
      broadcast(room, (l) => l.events.start(JSON.parse(json) as StartRecord));
    },
    appendAction: (seq, entry) =>
      new Promise<boolean>((resolve, reject) => {
        const write = () => {
          if (!fakeServer().up) {
            reject(new ServerUnreachableError());
            return;
          }
          if (!room.start) {
            reject(new Error('PERMISSION_DENIED: not started'));
            return;
          }
          if (room.actions.has(seq)) {
            resolve(false);
            return;
          }
          const value = encodeAction(entry);
          room.actions.set(seq, value);
          broadcast(room, (l) => l.events.action(seq, decodeAction(value)!));
          resolve(true);
        };
        if (fakeServer().holdWrites) fakeServer().held.push(write);
        else later(write);
      }),
    sendChat: async (msg) => {
      requireServer();
      const json = JSON.stringify(msg);
      room.chat.push(json);
      broadcast(room, (l) => l.events.chat(JSON.parse(json)));
    },
    leave: () => {
      if (!room.listeners.delete(id)) return;
      broadcast(room, (l) => l.events.presence(presenceOf(room)));
    },
  };
}

export function createFakeTransport(): RoomTransport & { warmUp: () => void } {
  return {
    warmUp: () => {},
    createRoom: async (code, meta, lobby, me, events) => {
      const server = requireServer();
      if (server.rooms.has(code)) return null;
      const room: FakeRoom = {
        meta: { ...meta },
        lobby: JSON.stringify(lobby),
        start: null,
        actions: new Map(),
        chat: [],
        listeners: new Map(),
      };
      server.rooms.set(code, room);
      // Like the real transport: the new room's host clears rooms whose day
      // ended over a week ago, unless someone is still in them.
      const dayEnd = (t: number) => (Math.floor(t / DAY_MS) + 1) * DAY_MS;
      const cutoff = Date.now() - ROOM_LIFETIME_MS;
      for (const [c, r] of [...server.rooms]) {
        if (dayEnd(r.meta.createdAt) <= cutoff && r.listeners.size === 0) server.rooms.delete(c);
      }
      return open(code, room, me, events);
    },
    joinRoom: async (code, me, events) => {
      const server = requireServer();
      const room = server.rooms.get(code);
      return room ? open(code, room, me, events) : null;
    },
  };
}

let instance: ReturnType<typeof createFakeTransport> | null = null;

/** Same export as firebaseRoom.ts, so the module can be swapped in with vi.mock. */
export function getTransport() {
  return (instance ??= createFakeTransport());
}
