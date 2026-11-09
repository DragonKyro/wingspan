import { useState } from 'react';
import { bird } from '@/game/cards';
import { eggTargets, getPlayer } from '@/game/helpers';
import { faceCovers } from '@/game/powers';
import type {
  Choice,
  FoodType,
  GameState,
  PendingStep,
} from '@/game/types';
import { FOOD_TYPES, HABITATS } from '@/game/types';
import { BirdCardView, BonusCardView } from './BirdCardView';

/** Bar pinned to the bottom while a pending choice is open. Renders the
 *  picker matching the head step's kind and dispatches resolveChoice. */
export function PendingBar({
  game,
  step,
  controls,
  dispatch,
}: {
  game: GameState;
  step: PendingStep;
  controls: boolean;
  dispatch: (a: { type: 'resolveChoice'; playerId: PendingStep['playerId']; choice: Choice }) => void;
}) {
  const p = getPlayer(game, step.playerId);
  const send = (choice: Choice) =>
    dispatch({ type: 'resolveChoice', playerId: step.playerId, choice });

  return (
    <div className="pending-bar">
      <b>
        <span className={`pcolor c-${p.color}`} />
        {p.name}:
      </b>
      <StepPicker game={game} step={step} send={send} controls={controls} />
      {!controls && <span className="muted">waiting for {p.name}…</span>}
    </div>
  );
}

function StepPicker({
  game,
  step,
  send,
  controls,
}: {
  game: GameState;
  step: PendingStep;
  send: (c: Choice) => void;
  controls: boolean;
}) {
  const p = getPlayer(game, step.playerId);
  if (!controls) return <PromptText step={step} />;

  switch (step.kind) {
    case 'pickDie': {
      return (
        <DicePicker
          game={game}
          count={step.count}
          faces={step.faces}
          onDone={(picks) => send({ kind: 'dice', picks })}
        />
      );
    }
    case 'chooseSupplyFood':
      return (
        <FoodPicker
          count={step.count}
          options={step.options === 'any' ? FOOD_TYPES : step.options}
          onDone={(foods) => send({ kind: 'supplyFood', foods })}
        />
      );
    case 'chooseBirdForEgg': {
      const targets = eggTargets(game, step.playerId, step.nest, step.exclude, step.overLimit ?? 0);
      return (
        <BirdRefPicker
          label={`lay an egg on ${step.count} bird${step.count > 1 ? 's' : ''}${step.optional ? ' (optional)' : ''}`}
          targets={targets}
          count={step.count}
          optional={step.optional}
          onDone={(birds) => send({ kind: 'birds', birds })}
        />
      );
    }
    case 'chooseBirdForEggDiscard': {
      const targets: { habitat: (typeof HABITATS)[number]; index: number }[] = [];
      for (const h of HABITATS) {
        p.board[h].forEach((b, index) => {
          if (b.eggs > 0 && (!step.exclude || step.exclude.habitat !== h || step.exclude.index !== index)) {
            targets.push({ habitat: h, index });
          }
        });
      }
      return (
        <BirdRefPicker
          label={`discard ${step.count} egg${step.count > 1 ? 's' : ''}`}
          targets={targets}
          count={step.count}
          onDone={(birds) => send({ kind: 'birds', birds })}
        />
      );
    }
    case 'chooseHandDiscard':
      return (
        <HandPicker
          hand={p.hand}
          count={step.count}
          label={`discard ${step.count} card${step.count > 1 ? 's' : ''}`}
          onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
        />
      );
    case 'chooseHandTuck':
      return (
        <HandPicker
          hand={p.hand}
          count={1}
          label="tuck a card from your hand"
          onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
        />
      );
    case 'chooseDrawnCard':
      return (
        <div className="row">
          <span>pick a card:</span>
          {step.cardIds.map((id) => (
            <BirdCardView
              key={id}
              cardId={id}
              selectable
              onClick={() => send({ kind: 'handCards', cardIds: [id] })}
            />
          ))}
        </div>
      );
    case 'chooseBonusCards':
      return (
        <div className="row">
          <span>keep {step.keep}:</span>
          {step.cardIds.map((id) => (
            <BonusCardView
              key={id}
              cardId={id}
              selectable
              onClick={() => send({ kind: 'bonusCards', cardIds: [id] })}
            />
          ))}
        </div>
      );
    case 'discardBonusCards':
      return (
        <HandPicker
          hand={p.bonusHand}
          count={step.count}
          label={`discard ${step.count} bonus card${step.count > 1 ? 's' : ''}`}
          onDone={(cardIds) => send({ kind: 'bonusCards', cardIds })}
          bonus
        />
      );
    case 'moveBirdHabitat': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b) return null;
      const c = bird(b.cardId);
      const options = c.habitats.filter((h) => h !== step.bird.habitat && p.board[h].length < 5);
      return (
        <div className="row">
          <span>move {c.name} to:</span>
          {options.map((h) => (
            <button key={h} onClick={() => send({ kind: 'habitat', habitat: h })}>
              {h}
            </button>
          ))}
        </div>
      );
    }
    case 'chooseFirstPlayer':
      return (
        <div className="row">
          <span>who starts:</span>
          {game.playerOrder.map((pid) => (
            <button key={pid} onClick={() => send({ kind: 'player', playerId: pid })}>
              {getPlayer(game, pid).name}
            </button>
          ))}
        </div>
      );
    case 'chooseRepeatPower': {
      const source = step.then?.bird;
      const targets = p.board[step.habitat]
        .map((b, index) => ({ b, index }))
        .filter(({ b, index }) => {
          if (source && source.habitat === step.habitat && source.index === index) return false;
          const c = bird(b.cardId);
          return c.powerColor === 'brown' && !!c.powerText && (!step.predatorOnly || c.predator);
        });
      return (
        <BirdRefPicker
          label="repeat which bird's power?"
          targets={targets.map(({ index }) => ({ habitat: step.habitat, index }))}
          count={1}
          onDone={(birds) => send({ kind: 'repeatTarget', bird: birds[0]! })}
        />
      );
    }
    case 'chooseAdditionalPlay': {
      const habitat = step.habitat === 'same' ? step.sourceBird?.habitat : step.habitat;
      const playable = p.hand.filter((id) => habitat && bird(id).habitats.includes(habitat));
      return (
        <div className="row">
          <span>play a bird in {habitat} (normal cost):</span>
          {playable.map((id) => (
            <BirdCardView key={id} cardId={id} selectable onClick={() => send({ kind: 'handCards', cardIds: [id] })} />
          ))}
        </div>
      );
    }
    case 'chooseCacheFood':
      return (
        <FoodPicker
          count={step.count}
          options={FOOD_TYPES}
          optional={step.optional}
          label={`cache food on ${bird(p.board[step.bird.habitat]?.[step.bird.index]?.cardId ?? -1).name}`}
          onDone={(foods) => send({ kind: 'supplyFood', foods })}
        />
      );
    case 'chooseWildTrade':
      return (
        <WildTradePicker
          have={FOOD_TYPES.filter((f) => p.food[f] > 0)}
          onDone={(give, to) => send({ kind: 'wildTrade', give, to })}
        />
      );
    case 'chooseCacheGained':
      return (
        <div className="row">
          <span>cache the {step.food} on this bird?</span>
          <button className="primary" onClick={() => send({ kind: 'boolean', yes: true })}>Cache</button>
          <button onClick={() => send({ kind: 'boolean', yes: false })}>Keep it</button>
        </div>
      );
    default:
      return <span>…</span>;
  }
}

function PromptText({ step }: { step: PendingStep }) {
  const count = 'count' in step ? step.count : 1;
  const text: Record<PendingStep['kind'], string> = {
    pickDie: `pick ${count} dice`,
    chooseSupplyFood: `choose ${count} food`,
    chooseBirdForEgg: `lay ${count} egg${count > 1 ? 's' : ''}`,
    chooseBirdForEggDiscard: `discard ${count} egg${count > 1 ? 's' : ''}`,
    chooseHandDiscard: `discard ${count} card${count > 1 ? 's' : ''}`,
    chooseHandTuck: 'tuck a card',
    chooseDrawnCard: 'pick a card',
    chooseBonusCards: 'choose bonus cards',
    discardBonusCards: 'discard bonus cards',
    moveBirdHabitat: 'move a bird',
    chooseFirstPlayer: 'choose first player',
    chooseRepeatPower: 'repeat a power',
    chooseAdditionalPlay: 'play another bird',
    chooseCacheFood: 'cache food',
    chooseWildTrade: 'trade a food',
    chooseCacheGained: 'cache or keep',
  };
  return <span>{text[step.kind]}</span>;
}

function DicePicker({
  game,
  count,
  faces,
  onDone,
}: {
  game: GameState;
  count: number;
  faces?: import('@/game/types').DieFace[];
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

function FoodPicker({
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

function BirdRefPicker({
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

function HandPicker({
  hand,
  count,
  label,
  bonus,
  onDone,
}: {
  hand: number[];
  count: number;
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
      <button className="primary" disabled={picked.length !== count} onClick={() => onDone(picked)}>
        Confirm
      </button>
    </div>
  );
}

function WildTradePicker({
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
