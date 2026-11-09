// Post-game match stats: dependency-free SVG charts and tabbed breakdown panel
// (modeled on card-collecting's MatchCharts.tsx and catan's MatchGraph.tsx).
// Supports switching between interactive SVG Chart view and accessible Table view.

import { createContext, useContext, useState, type ReactNode } from 'react';

export interface Series {
  id: string;
  label: string;
  color: string;
  values: number[];
  notes?: Array<string | undefined>;
}

type ViewMode = 'chart' | 'table';
const ViewContext = createContext<ViewMode>('chart');

export interface StatsTab<T extends string> {
  key: T;
  label: string;
  table?: boolean;
}

export function StatsTabs<T extends string>({
  tabs,
  title = 'Match Statistics',
  children,
}: {
  tabs: Array<StatsTab<T>>;
  title?: string;
  children: (active: T) => ReactNode;
}) {
  const [active, setActive] = useState<T>(tabs[0]!.key);
  const [view, setView] = useState<ViewMode>('chart');
  const tab = tabs.find((t) => t.key === active) ?? tabs[0]!;

  return (
    <section className="match-stats" aria-label={title}>
      <div className="match-stats-head">
        <h3>📊 {title}</h3>
        <div className="match-stats-tabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active === t.key}
              className={`ms-tab${active === t.key ? ' active' : ''}`}
              onClick={() => setActive(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab.table !== false && (
          <div className="match-stats-view" role="group" aria-label="Display mode">
            {(['chart', 'table'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                className={`ms-view-btn${view === v ? ' active' : ''}`}
                onClick={() => setView(v)}
              >
                {v === 'chart' ? 'Chart' : 'Table'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="match-stats-body" role="tabpanel">
        <ViewContext.Provider value={view}>{children(tab.key)}</ViewContext.Provider>
      </div>
    </section>
  );
}

/** Stacked bar chart across categories (e.g. players on x-axis, score categories stacked). */
export function StackedBarChart({
  xLabels,
  series,
  yLabel = 'Points',
}: {
  xLabels: string[];
  series: Series[];
  yLabel?: string;
}) {
  const view = useContext(ViewContext);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visible = series.filter((s) => !hidden.has(s.id));

  if (view === 'table') {
    return (
      <div className="ms-table-wrap">
        <table className="ms-table">
          <thead>
            <tr>
              <th>Category</th>
              {xLabels.map((lbl, i) => (
                <th key={i}>{lbl}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {series.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="ms-swatch" style={{ background: s.color }} />
                  {s.label}
                </td>
                {xLabels.map((_, i) => (
                  <td key={i}>
                    <b>{s.values[i] ?? 0}</b>
                    {s.notes?.[i] ? <span className="muted"> ({s.notes[i]})</span> : null}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="ms-total-row">
              <td>Total</td>
              {xLabels.map((_, i) => {
                const tot = series.reduce((acc, s) => acc + (s.values[i] ?? 0), 0);
                return (
                  <td key={i}>
                    <b>{tot}</b>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    );
  }

  const W = 580;
  const H = 230;
  const padL = 44;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const totals = xLabels.map((_, i) =>
    visible.reduce((sum, s) => sum + Math.max(0, s.values[i] ?? 0), 0),
  );
  const maxVal = Math.max(10, ...totals);
  const yTicks = 4;

  const toggle = (id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="ms-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ms-svg" role="img" aria-label={yLabel}>
        {/* Y gridlines */}
        {Array.from({ length: yTicks + 1 }, (_, t) => {
          const val = Math.round((maxVal * t) / yTicks);
          const y = padT + plotH - (val / maxVal) * plotH;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray={t === 0 ? undefined : '3 3'}
              />
              <text
                x={padL - 8}
                y={y + 4}
                textAnchor="end"
                fill="var(--muted)"
                fontSize="10"
              >
                {val}
              </text>
            </g>
          );
        })}

        {/* Stacked bars per category */}
        {xLabels.map((lbl, i) => {
          const slotW = plotW / Math.max(1, xLabels.length);
          const barW = Math.min(68, slotW * 0.56);
          const cx = padL + slotW * (i + 0.5);
          const x = cx - barW / 2;
          let acc = 0;
          const total = visible.reduce((sum, s) => sum + (s.values[i] ?? 0), 0);
          return (
            <g
              key={i}
              onMouseEnter={() => setHoverIdx(i)}
              onMouseLeave={() => setHoverIdx((cur) => (cur === i ? null : cur))}
              style={{ cursor: 'pointer' }}
            >
              {visible.map((s) => {
                const v = Math.max(0, s.values[i] ?? 0);
                if (v <= 0) return null;
                const h = (v / maxVal) * plotH;
                const y = padT + plotH - ((acc + v) / maxVal) * plotH;
                acc += v;
                return (
                  <rect
                    key={s.id}
                    x={x}
                    y={y}
                    width={barW}
                    height={Math.max(1, h)}
                    rx={2}
                    fill={s.color}
                    opacity={hoverIdx === null || hoverIdx === i ? 0.95 : 0.55}
                  />
                );
              })}
              <text
                x={cx}
                y={padT + plotH - (Math.max(0, acc) / maxVal) * plotH - 5}
                textAnchor="middle"
                fill="var(--ink)"
                fontSize="11"
                fontWeight="700"
              >
                {total}
              </text>
              <text
                x={cx}
                y={H - 10}
                textAnchor="middle"
                fill="var(--ink)"
                fontSize="11"
                fontWeight="600"
              >
                {lbl}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="ms-legend">
        {series.map((s) => {
          const off = hidden.has(s.id);
          return (
            <button
              key={s.id}
              type="button"
              className={`ms-legend-item${off ? ' is-off' : ''}`}
              onClick={() => toggle(s.id)}
              title="Click to toggle category"
            >
              <span className="ms-swatch" style={{ background: s.color }} />
              <span>{s.label}</span>
              {hoverIdx !== null && (
                <strong style={{ marginLeft: 4 }}>{s.values[hoverIdx] ?? 0}</strong>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Grouped bar chart for comparing players side-by-side across rounds or metrics. */
export function GroupedBarChart({
  xLabels,
  series,
  yLabel = 'Value',
}: {
  xLabels: string[];
  series: Series[];
  yLabel?: string;
}) {
  const view = useContext(ViewContext);
  if (view === 'table') {
    return <StackedBarChart xLabels={xLabels} series={series} yLabel={yLabel} />;
  }

  const W = 580;
  const H = 220;
  const padL = 44;
  const padR = 18;
  const padT = 18;
  const padB = 34;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const allVals = series.flatMap((s) => s.values);
  const maxVal = Math.max(5, ...allVals, 1);
  const yTicks = 4;

  return (
    <div className="ms-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ms-svg" role="img" aria-label={yLabel}>
        {Array.from({ length: yTicks + 1 }, (_, t) => {
          const val = Math.round((maxVal * t) / yTicks);
          const y = padT + plotH - (val / maxVal) * plotH;
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={W - padR}
                y2={y}
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray={t === 0 ? undefined : '3 3'}
              />
              <text x={padL - 8} y={y + 4} textAnchor="end" fill="var(--muted)" fontSize="10">
                {val}
              </text>
            </g>
          );
        })}

        {xLabels.map((lbl, ci) => {
          const slotW = plotW / Math.max(1, xLabels.length);
          const groupW = slotW * 0.72;
          const barW = Math.min(34, groupW / Math.max(1, series.length) - 3);
          const startX = padL + slotW * ci + (slotW - (barW + 3) * series.length) / 2;

          return (
            <g key={ci}>
              {series.map((s, si) => {
                const v = Math.max(0, s.values[ci] ?? 0);
                const h = (v / maxVal) * plotH;
                const x = startX + si * (barW + 3);
                const y = padT + plotH - h;
                return (
                  <g key={s.id}>
                    <rect x={x} y={y} width={barW} height={Math.max(2, h)} rx={2} fill={s.color} />
                    <text
                      x={x + barW / 2}
                      y={y - 4}
                      textAnchor="middle"
                      fill="var(--ink)"
                      fontSize="9.5"
                      fontWeight="700"
                    >
                      {s.values[ci] ?? 0}
                    </text>
                  </g>
                );
              })}
              <text
                x={padL + slotW * (ci + 0.5)}
                y={H - 10}
                textAnchor="middle"
                fill="var(--ink)"
                fontSize="11"
                fontWeight="600"
              >
                {lbl}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="ms-legend">
        {series.map((s) => (
          <span key={s.id} className="ms-legend-item">
            <span className="ms-swatch" style={{ background: s.color }} />
            <span>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
