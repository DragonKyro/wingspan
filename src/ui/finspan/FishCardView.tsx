// Finspan fish cards on the shared CreatureCard frame.

import type { FishCard, SlotState } from '@/finspan/types';
import { useFlipCard, useValuePulse } from '../fx';
import { CreatureCard, FreeCost } from '../CreatureCard';
import { FinIcon, FishIllustration, renderFinspanText } from '../svgArt';

const FIN_ABILITY: Record<string, { label: string; cls: string }> = {
  WhenPlayed: { label: 'When played', cls: 'fab-whenplayed' },
  IfActivated: { label: 'If activated', cls: 'fab-ifactivated' },
  GameEnd: { label: 'Game end', cls: 'fab-gameend' },
};

const ZONE_STRIP = [
  { key: 'sunlight', label: 'Sunlight zone', color: '#2a9fd6' },
  { key: 'twilight', label: 'Twilight zone', color: '#1f5f8f' },
  { key: 'midnight', label: 'Midnight zone', color: '#16264a' },
] as const;

const TAG_ORDER = ['predator', 'venomous', 'electric', 'bioluminescent', 'camouflage'] as const;

export function FishCardView({
  card,
  slotState,
  consumedCount = 0,
  zone = 'fish',
  selectable,
  selected,
  onClick,
}: {
  card: FishCard;
  slotState?: SlotState;
  consumedCount?: number;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  /** @deprecated cards are one fixed size everywhere; kept for call-site compatibility. */
  compact?: boolean;
  onClick?: () => void;
}) {
  const flipRef = useFlipCard(`fish:${card.id}`, zone);
  const tokenTotal = slotState ? slotState.eggs + slotState.young + (slotState.school ? 3 : 0) + consumedCount : 0;
  const pulseRef = useValuePulse<HTMLDivElement>(tokenTotal);
  const c = card.cost;
  const rep = (n: number, kind: string) =>
    Array.from({ length: n }, (_, i) => <FinIcon key={`${kind}${i}`} kind={kind} size={15} />);
  const costIcons = [
    ...rep(c.cards, 'discard'),
    ...rep(c.eggs, 'egg'),
    ...rep(c.young, 'young'),
    ...rep(c.schools, 'school'),
    ...(c.consume ? rep(1, 'consume') : []),
  ];
  const coral = card.coralCost;
  const meta = card.abilityType ? FIN_ABILITY[card.abilityType] : undefined;
  const deep = card.zones.midnight === 'bottom';

  const overlay =
    slotState && tokenTotal > 0 ? (
      <div ref={pulseRef} className="cc-tokens">
        {slotState.eggs > 0 && (
          <span title={`${slotState.eggs} fish egg(s) — 1 VP each`}>
            <FinIcon kind="egg" size={12} />×{slotState.eggs}
          </span>
        )}
        {slotState.young > 0 && (
          <span title={`${slotState.young} young fish — 1 VP each; 3 merge into a 6-VP school`}>
            <FinIcon kind="young" size={12} />×{slotState.young}
          </span>
        )}
        {slotState.school && (
          <span title="School — 6 VP">
            <FinIcon kind="school" size={12} />6
          </span>
        )}
        {consumedCount > 0 && (
          <span title={`${consumedCount} consumed fish underneath — 1 VP each`}>
            <FinIcon kind="consume" size={12} />×{consumedCount}
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <CreatureCard
      theme="fin"
      cardRef={flipRef}
      name={card.name}
      subtitle={card.latin}
      cost={
        <>
          {costIcons.length || coral ? costIcons : <FreeCost />}
          {coral &&
            Array.from({ length: coral.count }, (_, i) => (
              <FinIcon key={`cor${i}`} kind={coral.site === 'any' ? 'anycoral' : `${coral.site}coral`} size={15} />
            ))}
        </>
      }
      points={
        card.forage ? (
          <FinIcon kind="forage" size={20} />
        ) : (
          <>
            {card.points}
            <FinIcon kind="wave" size={16} />
          </>
        )
      }
      placements={ZONE_STRIP.map((z) => ({
        key: z.key,
        label: z.key === 'midnight' && deep ? 'Midnight zone — deepwater (bottom row) only' : z.label,
        color: z.color,
        icon: <FinIcon kind={z.key === 'midnight' && deep ? 'deepwater' : z.key} size={13} />,
        on: !!card.zones[z.key],
      }))}
      art={
        <FishIllustration
          id={card.id}
          name={card.name}
          size={card.size}
          tags={card.tags}
          forage={card.forage}
          zones={card.zones}
          coral={coral && coral.site !== 'any' ? coral.site : null}
        />
      }
      overlay={overlay}
      traits={
        <>
          <span className="cc-trait" title={`${card.size} fish · ${card.length} cm (can consume shorter fish)`}>
            <FinIcon kind={card.size} size={14} />
            {card.length}cm
          </span>
          {card.band && (
            <span className="cc-trait" title={`Only playable in the ${card.band} dive site`}>
              <FinIcon kind={`flipper${card.band}`} size={13} />
            </span>
          )}
          <span className="spacer" />
          {TAG_ORDER.filter((t) => (card.tags[t] ?? 0) > 0).map((t) => (
            <span key={t} className="cc-trait">
              <FinIcon kind={t} size={13} />
              {(card.tags[t] ?? 0) > 1 ? `×${card.tags[t]}` : ''}
            </span>
          ))}
        </>
      }
      powerClass={meta ? meta.cls : 'pband-none'}
      powerLabel={meta?.label}
      power={card.ability ? renderFinspanText(card.ability, 13) : <span className="muted">No ability</span>}
      tooltip={`${card.name} (${card.latin}) — ${card.forage ? 'forage fish' : `${card.points} VP`} · ${card.length} cm ${
        card.size
      }\n${card.ability ? `${meta?.label ?? 'Ability'}: ${card.ability}` : 'No ability'}`}
      selectable={selectable}
      selected={selected}
      onClick={onClick}
    />
  );
}
