import { useNetworkStore } from '@/store/networkStore';
import { LOBBY_SETS, lobbyStartProblem } from '@/store/lobbyGame';
import { roomLink } from '@/net';
import { SETS } from '@/wingspan/cards';

export function LobbyScreen() {
  const { lobby, role, roomCode, connection, myUuid, hostAddAISeat, hostRemoveSeat, hostSetGame, hostStartGame, leaveRoom, onlineUuids, chat, sendChat } =
    useNetworkStore();
  const problem = lobbyStartProblem(lobby);

  const toggleSet = (id: string) => {
    const cur = lobby.game.sets;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    if (next.length) hostSetGame({ sets: next });
  };

  return (
    <div>
      <div className="card">
        <div className="row">
          <h2>Room {roomCode}</h2>
          <span className="muted">share this link:</span>
          <code>{roomCode ? roomLink(roomCode) : ''}</code>
          <div className="spacer" />
          <button onClick={leaveRoom}>Leave</button>
        </div>
        <h3>Players</h3>
        {lobby.seats.map((seat, i) => (
          <div key={i} className="row" style={{ marginBottom: 4 }}>
            <span className={`pcolor c-${seat.color}`} />
            <span>
              {seat.name}
              {seat.isAI ? ' (AI)' : ''}
              {seat.uuid === myUuid ? ' — you' : ''}
              {seat.uuid && !onlineUuids.has(seat.uuid) ? ' (offline)' : ''}
            </span>
            <div className="spacer" />
            {role === 'host' && i > 0 && (
              <button onClick={() => hostRemoveSeat(i)}>Remove</button>
            )}
          </div>
        ))}
        {role === 'host' && lobby.seats.length < 5 && (
          <button onClick={hostAddAISeat}>+ AI seat</button>
        )}
        <h3>Sets</h3>
        <div className="row">
          {LOBBY_SETS.filter((s) => (SETS as string[]).includes(s.id)).map((s) => (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={lobby.game.sets.includes(s.id)}
                onChange={() => toggleSet(s.id)}
                disabled={role !== 'host'}
              />{' '}
              {s.label}
            </label>
          ))}
        </div>
        {role === 'host' && (
          <div style={{ marginTop: 10 }}>
            <button className="primary" onClick={() => void hostStartGame()} disabled={!!problem}>
              Start game
            </button>{' '}
            {problem && <span className="error">{problem}</span>}
          </div>
        )}
        {connection === 'in-game' && <div className="muted">Game starting…</div>}
      </div>

      <div className="card">
        <h3>Chat</h3>
        <div className="log" style={{ maxHeight: 140 }}>
          {chat.map((m) => (
            <div key={m.id}>
              <b>{m.senderName}:</b> {m.text}
            </div>
          ))}
        </div>
        <ChatInput onSend={sendChat} />
      </div>
    </div>
  );
}

function ChatInput({ onSend }: { onSend: (text: string) => void }) {
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const input = (e.target as HTMLFormElement).elements.namedItem('msg') as HTMLInputElement;
        if (input.value.trim()) onSend(input.value);
        input.value = '';
      }}
    >
      <input name="msg" type="text" style={{ flex: 1 }} placeholder="Message…" />
      <button type="submit">Send</button>
    </form>
  );
}
