// Shared Wingspan table: birdfeeder, bird tray, hummingbird garden, duet map.

import {
  FOREST_DICE,
  OCEANIA_FOREST_DICE,
  OCEANIA_WETLAND_CARDS,
  WETLAND_CARDS,
} from '@/wingspan/constants';
import { DUET_MAP } from '@/wingspan/duetMap';
import { actingPlayerId, actionSlot, getPlayer, isOceania } from '@/wingspan/helpers';
import type { GameState, PlayerId } from '@/wingspan/types';
import { useFlipAnchor } from '../fx';
import { DieFaceSvg, FoodIcon, NestIcon, playerColorHex, TokenIcon } from '../svgArt';
import type { Draft } from './draft';
import { BirdCardView, HummingbirdCardView } from './BirdCardView';

export function CommonRow({
  game,
  draft,
  setDraft,
  canAct,
}: {
  game: GameState;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  canAct: (pid: PlayerId) => boolean;
}) {
  const deckAnchor = useFlipAnchor('deck');
  const acting = actingPlayerId(game);
  const actingP = getPlayer(game, acting);
  const oceania = isOceania(game);
  const americas = game.settings.sets.includes('americas');

  const pickingDice = draft?.kind === 'gainFood';
  const diceNeeded = pickingDice
    ? (oceania ? OCEANIA_FOREST_DICE : FOREST_DICE)[actionSlot(actingP, 'forest', oceania)]!
    : 0;
  const allSame =
    game.feederIn.length > 0 && game.feederIn.every((f) => f === game.feederIn[0]);
  const pickingCards = draft?.kind === 'drawCards';
  const cardsNeeded = pickingCards
    ? (oceania ? OCEANIA_WETLAND_CARDS : WETLAND_CARDS)[actionSlot(actingP, 'wetland', oceania)]!
    : 0;

  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        {/* Birdfeeder */}
        <div>
          <h3><TokenIcon kind="die" size={16} /> Birdfeeder {pickingDice && `— pick ${diceNeeded}`}</h3>
          <div className="row">
            {game.feederIn.map((f, i) => (
              <span
                key={i}
                className={`die-wrap${pickingDice && canAct(acting) ? ' selectable' : ''}${
                  pickingDice && draft.picks.includes(i) ? ' picked' : ''
                }`}
                onClick={() => {
                  if (!pickingDice || !canAct(acting) || draft.kind !== 'gainFood') return;
                  if (draft.picks.includes(i)) {
                    setDraft({ ...draft, picks: draft.picks.filter((x) => x !== i) });
                  } else if (draft.picks.length < diceNeeded) {
                    setDraft({ ...draft, picks: [...draft.picks, i] });
                  }
                }}
                title={`Die ${i + 1}: ${f}`}
              >
                <DieFaceSvg face={f} size={40} />
              </span>
            ))}
            {game.feederIn.length === 0 && <span className="muted">Empty (auto-refills)</span>}
            {pickingDice && allSame && !draft.reroll && (
              <button
                type="button"
                className="secondary"
                onClick={() => setDraft({ kind: 'gainFood', reroll: true, picks: [], splitTake: draft.splitTake })}
              >
                ↻ Reroll (all same)
              </button>
            )}
          </div>
        </div>

        {/* Bird Tray & Deck */}
        <div style={{ flex: 1 }}>
          <h3><TokenIcon kind="card" size={16} /> Bird Tray {pickingCards && `— pick ${cardsNeeded}`}</h3>
          <div className="tray">
            <div
              ref={deckAnchor}
              className={`deck-stack${pickingCards && canAct(acting) ? ' selectable' : ''}`}
              title={`${game.deck.length} bird cards in deck · ${game.discard.length} in discard`}
              onClick={() => {
                if (!pickingCards || !canAct(acting) || draft.kind !== 'drawCards') return;
                if (draft.picks.length < cardsNeeded) {
                  setDraft({ ...draft, picks: [...draft.picks, 'deck'] });
                }
              }}
            >
              <div className="deck-count">{game.deck.length}</div>
              <div className="deck-sub">DECK</div>
            </div>
            {game.tray.map((id, i) =>
              id == null ? (
                <div key={i} className="slot empty" style={{ width: 132, minHeight: 150 }} />
              ) : (
                <BirdCardView
                  key={id}
                  cardId={id}
                  zone="tray"
                  compact
                  selectable={pickingCards && canAct(acting) && !draft.picks.includes(i)}
                  selected={pickingCards && draft.picks.includes(i)}
                  onClick={() => {
                    if (!pickingCards || !canAct(acting) || draft.kind !== 'drawCards') return;
                    if (draft.picks.length < cardsNeeded && !draft.picks.includes(i)) {
                      setDraft({ ...draft, picks: [...draft.picks, i] });
                    }
                  }}
                />
              ),
            )}
          </div>
        </div>

        {/* Americas Hummingbird Garden */}
        {americas && (
          <div>
            <h3><TokenIcon kind="hum" size={16} /> Hummingbird Garden (Deck: {game.humDeck.length})</h3>
            <div className="hum-garden-row">
              {game.humGarden.map((stack, i) => {
                const top = stack[stack.length - 1];
                return top != null ? (
                  <div key={i} className="hum-garden-slot">
                    <HummingbirdCardView cardId={top} />
                    {stack.length > 1 && (
                      <span className="hum-stack-depth">×{stack.length}</span>
                    )}
                  </div>
                ) : (
                  <div key={i} className="hum-garden-empty">
                    Empty
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function DuetMapPanel({ game }: { game: GameState }) {
  const duet = game.duet!;
  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <h3><TokenIcon kind="duet" size={16} /> Asia Duet Map (6×6)</h3>
        <span className="muted">
          Contiguous group = +1 VP per token · Reset space tokens:{' '}
          {duet.reset.length ? duet.reset.join(', ') : 'none'}
        </span>
      </div>
      <div className="duet-grid">
        {DUET_MAP.map((sp, i) => {
          const ownerId = duet.map[i];
          const owner = ownerId ? getPlayer(game, ownerId as PlayerId) : null;
          return (
            <div key={i} className={`duet-cell hab-${sp.habitat}`}>
              <div className="duet-crit">
                {sp.criterion.type === 'nest' && <NestIcon nest={sp.criterion.nest} size={15} />}
                {sp.criterion.type === 'food' && <FoodIcon food={sp.criterion.food} size={15} />}
                {sp.criterion.type === 'wingspan' && (
                  <span>{sp.criterion.lt50 ? '<50cm' : '≥50cm'}</span>
                )}
                {sp.criterion.type === 'beak' && (
                  <span>{sp.criterion.left ? '←Beak' : 'Beak→'}</span>
                )}
              </div>
              {sp.bonus && <span className="duet-bonus">+{sp.bonus}</span>}
              {owner && (
                <span
                  className="duet-token"
                  style={{ background: playerColorHex(owner.color) }}
                  title={owner.name}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
