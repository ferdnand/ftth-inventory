import { useSearchParams } from 'react-router-dom';
import { daysAgo, isoDay, startOfMonth } from '../../lib/format';

// ONE filter row per page, above everything it scopes — never a filter inside
// an individual chart card. State lives in the URL so a report is linkable and
// the back button works.
const PRESETS = [
  { key: '7', text: 'Last 7 days', from: () => daysAgo(7) },
  { key: '30', text: 'Last 30 days', from: () => daysAgo(30) },
  { key: '90', text: 'Last 90 days', from: () => daysAgo(90) },
  { key: 'mtd', text: 'Month to date', from: () => startOfMonth() },
  { key: 'all', text: 'All time', from: () => null },
];

export function useReportRange(defaultPreset = '30') {
  const [params, setParams] = useSearchParams();
  const preset = params.get('preset') ?? defaultPreset;

  const from = params.get('from') ?? PRESETS.find((p) => p.key === preset)?.from() ?? null;
  const to = params.get('to') ?? null;

  const setPreset = (key) => {
    const next = new URLSearchParams(params);
    next.set('preset', key);
    next.delete('from');
    next.delete('to');
    setParams(next, { replace: true });
  };

  const setCustom = (nextFrom, nextTo) => {
    const next = new URLSearchParams(params);
    next.set('preset', 'custom');
    if (nextFrom) next.set('from', nextFrom);
    else next.delete('from');
    if (nextTo) next.set('to', nextTo);
    else next.delete('to');
    setParams(next, { replace: true });
  };

  const setParam = (key, value) => {
    const next = new URLSearchParams(params);
    if (value === null || value === '') next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  return { preset, from, to, setPreset, setCustom, setParam, params };
}

export function ReportFilters({ range, children }) {
  return (
    <div className="filter-bar">
      <div className="field" style={{ minWidth: 'auto' }}>
        <label>Period</label>
        <div className="chip-row" style={{ marginBottom: 0 }}>
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              className={`chip ${range.preset === preset.key ? 'active' : ''}`.trim()}
              onClick={() => range.setPreset(preset.key)}
              aria-pressed={range.preset === preset.key}
            >
              {range.preset === preset.key ? '✓ ' : ''}
              {preset.text}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="from">From</label>
        <input
          id="from"
          type="date"
          value={range.from ?? ''}
          max={range.to ?? isoDay()}
          onChange={(e) => range.setCustom(e.target.value, range.to)}
        />
      </div>
      <div className="field">
        <label htmlFor="to">To</label>
        <input
          id="to"
          type="date"
          value={range.to ?? ''}
          min={range.from ?? undefined}
          max={isoDay()}
          onChange={(e) => range.setCustom(range.from, e.target.value)}
        />
      </div>

      {children}
    </div>
  );
}
