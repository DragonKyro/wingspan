// Bird cards (on the shared CreatureCard frame), Bonus Card and Hummingbird Card views
// with FLIP card-flight registration and token-pulse animations.

import { bird, bonusCard, hummingbird } from '@/wingspan/cards';
import type { BirdCard, PlayedBird } from '@/wingspan/types';
import { useFlipCard, useValuePulse } from './fx';
import {
  BirdIllustration,
  EggTokenSvg,
  FoodIcon,
  HabitatIcon,
  NestIcon,
  renderWingspanText,
  TokenIcon,
} from './svgArt';
import { shade } from './art/core';
import { CreatureCard, FreeCost } from './CreatureCard';

function CostIcons({ card }: { card: BirdCard }) {
  const cost = card.cost;
  if (cost.kind === 'none') return <FreeCost />;
  if (cost.kind === 'any') {
    return (
      <>
        {Array.from({ length: cost.count }, (_, i) => (
          <FoodIcon key={i} food="any" size={15} />
        ))}
      </>
    );
  }
  if (cost.kind === 'or') {
    return (
      <>
        {cost.foods.map((f, i) => (
          <span key={i} className="bcard-cost-or">
            {i > 0 && <span className="bcard-slash">/</span>}
            <FoodIcon food={f} size={15} />
          </span>
        ))}
      </>
    );
  }
  return (
    <>
      {cost.items.flatMap((item, idx) =>
        Array.from({ length: item.count }, (_, k) => <FoodIcon key={`${idx}-${k}`} food={item.food} size={15} />),
      )}
    </>
  );
}

const POWER_LABEL: Record<string, string> = {
  brown: 'When activated',
  white: 'When played',
  pink: 'Once between turns',
  teal: 'Round end',
  yellow: 'Game end',
};

export const HAB_COLOR: Record<string, string> = {
  forest: '#3d7352',
  grassland: '#b59a32',
  wetland: '#3f84a6',
};
const HAB_ORDER = ['forest', 'grassland', 'wetland'] as const;

function countBy<T extends string>(items: readonly T[]): [T, number][] {
  const m = new Map<T, number>();
  for (const x of items) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()];
}

export function BirdCardView({
  cardId,
  played,
  zone = 'card',
  selectable,
  selected,
  activating,
  onClick,
}: {
  cardId: number;
  played?: PlayedBird;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  activating?: boolean;
  onClick?: () => void;
  /** @deprecated cards are one fixed size everywhere; kept for call-site compatibility. */
  compact?: boolean;
}) {
  const c = bird(cardId);
  const flipRef = useFlipCard(`bird:${cardId}`, zone);
  const tokenTotal = (played?.eggs ?? 0) + (played?.cached.length ?? 0) + (played?.tucked.length ?? 0);
  const pulseRef = useValuePulse<HTMLDivElement>(tokenTotal);
  const color = c.powerColor ?? 'white';
  const ws = c.wingspan === '*' ? 'flightless' : `${c.wingspan}cm`;

  const overlay =
    played && (tokenTotal > 0 || played.pinkUsed) ? (
      <div ref={pulseRef} className="cc-tokens">
        {played.eggs > 0 && (
          <span title={`${played.eggs} egg(s) — 1 VP each`}>
            <EggTokenSvg index={0} size={12} />×{played.eggs}
          </span>
        )}
        {countBy(played.cached).map(([f, n]) => (
          <span key={f} title={`${n} cached ${f} — 1 VP each`}>
            <FoodIcon food={f} size={12} />×{n}
          </span>
        ))}
        {played.tucked.length > 0 && (
          <span title={`${played.tucked.length} tucked card(s) — 1 VP each`}>
            <TokenIcon kind="tuck" size={12} />×{played.tucked.length}
          </span>
        )}
        {played.pinkUsed && (
          <span className="cc-tok-pink" title="Pink power already used this round of turns">
            ✓ used
          </span>
        )}
      </div>
    ) : undefined;

  return (
    <CreatureCard
      theme="wing"
      cardRef={flipRef}
      name={c.name}
      subtitle={c.sciName}
      cost={<CostIcons card={c} />}
      points={
        <>
          {c.points}
          <TokenIcon kind="feather" size={15} />
        </>
      }
      placements={HAB_ORDER.map((h) => ({
        key: h,
        label: h,
        color: HAB_COLOR[h]!,
        icon: <HabitatIcon habitat={h} size={13} />,
        on: c.habitats.includes(h),
      }))}
      art={
        <BirdIllustration
          cardId={c.id}
          name={c.name}
          habitats={c.habitats}
          wingspan={c.wingspan}
          predator={c.predator}
          beakLeft={c.beakLeft}
          nest={c.nest}
          flocking={c.flocking}
        />
      }
      overlay={overlay}
      traits={
        <>
          <span className="cc-trait" title={`${c.nest} nest · holds up to ${c.eggLimit} egg(s)`}>
            <NestIcon nest={c.nest} size={14} />
            <EggTokenSvg index={0} size={11} />
            {played ? `${played.eggs}/${c.eggLimit}` : `×${c.eggLimit}`}
          </span>
          <span className="cc-trait" title={`Wingspan: ${ws}`}>
            ↔{ws}
          </span>
          <span className="spacer" />
          {c.predator && <TokenIcon kind="predator" size={13} />}
          {c.flocking && <TokenIcon kind="flock" size={13} />}
          {c.bonusPower && <TokenIcon kind="bonus" size={13} title="Bonus-card power" />}
        </>
      }
      powerClass={c.powerText ? `pband-${color}` : 'pband-none'}
      powerLabel={c.powerText ? POWER_LABEL[color] : undefined}
      power={c.powerText ? renderWingspanText(c.powerText, 13) : <span className="muted">No power</span>}
      tooltip={`${c.name} (${c.sciName}) — ${c.points} VP · ${c.habitats.join('/')} · wingspan ${ws}\n${
        c.powerText ? `${POWER_LABEL[color]}: ${c.powerText}` : 'No power'
      }`}
      selectable={selectable}
      selected={selected}
      activating={activating}
      onClick={onClick}
    />
  );
}

export function BonusCardView({
  cardId,
  selectable,
  selected,
  onClick,
  scorePreview,
}: {
  cardId: number;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
  scorePreview?: number;
}) {
  const c = bonusCard(cardId);
  return (
    <div
      className={`bonus-mini${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={`${c.name}\n${c.condition}\n${c.vpText}`}
    >
      <div className="bonus-head">
        <b><TokenIcon kind="bonus" size={13} /> {c.name}</b>
        {scorePreview !== undefined && <span className="badge">{scorePreview} VP</span>}
      </div>
      <div className="bonus-cond">{renderWingspanText(c.condition)}</div>
      <div className="bonus-vp">{renderWingspanText(c.vpText)}</div>
    </div>
  );
}

const HUM_GROUP_COLOR: Record<string, string> = {
  bee: '#e07a9b',
  brilliant: '#48cae4',
  emerald: '#52b788',
  mango: '#f4a261',
  topaz: '#ffd166',
};

export function HummingbirdCardView({
  cardId,
  selectable,
  selected,
  onClick,
}: {
  cardId: number;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const h = hummingbird(cardId);
  const flipRef = useFlipCard(`hum:${cardId}`, 'hum');
  const accent = HUM_GROUP_COLOR[h.group] ?? '#52b788';
  return (
    <div
      ref={flipRef}
      className={`hum-card${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`}
      style={{ borderColor: accent }}
      onClick={onClick}
      title={`${h.name} (${h.sciName}) — ${h.group} · benefit: ${h.benefit}`}
    >
      <div className="hum-head" style={{ background: accent }}>
        <span className="hum-group">{h.group}</span>
        <span className="hum-beak">{h.beakLeft === false ? '→' : '←'}</span>
      </div>
      <div className="hum-art">
        <BirdIllustration
          cardId={h.id}
          name={h.name}
          habitats={['forest']}
          wingspan={10}
          beakLeft={h.beakLeft}
          form="hum"
          palette={{ b: accent, h: accent, w: shade(accent, -0.3), u: shade(accent, 0.55), t: shade(accent, -0.35), throat: shade(accent, -0.25) }}
        />
      </div>
      <div className="hum-name">{h.name}</div>
      <div className="hum-benefit">
        Benefit: <b>{h.benefit}</b>
      </div>
    </div>
  );
}
