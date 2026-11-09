// Power-text coverage: every bird in the database with a printed power must
// have an implementation. Brown/white/teal/yellow powers run through
// POWER_IMPLS (runPower), pink "once between turns" powers through
// PINK_IMPLS (firePinkTriggers) — see hasPowerImpl in powers.ts.
//
// Promo sets (promoUS/promoEurope/promoAsia/promoNZ/promoCA/promoUK) are a
// documented gap: their powers warn once and no-op (see AGENTS.md). The
// second assertion locks the gap to those sets so coverage can't regress.

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
  it('implements every powerText in the playable sets', () => {
    const gaps = missing().filter((b) => !b.set.startsWith('promo'));
    expect(gaps.map((b) => `${b.id} ${b.name} [${b.set}/${b.powerColor}] :: ${b.powerText}`)).toEqual(
      [],
    );
  });

  it('confines unimplemented power texts to the promo sets', () => {
    const nonPromo = missing().filter((b) => !b.set.startsWith('promo'));
    expect(nonPromo.map((b) => `${b.id} ${b.name}`)).toEqual([]);
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
    const orphans = Object.keys(POWER_IMPLS).filter((t) => !texts.has(t));
    expect(orphans).toEqual([]);
  });
});
