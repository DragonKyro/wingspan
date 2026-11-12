// Persistent player identity. The UUID lives in localStorage and is reused
// forever for this browser profile so a player can rejoin a game with the
// same seat after refresh / network drop.
//
// For local testing with two browser windows that share localStorage
// (e.g. two tabs in the same incognito session), append `?fresh` to the URL
// to force a per-tab UUID via sessionStorage. This avoids both windows
// claiming the same seat.

const UUID_KEY = 'wingspan.uuid';
const NAME_KEY = 'wingspan.displayName';

export function freshTabMode(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const q = new URLSearchParams(window.location.search);
    return q.has('fresh');
  } catch {
    return false;
  }
}

export function getOrCreateUuid(): string {
  const fresh = freshTabMode();
  try {
    const storage = fresh ? sessionStorage : localStorage;
    const existing = storage.getItem(UUID_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : fallbackUuid();
    storage.setItem(UUID_KEY, next);
    return next;
  } catch {
    return fallbackUuid();
  }
}

// Useful from a settings/debug screen to recover from a UUID collision.
export function regenerateUuid(): string {
  const fresh =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : fallbackUuid();
  try {
    const storage = freshTabMode() ? sessionStorage : localStorage;
    storage.setItem(UUID_KEY, fresh);
  } catch {
    /* ignore */
  }
  return fresh;
}

export function getSavedDisplayName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveDisplayName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

function fallbackUuid(): string {
  // Decent uniqueness without Web Crypto. Good enough for friends' rooms.
  const rand = () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0');
  return `${rand()}-${rand()}-${rand()}-${rand()}`;
}

// Generate a short, friendly room code (4 uppercase letters/digits).
export function generateRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}
