// Guardrail: every [token] used in any card, cave, bonus-card or goal text of
// the three games renders as an icon — never the labelled fallback chip
// (`inline-chip`). Players read these icons to know what they gain or pay.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BIRDS, BONUS_CARDS, GOALS } from '@/wingspan/cards';
import { CAVES, DRAGONS } from '@/wyrmspan/cards';
import { FISH } from '@/finspan/cards';
import { renderFinspanText, renderWingspanText, renderWyrmspanText } from './svgArt';

function tokens(texts: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').matchAll(/\[[^\]]+\]/g)) out.add(m[0]);
  return [...out].sort();
}

function unrendered(list: string[], render: (t: string) => unknown): string[] {
  return list.filter((tok) => {
    const html = renderToStaticMarkup(<>{render(tok) as never}</>);
    return html.includes('inline-chip') || !html.includes('<svg');
  });
}

describe('every card-text token has an icon', () => {
  it('Wingspan (birds, bonus cards, goals)', () => {
    const list = tokens([
      ...BIRDS.map((b) => b.powerText),
      ...BONUS_CARDS.flatMap((b) => [b.condition, b.vpText]),
      ...GOALS.map((g) => g.text),
    ]);
    expect(list.length).toBeGreaterThan(30);
    expect(unrendered(list, renderWingspanText)).toEqual([]);
  });

  it('Wyrmspan (dragons, training tracks, caves)', () => {
    const list = tokens([
      ...DRAGONS.flatMap((d) => [d.ability, d.trainingTrack]),
      ...CAVES.map((c) => c.ability),
    ]);
    expect(list.length).toBeGreaterThan(20);
    expect(unrendered(list, renderWyrmspanText)).toEqual([]);
  });

  it('Finspan (fish)', () => {
    const list = tokens(FISH.map((f) => f.ability));
    expect(list.length).toBeGreaterThan(30);
    expect(unrendered(list, renderFinspanText)).toEqual([]);
  });
});
