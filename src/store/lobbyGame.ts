// What the online lobby's choices mean for the game: gameId, card sets/expansions,
// mode, and seat range. Shared by networkStore and the lobby screen.

import { WINGSPAN_SETS as SETS } from '@/games/catalog';
import type { GameSettings } from '@/wingspan/types';
import type { GameId, LobbyGame, LobbyState } from '@/net/types';

export const MIN_SEATS = 2;
export const MAX_SEATS = 7;

export const GAME_TITLES: Record<GameId, { name: string; subtitle: string; min: number; max: number }> = {
  wingspan: {
    name: 'Wingspan',
    subtitle: 'Build a thriving bird sanctuary across Forest, Grassland & Wetland habitats.',
    min: 1,
    max: 7,
  },
  wyrmspan: {
    name: 'Wyrmspan',
    subtitle: 'Excavate caverns, entice dragons, and explore the Dragon Guild.',
    min: 1,
    max: 5,
  },
  finspan: {
    name: 'Finspan',
    subtitle: 'Dive through Sunlight, Twilight & Midnight ocean zones and form schools.',
    min: 1,
    max: 5,
  },
};

export const LOBBY_SETS: { id: string; label: string }[] = [
  { id: 'core', label: 'Base game' },
  { id: 'european', label: 'European' },
  { id: 'oceania', label: 'Oceania' },
  { id: 'asia', label: 'Asia' },
  { id: 'americas', label: 'The Americas' },
];

export function defaultLobbyGame(gameId: GameId = 'wingspan'): LobbyGame {
  if (gameId === 'wyrmspan') {
    return { gameId: 'wyrmspan', sets: ['base'], expansions: ['base'] };
  }
  if (gameId === 'finspan') {
    return { gameId: 'finspan', sets: ['base'], achievementSide: 'A' };
  }
  return { gameId: 'wingspan', sets: ['core'], mode: 'standard', goalSide: 'green' };
}

/** Strip unknown set ids; guarantee a non-empty, known deck. */
export function normalizeLobbyGame(game: LobbyGame): LobbyGame {
  const gameId: GameId =
    game?.gameId === 'wyrmspan' || game?.gameId === 'finspan' ? game.gameId : 'wingspan';
  if (gameId === 'wyrmspan') {
    const exp = (game?.expansions ?? ['base', 'academy']).filter(
      (x): x is 'base' | 'academy' => x === 'base' || x === 'academy',
    );
    const expansions: ('base' | 'academy')[] = exp.includes('base') ? exp : ['base', ...exp];
    return { gameId: 'wyrmspan', sets: expansions, expansions };
  }
  if (gameId === 'finspan') {
    const sets = (game?.sets ?? ['base']).filter((s) => s === 'base' || s === 'sr');
    return {
      gameId: 'finspan',
      sets: sets.includes('base') ? sets : ['base', ...sets],
      achievementSide: game?.achievementSide === 'B' ? 'B' : 'A',
    };
  }
  const sets = (game?.sets ?? []).filter((s) => (SETS as string[]).includes(s));
  const mode = game?.mode === 'duet' || game?.mode === 'flock' ? game.mode : 'standard';
  const goalSide = game?.goalSide === 'blue' ? 'blue' : 'green';
  return {
    gameId: 'wingspan',
    sets: sets.length ? sets : ['core'],
    mode,
    goalSide,
  };
}

export function lobbyGameLabel(game: LobbyGame): string {
  const g = normalizeLobbyGame(game);
  if (g.gameId === 'wyrmspan') {
    return g.expansions?.includes('academy') ? 'Wyrmspan + Dragon Academy' : 'Wyrmspan (Base)';
  }
  if (g.gameId === 'finspan') {
    const sr = g.sets.includes('sr') ? ' + Sharks & Reefs' : '';
    return `Finspan${sr} (Side ${g.achievementSide ?? 'A'})`;
  }
  const names = g.sets.map((s) => LOBBY_SETS.find((x) => x.id === s)?.label ?? s);
  const modeLabel = g.mode === 'duet' ? ' · Duet' : g.mode === 'flock' ? ' · Flock' : '';
  return `Wingspan: ${names.join(' + ')}${modeLabel}`;
}

/** Why the host can't start yet, or null when they can. */
export function lobbyStartProblem(lobby: LobbyState): string | null {
  const g = normalizeLobbyGame(lobby.game);
  const n = lobby.seats.length;
  if (g.gameId === 'wyrmspan') {
    if (n < 2 || n > 5) return `Wyrmspan online rooms seat 2–5 players (${n} seated).`;
    return null;
  }
  if (g.gameId === 'finspan') {
    if (n < 2 || n > 5) return `Finspan online rooms seat 2–5 players (${n} seated).`;
    return null;
  }
  if (g.mode === 'duet') {
    if (n !== 2) return `Wingspan Duet Mode requires exactly 2 players (${n} seated).`;
    return null;
  }
  if (g.mode === 'flock') {
    if (n < 6 || n > 7) return `Wingspan Flock Mode requires 6–7 players (${n} seated).`;
    return null;
  }
  if (n >= MIN_SEATS && n <= 5) return null;
  return `Wingspan standard mode seats 2–5 players (${n} seated).`;
}

/** createGame settings for Wingspan lobby choices. */
export function lobbySettings(lobby: LobbyState): Partial<GameSettings> {
  const game = normalizeLobbyGame(lobby.game);
  return {
    sets: game.sets,
    goalSide: game.goalSide ?? 'green',
    mode: game.mode ?? 'standard',
    aiLevel: lobby.aiLevel,
  };
}
