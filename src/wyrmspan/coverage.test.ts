import { describe, expect, it } from 'vitest';
import { abilityCoverage } from './abilities';
import { CAVES, DRAGONS } from './cards';

/**
 * Texts that PARSE to supported steps but whose runtime behavior is a
 * documented approximation. Keep this list honest: each entry must match at
 * least one printed ability text (the test below fails on stale entries) and
 * every approximation should eventually be replaced by a real implementation.
 */
const KNOWN_PARTIAL: { pattern: RegExp; note: string }[] = [
  {
    pattern: /of the cost printed on the tucked dragon/i,
    note: "matchTuckGainCost grants a generic 'any resource' instead of a choice among the resource types printed in the tucked dragon's cost",
  },
];

describe('ability coverage', () => {
  it('parses every distinct ability text into fully-supported steps', () => {
    const r = abilityCoverage(DRAGONS, CAVES);
    expect(r.supported).toBe(r.total);
    expect(r.missing).toEqual([]);
  });

  it('keeps the known-partial allowlist honest', () => {
    const texts = [...DRAGONS, ...CAVES].map((c) => c.ability).filter((t): t is string => !!t);
    for (const kp of KNOWN_PARTIAL) {
      expect(
        texts.some((t) => kp.pattern.test(t)),
        `allowlist entry matches no card text — remove it or fix the impl: ${kp.note}`,
      ).toBe(true);
    }
  });
});
