// Bar for the head pending step: who must answer and the step's prompt.

import { getPlayer } from '@/wingspan/helpers';
import type { Choice, GameState, PendingStep } from '@/wingspan/types';
import { StepPicker } from './StepPicker';

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

export function PromptText({ step }: { step: PendingStep }) {
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
