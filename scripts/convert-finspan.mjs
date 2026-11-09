// Converts the FinSearch master card database into the Finspan engine's
// normalized data files:
//   src/finspan/data/fish.json         — all fish cards (base + Sharks & Reefs)
//   src/finspan/data/achievements.json — achievement board side A + side B tiles
//
// Source: ../finsearch/src/assets/cards.json
// Usage:  node scripts/convert-finspan.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'finsearch', 'src', 'assets', 'cards.json');
const OUT = join(here, '..', 'src', 'finspan', 'data');
mkdirSync(OUT, { recursive: true });

const raw = JSON.parse(readFileSync(SRC, 'utf8'));

const sizeOf = (length) => (length < 50 ? 'small' : length < 150 ? 'medium' : 'large');

// coralCost field: "blue:2" | "purple:1" | "green:1" | "any:1" | null
function coralCost(c) {
  if (!c.coralCost) return null;
  const [site, n] = String(c.coralCost).split(':');
  return { site, count: Number(n) };
}

const fish = raw.map((c) => ({
  id: c.id,
  group: c.group, // 'main' | 'starter'
  set: c.expansion === 'sr' ? 'sr' : 'base',
  name: c.name,
  latin: c.latin,
  points: c.points,
  length: c.length,
  size: sizeOf(c.length),
  zones: {
    sunlight: c.sunlight === 1,
    twilight: c.twilight === 1,
    // midnight: 0 = no, 1 = any midnight slot, 2 = deepwater (bottom row) only
    midnight: c.midnight === 2 ? 'bottom' : c.midnight === 1 ? 'any' : false,
  },
  cost: {
    cards: c.cardCost || 0,
    eggs: c.eggCost || 0,
    young: c.youngCost || 0,
    schools: c.schoolFishCost || 0,
    consume: c.consuming === 1,
  },
  coralCost: coralCost(c),
  band: c.band ?? null, // 'blue' | 'purple' | 'green' | null
  abilityType: c.abilityType ?? null, // 'WhenPlayed' | 'IfActivated' | 'GameEnd' | null
  ability: c.ability ?? null,
  tags: {
    bioluminescent: c.Bioluminescent || 0,
    camouflage: c.Camouflage || 0,
    electric: c.Electric || 0, // 1 = active electrolocation, 2 = electric discharge
    predator: c.Predator || 0, // 2 = uber predator
    venomous: c.Venomous || 0,
  },
  forage: false,
}));

// The three fish printed on every ocean mat. They count as fish for zone
// bonuses and achievements, score 0 printed points, and are worth 1 point
// each if consumed.
const FORAGE = [
  { id: 900, name: 'Catalina Goby', length: 1 },
  { id: 901, name: 'Showy Bristlemouth', length: 3 },
  { id: 902, name: 'Glasshead Grenadier', length: 9 },
];
for (const f of FORAGE) {
  fish.push({
    id: f.id,
    group: 'forage',
    set: 'base',
    name: f.name,
    latin: '',
    points: 0,
    length: f.length,
    size: sizeOf(f.length),
    zones: { sunlight: false, twilight: false, midnight: false },
    cost: { cards: 0, eggs: 0, young: 0, schools: 0, consume: false },
    coralCost: null,
    band: null,
    abilityType: null,
    ability: null,
    tags: { bioluminescent: 0, camouflage: 0, electric: 0, predator: 0, venomous: 0 },
    forage: true,
  });
}

// --- Achievements -----------------------------------------------------------
// Side A (printed on the board): week 1 = 1 pt per egg or young;
// week 2 = 2 pts per row of 3 fish; week 3 = 2 pts per school.
// Side B tiles: one tile is drawn per week. The tile unit counts below come
// from the rulebook components page (base tiles) and the S&R rulebook
// "achievement tile details" page. `per` = points scored per unit.
const achievements = {
  sideA: [
    { week: 1, name: 'Eggs and/or Young', kind: 'eggsAndYoung', per: 1 },
    { week: 2, name: 'Rows of Fish', kind: 'fullRows', per: 2 },
    { week: 3, name: 'Schools', kind: 'schools', per: 2 },
  ],
  sideBTiles: [
    // --- base game tiles (week-number slots are fixed on the board) ---
    { id: 'b1', week: 1, name: 'Eggs', kind: 'eggs', per: 1 },
    { id: 'b2', week: 1, name: 'Young', kind: 'young', per: 1 },
    { id: 'b3', week: 1, name: 'Eggs and/or Young', kind: 'eggsAndYoung', per: 1 },
    { id: 'b4', week: 2, name: 'Rows of Fish', kind: 'fullRows', per: 2 },
    { id: 'b5', week: 2, name: 'Fish', kind: 'fish', per: 1 },
    { id: 'b6', week: 2, name: 'Predator Tag', kind: 'tagPredator', per: 2 },
    { id: 'b7', week: 3, name: 'Schools', kind: 'schools', per: 2 },
    { id: 'b8', week: 3, name: 'Fish with Tokens', kind: 'fishWithTokens', per: 1 },
    { id: 'b9', week: 3, name: 'Consumed Fish', kind: 'consumedFish', per: 1 },
    // --- Sharks & Reefs tiles ---
    { id: 's1', week: 1, name: 'Fish Between 1-3 Points', kind: 'fishPoints1to3', per: 1, set: 'sr' },
    { id: 's2', week: 2, name: 'Unique Tags Among Fish', kind: 'uniqueTags', per: 1, set: 'sr' },
    { id: 's3', week: 2, name: 'Fish in the Sunlight Zone', kind: 'fishSunlight', per: 1, set: 'sr' },
    { id: 's4', week: 3, name: 'Coral', kind: 'coral', per: 1, set: 'sr' },
  ],
  /** Side-B bonus: player(s) with the most points from the tile that week. */
  sideBLeaderBonus: 3,
};

writeFileSync(join(OUT, 'fish.json'), JSON.stringify(fish, null, 2));
writeFileSync(join(OUT, 'achievements.json'), JSON.stringify(achievements, null, 2));

const counts = {};
for (const c of fish) counts[`${c.set}/${c.group}`] = (counts[`${c.set}/${c.group}`] || 0) + 1;
console.log(`wrote ${fish.length} fish ->`, join(OUT, 'fish.json'));
console.log('breakdown:', counts);
console.log(`wrote achievements ->`, join(OUT, 'achievements.json'));
