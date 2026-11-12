// Dragon Guild panel: the 12-space track (rewards + upcoming) and the guild tile.

import { GUILD_TILES, GUILD_TRACK } from '@/wyrmspan/guild';
import { player } from '@/wyrmspan/helpers';
import type { GameState, PlayerId } from '@/wyrmspan/types';
import { WyrmResourceIcon, playerColorHex } from '../svgArt';

/** Icon for a guild-track space, derived from its reward. */
function trackIcon(sp: { brown?: boolean; label: string }): string {
  if (sp.brown) return 'guild';
  const l = sp.label.toLowerCase();
  if (l.includes('dragon card')) return 'dragoncard';
  if (l.includes('cave card')) return 'cavecard';
  for (const k of ['egg', 'meat', 'gold', 'crystal', 'milk', 'coin']) if (l.includes(k)) return k;
  return 'any';
}

export function DragonGuildPanel({ state }: { state: GameState }) {
  const tile = GUILD_TILES[state.guild.tile];
  const n = GUILD_TRACK.length;
  const posOf = (pid: PlayerId) => state.guild.track[pid] ?? 0;
  return (
    <div className="card">
      <h3>
        <WyrmResourceIcon kind="guild" size={16} /> {tile?.name ?? state.guild.tile}
      </h3>
      <div className="muted" style={{ fontSize: '0.72rem', marginBottom: 6 }}>
        Each <WyrmResourceIcon kind="guild" size={12} /> moves you 1 space clockwise and gives that space&apos;s reward.{' '}
        <WyrmResourceIcon kind="guild" size={12} /> spaces = place a guild marker on the tile.
      </div>
      <div className="guild-track">
        {GUILD_TRACK.map((sp, i) => {
          const here = state.players.filter((p) => posOf(p.id) === i);
          const nextFor = state.players.filter((p) => (posOf(p.id) + 1) % n === i);
          return (
            <div
              key={i}
              className={`gt-space${sp.brown ? ' brown' : ''}${nextFor.length ? ' next' : ''}`}
              title={`Space ${i}: ${sp.label}${nextFor.length ? `\nNext reward for: ${nextFor.map((p) => p.name).join(', ')}` : ''}`}
            >
              <span className="gt-num">{i}</span>
              <WyrmResourceIcon kind={trackIcon(sp)} size={20} />
              <div className="gt-tokens">
                {here.map((p) => (
                  <span key={p.id} className="pcolor" style={{ background: playerColorHex(p.color) }} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="guild-upcoming">
        {state.players.map((p) => {
          const pos = posOf(p.id);
          return (
            <div key={p.id} className="guild-up-row">
              <span className="pcolor" style={{ background: playerColorHex(p.color) }} />
              <b>{p.name}</b>
              <span className="muted">
                space {pos} · {p.guildMarkersPlaced}/4 markers · next:
              </span>
              {[1, 2, 3].map((d) => {
                const sp = GUILD_TRACK[(pos + d) % n]!;
                return (
                  <span key={d} className={`guild-up-item${d === 1 ? ' first' : ''}`} title={`+${d}: ${sp.label}`}>
                    <WyrmResourceIcon kind={trackIcon(sp)} size={d === 1 ? 18 : 15} />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="guild-squares-list">
        {tile?.squares.map((sq, i) => {
          const occ = state.guild.squares[i] ?? [];
          return (
            <div key={i} className="guild-sq-row">
              <span className="guild-sq-label">{sq.label}</span>
              <div className="row">
                {occ.map((pid, k) => {
                  if (!pid) return null;
                  const pl = player(state, pid);
                  return (
                    <span key={k} className="pcolor" style={{ background: playerColorHex(pl.color) }} title={pl.name} />
                  );
                })}
                {occ.length === 0 && <span className="muted">open</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
