// One card frame for every creature in all three games (birds, dragons, fish).
// Fixed size (--cc-w × --cc-h) and a fixed layout, so every card reads the
// same way wherever it appears (hand, tray, board, setup, choices):
//
//   ┌──────────────────────────┐
//   │ [cost]            [VP ◆] │  cost top-left · points top-right
//   │ Name (≤2 lines)          │
//   │ subtitle                 │
//   │ ▌▌ ┌──────────────────┐  │  left strip = valid placements
//   │ ▌▌ │ art  [tokens]    │  │  (habitats / caves / depth zones),
//   │ ▌▌ └──────────────────┘  │  coloured = allowed, grey = not
//   │ ▌▌ traits row            │  traits always directly under the art
//   │ ┌ POWER LABEL ─────────┐ │
//   │ │ power text (scrolls) │ │
//   └──────────────────────────┘

import type { CSSProperties, ReactNode } from 'react';

export interface Placement {
  key: string;
  label: string;
  color: string;
  icon: ReactNode;
  on: boolean;
}

export function CreatureCard({
  theme,
  cardRef,
  name,
  subtitle,
  cost,
  points,
  placements,
  art,
  overlay,
  traits,
  powerLabel,
  powerIcon,
  powerClass,
  preface,
  power,
  tooltip,
  selectable,
  selected,
  activating,
  onClick,
}: {
  theme: 'wing' | 'wyrm' | 'fin';
  cardRef?: (node: HTMLElement | null) => (() => void) | void;
  name: string;
  subtitle?: ReactNode;
  cost: ReactNode;
  points: ReactNode;
  placements: Placement[];
  art: ReactNode;
  /** Tokens on a played card, drawn over the art — pass a `.cc-tokens` element. */
  overlay?: ReactNode;
  traits: ReactNode;
  powerLabel?: ReactNode;
  powerIcon?: ReactNode;
  powerClass: string;
  /** Extra line above the power text (e.g. a fledgling's training track). */
  preface?: ReactNode;
  power: ReactNode;
  tooltip: string;
  selectable?: boolean;
  selected?: boolean;
  activating?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      ref={cardRef}
      className={`ccard ccard-${theme}${selectable ? ' selectable' : ''}${selected ? ' selected' : ''}${
        activating ? ' activating' : ''
      }`}
      onClick={onClick}
      title={tooltip}
    >
      <div className="cc-top">
        <div className="cc-cost">{cost}</div>
        <div className="cc-vp">{points}</div>
      </div>
      <div className="cc-name">{name}</div>
      <div className="cc-sub">{subtitle}</div>
      <div className="cc-body">
        <div className="cc-place">
          {placements.map((p) => (
            <div
              key={p.key}
              className={`cc-pl${p.on ? ' on' : ''}`}
              style={{ '--pl': p.color } as CSSProperties}
              title={`${p.on ? 'Can be placed in' : 'Cannot be placed in'}: ${p.label}`}
            >
              {p.icon}
            </div>
          ))}
        </div>
        <div className="cc-mid">
          <div className="cc-art">
            {art}
            {overlay}
          </div>
          <div className="cc-traits">{traits}</div>
        </div>
      </div>
      <div className={`cc-power ${powerClass}`}>
        {(powerLabel || powerIcon) && (
          <div className="cc-power-head">
            {powerIcon}
            {powerLabel}
          </div>
        )}
        {preface}
        <div className="cc-power-text">{power}</div>
      </div>
    </div>
  );
}

/** "Free" marker for zero-cost cards (same in every game). */
export function FreeCost() {
  return (
    <span className="cc-free" title="No cost">
      FREE
    </span>
  );
}
