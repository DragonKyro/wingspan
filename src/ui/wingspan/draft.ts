// Multi-click action drafts (play bird / lay eggs / gain food / draw cards)
// held by GameScreen while the player picks targets.

import type { BirdRef, Habitat } from '@/wingspan/types';

export type Draft =
  | { kind: 'playBird'; cardId: number; habitat: Habitat | null; coverTwo?: boolean }
  | { kind: 'gainFood'; reroll: boolean; picks: number[]; splitTake: 'invertebrate' | 'seed' }
  | { kind: 'layEggs'; placements: BirdRef[] }
  | { kind: 'drawCards'; picks: ('deck' | number)[] }
  | { kind: 'setup'; keepBirds: number[]; keepBonus: number | null };
