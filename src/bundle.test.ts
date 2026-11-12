// Guardrails for the per-game code split (see src/games/engines.ts):
//  - code that ships in the first page load must not import a game's engine,
//    AI, data or screens except through dynamic import() — otherwise that game
//    (Wingspan alone is ~800 kB) silently lands back in the main bundle;
//  - the light Wingspan set list used by the menu matches the card data.
// scripts/check-bundle.mjs checks the same boundary on the real build output.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINGSPAN_SETS } from '@/games/catalog';
import { SETS } from '@/wingspan/cards';

const SRC = join(__dirname);
const GAME_DIRS = /^(wingspan|wyrmspan|finspan|ui\/(wingspan|wyrmspan|finspan))\//;
/** Lazy entry points — only ever reached through dynamic import(). */
const LAZY_ENTRIES = new Set(['games/wingspanEngine.ts', 'games/wyrmspanEngine.ts', 'games/finspanEngine.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('code split boundary', () => {
  it('main-bundle modules only reach game code via dynamic import()', () => {
    const violations: string[] = [];
    for (const abs of files(SRC)) {
      const rel = relative(SRC, abs).replace(/\\/g, '/');
      if (GAME_DIRS.test(rel) || LAZY_ENTRIES.has(rel) || /\.test\.tsx?$/.test(rel)) continue;
      const src = readFileSync(abs, 'utf8');
      for (const m of src.matchAll(/^import\s+(type\s+)?([\s\S]*?)\s+from\s+'([^']+)';/gm)) {
        const [, typeOnly, spec, from] = m;
        if (typeOnly || !/(^@\/|\/)(wingspan|wyrmspan|finspan)\//.test(from!)) continue;
        if (/(wingspan|wyrmspan|finspan)Engine$/.test(from!)) continue;
        // `import { type A, type B }` is type-only too.
        const named = /\{([\s\S]*)\}/.exec(spec!)?.[1] ?? '';
        const allTypes = !/^[A-Za-z_$]/.test(spec!.trim()) && named.split(',').every((x) => !x.trim() || x.trim().startsWith('type '));
        if (!allTypes) violations.push(`${rel} → ${from}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('WINGSPAN_SETS matches the card data', () => {
    expect([...WINGSPAN_SETS].sort()).toEqual([...SETS].sort());
  });
});
