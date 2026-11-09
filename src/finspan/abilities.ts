// Parses raw fish ability strings (icon tokens + English) into a structured
// effect list the engine can execute. Covers every distinct ability text in
// the generated data (base + Sharks & Reefs) — see the audit in AGENTS.md for
// the text conventions this relies on:
//   * "[CostIcon] also, if [XCoral]x3 in this dive site: [EffectIcon]"
//   * "N [Wave] if <cond>"
//   * "[FreePlayFishFromHand][X] only" / "[FreePlayFishFromHand][X]"
//   * "[EffectIcon] if no [AnyCoral] in this fish's dive site"
//   * "(all players) [Icon]... [AllPlayers]" — each player may take it
//   * "(all players) [XCoral][XCoral] [AllPlayers]" — card art duplicates the
//     icon (one per "player zone"); each player gains ONE coral.

import type { CardFilter, SiteColor, SlotFilter } from './types';

export type Effect =
  | { kind: 'draw' }
  /** [Discard] icon (sideways fish-skeleton card): gain a card from your
   *  discard pile to your hand (or draw from the deck if empty). */
  | { kind: 'discard' }
  | { kind: 'egg'; filter?: SlotFilter; onEach?: boolean }
  | { kind: 'hatch' }
  | { kind: 'young' }
  | { kind: 'move' }
  /** A fish consumes `n` shorter fish card(s) from hand. onto:'self' = the
   *  fish with this ability; 'any' = any fish in your ocean (you pick). */
  | { kind: 'consume'; onto: 'self' | 'any'; n: number }
  /** Play a fish from hand, paying its cost. `restrict` limits the slot. */
  | { kind: 'playFromHand'; restrict?: SlotFilter }
  /** Play a fish from hand for free; `filter` limits the card, `restrict` the slot. */
  | { kind: 'freePlayFromHand'; filter?: CardFilter; restrict?: SlotFilter }
  /** Discard a school -> 1 young in each of 4 different slots (else 1 young). */
  | { kind: 'unSchool' }
  /** Place 1 coral in the given dive site ('any' = choose a site). */
  | { kind: 'coral'; site: SiteColor | 'any' };

export type WaveCond =
  | { kind: 'noTokens' }
  | { kind: 'consumedAtLeast'; n: number }
  | { kind: 'exactlyYoung'; n: number }
  | { kind: 'schoolOnFish' }
  | { kind: 'bottomRow' }
  | { kind: 'eggYoungSchool' }
  /** "if [AnyCoral]xN in ALL your dive sites" — every site >= n. */
  | { kind: 'coralEachSiteAtLeast'; n: number }
  /** "if [AnyCoral]xN (in a dive site with at least n)" — this fish's site. */
  | { kind: 'coralThisSiteAtLeast'; n: number };

export interface ParsedAbility {
  /** "(all players)" — every player may gain the benefits. */
  allPlayers: boolean;
  /** The benefit sequence, in order. */
  effects: Effect[];
  /** IfActivated "also, if [X x3] in this dive site:" gated extra benefits. */
  alsoIf?: { site: SiteColor; count: number; effects: Effect[] };
  /** "if no [AnyCoral] in this fish's dive site" gate on the whole ability. */
  ifNoCoralThisSite?: boolean;
  /** GameEnd wave ability — scored at game end, never activated. */
  wave?: { points: number; cond: WaveCond };
}

const ICON_RE = /\[([^\]]+)\]/g;

const SIZE_ICONS: Record<string, 'small' | 'medium' | 'large'> = {
  FishLengthSmall: 'small',
  FishLengthMedium: 'medium',
  FishLengthLarge: 'large',
};

const TAG_ICONS = {
  Bioluminescent: 'bioluminescent',
  Camouflage: 'camouflage',
  Electric: 'electric',
  Predator: 'predator',
  Venomous: 'venomous',
} as const;

const SITE_ICONS = {
  FlipperBlue: 'blue',
  FlipperPurple: 'purple',
  FlipperGreen: 'green',
} as const;

const ZONE_ICONS = {
  Sun: 'sunlight',
  Dusk: 'twilight',
  Night: 'midnight',
} as const;

const CORAL_ICONS = {
  BlueCoral: 'blue',
  PurpleCoral: 'purple',
  GreenCoral: 'green',
} as const;

/** Is this icon a placement/fish criterion (never a standalone benefit)? */
function isCriterionIcon(icon: string): boolean {
  return (
    icon === 'Estuary' ||
    icon === 'PlayFishBottomRow' ||
    icon === 'TuckedCardSolo' ||
    icon in ZONE_ICONS ||
    icon in SITE_ICONS ||
    icon in TAG_ICONS ||
    icon in SIZE_ICONS ||
    icon === 'AnyCoral'
  );
}

/** Criterion icon -> SlotFilter key (location + fish properties). */
function applyCriterion(filter: SlotFilter, icon: string): SlotFilter | null {
  if (icon === 'Estuary') return { ...filter, estuary: true };
  if (icon === 'PlayFishBottomRow') return { ...filter, deepwater: true };
  if ((ZONE_ICONS as Record<string, string>)[icon])
    return { ...filter, zone: ZONE_ICONS[icon as keyof typeof ZONE_ICONS] };
  if ((SITE_ICONS as Record<string, string>)[icon])
    return { ...filter, bandSite: SITE_ICONS[icon as keyof typeof SITE_ICONS] };
  if ((TAG_ICONS as Record<string, string>)[icon])
    return { ...filter, tag: TAG_ICONS[icon as keyof typeof TAG_ICONS] };
  if ((SIZE_ICONS as Record<string, string>)[icon])
    return { ...filter, size: SIZE_ICONS[icon as keyof typeof SIZE_ICONS] };
  if (icon === 'AnyCoral')
    return { ...filter, coralAtLeast: (filter.coralAtLeast ?? 0) + 1 };
  return null;
}

/** Is the criterion a *location* restriction (destination slot) rather than a
 *  restriction on which card may be played? */
function isLocationCriterion(icon: string): boolean {
  return (
    icon === 'Estuary' ||
    icon === 'PlayFishBottomRow' ||
    icon === 'AnyCoral' ||
    icon in ZONE_ICONS ||
    icon in SITE_ICONS
  );
}

/** Criterion icon -> CardFilter key (for free-play "only" card restrictions). */
function applyCardCriterion(filter: CardFilter, icon: string): CardFilter | null {
  if ((TAG_ICONS as Record<string, string>)[icon])
    return { ...filter, tag: TAG_ICONS[icon as keyof typeof TAG_ICONS] };
  if ((SIZE_ICONS as Record<string, string>)[icon])
    return { ...filter, size: SIZE_ICONS[icon as keyof typeof SIZE_ICONS] };
  if (icon === 'TuckedCardSolo') return { ...filter, consumeOnly: true };
  return null;
}

function parseWaveCond(text: string): WaveCond | null {
  const t = text.trim();
  if (/no tokens on this fish/i.test(t)) return { kind: 'noTokens' };
  const consume = t.match(/\[ConsumeFish(\d)\]/);
  if (consume && /under this one/i.test(t)) return { kind: 'consumedAtLeast', n: Number(consume[1]) };
  if (/\[YoungFish\]\[YoungFish\]/.test(t) || /exactly 2/i.test(t)) return { kind: 'exactlyYoung', n: 2 };
  if (/\[FishEgg\].*\[YoungFish\].*\[SchoolFish\]/.test(t)) return { kind: 'eggYoungSchool' };
  if (/\[SchoolFish\]/.test(t)) return { kind: 'schoolOnFish' };
  if (/\[PlayFishBottomRow\]/.test(t) || /bottom row/i.test(t)) return { kind: 'bottomRow' };
  const corals = (t.match(/\[AnyCoral\]/g) ?? []).length;
  if (corals > 0 && /ALL your dive sites/i.test(t)) return { kind: 'coralEachSiteAtLeast', n: corals };
  if (corals > 0 && /dive site with at least/i.test(t)) return { kind: 'coralThisSiteAtLeast', n: corals };
  return null;
}

interface Token {
  icon: string;
  /** Literal text immediately before this icon (since the previous one). */
  before: string;
}

function tokenize(s: string): { tokens: Token[]; tail: string } {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  ICON_RE.lastIndex = 0;
  while ((m = ICON_RE.exec(s))) {
    tokens.push({ icon: m[1]!, before: s.slice(last, m.index) });
    last = m.index + m[0].length;
  }
  return { tokens, tail: s.slice(last) };
}

const warned = new Set<string>();
function warn(text: string, what: string) {
  if (!warned.has(text + '::' + what)) {
    warned.add(text + '::' + what);
    console.warn(`[finspan] ${what} in ability "${text}"`);
  }
}

/** Parse the main icon sequence of an ability (no wave / also-if handling). */
function parseEffectSeq(text: string): { effects: Effect[]; allPlayers: boolean } {
  const { tokens } = tokenize(text);
  const effects: Effect[] = [];
  let allPlayers = false;

  for (let i = 0; i < tokens.length; i++) {
    const { icon, before } = tokens[i]!;
    const prev = effects[effects.length - 1];

    switch (icon) {
      case 'DrawCard':
        effects.push({ kind: 'draw' });
        break;
      case 'Discard':
        effects.push({ kind: 'discard' });
        break;
      case 'FishHatch':
        effects.push({ kind: 'hatch' });
        break;
      case 'YoungFish':
        effects.push({ kind: 'young' });
        break;
      case 'SchoolFeederMove':
        effects.push({ kind: 'move' });
        break;
      case 'UnSchoolFish':
        effects.push({ kind: 'unSchool' });
        break;
      case 'FishEgg': {
        effects.push({ kind: 'egg' });
        break;
      }
      case 'ArrowDown': {
        // Consume the following run of adjacent criterion icons and attach
        // them to the previous effect (egg target filter / placement
        // restriction). AnyCoral icons count toward coralAtLeast.
        let filter: SlotFilter = {};
        let j = i + 1;
        while (j < tokens.length && tokens[j]!.before.trim() === '' && isCriterionIcon(tokens[j]!.icon)) {
          filter = applyCriterion(filter, tokens[j]!.icon) ?? filter;
          j++;
        }
        if (prev?.kind === 'egg') {
          prev.filter = filter;
          // Per rulebook iconography (fish_p12.png), [FishEgg][ArrowDown] always
          // means "put an egg on each of your fish that doesn't already have one
          // in the location shown or with the characteristic shown".
          prev.onEach = true;
        } else if (prev?.kind === 'playFromHand' || prev?.kind === 'freePlayFromHand') {
          prev.restrict = { ...(prev.restrict ?? {}), ...filter };
        } else {
          warn(text, '[ArrowDown] criteria without a target effect');
        }
        i = j - 1;
        break;
      }
      case 'FishFromHandConsume':
        effects.push({ kind: 'consume', onto: 'any', n: 1 });
        break;
      case 'FishFromHand':
        effects.push({ kind: 'playFromHand' });
        break;
      case 'FreePlayFishFromHand':
        effects.push({ kind: 'freePlayFromHand' });
        break;
      case 'BlueCoral':
      case 'PurpleCoral':
      case 'GreenCoral':
        effects.push({ kind: 'coral', site: CORAL_ICONS[icon] });
        break;
      case 'AnyCoral':
        effects.push({ kind: 'coral', site: 'any' });
        break;
      case 'AllPlayers':
        allPlayers = true;
        break;
      default:
        if (/^ConsumeFish\d$/.test(icon)) {
          effects.push({ kind: 'consume', onto: 'self', n: Number(icon.slice(-1)) });
        } else if (icon === 'Wave' || /^NoCost$|^StarterIcon$|^SRLogo$/.test(icon)) {
          // not a benefit icon
        } else if (isCriterionIcon(icon)) {
          // A criterion icon directly after a free-play benefit restricts it
          // ("[FreePlayFishFromHand][X] only" / "[FreePlayFishFromHand][X]").
          if (prev?.kind === 'freePlayFromHand' && before.trim() === '') {
            if (isLocationCriterion(icon)) {
              const f = applyCriterion(prev.restrict ?? {}, icon);
              if (f) prev.restrict = f;
            } else {
              const f = applyCardCriterion(prev.filter ?? {}, icon);
              if (f) prev.filter = f;
            }
          } else {
            warn(text, `stray criterion icon [${icon}]`);
          }
        } else {
          warn(text, `unknown icon [${icon}]`);
        }
    }
  }

  // "(all players)" coral benefits: the card art shows the coral icon once
  // per "player zone" (self + all), so adjacent identical coral icons are one
  // benefit each player may take. Collapse the duplicate.
  if (allPlayers) {
    for (let i = effects.length - 1; i > 0; i--) {
      const a = effects[i]!;
      const b = effects[i - 1]!;
      if (a.kind === 'coral' && b.kind === 'coral' && a.site === b.site) effects.splice(i, 1);
    }
  }

  return { effects, allPlayers };
}

const cache = new Map<string, ParsedAbility>();

/** Parse an ability string. Returns null for empty/missing text. */
export function parseAbility(raw: string | null): ParsedAbility | null {
  if (!raw) return null;
  const hit = cache.get(raw);
  if (hit) return hit;

  let text = raw.trim();
  const parsed: ParsedAbility = { allPlayers: false, effects: [] };

  // "(all players)" prefix.
  if (/^\(all players\)\s*/i.test(text)) {
    parsed.allPlayers = true;
    text = text.replace(/^\(all players\)\s*/i, '');
  }

  // "N [Wave] if ..." — pure game-end point text.
  const wave = text.match(/^(\d+)\s*\[Wave\]\s*if\s+(.+)$/i);
  if (wave) {
    const cond = parseWaveCond(wave[2]!);
    if (!cond) {
      warn(raw, `unparsed wave condition "${wave[2]}"`);
    } else {
      parsed.wave = { points: Number(wave[1]), cond };
      cache.set(raw, parsed);
      return parsed;
    }
  }

  // " if no [AnyCoral] in this fish's dive site" gate.
  const noCoral = text.match(/\s+if no \[AnyCoral\] in this fish's dive site\s*$/i);
  if (noCoral) {
    parsed.ifNoCoralThisSite = true;
    text = text.slice(0, noCoral.index).trim();
  }

  // " also, if [X][X][X] in this dive site: ..." two-part IfActivated text.
  const alsoIdx = text.search(/\s+also, if\s+/i);
  if (alsoIdx >= 0) {
    const second = text.slice(alsoIdx).replace(/\s*also, if\s+/i, '');
    text = text.slice(0, alsoIdx).trim();
    const m = second.match(/^((?:\[(?:BlueCoral|PurpleCoral|GreenCoral)\])+)\s*in this dive site:\s*(.+)$/i);
    if (!m) {
      warn(raw, `unparsed also-if clause "${second}"`);
    } else {
      const icons = [...m[1]!.matchAll(/\[(\w+Coral)\]/g)].map((x) => x[1]!);
      const site = icons[0]!.replace('Coral', '').toLowerCase() as SiteColor;
      const { effects } = parseEffectSeq(m[2]!);
      parsed.alsoIf = { site, count: icons.length, effects };
    }
  }

  const { effects, allPlayers } = parseEffectSeq(text);
  parsed.effects = effects;
  parsed.allPlayers = parsed.allPlayers || allPlayers;

  cache.set(raw, parsed);
  return parsed;
}
