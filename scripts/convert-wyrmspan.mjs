// Converts the wyrmsearch card database (../wyrmsearch/src/assets/cards.json)
// into the normalized shape the Wyrmspan engine consumes:
//   src/wyrmspan/data/cards.json
//
// Usage: node scripts/convert-wyrmspan.mjs
// The source file lives in the sibling `wyrmsearch` checkout; the generated
// output is committed so the engine has no runtime dependency on it.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'wyrmsearch', 'src', 'assets', 'cards.json');
const OUT_DIR = join(here, '..', 'src', 'wyrmspan', 'data');
const OUT = join(OUT_DIR, 'cards.json');

const raw = JSON.parse(readFileSync(SRC, 'utf8'));

const RESOURCES = ['Meat', 'Gold', 'Crystal', 'Milk'];
const CAVES = ['Crimson Cavern', 'Golden Grotto', 'Amethyst Abyss'];

function cost(c) {
  const out = {};
  for (const r of RESOURCES) if (c[r]) out[r.toLowerCase()] = c[r];
  if (c.Coin) out.coin = c.Coin;
  if (c.Egg) out.egg = c.Egg;
  // Milk is a resource, but hatchlings list it under a dedicated column in the
  // source data; normalize it into the same resource cost bucket.
  if (c.Milk) out.milk = c.Milk;
  return out;
}

function cavePrefs(c) {
  return CAVES.filter((v) => c[v] === 'x');
}

const dragons = [];
const caves = [];

for (const c of raw) {
  if (c.type === 'Dragon') {
    // Fledgling (Dragon Academy) cards encode their training-box track before
    // a <br> in the ability text; the text after it is the (inactive until
    // fully trained) ability.
    let trainingTrack = null;
    let ability = c.ability ?? null;
    if (ability && ability.includes('<br>')) {
      const [pre, post] = ability.split('<br>');
      trainingTrack = pre;
      ability = post;
    }
    dragons.push({
      id: c.id,
      number: c.number,
      name: c.name,
      expansion: c.expansion ?? 'base',
      ability,
      abilityType: c.abilityType, // Adventurer | 'Adventurer, EndGame' | WhenPlayed | OncePerRound | EndGame
      vp: c.VP ?? 0,
      size: c.size, // Small | Medium | Large | Hatchling | Fledgling
      capacity: c.capacity ?? 0,
      personality: c.personality ?? null, // Shy | Playful | Helpful | Aggressive | null
      cost: cost(c),
      caves: cavePrefs(c),
      trainingTrack, // raw icon string, e.g. "[Milk][Meat]"
      ignoreCost: c.ignoreCost === 'x',
    });
  } else if (c.type === 'Cave') {
    caves.push({
      id: c.id,
      number: c.number,
      name: c.name ?? null,
      expansion: c.expansion ?? 'base',
      ability: c.ability ?? null,
      abilityType: c.abilityType, // WhenPlayed
    });
  }
}

// Stable sort by printed card number so ids/indexes are deterministic.
dragons.sort((a, b) => a.number - b.number);
caves.sort((a, b) => a.number - b.number);

const out = { dragons, caves };
mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');

const abil = new Set();
for (const d of dragons) if (d.ability) abil.add(d.ability);
for (const c of caves) if (c.ability) abil.add(c.ability);
console.log(
  `wrote ${OUT}: ${dragons.length} dragons, ${caves.length} caves, ${abil.size} distinct ability texts`,
);
