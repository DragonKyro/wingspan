// Wyrmspan dragon and cave cards on the shared CreatureCard frame.

import { parseIcons } from '@/wyrmspan/cards';
import type { CaveCard, DragonCard, PlayedDragon } from '@/wyrmspan/types';
import { useFlipCard, useValuePulse } from '../fx';
import { CreatureCard, FreeCost } from '../CreatureCard';
import {
  DragonIllustration,
  WYRM_CAVE_COLOR,
  WyrmResourceIcon,
  WyrmVp,
  renderWyrmspanText,
} from '../svgArt';

export const CAVE_THEMES = [
  { id: 'crimson' as const, name: 'Crimson Cavern', color: '#9e2a2b', accent: '#f28482' },
  { id: 'golden' as const, name: 'Golden Grotto', color: '#b07d1a', accent: '#ffd166' },
  { id: 'amethyst' as const, name: 'Amethyst Abyss', color: '#5a3286', accent: '#e0aaff' },
];

const ABILITY_META: Record<string, { label: string; cls: string; icon: string }> = {
  WhenPlayed: { label: 'When played', cls: 'ab-whenplayed', icon: 'whenplayed' },
  OncePerRound: { label: 'Once per round', cls: 'ab-onceperround', icon: 'onceperround' },
  EndGame: { label: 'Game end', cls: 'ab-endgame', icon: 'endgame' },
  Adventurer: { label: 'Adventurer', cls: 'ab-adventurer', icon: 'adventurer' },
  'Adventurer, EndGame': { label: 'Adventurer · Game end', cls: 'ab-adventurer', icon: 'adventurer' },
};

const COST_ORDER = ['meat', 'gold', 'crystal', 'milk', 'egg', 'coin'] as const;

function caveStrip(caves: readonly string[]) {
  return CAVE_THEMES.map((t) => ({
    key: t.id,
    label: t.name,
    color: WYRM_CAVE_COLOR[t.id]!,
    icon: <WyrmResourceIcon kind={t.id} size={13} />,
    on: caves.some((c) => c.toLowerCase().startsWith(t.id)),
  }));
}

function tally(items: readonly string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()];
}

export function WyrmDragonCardView({
  card,
  played,
  zone = 'dragon',
  selectable,
  selected,
  onClick,
}: {
  card: DragonCard;
  played?: PlayedDragon;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  /** @deprecated cards are one fixed size everywhere; kept for call-site compatibility. */
  compact?: boolean;
  onClick?: () => void;
}) {
  const flipRef = useFlipCard(`wyrm-d:${card.id}`, zone);
  const tokenTotal =
    (played?.eggs ?? 0) + (played?.cached.length ?? 0) + (played?.tucked.length ?? 0) + (played?.training ?? 0);
  const pulseRef = useValuePulse<HTMLDivElement>(tokenTotal);
  const trackLen = card.trainingTrack ? parseIcons(card.trainingTrack).length : 0;
  const pers = card.personality ?? 'Shy';
  const meta = ABILITY_META[card.abilityType] ?? { label: card.abilityType, cls: 'ab-whenplayed', icon: 'whenplayed' };
  const costIcons = COST_ORDER.flatMap((r) =>
    Array.from({ length: card.cost[r] ?? 0 }, (_, i) => <WyrmResourceIcon key={`${r}${i}`} kind={r} size={15} />),
  );

  const overlay =
    played && tokenTotal > 0 ? (
      <div ref={pulseRef} className="cc-tokens">
        {played.eggs > 0 && (
          <span title={`${played.eggs} egg(s) — 1 VP each`}>
            <WyrmResourceIcon kind="egg" size={12} />×{played.eggs}
          </span>
        )}
        {tally(played.cached).map(([r, n]) => (
          <span key={r} title={`${n} cached ${r} — 1 VP each`}>
            <WyrmResourceIcon kind={r} size={12} />×{n}
          </span>
        ))}
        {played.tucked.length > 0 && (
          <span title={`${played.tucked.length} tucked dragon(s) — 1 VP each`}>
            <WyrmResourceIcon kind="tucked" size={12} />×{played.tucked.length}
          </span>
        )}
        {(played.training ?? 0) > 0 && (
          <span title={`Training ${played.training}/${trackLen}`}>
            <WyrmResourceIcon kind="fledglingarrow" size={12} />
            {played.training}/{trackLen}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <CreatureCard
      theme="wyrm"
      cardRef={flipRef}
      name={card.name}
      subtitle={`#${card.number} · ${card.size} · ${pers}`}
      cost={
        <>
          {costIcons.length ? costIcons : <FreeCost />}
          {card.ignoreCost && (
            <span className="cc-free" title="This dragon's cost can be ignored (see its ability)">
              *
            </span>
          )}
        </>
      }
      points={<WyrmVp n={card.vp} size={22} />}
      placements={caveStrip(card.caves)}
      art={<DragonIllustration id={card.id} name={card.name} personality={pers} size={card.size} caves={card.caves} />}
      overlay={overlay}
      traits={
        <>
          <span className="cc-trait">
            <WyrmResourceIcon kind={card.size.toLowerCase()} size={14} />
          </span>
          <span className="cc-trait">
            <WyrmResourceIcon kind={pers.toLowerCase()} size={14} />
          </span>
          <span className="cc-trait" title={card.capacity ? `Holds up to ${card.capacity} egg(s)` : 'Cannot hold eggs'}>
            <WyrmResourceIcon kind="egg" size={13} />
            {played ? `${played.eggs}/${card.capacity}` : `×${card.capacity}`}
          </span>
        </>
      }
      powerClass={card.ability ? meta.cls : 'pband-none'}
      powerIcon={card.ability ? <WyrmResourceIcon kind={meta.icon} size={11} /> : undefined}
      powerLabel={card.ability ? meta.label : undefined}
      preface={
        card.trainingTrack ? (
          <div className="cc-preface" title="Fledgling training track">
            Train {played?.training ?? 0}/{trackLen}: {renderWyrmspanText(card.trainingTrack, 12)}
          </div>
        ) : undefined
      }
      power={card.ability ? renderWyrmspanText(card.ability, 13) : <span className="muted">No ability</span>}
      tooltip={`${card.name} (#${card.number}) — ${card.size} · ${pers} · ${card.vp} VP · ${card.caves.join(' / ')}\n${
        card.ability ? `${meta.label}: ${card.ability}` : 'No ability'
      }`}
      selectable={selectable}
      selected={selected}
      onClick={onClick}
    />
  );
}

export function WyrmCaveCardView({
  card,
  zone = 'cave',
  selectable,
  selected,
  onClick,
}: {
  card: CaveCard;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const flipRef = useFlipCard(`wyrm-c:${card.id}`, zone);
  return (
    <CreatureCard
      theme="wyrm"
      cardRef={flipRef}
      name={card.name ?? `Cave card #${card.number}`}
      subtitle={`Cave #${card.number} · excavate into any cave`}
      cost={
        <span className="cc-free" title="Cave card — the excavation cost depends on the column">
          CAVE
        </span>
      }
      points={<WyrmResourceIcon kind="cavecard" size={20} />}
      placements={caveStrip(['crimson', 'golden', 'amethyst'])}
      art={<div className="cc-cave-art" />}
      traits={<span className="muted">Excavates 1 cave space</span>}
      powerClass="ab-cave"
      powerIcon={<WyrmResourceIcon kind="cavecard" size={11} />}
      powerLabel="When excavated"
      power={card.ability ? renderWyrmspanText(card.ability, 13) : <span className="muted">No effect</span>}
      tooltip={`Cave #${card.number}\nWhen excavated: ${card.ability ?? '—'}`}
      selectable={selectable}
      selected={selected}
      onClick={onClick}
    />
  );
}
