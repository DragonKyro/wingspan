// Shared plumbing for the procedural SVG art: a seeded RNG over the shared
// mulberry32, colour helpers, and ONE global <defs> block (<ArtDefs/>, mounted
// once in App) that every illustration references by `url(#ws-…)`. Defining
// gradients once keeps each card's SVG small — no per-card <defs>, no ID clashes.

import { nextRng } from '@/shared/rng';

/** FNV-1a string hash → uint32 seed. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic [0,1) stream seeded per card, so art never changes between renders. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    const [v, n] = nextRng(s);
    s = n;
    return v;
  };
}

/** Lighten (amt > 0) or darken (amt < 0) a #rrggbb colour. */
export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) =>
    Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))
      .toString(16)
      .padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Round to 1 decimal so generated path strings stay short. */
export const r1 = (v: number) => Math.round(v * 10) / 10;

type Stop = [offset: number, color: string, opacity?: number];
const lin = (id: string, stops: Stop[], vertical = true) => (
  <linearGradient key={id} id={id} x1="0" y1="0" x2={vertical ? 0 : 1} y2={vertical ? 1 : 0}>
    {stops.map(([o, c, op], i) => (
      <stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />
    ))}
  </linearGradient>
);
const rad = (id: string, stops: Stop[], cx = 0.5, cy = 0.5, r = 0.5) => (
  <radialGradient key={id} id={id} cx={cx} cy={cy} r={r}>
    {stops.map(([o, c, op], i) => (
      <stop key={i} offset={o} stopColor={c} stopOpacity={op ?? 1} />
    ))}
  </radialGradient>
);

/** Habitat skies: 3 times of day each (index chosen per card from its seed). */
const SKIES: Record<string, [string, string][]> = {
  forest: [['#cfe6c8', '#f3f0d8'], ['#f2d3a8', '#e8eccf'], ['#b9d4cf', '#e6efe4']],
  grassland: [['#bfdcef', '#fbefcf'], ['#f6c99a', '#fdf0d2'], ['#d4e3ea', '#f6ead0']],
  wetland: [['#b8d8ec', '#eaf4f4'], ['#f1c6a6', '#e3eef0'], ['#a9c8dc', '#e0ecee']],
};

export function ArtDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute', width: 0, height: 0 }} aria-hidden="true" focusable="false">
      <defs>
        {Object.entries(SKIES).flatMap(([h, vs]) =>
          vs.map(([a, b], i) => lin(`ws-sky-${h}-${i}`, [[0, a], [1, b]])),
        )}
        {lin('ws-sky-night', [[0, '#1b2440'], [1, '#4b4f73']])}
        {lin('ws-water', [[0, '#7fb5cf'], [1, '#3f7f9f']])}
        {lin('ws-water-night', [[0, '#3a4d6e'], [1, '#1f2c45']])}
        {/* Volume overlay: lit top, shaded belly. Works on any shape via bbox units. */}
        {lin('ws-vol', [[0, '#fff', 0.3], [0.45, '#fff', 0], [1, '#000', 0.32]])}
        {rad('ws-sheen', [[0, '#fff', 0.7], [0.55, '#fff', 0]], 0.32, 0.28, 0.65)}
        {rad('ws-vignette', [[0.55, '#000', 0], [1, '#000', 0.28]], 0.5, 0.45, 0.75)}
        {rad('ws-glow', [[0, '#e8fbff', 0.95], [0.35, '#90e0ef', 0.55], [1, '#90e0ef', 0]])}
        {rad('ws-fire', [[0, '#fff3b0', 0.95], [0.4, '#ffb703', 0.6], [1, '#e85d04', 0]])}
        {rad('ws-sun', [[0, '#fff8de', 1], [0.5, '#ffe7a3', 0.85], [1, '#ffd166', 0]])}
        {/* Finspan ocean depth zones. */}
        {lin('ws-sea-sunlight', [[0, '#7fd3f2'], [1, '#2a86b8']])}
        {lin('ws-sea-twilight', [[0, '#2a6f9e'], [1, '#123a5e']])}
        {lin('ws-sea-midnight', [[0, '#0f2440'], [1, '#040b18']])}
        {lin('ws-ray', [[0, '#e8fbff', 0.5], [1, '#e8fbff', 0]])}
        {/* Wyrmspan caverns. */}
        {rad('ws-cave-crimson', [[0, '#a8434f'], [1, '#2b0f17']], 0.5, 0.35, 0.8)}
        {rad('ws-cave-golden', [[0, '#c9963a'], [1, '#30200a']], 0.5, 0.35, 0.8)}
        {rad('ws-cave-amethyst', [[0, '#8a63c4'], [1, '#1f1233']], 0.5, 0.35, 0.8)}
        {rad('ws-cave-any', [[0, '#5d6f7a'], [1, '#141a20']], 0.5, 0.35, 0.8)}
        {lin('ws-gold', [[0, '#ffe08a'], [0.5, '#e0a526'], [1, '#9c6b12']])}
      </defs>
    </svg>
  );
}
