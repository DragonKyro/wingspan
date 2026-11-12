// Complete inline icon sets for Wyrmspan and Finspan. EVERY [Token] that
// appears in card/cave/achievement text has exactly one glyph here, and the
// card frames, mats and score panels reuse the same components — so a
// resource always looks the same wherever a player sees it. Each icon carries
// a <title> so hovering names it. Unknown tokens render as a labelled chip
// (never a blank square).

import type { ReactNode } from 'react';

type IconProps = { size?: number; title: string; children: ReactNode; className?: string };
function Glyph({ size = 18, title, children, className = 'svg-icon' }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} role="img" aria-label={title}>
      <title>{title}</title>
      {children}
    </svg>
  );
}

const disc = (fill: string, stroke: string) => (
  <circle cx="12" cy="12" r="10.8" fill={fill} stroke={stroke} strokeWidth="1.3" />
);
const sheen = <circle cx="12" cy="12" r="10.6" fill="url(#ws-sheen)" />;

/** A labelled fallback chip for any token without a glyph (should not happen). */
function Chip({ label }: { label: string }) {
  return <span className="inline-chip" title={label}>{label}</span>;
}

// ============================================================================
// WYRMSPAN
// ============================================================================

const WYRM_TITLES: Record<string, string> = {
  meat: 'Meat', gold: 'Gold', crystal: 'Crystal', milk: 'Milk', any: 'Any resource',
  anyresource: 'Any resource', coin: 'Coin', egg: 'Egg', guild: 'Dragon Guild (advance on the guild track)',
  dragonguild: 'Dragon Guild (advance on the guild track)', dragoncard: 'Dragon card', dragon: 'Dragon card',
  cavecard: 'Cave card', cave: 'Cave card', adventurer: 'Adventurer ability', whenplayed: 'When played',
  onceperround: 'Once per round', 'onceperround-v2': 'Once per round', endgame: 'End of game',
  fledglingarrow: 'Fledgling training arrow', crimson: 'Crimson Cavern', golden: 'Golden Grotto',
  amethyst: 'Amethyst Abyss', hatchling: 'Hatchling', small: 'Small dragon', medium: 'Medium dragon',
  large: 'Large dragon', fledgling: 'Fledgling', aggressive: 'Aggressive', helpful: 'Helpful',
  playful: 'Playful', shy: 'Shy', cached: 'Cached resource (1 VP each)', tucked: 'Tucked dragon (1 VP each)',
};

export const WYRM_CAVE_COLOR: Record<string, string> = {
  crimson: '#b33a48', golden: '#c9931b', amethyst: '#7b4fc0',
};

function wyrmGlyph(k: string): ReactNode {
  switch (k) {
    case 'meat':
      return (<>{disc('#b83b3b', '#4f1212')}<path d="M6 13.5c0-4 3.5-6.5 7-6.5s5 2.5 5 5-2.6 5-6.4 5c-1.6 0-2.4 1.4-3.6 1.4S6 17 6 13.5Z" fill="#f28482" stroke="#4f1212" strokeWidth="1" /><circle cx="14.6" cy="11.6" r="1.8" fill="#fff1e6" />{sheen}</>);
    case 'gold':
      return (<>{disc('#c9931b', '#593e05')}<path d="M5 16.5h14l-2.8-8.5H7.8Z" fill="#ffd166" stroke="#593e05" strokeWidth="1.1" /><path d="M8.5 10.5h7" stroke="#fff3b0" strokeWidth="1" />{sheen}</>);
    case 'crystal':
      return (<>{disc('#7b42bc', '#311457')}<path d="M12 3.8 17 10l-2.5 9.2h-5L7 10Z" fill="#e0aaff" stroke="#311457" strokeWidth="1" /><path d="M12 3.8 10.6 10 12 19.2M7 10h10" stroke="#9d6ad8" strokeWidth="0.8" fill="none" />{sheen}</>);
    case 'milk':
      return (<>{disc('#5b8ca8', '#1d3a4d')}<path d="M9 5.6h6l-1 3 2.5 4v6H7.5v-6l2.5-4Z" fill="#f8f9fa" stroke="#1d3a4d" strokeWidth="1" /><path d="M7.5 13h9" stroke="#9cc3d8" strokeWidth="1.2" />{sheen}</>);
    case 'any':
    case 'anyresource':
    case 'cached':
      return (<>{disc('#3a3347', '#1a1423')}<path d="M12 12V1.6A10.4 10.4 0 0 1 22.4 12Z" fill="#b83b3b" /><path d="M12 12h10.4A10.4 10.4 0 0 1 12 22.4Z" fill="#c9931b" /><path d="M12 12v10.4A10.4 10.4 0 0 1 1.6 12Z" fill="#7b42bc" /><path d="M12 12H1.6A10.4 10.4 0 0 1 12 1.6Z" fill="#e8eef2" /><circle cx="12" cy="12" r="3" fill="#3a3347" stroke="#fff" strokeWidth="0.8" />{sheen}</>);
    case 'coin':
      return (<><circle cx="12" cy="12" r="10.5" fill="#d6dbe0" stroke="#495057" strokeWidth="1.5" /><circle cx="12" cy="12" r="7.4" fill="none" stroke="#6c757d" strokeWidth="1" strokeDasharray="2 1.6" /><path d="M12 6.6 14.4 12 12 17.4 9.6 12Z" fill="#6c757d" />{sheen}</>);
    case 'egg':
      return (<><path d="M12 2.4c5 0 8 7.6 8 12.6 0 4.5-3.5 7-8 7s-8-2.5-8-7C4 10 7 2.4 12 2.4Z" fill="#e0a96d" stroke="#5c3a18" strokeWidth="1.3" /><path d="M7.4 11q4.6 3 9.2 0M7 15.4q5 3 10 0" fill="none" stroke="#8a5a2b" strokeWidth="1.1" /><ellipse cx="9.6" cy="8" rx="2.6" ry="3.4" fill="url(#ws-sheen)" /></>);
    case 'guild':
    case 'dragonguild':
      return (<><path d="M12 1.5 21 6.8v10.4L12 22.5 3 17.2V6.8Z" fill="#5e4b8b" stroke="#231942" strokeWidth="1.3" /><path d="M12 4.5 14 10l5.5 2-5.5 2-2 5.5-2-5.5L4.5 12 10 10Z" fill="#ffd166" /></>);
    case 'dragoncard':
    case 'dragon':
    case 'tucked':
      return (<><rect x="4.5" y="2.5" width="15" height="19" rx="2.4" fill="#6c4675" stroke="#e0aaff" strokeWidth="1.2" /><path d="M7.4 14.6 12 7l4.6 7.6-4.6-2.2Z" fill="#ffd166" /><path d="M7 18h10" stroke="#e0aaff" strokeWidth="1" /></>);
    case 'cavecard':
    case 'cave':
      return (<><rect x="3" y="4" width="18" height="16" rx="2.4" fill="#5c4d42" stroke="#ddb892" strokeWidth="1.2" /><path d="M7 17v-6a5 5 0 0 1 10 0v6Z" fill="#23190f" /><path d="M5 17h14" stroke="#ddb892" strokeWidth="1" /></>);
    case 'adventurer':
      return (<>{disc('#4d6b3c', '#1f2e16')}<circle cx="12" cy="7.6" r="3" fill="#f3e2b8" /><path d="M6.6 19c0-5 2.4-7.6 5.4-7.6s5.4 2.6 5.4 7.6Z" fill="#f3e2b8" />{sheen}</>);
    case 'whenplayed':
      return (<>{disc('#e0a526', '#6a4a08')}<path d="M13.4 3.6 6.8 13.4h4.4l-1.4 7 6.8-10h-4.4Z" fill="#fff8de" stroke="#6a4a08" strokeWidth="0.6" /></>);
    case 'onceperround':
    case 'onceperround-v2':
      return (<>{disc('#3d6fae', '#16304f')}<path d="M17.6 9.4A6.2 6.2 0 1 0 18 14" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" /><path d="M14.6 9.6h3.6V6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></>);
    case 'endgame':
      return (<>{disc('#a3343f', '#4a1018')}<path d="M8 19.5V4.6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /><path d="M8.4 5h9l-2.6 3.4 2.6 3.4h-9Z" fill="#fff" /></>);
    case 'fledglingarrow':
      return (<>{disc('#e8d8b0', '#7a5a32')}<path d="M6 9.5h7V6l6 6-6 6v-3.5H6Z" fill="#7a5a32" /></>);
    case 'crimson':
    case 'golden':
    case 'amethyst': {
      const c = WYRM_CAVE_COLOR[k]!;
      return (<><path d="M3 21V11a9 9 0 0 1 18 0v10Z" fill={c} stroke="#1a1020" strokeWidth="1.2" /><path d="M8 21v-7a4 4 0 0 1 8 0v7Z" fill="#1a1020" /><path d="M6 6.6l1 2.6M18 6.6l-1 2.6M12 3v2.6" stroke="#fff" strokeOpacity="0.55" strokeWidth="1" /></>);
    }
    case 'hatchling':
      return (<><path d="M12 3c4.4 0 7 6.6 7 11 0 4-3 6.6-7 6.6S5 18 5 14c0-4.4 2.6-11 7-11Z" fill="#efe0c4" stroke="#7a5a32" strokeWidth="1.2" /><path d="M5.6 11.4l2.6 2 2.2-2.6 2.4 2.6 2.4-2.6 2.2 2.6 1.4-1.2" fill="none" stroke="#7a5a32" strokeWidth="1.1" /></>);
    case 'fledgling':
      return (<>{disc('#e8d8b0', '#7a5a32')}<path d="M5 15q4-9 9-6l5-3-2 5q2 5-5 7Z" fill="#7a5a32" /></>);
    case 'small':
    case 'medium':
    case 'large': {
      const r = k === 'small' ? 5 : k === 'medium' ? 7.2 : 9.4;
      return (<><circle cx="12" cy="12" r="10.8" fill="#2a2036" stroke="#9c86b8" strokeWidth="1" /><circle cx="12" cy="12" r={r} fill="#9c86b8" /><text x="12" y="15.6" textAnchor="middle" fontSize="10" fontWeight="800" fill="#2a2036">{k[0]!.toUpperCase()}</text></>);
    }
    case 'aggressive':
      return (<>{disc('#b8322a', '#4a0f0b')}<path d="M12 3.6c1 3.4 5.4 5.4 5.4 10a5.4 5.4 0 0 1-10.8 0c0-2.6 1.4-3.6 2.4-5 .4 1.6 1.2 2.4 2 2.6-.6-2.8.2-5.4 1-7.6Z" fill="#ffd166" /></>);
    case 'helpful':
      return (<>{disc('#2f7a52', '#123a24')}<path d="M12 19.4S4.6 14.8 4.6 9.8A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7.4 1.8c0 5-7.4 9.6-7.4 9.6Z" fill="#c8e6a8" /></>);
    case 'playful':
      return (<>{disc('#e07a3f', '#5a2a10')}<path d="M12 4.6l2 4.6 5 .5-3.8 3.3 1.1 4.9L12 15.4l-4.3 2.5 1.1-4.9L5 9.7l5-.5Z" fill="#ffe8b8" /></>);
    case 'shy':
      return (<>{disc('#3d5a80', '#16263a')}<path d="M5 12.6q7 6 14 0" fill="none" stroke="#dbe8f4" strokeWidth="2" strokeLinecap="round" /><path d="M7 15.4l-1 2M12 16.4v2.2M17 15.4l1 2" stroke="#dbe8f4" strokeWidth="1.4" strokeLinecap="round" /></>);
    default:
      return null;
  }
}

export function WyrmResourceIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const k = kind.toLowerCase();
  const g = wyrmGlyph(k);
  if (!g) return <Chip label={kind} />;
  return <Glyph size={size} title={WYRM_TITLES[k] ?? kind}>{g}</Glyph>;
}

/** Wyrmspan victory points: a bronze shield with the value inside. */
export function WyrmVp({ n, size = 18 }: { n?: number | string; size?: number }) {
  return (
    <Glyph size={size} title={n === undefined ? 'Victory points' : `${n} victory point${n === 1 ? '' : 's'}`}>
      <path d="M12 1.6 20.6 4.6v6.8c0 5.4-3.8 9.4-8.6 11-4.8-1.6-8.6-5.6-8.6-11V4.6Z" fill="#c9832e" stroke="#4a2a0a" strokeWidth="1.2" />
      <path d="M12 3.6 18.6 6v5.4c0 4.2-2.8 7.4-6.6 8.8-3.8-1.4-6.6-4.6-6.6-8.8V6Z" fill="#e8a94a" />
      {n !== undefined && (
        <text x="12" y="15.4" textAnchor="middle" fontSize={String(n).length > 1 ? 9 : 11} fontWeight="900" fill="#3a1e04">{n}</text>
      )}
    </Glyph>
  );
}

export function renderWyrmspanText(text: string | null | undefined, size = 14): ReactNode {
  if (!text) return null;
  return text.split(/(\[[^\]]+\])/g).map((part, idx) => {
    const m = /^\[([^\]]+)\]$/.exec(part);
    if (!m) return part;
    const raw = m[1]!;
    const vp = /^VP-(\d+)$/i.exec(raw);
    if (vp) return <WyrmVp key={idx} n={Number(vp[1])} size={size + 2} />;
    return <WyrmResourceIcon key={idx} kind={raw} size={size} />;
  });
}

// ============================================================================
// FINSPAN
// ============================================================================

export const FIN_SITE_COLOR: Record<string, string> = { blue: '#3a86ff', purple: '#8338ec', green: '#38b000' };

const FIN_TITLES: Record<string, string> = {
  egg: 'Fish egg', fishegg: 'Fish egg', young: 'Young fish', youngfish: 'Young fish', school: 'School (6 VP)',
  schoolfish: 'School (6 VP)', hatch: 'Hatch (egg → young fish)', fishhatch: 'Hatch (egg → young fish)',
  move: 'Move young fish / school', schoolfeedermove: 'Move young fish / school',
  unschoolfish: 'Break up a school', draw: 'Draw a fish card', drawcard: 'Draw a fish card',
  recovercard: 'Recover a card from your discard pile', discard: 'Discard a card', consume: 'Consume (tuck a fish under this one)',
  fishfromhandconsume: 'Consume a fish from your hand', fishfromhand: 'Fish card from your hand',
  freeplayfishfromhand: 'Play a fish from your hand for free', playfishbottomrow: 'Play into the bottom row',
  arrowdown: 'onto / into', allplayers: 'All players', wave: 'Victory points', sun: 'Sunlight zone',
  sunlight: 'Sunlight zone', twilight: 'Twilight zone', midnight: 'Midnight zone', deepwater: 'Deepwater (bottom row only)',
  estuary: 'Estuary (top sunlight row)', predator: 'Predator tag', bioluminescent: 'Bioluminescent tag',
  camouflage: 'Camouflage tag', electric: 'Electric tag', venomous: 'Venomous tag',
  fishlengthsmall: 'Small fish', fishlengthmedium: 'Medium fish', fishlengthlarge: 'Large fish',
  small: 'Small fish', medium: 'Medium fish', large: 'Large fish', forage: 'Forage fish',
};

const fishShape = (fill: string, x = 0, y = 0, s = 1) => (
  <path transform={`translate(${x} ${y}) scale(${s})`} d="M4.5 12q5.6-6 11.4 0l4.1-3.6-1 3.6 1 3.6-4.1-3.6q-5.8 6-11.4 0Z" fill={fill} />
);
const card = (fill: string, stroke: string) => (
  <rect x="5" y="3" width="14" height="18" rx="2.2" fill={fill} stroke={stroke} strokeWidth="1.2" />
);

function finGlyph(k: string): ReactNode {
  const coral = k.includes('coral');
  if (coral) {
    const c = k.includes('blue') ? FIN_SITE_COLOR.blue : k.includes('purple') ? FIN_SITE_COLOR.purple : k.includes('green') ? FIN_SITE_COLOR.green : null;
    return (
      <>
        {c ? disc(c, '#10202e') : (<><circle cx="12" cy="12" r="10.8" fill="#ff4fa0" stroke="#10202e" strokeWidth="1.3" /><path d="M12 12V1.2A10.8 10.8 0 0 1 21.4 17.4Z" fill={FIN_SITE_COLOR.blue} /><path d="M12 12l9.4 5.4A10.8 10.8 0 0 1 2.6 17.4Z" fill={FIN_SITE_COLOR.green} /><path d="M12 12 2.6 17.4A10.8 10.8 0 0 1 12 1.2Z" fill={FIN_SITE_COLOR.purple} /></>)}
        <path d="M12 19.5v-9M12 14.6l-4-4.4M12 12.4l4-4.4M8 10.2V7.4M16 8V5.6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </>
    );
  }
  if (k.startsWith('flipper')) {
    const c = FIN_SITE_COLOR[k.slice(7)] ?? '#888';
    return (<>{disc(c, '#10202e')}<path d="M9.4 4.4h5.2l3.4 13.6q-6 3.4-12 0Z" fill="#fff" opacity="0.92" /><path d="M10.6 8.4 9 16.6M13.4 8.4 15 16.6" stroke={c} strokeWidth="0.9" /></>);
  }
  const consumeN = /consumefish(\d)/.exec(k)?.[1];
  switch (k) {
    case 'egg':
    case 'fishegg':
      return (<><circle cx="12" cy="12" r="9.5" fill="#ffd166" fillOpacity="0.9" stroke="#b57c00" strokeWidth="1.4" /><circle cx="10" cy="10.4" r="3.2" fill="#ef476f" /><circle cx="14.6" cy="8.4" r="1.6" fill="#fff" opacity="0.85" /></>);
    case 'young':
    case 'youngfish':
      return (<>{disc('#1e6091', '#0b2239')}{fishShape('#90e0ef')}<circle cx="8" cy="11.2" r="1.1" fill="#0b2239" />{sheen}</>);
    case 'school':
    case 'schoolfish':
      return (<>{disc('#0077b6', '#caf0f8')}{fishShape('#caf0f8', 1, -4.4, 0.62)}{fishShape('#caf0f8', 4.6, 0.2, 0.62)}{fishShape('#caf0f8', 1, 4.6, 0.62)}</>);
    case 'unschoolfish':
      return (<>{disc('#0077b6', '#caf0f8')}{fishShape('#caf0f8', 2, -3.4, 0.6)}{fishShape('#caf0f8', 2, 3.6, 0.6)}<path d="M3.6 20.4 20.4 3.6" stroke="#ff6b6b" strokeWidth="2.2" strokeLinecap="round" /></>);
    case 'hatch':
    case 'fishhatch':
      return (<>{disc('#2a9d8f', '#134e47')}<circle cx="7.4" cy="12" r="3" fill="#ffd166" stroke="#b57c00" strokeWidth="0.8" /><path d="M11.2 12h2.6m-1.4-1.6 1.6 1.6-1.6 1.6" stroke="#fff" strokeWidth="1.3" fill="none" />{fishShape('#e8fbff', 8.4, 0, 0.62)}</>);
    case 'move':
    case 'schoolfeedermove':
      return (<>{disc('#48cae4', '#023e8a')}<path d="M5.6 12h10.6m-3.6-4 4.2 4-4.2 4" fill="none" stroke="#023e8a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></>);
    case 'draw':
    case 'drawcard':
      return (<>{card('#1e6091', '#90e0ef')}<path d="M8 11q4-3.4 7.4 0-3.4 3.4-7.4 0Z" fill="#90e0ef" /><path d="M12 15.6v4.2m-2-2 2 2 2-2" stroke="#ffd166" strokeWidth="1.4" fill="none" strokeLinecap="round" /></>);
    case 'recovercard':
      return (<>{card('#3d4f63', '#90e0ef')}<path d="M8 10q4-3.4 7.4 0-3.4 3.4-7.4 0Z" fill="#90e0ef" /><path d="M15.4 17.4a3.6 3.6 0 1 1-1-3.4m.4-1.8v2.2h-2.2" stroke="#ffd166" strokeWidth="1.3" fill="none" strokeLinecap="round" /></>);
    case 'discard':
      return (<>{card('#5a2a30', '#ff9a9a')}<path d="M8.6 8.6 15.4 15.4M15.4 8.6 8.6 15.4" stroke="#ff9a9a" strokeWidth="2.2" strokeLinecap="round" /></>);
    case 'fishfromhand':
    case 'freeplayfishfromhand':
    case 'playfishbottomrow':
      return (
        <>
          {card('#1e6091', '#90e0ef')}
          {fishShape('#caf0f8', -0.2, -1.4, 0.82)}
          {k === 'freeplayfishfromhand' && <><circle cx="17.6" cy="17.6" r="4.6" fill="#38b000" stroke="#0b2239" strokeWidth="0.8" /><text x="17.6" y="19.6" textAnchor="middle" fontSize="5.6" fontWeight="900" fill="#fff">0</text></>}
          {k === 'playfishbottomrow' && <path d="M6.6 18.6h10.8" stroke="#ffd166" strokeWidth="2.2" strokeLinecap="round" />}
        </>
      );
    case 'consume':
    case 'fishfromhandconsume':
      return (<>{disc('#9d0208', '#370617')}<path d="M4.6 7.6 13.6 12l-9 4.4Z" fill="#ffd166" />{fishShape('#ffd166', 6.4, 0, 0.6)}</>);
    case 'arrowdown':
      return (<path d="M12 3v14m-5.4-5.4L12 17l5.4-5.4" fill="none" stroke="#e8fbff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />);
    case 'allplayers':
      return (<>{disc('#4a4e69', '#16182a')}<circle cx="7.4" cy="10" r="2.4" fill="#f2e9e4" /><circle cx="16.6" cy="10" r="2.4" fill="#f2e9e4" /><circle cx="12" cy="8.4" r="2.8" fill="#fff" /><path d="M3.6 18q.6-4.4 3.8-4.4t3.8 4.4ZM12.8 18q.6-4.4 3.8-4.4t3.8 4.4ZM7.6 19q.8-5.6 4.4-5.6t4.4 5.6Z" fill="#f2e9e4" /></>);
    case 'wave':
      return (<><path d="M12 1.6 20.6 4.6v6.8c0 5.4-3.8 9.4-8.6 11-4.8-1.6-8.6-5.6-8.6-11V4.6Z" fill="#1f6f9f" stroke="#0b2239" strokeWidth="1.2" /><path d="M5.6 13.4q2.2-3 4.4 0t4.4 0 4.2 0M6.6 9.2q2-2.6 4 0t4 0 3.4 0" stroke="#e8fbff" strokeWidth="1.6" fill="none" strokeLinecap="round" /></>);
    case 'sun':
    case 'sunlight':
      return (<>{disc('#7fd3f2', '#1f5f82')}<circle cx="12" cy="12" r="4.4" fill="#ffd166" /><path d="M12 3.6v2.2M12 18.2v2.2M3.6 12h2.2M18.2 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" stroke="#ffd166" strokeWidth="1.6" strokeLinecap="round" /></>);
    case 'twilight':
      return (<>{disc('#2a6f9e', '#0e2a44')}<path d="M5 14.6a7 7 0 0 1 14 0Z" fill="#f4a261" /><path d="M3.6 14.6h16.8M6 17.6h12" stroke="#cfe2f0" strokeWidth="1.4" strokeLinecap="round" /></>);
    case 'midnight':
      return (<>{disc('#0f2440', '#040b18')}<path d="M14.6 5.4a6.8 6.8 0 1 0 4 11.6 6 6 0 0 1-4-11.6Z" fill="#cfe2f0" /><path d="M6 7h.01M8.6 4.6h.01M5.4 15h.01" stroke="#7af0ff" strokeWidth="1.6" strokeLinecap="round" /></>);
    case 'deepwater':
      return (<>{disc('#0f2440', '#040b18')}<path d="M12 5.2v13M8.4 8.4h7.2M5.6 13.6q.6 5 6.4 5t6.4-5" fill="none" stroke="#cfe2f0" strokeWidth="1.8" strokeLinecap="round" /><circle cx="12" cy="4.6" r="1.6" fill="none" stroke="#cfe2f0" strokeWidth="1.4" /></>);
    case 'estuary':
      return (<>{disc('#7fd3f2', '#1f5f82')}<path d="M3.6 15q4-2.4 8.4 0t8.4 0V20H3.6Z" fill="#2a86b8" /><path d="M7 15V7M10 14V5.6M16 14.4V8" stroke="#4f8a3f" strokeWidth="1.4" strokeLinecap="round" /><path d="M10 5.6v3" stroke="#7a4a2a" strokeWidth="2.2" strokeLinecap="round" /></>);
    case 'predator':
      return (<>{disc('#a8452a', '#4a1a0e')}<path d="M4 9.4h16l-2 2.6-2-2.2-2 2.6-2-2.6-2 2.6-2-2.6-2 2.2ZM4 14.6h16l-2-2.6-2 2.2-2-2.6-2 2.6-2-2.6-2 2.6-2-2.2Z" fill="#fff" /></>);
    case 'bioluminescent':
      return (<><circle cx="12" cy="12" r="10.8" fill="#0f2440" stroke="#7af0ff" strokeWidth="1.3" /><circle cx="12" cy="12" r="7" fill="url(#ws-glow)" /><circle cx="12" cy="12" r="2.4" fill="#e8fbff" /></>);
    case 'camouflage':
      return (<>{disc('#6b7a3a', '#2a3214')}<path d="M5.6 9.4h.01M10.4 6.6h.01M15.6 9.6h.01M8 14.6h.01M13.4 13.6h.01M17.4 15.6h.01M11 18.4h.01" stroke="#c8c46a" strokeWidth="3.4" strokeLinecap="round" /></>);
    case 'electric':
      return (<>{disc('#2a2f6a', '#0e1030')}<path d="M13.6 3.4 7 13.2h4.2l-1.4 7.4 7.2-10.4h-4.4Z" fill="#fff35a" /></>);
    case 'venomous':
      return (<>{disc('#6a2a8a', '#2a0e3a')}<path d="M12 4.4q5 6.6 5 9.6a5 5 0 0 1-10 0q0-3 5-9.6Z" fill="#d8b8f0" /><path d="M10 14.4h.01M13.6 13h.01" stroke="#6a2a8a" strokeWidth="1.8" strokeLinecap="round" /></>);
    case 'fishlengthsmall':
    case 'fishlengthmedium':
    case 'fishlengthlarge':
    case 'small':
    case 'medium':
    case 'large': {
      const s = k.replace('fishlength', '');
      return (<><circle cx="12" cy="12" r="10.8" fill="#e8f2f6" stroke="#1f5f82" strokeWidth="1.2" /><path d="M4.6 17.6h14.8" stroke="#1f5f82" strokeWidth="1.2" /><path d="M6.4 17.6v-2M9.4 17.6v-1.2M12 17.6v-2M14.6 17.6v-1.2M17.6 17.6v-2" stroke="#1f5f82" strokeWidth="0.9" /><text x="12" y="13.2" textAnchor="middle" fontSize="9" fontWeight="900" fill="#1f5f82">{s[0]!.toUpperCase()}</text></>);
    }
    case 'forage':
      return (<>{disc('#adb5bd', '#495057')}{fishShape('#f8f9fa', 1, -3, 0.55)}{fishShape('#f8f9fa', 3, 3, 0.55)}</>);
    default:
      if (consumeN) {
        return (<>{disc('#9d0208', '#370617')}<path d="M4.6 7.6 13.6 12l-9 4.4Z" fill="#ffd166" /><text x="17" y="15.6" textAnchor="middle" fontSize="10" fontWeight="900" fill="#fff">{consumeN}</text></>);
      }
      return null;
  }
}

export function FinIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const k = kind.toLowerCase();
  const g = finGlyph(k);
  if (!g) return <Chip label={kind} />;
  const title =
    FIN_TITLES[k] ??
    (k.includes('coral') ? `${k.replace('coral', '') || 'any'} coral` : k.startsWith('flipper') ? `${k.slice(7)} dive site` : /consumefish(\d)/.test(k) ? `${/(\d)/.exec(k)![1]}+ fish consumed under this one` : kind);
  return <Glyph size={size} title={title}>{g}</Glyph>;
}

export function renderFinspanText(text: string | null | undefined, size = 14): ReactNode {
  if (!text) return null;
  return text.split(/(\[[^\]]+\])/g).map((part, idx) => {
    const m = /^\[([^\]]+)\]$/.exec(part);
    if (!m) return part;
    return <FinIcon key={idx} kind={m[1]!} size={size} />;
  });
}
