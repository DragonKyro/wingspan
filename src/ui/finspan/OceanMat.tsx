// Finspan ocean mat: dive-site headers and the 6 depth rows of fish slots.

import {
  DIVE_BONUSES,
  MAX_CORAL,
  REEF_COMPLETION_BONUS,
  REEF_DISCARD_ITEMS,
} from '@/finspan/constants';
import { consumedCount, slotAt, topFish } from '@/finspan/helpers';
import type { GameState, PlayerState, SlotRef, SlotState } from '@/finspan/types';
import { DEEPWATER_ROW, ESTUARY_ROW, SITE_COLORS, zoneOfRow } from '@/finspan/types';
import { useValuePulse } from '../fx';
import { DiverMeepleSvg, FinIcon } from '../svgArt';
import { FishCardView } from './FishCardView';

const SITE_LABELS = [
  { color: 'blue', title: 'Blue Dive Site', subtitle: 'Draw Cards · Bottom: Recover' },
  { color: 'purple', title: 'Purple Dive Site', subtitle: 'Lay Eggs · Bottom: +1 Egg' },
  { color: 'green', title: 'Green Dive Site', subtitle: 'Hatch & Move · Bottom: Move' },
] as const;

export function OceanMatView({
  state,
  player,
  isSR,
  canDive,
  validTargets,
  onDive,
  onSelectSlot,
}: {
  state: GameState;
  player: PlayerState;
  isSR: boolean;
  canDive: boolean;
  validTargets: SlotRef[];
  onDive: (col: number) => void;
  onSelectSlot: (ref: SlotRef) => void;
}) {
  const playerIdx = state.players.findIndex((p) => p.id === player.id);
  const reefItems = state.settings.reefCosts?.[playerIdx] ?? REEF_DISCARD_ITEMS;

  return (
    <div className="card ocean-mat">
      {/* Dive site column headers */}
      <div className="ocean-sites-header">
        <div className="ocean-zone-gutter">Depth Zone</div>
        {SITE_LABELS.map((site, col) => {
          const bonus = DIVE_BONUSES[col]!;
          const coral = player.ocean.corals[col] ?? 0;
          const reefItem = reefItems[col] ?? 'egg';
          return (
            <div key={site.color} className={`ocean-site-head site-${site.color}`}>
              <div className="row">
                <b>{site.title}</b>
                <div className="spacer" />
                <button
                  type="button"
                  className="primary dive-btn"
                  disabled={!canDive}
                  onClick={() => onDive(col)}
                >
                  <DiverMeepleSvg color={player.color} size={16} /> Dive Here
                </button>
              </div>
              <div className="site-bonuses-row">
                <span>
                  Zones:{' '}
                  {bonus.zones.map((b, idx) => (
                    <FinIcon key={idx} kind={b} size={14} />
                  ))}
                </span>
                <span>
                  Bottom {!player.bottomTaken[col] ? '(open)' : '(taken)'}:{' '}
                  <FinIcon kind={bonus.bottom} size={14} />
                </span>
              </div>
              {isSR && (
                <div className="reef-strip" title="Sharks & Reefs Coral Overlay">
                  <span>
                    <FinIcon kind="anycoral" size={12} /> Coral: <b>{coral}/{MAX_CORAL}</b> (+{REEF_COMPLETION_BONUS[col]}pt at 6)
                  </span>
                  <span className="muted">
                    Twilight cost: <FinIcon kind={reefItem === 'card' ? 'discard' : reefItem} size={13} />
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 6 Depth Rows */}
      {Array.from({ length: 6 }, (_, row) => {
        const zone = zoneOfRow(row);
        const [rowIcon, rowText] =
          row === ESTUARY_ROW
            ? ['estuary', 'Sunlight (Estuary)']
            : row <= 2
              ? ['sunlight', 'Sunlight']
              : row === 3
                ? ['twilight', isSR ? 'Twilight + Coral Reef' : 'Twilight']
                : row === DEEPWATER_ROW
                  ? ['deepwater', 'Midnight (Deepwater)']
                  : ['midnight', 'Midnight'];
        const rowLabel = (
          <>
            <FinIcon kind={rowIcon} size={15} /> {rowText}
          </>
        );
        return (
          <div key={row} className={`ocean-row zone-${zone}`}>
            <div className="ocean-zone-label">
              <span>{rowLabel}</span>
              <span className="muted">Row {row + 1}</span>
            </div>
            {[0, 1, 2].map((col) => {
              const slot = slotAt(player.ocean, { row, col });
              const top = topFish(slot);
              const consumed = consumedCount(slot);
              const isTarget = validTargets.some((t) => t.row === row && t.col === col);
              return (
                <div
                  key={col}
                  className={`ocean-slot site-border-${SITE_COLORS[col]}${
                    isTarget ? ' targetable' : ''
                  }`}
                  onClick={isTarget ? () => onSelectSlot({ row, col }) : undefined}
                >
                  {top ? (
                    <FishCardView
                      card={top}
                      slotState={slot}
                      consumedCount={consumed}
                      zone={`ocean:${player.id}:${row}:${col}`}
                      selectable={isTarget}
                      compact
                    />
                  ) : (
                    <div className="empty-ocean-slot">
                      <span className="muted">
                        {isTarget ? '▶ Click to place fish here' : 'Open water'}
                      </span>
                      <SlotTokensBadge slot={slot} consumed={0} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function SlotTokensBadge({ slot, consumed }: { slot: SlotState; consumed: number }) {
  const total = slot.eggs + slot.young + (slot.school ? 3 : 0) + consumed;
  const pulseRef = useValuePulse<HTMLDivElement>(total);
  if (total === 0) return null;
  return (
    <div ref={pulseRef} className="ocean-tokens-row">
      {slot.eggs > 0 && (
        <span className="tok-pill" title="Fish egg (1 VP)">
          <FinIcon kind="egg" size={15} /> ×{slot.eggs}
        </span>
      )}
      {slot.young > 0 && (
        <span className="tok-pill" title="Young fish (1 VP; 3 merge into a 6-VP School)">
          <FinIcon kind="young" size={15} /> ×{slot.young}
        </span>
      )}
      {slot.school && (
        <span className="tok-pill school-pill" title="School token (6 VP)">
          <FinIcon kind="school" size={17} /> School (6pt)
        </span>
      )}
      {consumed > 0 && (
        <span className="tok-pill consumed-pill" title={`${consumed} consumed fish tucked underneath (1 VP each)`}>
          <FinIcon kind="consume" size={14} /> ×{consumed}
        </span>
      )}
    </div>
  );
}
