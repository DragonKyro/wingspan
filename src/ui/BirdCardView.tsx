// Thematic SVG-illustrated Bird Card, Bonus Card, and Hummingbird Card views
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
} from './svgArt';

function CostIcons({ card }: { card: BirdCard }) {
  const cost = card.cost;
  if (cost.kind === 'none') {
    return <span className="bcard-cost-none">Ø</span>;
  }
  if (cost.kind === 'any') {
    return (
      <span className="bcard-cost-items">
        {Array.from({ length: cost.count }, (_, i) => (
          <FoodIcon key={i} food="any" size={14} />
        ))}
      </span>
    );
  }
  if (cost.kind === 'or') {
    return (
      <span className="bcard-cost-items">
        {cost.foods.map((f, i) => (
          <span key={i} className="bcard-cost-or">
            {i > 0 && <span className="bcard-slash">/</span>}
            <FoodIcon food={f} size={14} />
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="bcard-cost-items">
      {cost.items.flatMap((item, idx) =>
        Array.from({ length: item.count }, (_, k) => (
          <FoodIcon key={`${idx}-${k}`} food={item.food} size={14} />
        )),
      )}
    </span>
  );
}

const POWER_LABEL: Record<string, string> = {
  brown: 'WHEN ACTIVATED',
  white: 'WHEN PLAYED',
  pink: 'ONCE BETWEEN TURNS',
  teal: 'ROUND END',
  yellow: 'GAME END',
};

export function BirdCardView({
  cardId,
  played,
  zone = 'card',
  selectable,
  selected,
  activating,
  onClick,
  compact,
}: {
  cardId: number;
  played?: PlayedBird;
  zone?: string;
  selectable?: boolean;
  selected?: boolean;
  activating?: boolean;
  onClick?: () => void;
  compact?: boolean;
}) {
  const c = bird(cardId);
  const flipRef = useFlipCard(`bird:${cardId}`, zone);
  const tokenTotal = (played?.eggs ?? 0) + (played?.cached.length ?? 0) + (played?.tucked.length ?? 0);
  const pulseRef = useValuePulse<HTMLDivElement>(tokenTotal);

  return (
    <div
      ref={flipRef}
      className={`bird${compact ? ' bird-compact' : ''}${selectable ? ' selectable' : ''}${
        selected ? ' selected' : ''
      }${activating ? ' activating' : ''}`}
      onClick={onClick}
      title={`${c.name} (${c.sciName}) — ${c.points} VP · ${c.wingspan} cm\n${c.powerText ?? 'No power'}`}
    >
      {/* Top header: habitat + food cost badge on left, bird name & sci name on right */}
      <div className="bcard-top">
        <div className="bcard-badge">
          <div className="bcard-habs">
            {c.habitats.map((h) => (
              <HabitatIcon key={h} habitat={h} size={14} />
            ))}
          </div>
          <div className="bcard-cost">
            <CostIcons card={c} />
          </div>
        </div>
        <div className="bcard-titles">
          <div className="bname">{c.name}</div>
          <div className="bsci">{c.sciName}</div>
        </div>
      </div>

      {/* Middle illustration + stats */}
      <div className="bcard-mid">
        <div className="bcard-left-stats">
          <div className="bcard-vp" title={`${c.points} Victory Points`}>
            <span className="bcard-vp-num">{c.points}</span>
            <span className="bcard-feather">🪶</span>
          </div>
          <div className="bcard-nest" title={`Nest: ${c.nest} (limit ${c.eggLimit})`}>
            <NestIcon nest={c.nest} size={17} />
          </div>
          <div className="bcard-egg-cap" title={`Egg capacity: ${c.eggLimit}`}>
            {Array.from({ length: Math.min(6, c.eggLimit) }, (_, i) => (
              <span
                key={i}
                className={`egg-pip${played && i < played.eggs ? ' filled' : ''}`}
              />
            ))}
          </div>
        </div>

        <div className="bcard-art">
          <BirdIllustration
            cardId={c.id}
            name={c.name}
            habitats={c.habitats}
            wingspan={c.wingspan}
            predator={c.predator}
            beakLeft={c.beakLeft}
          />
          <div className="bcard-wingspan">
            <span>↔ {c.wingspan === '*' ? '*' : `${c.wingspan}cm`}</span>
          </div>
        </div>
      </div>

      {/* Power strip */}
      {c.powerText ? (
        <div className={`bcard-power pband-${c.powerColor ?? 'white'}`}>
          <div className="bcard-power-head">
            <span>{POWER_LABEL[c.powerColor ?? 'white'] ?? 'POWER'}:</span>
            {c.predator && <span title="Predator">🦅</span>}
            {c.flocking && <span title="Flocking">🐦</span>}
            {c.bonusPower && <span title="Bonus-card power">📜</span>}
          </div>
          <div className="bpower">{renderWingspanText(c.powerText)}</div>
        </div>
      ) : (
        <div className="bcard-power pband-none">
          <span className="muted">Flock filler — no power</span>
        </div>
      )}

      {/* Tokens on played bird: eggs, cached food, tucked cards, pink-used badge */}
      {played && (
        <div ref={pulseRef} className="bcard-played-overlay">
          <div className="tokens">
            {Array.from({ length: played.eggs }, (_, i) => (
              <span key={`e${i}`} className="tok tok-egg" title="Egg (1 VP)">
                <EggTokenSvg index={i} size={15} />
              </span>
            ))}
            {played.cached.map((f, i) => (
              <span key={`c${i}`} className="tok tok-cache" title={`Cached ${f} (1 VP)`}>
                <FoodIcon food={f} size={15} />
              </span>
            ))}
            {played.pinkUsed && (
              <span className="tok-pink-used" title="Pink power used this round of turns">
                ✓pink
              </span>
            )}
          </div>
          {played.tucked.length > 0 && (
            <div className="tucked-stack" title={`${played.tucked.length} tucked card(s) (${played.tucked.length} VP)`}>
              <div
                className="tucked-bar"
                style={{ width: `${Math.min(100, 18 + played.tucked.length * 14)}%` }}
              />
              <span className="tucked-count">🂠 ×{played.tucked.length}</span>
            </div>
          )}
        </div>
      )}
    </div>
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
        <b>📜 {c.name}</b>
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
      <div className="hum-name">{h.name}</div>
      <div className="hum-benefit">
        Benefit: <b>{h.benefit}</b>
      </div>
    </div>
  );
}
