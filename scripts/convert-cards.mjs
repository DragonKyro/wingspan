// Convert wingsearch's card data (src/assets/data/*.json) into this app's
// typed card database under src/game/data/. Run: npm run cards.
//
// Source schemas (wingsearch master.json / bonus.json / goals.json) use the
// printed column names ("Common name", "Victory points", ...); the output is
// compact camelCase JSON imported by src/game/cards.ts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = process.env.WINGSEARCH_DIR ?? resolve(root, '..', 'wingsearch');
const OUT = join(root, 'src', 'game', 'data');

const FOODS = ['Invertebrate', 'Seed', 'Fish', 'Fruit', 'Rodent', 'Nectar'];
const foodId = (name) => name.toLowerCase();

const master = Object.values(
  JSON.parse(readFileSync(join(SRC, 'src/assets/data/master.json'), 'utf8')),
);
const bonusRaw = Object.values(
  JSON.parse(readFileSync(join(SRC, 'src/assets/data/bonus.json'), 'utf8')),
);
const goalsRaw = JSON.parse(readFileSync(join(SRC, 'src/assets/data/goals.json'), 'utf8'));

// Bonus-card names as they appear as flags on birds (same spelling).
const BONUS_NAMES = new Set(bonusRaw.map((b) => b['Bonus card']));

function foodCost(c) {
  const total = c['Total food cost'] ?? 0;
  if (total === 0) return { kind: 'none' };
  if (c['* (food cost)']) return { kind: 'any', count: total };
  const listed = FOODS.flatMap((f) => Array(c[f] ?? 0).fill(foodId(f)));
  if (c['/ (food cost)']) return { kind: 'or', foods: listed };
  const items = FOODS.filter((f) => c[f]).map((f) => ({ food: foodId(f), count: c[f] }));
  const wild = c['Wild (food)'] ?? 0;
  if (wild) items.push({ food: 'any', count: wild });
  return items.length ? { kind: 'and', items } : { kind: 'any', count: total };
}

const birds = master.map((c) => {
  const habitats = [];
  if (c['Forest']) habitats.push('forest');
  if (c['Grassland']) habitats.push('grassland');
  if (c['Wetland']) habitats.push('wetland');
  return {
    id: c['id'],
    name: c['Common name'],
    sciName: c['Scientific name'],
    set: c['Set'],
    powerColor: c['Color'] ?? null,
    powerText: c['Power text'] ?? null,
    points: c['Victory points'],
    nest: c['Nest type'],
    eggLimit: c['Egg limit'],
    wingspan: c['Wingspan'],
    habitats,
    cost: foodCost(c),
    predator: !!c['Predator'],
    flocking: !!c['Flocking'],
    bonusPower: !!c['Bonus card'],
    bonusFlags: [...BONUS_NAMES].filter((n) => c[n] === 'X'),
    beakLeft: c['Beak direction'] === 'L' ? true : c['Beak direction'] === 'R' ? false : null,
  };
});

// "2 to 3 birds: 3[point]; 4+ birds: 7[point]" → tiers [[2,3,3],[4,null,7]]
// "1[point] each" / "3[point] per column" → linear {per: n}
// "1 set = X; one set: 3[point]; two sets: 8[point]" → sets [null,3,8]
function parseVp(text) {
  if (!text || /automa/i.test(text)) return { kind: 'raw', text: text ?? '' };
  const tierRe = /(\d+)\s*(?:to\s*(\d+)|\+)?\s*[^:;]*?:\s*(\d+)\[point\]/g;
  const tiers = [];
  let m;
  let consumed = '';
  while ((m = tierRe.exec(text))) {
    consumed += m[0];
    tiers.push({ min: Number(m[1]), max: m[2] ? Number(m[2]) : null, vp: Number(m[3]) });
  }
  if (tiers.length && consumed.replace(/[\s;]/g, '') === text.replace(/[\s;]/g, '')) {
    return { kind: 'tiers', tiers };
  }
  const lin = /^(\d+)\[point\]\s*(?:each|per.*)$/.exec(text.trim());
  if (lin) return { kind: 'linear', per: Number(lin[1]) };
  const sets = /one set:\s*(\d+)\[point\];\s*two sets?:\s*(\d+)\[point\]/i.exec(text);
  if (sets) return { kind: 'sets', one: Number(sets[1]), two: Number(sets[2]) };
  return { kind: 'raw', text };
}

const bonusCards = bonusRaw.map((b) => ({
  id: b['id'],
  name: b['Bonus card'],
  set: b['Set'],
  condition: b['Condition'],
  vpText: b['VP'],
  vp: parseVp(b['VP']),
  automa: !!b['Automa'],
}));

// Goal text → structured scorer kind. Texts not on this map are kept as
// 'unsupported' (duet / hummingbird goals need pieces the engine lacks).
const GOAL_MAP = {
  '[bird] in [forest]': { kind: 'birdsInHabitat', habitat: 'forest' },
  '[bird] in [grassland]': { kind: 'birdsInHabitat', habitat: 'grassland' },
  '[bird] in [wetland]': { kind: 'birdsInHabitat', habitat: 'wetland' },
  '[egg] in [forest]': { kind: 'eggsInHabitat', habitat: 'forest' },
  '[egg] in [grassland]': { kind: 'eggsInHabitat', habitat: 'grassland' },
  '[egg] in [wetland]': { kind: 'eggsInHabitat', habitat: 'wetland' },
  '[bird] in one row': { kind: 'birdsInOneRow' },
  '[bird] with no [egg]': { kind: 'birdsNoEggs' },
  '[bird] worth >4 [feather]': { kind: 'birdsPoints', op: 'gt', value: 4 },
  '[bird] worth ≤3 [feather]': { kind: 'birdsPoints', op: 'lte', value: 3 },
  '[bowl] [bird] with [egg]': { kind: 'nestBirdsWithEggs', nest: 'bowl' },
  '[cavity] [bird] with [egg]': { kind: 'nestBirdsWithEggs', nest: 'cavity' },
  '[ground] [bird] with [egg]': { kind: 'nestBirdsWithEggs', nest: 'ground' },
  '[platform] [bird] with [egg]': { kind: 'nestBirdsWithEggs', nest: 'platform' },
  '[egg] in [bowl]': { kind: 'eggsInNest', nest: 'bowl' },
  '[egg] in [cavity]': { kind: 'eggsInNest', nest: 'cavity' },
  '[egg] in [ground]': { kind: 'eggsInNest', nest: 'ground' },
  '[egg] in [platform]': { kind: 'eggsInNest', nest: 'platform' },
  '[card] in hand': { kind: 'cardsInHand' },
  '[wild] in personal supply': { kind: 'foodInSupply' },
  'brown powers': { kind: 'birdsPowerColor', color: 'brown' },
  'white & no powers': { kind: 'birdsPowerColor', color: 'white' },
  'filled columns': { kind: 'filledColumns' },
  'food cost of played [bird]': { kind: 'foodCostTotal' },
  'sets of [egg][egg][egg] in [wetland][grassland][forest]': { kind: 'setsOfThreeEggs' },
  'total [bird]': { kind: 'totalBirds' },
  '[bird_with_tucked_card] birds with tucked cards': { kind: 'birdsWithTucked' },
  '[beak_pointing_left] beak pointing left': { kind: 'beakDirection', dir: 'L' },
  '[beak_pointing_right] beak pointing right': { kind: 'beakDirection', dir: 'R' },
  '[action_cube_gray] cubes on "play a bird"': { kind: 'cubesOnPlayBird' },
  '[invertebrate] in food cost of your birds': { kind: 'costIncludes', foods: ['invertebrate'], all: false },
  '[fruit] + [seed] in food cost of your birds': { kind: 'costIncludes', foods: ['fruit', 'seed'], all: true },
  '[rodent] + [fish] in food cost of your birds': { kind: 'costIncludes', foods: ['rodent', 'fish'], all: true },
  'no goal': { kind: 'noGoal' },
};

const goals = goalsRaw.map((g) => ({
  id: g['id'],
  set: g['Set'],
  text: g['Goal'],
  goal: GOAL_MAP[g['Goal']] ?? { kind: 'unsupported', text: g['Goal'] },
}));

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'birds.json'), JSON.stringify(birds));
writeFileSync(join(OUT, 'bonusCards.json'), JSON.stringify(bonusCards));
writeFileSync(join(OUT, 'goals.json'), JSON.stringify(goals));

const sets = {};
for (const b of birds) sets[b.set] = (sets[b.set] ?? 0) + 1;
const unsupported = goals.filter((g) => g.goal.kind === 'unsupported').length;
console.log(`converted ${birds.length} birds (${JSON.stringify(sets)}), ${bonusCards.length} bonus cards, ${goals.length} goals (${unsupported} unsupported)`);
