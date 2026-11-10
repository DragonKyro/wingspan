// The acting player's hand of bird cards and bonus cards.

import { bird } from '@/wingspan/cards';
import { autoPayBird, isCoverBird, rowFull } from '@/wingspan/helpers';
import { useGameStore } from '@/store/gameStore';
import type { GameState, PlayerState } from '@/wingspan/types';
import { BASE_FOODS } from '@/wingspan/types';
import type { Draft } from './draft';
import { BirdCardView, BonusCardView } from './BirdCardView';

export function HandArea({
  game,
  player,
  draft,
  setDraft,
  controls,
  dispatch,
}: {
  game: GameState;
  player: PlayerState;
  draft: Draft | null;
  setDraft: (d: Draft | null) => void;
  controls: boolean;
  dispatch: (a: Parameters<ReturnType<typeof useGameStore.getState>['dispatch']>[0]) => void;
}) {
  const inSetup = game.phase === 'setup' && game.setupRemaining.includes(player.id);
  const setupDraft = draft?.kind === 'setup' ? draft : null;

  return (
    <div className="card">
      <h3>
        {player.name}&apos;s Hand ({player.hand.length} birds · {player.bonusHand.length} bonus)
        {inSetup && ' — select birds to keep (costs 1 food per bird kept) + 1 bonus card'}
      </h3>
      <div className="hand">
        {player.hand.map((id) => {
          const playingThis = draft?.kind === 'playBird' && draft.cardId === id;
          const kept = setupDraft?.keepBirds.includes(id);
          const c = bird(id);
          const payable = autoPayBird(player, id) != null;
          const playableHabitat = c.habitats.find((h) => !rowFull(player, h) && payable);
          const coverHabitat = isCoverBird(c)
            ? c.habitats.find((h) => player.board[h].some((b) => !b.ghost))
            : undefined;
          const canUse = playableHabitat != null || coverHabitat != null;
          return (
            <BirdCardView
              key={id}
              cardId={id}
              zone={`hand:${player.id}`}
              selectable={controls && (inSetup || canUse || playingThis)}
              selected={playingThis || kept}
              onClick={() => {
                if (!controls) return;
                if (inSetup) {
                  const cur = setupDraft?.keepBirds ?? [...player.hand];
                  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
                  setDraft({
                    kind: 'setup',
                    keepBirds: next,
                    keepBonus: setupDraft?.keepBonus ?? player.bonusHand[0] ?? null,
                  });
                } else if (playingThis) {
                  setDraft(null);
                } else if (canUse) {
                  setDraft({
                    kind: 'playBird',
                    cardId: id,
                    habitat: playableHabitat ?? coverHabitat ?? null,
                  });
                }
              }}
            />
          );
        })}
        {player.bonusHand.map((id) => (
          <BonusCardView
            key={id}
            cardId={id}
            selectable={controls && inSetup}
            selected={setupDraft?.keepBonus === id}
            onClick={() => {
              if (!controls || !inSetup) return;
              setDraft({
                kind: 'setup',
                keepBirds: setupDraft?.keepBirds ?? [...player.hand],
                keepBonus: id,
              });
            }}
          />
        ))}
      </div>
      {inSetup && (
        <div className="row" style={{ marginTop: 10 }}>
          <span className="muted">
            Keeping {(setupDraft?.keepBirds ?? player.hand).length} bird(s) discards{' '}
            {(setupDraft?.keepBirds ?? player.hand).length} food
          </span>
          <button
            className="primary"
            disabled={!setupDraft || setupDraft.keepBonus == null}
            onClick={() => {
              if (!setupDraft || setupDraft.keepBonus == null) return;
              dispatch({
                type: 'keepSetup',
                playerId: player.id,
                keepBirds: setupDraft.keepBirds,
                keepBonus: setupDraft.keepBonus,
                discardFood: BASE_FOODS.slice(0, setupDraft.keepBirds.length),
              });
              setDraft(null);
            }}
          >
            ✓ Confirm Setup Keeps
          </button>
          {!setupDraft && (
            <button
              onClick={() =>
                setDraft({
                  kind: 'setup',
                  keepBirds: [...player.hand],
                  keepBonus: player.bonusHand[0]!,
                })
              }
            >
              Choose Keeps
            </button>
          )}
        </div>
      )}
    </div>
  );
}
