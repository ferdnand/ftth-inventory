import { label as toLabel, STATUS_VARIANT } from '../lib/constants';

// Variant is derived from the value, so the same status looks identical
// everywhere without each screen remembering the mapping.
export function Badge({ value, variant, children }) {
  const resolved = variant ?? STATUS_VARIANT[value] ?? '';
  return (
    <span className={`badge ${resolved}`.trim()}>{children ?? toLabel(value)}</span>
  );
}
