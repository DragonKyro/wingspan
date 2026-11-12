// Build-output guard for the per-game code split (run by `npm run build`).
// Fails if the first page load (entry chunk + its static imports) contains a
// game chunk or card data, if one game's chunks statically pull in another
// game's, or if the first load outgrows its budget.
//   node scripts/check-bundle.mjs [distDir]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const assets = join(dist, 'assets');
const GAMES = ['wingspan', 'wyrmspan', 'finspan'];
/** One bird, one dragon, one fish: if any shows up in the first load, card data leaked. */
const DATA_MARKERS = ['Cardinalis cardinalis', 'White-Bellied Grazer', 'Squatina squatina'];
const BUDGET_KB = 450;

const entry = /<script[^>]+src="[^"]*\/assets\/([^"]+\.js)"/.exec(readFileSync(join(dist, 'index.html'), 'utf8'))?.[1];
if (!entry) {
  console.error('check-bundle: no entry <script> found in index.html');
  process.exit(1);
}

const cache = new Map();
const code = (f) => cache.get(f) ?? cache.set(f, readFileSync(join(assets, f), 'utf8')).get(f);
/** Static imports only — `import("./x.js")` (lazy) is deliberately not matched. */
const staticDeps = (f) => [...code(f).matchAll(/(?:from|import)\s*"\.\/([^"]+\.js)"/g)].map((m) => m[1]);
function closure(f, seen = new Set()) {
  if (!seen.has(f)) {
    seen.add(f);
    for (const d of staticDeps(f)) closure(d, seen);
  }
  return seen;
}
const gameOf = (f) => GAMES.find((g) => f.startsWith(`${g}-`));

const errors = [];
const first = closure(entry);
for (const f of first) {
  if (gameOf(f)) errors.push(`first load includes game chunk ${f}`);
  for (const m of DATA_MARKERS) if (code(f).includes(m)) errors.push(`first-load chunk ${f} contains card data ("${m}")`);
}
const kb = [...first].reduce((n, f) => n + Buffer.byteLength(code(f)), 0) / 1024;
if (kb > BUDGET_KB) errors.push(`first load is ${kb.toFixed(0)} kB, over the ${BUDGET_KB} kB budget`);
for (const f of readdirSync(assets).filter((x) => x.endsWith('.js'))) {
  const g = gameOf(f);
  if (!g) continue;
  for (const d of closure(f)) {
    const other = gameOf(d);
    if (other && other !== g) errors.push(`${f} statically loads ${other} chunk ${d}`);
  }
}

if (errors.length) {
  console.error(`check-bundle failed:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`check-bundle ok: first load ${kb.toFixed(0)} kB in ${first.size} chunk(s); each game loads on demand.`);
