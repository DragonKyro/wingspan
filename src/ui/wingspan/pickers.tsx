// Reusable pickers used by StepPicker (dice, food, birds, hand cards, …).

import { useState } from 'react';
import { playedBirds } from '@/wingspan/helpers';
import { faceCovers } from '@/wingspan/powers';
import type { BirdRef, FoodType, GameState, PlayerState } from '@/wingspan/types';
import { FOOD_TYPES, HABITATS } from '@/wingspan/types';
import { BirdCardView, BonusCardView } from './BirdCardView';

export function DicePicker({
  game,
  count,
  faces,
  onDone,
}: {
  game: GameState;
  count: number;
  faces?: import('@/wingspan/types').DieFace[];
  onDone: (picks: { die: number; take?: FoodType }[]) => void;
}) {
  const [picks, setPicks] = useState<number[]>([]);
  const allowed = (i: number) => !faces || faces.some((w) => faceCovers(game.feederIn[i]!, w));
  return (
    <div className="row">
      <span>take {count} dice{faces ? ` (${faces.join('/')})` : ''}:</span>
      {game.feederIn.map((f, i) => (
        <span
          key={i}
          className={`die${allowed(i) ? ' selectable' : ''}${picks.includes(i) ? ' picked' : ''}`}
          onClick={() => {
            if (!allowed(i)) return;
            setPicks((cur) => (cur.includes(i) ? cur.filter((x) => x !== i) : cur.length < count ? [...cur, i] : cur));
          }}
        >
          {f === 'split' ? 'inv/seed' : f === 'invertebrate' ? 'inv' : f}
        </span>
      ))}
      <button
        className="primary"
        disabled={picks.length !== count}
        onClick={() =>
          onDone(picks.map((die, k) => ({ die: die - k, take: 'seed' as FoodType })))
        }
      >
        Take
      </button>
    </div>
  );
}

export function FoodPicker({
  count,
  options,
  optional,
  label,
  onDone,
}: {
  count: number;
  options: FoodType[];
  optional?: boolean;
  label?: string;
  onDone: (foods: FoodType[]) => void;
}) {
  const [picked, setPicked] = useState<FoodType[]>([]);
  return (
    <div className="row">
      <span>{label ?? `take ${count} food`}:</span>
      {options.map((f) => (
        <button
          key={f}
          disabled={picked.length >= count}
          onClick={() => setPicked((cur) => [...cur, f])}
        >
          <span className={`fchip f-${f}`}>{f[0].toUpperCase()}</span> {f}
        </button>
      ))}
      <span className="muted">{picked.map((f) => f[0]).join(', ') || 'none'}</span>
      <button
        className="primary"
        disabled={!optional && picked.length !== count}
        onClick={() => onDone(picked)}
      >
        Confirm
      </button>
    </div>
  );
}

export function BirdRefPicker({
  label,
  targets,
  count,
  optional,
  onDone,
}: {
  label: string;
  targets: { habitat: (typeof HABITATS)[number]; index: number }[];
  count: number;
  optional?: boolean;
  onDone: (birds: { habitat: (typeof HABITATS)[number]; index: number }[]) => void;
}) {
  const [picked, setPicked] = useState<typeof targets>([]);
  return (
    <div className="row">
      <span>{label}:</span>
      {targets.map((t) => {
        const isPicked = picked.some((x) => x.habitat === t.habitat && x.index === t.index);
        return (
          <button
            key={`${t.habitat}:${t.index}`}
            onClick={() =>
              setPicked((cur) =>
                isPicked
                  ? cur.filter((x) => !(x.habitat === t.habitat && x.index === t.index))
                  : cur.length < count
                    ? [...cur, t]
                    : cur,
              )
            }
            style={isPicked ? { borderColor: 'var(--accent)' } : undefined}
          >
            {t.habitat} #{t.index + 1}
          </button>
        );
      })}
      <button
        className="primary"
        disabled={!optional && picked.length !== count}
        onClick={() => onDone(picked)}
      >
        Confirm
      </button>
    </div>
  );
}

export function HandPicker({
  hand,
  count,
  min,
  label,
  bonus,
  onDone,
}: {
  hand: number[];
  count: number;
  min?: number;
  label: string;
  bonus?: boolean;
  onDone: (cardIds: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  return (
    <div className="row">
      <span>{label}:</span>
      {hand.map((id) =>
        bonus ? (
          <BonusCardView
            key={id}
            cardId={id}
            selectable
            selected={picked.includes(id)}
            onClick={() =>
              setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < count ? [...cur, id] : cur))
            }
          />
        ) : (
          <BirdCardView
            key={id}
            cardId={id}
            selectable
            selected={picked.includes(id)}
            onClick={() =>
              setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < count ? [...cur, id] : cur))
            }
          />
        ),
      )}
      <button
        className="primary"
        disabled={picked.length > count || picked.length < (min ?? count)}
        onClick={() => onDone(picked)}
      >
        Confirm
      </button>
    </div>
  );
}

/** Pick `count` cached-food items to discard (americas "discard a cached [wild]"). */
export function CachedDiscardPicker({
  items,
  count,
  optional,
  onDone,
}: {
  items: { bird: BirdRef; food: FoodType; label: string }[];
  count: number;
  optional?: boolean;
  onDone: (items: { bird: BirdRef; food: FoodType }[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) =>
    setPicked((cur) =>
      cur.includes(i) ? cur.filter((x) => x !== i) : cur.length < count ? [...cur, i] : cur,
    );
  return (
    <div className="row">
      <span>discard {count} cached food:</span>
      {items.map((it, i) => (
        <button
          key={i}
          style={picked.includes(i) ? { borderColor: 'var(--accent)' } : undefined}
          onClick={() => toggle(i)}
        >
          {it.food} ({it.label})
        </button>
      ))}
      <button
        className="primary"
        disabled={picked.length !== count}
        onClick={() => onDone(picked.map((i) => ({ bird: items[i]!.bird, food: items[i]!.food })))}
      >
        Confirm
      </button>
      {optional && <button onClick={() => onDone([])}>decline</button>}
    </div>
  );
}

export function WildTradePicker({
  have,
  onDone,
}: {
  have: FoodType[];
  onDone: (give: FoodType, to: FoodType) => void;
}) {
  const [give, setGive] = useState<FoodType | null>(null);
  return (
    <div className="row">
      <span>trade</span>
      {have.map((f) => (
        <button key={f} style={give === f ? { borderColor: 'var(--accent)' } : undefined} onClick={() => setGive(f)}>
          {f}
        </button>
      ))}
      <span>for</span>
      {give &&
        FOOD_TYPES.map((f) => (
          <button key={f} onClick={() => onDone(give, f)}>
            {f}
          </button>
        ))}
    </div>
  );
}

/** Assign `count` food tokens to own birds for caching. Each click adds a
 *  cache item; the default food is the first allowed option. */
export function CacheAssignPicker({
  targets,
  count,
  options,
  onDone,
}: {
  targets: { habitat: (typeof HABITATS)[number]; index: number }[];
  count: number;
  options: FoodType[];
  onDone: (items: { bird: { habitat: (typeof HABITATS)[number]; index: number }; food: FoodType }[]) => void;
}) {
  const [items, setItems] = useState<{ bird: (typeof targets)[number]; food: FoodType }[]>([]);
  const [food, setFood] = useState<FoodType>(options[0]!);
  return (
    <div className="row">
      <span>
        cache {count} food on your birds ({items.length}/{count}):
      </span>
      {options.map((f) => (
        <button
          key={f}
          style={food === f ? { borderColor: 'var(--accent)' } : undefined}
          onClick={() => setFood(f)}
        >
          {f}
        </button>
      ))}
      {targets.map((t) => (
        <button
          key={`${t.habitat}:${t.index}`}
          disabled={items.length >= count}
          onClick={() => setItems((cur) => [...cur, { bird: t, food }])}
        >
          {t.habitat} #{t.index + 1}
        </button>
      ))}
      <button
        className="primary"
        disabled={items.length !== count}
        onClick={() => onDone(items)}
      >
        Confirm
      </button>
    </div>
  );
}

/** Asia "any resources" payment: mix supply food, bird eggs and hand cards. */
export function ResourcePicker({
  p,
  count,
  optional,
  onDone,
}: {
  p: PlayerState;
  count: number;
  optional?: boolean;
  onDone: (r: { foods: FoodType[]; eggs: BirdRef[]; cards: number[] }) => void;
}) {
  const [foods, setFoods] = useState<FoodType[]>([]);
  const [eggs, setEggs] = useState<BirdRef[]>([]);
  const [cards, setCards] = useState<number[]>([]);
  const total = foods.length + eggs.length + cards.length;
  const eggCount = (ref: BirdRef) =>
    eggs.filter((r) => r.habitat === ref.habitat && r.index === ref.index).length;
  return (
    <div>
      <div className="row">
        <span>
          discard {count} resources ({total}/{count}):
        </span>
        {FOOD_TYPES.filter((f) => p.food[f] > foods.filter((x) => x === f).length).map((f) => (
          <button key={f} disabled={total >= count} onClick={() => setFoods((c) => [...c, f])}>
            {f}
          </button>
        ))}
        {playedBirds(p).map(({ ref, bird: b }) =>
          b.eggs > eggCount(ref) ? (
            <button
              key={`${ref.habitat}:${ref.index}`}
              disabled={total >= count}
              onClick={() => setEggs((c) => [...c, ref])}
            >
              egg {ref.habitat} #{ref.index + 1}
            </button>
          ) : null,
        )}
        {p.hand.map((id) =>
          !cards.includes(id) ? (
            <BirdCardView
              key={id}
              cardId={id}
              selectable
              onClick={() => total < count && setCards((c) => [...c, id])}
            />
          ) : null,
        )}
      </div>
      <div className="row">
        <button className="primary" disabled={total !== count} onClick={() => onDone({ foods, eggs, cards })}>
          Confirm
        </button>
        <button
          onClick={() => {
            setFoods([]);
            setEggs([]);
            setCards([]);
          }}
        >
          Clear
        </button>
        {optional && (
          <button onClick={() => onDone({ foods: [], eggs: [], cards: [] })}>decline</button>
        )}
      </div>
    </div>
  );
}

/** Asia tray-discard powers: toggle any number of tray cards, then refill. */
export function TrayDiscardPicker({
  tray,
  onDone,
}: {
  tray: (number | null)[];
  onDone: (cardIds: number[]) => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  return (
    <div className="row">
      <span>discard tray cards:</span>
      {tray.map(
        (id, i) =>
          id != null && (
            <BirdCardView
              key={i}
              cardId={id}
              selectable
              selected={picked.includes(id)}
              onClick={() =>
                setPicked((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
              }
            />
          ),
      )}
      <button className="primary" onClick={() => onDone(picked)}>
        Discard {picked.length || 'none'} + refill
      </button>
    </div>
  );
}

/** Asia eagle power: pick any number of feeder dice to reroll (none = stop). */
export function RerollPicker({
  game,
  onDone,
}: {
  game: GameState;
  onDone: (picks: { die: number }[]) => void;
}) {
  const [picks, setPicks] = useState<number[]>([]);
  return (
    <div className="row">
      <span>reroll any dice:</span>
      {game.feederIn.map((f, i) => (
        <span
          key={i}
          className={`die selectable${picks.includes(i) ? ' picked' : ''}`}
          onClick={() =>
            setPicks((c) => (c.includes(i) ? c.filter((x) => x !== i) : [...c, i]))
          }
        >
          {f === 'split' ? 'inv/seed' : f === 'invertebrate' ? 'inv' : f}
        </span>
      ))}
      <button className="primary" onClick={() => onDone(picks.map((die) => ({ die })))}>
        {picks.length > 0 ? `Reroll ${picks.length}` : 'Stop'}
      </button>
    </div>
  );
}
