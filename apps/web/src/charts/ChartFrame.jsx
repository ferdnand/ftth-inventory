import { useState } from 'react';
import { chart } from './chartTheme';

/**
 * Wrapper every chart on this dashboard sits inside. It owns the rules that are
 * easy to break one chart at a time:
 *
 *  - Every chart has a TABLE VIEW toggle, so no value is tooltip-gated. A
 *    number a person needs must be readable without hovering.
 *  - While refetching, the previous render is held at reduced opacity rather
 *    than replaced by a skeleton. A chart that flashes empty on every filter
 *    change is unreadable.
 *  - ONE filter row per page, above everything it scopes — never a filter
 *    inside an individual chart card.
 *
 * Rules this app holds to that live here as documentation rather than code:
 *  - NO dual-axis charts. If installs and removals must be seen together, that
 *    is two stacked charts sharing one filter row, never two y-scales.
 *  - No donut or pie of stock by location — use a bar.
 *  - Text never wears the series colour; identity comes from the swatch beside
 *    the label.
 */
export function ChartFrame({
  title,
  subtitle,
  isRefetching,
  children,
  tableColumns,
  tableRows,
}) {
  const [showTable, setShowTable] = useState(false);
  const canToggle = Boolean(tableColumns && tableRows);

  return (
    <section className="chart-card">
      <div className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <div className="sub">{subtitle}</div> : null}
        </div>
        {canToggle ? (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
          >
            {showTable ? 'Chart' : 'Table'}
          </button>
        ) : null}
      </div>

      {showTable && canToggle ? (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                {tableColumns.map((col) => (
                  <th key={col.key} className={col.numeric ? 'num' : undefined}>
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, i) => (
                <tr key={i}>
                  {tableColumns.map((col) => (
                    <td key={col.key} className={col.numeric ? 'num' : undefined}>
                      {col.render ? col.render(row) : row[col.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={`chart-body ${isRefetching ? 'refetching' : ''}`.trim()}>{children}</div>
      )}
    </section>
  );
}

export function ChartTooltip({ active, payload, label, formatValue }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="chart-tooltip">
      {label !== undefined ? <div className="tt-label">{label}</div> : null}
      {payload.map((entry) => (
        <div className="tt-row" key={entry.dataKey ?? entry.name}>
          <span className="swatch" style={{ background: entry.color ?? chart.seriesSingle }} />
          <span>{entry.name}</span>
          <strong style={{ marginLeft: 'auto' }}>
            {formatValue ? formatValue(entry.value) : entry.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

export function ChartLegend({ items }) {
  return (
    <div className="chip-row" style={{ marginTop: 10, marginBottom: 0 }}>
      {items.map((item) => (
        <span
          key={item.label}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
        >
          <span
            className="swatch"
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: item.color,
              display: 'inline-block',
            }}
          />
          {/* Label text stays --text-2; only the swatch carries the colour. */}
          <span style={{ color: 'var(--text-2)' }}>{item.label}</span>
        </span>
      ))}
    </div>
  );
}
