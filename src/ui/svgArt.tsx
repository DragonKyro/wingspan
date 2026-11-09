// Hand-crafted thematic SVG artwork, icons, card illustrations, and inline
// text-token iconizers for Wingspan, Wyrmspan, and Finspan.
// Pure vector SVG with no external image files and no global <defs> ID clashes.

import type { ReactNode } from 'react';

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

export function WingspanThumbnail() {
  return (
    <svg viewBox="0 0 280 140" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Wingspan">
      {/* Dawn sky to wetland water */}
      <rect width="280" height="140" fill="#234236" />
      <rect y="0" width="280" height="56" fill="#e8c382" opacity="0.22" />
      <circle cx="224" cy="36" r="22" fill="#f6d892" opacity="0.85" />
      {/* Rolling forest & meadow hills */}
      <path d="M0 92 Q70 64 150 86 T280 78 L280 140 L0 140 Z" fill="#3a6b4c" />
      <path d="M0 108 Q95 88 185 104 T280 98 L280 140 L0 140 Z" fill="#8fa347" opacity="0.85" />
      <path d="M0 120 Q110 112 280 118 L280 140 L0 140 Z" fill="#3d7a96" />
      {/* Pine trees on left */}
      {[22, 42, 60].map((x, i) => (
        <g key={x} transform={`translate(${x}, ${72 + (i % 2) * 6})`}>
          <polygon points="0,-24 -11,0 11,0" fill="#244a34" />
          <polygon points="0,-15 -9,6 9,6" fill="#2e5c41" />
        </g>
      ))}
      {/* Mini bird card fan */}
      <g transform="translate(88, 22) rotate(-8)">
        <rect width="58" height="78" rx="6" fill="#f7efe0" stroke="#bba67d" strokeWidth="1.5" />
        <rect x="4" y="4" width="50" height="14" rx="3" fill="#4a7c59" />
        <circle cx="30" cy="40" r="14" fill="#d96b43" opacity="0.25" />
        <path d="M18 44 Q28 26 40 34 Q46 32 49 35 Q43 39 39 43 Q29 50 18 44 Z" fill="#c84b31" />
        <rect x="4" y="58" width="50" height="14" rx="3" fill="#8b6239" />
      </g>
      <g transform="translate(132, 18) rotate(7)">
        <rect width="58" height="78" rx="6" fill="#f7efe0" stroke="#bba67d" strokeWidth="1.5" />
        <rect x="4" y="4" width="50" height="14" rx="3" fill="#4f8ba9" />
        <path d="M16 42 Q28 24 44 36 Q36 48 16 42 Z" fill="#3a7ca5" />
        <rect x="4" y="58" width="50" height="14" rx="3" fill="#d97b93" />
      </g>
      {/* Soaring bird silhouette */}
      <path
        d="M196 42 Q210 26 226 36 Q242 24 256 38 Q238 34 226 43 Q212 34 196 42 Z"
        fill="#1e352b"
      />
      {/* Speckled eggs & nectar blossom in foreground */}
      <g transform="translate(36, 114)">
        <ellipse cx="0" cy="0" rx="8" ry="10" fill="#bfe0e8" stroke="#4a6b74" strokeWidth="1.2" />
        <circle cx="-2" cy="-3" r="1.2" fill="#4a6b74" />
        <circle cx="3" cy="2" r="1" fill="#4a6b74" />
      </g>
      <g transform="translate(54, 117)">
        <ellipse cx="0" cy="0" rx="7.5" ry="9.5" fill="#f2d794" stroke="#7a5e24" strokeWidth="1.2" />
        <circle cx="2" cy="-2" r="1.1" fill="#7a5e24" />
      </g>
      <g transform="translate(232, 110)">
        <FoodIcon food="nectar" size={24} />
      </g>
    </svg>
  );
}

export function WyrmspanThumbnail() {
  return (
    <svg viewBox="0 0 280 140" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Wyrmspan">
      <rect width="280" height="140" fill="#1e1429" />
      {/* Three glowing cavern arches: Crimson, Golden, Amethyst */}
      <ellipse cx="56" cy="76" rx="44" ry="52" fill="#7c2334" opacity="0.55" />
      <ellipse cx="140" cy="72" rx="48" ry="56" fill="#9c6b21" opacity="0.48" />
      <ellipse cx="224" cy="76" rx="44" ry="52" fill="#5b348a" opacity="0.55" />
      {/* Stalactites */}
      <polygon points="18,0 28,36 38,0" fill="#2c1d3d" />
      <polygon points="74,0 82,28 90,0" fill="#2c1d3d" />
      <polygon points="190,0 198,32 206,0" fill="#2c1d3d" />
      <polygon points="242,0 252,40 262,0" fill="#2c1d3d" />
      {/* Dragon silhouette with spread wings in center */}
      <g transform="translate(140, 68)">
        <path
          d="M0,-28 L-8,-14 L-52,-32 L-38,-4 L-56,10 L-22,8 L-12,26 L0,18 L12,26 L22,8 L56,10 L38,-4 L52,-32 L8,-14 Z"
          fill="#e09f3e"
          stroke="#4a2511"
          strokeWidth="1.6"
        />
        <circle cx="-3" cy="-20" r="1.8" fill="#fff3b0" />
        <circle cx="3" cy="-20" r="1.8" fill="#fff3b0" />
      </g>
      {/* Crystals & coins at bottom */}
      <g transform="translate(42, 112)">
        <WyrmResourceIcon kind="crystal" size={24} />
      </g>
      <g transform="translate(72, 114)">
        <WyrmResourceIcon kind="coin" size={22} />
      </g>
      <g transform="translate(208, 112)">
        <WyrmResourceIcon kind="guild" size={24} />
      </g>
      <g transform="translate(238, 112)">
        <WyrmResourceIcon kind="egg" size={22} />
      </g>
    </svg>
  );
}

export function FinspanThumbnail() {
  return (
    <svg viewBox="0 0 280 140" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Finspan">
      {/* Sunlight -> Twilight -> Midnight depth bands */}
      <rect x="0" y="0" width="280" height="46" fill="#2b8cbe" />
      <rect x="0" y="46" width="280" height="48" fill="#16537e" />
      <rect x="0" y="94" width="280" height="46" fill="#0b2239" />
      {/* Sunbeams */}
      <polygon points="40,0 80,0 110,90 20,90" fill="#a6e1fa" opacity="0.14" />
      <polygon points="150,0 195,0 230,90 130,90" fill="#a6e1fa" opacity="0.12" />
      {/* Coral reef silhouettes at bottom */}
      <path d="M16 140 Q12 118 24 112 Q28 124 34 114 Q42 122 38 140 Z" fill="#e06388" opacity="0.85" />
      <path d="M226 140 Q222 116 234 108 Q242 120 250 110 Q258 122 252 140 Z" fill="#9b6bd6" opacity="0.85" />
      {/* Swimming fish & manta ray */}
      <g transform="translate(76, 26)">
        <path d="M-18,0 Q-4,-11 14,0 Q22,-7 26,-9 L23,0 L26,9 Q22,7 14,0 Q-4,11 -18,0 Z" fill="#f6c85f" />
        <circle cx="-10" cy="-2" r="1.6" fill="#132a3e" />
      </g>
      <g transform="translate(156, 68)">
        <path
          d="M-32,0 L-6,-22 L18,-4 L34,0 L18,4 L-6,22 Z"
          fill="#4cc9f0"
          stroke="#0b2239"
          strokeWidth="1.3"
        />
        <circle cx="-18" cy="-3" r="1.6" fill="#0b2239" />
      </g>
      {/* Bioluminescent angler in midnight zone */}
      <g transform="translate(112, 116)">
        <ellipse cx="0" cy="0" rx="16" ry="10" fill="#1f3b5c" stroke="#4ea8de" strokeWidth="1.2" />
        <path d="M-8,-8 Q-18,-18 -24,-10" fill="none" stroke="#90e0ef" strokeWidth="1.5" />
        <circle cx="-24" cy="-10" r="3.5" fill="#caf0f8" />
        <circle cx="-8" cy="-2" r="2" fill="#caf0f8" />
      </g>
      {/* School token on right */}
      <g transform="translate(216, 30)">
        <FinIcon kind="school" size={28} />
      </g>
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

/** Procedural vector bird illustration drawn from card metadata. */
export function BirdIllustration({
  cardId,
  name,
  habitats,
  wingspan,
  predator,
  beakLeft,
}: {
  cardId: number;
  name: string;
  habitats: readonly string[];
  wingspan: number | string;
  predator?: boolean;
  beakLeft?: boolean | null;
}) {
  const palettes = [
    { body: '#c84b31', wing: '#8c2d19', belly: '#f4d8b8', crest: '#e07a5f' },
    { body: '#3a7ca5', wing: '#1d4e6e', belly: '#e2eff7', crest: '#61a5c2' },
    { body: '#d99b26', wing: '#8c5e0a', belly: '#faedcd', crest: '#f4a261' },
    { body: '#4a7c59', wing: '#284b33', belly: '#e9f5db', crest: '#74c69d' },
    { body: '#7b5283', wing: '#4a2c52', belly: '#f2e8f5', crest: '#b5838d' },
    { body: '#5c5446', wing: '#363027', belly: '#e8dfd1', crest: '#a68a64' },
    { body: '#2b5876', wing: '#183446', belly: '#f5f7fa', crest: '#e63946' },
  ];
  const pal = palettes[cardId % palettes.length]!;
  const lower = name.toLowerCase();
  const isOwl = /owl/.test(lower);
  const isDuck = /duck|goose|swan|teal|mallard|pochard|grebe|loon|cormorant|pelican/.test(lower);
  const isWader = /heron|egret|crane|stork|ibis|spoonbill|bittern|flamingo|avocet|stilt|plover|sandpiper|curlew/.test(lower);
  const isRaptor = predator || /hawk|eagle|falcon|kite|harrier|vulture|osprey|buzzard|kestrel/.test(lower);
  const hab = habitats[0] ?? 'forest';
  const dir = beakLeft === false ? -1 : 1; // 1 = facing left, -1 = facing right
  const wsNum = typeof wingspan === 'number' ? wingspan : 45;
  const scale = wsNum < 30 ? 0.85 : wsNum > 100 ? 1.12 : 1;

  return (
    <svg viewBox="0 0 120 56" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      {/* Subtle habitat backdrop */}
      {hab === 'forest' && (
        <path d="M8 46 Q45 38 112 42" fill="none" stroke="#6c5234" strokeWidth="2.5" strokeLinecap="round" />
      )}
      {hab === 'grassland' && (
        <path d="M12 50 Q60 44 108 50" fill="none" stroke="#b59431" strokeWidth="2" opacity="0.6" />
      )}
      {hab === 'wetland' && (
        <ellipse cx="64" cy="48" rx="44" ry="5" fill="#4f8ba9" opacity="0.28" />
      )}

      <g transform={`translate(62, 30) scale(${dir * scale}, ${scale})`}>
        {isOwl ? (
          <>
            {/* Upright owl silhouette */}
            <ellipse cx="0" cy="4" rx="11" ry="15" fill={pal.body} />
            <ellipse cx="-2" cy="6" rx="7" ry="11" fill={pal.belly} />
            <ellipse cx="4" cy="4" rx="6" ry="11" fill={pal.wing} />
            <circle cx="-2" cy="-10" r="8.5" fill={pal.body} />
            <polygon points="-8,-16 -5,-21 -2,-16" fill={pal.wing} />
            <polygon points="1,-16 4,-21 6,-16" fill={pal.wing} />
            <circle cx="-5" cy="-10" r="3" fill="#ffd166" />
            <circle cx="-5" cy="-10" r="1.4" fill="#1a1a1a" />
            <circle cx="1" cy="-10" r="3" fill="#ffd166" />
            <circle cx="1" cy="-10" r="1.4" fill="#1a1a1a" />
            <polygon points="-2,-9 -4,-5 0,-5" fill="#e09f3e" />
          </>
        ) : isDuck ? (
          <>
            {/* Swimming waterfowl silhouette */}
            <path d="M-16,6 Q-14,16 4,15 Q18,14 22,5 Q12,4 -16,6 Z" fill={pal.body} />
            <ellipse cx="3" cy="8" rx="10" ry="4.5" fill={pal.wing} />
            <path d="M-12,7 Q-16,-4 -12,-10 Q-7,-12 -6,-7 Q-8,2 -6,7 Z" fill={pal.crest} />
            <circle cx="-11" cy="-9" r="5" fill={pal.crest} />
            <path d="M-15,-10 L-24,-8 Q-23,-6 -15,-7 Z" fill="#e09f3e" />
            <circle cx="-12.5" cy="-10" r="1.2" fill="#1a1a1a" />
          </>
        ) : isWader ? (
          <>
            {/* Long-legged wading bird */}
            <line x1="-1" y1="8" x2="-3" y2="21" stroke="#c28d2e" strokeWidth="1.6" />
            <line x1="4" y1="8" x2="6" y2="21" stroke="#c28d2e" strokeWidth="1.6" />
            <ellipse cx="2" cy="1" rx="13" ry="7.5" fill={pal.body} />
            <ellipse cx="4" cy="0" rx="9" ry="5" fill={pal.wing} />
            <path d="M-9,-1 Q-16,-10 -12,-17 Q-9,-17 -9,-12 Q-11,-5 -6,1 Z" fill={pal.body} />
            <circle cx="-12" cy="-16" r="4" fill={pal.body} />
            <polygon points="-15,-17 -28,-15 -15,-14" fill="#e09f3e" />
            <circle cx="-13" cy="-16.5" r="1.1" fill="#1a1a1a" />
          </>
        ) : isRaptor ? (
          <>
            {/* Hook-beaked raptor with broad wings */}
            <polygon points="10,4 24,13 18,16 6,7" fill={pal.wing} />
            <ellipse cx="0" cy="1" rx="13" ry="8.5" fill={pal.body} />
            <path d="M-10,2 Q-4,9 6,7 Q0,-2 -10,2 Z" fill={pal.belly} />
            <path d="M-3,-5 Q10,-14 22,-4 Q10,4 -3,-5 Z" fill={pal.wing} />
            <circle cx="-11" cy="-6" r="6" fill={pal.crest} />
            <path d="M-16,-8 Q-23,-7 -21,-2 L-16,-4 Z" fill="#e09f3e" />
            <circle cx="-13" cy="-7" r="1.3" fill="#1a1a1a" />
          </>
        ) : (
          <>
            {/* Perched songbird */}
            <polygon points="10,3 25,9 22,14 8,6" fill={pal.wing} />
            <ellipse cx="0" cy="2" rx="13" ry="8" fill={pal.body} />
            <path d="M-11,2 Q-4,10 8,6 Q1,-1 -11,2 Z" fill={pal.belly} />
            <ellipse cx="2" cy="1" rx="9" ry="5" fill={pal.wing} transform="rotate(-10 2 1)" />
            <circle cx="-10" cy="-5" r="6" fill={pal.crest} />
            <polygon points="-15,-6 -23,-4 -15,-2" fill="#362819" />
            <circle cx="-12" cy="-6" r="1.3" fill="#1a1a1a" />
            <line x1="-2" y1="9" x2="-4" y2="16" stroke="#5c4938" strokeWidth="1.4" />
            <line x1="3" y1="9" x2="2" y2="16" stroke="#5c4938" strokeWidth="1.4" />
          </>
        )}
      </g>
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
        <span key={idx} className="inline-chip chip-card" title="Bird card">
          🂠
        </span>
      );
    }
    if (tag === 'die') {
      return (
        <span key={idx} className="inline-chip chip-die" title="Birdfeeder die">
          🎲
        </span>
      );
    }
    if (tag === 'point' || tag === 'feather') {
      return (
        <span key={idx} className="inline-chip chip-vp" title="Victory points">
          🪶
        </span>
      );
    }
    if (tag === 'predator') {
      return (
        <span key={idx} className="inline-chip chip-pred" title="Predator">
          🦅
        </span>
      );
    }
    if (tag === 'flocking') {
      return (
        <span key={idx} className="inline-chip chip-flock" title="Flocking">
          🐦
        </span>
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

export function DragonIllustration({
  id,
  personality,
  size: dragonSize,
}: {
  id: number;
  personality: string;
  size: string;
}) {
  const p = personality.toLowerCase();
  const pal =
    p === 'aggressive'
      ? { primary: '#c1121f', wing: '#780000', accent: '#ffb703' }
      : p === 'helpful'
        ? { primary: '#2d6a4f', wing: '#1b4332', accent: '#95d5b2' }
        : p === 'playful'
          ? { primary: '#e07a5f', wing: '#9c4129', accent: '#f2cc8f' }
          : { primary: '#3d5a80', wing: '#293241', accent: '#98c1d9' };
  const isHatchling = dragonSize === 'Hatchling';
  const isFledgling = dragonSize === 'Fledgling';
  const s = isHatchling ? 0.78 : isFledgling ? 0.88 : dragonSize === 'Large' ? 1.1 : 0.96;

  return (
    <svg viewBox="0 0 120 56" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g transform={`translate(60, 29) scale(${s})`}>
        {isHatchling ? (
          <>
            {/* Hatchling emerging from cracked dragon egg */}
            <path d="M-14,6 L-9,1 L-4,7 L2,1 L8,7 L14,2 C14,14 8,19 0,19 C-8,19 -14,14 -14,6 Z" fill="#e0a96d" stroke="#5c3a18" strokeWidth="1.3" />
            <circle cx="0" cy="-4" r="8" fill={pal.primary} />
            <polygon points="-6,-10 -9,-17 -2,-11" fill={pal.accent} />
            <polygon points="6,-10 9,-17 2,-11" fill={pal.accent} />
            <circle cx="-3" cy="-5" r="1.6" fill="#fff" />
            <circle cx="3" cy="-5" r="1.6" fill="#fff" />
          </>
        ) : (
          <>
            {/* Winged dragon */}
            <path
              d="M-6,-2 L-42,-20 L-32,-2 L-44,9 L-16,6 Z"
              fill={pal.wing}
              stroke={pal.accent}
              strokeWidth="0.9"
            />
            <path
              d="M6,-2 L42,-20 L32,-2 L44,9 L16,6 Z"
              fill={pal.wing}
              stroke={pal.accent}
              strokeWidth="0.9"
            />
            <ellipse cx="0" cy="4" rx="11" ry="12" fill={pal.primary} />
            <ellipse cx="0" cy="6" rx="6.5" ry="8.5" fill={pal.accent} opacity="0.7" />
            <circle cx="0" cy="-10" r="6.5" fill={pal.primary} />
            <polygon points="-4,-15 -8,-22 -1,-16" fill={pal.accent} />
            <polygon points="4,-15 8,-22 1,-16" fill={pal.accent} />
            <circle cx="-2.4" cy="-10.5" r="1.3" fill="#ffd166" />
            <circle cx="2.4" cy="-10.5" r="1.3" fill="#ffd166" />
            <path d="M0,15 Q16,22 26,12" fill="none" stroke={pal.primary} strokeWidth="3" strokeLinecap="round" />
            {(id % 3 === 0 || p === 'aggressive') && (
              <circle cx="0" cy="-21" r="2.5" fill="#ffb703" opacity="0.85" />
            )}
          </>
        )}
      </g>
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

export function FishIllustration({
  id,
  name,
  size: fishSize,
  tags,
  forage,
}: {
  id: number;
  name: string;
  size: 'small' | 'medium' | 'large';
  tags?: {
    bioluminescent?: number;
    camouflage?: number;
    electric?: number;
    predator?: number;
    venomous?: number;
  };
  forage?: boolean;
}) {
  const palettes = [
    { body: '#48cae4', fin: '#0077b6', accent: '#caf0f8' },
    { body: '#f4a261', fin: '#e76f51', accent: '#e9c46a' },
    { body: '#9b5de5', fin: '#5a189a', accent: '#f15bb5' },
    { body: '#52b788', fin: '#2d6a4f', accent: '#b7e4c7' },
    { body: '#e63946', fin: '#9d0208', accent: '#ffd166' },
  ];
  const pal = forage
    ? { body: '#adb5bd', fin: '#6c757d', accent: '#dee2e6' }
    : palettes[id % palettes.length]!;
  const lower = name.toLowerCase();
  const isRay = /ray|skate|manta|sawfish/.test(lower);
  const isShark = /shark/.test(lower) || (tags?.predator ?? 0) >= 2;
  const isEel = /eel|moray|oarfish|hagfish|lamprey/.test(lower);
  const sc = fishSize === 'small' ? 0.8 : fishSize === 'large' ? 1.12 : 0.96;

  return (
    <svg viewBox="0 0 120 48" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g transform={`translate(60, 24) scale(${sc})`}>
        {isRay ? (
          <>
            <polygon points="-32,0 -6,-18 16,-3 36,0 16,3 -6,18" fill={pal.body} stroke={pal.fin} strokeWidth="1.2" />
            <circle cx="-18" cy="-3" r="1.5" fill="#0b2239" />
          </>
        ) : isEel ? (
          <>
            <path d="M-34,-2 Q-18,-12 0,0 T34,2" fill="none" stroke={pal.body} strokeWidth="7" strokeLinecap="round" />
            <circle cx="-31" cy="-3" r="1.4" fill="#0b2239" />
          </>
        ) : isShark ? (
          <>
            <path d="M-30,0 Q-12,-11 16,-4 L28,-13 L23,0 L28,13 L16,4 Q-12,11 -30,0 Z" fill={pal.body} />
            <polygon points="-4,-7 2,-18 8,-6" fill={pal.fin} />
            <circle cx="-20" cy="-2" r="1.6" fill="#0b2239" />
          </>
        ) : (
          <>
            <polygon points="12,0 26,-11 23,0 26,11" fill={pal.fin} />
            <ellipse cx="-2" cy="0" rx="18" ry="10.5" fill={pal.body} />
            <polygon points="-4,-10 3,-17 8,-9" fill={pal.fin} />
            <path d="M-8,-4 Q2,0 -8,4" fill="none" stroke={pal.accent} strokeWidth="1.6" />
            <circle cx="-13" cy="-2" r="1.8" fill="#0b2239" />
          </>
        )}
        {(tags?.bioluminescent ?? 0) > 0 && (
          <circle cx="-24" cy="-9" r="3" fill="#90e0ef" stroke="#caf0f8" strokeWidth="1.2" />
        )}
      </g>
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
