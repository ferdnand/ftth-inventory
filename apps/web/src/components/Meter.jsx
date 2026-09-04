// A single ratio against a limit is a meter, not a chart.
//
// Severity always carries an icon AND a text label, never colour alone —
// otherwise the whole signal is invisible to a colour-blind reader and to
// anyone printing in greyscale.
const LEVELS = [
  { max: 0, key: 'critical', icon: '●', text: 'Out of stock' },
  { max: 0.5, key: 'critical', icon: '●', text: 'Critical' },
  { max: 0.8, key: 'serious', icon: '◐', text: 'Very low' },
  { max: 1, key: 'warning', icon: '◑', text: 'Low' },
  { max: Infinity, key: 'good', icon: '○', text: 'OK' },
];

const COLORS = {
  critical: 'var(--status-critical)',
  serious: 'var(--status-serious)',
  warning: 'var(--status-warning)',
  good: 'var(--ramp-3)',
};

export function severityOf(quantity, threshold) {
  if (!threshold) return LEVELS[LEVELS.length - 1];
  const ratio = quantity / threshold;
  return LEVELS.find((l) => ratio <= l.max) ?? LEVELS[LEVELS.length - 1];
}

export function Meter({ quantity, threshold, unit }) {
  if (!threshold) {
    return <span className="meter-value">no threshold</span>;
  }

  const ratio = Math.min(quantity / threshold, 1.5);
  const level = severityOf(quantity, threshold);

  return (
    <div className="meter" title={`${level.text}: ${quantity} against a threshold of ${threshold}`}>
      <span className="meter-track">
        <span
          className="meter-fill"
          style={{
            width: `${Math.max(Math.min(ratio, 1) * 100, 2)}%`,
            background: COLORS[level.key],
          }}
        />
      </span>
      <span className="meter-value">
        {quantity}/{threshold}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
}

export function SeverityLabel({ quantity, threshold }) {
  const level = severityOf(quantity, threshold);
  return (
    <span style={{ color: COLORS[level.key], whiteSpace: 'nowrap' }}>
      <span aria-hidden="true">{level.icon}</span> {level.text}
    </span>
  );
}
