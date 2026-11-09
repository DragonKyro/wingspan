import { useState } from 'react';
import { bird, hummingbird } from '@/wingspan/cards';
import { DUET_MAP, duetEligibleSpaces, duetFoodsFor } from '@/wingspan/duetMap';
import {
  eggStepTargets,
  getPlayer,
  nestMatches,
  playedBirds,
  wingspanOf,
} from '@/wingspan/helpers';
import { costHasFood, faceCovers, hasPowerImpl } from '@/wingspan/powers';
import type {
  BirdRef,
  Choice,
  FoodType,
  GameState,
  PendingStep,
  PlayerState,
} from '@/wingspan/types';
import { FOOD_TYPES, HABITATS } from '@/wingspan/types';
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
        <div>
          <HandPicker
            hand={p.hand}
            count={step.count}
            min={step.optional ? 0 : step.count}
            label={`discard ${step.optional ? 'up to ' : ''}${step.count} card${step.count > 1 ? 's' : ''}`}
            onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
          />
          {step.optional && (
            <button onClick={() => send({ kind: 'handCards', cardIds: [] })}>decline</button>
          )}
        </div>
      );
    case 'chooseHandTuck': {
      const hand =
        step.wingspanLt != null
          ? p.hand.filter((id) => wingspanOf(bird(id)) < step.wingspanLt!)
          : p.hand;
      return (
        <div>
          <HandPicker
            hand={hand}
            count={1}
            min={step.optional ? 0 : 1}
            label={`tuck a card from your hand${step.wingspanLt ? ` (<${step.wingspanLt}cm)` : ''}`}
            onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
          />
          {step.optional && (
            <button onClick={() => send({ kind: 'handCards', cardIds: [] })}>decline</button>
          )}
        </div>
      );
    }
    case 'chooseCardDiscard': {
      // Qualifying cards on the tray or in hand.
      const matches = (id: number) => step.costFoods.some((f) => costHasFood(bird(id), [f]));
      return (
        <div className="row">
          <span>discard a card with {step.costFoods.join('/')} in its cost:</span>
          {step.fromTray &&
            game.tray.map(
              (id, i) =>
                id != null &&
                matches(id) && (
                  <BirdCardView
                    key={`t${i}`}
                    cardId={id}
                    selectable
                    onClick={() => send({ kind: 'handCards', cardIds: [id] })}
                  />
                ),
            )}
          {step.fromHand &&
            p.hand.map(
              (id) =>
                matches(id) && (
                  <BirdCardView
                    key={`h${id}`}
                    cardId={id}
                    selectable
                    onClick={() => send({ kind: 'handCards', cardIds: [id] })}
                  />
                ),
            )}
          {step.optional && (
            <button onClick={() => send({ kind: 'handCards', cardIds: [] })}>decline</button>
          )}
        </div>
      );
    }
    case 'chooseCachedDiscard': {
      // Click a cached food to discard it.
      const items: { bird: BirdRef; food: FoodType; label: string }[] = [];
      for (const { ref, bird: b } of playedBirds(p)) {
        for (const food of b.cached) {
          items.push({ bird: ref, food, label: `${ref.habitat} #${ref.index + 1}` });
        }
      }
      return (
        <CachedDiscardPicker
          items={items}
          count={step.count}
          optional={step.optional}
          onDone={(chosen) => send({ kind: 'cacheAssign', items: chosen })}
        />
      );
    }
    case 'chooseDrawnCard': {
      const keep = step.keep ?? 1;
      if (keep > 1) {
        return (
          <HandPicker
            hand={step.cardIds}
            count={keep}
            label={`keep ${keep} of the drawn cards`}
            onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
          />
        );
      }
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
    }
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
          if (step.excludeIds?.includes(index)) return false;
          const c = bird(b.cardId);
          return c.powerColor === 'brown' && !!c.powerText && (!step.predatorOnly || c.predator);
        });
      return (
        <div>
          <BirdRefPicker
            label="repeat which bird's power?"
            targets={targets.map(({ index }) => ({ habitat: step.habitat, index }))}
            count={1}
            onDone={(birds) => send({ kind: 'repeatTarget', bird: birds[0]! })}
          />
          {step.optional && (
            <button onClick={() => send({ kind: 'boolean', yes: false })}>done</button>
          )}
        </div>
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
        trayCard: 'take a tray card',
        gainSeed: 'gain 1 seed',
        tuckDeckCard: 'tuck a deck card',
        asiaCacheWild: 'cache 1 wild food',
        asiaTuckHand: 'tuck a hand card',
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
      const habitats = step.habitat === 'any' ? HABITATS : [step.habitat];
      const targets: { habitat: (typeof HABITATS)[number]; index: number }[] = [];
      for (const h of habitats) {
        target.board[h].forEach((b, index) => {
          if (b.ghost) return;
          const c = bird(b.cardId);
          if (c.powerColor === 'brown' && c.powerText && hasPowerImpl(c.id)) {
            targets.push({ habitat: h, index });
          }
        });
      }
      return (
        <BirdRefPicker
          label={`copy a power on ${target.name}'s ${step.habitat === 'any' ? 'mat' : step.habitat}`}
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

    // === asia / duet expansion steps ===
    case 'chooseDuetSpace': {
      if (!game.duet) return <span>place a duet token</span>;
      const card = bird(step.cardId);
      const eligible = duetEligibleSpaces(
        game.duet.map,
        card,
        step.habitat,
        duetFoodsFor(card, step.foods),
      );
      return (
        <div className="row">
          <span>place a duet token:</span>
          {eligible.map((i) => (
            <button key={i} onClick={() => send({ kind: 'duetSpace', space: i })}>
              #{i + 1}
              {DUET_MAP[i]!.bonus ? ` (+${DUET_MAP[i]!.bonus})` : ''}
            </button>
          ))}
          <button onClick={() => send({ kind: 'duetSpace', space: 'reset' })}>reset space</button>
        </div>
      );
    }
    case 'chooseResources':
      return (
        <ResourcePicker
          p={p}
          count={step.count}
          optional={step.optional}
          onDone={(resources) => send({ kind: 'resources', ...resources })}
        />
      );
    case 'chooseTrayDiscard': {
      return (
        <TrayDiscardPicker
          tray={game.tray}
          onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
        />
      );
    }
    case 'moveBirdToPlayer': {
      const b = p.board[step.bird.habitat]?.[step.bird.index];
      if (!b) return <span>bird is gone</span>;
      const target = getPlayer(game, step.target);
      const card = bird(b.cardId);
      return (
        <div className="row">
          <span>move {card.name} to {target.name}'s:</span>
          {HABITATS.filter(
            (h) => card.habitats.includes(h) && target.board[h].length < 5,
          ).map((h) => (
            <button key={h} onClick={() => send({ kind: 'habitat', habitat: h })}>
              {h}
            </button>
          ))}
        </div>
      );
    }
    case 'confirm':
      return (
        <div className="row">
          <span>continue?</span>
          <button className="primary" onClick={() => send({ kind: 'boolean', yes: true })}>Yes</button>
          <button onClick={() => send({ kind: 'boolean', yes: false })}>No</button>
        </div>
      );
    case 'chooseHandPick':
      return (
        <div>
          <HandPicker
            hand={p.hand}
            count={step.count}
            label={`pick ${step.count} card${step.count > 1 ? 's' : ''}`}
            onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
          />
          {step.optional && (
            <button onClick={() => send({ kind: 'handCards', cardIds: [] })}>decline</button>
          )}
        </div>
      );
    case 'choosePoolTuck': {
      const n = Math.min(step.count, step.cardIds.length);
      return (
        <HandPicker
          hand={step.cardIds}
          count={n}
          min={Math.min(step.min ?? n, n)}
          label={`tuck up to ${n} of the drawn cards${step.rest === 'hand' ? ' (rest to hand)' : ' (rest discarded)'}`}
          onDone={(cardIds) => send({ kind: 'handCards', cardIds })}
        />
      );
    }
    case 'chooseCopyPlayed': {
      const targets: { player: (typeof game.playerOrder)[number]; ref: { habitat: (typeof HABITATS)[number]; index: number }; name: string }[] = [];
      const seen = new Set<string>();
      for (const pid of game.playerOrder) {
        if (pid === step.playerId) continue;
        const tp = getPlayer(game, pid);
        for (const { ref, bird: b } of playedBirds(tp)) {
          const c = bird(b.cardId);
          if (c.powerColor === 'white' && c.powerText && hasPowerImpl(c.id)) {
            const key = `${pid}:${ref.habitat}:${ref.index}`;
            if (!seen.has(key)) {
              seen.add(key);
              targets.push({ player: pid, ref, name: `${c.name} (${tp.name})` });
            }
          }
        }
      }
      return (
        <div className="row">
          <span>copy a neighbour's played power:</span>
          {targets.map((t) => (
            <button
              key={`${t.player}:${t.ref.habitat}:${t.ref.index}`}
              onClick={() => send({ kind: 'playedTarget', player: t.player, bird: t.ref })}
            >
              {t.name}
            </button>
          ))}
        </div>
      );
    }
    case 'chooseReroll':
      return (
        <RerollPicker
          game={game}
          onDone={(picks) => send({ kind: 'dice', picks })}
        />
      );
    case 'drawUpTo': {
      const cap = step.then?.n?.[0] ?? 0;
      const total = step.pool.reduce((n, id) => n + wingspanOf(bird(id)), 0);
      return (
        <div className="row">
          <span>
            drawn {step.pool.length} card{step.pool.length === 1 ? '' : 's'} (wingspan {total}/{cap})
            — draw another?
          </span>
          <button
            className="primary"
            disabled={step.left <= 0}
            onClick={() => send({ kind: 'boolean', yes: true })}
          >
            Draw
          </button>
          <button onClick={() => send({ kind: 'boolean', yes: false })}>Stop</button>
        </div>
      );
    }

    // === americas expansion steps ===
    case 'chooseHumSource': {
      const pickable = (i: number) => {
        const id = game.humGarden[i]![game.humGarden[i]!.length - 1];
        return (
          id != null &&
          !p.humReturned.includes(id) &&
          (!step.groups || step.groups.includes(hummingbird(id).group))
        );
      };
      return (
        <div className="row">
          <span>attract a hummingbird to your {step.habitat}:</span>
          {game.humGarden.map((slot, i) => {
            const id = slot[slot.length - 1];
            return (
              id != null && (
                <button
                  key={i}
                  disabled={!pickable(i)}
                  onClick={() => send({ kind: 'humPick', source: i })}
                >
                  {hummingbird(id).name}
                </button>
              )
            );
          })}
          {!step.groups && (game.humDeck.length > 0 || game.humDiscard.length > 0) && (
            <button onClick={() => send({ kind: 'humPick', source: 'deck' })}>deck</button>
          )}
        </div>
      );
    }
    case 'chooseHumCover': {
      const humId = p.humBoard[step.habitat];
      return (
        <div className="row">
          <span>
            return {humId != null ? hummingbird(humId).name : 'the hummingbird'} — cover a garden
            slot:
          </span>
          {game.humGarden.map((slot, i) => (
            <button key={i} onClick={() => send({ kind: 'humCover', slot: i })}>
              {slot.length > 0 ? hummingbird(slot[slot.length - 1]!).name : `slot ${i + 1}`}
            </button>
          ))}
        </div>
      );
    }
    case 'chooseHumColumn': {
      const options = step.down
        ? step.groups.filter((g) => p.humTrack[g] > 0)
        : step.groups;
      return (
        <div className="row">
          <span>move a hummingbird token {step.down ? 'down' : 'up'}:</span>
          {options.map((g) => (
            <button key={g} onClick={() => send({ kind: 'humColumn', group: g })}>
              {g}
            </button>
          ))}
        </div>
      );
    }
    case 'chooseHumHabitat': {
      const attractable = (h: (typeof HABITATS)[number]) => {
        if (step.exclude === h || p.humBoard[h] != null) return false;
        const visible = game.humGarden.some((slot) => {
          const id = slot[slot.length - 1];
          return (
            id != null &&
            !p.humReturned.includes(id) &&
            (!step.groups || step.groups.includes(hummingbird(id).group))
          );
        });
        const deckOk =
          !step.groups && (game.humDeck.length > 0 || game.humDiscard.length > 0);
        return visible || deckOk;
      };
      const returnable = (h: (typeof HABITATS)[number]) => {
        if (step.exclude === h) return false;
        const id = p.humBoard[h];
        return id != null && (!step.groups || step.groups.includes(hummingbird(id).group));
      };
      const rows = HABITATS.filter((h) =>
        step.mode === 'attract'
          ? attractable(h)
          : step.mode === 'return'
            ? returnable(h)
            : attractable(h) || returnable(h),
      );
      return (
        <div className="row">
          <span>
            {step.mode === 'attract' ? 'attract to' : step.mode === 'return' ? 'return from' : 'hummingbird action in'}{' '}
            a row{step.groups ? ` (${step.groups.join('/')})` : ''}:
          </span>
          {rows.map((h) => (
            <button key={h} onClick={() => send({ kind: 'habitat', habitat: h })}>
              {h}
            </button>
          ))}
          {step.optional && (
            <button onClick={() => send({ kind: 'boolean', yes: false })}>decline</button>
          )}
        </div>
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
    chooseCardDiscard: 'discard a cost-matching card',
    chooseCachedDiscard: `discard ${count} cached food`,
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
    chooseDuetSpace: 'place a duet token',
    chooseResources: `discard ${count} resources`,
    chooseTrayDiscard: 'discard tray cards',
    moveBirdToPlayer: 'move a bird',
    confirm: 'confirm',
    chooseHandPick: `pick ${count} cards`,
    choosePoolTuck: 'tuck drawn cards',
    chooseCopyPlayed: 'copy a power',
    chooseReroll: 'reroll dice',
    drawUpTo: 'draw or stop',
    chooseHumSource: 'attract a hummingbird',
    chooseHumCover: 'cover a garden slot',
    chooseHumColumn: 'move a hummingbird token',
    chooseHumHabitat: 'pick a hummingbird row',
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
function CachedDiscardPicker({
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

/** Asia "any resources" payment: mix supply food, bird eggs and hand cards. */
function ResourcePicker({
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
function TrayDiscardPicker({
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
function RerollPicker({
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
