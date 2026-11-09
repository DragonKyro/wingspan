import { useState } from 'react';
import { bird } from '@/game/cards';
import { eggStepTargets, getPlayer, nestMatches, wingspanOf } from '@/game/helpers';
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
      // 'onlyBird' pins every egg to one bird: offer "lay N eggs" buttons
      // since the same ref repeats in the answer.
      if (step.onlyBird) {
        const targets = eggStepTargets(game, step);
        const b = p.board[step.onlyBird.habitat]?.[step.onlyBird.index];
        const name = b ? bird(b.cardId).name : 'this bird';
        const max = targets.length;
        return (
          <div className="row">
            <span>lay eggs on {name}:</span>
            {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
              <button
                key={n}
                onClick={() =>
                  send({ kind: 'birds', birds: Array.from({ length: n }, () => step.onlyBird!) })
                }
              >
                lay {n}
              </button>
            ))}
            {step.optional && (
              <button onClick={() => send({ kind: 'birds', birds: [] })}>none</button>
            )}
          </div>
        );
      }
      const targets = eggStepTargets(game, step);
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
        if (step.habitat && h !== step.habitat) continue;
        p.board[h].forEach((b, index) => {
          if (b.eggs > 0 && (!step.exclude || step.exclude.habitat !== h || step.exclude.index !== index)) {
            targets.push({ habitat: h, index });
          }
        });
      }
      return (
        <BirdRefPicker
          label={`discard ${step.count} egg${step.count > 1 ? 's' : ''}${step.optional ? ' (optional)' : ''}`}
          targets={targets}
          count={step.count}
          optional={step.optional}
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
        <div className="row">
          <HandPicker
            hand={p.bonusHand}
            count={step.count}
            label={`discard ${step.count} bonus card${step.count > 1 ? 's' : ''}`}
            onDone={(cardIds) => send({ kind: 'bonusCards', cardIds })}
            bonus
          />
          {step.optional && (
            <button onClick={() => send({ kind: 'bonusCards', cardIds: [] })}>decline</button>
          )}
        </div>
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
      // 'any' habitat: the player picks both a card and where to play it.
      const playable = p.hand.filter(
        (id) => habitat === 'any' || (habitat && bird(id).habitats.includes(habitat)),
      );
      return (
        <div className="row">
          <span>play a bird{habitat && habitat !== 'any' ? ` in ${habitat}` : ''} (normal cost):</span>
          {playable.map((id) =>
            habitat === 'any' ? (
              <span key={id}>
                {bird(id).habitats.map((h) => (
                  <button
                    key={h}
                    onClick={() => send({ kind: 'handCards', cardIds: [id], habitat: h })}
                  >
                    {bird(id).name} → {h}
                  </button>
                ))}
              </span>
            ) : (
              <BirdCardView key={id} cardId={id} selectable onClick={() => send({ kind: 'handCards', cardIds: [id] })} />
            ),
          )}
          {step.optional && (
            <button onClick={() => send({ kind: 'handCards', cardIds: [] })}>skip</button>
          )}
        </div>
      );
    }
    case 'choosePlayer':
      return (
        <div className="row">
          <span>pick a player:</span>
          {game.playerOrder
            .filter((pid) => !step.other || pid !== step.playerId)
            .map((pid) => (
              <button key={pid} onClick={() => send({ kind: 'player', playerId: pid })}>
                {getPlayer(game, pid).name}
              </button>
            ))}
          {step.optional && (
            <button onClick={() => send({ kind: 'boolean', yes: false })}>decline</button>
          )}
        </div>
      );
    case 'chooseHabitat':
      return (
        <div className="row">
          <span>pick a habitat{step.noEggs ? ' with no eggs' : ''}:</span>
          {HABITATS.filter(
            (h) =>
              !step.noEggs || p.board[h].every((b) => b.eggs === 0),
          ).map((h) => (
            <button key={h} onClick={() => send({ kind: 'habitat', habitat: h })}>
              {h}
            </button>
          ))}
        </div>
      );
    case 'chooseFoodDiscard':
      return (
        <FoodPicker
          count={step.count}
          options={(step.options === 'any' ? FOOD_TYPES : step.options).filter((f) => p.food[f] > 0)}
          optional={step.optional}
          label={`discard ${step.count} food`}
          onDone={(foods) => send({ kind: 'supplyFood', foods })}
        />
      );
    case 'chooseFoodSteal': {
      const victim = getPlayer(game, step.from);
      const options = (step.food === 'any' ? FOOD_TYPES : [step.food]).filter(
        (f) => victim.food[f] > 0,
      );
      return (
        <FoodPicker
          count={1}
          options={options}
          label={`take 1 food from ${victim.name}`}
          onDone={(foods) => send({ kind: 'supplyFood', foods })}
        />
      );
    }
    case 'chooseTrayCard':
      return (
        <div className="row">
          <span>take a tray card:</span>
          {game.tray.map(
            (id, i) =>
              id != null &&
              (!step.habitat || bird(id).habitats.includes(step.habitat)) && (
                <BirdCardView
                  key={i}
                  cardId={id}
                  selectable
                  onClick={() => send({ kind: 'handCards', cardIds: [id] })}
                />
              ),
          )}
        </div>
      );
    case 'chooseDieRemove':
      return (
        <DicePicker
          game={game}
          count={step.count}
          onDone={(picks) => send({ kind: 'dice', picks })}
        />
      );
    case 'chooseBirds': {
      const targets: { habitat: (typeof HABITATS)[number]; index: number }[] = [];
      for (const h of HABITATS) {
        if (step.habitat && h !== step.habitat) continue;
        p.board[h].forEach((b, index) => {
          if (b.ghost) return;
          if (step.exclude && step.exclude.habitat === h && step.exclude.index === index) return;
          if (step.nest && !nestMatches(bird(b.cardId).nest, step.nest)) return;
          if (step.eggsMin != null && b.eggs < step.eggsMin) return;
          targets.push({ habitat: h, index });
        });
      }
      return (
        <BirdRefPicker
          label={`pick ${step.min}–${step.max} birds`}
          targets={targets}
          count={step.max}
          optional={step.min < step.max}
          onDone={(birds) => send({ kind: 'birds', birds })}
        />
      );
    }
    case 'assignHandTucks':
      return (
        <HandPicker
          hand={p.hand}
          count={Math.min(step.targets.length, p.hand.length)}
          label={`tuck up to ${step.targets.length} card${step.targets.length > 1 ? 's' : ''}`}
          onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
        />
      );
    case 'chooseCacheOnBirds': {
      const targets: { habitat: (typeof HABITATS)[number]; index: number }[] = [];
      for (const h of HABITATS) {
        p.board[h].forEach((b, index) => {
          if (!b.ghost) targets.push({ habitat: h, index });
        });
      }
      return (
        <CacheAssignPicker
          targets={targets}
          count={step.count}
          options={step.food === 'any' ? FOOD_TYPES : [step.food]}
          onDone={(items) => send({ kind: 'cacheAssign', items })}
        />
      );
    }
    case 'chooseFoodType':
      return (
        <FoodPicker
          count={1}
          options={FOOD_TYPES}
          label="name a food type"
          onDone={(foods) => send({ kind: 'supplyFood', foods })}
        />
      );
    case 'chooseOption': {
      const OPTION_LABELS: Record<string, string> = {
        gainDie: 'gain 1 die',
        gain2Dice: 'gain 2 dice',
        drawCard: 'draw 1 card',
        layEgg: 'lay 1 egg',
        gainFruit: 'gain 1 fruit',
        fruitToNectar: 'discard 1 fruit → gain 1 nectar',
        selfEggs2: 'lay 2 eggs on this bird',
      };
      return (
        <div className="row">
          <span>choose one:</span>
          {step.options.map((o) => (
            <button key={o} onClick={() => send({ kind: 'option', option: o })}>
              {OPTION_LABELS[o] ?? o}
            </button>
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

    // === oceania expansion steps ===
    case 'chooseCopyPower': {
      const target = getPlayer(game, step.target);
      const targets: { habitat: (typeof HABITATS)[number]; index: number }[] = [];
      target.board[step.habitat].forEach((b, index) => {
        if (b.ghost) return;
        const c = bird(b.cardId);
        if (c.powerColor === 'brown' && c.powerText) {
          targets.push({ habitat: step.habitat, index });
        }
      });
      return (
        <BirdRefPicker
          label={`copy a power on ${target.name}'s ${step.habitat}`}
          targets={targets}
          count={1}
          onDone={(birds) => send({ kind: 'repeatTarget', bird: birds[0]! })}
        />
      );
    }
    case 'chooseTrayCardEx': {
      const matches = (id: number | null) => {
        if (id == null) return false;
        const c = bird(id);
        if (step.nests && !step.nests.includes(c.nest)) return false;
        if (step.wingspanLt != null && wingspanOf(c) >= step.wingspanLt) return false;
        return true;
      };
      return (
        <div className="row">
          <span>take a tray card{step.destination === 'tuck' ? ' to tuck' : ''}:</span>
          {game.tray.map(
            (id, i) =>
              matches(id) && (
                <BirdCardView
                  key={i}
                  cardId={id!}
                  selectable
                  onClick={() => send({ kind: 'trayPick', cardId: id! })}
                />
              ),
          )}
          {step.mayResetTray && (
            <button onClick={() => send({ kind: 'trayPick', mode: 'reset' })}>reset tray</button>
          )}
        </div>
      );
    }
    case 'chooseTuckOrHand': {
      const c = bird(step.cardId);
      return (
        <div className="row">
          <span>{c.name}:</span>
          <button className="primary" onClick={() => send({ kind: 'boolean', yes: true })}>
            Tuck it
          </button>
          <button onClick={() => send({ kind: 'boolean', yes: false })}>Keep in hand</button>
        </div>
      );
    }
    case 'chooseCacheFromSupply': {
      const options = (step.food === 'any' ? FOOD_TYPES : [step.food]).filter(
        (f) => p.food[f] > 0,
      );
      return (
        <FoodPicker
          count={step.count}
          options={options}
          optional={step.optional}
          label={`cache up to ${step.count} food from your supply`}
          onDone={(foods) => send({ kind: 'supplyFood', foods })}
        />
      );
    }
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
    choosePlayer: 'pick a player',
    chooseHabitat: 'pick a habitat',
    chooseFoodDiscard: `discard ${count} food`,
    chooseFoodSteal: 'take a food',
    chooseTrayCard: 'take a tray card',
    chooseDieRemove: `remove ${count} dice`,
    chooseBirds: 'pick birds',
    assignHandTucks: 'tuck cards',
    chooseCacheOnBirds: `cache ${count} food`,
    chooseFoodType: 'name a food',
    chooseOption: 'choose one',
    chooseCopyPower: 'copy a power',
    chooseTrayCardEx: 'take a tray card',
    chooseTuckOrHand: 'tuck or keep',
    chooseCacheFromSupply: 'cache food',
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

/** Assign `count` food tokens to own birds for caching. Each click adds a
 *  cache item; the default food is the first allowed option. */
function CacheAssignPicker({
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
