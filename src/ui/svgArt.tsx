// Hand-crafted thematic SVG artwork, icons, card illustrations, and inline
// text-token iconizers for Wingspan, Wyrmspan, and Finspan.
// Pure vector SVG, no image files. Shared gradients live once in <ArtDefs/>
// (art/core.tsx, mounted in App) and are referenced as url(#ws-…).

import type { ReactNode } from 'react';

import { BirdIllustration } from './art/birdArt';
import { DragonIllustration } from './art/dragonArt';
import { FishIllustration } from './art/fishArt';

export { ArtDefs } from './art/core';
export { BirdIllustration, DragonIllustration, FishIllustration };

// ============================================================================
// PLAYER COLOR PALETTE
// ============================================================================

export const PLAYER_COLOR_HEX: Record<string, string> = {
  red: '#d9534f',
  blue: '#4a90d9',
  orange: '#e69138',
  white: '#e8ece9',
  purple: '#9b6bd6',
  pink: '#e07ab5',
  teal: '#38b2a6',
  green: '#52b788',
  gold: '#e0b445',
  c0: '#4a90d9',
  c1: '#e69138',
  c2: '#52b788',
  c3: '#9b6bd6',
  c4: '#d9534f',
  c5: '#38b2a6',
};

export function playerColorHex(color: string): string {
  return PLAYER_COLOR_HEX[color] ?? (color.startsWith('#') ? color : '#6aa0ff');
}

// ============================================================================
// GAME PICKER THUMBNAILS (280 x 140)
// ============================================================================

/** Fanned mini card used by the menu thumbnails; `children` is a 120×56 portrait. */
function MiniCard({
  x, y, a, head, band, face = '#f7efe0', edge = '#bba67d', children,
}: {
  x: number; y: number; a: number; head: string; band: string; face?: string; edge?: string; children: ReactNode;
}) {
  return (
    <g transform={`translate(${x} ${y}) rotate(${a})`}>
      <rect x="-31" y="-43" width="66" height="90" rx="6" fill="#000" opacity="0.25" />
      <rect x="-33" y="-45" width="66" height="90" rx="6" fill={face} stroke={edge} strokeWidth="1.4" />
      <rect x="-29" y="-41" width="58" height="9" rx="2.5" fill={head} />
      <svg x="-29" y="-29" width="58" height="34" overflow="hidden">{children}</svg>
      <rect x="-29" y="-29" width="58" height="34" fill="none" stroke="#000" strokeOpacity="0.25" />
      <rect x="-29" y="9" width="58" height="14" rx="2.5" fill={band} />
      <path d="M-25 30h40M-25 35.5h30" stroke={edge} strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </g>
  );
}

export function WingspanThumbnail() {
  return (
    <svg viewBox="0 0 280 140" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Wingspan">
      <rect width="280" height="140" fill="url(#ws-sky-grassland-1)" />
      <circle cx="232" cy="30" r="24" fill="url(#ws-sun)" />
      <path d="M8 92L18 62L28 92ZM26 94L38 54L50 94ZM46 92L55 68L64 92ZM236 90L245 66L254 90ZM252 92L262 60L272 92Z" fill="#4f7a5a" opacity="0.8" />
      <path d="M0 96Q70 72 150 90T280 82V140H0Z" fill="#5d8a64" />
      <path d="M0 112Q95 92 185 108T280 102V140H0Z" fill="#a9a85a" />
      <path d="M0 124Q110 116 280 122V140H0Z" fill="url(#ws-water)" />
      <path d="M150 128h30M196 132h22M40 131h18" stroke="#e8f6fb" strokeWidth="1" opacity="0.7" />
      <path d="M44 24q6 -6 12 0q6 -6 12 0M72 14q4 -4 8 0q4 -4 8 0" stroke="#3a4038" strokeWidth="1.2" fill="none" />
      <MiniCard x={96} y={74} a={-11} head="#3d7352" band="#7d5330">
        <BirdIllustration cardId={11} name="Barn Owl" habitats={['forest']} wingspan={107} predator />
      </MiniCard>
      <MiniCard x={184} y={74} a={11} head="#3f84a6" band="#2f7f87">
        <BirdIllustration cardId={7} name="Great Blue Heron" habitats={['wetland']} wingspan={183} />
      </MiniCard>
      <MiniCard x={140} y={66} a={0} head="#9ba843" band="#c96480">
        <BirdIllustration cardId={3} name="Northern Cardinal" habitats={['forest']} wingspan={30} />
      </MiniCard>
      <g transform="translate(30 116)"><EggTokenSvg index={0} size={20} /></g>
      <g transform="translate(46 119)"><EggTokenSvg index={1} size={18} /></g>
      <g transform="translate(236 110)"><FoodIcon food="nectar" size={22} /></g>
      <g transform="translate(212 114)"><FoodIcon food="seed" size={18} /></g>
    </svg>
  );
}

export function WyrmspanThumbnail() {
  return (
    <svg viewBox="0 0 280 140" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Wyrmspan">
      <rect width="280" height="140" fill="#1a1224" />
      <ellipse cx="50" cy="80" rx="60" ry="70" fill="url(#ws-cave-crimson)" opacity="0.8" />
      <ellipse cx="140" cy="76" rx="64" ry="72" fill="url(#ws-cave-golden)" opacity="0.75" />
      <ellipse cx="230" cy="80" rx="60" ry="70" fill="url(#ws-cave-amethyst)" opacity="0.8" />
      <path d="M8 0L16 30L24 0ZM60 0L66 20L72 0ZM100 0L106 26L112 0ZM170 0L176 22L182 0ZM212 0L220 34L228 0ZM256 0L262 24L268 0Z" fill="#120a18" />
      <path d="M0 126Q70 118 140 124T280 122V140H0Z" fill="#0f0a14" />
      <path d="M226 140L232 112L238 140ZM236 140L242 120L246 140Z" fill="#b48ae8" />
      <MiniCard x={96} y={74} a={-11} head="#7c2334" band="#7d5330" face="#2a2036" edge="#6a5a7a">
        <DragonIllustration id={4} name="Redwood Lung Dragon" personality="Playful" size="Medium" caves={['Crimson Cavern']} />
      </MiniCard>
      <MiniCard x={184} y={74} a={11} head="#5b348a" band="#7d5330" face="#2a2036" edge="#6a5a7a">
        <DragonIllustration id={8} name="Resplendent Coatl" personality="Helpful" size="Medium" caves={['Amethyst Abyss']} />
      </MiniCard>
      <MiniCard x={140} y={66} a={0} head="#9c6b21" band="#7d5330" face="#2a2036" edge="#6a5a7a">
        <DragonIllustration id={2} name="Crimson Dragon" personality="Aggressive" size="Large" caves={['Golden Grotto']} />
      </MiniCard>
      <g transform="translate(26 112)"><WyrmResourceIcon kind="crystal" size={22} /></g>
      <g transform="translate(50 114)"><WyrmResourceIcon kind="coin" size={20} /></g>
      <g transform="translate(208 112)"><WyrmResourceIcon kind="egg" size={20} /></g>
    </svg>
  );
}

export function FinspanThumbnail() {
  return (
    <svg viewBox="0 0 280 140" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Finspan">
      <rect width="280" height="48" fill="url(#ws-sea-sunlight)" />
      <rect y="48" width="280" height="46" fill="url(#ws-sea-twilight)" />
      <rect y="94" width="280" height="46" fill="url(#ws-sea-midnight)" />
      <path d="M36 0h24l46 94H40ZM150 0h18l40 94h-30Z" fill="url(#ws-ray)" opacity="0.45" />
      <path d="M10 140q-4 -16 6 -22q4 10 8 2q8 8 4 20ZM240 140q-4 -18 8 -26q6 12 12 2q8 12 2 24Z" fill="#e06388" opacity="0.85" />
      <path d="M30 112h0.01M60 126h0.01M222 104h0.01M252 120h0.01M120 132h0.01" stroke="#7af0ff" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      <MiniCard x={96} y={74} a={-11} head="#2b8cbe" band="#16537e" face="#16324a" edge="#4d7fa3">
        <FishIllustration id={1} name="Tomato Clownfish" size="small" zones={{ sunlight: true }} coral="purple" />
      </MiniCard>
      <MiniCard x={184} y={74} a={11} head="#0b2239" band="#16537e" face="#16324a" edge="#4d7fa3">
        <FishIllustration id={2} name="Abyssal Anglerfish" size="medium" zones={{ midnight: true }} tags={{ bioluminescent: 1 }} />
      </MiniCard>
      <MiniCard x={140} y={66} a={0} head="#16537e" band="#16537e" face="#16324a" edge="#4d7fa3">
        <FishIllustration id={4} name="Great Hammerhead" size="large" zones={{ twilight: true }} />
      </MiniCard>
      <g transform="translate(222 18)"><FinIcon kind="school" size={26} /></g>
    </svg>
  );
}

// ============================================================================
// TOKEN ICONS (replace emoji chips — consistent across platforms)
// ============================================================================

export type TokenKind = 'card' | 'die' | 'feather' | 'predator' | 'flock' | 'bonus';

export function TokenIcon({ kind, size = 14, title }: { kind: TokenKind; size?: number; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="svg-icon" role="img" aria-label={title ?? kind}>
      {title && <title>{title}</title>}
      {kind === 'card' && (
        <>
          <rect x="6.5" y="3" width="13" height="18" rx="2" fill="#d8c8a8" stroke="#7a5a32" strokeWidth="1.1" transform="rotate(8 13 12)" />
          <rect x="4.5" y="3" width="13" height="18" rx="2" fill="#f7efe0" stroke="#7a5a32" strokeWidth="1.3" />
          <rect x="6.6" y="5.2" width="8.8" height="6" rx="1" fill="#5d8a64" />
          <path d="M8 10q2 -3.4 5 -1.4" stroke="#f7efe0" strokeWidth="1.1" fill="none" />
          <path d="M6.8 14.2h8.4M6.8 17h5.6" stroke="#a88a5a" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
      {kind === 'die' && (
        <>
          <rect x="3.5" y="4.5" width="17" height="17" rx="4" fill="#c8b48c" />
          <rect x="3.5" y="3" width="17" height="17" rx="4" fill="#f7efe0" stroke="#7a6a4a" strokeWidth="1.2" />
          <path d="M8 7.5h0.01M12 11.5h0.01M16 15.5h0.01" stroke="#3a2e1e" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {kind === 'feather' && (
        <>
          <path d="M19.5 2.5C12 3.5 6.6 9 6.2 16.4L4.6 21.4L5.8 21.8L8 17.4C15 16 19.6 10 19.5 2.5Z" fill="#e8b84a" stroke="#7a5a1a" strokeWidth="1" />
          <path d="M19 3.2Q12.5 10.5 5.4 21.4" stroke="#7a5a1a" strokeWidth="0.9" fill="none" />
          <path d="M14 8.6l-3.6 -1.2M12 11.4l-4 -0.6M10.4 14l-3.4 0.4M15.4 9.2l1.4 2.6M13.2 12.4l1.2 2.4" stroke="#9a7424" strokeWidth="0.7" />
        </>
      )}
      {kind === 'predator' && (
        <>
          <circle cx="12" cy="12" r="10.5" fill="#a8452a" stroke="#4a1a0e" strokeWidth="1.2" />
          <path d="M6 8Q13 5 16.4 10.6Q18.6 15 14.6 19.6Q15.4 15.2 12.4 12.6Q9.6 10.4 6 8Z" fill="#f7efe0" />
          <path d="M8.4 12.6Q11.6 12 12.6 15.4Q11 14.4 8.4 12.6Z" fill="#f7efe0" />
        </>
      )}
      {kind === 'flock' && (
        <>
          <circle cx="12" cy="12" r="10.5" fill="#3f84a6" stroke="#183f54" strokeWidth="1.2" />
          <path d="M4.6 11q2.4 -3 4.8 0q2.4 -3 4.8 0M10 16q2 -2.6 4 0q2 -2.6 4 0M12 7.4q1.6 -2 3.2 0q1.6 -2 3.2 0" stroke="#f7efe0" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        </>
      )}
      {kind === 'bonus' && (
        <>
          <path d="M6 4h11a2 2 0 0 1 2 2v12a3 3 0 0 1 -3 3H7a3 3 0 0 1 -3 -3V6a2 2 0 0 1 2 -2Z" fill="#cde0ee" stroke="#3a5a74" strokeWidth="1.2" />
          <path d="M7.5 8.5h8M7.5 11.5h8M7.5 14.5h5" stroke="#3a5a74" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="16.4" cy="17" r="2.4" fill="#e5a952" stroke="#7a4a1a" strokeWidth="0.8" />
        </>
      )}
    </svg>
  );
}

// ============================================================================
// WINGSPAN SVG ICONS & ILLUSTRATIONS
// ============================================================================

export function FoodIcon({ food, size = 18 }: { food: string; size?: number }) {
  const f = food.toLowerCase();
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className="svg-icon"
      role="img"
      aria-label={food}
    >
      {f === 'invertebrate' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#3f8f6b" stroke="#1d4d37" strokeWidth="1.4" />
          <circle cx="7.5" cy="14" r="3" fill="#a8e6cf" />
          <circle cx="11.5" cy="11.5" r="3" fill="#88d8b0" />
          <circle cx="15.8" cy="9.5" r="3.2" fill="#a8e6cf" />
          <circle cx="16.8" cy="8.8" r="1" fill="#1d4d37" />
        </>
      )}
      {f === 'seed' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#c28d2e" stroke="#63440d" strokeWidth="1.4" />
          <path d="M12 5 C16 8 17 14 12 19 C7 14 8 8 12 5 Z" fill="#f7d98c" stroke="#63440d" strokeWidth="1.1" />
          <path d="M8.5 8.5 Q12 6.5 15.5 8.5" fill="none" stroke="#63440d" strokeWidth="1.4" />
        </>
      )}
      {f === 'fish' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#3877a8" stroke="#183b59" strokeWidth="1.4" />
          <path d="M5 12 Q10 6.5 16 12 L20 8.5 L19 12 L20 15.5 L16 12 Q10 17.5 5 12 Z" fill="#bfe3f7" />
          <circle cx="8.5" cy="11.2" r="1.1" fill="#183b59" />
        </>
      )}
      {f === 'fruit' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#c44569" stroke="#5e192d" strokeWidth="1.4" />
          <path d="M9 14 C9 9 13 7 15 6 C14 9 15 11 15 14" fill="none" stroke="#c8f7c5" strokeWidth="1.4" />
          <circle cx="9" cy="15" r="3.6" fill="#ff8a9d" stroke="#5e192d" strokeWidth="1" />
          <circle cx="15" cy="14.5" r="3.6" fill="#ff6b81" stroke="#5e192d" strokeWidth="1" />
        </>
      )}
      {f === 'rodent' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#7d6756" stroke="#3b2e25" strokeWidth="1.4" />
          <ellipse cx="11.5" cy="13.5" rx="5.2" ry="3.8" fill="#d9c6b5" />
          <circle cx="8.5" cy="10" r="2.2" fill="#d9c6b5" />
          <circle cx="7.2" cy="13.2" r="1" fill="#3b2e25" />
          <path d="M16.5 14.5 Q20 15 19.5 11.5" fill="none" stroke="#d9c6b5" strokeWidth="1.3" />
        </>
      )}
      {f === 'nectar' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#e06397" stroke="#6b1d3f" strokeWidth="1.4" />
          {[0, 72, 144, 216, 288].map((deg) => (
            <ellipse
              key={deg}
              cx="12"
              cy="7.2"
              rx="2.7"
              ry="4.2"
              fill="#ffd166"
              transform={`rotate(${deg} 12 12)`}
            />
          ))}
          <circle cx="12" cy="12" r="2.6" fill="#ef476f" />
        </>
      )}
      {f === 'split' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#3f8f6b" stroke="#2b2113" strokeWidth="1.4" />
          <path d="M20 4 A11 11 0 0 1 4 20 Z" fill="#c28d2e" />
          <line x1="4" y1="20" x2="20" y2="4" stroke="#f7efe0" strokeWidth="1.5" />
          <circle cx="8.5" cy="8.5" r="2.5" fill="#a8e6cf" />
          <circle cx="15.5" cy="15.5" r="2.5" fill="#f7d98c" />
        </>
      )}
      {(f === 'any' || f === 'wild') && (
        <>
          <circle cx="12" cy="12" r="11" fill="#5b6d5b" stroke="#222" strokeWidth="1.4" />
          <path d="M12 12 L12 1 A11 11 0 0 1 21.5 6.5 Z" fill="#3f8f6b" />
          <path d="M12 12 L21.5 6.5 A11 11 0 0 1 21.5 17.5 Z" fill="#c28d2e" />
          <path d="M12 12 L21.5 17.5 A11 11 0 0 1 12 23 Z" fill="#3877a8" />
          <path d="M12 12 L12 23 A11 11 0 0 1 2.5 17.5 Z" fill="#c44569" />
          <path d="M12 12 L2.5 17.5 A11 11 0 0 1 2.5 6.5 Z" fill="#7d6756" />
          <path d="M12 12 L2.5 6.5 A11 11 0 0 1 12 1 Z" fill="#e06397" />
          <circle cx="12" cy="12" r="3.2" fill="#f7efe0" />
        </>
      )}
      <circle cx="12" cy="12" r="10.6" fill="url(#ws-sheen)" />
    </svg>
  );
}

export function DieFaceSvg({ face, size = 34 }: { face: string; size?: number }) {
  return (
    <svg viewBox="0 0 38 38" width={size} height={size} role="img" aria-label={`Die: ${face}`}>
      <rect x="1.5" y="2.5" width="35" height="34" rx="7" fill="#cbb68c" />
      <rect x="1.5" y="1.5" width="35" height="33" rx="7" fill="#f7efe0" stroke="#9e875b" strokeWidth="1.4" />
      <g transform="translate(7, 6)">
        <FoodIcon food={face} size={24} />
      </g>
    </svg>
  );
}

export function HabitatIcon({ habitat, size = 18 }: { habitat: string; size?: number }) {
  const h = habitat.toLowerCase();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="svg-icon" role="img" aria-label={habitat}>
      {h === 'forest' && (
        <>
          <polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="#3a6b4c" stroke="#1c3b27" strokeWidth="1.3" />
          <polygon points="12,5 6.5,13 17.5,13" fill="#b7e4c7" />
          <polygon points="12,9.5 5.5,17.5 18.5,17.5" fill="#95d5b2" />
          <rect x="10.8" y="17.5" width="2.4" height="3" fill="#d8f3dc" />
        </>
      )}
      {h === 'grassland' && (
        <>
          <polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="#b59431" stroke="#5c4910" strokeWidth="1.3" />
          <path d="M8 19 Q8 11 6 7 M12 19 L12 5 M16 19 Q16 11 18 7" fill="none" stroke="#fff3b0" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="12" cy="6" r="1.6" fill="#fff3b0" />
        </>
      )}
      {h === 'wetland' && (
        <>
          <polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="#3b7ea1" stroke="#183f54" strokeWidth="1.3" />
          <path d="M5 13 Q8.5 10.5 12 13 T19 13" fill="none" stroke="#caf0f8" strokeWidth="2" strokeLinecap="round" />
          <path d="M5 17 Q8.5 14.5 12 17 T19 17" fill="none" stroke="#90e0ef" strokeWidth="2" strokeLinecap="round" />
        </>
      )}
      <polygon points="12,1 22,7 22,17 12,23 2,17 2,7" fill="url(#ws-sheen)" />
    </svg>
  );
}

export function NestIcon({ nest, size = 18 }: { nest: string; size?: number }) {
  const n = (nest || 'none').toLowerCase();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="svg-icon" role="img" aria-label={`Nest: ${nest}`}>
      <circle cx="12" cy="12" r="10.5" fill="#6b533b" stroke="#362819" strokeWidth="1.3" />
      {n === 'bowl' && (
        <path d="M5.5 11 A6.5 6 0 0 0 18.5 11 Z" fill="#e9d3ab" stroke="#362819" strokeWidth="1.1" />
      )}
      {n === 'cavity' && (
        <>
          <circle cx="12" cy="12" r="5.2" fill="#23190f" stroke="#e9d3ab" strokeWidth="1.5" />
        </>
      )}
      {n === 'ground' && (
        <>
          <ellipse cx="12" cy="15" rx="6.8" ry="2.6" fill="#e9d3ab" />
          <circle cx="9.8" cy="12.5" r="2" fill="#bfe0e8" />
          <circle cx="14.2" cy="12.5" r="2" fill="#f2d794" />
        </>
      )}
      {n === 'platform' && (
        <>
          <line x1="5" y1="11" x2="19" y2="11" stroke="#e9d3ab" strokeWidth="2.2" strokeLinecap="round" />
          <line x1="6.5" y1="14.5" x2="17.5" y2="14.5" stroke="#e9d3ab" strokeWidth="2" strokeLinecap="round" />
          <line x1="8" y1="17.5" x2="16" y2="17.5" stroke="#e9d3ab" strokeWidth="1.8" strokeLinecap="round" />
        </>
      )}
      {(n === 'wild' || n === 'star') && (
        <polygon
          points="12,4.5 14.2,9.2 19.3,9.8 15.5,13.3 16.5,18.4 12,15.8 7.5,18.4 8.5,13.3 4.7,9.8 9.8,9.2"
          fill="#ffd166"
          stroke="#362819"
          strokeWidth="0.9"
        />
      )}
      {n === 'none' && (
        <line x1="7" y1="12" x2="17" y2="12" stroke="#cbb99c" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

const EGG_PALETTE = [
  { fill: '#bfe0e8', stroke: '#4a6b74' },
  { fill: '#f2d794', stroke: '#7a5e24' },
  { fill: '#c8e0b4', stroke: '#4b6835' },
  { fill: '#e8b8a8', stroke: '#784030' },
  { fill: '#d6c4e8', stroke: '#5a4372' },
];

export function EggTokenSvg({ index = 0, size = 16 }: { index?: number; size?: number }) {
  const c = EGG_PALETTE[index % EGG_PALETTE.length]!;
  return (
    <svg viewBox="0 0 18 22" width={size * 0.85} height={size} className="svg-icon" role="img" aria-label="Egg">
      <path
        d="M9 1.5 C13.5 1.5 16.5 8.5 16.5 13.5 C16.5 18 13.2 20.5 9 20.5 C4.8 20.5 1.5 18 1.5 13.5 C1.5 8.5 4.5 1.5 9 1.5 Z"
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth="1.4"
      />
      <ellipse cx="7" cy="8" rx="4" ry="5" fill="url(#ws-sheen)" />
      <circle cx="6.5" cy="9" r="1.1" fill={c.stroke} opacity="0.65" />
      <circle cx="11.5" cy="13" r="1.3" fill={c.stroke} opacity="0.65" />
      <circle cx="8" cy="15.5" r="0.9" fill={c.stroke} opacity="0.65" />
    </svg>
  );
}

export function ActionCubeSvg({ color = 'orange', size = 18 }: { color?: string; size?: number }) {
  const hex = playerColorHex(color);
  return (
    <svg viewBox="0 0 22 22" width={size} height={size} className="svg-icon" role="img" aria-label="Action cube">
      <polygon points="11,2 20,7 11,12 2,7" fill={hex} stroke="#1a1a1a" strokeWidth="1.1" />
      <polygon points="2,7 11,12 11,20 2,15" fill={hex} filter="brightness(0.85)" stroke="#1a1a1a" strokeWidth="1.1" />
      <polygon points="20,7 11,12 11,20 20,15" fill={hex} filter="brightness(0.7)" stroke="#1a1a1a" strokeWidth="1.1" />
    </svg>
  );
}

/** Render Wingspan power/goal text with inline SVG icons for [token] tags. */
export function renderWingspanText(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((part, idx) => {
    const m = /^\[([^\]]+)\]$/.exec(part);
    if (!m) return part;
    const tag = m[1]!.toLowerCase();
    if (
      tag === 'invertebrate' ||
      tag === 'seed' ||
      tag === 'fish' ||
      tag === 'fruit' ||
      tag === 'rodent' ||
      tag === 'nectar' ||
      tag === 'wild'
    ) {
      return <FoodIcon key={idx} food={tag} size={14} />;
    }
    if (tag === 'forest' || tag === 'grassland' || tag === 'wetland') {
      return <HabitatIcon key={idx} habitat={tag} size={14} />;
    }
    if (tag === 'bowl' || tag === 'cavity' || tag === 'ground' || tag === 'platform' || tag === 'star') {
      return <NestIcon key={idx} nest={tag} size={14} />;
    }
    if (tag === 'egg') return <EggTokenSvg key={idx} index={0} size={14} />;
    if (tag === 'card' || tag === 'bird_with_tucked_card') {
      return (
        <TokenIcon key={idx} kind="card" title="Bird card" />
      );
    }
    if (tag === 'die') {
      return (
        <TokenIcon key={idx} kind="die" title="Birdfeeder die" />
      );
    }
    if (tag === 'point' || tag === 'feather') {
      return (
        <TokenIcon key={idx} kind="feather" title="Victory points" />
      );
    }
    if (tag === 'predator') {
      return (
        <TokenIcon key={idx} kind="predator" title="Predator" />
      );
    }
    if (tag === 'flocking') {
      return (
        <TokenIcon key={idx} kind="flock" title="Flocking" />
      );
    }
    return (
      <span key={idx} className="inline-chip">
        {m[1]}
      </span>
    );
  });
}

// ============================================================================
// WYRMSPAN SVG ICONS & ILLUSTRATIONS
// ============================================================================

export function WyrmResourceIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const k = kind.toLowerCase();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="svg-icon" role="img" aria-label={kind}>
      {k === 'meat' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#b83b3b" stroke="#4f1212" strokeWidth="1.4" />
          <ellipse cx="11" cy="12" rx="6.2" ry="4.5" fill="#f28482" stroke="#4f1212" strokeWidth="1.1" />
          <circle cx="14.5" cy="11.5" r="1.8" fill="#fff1e6" />
        </>
      )}
      {k === 'gold' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#c9931b" stroke="#593e05" strokeWidth="1.4" />
          <polygon points="5,16 19,16 16,8 8,8" fill="#ffd166" stroke="#593e05" strokeWidth="1.2" />
        </>
      )}
      {k === 'crystal' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#7b42bc" stroke="#311457" strokeWidth="1.4" />
          <polygon points="12,4 17,10 14.5,19 9.5,19 7,10" fill="#e0aaff" stroke="#311457" strokeWidth="1.1" />
        </>
      )}
      {k === 'milk' && (
        <>
          <circle cx="12" cy="12" r="11" fill="#5b8ca8" stroke="#1d3a4d" strokeWidth="1.4" />
          <path d="M9,6 L15,6 L14,9 L16.5,13 L16.5,18.5 L7.5,18.5 L7.5,13 L10,9 Z" fill="#f8f9fa" stroke="#1d3a4d" strokeWidth="1.1" />
        </>
      )}
      {(k === 'any' || k === 'anyresource') && (
        <>
          <circle cx="12" cy="12" r="11" fill="#3a3347" stroke="#1a1423" strokeWidth="1.4" />
          <path d="M12 12 L12 2 A10 10 0 0 1 22 12 Z" fill="#b83b3b" />
          <path d="M12 12 L22 12 A10 10 0 0 1 12 22 Z" fill="#c9931b" />
          <path d="M12 12 L12 22 A10 10 0 0 1 2 12 Z" fill="#7b42bc" />
          <path d="M12 12 L2 12 A10 10 0 0 1 12 2 Z" fill="#f8f9fa" />
        </>
      )}
      {k === 'coin' && (
        <>
          <circle cx="12" cy="12" r="10.5" fill="#ced4da" stroke="#495057" strokeWidth="1.6" />
          <circle cx="12" cy="12" r="7.5" fill="none" stroke="#6c757d" strokeWidth="1.1" strokeDasharray="2 2" />
          <polygon points="12,6.5 14.5,12 12,17.5 9.5,12" fill="#6c757d" />
        </>
      )}
      {k === 'egg' && (
        <>
          <path
            d="M12 2.5 C17 2.5 20 10 20 15 C20 19.5 16.5 22 12 22 C7.5 22 4 19.5 4 15 C4 10 7 2.5 12 2.5 Z"
            fill="#e0a96d"
            stroke="#5c3a18"
            strokeWidth="1.4"
          />
          <path d="M8 11 Q12 14 16 11 M8 15 Q12 18 16 15" fill="none" stroke="#8a5a2b" strokeWidth="1.2" />
        </>
      )}
      {(k === 'guild' || k === 'dragonguild') && (
        <>
          <polygon points="12,1.5 21,6.8 21,17.2 12,22.5 3,17.2 3,6.8" fill="#5e4b8b" stroke="#231942" strokeWidth="1.4" />
          <polygon points="12,4.5 14,10 19.5,12 14,14 12,19.5 10,14 4.5,12 10,10" fill="#ffd166" />
        </>
      )}
      {(k === 'dragoncard' || k === 'dragon') && (
        <>
          <rect x="4" y="2.5" width="16" height="19" rx="2.5" fill="#6c4675" stroke="#e0aaff" strokeWidth="1.3" />
          <path d="M8,14 L12,7 L16,14 L12,12 Z" fill="#ffd166" />
        </>
      )}
      {(k === 'cavecard' || k === 'cave') && (
        <>
          <rect x="3" y="4" width="18" height="16" rx="2.5" fill="#5c4d42" stroke="#ddb892" strokeWidth="1.3" />
          <path d="M7,17 L7,11 A5,5 0 0,1 17,11 L17,17 Z" fill="#23190f" />
        </>
      )}
    </svg>
  );
}

export function AdventurerMeepleSvg({ color = 'orange', size = 22 }: { color?: string; size?: number }) {
  const hex = playerColorHex(color);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="svg-icon" role="img" aria-label="Adventurer">
      <circle cx="12" cy="6.5" r="4" fill={hex} stroke="#1a1a1a" strokeWidth="1.4" />
      <path d="M5,21 C5,14 8,11.5 12,11.5 C16,11.5 19,14 19,21 Z" fill={hex} stroke="#1a1a1a" strokeWidth="1.4" />
      <circle cx="18.5" cy="14" r="2.5" fill="#ffd166" stroke="#1a1a1a" strokeWidth="1" />
    </svg>
  );
}

export function renderWyrmspanText(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((part, idx) => {
    const m = /^\[([^\]]+)\]$/.exec(part);
    if (!m) return part;
    const raw = m[1]!;
    const vp = /^VP-(\d+)$/i.exec(raw);
    if (vp) {
      return (
        <span key={idx} className="inline-chip chip-vp" title={`${vp[1]} VP`}>
          🛡{vp[1]}
        </span>
      );
    }
    return <WyrmResourceIcon key={idx} kind={raw} size={14} />;
  });
}

// ============================================================================
// FINSPAN SVG ICONS & ILLUSTRATIONS
// ============================================================================

export function FinIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const k = kind.toLowerCase();
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="svg-icon" role="img" aria-label={kind}>
      {(k === 'egg' || k === 'fishegg') && (
        <>
          <circle cx="12" cy="12" r="9.5" fill="#ffd166" fillOpacity="0.85" stroke="#b57c00" strokeWidth="1.5" />
          <circle cx="10" cy="10" r="3.2" fill="#ef476f" />
          <circle cx="14.5" cy="8.5" r="1.6" fill="#fff" opacity="0.8" />
        </>
      )}
      {(k === 'young' || k === 'youngfish') && (
        <>
          <circle cx="12" cy="12" r="10.5" fill="#1e6091" stroke="#0b2239" strokeWidth="1.3" />
          <path d="M5,12 Q10,7 16,12 L20,9 L19,12 L20,15 L16,12 Q10,17 5,12 Z" fill="#90e0ef" />
          <circle cx="8" cy="11.2" r="1.1" fill="#0b2239" />
        </>
      )}
      {(k === 'school' || k === 'schoolfish') && (
        <>
          <circle cx="12" cy="12" r="11" fill="#0077b6" stroke="#caf0f8" strokeWidth="1.4" />
          {[-4, 0, 4].map((dy, i) => (
            <path
              key={i}
              d={`M${6 + (i % 2) * 2},${12 + dy} Q${10 + (i % 2) * 2},${9.5 + dy} ${15 + (i % 2) * 2},${12 + dy} L${18 + (i % 2) * 2},${10 + dy} L${18 + (i % 2) * 2},${14 + dy} Z`}
              fill="#caf0f8"
            />
          ))}
        </>
      )}
      {(k === 'hatch' || k === 'fishhatch') && (
        <>
          <circle cx="12" cy="12" r="10.5" fill="#2a9d8f" stroke="#134e47" strokeWidth="1.3" />
          <path d="M6,14 L9,10 L11,14 L14,9 L18,13" fill="none" stroke="#ffd166" strokeWidth="2" />
        </>
      )}
      {(k === 'move' || k === 'schoolfeedermove') && (
        <>
          <circle cx="12" cy="12" r="10.5" fill="#48cae4" stroke="#023e8a" strokeWidth="1.3" />
          <path d="M6,12 L16,12 M13,8 L18,12 L13,16" fill="none" stroke="#023e8a" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {(k === 'coral' || k.startsWith('coral') || k.endsWith('coral')) && (
        <>
          <circle
            cx="12"
            cy="12"
            r="10.5"
            fill={
              k.includes('blue')
                ? '#3a86ff'
                : k.includes('purple')
                  ? '#8338ec'
                  : k.includes('green')
                    ? '#38b000'
                    : '#ff006e'
            }
            stroke="#1a1a1a"
            strokeWidth="1.3"
          />
          <path
            d="M12,19 L12,9 M12,14 L8,10 M12,12 L16,8"
            fill="none"
            stroke="#fff"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </>
      )}
      {(k === 'draw' || k === 'drawcard' || k === 'recovercard') && (
        <>
          <rect x="4" y="3" width="16" height="18" rx="2.5" fill="#1e6091" stroke="#90e0ef" strokeWidth="1.4" />
          <path d="M8,12 Q12,9 15,12 Q12,15 8,12 Z" fill="#90e0ef" />
        </>
      )}
      {k.includes('consume') && (
        <>
          <circle cx="12" cy="12" r="10.5" fill="#9d0208" stroke="#370617" strokeWidth="1.3" />
          <path d="M5,8 L14,12 L5,16 Z M13,12 L19,10 L19,14 Z" fill="#ffd166" />
        </>
      )}
    </svg>
  );
}

export function DiverMeepleSvg({ color = 'c0', size = 20 }: { color?: string; size?: number }) {
  const hex = playerColorHex(color);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="svg-icon" role="img" aria-label="Diver">
      <circle cx="12" cy="6" r="4.2" fill={hex} stroke="#0b2239" strokeWidth="1.4" />
      <rect x="9.5" y="4.5" width="5" height="3" rx="1" fill="#caf0f8" />
      <path d="M8,10.5 L16,10.5 L15,17 L18,21 L14,21 L12,17 L10,21 L6,21 L9,17 Z" fill={hex} stroke="#0b2239" strokeWidth="1.2" />
    </svg>
  );
}

export function renderFinspanText(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((part, idx) => {
    const m = /^\[([^\]]+)\]$/.exec(part);
    if (!m) return part;
    const raw = m[1]!;
    return <FinIcon key={idx} kind={raw} size={14} />;
  });
}
