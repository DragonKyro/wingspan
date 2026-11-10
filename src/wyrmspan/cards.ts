// Typed accessors over the generated card database, plus the icon-token
// tokenizer shared by the ability parser.

import dataJson from './data/cards.json';
import type {
  AbilityType,
  CardDB,
  CaveCard,
  CaveId,
  DragonCard,
  DragonCond,
  GainItem,
  Resource,
} from './types';
import { CAVE_NAMES, RESOURCES } from './types';

const db = dataJson as unknown as CardDB;

export const DRAGONS: DragonCard[] = db.dragons;
export const CAVES: CaveCard[] = db.caves;

const dragonById = new Map<number, DragonCard>();
const caveById = new Map<number, CaveCard>();
for (const d of DRAGONS) dragonById.set(d.id, d);
for (const c of CAVES) caveById.set(c.id, c);

export function dragonCard(id: number): DragonCard {
  const c = dragonById.get(id);
  if (!c) throw new Error(`unknown dragon id ${id}`);
  return c;
}

export function caveCard(id: number): CaveCard {
  const c = caveById.get(id);
  if (!c) throw new Error(`unknown cave id ${id}`);
  return c;
}

export function isDragonCard(id: number): boolean {
  return dragonById.has(id);
}

export function cardName(id: number): string {
  const d = dragonById.get(id);
  if (d) return d.name;
  const c = caveById.get(id);
  if (c) return c.name ?? `Cave #${c.number}`;
  return `card ${id}`;
}

// ---------------------------------------------------------------------------
// Icon tokens: "[Meat]", "[Gold]", "[AnyResource]", "[DragonCard]",
// "[CaveCard]", "[Coin]", "[Egg]", "[DragonGuild]", "[VP-3]", "[FledglingArrow]",
// "[Adventurer]", "[WhenPlayed]", "[OncePerRound]", "[OncePerRound-v2]",
// "[EndGame]".

export type IconToken =
  | { kind: 'resource'; res: Resource | 'any' }
  | { kind: 'card'; deck: 'dragon' | 'cave' }
  | { kind: 'coin' }
  | { kind: 'egg' }
  | { kind: 'guild' }
  | { kind: 'vp'; count: number }
  | { kind: 'fledglingArrow' }
  | { kind: 'abilityType'; abilityType: AbilityType }
  | { kind: 'unknown'; raw: string };

const ICON_MAP: Record<string, IconToken> = {
  Meat: { kind: 'resource', res: 'meat' },
  Gold: { kind: 'resource', res: 'gold' },
  Crystal: { kind: 'resource', res: 'crystal' },
  Milk: { kind: 'resource', res: 'milk' },
  AnyResource: { kind: 'resource', res: 'any' },
  DragonCard: { kind: 'card', deck: 'dragon' },
  CaveCard: { kind: 'card', deck: 'cave' },
  Coin: { kind: 'coin' },
  Egg: { kind: 'egg' },
  DragonGuild: { kind: 'guild' },
  FledglingArrow: { kind: 'fledglingArrow' },
  Adventurer: { kind: 'abilityType', abilityType: 'Adventurer' },
  WhenPlayed: { kind: 'abilityType', abilityType: 'WhenPlayed' },
  OncePerRound: { kind: 'abilityType', abilityType: 'OncePerRound' },
  'OncePerRound-v2': { kind: 'abilityType', abilityType: 'OncePerRound' },
  EndGame: { kind: 'abilityType', abilityType: 'EndGame' },
};

export function parseIcons(text: string): IconToken[] {
  const out: IconToken[] = [];
  const re = /\[([^\]]+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const raw = m[1]!;
    const vp = /^VP-(\d+)$/.exec(raw);
    if (vp) {
      out.push({ kind: 'vp', count: Number(vp[1]) });
      continue;
    }
    out.push(ICON_MAP[raw] ?? { kind: 'unknown', raw });
  }
  return out;
}

/** Convert icon tokens into a GainItem list (each icon = one item unit). */
export function iconsToGains(tokens: IconToken[]): GainItem[] {
  const out: GainItem[] = [];
  for (const t of tokens) {
    switch (t.kind) {
      case 'resource':
        out.push({ kind: 'resource', res: t.res, count: 1 });
        break;
      case 'card':
        out.push({ kind: 'card', deck: t.deck, count: 1 });
        break;
      case 'coin':
        out.push({ kind: 'coin', count: 1 });
        break;
      case 'guild':
        out.push({ kind: 'guild', count: 1 });
        break;
      case 'egg':
        out.push({ kind: 'egg', count: 1 });
        break;
      case 'vp':
        out.push({ kind: 'vp', count: t.count });
        break;
      default:
        break; // eggs/arrows/ability-types never appear inside "gain" lists
    }
  }
  return mergeGains(out);
}

/** Merge adjacent identical items (e.g. two meat icons -> one count-2 item). */
export function mergeGains(items: GainItem[]): GainItem[] {
  const out: GainItem[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.kind === it.kind && sameItemKey(last) === sameItemKey(it)) {
      out[out.length - 1] = { ...last, count: last.count + it.count } as GainItem;
    } else {
      out.push(it);
    }
  }
  return out;
}

function sameItemKey(it: GainItem): string {
  switch (it.kind) {
    case 'resource':
      return `r:${it.res}`;
    case 'card':
      return `c:${it.deck}`;
    case 'coin':
      return 'coin';
    case 'guild':
      return 'guild';
    case 'egg':
      return 'egg';
    case 'tithe':
      return 'tithe';
    case 'item':
      return 'item';
    case 'vp':
      return 'vp';
  }
}

/** Parse a training-track icon string into per-box costs. Each [icon] = one box. */
export function parseTrainingTrack(text: string | null): GainItem[] {
  if (!text) return [];
  return parseIcons(text)
    .map((t): GainItem | null => {
      switch (t.kind) {
        case 'resource':
          return { kind: 'resource', res: t.res, count: 1 };
        case 'card':
          return { kind: 'card', deck: t.deck, count: 1 };
        case 'coin':
          return { kind: 'coin', count: 1 };
        case 'egg':
          return { kind: 'egg', count: 1 };
        default:
          return null;
      }
    })
    .filter((i): i is GainItem => i !== null);
}

/** Boxes on a fledgling's training track: one per cost ICON (not string length). */
export function trainingTrackLength(card: DragonCard): number {
  return card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
}

/** A Fledgling whose (non-empty) training track is fully trained. */
export function isFullyTrained(card: DragonCard, training = 0): boolean {
  const track = trainingTrackLength(card);
  return card.size === 'Fledgling' && track > 0 && training >= track;
}

// Re-export for convenience
export { CAVE_NAMES, RESOURCES };

// ---------------------------------------------------------------------------
// Misc card helpers

export function cardAbilityTypes(card: DragonCard): AbilityType[] {
  return card.abilityType.split(',').map((s) => s.trim() as AbilityType);
}

export function dragonMatchesCond(card: DragonCard, cond: DragonCond): boolean {
  if (cond.anyOf) return cond.anyOf.some((c) => dragonMatchesCond(card, c));
  if (cond.not) return !dragonMatchesCond(card, cond.not);
  if (cond.personality && card.personality !== cond.personality) return false;
  if (cond.size && card.size !== cond.size) return false;
  if (cond.sizeGroup === 'adult' && !(card.size === 'Small' || card.size === 'Medium' || card.size === 'Large'))
    return false;
  if (cond.sizeGroup === 'nonFledgling' && card.size === 'Fledgling') return false;
  if (cond.abilityType && !cardAbilityTypes(card).includes(cond.abilityType)) return false;
  if (cond.costHas) {
    const c = card.cost as Record<string, number | undefined>;
    if (!c[cond.costHas]) return false;
  }
  return true;
}

export function caveIdFromName(name: string): CaveId | null {
  for (const [id, n] of Object.entries(CAVE_NAMES) as [CaveId, string][]) {
    if (n === name) return id;
  }
  return null;
}
