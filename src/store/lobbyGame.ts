// What the online lobby's choices mean for the game: the card sets in the
// deck and the seat range. Shared by networkStore (to start the game) and
// the lobby screen (to show it).

import { SETS } from '@/wingspan/cards';
import type { GameSettings } from '@/wingspan/types';
import type { LobbyGame, LobbyState } from '@/net/types';

/** Wingspan seats: official game is 1-5; an online room needs at least 2 seats. */
export const MIN_SEATS = 2;
export const MAX_SEATS = 5;

export const LOBBY_SETS: { id: string; label: string }[] = [
  { id: 'core', label: 'Base game' },
  { id: 'european', label: 'European' },
  { id: 'oceania', label: 'Oceania' },
  { id: 'asia', label: 'Asia' },
  { id: 'americas', label: 'The Americas' },
];

export function defaultLobbyGame(): LobbyGame {
  return { sets: ['core'] };
}

/** Strip unknown set ids; guarantee a non-empty, known deck. */
export function normalizeLobbyGame(game: LobbyGame): LobbyGame {
  const sets = (game?.sets ?? []).filter((s) => (SETS as string[]).includes(s));
  return { sets: sets.length ? sets : ['core'] };
}

export function lobbyGameLabel(game: LobbyGame): string {
  const g = normalizeLobbyGame(game);
  if (g.sets.length === 1 && g.sets[0] === 'core') return 'Base game';
  const names = g.sets.map((s) => LOBBY_SETS.find((x) => x.id === s)?.label ?? s);
  return names.join(' + ');
}

/** Why the host can't start yet, or null when they can. */
export function lobbyStartProblem(lobby: LobbyState): string | null {
  const n = lobby.seats.length;
  if (n >= MIN_SEATS && n <= MAX_SEATS) return null;
  return `Wingspan seats 2–${MAX_SEATS} players (${n} seated).`;
}

/** createGame settings for the lobby's choices. */
export function lobbySettings(lobby: LobbyState): Partial<GameSettings> {
  const game = normalizeLobbyGame(lobby.game);
  return {
    sets: game.sets,
    goalSide: 'green',
    aiLevel: lobby.aiLevel,
  };
}
