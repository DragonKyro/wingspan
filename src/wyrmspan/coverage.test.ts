import { describe, it } from 'vitest';
import { abilityCoverage } from './abilities';
import { CAVES, DRAGONS } from './cards';

describe('ability coverage', () => {
  it('reports parse coverage', () => {
    const r = abilityCoverage(DRAGONS, CAVES);
    console.log(`supported ${r.supported}/${r.total}`);
    for (const m of r.missing) console.log('MISS: ' + m);
  });
});
