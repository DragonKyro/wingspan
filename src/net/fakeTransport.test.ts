import { beforeEach, describe, expect, it } from 'vitest';
import { createFakeTransport, resetFakeServer, fakeServer } from './fakeTransport';
import type { ChatMessage, LobbyState, LoggedAction, Presence, StartRecord } from './types';
import type { RoomEvents } from './transport';

function collectEvents(): { events: RoomEvents; got: Record<string, unknown[]> } {
  const got: Record<string, unknown[]> = { lobby: [], start: [], action: [], chat: [], presence: [], connected: [] };
  return {
    got,
    events: {
      lobby: (l: LobbyState) => got.lobby.push(l),
      start: (s: StartRecord) => got.start.push(s),
      action: (seq: number, e: LoggedAction) => got.action.push([seq, e]),
      chat: (m: ChatMessage) => got.chat.push(m),
      presence: (p: Presence[]) => got.presence.push(p),
      connected: (up: boolean) => got.connected.push(up),
    },
  };
}

const lobby: LobbyState = {
  hostUuid: 'host-uuid',
  seats: [{ uuid: 'host-uuid', name: 'Host', isAI: false, color: 'red' }],
  seed: 42,
  game: { sets: ['core'] },
};

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('fakeTransport', () => {
  beforeEach(() => resetFakeServer());

  it('creates and joins a room, with events flowing', async () => {
    const t1 = createFakeTransport();
    const t2 = createFakeTransport();
    const host = collectEvents();
    const guest = collectEvents();

    const room = await t1.createRoom('ABCD', { hostUuid: 'host-uuid', createdAt: Date.now(), build: 'dev' }, lobby, { uuid: 'host-uuid', name: 'Host' }, host.events);
    expect(room).not.toBeNull();

    const joined = await t2.joinRoom('ABCD', { uuid: 'guest-uuid', name: 'Guest' }, guest.events);
    expect(joined).not.toBeNull();
    await flush();
    expect(gotLen(host, 'lobby')).toBeGreaterThan(0);
    expect(gotLen(guest, 'lobby')).toBeGreaterThan(0);

    // Start + log write.
    const start: StartRecord = {
      options: { playerNames: ['H', 'G'], playerTypes: ['human', 'human'], playerColors: ['red', 'blue'], seed: 1 },
      seatUuids: ['host-uuid', 'guest-uuid'],
      hostUuid: 'host-uuid',
      startedAt: Date.now(),
      check: 'deadbeef',
    };
    await room!.start(start);
    const entry: LoggedAction = { action: { type: 'endTurn', playerId: 'p1' }, nonce: 'abc', at: Date.now() };
    expect(await room!.appendAction(0, entry)).toBe(true);
    expect(await joined!.appendAction(0, entry)).toBe(false); // slot taken
    await flush();
    expect(host.got.action.length).toBe(1);
    expect(guest.got.action.length).toBe(1);
  });

  it('refuses a second room with the same code', async () => {
    const t = createFakeTransport();
    const e = collectEvents();
    const a = await t.createRoom('ABCD', { hostUuid: 'x', createdAt: Date.now(), build: 'dev' }, lobby, { uuid: 'x', name: 'x' }, e.events);
    const b = await t.createRoom('ABCD', { hostUuid: 'y', createdAt: Date.now(), build: 'dev' }, lobby, { uuid: 'y', name: 'y' }, e.events);
    expect(a).not.toBeNull();
    expect(b).toBeNull();
  });

  it('reports a dead server', async () => {
    fakeServer().up = false;
    const t = createFakeTransport();
    await expect(
      t.createRoom('ABCD', { hostUuid: 'x', createdAt: 0, build: 'dev' }, lobby, { uuid: 'x', name: 'x' }, collectEvents().events),
    ).rejects.toThrow();
  });
});

function gotLen(e: { got: Record<string, unknown[]> }, key: string): number {
  return e.got[key]!.length;
}
