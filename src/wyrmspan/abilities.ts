// Ability-text parser. Compiles each distinct printed ability string into the
// Step[] AST the interpreter in effects.ts executes. Texts that don't match a
// known pattern produce an `unsupported` step, which warns and no-ops at
// runtime rather than crashing (mirrors the wingspan engine's approach for
// unimplemented powers).
//
// Parsing strategy: ability text is normalized then split into sentences.
// Sentences are consumed left-to-right; at each position we first try to
// attach the sentence to the previous step(s) as a contextual continuation
// ("Each opponent may do this 1x", "You may tuck it here", "If you do, ..."),
// then try matchers against joins of the next 1..3 sentences (longest first)
// for patterns that legitimately span sentences ("Draw 3 cards. Keep 1 ...",
// "Reveal a card. If it is X, A. Otherwise, B.").

import { iconsToGains, parseIcons, type IconToken } from './cards';
import type {
  AbilityDef,
  AbilityType,
  CaveCard,
  Cond,
  Counter,
  DragonCard,
  DragonCond,
  DragonTarget,
  EggTarget,
  GainItem,
  Personality,
  Resource,
  Size,
  Step,
} from './types';

// ---------------------------------------------------------------------------
// Small parsing helpers

function iconsOf(text: string): GainItem[] {
  return iconsToGains(parseIcons(text));
}

/** Normalize punctuation the card DB is inconsistent about. */
function normalize(text: string): string {
  return text
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/]\s*benefit/gi, '] benefit')
    .trim();
}

/** Split ability text into sentences (each ending with '.'). */
function sentences(text: string): string[] {
  const norm = normalize(text);
  const parts = norm.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
  return parts.map((s) => (s.endsWith('.') ? s : s + '.'));
}

const CAPS: Record<string, Personality> = {
  SHY: 'Shy',
  PLAYFUL: 'Playful',
  HELPFUL: 'Helpful',
  AGGRESSIVE: 'Aggressive',
};

const SIZES: Record<string, Size> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  hatchling: 'Hatchling',
  fledgling: 'Fledgling',
};

function parsePersonality(word: string): Personality | null {
  return CAPS[word.toUpperCase()] ?? null;
}

/** Parse "medium", "small", "large", "hatchling", "fledgling" (+ '*x*' markup). */
function cleanWord(w: string): string {
  return w.replace(/\*/g, '').trim().toLowerCase();
}

function normAbilityType(raw: string): AbilityType {
  return raw === 'OncePerRound-v2' ? 'OncePerRound' : (raw as AbilityType);
}

const ICONS = '(?:\\[[^\\]]+\\]\\s*)+';

// ---------------------------------------------------------------------------
// Clause matchers. Each returns Step[] | null (null = no match). They run on
// capitalized, possibly multi-sentence fragments.

type ClauseResult = Step[] | null;
type Matcher = (s: string) => ClauseResult;

/** "Gain [X][Y]..." — pure gain sentences. */
const matchSimpleGain: Matcher = (s) => {
  const m = new RegExp(`^Gain (${ICONS})\\.$`).exec(s);
  if (!m) return null;
  return [{ op: 'gain', items: iconsOf(m[1]!) }];
};

/** "Gain [X]. Each/All opponent(s) [may] gain(s) [Z] (or [W])." */
const matchGainOpponents: Matcher = (s) => {
  let m = new RegExp(`^Gain (${ICONS})\\. (?:Each|All) opponents? gains? (${ICONS})\\.$`).exec(s);
  if (m) {
    return [
      { op: 'gain', items: iconsOf(m[1]!) },
      { op: 'opponentsGain', items: iconsOf(m[2]!) },
    ];
  }
  m = new RegExp(`^Gain (${ICONS})\\. (?:Each|All) opponents? may gain (${ICONS}) or (${ICONS})\\.$`).exec(s);
  if (m) {
    const options = [iconsOf(m[2]!), iconsOf(m[3]!)];
    return [
      { op: 'gain', items: iconsOf(m[1]!) },
      { op: 'opponentsMay', steps: [{ op: 'chooseBenefits', count: 1, options }] },
    ];
  }
  return null;
};

/** "Gain [X]. Each opponent lays [Egg]." */
const matchGainOppLay: Matcher = (s) => {
  const m = new RegExp(`^Gain (${ICONS})\\. Each opponent lays ((?:\\[Egg\\]\\s*)+)\\.$`).exec(s);
  if (!m) return null;
  const eggs = parseIcons(m[2]!).filter((t) => t.kind === 'egg').length;
  return [
    { op: 'gain', items: iconsOf(m[1]!) },
    { op: 'opponentsGain', items: [{ kind: 'egg', count: eggs }] },
  ];
};

/** "Gain <cond-gated> if X, and gain Y if Z." */
const matchGainIf: Matcher = (s) => {
  const m = new RegExp(`^Gain (${ICONS}) if (.*?)(?:, and gain (${ICONS}) if (.*?))?\\.$`).exec(s);
  if (!m) return null;
  const c1 = condOf(m[2]!);
  if (!c1) return null;
  const steps: Step[] = [{ op: 'if', cond: c1, then: [{ op: 'gain', items: iconsOf(m[1]!) }] }];
  if (m[3]) {
    const c2 = condOf(m[4]!);
    if (!c2) return null;
    steps.push({ op: 'if', cond: c2, then: [{ op: 'gain', items: iconsOf(m[3]!) }] });
  }
  return steps;
};

/** "Gain [X] then cache (up to N) [Y] from your supply onto any dragon." */
const matchGainThenCache: Matcher = (s) => {
  const m = new RegExp(
    `^Gain (${ICONS}) ?then cache (up to (\\d+) )?(${ICONS})from your supply onto any dragon\\.$`,
  ).exec(s);
  if (!m) return null;
  const upTo = m[2] !== undefined;
  const count = upTo ? Number(m[3]) : iconsOf(m[4]!).reduce((a, i) => a + i.count, 0);
  return [
    { op: 'gain', items: iconsOf(m[1]!) },
    { op: 'cache', count, res: 'any', from: 'supply', target: { kind: 'any' }, upTo },
  ];
};

/** "Lay [Egg]+ <target clause>." */
const matchLay: Matcher = (s) => {
  const m = /^Lay ((?:\[Egg\]\s*)+)(.*)\.$/.exec(s);
  if (!m) return null;
  const count = parseIcons(m[1]!).filter((t) => t.kind === 'egg').length;
  const rest = (m[2] ?? '').trim();
  const target = eggTargetOf(rest);
  if (!target) return null;
  return [{ op: 'layEggs', count, target }];
};

/** "Lay up to [Egg]+ <target>." */
const matchLayUpTo: Matcher = (s) => {
  const m = /^[Ll]ay up to ((?:\[Egg\]\s*)+)(.*)\.$/.exec(s);
  if (!m) return null;
  const count = parseIcons(m[1]!).filter((t) => t.kind === 'egg').length;
  const target = eggTargetOf((m[2] ?? '').trim()) ?? { kind: 'any' };
  return [{ op: 'layEggs', count, target }];
};

/** "Lay N [Egg] for each X." */
const matchLayPer: Matcher = (s) => {
  const m = /^[Ll]ay (\d+ )?((?:\[Egg\]\s*)+)for each (.*)\.$/.exec(s);
  if (!m) return null;
  const per = m[1] ? Number(m[1]) : parseIcons(m[2]!).filter((t) => t.kind === 'egg').length;
  const counter = counterOf(m[3]!);
  if (!counter) return null;
  const target: EggTarget =
    counter.kind === 'fullyTrainedFledglings'
      ? { kind: 'eachFullyTrainedFledgling' }
      : counter.kind === 'fledglingCount'
        ? { kind: 'eachFledgling' }
        : { kind: 'any' };
  return [{ op: 'layPer', counter, per, target }];
};

function eggTargetOf(rest: string): EggTarget | null {
  switch (rest) {
    case '':
      return { kind: 'any' };
    case 'here':
      return { kind: 'here' };
    case 'anywhere in this cave':
      return { kind: 'thisCave' };
    case 'on any dragon in this column':
      return { kind: 'thisColumn' };
    case 'on any orthogonally adjacent dragon':
      return { kind: 'orthAdjacent' };
    case 'on each *fledgling* on your player mat':
    case 'on each fledgling on your player mat':
      return { kind: 'eachFledgling' };
    case 'on each dragon in this column':
      return { kind: 'eachInColumn' };
    case 'on each dragon in this row':
      return { kind: 'eachInRow' };
    case 'on each fully trained *fledgling*':
    case 'on each fully trained fledgling':
      return { kind: 'eachFullyTrainedFledgling' };
    case 'on each dragon in this cave':
      return { kind: 'eachInCave' };
  }
  let m = /^on each (\w+) dragon in this cave$/.exec(rest);
  if (m) {
    const p = parsePersonality(m[1]!);
    if (p) return { kind: 'eachInCave', cond: { personality: p } };
  }
  m = /^on each dragon in this cave that is not (\w+)$/.exec(rest);
  if (m) {
    const p = parsePersonality(m[1]!);
    if (p) return { kind: 'eachInCave', cond: { not: { personality: p } } };
  }
  return null;
}

/** "Cache (up to N) (N) <icons> from (your|the general) supply <target>." */
const matchCache: Matcher = (s) => {
  const m = new RegExp(
    `^Cache (up to (\\d+) )?(\\d+ )?(${ICONS})from (your|the general) supply ` +
      `(here|onto any dragon|onto any dragon in this column|onto any orthogonally adjacent dragon|` +
      `onto any dragon\\(s\\)|onto each (\\w+) dragon in this cave)\\.$`,
  ).exec(s);
  if (!m) return null;
  const upTo = m[1] !== undefined;
  const icons = parseIcons(m[4]!);
  const resTokens = icons.filter((t): t is Extract<IconToken, { kind: 'resource' }> => t.kind === 'resource');
  const count = m[3] ? Number(m[3]) : upTo ? Number(m[2]) : resTokens.length || 1;
  const res: Resource | 'any' =
    resTokens.length === 1 && resTokens[0]!.res !== 'any' ? resTokens[0]!.res : 'any';
  const from = m[5] === 'your' ? 'supply' : 'general';
  const where = m[6]!;
  let target: DragonTarget;
  if (where === 'here') target = { kind: 'here' };
  else if (where === 'onto any dragon in this column') target = { kind: 'thisColumn' };
  else if (where === 'onto any orthogonally adjacent dragon') target = { kind: 'orthAdjacent' };
  else if (where.startsWith('onto each')) {
    const p = parsePersonality(m[7]!);
    if (!p) return null;
    target = { kind: 'eachInCave', cond: { personality: p } };
  } else target = { kind: 'any' };
  return [{ op: 'cache', count, res, from, target, upTo }];
};

/** "Tuck (up to N) (N) <icons> from (your hand|the deck|your supply) <target>." */
const matchTuck: Matcher = (s) => {
  const m = new RegExp(
    `^Tuck (up to (\\d+) )?(\\d+ )?(${ICONS})from (your hand|the deck|your supply) ` +
      `(here|under any dragon|under any dragon in this column|under any orthogonally adjacent dragon|` +
      `under any dragon\\(s\\)|behind any dragon\\(s\\)|under each (\\w+) dragon in this cave)\\.$`,
  ).exec(s);
  if (!m) return null;
  const upTo = m[1] !== undefined;
  const icons = parseIcons(m[4]!);
  const cards = icons.filter((t) => t.kind === 'card').length;
  const count = m[3] ? Number(m[3]) : upTo ? Number(m[2]) : cards || icons.length || 1;
  const src = m[5]!;
  const from = src === 'the deck' ? 'deck' : 'hand'; // "your supply" ~= hand for cards
  const where = m[6]!;
  let target: DragonTarget;
  if (where === 'here') target = { kind: 'here' };
  else if (where === 'under any dragon in this column') target = { kind: 'thisColumn' };
  else if (where === 'under any orthogonally adjacent dragon') target = { kind: 'orthAdjacent' };
  else if (where.startsWith('under each')) {
    const p = parsePersonality(m[7]!);
    if (!p) return null;
    target = { kind: 'eachInCave', cond: { personality: p } };
  } else target = { kind: 'any' };
  return [{ op: 'tuck', count, from, target, upTo }];
};

/** "Tuck (N) [DragonCard] from <src> <target> for each <counter>." */
const matchTuckPer: Matcher = (s) => {
  const m = new RegExp(
    `^Tuck (\\d+ )?(${ICONS})from (your hand|the deck) (here|under any dragon) for each (.*)\\.$`,
  ).exec(s);
  if (!m) return null;
  const cards = parseIcons(m[2]!).filter((t) => t.kind === 'card').length;
  const per = m[1] ? Number(m[1]) : cards || 1;
  const counter = counterOf(m[5]!);
  if (!counter) return null;
  return [
    {
      op: 'tuckPer',
      counter,
      per,
      from: m[3] === 'the deck' ? 'deck' : 'hand',
      target: m[4] === 'here' ? { kind: 'here' } : { kind: 'any' },
    },
  ];
};

/** "Tuck [DragonCard] from your hand here to gain [X] of the cost printed on the tucked dragon." */
const matchTuckGainCost: Matcher = (s) => {
  const m = new RegExp(
    `^Tuck (${ICONS})from your hand here to gain (${ICONS})of the cost printed on the tucked dragon\\.$`,
  ).exec(s);
  if (!m) return null;
  return [
    { op: 'tuck', count: 1, from: 'hand', target: { kind: 'here' } },
    { op: 'gain', items: [{ kind: 'resource', res: 'any', count: 1 }] },
  ];
};

/** "Lay [Egg] on each dragon in this column or each dragon in this row." */
const matchLayColumnOrRow: Matcher = (s) => {
  const m = /^Lay ((?:\[Egg\]\s*)+)on each dragon in this (column|row) or each dragon in this (column|row)\.$/.exec(
    s,
  );
  if (!m) return null;
  const count = parseIcons(m[1]!).filter((t) => t.kind === 'egg').length;
  const tgt = (w: string): EggTarget => (w === 'column' ? { kind: 'eachInColumn' } : { kind: 'eachInRow' });
  return [
    {
      op: 'chooseOption',
      options: [
        { label: 'column', steps: [{ op: 'layEggs', count, target: tgt(m[2]!) }] },
        { label: 'row', steps: [{ op: 'layEggs', count, target: tgt(m[3]!) }] },
      ],
    },
  ];
};

/** "Pay <icons> to gain ..." incl. tiered costs and different-benefits. */
const matchPayGain: Matcher = (s) => {
  // Tiered VP: "Pay X to gain [VP-1] or pay XX to gain [VP-3]."
  let m = /^Pay (.*?) to gain (\[VP-\d+\]) or pay (.*?) to gain (\[VP-\d+\])\.$/.exec(s);
  if (m) {
    const c1 = payCostOf(m[1]!);
    const c2 = payCostOf(m[3]!);
    if (c1 && c2) {
      return [
        { op: 'pay', cost: c1, then: [{ op: 'gain', items: iconsOf(m[2]!) }] },
        { op: 'pay', cost: c2, then: [{ op: 'gain', items: iconsOf(m[4]!) }] },
      ];
    }
  }
  m = /^Pay (.*?) to gain 2 different benefits: (.*)\.$/.exec(s);
  if (m) {
    const cost = payCostOf(m[1]!);
    if (!cost) return null;
    const options = m[2]!.split('/').map((part) => iconsOf(part));
    return [{ op: 'pay', cost, then: [{ op: 'chooseBenefits', count: 2, options }] }];
  }
  m = new RegExp(`^Pay (.*?) to gain (${ICONS})\\.$`).exec(s);
  if (m) {
    const cost = payCostOf(m[1]!);
    if (cost) return [{ op: 'pay', cost, then: [{ op: 'gain', items: iconsOf(m[2]!) }] }];
  }
  // "Pay X to gain <icons> and <more clauses>."
  m = new RegExp(`^Pay (.*?) to gain (${ICONS})and (.*)\\.$`).exec(s);
  if (m) {
    const cost = payCostOf(m[1]!);
    if (!cost) return null;
    const inner = parseClauses(m[3]! + '.');
    if (inner === null) return null;
    return [{ op: 'pay', cost, then: [{ op: 'gain', items: iconsOf(m[2]!) }, ...inner] }];
  }
  return null;
};

/** "Pay X, then <anything>." */
const matchPayThen: Matcher = (s) => {
  const m = /^Pay (.*?), then (.*)\.$/.exec(s);
  if (!m) return null;
  const cost = payCostOf(m[1]!);
  if (!cost) return null;
  const inner = parseClauses(m[2]! + '.');
  if (inner === null) return null;
  return [{ op: 'pay', cost, then: inner }];
};

/** "Pay X or Y to <verb>." (either/or cost) */
const matchPayEitherOr: Matcher = (s) => {
  const m = new RegExp(`^Pay (${ICONS})or (${ICONS})to (.*)\\.$`).exec(s);
  if (!m) return null;
  const c1 = payCostOf(m[1]!);
  const c2 = payCostOf(m[2]!);
  if (!c1 || !c2) return null;
  const inner = parseClauses(m[3]! + '.');
  if (inner === null) return null;
  return [
    {
      op: 'chooseOption',
      options: [
        { label: `pay ${m[1]!.trim()}`, steps: [{ op: 'pay', cost: c1, then: inner }] },
        { label: `pay ${m[2]!.trim()}`, steps: [{ op: 'pay', cost: c2, then: inner }] },
      ],
    },
  ];
};

/** "Pay X to <verb-clause>." */
const matchPayVerb: Matcher = (s) => {
  const m = /^Pay (.*?) to (.*)\.$/.exec(s);
  if (!m) return null;
  if (/^gain /.test(m[2]!)) return null; // handled by matchPayGain
  const cost = payCostOf(m[1]!);
  if (!cost) return null;
  const inner = parseClauses(m[2]! + '.');
  if (inner === null) return null;
  return [{ op: 'pay', cost, then: inner }];
};

/** Parse a printed cost clause into GainItem costs. */
function payCostOf(text: string): GainItem[] | null {
  const t = text.trim();
  const m = /^((?:\[[^\]]+\]\s*)*?)(?:\s+from .*)?$/.exec(t);
  if (!m) return null;
  const icons = parseIcons(m[1]!);
  const out: GainItem[] = [];
  for (const ic of icons) {
    switch (ic.kind) {
      case 'resource':
        out.push({ kind: 'resource', res: ic.res, count: 1 });
        break;
      case 'card':
        out.push({ kind: 'card', deck: ic.deck, count: 1 });
        break;
      case 'coin':
        out.push({ kind: 'coin', count: 1 });
        break;
      case 'egg':
        out.push({ kind: 'egg', count: 1 });
        break;
      default:
        return null;
    }
  }
  return out.length ? out : null;
}

/** "Up to Nx, ..." family. */
const matchUpToX: Matcher = (s) => {
  let m = /^Up to (\d+)x, pay (.*?) to (.*)\. Each opponent may do this 1x\.$/.exec(s);
  if (m) {
    const cost = payCostOf(m[2]!);
    if (!cost) return null;
    const inner = parseClauses(m[3]! + '.');
    if (inner === null) return null;
    return [
      { op: 'pay', cost, then: inner, repeat: Number(m[1]) },
      { op: 'opponentsMay', steps: [{ op: 'pay', cost, then: inner }] },
    ];
  }
  m = /^Up to (\d+)x, pay (.*?) to (.*)\.$/.exec(s);
  if (m) {
    const cost = payCostOf(m[2]!);
    if (!cost) return null;
    const inner = parseClauses(m[3]! + '.');
    if (inner === null) return null;
    return [{ op: 'pay', cost, then: inner, repeat: Number(m[1]) }];
  }
  m = new RegExp(
    `^Up to (\\d+)x, tuck (${ICONS})from your hand here\\. Each time you do, gain (${ICONS})\\.$`,
  ).exec(s);
  if (m) {
    const cost = payCostOf(m[2]!);
    if (!cost) return null;
    return [
      {
        op: 'pay',
        cost,
        then: [
          { op: 'tuck', count: 1, from: 'hand', target: { kind: 'here' } },
          { op: 'gain', items: iconsOf(m[3]!) },
        ],
        repeat: Number(m[1]),
      },
    ];
  }
  // Generic: "Up to Nx, <clause>" — offer the clause up to N times.
  m = /^Up to (\d+)x, (.*)\.$/.exec(s);
  if (m) {
    const inner = parseClauses(m[2]! + '.');
    if (inner === null) return null;
    return [{ op: 'repeat', times: Number(m[1]), steps: inner }];
  }
  return null;
};

/** "Draw ..." family. */
const matchDraw: Matcher = (s) => {
  // "Draw [D] from the deck for each X in this cave. You may tuck up to 2 of them here."
  let m = new RegExp(
    `^Draw (${ICONS})from the deck for each (.*?) in this cave\\. You may tuck up to (\\d+) of them here\\.$`,
  ).exec(s);
  if (m) {
    const cond = dragonCondOf(m[2]!);
    if (!cond) return null;
    return [
      {
        op: 'drawPer',
        counter: { kind: 'dragons', where: 'cave', cond },
        deck: 'dragon',
        tuck: Number(m[3]),
        tuckTarget: { kind: 'here' },
      },
    ];
  }
  m = new RegExp(`^Draw (${ICONS})from the deck for each (.*?) in this cave\\.$`).exec(s);
  if (m) {
    const cond = dragonCondOf(m[2]!);
    if (!cond) return null;
    return [
      { op: 'drawPer', counter: { kind: 'dragons', where: 'cave', cond }, deck: 'dragon' },
    ];
  }
  // "Draw (N) [cards] from the deck. <distribution>."
  m = new RegExp(`^Draw (\\d+ )?(${ICONS})from the deck\\. (.*)\\.$`).exec(s);
  if (m) {
    const deck: 'dragon' | 'cave' = /CaveCard/.test(m[2]!) ? 'cave' : 'dragon';
    const count = m[1] ? Number(m[1]) : parseIcons(m[2]!).filter((t) => t.kind === 'card').length;
    const dist = m[3]!;
    let dm: RegExpExecArray | null;
    if ((dm = /^Keep 1, discard 1, and tuck 1 (here|under any dragon)$/.exec(dist))) {
      return [
        {
          op: 'drawDistribute',
          deck,
          count,
          keep: 1,
          discard: 1,
          tuck: 1,
          tuckTarget: dm[1] === 'here' ? { kind: 'here' } : { kind: 'any' },
        },
      ];
    }
    if ((dm = /^Play 1 for free and (discard|keep) the other (\d+)$/.exec(dist))) {
      return [
        {
          op: 'drawDistribute',
          deck,
          count,
          playFree: 1,
          keep: dm[1] === 'keep' ? Number(dm[2]) : undefined,
          discard: dm[1] === 'discard' ? Number(dm[2]) : undefined,
        } as Step,
      ];
    }
    if ((dm = /^Keep 1 and tuck the other (\d+) here$/.exec(dist))) {
      return [{ op: 'drawDistribute', deck, count, keep: 1, tuck: Number(dm[1]), tuckTarget: { kind: 'here' } }];
    }
    if (/^Keep 1 and tuck 1 under any dragon$/.test(dist)) {
      return [{ op: 'drawDistribute', deck, count, keep: 1, tuck: 1, tuckTarget: { kind: 'any' } }];
    }
    return null;
  }
  // Standalone "Draw (N) [cards] from the deck." — straight to hand.
  m = new RegExp(`^Draw (\\d+ )?(${ICONS})from the deck\\.$`).exec(s);
  if (m) {
    const items = iconsOf(m[2]!).map((it) =>
      it.kind === 'card' && m[1] ? { ...it, count: it.count * Number(m[1]) } : it,
    );
    return [{ op: 'gain', items }];
  }
  return null;
};

/** Sub-clause of a reveal: what to do with the revealed card. */
function revealClause(text: string): Step[] | null {
  const t = text.trim().replace(/\.$/, '');
  if (/^tuck it here$/.test(t)) return [{ op: 'tuckRevealed', target: { kind: 'here' } }];
  if (/^tuck it under any dragon$/.test(t)) return [{ op: 'tuckRevealed', target: { kind: 'any' } }];
  if (/^add it to your hand$/.test(t) || /^keep it$/.test(t)) return [{ op: 'keepRevealed' }];
  if (/^discard it$/.test(t)) return [{ op: 'discardRevealed' }];
  let m = /^keep it and lay (\d+ )?((?:\[Egg\]\s*)+)(.*)$/.exec(t);
  if (m) {
    const n = m[1] ? Number(m[1]) : parseIcons(m[2]!).filter((i) => i.kind === 'egg').length;
    const target = eggTargetOf((m[3] ?? '').trim()) ?? { kind: 'any' };
    return [{ op: 'keepRevealed' }, { op: 'layEggs', count: n, target }];
  }
  m = /^lay (\d+ )?((?:\[Egg\]\s*)+)(.*)$/.exec(t);
  if (m) {
    const n = m[1] ? Number(m[1]) : parseIcons(m[2]!).filter((i) => i.kind === 'egg').length;
    const target = eggTargetOf((m[3] ?? '').trim()) ?? { kind: 'any' };
    return [{ op: 'layEggs', count: n, target }];
  }
  m = new RegExp(`^discard it and gain (${ICONS})$`).exec(t);
  if (m) return [{ op: 'discardRevealed' }, { op: 'gain', items: iconsOf(m[1]!) }];
  m = /^discard it and lay (\d+ )?((?:\[Egg\]\s*)+)(.*)$/.exec(t);
  if (m) {
    const n = m[1] ? Number(m[1]) : parseIcons(m[2]!).filter((i) => i.kind === 'egg').length;
    const target = eggTargetOf((m[3] ?? '').trim()) ?? { kind: 'any' };
    return [{ op: 'discardRevealed' }, { op: 'layEggs', count: n, target }];
  }
  m = new RegExp(`^gain (${ICONS})$`).exec(t);
  if (m) return [{ op: 'gain', items: iconsOf(m[1]!) }];
  if (/^fully train it$/.test(t)) return [{ op: 'keepRevealed' }]; // approximate: keep the fledgling
  const inner = parseClauses(t + '.');
  return inner;
}

/** "Reveal [DragonCard] from the deck. If it is X, A. Otherwise, B." */
const matchReveal: Matcher = (s) => {
  let m = /^Reveal \[DragonCard\] from the deck\. If it is (.*?), (.*?)\. Otherwise,? (.*?)\.$/.exec(s);
  if (!m) {
    // "Reveal [D] from the deck. If it is a *fledgling*, keep it and lay 1 [Egg] here."
    m = /^Reveal \[DragonCard\] from the deck\. If it is (.*?), (.*?)\.$/.exec(s);
    if (!m) return null;
    const cond = revealCondOf(m[1]!);
    if (cond === null) return null;
    const yes = revealClause(m[2]!);
    if (yes === null) return null;
    return [{ op: 'reveal', cond, yes, no: [{ op: 'discardRevealed' }] }];
  }
  const cond = revealCondOf(m[1]!);
  if (cond === null) return null;
  const yes = revealClause(m[2]!);
  const no = revealClause(m[3]!);
  if (yes === null || no === null) return null;
  return [{ op: 'reveal', cond, yes, no }];
};

function revealCondOf(text: string): DragonCond | null {
  const t = cleanWord(text);
  if (t.includes(' or ')) {
    const parts = t.split(' or ').map((p) => cleanWord(p).replace(/^a /, ''));
    const conds: DragonCond[] = [];
    for (const p of parts) {
      const sz = SIZES[p];
      if (!sz) return null;
      conds.push({ size: sz });
    }
    return { anyOf: conds };
  }
  const p = parsePersonality(text);
  if (p) return { personality: p };
  const size = SIZES[t.replace(/^a /, '')];
  if (size) return { size };
  return null;
}

/** "Excavate N space(s) for free with [CaveCard] from X." + deck/display variants. */
const matchExcavateFree: Matcher = (s) => {
  const t = s.replace(/\.$/, '');
  let m = /^[Ee]xcavate (?:1|(\d+)) spaces? for free with \[CaveCard\] from (your hand|the display)$/.exec(t);
  if (m) {
    const count = m[1] ? Number(m[1]) : 1;
    return [{ op: 'excavateFree', source: m[2] === 'the display' ? 'display' : 'hand', count }];
  }
  if (/^[Dd]raw \[CaveCard\] from the deck and immediately play it for free$/.test(t)) {
    return [{ op: 'excavateFree', source: 'deck', count: 1 }];
  }
  if (/^[Gg]ain \[CaveCard\] from the display and immediately play it for free$/.test(t)) {
    return [{ op: 'excavateFree', source: 'display', count: 1 }];
  }
  return null;
};

/** "Play [DragonCard] ..." free/discounted plays. */
const matchPlayDragon: Matcher = (s) => {
  const t = s.replace(/\.$/, '');
  let m = /^(?:Then,? )?[Pp]lay (?:another )?(?:a )?(?:\[DragonCard\]|dragon) from (your hand|the display|your hand or the display) for free$/.exec(
    t,
  );
  if (m) {
    const src = m[1]!;
    return [
      {
        op: 'playDragonFree',
        source: src === 'the display' ? 'display' : src === 'your hand' ? 'hand' : 'handOrDisplay',
      },
    ];
  }
  if (/^Immediately play \[DragonCard\] with a discount of 1 \[Egg\] or \[AnyResource\]$/.test(t)) {
    return [
      {
        op: 'playDragonFree',
        source: 'handOrDisplay',
        discount: [[{ kind: 'egg', count: 1 }], [{ kind: 'resource', res: 'any', count: 1 }]],
      },
    ];
  }
  if (/^[Pp]lay \[DragonCard\] from your hand$/.test(t)) {
    return [{ op: 'playDragonFree', source: 'hand', discount: 'full' }];
  }
  return null;
};

/** "Activate ... ability/abilities ..." */
const matchActivate: Matcher = (s) => {
  const t = s.replace(/\.$/, '');
  let m = /^Activate (?:1 )?\[(Adventurer|OncePerRound|OncePerRound-v2|WhenPlayed)\] or \[(Adventurer|OncePerRound|WhenPlayed)\] ability on any dragon on your player mat$/.exec(
    t,
  );
  if (m) {
    const kinds = [m[1]!, m[2]!].filter(Boolean).map(normAbilityType);
    return [{ op: 'activateAbility', kinds, count: 1 }];
  }
  m = /^Activate any (\d+) \[(OncePerRound|Adventurer|WhenPlayed)\] abilities on dragons on your player mat$/.exec(t);
  if (m) {
    return [{ op: 'activateAbility', kinds: [normAbilityType(m[2]!)], count: Number(m[1]) }];
  }
  m = /^Activate (\d+) different \[(Adventurer|WhenPlayed|OncePerRound)\] abilities printed on your player mat$/.exec(
    t,
  );
  if (m) {
    return [
      { op: 'activateAbility', kinds: [normAbilityType(m[2]!)], count: Number(m[1]), distinct: true, printedOnMat: true },
    ];
  }
  m = /^Activate (\d+) \[(Adventurer|WhenPlayed|OncePerRound)\] ability that is printed on your player mat$/.exec(t);
  if (m) {
    return [{ op: 'activateAbility', kinds: [normAbilityType(m[2]!)], count: Number(m[1]), printedOnMat: true }];
  }
  m = /^Activate the \[(Adventurer|OncePerRound-v2|OncePerRound|WhenPlayed)\] ability on (up to 2|any) dragons? on your player mat$/.exec(
    t,
  );
  if (m) {
    const count = m[2] === 'up to 2' ? 2 : 1;
    return [{ op: 'activateAbility', kinds: [normAbilityType(m[1]!)], count }];
  }
  m = /^Activate the \[(Adventurer|WhenPlayed|OncePerRound)\] abilities? on all orthogonally adjacent dragons$/.exec(t);
  if (m) {
    return [{ op: 'activateAbility', kinds: [normAbilityType(m[1]!)], count: 4 }];
  }
  return null;
};

/** "Discard [X] from your hand to <benefit>." */
const matchDiscardForBenefit: Matcher = (s) => {
  let m = /^Discard \[(DragonCard|CaveCard)\] from your hand to gain its \[(WhenPlayed)\] benefit\.$/.exec(s);
  if (m) {
    return [
      {
        op: 'discardFromHand',
        what: m[1] === 'CaveCard' ? 'cave' : 'dragon',
        count: 1,
        then: [{ op: 'activateAbility', kinds: ['WhenPlayed'], count: 1 }],
      },
    ];
  }
  m = /^Discard \[(DragonCard|CaveCard)\] from your hand to (.*)\.$/.exec(s);
  if (m) {
    const inner = parseClauses(m[2]! + '.');
    if (inner === null) return null;
    return [
      {
        op: 'discardFromHand',
        what: m[1] === 'CaveCard' ? 'cave' : 'dragon',
        count: 1,
        then: inner,
      },
    ];
  }
  return null;
};

/** Train fledgling clauses. */
const matchTrain: Matcher = (s) => {
  const t = s.replace(/\.$/, '');
  let m = /^[Tt]rain any \*?fledgling\*? (?:on your player mat )?(?:up to )?(\d+)x for free, then (.*)$/.exec(t);
  if (m) {
    const inner = parseClauses(m[2]! + '.');
    if (inner === null) return null;
    return [
      { op: 'trainFledgling', times: Number(m[1]), free: true, target: 'any' },
      ...inner,
    ];
  }
  m = /^[Tt]rain any \*?fledgling\*? (?:on your player mat )?(?:up to )?(\d+)x for free$/.exec(t);
  if (m) {
    return [{ op: 'trainFledgling', times: Number(m[1]), free: true, target: 'any' }];
  }
  m = /^[Ff]ully train any \*?fledgling\*?(?: on your player mat)? for free\.? ?(.*)$/.exec(s);
  if (m) {
    const rest = (m[1] ?? '').replace(/\.$/, '').trim();
    const steps: Step[] = [{ op: 'trainFledgling', times: 'full', free: true, target: 'any' }];
    if (/^If you do, also lay ((?:\[Egg\]\s*)+)$/.test(rest)) {
      const em = /^If you do, also lay ((?:\[Egg\]\s*)+)$/.exec(rest)!;
      const n = parseIcons(em[1]!).filter((i) => i.kind === 'egg').length;
      steps.push({ op: 'layEggs', count: n, target: { kind: 'any' } });
      return steps;
    }
    if (/^All others may train any \*?fledgling\*? 1x for free$/.test(rest)) {
      steps.push({
        op: 'opponentsMay',
        steps: [{ op: 'trainFledgling', times: 1, free: true, target: 'any' }],
      });
      return steps;
    }
    if (rest === '') return steps;
    return null;
  }
  if (/^[Ff]ully train any \*?fledgling\*?(?: on your player mat)?$/.test(t)) {
    return [{ op: 'trainFledgling', times: 'full', free: true, target: 'any' }];
  }
  if (/^[Tt]rain all orthogonally adjacent \*?fledgling\*?s 1x for free$/.test(t)) {
    return [{ op: 'trainFledgling', times: 1, free: true, target: 'orthAdjacent' }];
  }
  return null;
};

/** "Gain the item covered by the training token." */
const matchGainCovered: Matcher = (s) => {
  if (/^Gain the item covered by the training token\.$/.test(s)) {
    return [{ op: 'gainCoveredItem' }];
  }
  return null;
};

/** "Swap the location of any 2 dragons ..." */
const matchSwap: Matcher = (s) => {
  if (/^Swap the location of any 2 dragons on your player mat/i.test(s)) {
    return [{ op: 'swapDragons' }];
  }
  return null;
};

/** "Choose [AnyResource] and gain 2 of that resource. ..." */
const matchChooseDouble: Matcher = (s) => {
  if (/^Choose \[AnyResource\] and gain 2 of that resource\. (?:Each|All) opponents? gains? 1 of the same resource\.$/.test(s)) {
    return [{ op: 'chooseResourceGain', selfCount: 2, oppCount: 1 }];
  }
  return null;
};

/** "Gain 2 different benefits: [A]/[B]/[C]. Each/All opponents gain 1 ..." */
const matchDifferentBenefits: Matcher = (s) => {
  let m = /^Gain 2 different benefits: (.*)\. (?:Each|All) opponents? gains? 1 benefit of their choice\.$/.exec(s);
  if (m) {
    const options = m[1]!.split('/').map((p) => iconsOf(p));
    return [
      { op: 'chooseBenefits', count: 2, options },
      { op: 'opponentsMay', steps: [{ op: 'chooseBenefits', count: 1, options }] },
    ];
  }
  m = /^Gain 2 different benefits: (.*)\.$/.exec(s);
  if (m) {
    const options = m[1]!.split('/').map((p) => iconsOf(p));
    return [{ op: 'chooseBenefits', count: 2, options }];
  }
  return null;
};

/** "Either A, or B." / "Either A or B." */
const matchEitherOr: Matcher = (s) => {
  let m = /^Either (.*?), or (.*)\.$/.exec(s);
  if (!m) m = /^Either (.*?) or (lay|tuck|cache|excavate|train|draw|gain|activate)(.*)\.$/.exec(s);
  if (m) {
    const aText = m[1]!;
    const bText = m.length === 4 ? `${m[2]!}${m[3]!}` : m[2]!;
    const a = parseClauses(aText + '.');
    const b = parseClauses(bText + '.');
    if (a === null || b === null) return null;
    return [
      {
        op: 'chooseOption',
        options: [
          { label: aText, steps: a },
          { label: bText, steps: b },
        ],
      },
    ];
  }
  return null;
};

/** "If you (cache|tuck) X here, ..." — one-shot conditional trigger. */
const matchIfCacheTuck: Matcher = (s) => {
  const m = new RegExp(`^If you (cache|tuck) (${ICONS})here, (.*)\\.$`).exec(s);
  if (!m) return null;
  const trigger = m[1]! as 'cache' | 'tuck';
  const keyIcons = parseIcons(m[2]!);
  const key: Resource | 'dragonCard' =
    trigger === 'tuck'
      ? 'dragonCard'
      : ((keyIcons.find((i) => i.kind === 'resource') as { res: Resource } | undefined)?.res ?? 'meat');
  const inner = parseClauses(m[3]! + '.');
  if (inner === null) return null;
  return [{ op: 'recurring', trigger, key, eachSteps: inner, thirdGain: [] }];
};

/** "If <cond>, <clause>." (including "If you do/tuck it here" tails) */
const matchIf: Matcher = (s) => {
  const m = /^If (.*?), (.*)\.$/.exec(s);
  if (!m) return null;
  const ct = m[1]!.trim();
  const cond: Cond | null = /^you do$/i.test(ct)
    ? { kind: 'didPrecede' }
    : /^you tuck it here$/i.test(ct)
      ? { kind: 'tuckedHere' }
      : condOf(ct);
  if (!cond) return null;
  const inner = parseClauses(m[2]! + '.');
  if (inner === null) return null;
  return [{ op: 'if', cond, then: inner }];
};

function condOf(text: string): Cond | null {
  const t = text.trim().replace(/\.$/, '');
  if (/^this dragon's column is full$/.test(t)) return { kind: 'columnFull' };
  if (/^this dragon's (?:cave|row) is full$/.test(t)) return { kind: 'caveFull' };
  let m = /^you have at least (\d+) markers? on the Dragon Guild$/.exec(t);
  if (m) return { kind: 'atLeast', counter: { kind: 'guildMarkers' }, n: Number(m[1]) };
  m = /^you have at least (\d+) dragons? in this cave$/.exec(t);
  if (m) return { kind: 'atLeast', counter: { kind: 'dragons', where: 'cave' }, n: Number(m[1]) };
  m = /^you have at least as many dragons in your (Crimson Cavern|Golden Grotto|Amethyst Abyss) as your left neighbor$/.exec(
    t,
  );
  if (m) {
    const cave = m[1] === 'Crimson Cavern' ? 'crimson' : m[1] === 'Golden Grotto' ? 'golden' : 'amethyst';
    return { kind: 'leftNeighborGe', cave };
  }
  return null;
}

/** "gain X for each Y" — live counters. */
const matchGainPer: Matcher = (s) => {
  const m = new RegExp(`^Gain \\+?(${ICONS})for each (.*)\\.$`).exec(s);
  if (!m) return null;
  const items = iconsOf(m[1]!);
  if (!items.length) return null;
  const counter = counterOf(m[2]!);
  if (!counter) return null;
  return [{ op: 'gainPer', counter, items }];
};

/** "Each opponent may pay X to gain Y / do Z." */
const matchOppMayPay: Matcher = (s) => {
  const m = /^(?:Each|All) opponents? may pay (.*?) to (.*)\.$/.exec(s);
  if (!m) return null;
  const cost = payCostOf(m[1]!);
  if (!cost) return null;
  const gm = /^gain (.*)$/.exec(m[2]!);
  if (gm && gm[1]!.includes('/')) {
    const options = gm[1]!.split('/').map((p) => iconsOf(p));
    return [{ op: 'opponentsMay', steps: [{ op: 'chooseBenefits', count: 1, options }] }];
  }
  const inner = parseClauses(m[2]! + '.');
  if (inner === null) return null;
  return [{ op: 'opponentsMay', steps: [{ op: 'pay', cost, then: inner }] }];
};

/** "Lose [VP-n]." */
const matchLose: Matcher = (s) => {
  const m = /^Lose \[VP-(\d+)\]\.$/.exec(s);
  if (!m) return null;
  return [{ op: 'vp', count: -Number(m[1]) }];
};

const MATCHERS: Matcher[] = [
  matchGainOpponents,
  matchGainOppLay,
  matchDifferentBenefits,
  matchChooseDouble,
  matchGainThenCache,
  matchGainIf,
  matchPayGain,
  matchPayThen,
  matchPayEitherOr,
  matchPayVerb,
  matchUpToX,
  matchDraw,
  matchReveal,
  matchExcavateFree,
  matchPlayDragon,
  matchActivate,
  matchDiscardForBenefit,
  matchTrain,
  matchGainCovered,
  matchSwap,
  matchIfCacheTuck,
  matchIf,
  matchEitherOr,
  matchLayUpTo,
  matchLayPer,
  matchLayColumnOrRow,
  matchLay,
  matchCache,
  matchTuckPer,
  matchTuckGainCost,
  matchTuck,
  matchGainPer,
  matchOppMayPay,
  matchLose,
  matchSimpleGain,
];

// ---------------------------------------------------------------------------
// Contextual continuation sentences. These reference the immediately
// preceding effect ("Each opponent may do this 1x", "You may tuck it here").
// Returns 'consumed' (no-op informational sentence), Step[] to append, or null
// when the sentence isn't a recognized continuation.

function attachTo(steps: Step[], sent: string): Step[] | 'consumed' | null {
  let m: RegExpExecArray | null;

  // Pure boilerplate / clarifications.
  if (/^(?:Pay its printed costs|Do not pay any costs|Ignore normal cave preferences)\.$/.test(sent)) {
    return 'consumed';
  }

  // "If you do, <clause>." — conditional on the previous optional step.
  if ((m = /^If you do, (.*)\.$/.exec(sent))) {
    const inner = parseClauses(m[1]! + '.');
    if (inner === null) return null;
    return [{ op: 'if', cond: { kind: 'didPrecede' }, then: inner }];
  }
  if ((m = /^If you tuck it here, (.*)\.$/.exec(sent))) {
    const inner = parseClauses(m[1]! + '.');
    if (inner === null) return null;
    return [{ op: 'if', cond: { kind: 'tuckedHere' }, then: inner }];
  }

  // Opponent mirrors.
  if (/^(?:Each|All) opponents? may do this 1x\.$/.test(sent)) {
    const last = steps[steps.length - 1];
    if (!last) return null;
    const clone = { ...last, repeat: undefined } as Step;
    return [{ op: 'opponentsMay', steps: [clone] }];
  }
  if ((m = new RegExp(`^(?:Each|All) opponents? gains? (${ICONS})\\.$`).exec(sent))) {
    return [{ op: 'opponentsGain', items: iconsOf(m[1]!) }];
  }
  if ((m = new RegExp(`^(?:Each|All) opponents? may gain (${ICONS}) or (${ICONS})\\.$`).exec(sent))) {
    return [
      {
        op: 'opponentsMay',
        steps: [{ op: 'chooseBenefits', count: 1, options: [iconsOf(m[1]!), iconsOf(m[2]!)] }],
      },
    ];
  }
  if ((m = /^(?:Each|All) opponents? lays? ((?:\[Egg\]\s*)+)\.$/.exec(sent))) {
    const n = parseIcons(m[1]!).filter((t) => t.kind === 'egg').length;
    return [{ op: 'opponentsGain', items: [{ kind: 'egg', count: n }] }];
  }
  if ((m = new RegExp(`^(?:Each|All) opponents? draws? (${ICONS})from the deck\\.$`).exec(sent))) {
    return [{ op: 'opponentsGain', items: iconsOf(m[1]!) }];
  }
  const anyResourceOptions: GainItem[][] = [
    [{ kind: 'resource', res: 'meat', count: 1 }],
    [{ kind: 'resource', res: 'gold', count: 1 }],
    [{ kind: 'resource', res: 'crystal', count: 1 }],
    [{ kind: 'resource', res: 'milk', count: 1 }],
  ];
  if (/^(?:Each|All) opponents? gains? 1 (?:benefit|resource) of their choice\.$/.test(sent)) {
    const last = steps[steps.length - 1];
    const options = last && last.op === 'chooseBenefits' ? last.options : anyResourceOptions;
    return [{ op: 'opponentsMay', steps: [{ op: 'chooseBenefits', count: 1, options }] }];
  }
  if (/^All opponents gain 1 of their choice\.$/.test(sent)) {
    return [
      { op: 'opponentsMay', steps: [{ op: 'chooseBenefits', count: 1, options: anyResourceOptions }] },
    ];
  }
  if (/^All others may train any \*?fledgling\*? 1x for free\.$/.test(sent)) {
    return [
      { op: 'opponentsMay', steps: [{ op: 'trainFledgling', times: 1, free: true, target: 'any' }] },
    ];
  }

  // "You may cache/tuck it/them" — refers to the just-gained/drawn items.
  if ((m = /^You may cache (?:it|them) (here|onto any dragon)\.$/.exec(sent))) {
    const target = m[1] === 'here' ? ({ kind: 'here' } as DragonTarget) : ({ kind: 'any' } as DragonTarget);
    return [{ op: 'cache', count: 1, res: 'any', from: 'supply', target, upTo: true }];
  }
  if ((m = /^You may cache up to (\d+) of them (here|onto any dragon)\.$/.exec(sent))) {
    const target = m[2] === 'here' ? ({ kind: 'here' } as DragonTarget) : ({ kind: 'any' } as DragonTarget);
    return [{ op: 'cache', count: Number(m[1]), res: 'any', from: 'supply', target, upTo: true }];
  }
  if ((m = /^You may tuck (?:it|1 of them) (here|under any dragon|under an orthogonally adjacent dragon|here or under an orthogonally adjacent dragon)\.$/.exec(sent))) {
    const w = m[1]!;
    const target: DragonTarget =
      w === 'here'
        ? { kind: 'here' }
        : w.includes('orthogonally')
          ? { kind: 'orthAdjacent' }
          : { kind: 'any' };
    return [{ op: 'tuck', count: 1, from: 'hand', target, upTo: true }];
  }
  if ((m = /^You may tuck up to (\d+) of them (here|under any dragon)\.$/.exec(sent))) {
    const target = m[2] === 'here' ? ({ kind: 'here' } as DragonTarget) : ({ kind: 'any' } as DragonTarget);
    return [{ op: 'tuck', count: Number(m[1]), from: 'hand', target, upTo: true }];
  }
  if (/^You may tuck 1 or both here\.$/.test(sent)) {
    return [{ op: 'tuck', count: 2, from: 'hand', target: { kind: 'here' }, upTo: true }];
  }
  if (/^You may tuck any or all of them here\.$/.test(sent)) {
    return [{ op: 'tuck', count: 5, from: 'hand', target: { kind: 'here' }, upTo: true }];
  }
  if ((m = /^Cache up to (\d+) of them onto any dragon\.$/.exec(sent))) {
    return [{ op: 'cache', count: Number(m[1]), res: 'any', from: 'supply', target: { kind: 'any' }, upTo: true }];
  }
  if ((m = /^Tuck up to (\d+) of them under any dragon\.$/.exec(sent))) {
    return [{ op: 'tuck', count: Number(m[1]), from: 'hand', target: { kind: 'any' }, upTo: true }];
  }
  if (/^You may cache\/tuck any or all of them here\.$/.test(sent)) {
    return [
      { op: 'cache', count: 4, res: 'any', from: 'supply', target: { kind: 'here' }, upTo: true },
      { op: 'tuck', count: 4, from: 'hand', target: { kind: 'here' }, upTo: true },
    ];
  }
  if ((m = /^Keep 1 and cache 1 onto any dragon\.$/.exec(sent))) {
    return [{ op: 'cache', count: 1, res: 'any', from: 'supply', target: { kind: 'any' }, upTo: true }];
  }

  // End-game scoring clause inside a hybrid text — parsed separately into
  // AbilityDef.endGame; safe to skip in the step list.
  if (/^Each \S+ (?:on this dragon|tucked under this dragon|cached here|cached on this dragon) is worth \[VP-\d+\] at game end\.$/.test(sent)) {
    return 'consumed';
  }

  return null;
}

// ---------------------------------------------------------------------------
// Counter parsing ("for each X", "if X", end-game conditions)

function dragonCondOf(text: string): DragonCond | null {
  const t = text.trim();
  const personality = parsePersonality(t.replace(/ dragons?$| dragon$/, ''));
  if (personality) return { personality };
  const size = SIZES[cleanWord(t.replace(/ dragons?$| dragon$/, ''))];
  if (size) return { size };
  if (/SHY/.test(t)) return { personality: 'Shy' };
  return null;
}

/** Parse counter phrases like "medium dragon on your player mat", "SHY dragon in this cave". */
export function counterOf(text: string): Counter | null {
  const t = text.trim().replace(/\.$/, '');

  let m = /^(\w+|adult|\*?\w+\*?) dragons? on your player mat$/.exec(t);
  if (m) {
    const w = cleanWord(m[1]!);
    const p = parsePersonality(w);
    if (p) return { kind: 'dragons', where: 'mat', cond: { personality: p } };
    const sz = SIZES[w];
    if (sz) return { kind: 'dragons', where: 'mat', cond: { size: sz } };
    if (w === 'adult') return { kind: 'dragons', where: 'mat', cond: { sizeGroup: 'adult' } };
  }
  m = /^(?:other )?(\w+) dragons? in this cave$/.exec(t);
  if (m) {
    const w = cleanWord(m[1]!);
    const p = parsePersonality(w);
    const cond: DragonCond = {};
    if (p) cond.personality = p;
    if (/^other /.test(t)) cond.excludeSelf = true;
    return { kind: 'dragons', where: 'cave', cond };
  }
  if (/^dragons? in an? orthogonally adjacent space$/.test(t)) {
    return { kind: 'dragons', where: 'orthAdjacent' };
  }
  if (/^adult dragons? \(small, medium, or large\) in an? orthogonally adjacent space$/.test(t)) {
    return { kind: 'dragons', where: 'orthAdjacent', cond: { sizeGroup: 'adult' } };
  }
  m = /^(\w+) dragons? in an? orthogonally adjacent space$/.exec(t);
  if (m) {
    const w = cleanWord(m[1]!);
    const p = parsePersonality(w);
    const cond: DragonCond = {};
    if (p) cond.personality = p;
    const sz = SIZES[w];
    if (sz) cond.size = sz;
    if (w === 'adult') cond.sizeGroup = 'adult';
    return { kind: 'dragons', where: 'orthAdjacent', cond };
  }
  m = /^(\w+) dragons? in this column$/.exec(t);
  if (m) {
    const w = cleanWord(m[1]!);
    const p = parsePersonality(w);
    return { kind: 'dragons', where: 'column', cond: p ? { personality: p, excludeSelf: /other/.test(t) } : { excludeSelf: /other/.test(t) } };
  }
  // ability-type dragons: "[Adventurer] dragon on your player mat (including *hatchlings*)"
  m = /^\[(Adventurer|WhenPlayed|OncePerRound|EndGame)\] dragons? on your player mat/.exec(t);
  if (m) {
    return {
      kind: 'dragons',
      where: 'mat',
      cond: { abilityType: normAbilityType(m[1]!) },
    };
  }
  // cost-conditional dragons
  m = /^dragons? on your player mat (?:with|that costs?|that have) (?:an? )?(.+?)(?:\s*\(max.*)?$/.exec(t);
  if (m) {
    const c = m[1]!.replace(/\.$/, '').trim();
    const cm = /^(\[(?:Coin|Egg|Meat|Gold|Crystal|Milk)\])(?:\s*in its cost)?$/.exec(c);
    if (cm) {
      const tok = parseIcons(cm[1]!)[0]!;
      const res = tok.kind === 'resource' ? tok.res : tok.kind === 'coin' ? 'coin' : 'egg';
      return { kind: 'dragons', where: 'mat', cond: { costHas: res as 'coin' | 'egg' | Resource } };
    }
    if (/^at least 1 \[(Meat|Gold|Crystal|Milk)\]$/.test(c)) {
      const res = /\[(Meat|Gold|Crystal|Milk)\]/.exec(c)![1]!.toLowerCase();
      return { kind: 'dragons', where: 'mat', cond: { costHas: res as Resource } };
    }
    if (/^an? \[Egg\]$/.test(c)) {
      return { kind: 'dragons', where: 'mat', cond: { costHas: 'egg' } };
    }
  }
  // bare size words (with optional "on your player mat" / "in this cave")
  for (const sz of Object.keys(SIZES)) {
    if (new RegExp(`^\\*?${sz}\\*?s?(?: dragons?)? on your player mat$`).test(t)) {
      return { kind: 'dragons', where: 'mat', cond: { size: SIZES[sz] } };
    }
    if (new RegExp(`^\\*?${sz}\\*?$`).test(t)) {
      return { kind: 'dragons', where: 'mat', cond: { size: SIZES[sz] } };
    }
  }
  if (/^\*?fledgling\*?s? on your player mat$/.test(t) || /^fledglings? on your player mat$/.test(t)) {
    return { kind: 'fledglingCount' };
  }
  if (/^fully trained \*?fledgling\*?s?(?: on your player mat)?$/.test(t)) {
    return { kind: 'fullyTrainedFledglings' };
  }
  if (/^\[FledglingArrow\] on all of your \*?fledgling\*?s$/.test(t)) {
    return { kind: 'trainingTokens' };
  }
  if (/^markers? you have placed on the Dragon Guild$/.test(t)) {
    return { kind: 'guildMarkers' };
  }
  if (/^objective where your marker is placed the lowest/.test(t)) {
    return { kind: 'objectivesLowest' };
  }
  if (/^\*?set\*? of dragon traits on your player mat/.test(t)) {
    return { kind: 'traitSets' };
  }
  if (/^\*?set\*? of dragon sizes on your player mat/.test(t)) {
    return { kind: 'sizeSets' };
  }
  if (/^\[Egg\] in this dragon's column$/.test(t)) {
    return { kind: 'eggs', where: 'column' };
  }
  if (/^\[Egg\] in this dragon's row$/.test(t)) {
    return { kind: 'eggs', where: 'row' };
  }
  if (/^\[Egg\] you have$/.test(t) || /^eggs? you have$/.test(t)) {
    return { kind: 'eggs', where: 'mat' };
  }
  if (/^tucked cards? here$/.test(t) || new RegExp(`^${ICONS}tucked (?:here|under this dragon)$`).test(t)) {
    return { kind: 'tucked', where: 'here' };
  }
  if (/^resources? cached here$/.test(t) || new RegExp(`^${ICONS}cached (?:here|on this dragon)$`).test(t)) {
    return { kind: 'cached', where: 'here' };
  }
  return null;
}

// ---------------------------------------------------------------------------
// End-game ability parsing

function parseEndGame(text: string): AbilityDef['endGame'] | null {
  const s = text.trim();

  // "Lose [VP-n] for each other AGGRESSIVE dragon in this cave."
  let m = /^Lose \[VP-(\d+)\] for each (.*)\.$/.exec(s);
  if (m) {
    const counter = counterOf(m[2]!);
    if (!counter) return null;
    return { vpPer: -Number(m[1]), counter };
  }

  // "Gain + [VP-n] for each X (max [VP-m])." / "Gain +[VP-n] for each X."
  m = /^Gain \+?\s*\[VP-(\d+)\] for each (.*?)(?:\s*\(max \[VP-(\d+)\]\))?\.?$/.exec(s);
  if (m) {
    const counter = counterOf(m[2]!);
    if (counter) return { vpPer: Number(m[1]), counter, max: m[3] ? Number(m[3]) : undefined };
  }

  // "Gain an additional [VP-1] for every 2 [Egg] you have (round down)."
  m = /^Gain an additional \[VP-(\d+)\] for every (\d+) \[Egg\] you have \(round down\)\.$/.exec(s);
  if (m) {
    return {
      vpPer: Number(m[1]),
      counter: { kind: 'eggs', where: 'mat' },
      roundDown: true,
      extraEggVp: Number(m[2]),
    };
  }

  // "Gain [VP-n] if <cond>."
  m = /^Gain \+?\s*\[VP-(\d+)\] if (.*)\.$/.exec(s);
  if (m) {
    const cond = endGameCondOf(m[2]!);
    if (!cond) return null;
    return { vpPer: Number(m[1]), cond };
  }

  // "Each [X] on this dragon is worth [VP-1] at game end."
  m = /^Each \[(Meat|Gold|Crystal|Milk|DragonCard)\].*?is worth \[VP-(\d+)\] at game end/.exec(s);
  if (m) {
    const res = m[1]!;
    const counter: Counter =
      res === 'DragonCard'
        ? { kind: 'tucked', where: 'here' }
        : { kind: 'cached', where: 'here' };
    return { vpPer: Number(m[2]), counter };
  }

  // "Each [X] ... is worth [VP-1] at game end." appearing mid-text.
  m = /Each \[(Meat|Gold|Crystal|Milk|DragonCard)\][^.]*?is worth \[VP-(\d+)\] at game end/.exec(s);
  if (m) {
    const res = m[1]!;
    const counter: Counter =
      res === 'DragonCard'
        ? { kind: 'tucked', where: 'here' }
        : { kind: 'cached', where: 'here' };
    return { vpPer: Number(m[2]), counter };
  }

  return null;
}

function endGameCondOf(text: string): Cond | null {
  const t = text.trim().replace(/\.$/, '');
  let m: RegExpExecArray | null;
  if (/^this dragon is between two other dragons in this cave$/.test(t)) return { kind: 'betweenTwoDragons' };
  if (/^all spaces in this cave have been excavated$/.test(t)) return { kind: 'allExcavated', where: 'cave' };
  if (/^this dragon's cave is full$/.test(t)) return { kind: 'caveFull' };
  if (/^this dragon's column is full$/.test(t)) return { kind: 'columnFull' };
  if (/^this is the last \(farthest right\) dragon in its cave$/.test(t)) return { kind: 'isLastInCave' };
  if (/^there are no (\w+) dragons in this cave$/.test(t)) {
    const p = parsePersonality(/(\w+) dragons/.exec(t)![1]!);
    if (p) return { kind: 'exactly', counter: { kind: 'dragons', where: 'cave', cond: { personality: p } }, n: 0 };
  }
  if ((m = /^there is at least 1 other (\w+) dragon in this cave$/.exec(t))) {
    const p = parsePersonality(m[1]!);
    if (p) return { kind: 'atLeast', counter: { kind: 'dragons', where: 'cave', cond: { personality: p, excludeSelf: true } }, n: 1 };
  }
  if ((m = /^there is another (\w+) dragon in this column$/.exec(t))) {
    const p = parsePersonality(m[1]!);
    if (p) return { kind: 'atLeast', counter: { kind: 'dragons', where: 'column', cond: { personality: p, excludeSelf: true } }, n: 1 };
  }
  if ((m = /^you have (\d+) dragons in your (Crimson Cavern|Golden Grotto|Amethyst Abyss)$/.exec(t))) {
    const cave = m[2] === 'Crimson Cavern' ? 'crimson' : m[2] === 'Golden Grotto' ? 'golden' : 'amethyst';
    return {
      kind: 'atLeast',
      counter: { kind: 'dragons', where: 'namedCave', cave },
      n: Number(m[1]),
    } as Cond;
  }
  if ((m = /^there are at least (\d+) \*?hatchlings?\*?(?:\s*\w+)? on your player mat$/.exec(t))) {
    return { kind: 'atLeast', counter: { kind: 'dragons', where: 'mat', cond: { size: 'Hatchling' } }, n: Number(m[1]) };
  }
  if (/^you have a \*?hatchling\*?, a \*?small\*? dragon, and a \*?large\*? dragon in this cave$/.test(t)) {
    return {
      kind: 'atLeast',
      counter: { kind: 'dragons', where: 'cave', cond: { size: 'Hatchling' } },
      n: 1,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Recurring "Any time you cache/tuck X here" family

function recurringKey(trigger: 'cache' | 'tuck', iconText: string): Resource | 'dragonCard' {
  if (trigger === 'tuck') return 'dragonCard';
  const icons = parseIcons(iconText);
  const res = icons.find((i) => i.kind === 'resource') as { res: Resource } | undefined;
  return res?.res ?? 'meat';
}

function parseRecurring(text: string): AbilityDef | null {
  // Family A: "<base>. Any time you (cache|tuck) [X] here, <each>. When the 3rd
  // [X] is cached|tucked, also <third>.[ Otherwise, <other>.][ Each [X] ... is
  // worth [VP-n] at game end.]"
  let m = new RegExp(
    `^(.+?)\\. Any time you (cache|tuck) (${ICONS})(?:here|on this dragon|onto this dragon), ` +
      `(.+)\\. When the 3rd \\S+ is (?:cached|tucked), (?:also )?(.+?)\\.` +
      `(?: Otherwise, (.+?)\\.)?(?: Each \\S+ [^.]*?is worth \\[VP-\\d+\\] at game end\\.)?$`,
  ).exec(text);
  if (m) {
    const base = parseClauses(m[1]! + '.');
    if (base === null) return null;
    const trigger = m[2]! as 'cache' | 'tuck';
    const key = recurringKey(trigger, m[3]!);
    const gainPart = m[4]!;

    let eachSteps: Step[];
    const parsed = parseClauses(gainPart + '.');
    if (parsed) {
      eachSteps = parsed;
    } else {
      // "gain [Milk] or [Meat]" — pick one.
      const gm = new RegExp(`^gain (${ICONS})or (${ICONS})$`).exec(gainPart);
      if (gm) {
        eachSteps = [{ op: 'chooseBenefits', count: 1, options: [iconsOf(gm[1]!), iconsOf(gm[2]!)] }];
      } else {
        return null;
      }
    }
    const thirdSteps = parseClauses(m[5]! + '.');
    if (thirdSteps === null) return null;
    const otherwise = m[6] ? parseClauses(m[6]! + '.') : null;
    const out: AbilityDef = { steps: base };
    out.steps.push({
      op: 'recurring',
      trigger,
      key,
      eachSteps,
      thirdGain: otherwise && otherwise.length ? [...thirdSteps, ...otherwise] : thirdSteps,
    });
    const eg = parseEndGame(text);
    if (eg) out.endGame = eg;
    return out;
  }

  // Family B: "<base>. Each [X] (on this dragon|tucked under this dragon) is
  // worth [VP-n] at game end. When the 3rd [X] is cached|tucked, also <third>."
  m = new RegExp(
    `^(.+?)\\. Each (\\S+) (?:on this dragon|tucked under this dragon|cached here|cached on this dragon) ` +
      `is worth \\[VP-(\\d+)\\] at game end\\. When the 3rd \\2 is (cached|tucked), (?:also )?(.+?)\\.$`,
  ).exec(text);
  if (m) {
    const base = parseClauses(m[1]! + '.');
    if (base === null) return null;
    const trigger = m[4]! as 'cache' | 'tuck';
    const key = recurringKey(trigger, m[2]!);
    const thirdSteps = parseClauses(m[5]! + '.');
    if (thirdSteps === null) return null;
    const counter: Counter = trigger === 'tuck' ? { kind: 'tucked', where: 'here' } : { kind: 'cached', where: 'here' };
    const out: AbilityDef = { steps: base };
    out.steps.push({ op: 'recurring', trigger, key, eachSteps: [], thirdGain: thirdSteps });
    out.endGame = { vpPer: Number(m[3]), counter };
    return out;
  }

  return null;
}

// ---------------------------------------------------------------------------
// "Ignore this dragon's cost if ..." prefix

function parseIgnoreCost(text: string): { cond: Cond; rest: string } | null {
  const m = /^Ignore this dragon's cost if (.*?)\.\s*(.*)$/.exec(text);
  if (!m) return null;
  const t = m[1]!;
  let cond: Cond | null = null;
  let mm: RegExpExecArray | null;
  if (/^it will be the 3rd or 4th dragon in its cave$/.test(t)) {
    cond = { kind: 'willBeNthInCave', ns: [3, 4] };
  } else if (/^it is played orthogonally adjacent to a \*?fledgling\*?$/.test(t)) {
    cond = { kind: 'playedAdjacentTo', cond: { size: 'Fledgling' } };
  } else if (/^it will complete a column or row of dragons$/.test(t)) {
    cond = { kind: 'willCompleteRowOrColumn' };
  } else if ((mm = /^you have played at least (\d+) other (\w+) dragons$/.exec(t))) {
    const p = parsePersonality(mm[2]!);
    if (p) cond = { kind: 'playedAtLeast', cond: { personality: p }, n: Number(mm[1]) };
  } else if ((mm = /^you have played at least (\d+) \*?(fledglings?|hatchlings?)\*?$/.exec(t))) {
    const sz = mm[2]!.startsWith('fledgling') ? 'Fledgling' : 'Hatchling';
    cond = { kind: 'playedAtLeast', cond: { size: sz as Size }, n: Number(mm[1]) };
  }
  if (!cond) return null;
  return { cond, rest: m[2]! };
}

// ---------------------------------------------------------------------------
// Top-level clause parsing

function parseClauses(text: string): Step[] | null {
  const sents = sentences(text).map((s) => s.replace(/^[a-z]/, (c) => c.toUpperCase()));
  const steps: Step[] = [];
  let i = 0;
  while (i < sents.length) {
    const sent = sents[i]!;

    // Contextual continuation of the previous sentence?
    const att = attachTo(steps, sent);
    if (att === 'consumed') {
      i++;
      continue;
    }
    if (att !== null) {
      steps.push(...att);
      i++;
      continue;
    }

    // Try matcher patterns on joins of up to 3 sentences, longest first.
    let matched: ClauseResult = null;
    let used = 0;
    for (let k = Math.min(3, sents.length - i); k >= 1 && !matched; k--) {
      const joined = sents.slice(i, i + k).join(' ');
      for (const matcher of MATCHERS) {
        matched = matcher(joined);
        if (matched) {
          used = k;
          break;
        }
      }
    }
    if (!matched) return null;
    steps.push(...matched);
    i += used;
  }
  return steps;
}

/** Parse a full ability text into an AbilityDef. Never throws. */
export function parseAbility(card: DragonCard | CaveCard): AbilityDef {
  const raw = card.ability;
  if (!raw) return { steps: [] };
  const text = normalize(raw);

  const isDragon = 'vp' in card;
  const types = isDragon ? card.abilityType.split(',').map((s) => s.trim()) : ['WhenPlayed'];
  const hasEndGame = types.includes('EndGame');

  // "Ignore this dragon's cost if ..." prefix.
  let ignoreCostIf: Cond | undefined;
  let body = text;
  const ic = parseIgnoreCost(body);
  if (ic) {
    ignoreCostIf = ic.cond;
    body = ic.rest;
  }

  // Recurring cache/tuck family (base dragons + hatchlings).
  const rec = parseRecurring(body);
  if (rec) {
    if (ignoreCostIf) rec.ignoreCostIf = ignoreCostIf;
    if (hasEndGame && !rec.endGame) rec.endGame = parseEndGame(body) ?? undefined;
    return rec;
  }

  // Pure end-game texts.
  if (types.length === 1 && hasEndGame) {
    const eg = parseEndGame(body);
    if (eg) return { steps: [], endGame: eg, ignoreCostIf };
  }

  const steps = parseClauses(body);
  if (steps === null) {
    return { steps: [{ op: 'unsupported', text: body }], ignoreCostIf };
  }

  const def: AbilityDef = { steps, ignoreCostIf };
  if (hasEndGame) {
    const eg = parseEndGame(body);
    if (eg) def.endGame = eg;
  }
  return def;
}

// ---------------------------------------------------------------------------
// Coverage reporting

const warned = new Set<string>();

export function warnUnsupported(text: string): void {
  if (!warned.has(text)) {
    warned.add(text);
    // eslint-disable-next-line no-console
    console.warn(`[wyrmspan] unsupported ability text: ${text}`);
  }
}

function hasUnsupported(steps: Step[]): boolean {
  return steps.some((st) => {
    if (st.op === 'unsupported') return true;
    if (st.op === 'pay' || st.op === 'discardFromHand' || st.op === 'if' || st.op === 'opponentsMay' || st.op === 'repeat') {
      const inner =
        st.op === 'if'
          ? [...st.then, ...(st.else ?? [])]
          : st.op === 'opponentsMay' || st.op === 'repeat'
            ? st.steps
            : st.then;
      return hasUnsupported(inner as Step[]);
    }
    if (st.op === 'chooseOption') return st.options.some((o) => hasUnsupported(o.steps));
    if (st.op === 'recurring') return hasUnsupported(st.eachSteps) || hasUnsupported(st.thirdGain);
    if (st.op === 'reveal') return hasUnsupported(st.yes) || hasUnsupported(st.no);
    return false;
  });
}

/** Coverage report: how many distinct printed ability texts parse fully. */
export function abilityCoverage(
  dragons: DragonCard[],
  caves: CaveCard[],
): { total: number; supported: number; missing: string[] } {
  const byText = new Map<string, DragonCard | CaveCard>();
  for (const c of [...dragons, ...caves]) {
    if (c.ability && !byText.has(c.ability)) byText.set(c.ability, c);
  }
  const missing: string[] = [];
  for (const [text, card] of byText) {
    const def = parseAbility(card);
    if (hasUnsupported(def.steps)) missing.push(text);
  }
  return { total: byText.size, supported: byText.size - missing.length, missing };
}
