// Lightweight per-game metadata for the menu and lobby. Lives outside the
// game folders so importing it never drags a game's lazy chunk into the first
// page load (scripts/check-bundle.mjs enforces the split).
import type { GameId } from '@/net/types';

/** Wingspan card-set ids present in the card data (src/bundle.test.ts keeps this in sync). */
export const WINGSPAN_SETS: string[] = [
  'core',
  'european',
  'oceania',
  'asia',
  'americas',
  'promoUS',
  'promoEurope',
  'promoAsia',
  'promoNZ',
  'promoCA',
  'promoUK',
];

/** navarog's community card browsers — every card in each game. */
export const CARD_SEARCH: Record<GameId, { url: string; name: string }> = {
  wingspan: { url: 'https://navarog.github.io/wingsearch/', name: 'Wingsearch' },
  wyrmspan: { url: 'https://navarog.github.io/wyrmsearch/', name: 'Wyrmsearch' },
  finspan: { url: 'https://navarog.github.io/finsearch/', name: 'Finsearch' },
};
