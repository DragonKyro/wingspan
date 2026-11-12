// Power-text coverage: every bird in the database with a printed power must
// have an implementation (all 707 birds across core, european, oceania, asia,
// americas, and all promo sets). Brown/white/teal/yellow powers run through
// POWER_IMPLS (runPower), pink "once between turns" powers through
// PINK_IMPLS (firePinkTriggers) — see hasPowerImpl in powers.ts.

import { describe, expect, it } from 'vitest';
import { BIRDS } from './cards';
import { hasPowerImpl, PINK_IMPLS, POWER_IMPLS } from './powers';

const missing = () =>
  BIRDS.filter((b) => {
    if (!b.powerText) return false;
    return b.powerColor === 'pink'
      ? PINK_IMPLS[b.powerText] == null
      : POWER_IMPLS[b.powerText] == null;
  });

describe('power coverage', () => {
  it('implements every powerText across all 707 birds (including promo sets)', () => {
    expect(BIRDS.length).toBe(707);
    const gaps = missing();
    expect(gaps.map((b) => `${b.id} ${b.name} [${b.set}/${b.powerColor}] :: ${b.powerText}`)).toEqual(
      [],
    );
  });

  it('hasPowerImpl is true for every bird with a printed power', () => {
    const unimplemented = BIRDS.filter((b) => b.powerText && !hasPowerImpl(b.id));
    expect(unimplemented.map((b) => `${b.id} ${b.name}`)).toEqual([]);
  });

  it('hasPowerImpl agrees with the impl maps', () => {
    const mismatched = BIRDS.filter((b) => {
      if (!b.powerText) return false;
      const expected =
        b.powerColor === 'pink'
          ? PINK_IMPLS[b.powerText] != null
          : POWER_IMPLS[b.powerText] != null;
      return hasPowerImpl(b.id) !== expected;
    });
    expect(mismatched.map((b) => `${b.id} ${b.name}`)).toEqual([]);
  });

  it('assigns every implemented powerText to at least one bird', () => {
    const texts = new Set(BIRDS.map((b) => b.powerText).filter(Boolean));
    const orphans = [
      ...Object.keys(POWER_IMPLS).filter((t) => !texts.has(t)),
      ...Object.keys(PINK_IMPLS).filter((t) => !texts.has(t)),
    ];
    expect(orphans).toEqual([]);
  });
});
