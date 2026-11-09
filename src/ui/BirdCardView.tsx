import { bird, bonusCard } from '@/game/cards';
import type { BirdCard, PlayedBird } from '@/game/types';

const FOOD_ICON: Record<string, string> = {
  invertebrate: 'worm',
  seed: 'seed',
  fish: 'fish',
  fruit: 'frut',
  rodent: 'rdnt',
  nectar: 'nctr',
  any: 'any',
};

function costText(c: BirdCard): string {
  const cost = c.cost;
  if (cost.kind === 'none') return 'free';
  if (cost.kind === 'any') return `${cost.count}×any`;
  if (cost.kind === 'or') return cost.foods.map((f) => FOOD_ICON[f] ?? f).join('/');
  return cost.items.map((i) => `${i.count > 1 ? `${i.count}×` : ''}${FOOD_ICON[i.food] ?? i.food}`).join('+');
}

export function BirdCardView({
  cardId,
  played,
  selectable,
  selected,
  onClick,
}: {
  cardId: number;
  played?: PlayedBird;
  selectable?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const c = bird(cardId);
  return (
    <div
      className={`bird${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={`${c.name} — ${c.sciName}\n${c.powerText ?? ''}`}
    >
      <div className="bname">{c.name}</div>
      <div className="bstats">
        <span>⭐{c.points}</span>
        <span>{c.nest}</span>
        <span>🪺{c.eggLimit}</span>
        <span>{c.wingspan}cm</span>
      </div>
      <div className="bmeta">
        <span>{costText(c)}</span>
        <span>{c.habitats.map((h) => h[0]).join('/')}</span>
      </div>
      {c.powerText && <div className="bpower">{c.powerText}</div>}
      {played && (
        <>
          <div className="tokens">
            {Array.from({ length: played.eggs }, (_, i) => (
              <span key={i} className="tok tok-egg" />
            ))}
            {played.cached.map((f, i) => (
              <span key={`c${i}`} className="tok tok-cache" title={f}>
                {FOOD_ICON[f]?.slice(0, 2)}
              </span>
            ))}
          </div>
          {played.tucked.length > 0 && (
            <div
              className="tucked-bar"
              style={{ width: `${Math.min(100, played.tucked.length * 12)}%` }}
              title={`${played.tucked.length} tucked`}
            />
          )}
        </>
      )}
    </div>
  );
}

export function BonusCardView({
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
  const c = bonusCard(cardId);
  return (
    <div
      className={`bonus-mini${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}`}
      onClick={onClick}
      title={`${c.name}: ${c.condition}\n${c.vpText}`}
    >
      <b>{c.name}</b>
      <div className="muted" style={{ fontSize: '0.65rem' }}>{c.condition}</div>
    </div>
  );
}
