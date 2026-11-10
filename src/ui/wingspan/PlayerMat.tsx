// A player's Wingspan mat: habitat rows, column egg costs, hummingbird track.

import { bird } from '@/wingspan/cards';
import {
  COLUMN_EGG_COST,
  FOREST_DICE,
  GRASSLAND_EGGS,
  HUM_BONUS_SPACES,
  HUM_LADDER,
  OCEANIA_FOREST_DICE,
  OCEANIA_GRASSLAND_EGGS,
  OCEANIA_WETLAND_CARDS,
  WETLAND_CARDS,
} from '@/wingspan/constants';
import {
  actingPlayerId,
  actionSlot,
  autoPayBird,
  isCoverBird,
  playEggCost,
  playedBirds,
  totalEggs,
} from '@/wingspan/helpers';
import { useGameStore } from '@/store/gameStore';
import type { BirdRef, GameState, HumGroup, PlayerState } from '@/wingspan/types';
import { FOOD_TYPES, HABITATS, HUM_GROUPS } from '@/wingspan/types';
import {
  EggTokenSvg,
  FoodIcon,
  HabitatIcon,
  HUM_GROUP_HEX,
  playerColorHex,
  TokenIcon,
} from '../svgArt';
import type { Draft } from './draft';
import { BirdCardView, HummingbirdCardView } from './BirdCardView';

export function PlayerMatView({
  game,
  player,
  oceania,
  draft,
  setDraft,
  controls,
  dispatch,
}: {
  game: GameState;
  player: PlayerState;
  oceania: boolean;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  controls: boolean;
  dispatch: (a: Parameters<ReturnType<typeof useGameStore.getState>['dispatch']>[0]) => void;
}) {
  const playing = draft?.kind === 'playBird' && draft.habitat;
  const laying = draft?.kind === 'layEggs';
  const americas = game.settings.sets.includes('americas');
  const eggsLeft = laying
    ? (oceania ? OCEANIA_GRASSLAND_EGGS : GRASSLAND_EGGS)[actionSlot(player, 'grassland', oceania)]! -
      draft.placements.length
    : 0;

  return (
    <div className="card mat">
      <div className="mat-head">
        <span className="pcolor" style={{ background: playerColorHex(player.color) }} />
        <span className="name">{player.name}&apos;s Preserve</span>
        <FoodCounts player={player} />
        <span className="muted">
          Hand: <b>{player.hand.length}</b> · Eggs: <b>{totalEggs(player)}</b>
        </span>
      </div>

      {/* Column Egg Cost Header */}
      <div className="mat-col-costs">
        <div className="hab-gutter" />
        {COLUMN_EGG_COST.map((cost, col) => (
          <div key={col} className="col-cost-cell">
            <span>Col {col + 1}</span>
            <span>
              {cost === 0 ? (
                'Free'
              ) : (
                <>
                  {Array.from({ length: cost }, (_, k) => (
                    <EggTokenSvg key={k} index={k} size={12} />
                  ))}
                </>
              )}
            </span>
          </div>
        ))}
      </div>

      {HABITATS.map((h) => {
        const activeBirdIdx =
          game.activation && game.activation.habitat === h
            ? game.activation.remaining[0]
            : undefined;
        const rowGain =
          h === 'forest'
            ? (oceania ? OCEANIA_FOREST_DICE : FOREST_DICE)[actionSlot(player, h, oceania)]
            : h === 'grassland'
              ? (oceania ? OCEANIA_GRASSLAND_EGGS : GRASSLAND_EGGS)[actionSlot(player, h, oceania)]
              : (oceania ? OCEANIA_WETLAND_CARDS : WETLAND_CARDS)[actionSlot(player, h, oceania)];

        return (
          <div key={h} className="hab-row">
            <div className={`hab-label hab-${h}`}>
              <HabitatIcon habitat={h} size={18} />
              <span>{h}</span>
              <span className="hab-gain-badge">+{rowGain}</span>
              {oceania && player.nectarSpent[h] > 0 && (
                <span className="hab-nectar-badge" title="Spent nectar in this habitat">
                  <FoodIcon food="nectar" size={12} />
                  {player.nectarSpent[h]}
                </span>
              )}
            </div>
            <div className="slots">
              {Array.from({ length: 5 }, (_, i) => {
                const b = player.board[h][i];
                const playHere = playing && draft.habitat === h && i === player.board[h].length;
                const coverTarget =
                  playing &&
                  draft.kind === 'playBird' &&
                  isCoverBird(bird(draft.cardId)) &&
                  b &&
                  !b.ghost &&
                  bird(draft.cardId).habitats.includes(h);
                const eggTarget =
                  laying &&
                  controls &&
                  b &&
                  !b.ghost &&
                  b.eggs < bird(b.cardId).eggLimit;
                const isActivating =
                  player.id === actingPlayerId(game) && activeBirdIdx === i;

                return (
                  <div
                    key={i}
                    className={`slot${b ? '' : ' empty'}${b?.ghost ? ' ghost' : ''}${
                      playHere || coverTarget || eggTarget ? ' targetable' : ''
                    }`}
                    onClick={() => {
                      if (!controls) return;
                      if (playing && draft.kind === 'playBird') {
                        const card = bird(draft.cardId);
                        if (isCoverBird(card) && b && !b.ghost && card.habitats.includes(h)) {
                          dispatch({
                            type: 'playBird',
                            playerId: player.id,
                            cardId: draft.cardId,
                            habitat: h,
                            eggPayments: [],
                            foodPayments: [],
                            coverBird: { habitat: h, index: i },
                          });
                          setDraft(null);
                          return;
                        }
                      }
                      if (playHere && controls && draft.kind === 'playBird') {
                        const pay = autoPayBird(player, draft.cardId);
                        if (!pay) return;
                        dispatch({
                          type: 'playBird',
                          playerId: player.id,
                          cardId: draft.cardId,
                          habitat: h,
                          eggPayments: autoEggs(player, playEggCost(player, h)),
                          foodPayments: pay.foodPayments,
                          cachedFoodPayments: pay.cachedFoodPayments,
                          cardPayments: pay.cardPayments,
                          coverTwo: draft.coverTwo,
                        });
                        setDraft(null);
                      } else if (eggTarget && laying && draft.kind === 'layEggs') {
                        setDraft({
                          ...draft,
                          placements: [...draft.placements, { habitat: h, index: i }],
                        });
                      }
                    }}
                  >
                    {b ? (
                      b.ghost ? (
                        <div className="sideways-ghost">
                          <span>↔ Sideways Bird</span>
                        </div>
                      ) : (
                        <BirdCardView
                          cardId={b.cardId}
                          played={b}
                          zone={`board:${player.id}:${h}:${i}`}
                          activating={isActivating}
                        />
                      )
                    ) : i === player.board[h].length ? (
                      <div className="next-slot-hint">
                        {playHere ? '▶ Click to Play Bird' : 'Next Slot'}
                      </div>
                    ) : null}
                    {b &&
                      laying &&
                      draft.placements.filter((r) => r.habitat === h && r.index === i).length >
                        0 && (
                        <span className="badge">
                          +
                          {
                            draft.placements.filter((r) => r.habitat === h && r.index === i)
                              .length
                          }
                          <EggTokenSvg index={0} size={11} />
                        </span>
                      )}
                  </div>
                );
              })}

              {/* Americas Hummingbird Space at end of habitat row */}
              {americas && (
                <div className="hum-board-slot">
                  {player.humBoard[h] != null ? (
                    <HummingbirdCardView cardId={player.humBoard[h]!} />
                  ) : (
                    <div className="hum-empty-space"><TokenIcon kind="hum" size={14} /> Hummingbird space</div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Americas Hummingbird Track */}
      {americas && (
        <div className="hum-track-bar">
          <span className="muted"><TokenIcon kind="hum" size={14} /> Hummingbird track:</span>
          {HUM_GROUPS.map((grp: HumGroup) => {
            const pos = player.humTrack[grp] ?? 0;
            const pts = HUM_LADDER[pos] ?? 0;
            const isBonus = HUM_BONUS_SPACES[grp]?.includes(pos);
            return (
              <span key={grp} className="stat-pill">
                <TokenIcon kind="hum" size={13} color={HUM_GROUP_HEX[grp]} title={`${grp} hummingbirds`} />
                <b>{grp}:</b> step {pos}/{HUM_LADDER.length - 1} ({pts >= 0 ? `+${pts}` : pts} VP)
                {isBonus ? ' ✨' : ''}
              </span>
            );
          })}
        </div>
      )}

      {laying && (
        <div className="muted">
          Placing eggs: <b>{eggsLeft}</b> left (click birds above, then confirm in Actions)
        </div>
      )}
    </div>
  );
}

function autoEggs(p: PlayerState, count: number): BirdRef[] {
  const out: BirdRef[] = [];
  for (const { ref, bird: b } of playedBirds(p)) {
    for (let i = 0; i < b.eggs && out.length < count; i++) out.push(ref);
    if (out.length >= count) break;
  }
  return out;
}

function FoodCounts({ player }: { player: PlayerState }) {
  return (
    <span className="food-counts">
      {FOOD_TYPES.filter((f) => player.food[f] > 0).map((f) => (
        <span key={f} className="fc" title={f}>
          <FoodIcon food={f} size={17} />
          <b>{player.food[f]}</b>
        </span>
      ))}
    </span>
  );
}
